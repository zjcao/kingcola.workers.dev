/**
 * 招新模块的后台接口（全部需要管理员会话）。
 *
 *   GET    /api/admin/recruit                    整届状态 + 名称 + 群号 + 邮件模板
 *   PUT    /api/admin/recruit                    保存名称 / 群号 / 模板
 *   GET    /api/admin/recruit/stats               漏斗与状态细分（顶部摘要条）
 *   POST   /api/admin/recruit/actions              推进整届：开启报名、确认名单、关闭本届……（状态机）
 *   GET    /api/admin/recruit/checkin-codes        三个阶段各自的签到二维码
 *   POST   /api/admin/recruit/checkin-codes        签发（重发会自动作废该阶段旧码）
 *   POST   /api/admin/recruit/checkin-codes/revoke 作废
 *   GET    /api/admin/recruit/export               导出当前筛选的名单 CSV
 *   GET    /api/admin/recruit/mails                发信日志
 *
 * 招新没有任何时间字段：阶段推进全靠 `POST /actions`，实现与校验在 `lib/recruit-cycle.ts`。
 * 动作清单与文案不另开接口 —— 前端直接引 `shared/recruit.ts` 的 `RECRUIT_ACTION_META`，两边同一份。
 */

import {
  applicationLabel,
  buildCsv,
  checkinTokenPath,
  isApplicationFinished,
  isCheckinStage,
  isRecruitAction,
  isRecruitResult,
  RECRUIT_ACTION_META,
  RECRUIT_STAGE_LABELS,
  RECRUIT_STAGES,
  RECRUIT_STATE_LABELS,
  unknownTemplateVariables,
  validateQQGroups,
  type CheckinStage,
  type RecruitAction,
  type RecruitActionResult,
  type RecruitCheckinCodeMap,
  type RecruitCheckinCodeView,
  type RecruitCycleConfig,
  type RecruitCycleState,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
  type RecruitStats,
  type RecruitTemplates,
} from '../../shared/recruit'
import {
  listAllApplications,
  listApplications,
  listMailLogs,
  type ApplicationRecord,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import {
  issueCheckinToken,
  listActiveCheckinTokens,
  normalizeTtlHours,
  revokeCheckinTokens,
  type CheckinTokenRecord,
} from '../lib/recruit-checkin'
import { getRecruitSettings, saveRecruitSettings } from '../lib/recruit-config'
import { RecruitActionError, runRecruitAction } from '../lib/recruit-cycle'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { resolveRuntimeConfig } from './config'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

// ===== 整届状态与设置 =====

export async function getRecruitSettingsRoute(ctx: RequestContext): Promise<Response> {
  const settings = await getRecruitSettings(ctx.env)

  // 模板里写错的变量要在后台直接提示出来，避免发出去才发现少了内容
  const unknownVariables = Object.fromEntries(
    Object.entries(settings.templates).map(([kind, template]) => [
      kind,
      [...new Set([...unknownTemplateVariables(template.subject), ...unknownTemplateVariables(template.body)])],
    ]),
  )

  return ok({ cycle: settings.cycle, templates: settings.templates, unknownVariables })
}

interface SaveRecruitBody {
  cycle?: Partial<RecruitCycleConfig>
  templates?: Partial<Record<RecruitMailKind, { subject?: string; body?: string; enabled?: boolean }>>
}

export async function updateRecruitSettings(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<SaveRecruitBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  // 整届状态只能由动作接口推进，这里刻意不接受 state ——
  // 否则「在设置页点一下保存」就可能把流程跳到别的阶段，状态机形同虚设。
  const cycle: Partial<RecruitCycleConfig> = { ...(body.cycle ?? {}) }
  delete cycle.state

  if (cycle.groups) {
    const invalid = validateQQGroups(cycle.groups)
    if (invalid) return fail(400, 'VALIDATION_FAILED', invalid)
  }

  const saved = await saveRecruitSettings(ctx.env, {
    cycle: body.cycle ? cycle : undefined,
    templates: body.templates as Partial<RecruitTemplates> | undefined,
  })

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'save_recruit_config',
    resource: 'recruit',
    detail: [
      body.cycle ? `cycle=${saved.cycle.name || '(未命名)'}` : '',
      cycle.groups ? `groups=${Object.values(saved.cycle.groups).join('/')}` : '',
      body.templates ? 'templates' : '',
    ]
      .filter(Boolean)
      .join(' '),
    ...requestMeta(ctx),
  })

  return ok({ cycle: saved.cycle, templates: saved.templates })
}

/** 顶部摘要条：漏斗 + 状态细分（每进一次页面拉一次，量级最多几百条） */
export async function getRecruitStats(ctx: RequestContext): Promise<Response> {
  const [settings, records] = await Promise.all([
    getRecruitSettings(ctx.env),
    listAllApplications(ctx.env),
  ])

  const funnel = Object.fromEntries(RECRUIT_STAGES.map((stage) => [stage, 0])) as Record<
    RecruitStage,
    number
  >
  const byLabel: Record<string, number> = {}
  let members = 0

  for (const record of records) {
    const label = applicationLabel(record.stage, record.result)
    byLabel[label] = (byLabel[label] ?? 0) + 1
    if (!isApplicationFinished(record.stage, record.result)) funnel[record.stage] += 1
    if (record.stage === 'onboard' && record.result === 'passed') members += 1
  }

  const stats: RecruitStats = {
    state: settings.cycle.state,
    stateLabel: RECRUIT_STATE_LABELS[settings.cycle.state],
    cycleName: settings.cycle.name,
    funnel,
    byLabel,
    total: records.length,
    members,
  }
  return ok(stats)
}

// ===== 推进整届（状态机） =====

interface ActionBody {
  action?: string
  /** 需要勾选名单的动作（确认笔试名单 / 生成面试名单 / 录取 / 转正） */
  selectedIds?: string[]
}

export async function runRecruitActionRoute(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<ActionBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const action = (body.action ?? '').trim()
  if (!isRecruitAction(action)) return fail(400, 'INVALID_ACTION', `未知的动作：${action}`)

  const selectedIds = (body.selectedIds ?? []).map((id) => String(id).trim()).filter(Boolean)
  const runtime = await resolveRuntimeConfig(ctx)

  let result: RecruitActionResult
  try {
    result = await runRecruitAction(
      { env: ctx.env, origin: ctx.url.origin, actor: actorOf(ctx), mail: runtime.mail },
      action,
      selectedIds,
    )
  } catch (error) {
    if (error instanceof RecruitActionError) return fail(409, error.code, error.message)
    throw error
  }

  return ok({
    ...result,
    label: RECRUIT_ACTION_META[action].label,
    next: nextActionOf(result.state),
  })
}

/** 该状态下管理员接下来的「下一步」（后台直接提示，省得对着流程图数） */
function nextActionOf(state: RecruitCycleState): { action: RecruitAction; label: string } | null {
  const order: RecruitAction[] = [
    'open_apply',
    'end_apply',
    'confirm_written',
    'end_written',
    'advance_written',
    'end_interview',
    'advance_interview',
    'end_defense',
    'advance_defense',
  ]
  for (const action of order) {
    if (RECRUIT_ACTION_META[action].from.includes(state)) {
      return { action, label: RECRUIT_ACTION_META[action].label }
    }
  }
  return state === 'dormant' ? null : { action: 'close_cycle', label: RECRUIT_ACTION_META.close_cycle.label }
}

// ===== 签到二维码（只绑阶段） =====

function toCodeView(record: CheckinTokenRecord, origin: string): RecruitCheckinCodeView {
  return {
    token: record.token,
    stage: record.stage,
    stageLabel: RECRUIT_STAGE_LABELS[record.stage],
    url: `${origin.replace(/\/+$/, '')}${checkinTokenPath(record.token)}`,
    expiresAt: record.expiresAt,
    createdBy: record.createdBy,
    createdAt: record.createdAt,
  }
}

/** 三个阶段各自的当前有效码（没有就是 null，前端据此显示「生成」按钮） */
export async function listCheckinCodes(ctx: RequestContext): Promise<Response> {
  const active = await listActiveCheckinTokens(ctx.env)
  const codes = {} as RecruitCheckinCodeMap
  for (const stage of ['written', 'interview', 'defense'] as CheckinStage[]) {
    const record = active[stage]
    codes[stage] = record ? toCodeView(record, ctx.url.origin) : null
  }
  return ok({ codes }, { headers: { 'cache-control': 'no-store' } })
}

interface IssueCodeBody {
  stage?: string
  /** 有效期（小时），不传用默认值 */
  ttlHours?: number
}

export async function issueCheckinCode(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<IssueCodeBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const stageRaw = String(body.stage ?? '').trim()
  if (!isCheckinStage(stageRaw)) return fail(400, 'INVALID_STAGE', '签到阶段只支持笔试 / 面试 / 答辩')
  const stage = stageRaw

  const { cycle } = await getRecruitSettings(ctx.env)
  if (!isStageInProgress(cycle.state, stage)) {
    return fail(
      409,
      'STAGE_NOT_ACTIVE',
      `当前是「${RECRUIT_STATE_LABELS[cycle.state]}」，${RECRUIT_STAGE_LABELS[stage]}还没开始或已经走完，不需要签到二维码`,
    )
  }

  const record = await issueCheckinToken(ctx.env, {
    stage,
    ttlHours: body.ttlHours,
    actor: actorOf(ctx),
  })
  const view = toCodeView(record, ctx.url.origin)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'issue_checkin_code',
    resource: 'applications',
    targetId: stage,
    detail: `签发${RECRUIT_STAGE_LABELS[stage]}签到二维码，有效 ${normalizeTtlHours(body.ttlHours)} 小时（该阶段旧码已作废）`,
    ...requestMeta(ctx),
  })

  return ok({ code: view, url: view.url })
}

interface RevokeCodeBody {
  stage?: string
}

export async function revokeCheckinCode(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<RevokeCodeBody>(ctx.request)
  const stageRaw = String(body?.stage ?? '').trim()
  if (stageRaw && !isCheckinStage(stageRaw)) return fail(400, 'INVALID_STAGE', '签到阶段不合法')

  const revoked = await revokeCheckinTokens(ctx.env, {
    stage: stageRaw ? (stageRaw as CheckinStage) : null,
    actor: actorOf(ctx),
  })

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'revoke_checkin_code',
    resource: 'applications',
    targetId: stageRaw || 'all',
    detail: `作废 ${revoked} 张签到二维码`,
    ...requestMeta(ctx),
  })

  return ok({ revoked })
}

/** 该阶段现在是否正在进行（或刚结束待收尾）—— 只有这两个状态才可能用到签到码 */
function isStageInProgress(state: RecruitCycleState, stage: CheckinStage): boolean {
  return state === stage || state === `${stage}_review`
}

// ===== 导出与日志 =====

/** 当前名单导出（按后台的筛选条件走），直接返回 CSV 文件供浏览器下载 */
export async function exportRecruitCsv(ctx: RequestContext): Promise<Response> {
  const stageParam = (ctx.url.searchParams.get('stage') ?? '').trim()
  const stages = stageParam
    ? (stageParam.split(',').filter((s) => RECRUIT_STAGES.includes(s as RecruitStage)) as RecruitStage[])
    : undefined
  const resultParam = ctx.url.searchParams.get('result')
  // 结果筛选里允许显式写空串（表示「尚无结论」），所以用 null 与 '' 区分「没传」和「传了空」
  const results =
    resultParam === null
      ? undefined
      : (resultParam.split(',').filter((value) => isRecruitResult(value)) as RecruitResult[])

  const [settings, rows] = await Promise.all([
    getRecruitSettings(ctx.env),
    listApplications(ctx.env, {
      stages,
      results,
      search: ctx.url.searchParams.get('q') ?? undefined,
      limit: 2000,
    }),
  ])

  const csv = buildCsv(
    rows.items.map((record: ApplicationRecord) => ({
      ...record,
      stageLabel: RECRUIT_STAGE_LABELS[record.stage],
      resultLabel: record.result === '' ? '待定' : record.result,
      statusLabel: applicationLabel(record.stage, record.result),
    })),
  )

  const name = `${settings.cycle.name || '招新'}-名单-${new Date().toISOString().slice(0, 10)}.csv`
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="recruit.csv"; filename*=UTF-8''${encodeURIComponent(name)}`,
      'cache-control': 'no-store',
    },
  })
}

export async function getRecruitMails(ctx: RequestContext): Promise<Response> {
  const limit = Number(ctx.url.searchParams.get('limit') ?? 200)
  const logs = await listMailLogs(ctx.env, { limit })
  return ok({ logs })
}
