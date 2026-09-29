/**
 * 整届的推进动作（状态机执行器）。
 *
 * 招新没有任何时间字段：**每一次阶段推进都是管理员点了一下按钮**。
 * 这里就是那些按钮的后端实现，也是整届状态唯一的写入口 ——
 * 校验（能不能做）与推进（做完变成什么状态）都读 `shared/recruit.ts` 里的 RECRUIT_ACTION_META，
 * 所以不可能出现「界面能点但后端拒绝」。
 *
 * 四条贯穿始终的规则：
 * 1. **邮件不阻断流转**：发信失败照常推进，失败原因如实返回（后台可对单人重发）；
 * 2. **缺考与未通过初筛不发信**（本人没收到任何信也不该收到「你被淘汰了」以外的打扰）；
 * 3. **关闭本届先导出存档再清库**：对象存储没接通就拒绝关闭，绝不把数据清了却拿不出存档；
 * 4. **清空报名（`reset_apply`）是唯一的例外**：它就是为了丢掉一批不想要的数据，
 *    所以刻意**不导出存档、也不因存储不可用而拒绝** —— 但会把「删了什么、什么没删掉」如实回报。
 */

import {
  actionBlockedReason,
  applicationInviteExpiry,
  applicationLabel,
  buildCsv,
  isMaterialApproved,
  RECRUIT_ACTION_META,
  RECRUIT_ARCHIVE_SCOPE,
  RECRUIT_STAGE_LABELS,
  RECRUIT_STATE_LABELS,
  type RecruitAction,
  type RecruitActionResult,
  type RecruitCycleState,
  type RecruitMailKind,
  type RecruitStage,
} from '../../shared/recruit'
import type { SmtpConfig } from '../../shared/mail'
import type { Env } from '../env'
import {
  CHECKIN_COLUMN,
  clearRecruitData,
  getApplication,
  listAllApplications,
  updateApplication,
  updateApplications,
  type ApplicationPatch,
  type ApplicationRecord,
} from './applications'
import { purgeCheckinTokens } from './recruit-checkin'
import { getRecruitSettings, saveRecruitSettings } from './recruit-config'
import {
  sendApplicationNotice,
  summarizeMailResults,
  type NoticeContext,
  type SendNoticeResult,
} from './recruit-mail'
import { getSiteConfig, writeAudit } from './repo'
import { getStorage, resolveFileRef, storageReady } from './storage'

/** 动作被拒绝（状态不对 / 没勾选 / 存储没接通）—— 路由层转成 409 */
export class RecruitActionError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'RecruitActionError'
    this.code = code
  }
}

export interface ActionContext {
  env: Env
  /** 站点地址，用来拼邀请函链接 */
  origin: string
  actor: string
  /** 当前生效的 SMTP 配置（由路由层解析后传进来，lib 不直接依赖 routes） */
  mail: SmtpConfig
}

const EMPTY_MAIL = { sent: 0, failed: 0, summary: '' }

/**
 * 执行一个动作。`selectedIds` 只在需要勾选名单的动作里有意义。
 * 状态不对、没勾选人、存储没接通都抛 RecruitActionError。
 */
export async function runRecruitAction(
  ctx: ActionContext,
  action: RecruitAction,
  selectedIds: string[] = [],
): Promise<RecruitActionResult> {
  const settings = await getRecruitSettings(ctx.env)
  const blocked = actionBlockedReason(action, settings.cycle.state, selectedIds.length)
  if (blocked) throw new RecruitActionError('BLOCKED', blocked)

  const notice: NoticeContext = {
    studio: await getSiteConfig(ctx.env),
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.origin,
  }

  switch (action) {
    case 'start_cycle': {
      const saved = await saveRecruitSettings(ctx.env, {
        cycle: { state: 'prepare', startedAt: new Date().toISOString() },
      })
      await audit(ctx, action, `本届「${saved.cycle.name || '未命名'}」启动，进入备招`)
      return buildResult(action, saved.cycle.state, 0, EMPTY_MAIL, null)
    }

    case 'close_cycle':
      return await closeCycle(ctx, notice)

    case 'open_apply':
    case 'end_apply':
      return await plainTransition(ctx, action)

    case 'reset_apply':
      return await resetApply(ctx)

    case 'end_written':
    case 'end_interview':
    case 'end_defense':
      return await finishExam(ctx, action)

    case 'confirm_written':
    case 'advance_written':
    case 'advance_interview':
    case 'advance_defense':
      return await promote(ctx, action, selectedIds, notice)
  }
}

// ---------------------------------------------------------------------------
// 通用零件
// ---------------------------------------------------------------------------

function buildResult(
  action: RecruitAction,
  state: RecruitCycleState,
  moved: number,
  mail: { sent: number; failed: number; summary: string },
  archive: RecruitActionResult['archive'],
): RecruitActionResult {
  return { action, state, stateLabel: RECRUIT_STATE_LABELS[state], moved, mail, archive }
}

async function setState(env: Env, state: RecruitCycleState): Promise<RecruitCycleState> {
  const saved = await saveRecruitSettings(env, { cycle: { state } })
  return saved.cycle.state
}

async function audit(ctx: ActionContext, action: RecruitAction, detail: string): Promise<void> {
  await writeAudit(ctx.env, {
    actor: ctx.actor,
    action: `recruit_${action}`,
    resource: 'recruit',
    targetId: action,
    detail,
    ip: '',
    ua: '',
  })
}

/** 只换状态、不动数据（开启报名、结束报名） */
async function plainTransition(
  ctx: ActionContext,
  action: RecruitAction,
): Promise<RecruitActionResult> {
  const meta = RECRUIT_ACTION_META[action]
  const state = await setState(ctx.env, meta.to)
  await audit(ctx, action, `${RECRUIT_STATE_LABELS[meta.from[0]]} → ${RECRUIT_STATE_LABELS[state]}`)
  return buildResult(action, state, 0, EMPTY_MAIL, null)
}

/**
 * 结束某个考试阶段：顺带把**未签到的同学标记为「未参加」**（不发信）。
 * 这是「事件驱动」最实用的一点 —— 不用等人去点「标记缺考」，
 * 结束考试本身就是收尾动作，漏签的人还能在收尾页补签救回来。
 */
async function finishExam(ctx: ActionContext, action: RecruitAction): Promise<RecruitActionResult> {
  const stage: RecruitStage =
    action === 'end_written' ? 'written' : action === 'end_interview' ? 'interview' : 'defense'
  const column = CHECKIN_COLUMN[stage]

  const records = await listAllApplications(ctx.env)
  const absent = records.filter(
    (record) => record.stage === stage && !record[column] && record.result === '',
  )

  let moved = 0
  if (absent.length > 0) {
    const now = new Date().toISOString()
    moved = await updateApplications(
      ctx.env,
      absent.map((record) => ({ id: record.id, result: 'absent' as const, stageChangedAt: now })),
    )
  }

  const state = await setState(ctx.env, RECRUIT_ACTION_META[action].to)
  await audit(
    ctx,
    action,
    `结束${RECRUIT_STAGE_LABELS[stage]}：自动标记 ${moved} 人未参加（不发信）`,
  )
  return buildResult(action, state, moved, EMPTY_MAIL, null)
}

/** 需要勾选名单的四个动作：勾选的人晋级（可能发信），未勾选的人判未通过（可能发感谢信） */
interface PromotionPlan {
  stage: RecruitStage
  next: RecruitStage
  /** 晋级者收到的信；null = 不发 */
  outcome: RecruitMailKind | null
  /** 未勾选者收到的信；null = 不发（报名阶段就是这种情况：未通过初筛不发信） */
  thanks: RecruitMailKind | null
  /** 晋级者除阶段以外还要写的字段（转正要签发邀请函） */
  grant?: (record: ApplicationRecord, now: string) => ApplicationPatch
}

const PROMOTIONS: Record<string, PromotionPlan> = {
  confirm_written: {
    stage: 'apply',
    next: 'written',
    outcome: 'written_invite',
    thanks: null,
  },
  advance_written: {
    stage: 'written',
    next: 'interview',
    outcome: 'interview_invite',
    thanks: 'thanks_written',
  },
  advance_interview: {
    stage: 'interview',
    next: 'defense',
    outcome: 'interview_passed',
    thanks: 'thanks_interview',
  },
  advance_defense: {
    stage: 'defense',
    next: 'onboard',
    outcome: 'offer',
    thanks: 'thanks_defense',
    grant: () => ({
      inviteToken: newInviteToken(),
      inviteExpiresAt: applicationInviteExpiry(),
      invitedAt: new Date().toISOString(),
    }),
  },
}

/** 邀请函凭证：72 位十六进制，足够长，不需要额外签名 */
function newInviteToken(): string {
  const bytes = new Uint8Array(36)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

async function promote(
  ctx: ActionContext,
  action: RecruitAction,
  selectedIds: string[],
  notice: NoticeContext,
): Promise<RecruitActionResult> {
  const plan = PROMOTIONS[action]
  const picked = new Set(selectedIds)
  const now = new Date().toISOString()

  const records = await listAllApplications(ctx.env)
  // 可推进的人：还在这个阶段、且结论是「待定」或「已参加」（已淘汰/缺考/退出的不再动）
  const eligible = records.filter(
    (record) => record.stage === plan.stage && (record.result === '' || record.result === 'attended'),
  )
  const winners = eligible.filter((record) => picked.has(record.id))
  const losers = eligible.filter((record) => !picked.has(record.id))

  // 「报名 → 笔试」这一步额外看材料审核：**没通过的人不能进笔试** ——
  // 否则管理员辛苦审一轮，勾选时照样能把被驳回的人送进考场，审核就成了装饰。
  //
  // 只在这一步校验：材料审核是报名阶段的事，过了笔试再拿它卡人没有意义
  // （现场补录到笔试的人也不该因为「没有报名材料」而被拦在面试之外）。
  // 也只拦**勾选的**人：未勾选的本来就会判未通过，不必因为他堵住整个动作。
  if (plan.stage === 'apply') {
    const pending = winners.filter((record) => !isMaterialApproved(record))
    if (pending.length > 0) {
      const names = pending
        .slice(0, 5)
        .map((record) => `${record.name}(${record.studentId})`)
        .join('、')
      throw new RecruitActionError(
        'MATERIAL_NOT_APPROVED',
        `勾选的人里有 ${pending.length} 人的材料还没通过审核：${names}${pending.length > 5 ? ' 等' : ''}。` +
          '请先在名单里把他们「通过材料」，或者取消勾选。',
      )
    }
  }

  if (winners.length === 0) {
    throw new RecruitActionError('NOTHING_TO_PROMOTE', '勾选的人里没有可以推进的记录（可能已经结束或不在本阶段）')
  }

  // 先落库再发信：邀请函里的 {inviteLink} 来自刚写进去的凭证
  const promoted: ApplicationRecord[] = []
  for (const record of winners) {
    const updated = await updateApplication(ctx.env, record.id, {
      stage: plan.next,
      result: '',
      stageChangedAt: now,
      ...(plan.grant?.(record, now) ?? {}),
    })
    if (updated) promoted.push(updated)
  }
  if (losers.length > 0) {
    await updateApplications(
      ctx.env,
      losers.map((record) => ({ id: record.id, result: 'failed' as const, stageChangedAt: now })),
    )
  }

  const sends: SendNoticeResult[] = []
  if (plan.outcome) {
    for (const record of promoted) {
      sends.push(await sendApplicationNotice(ctx.env, ctx.mail, record, plan.outcome, notice, ctx.actor))
    }
  }
  if (plan.thanks) {
    for (const loser of losers) {
      // 感谢信要用判完之后的最新记录（result 已是 failed），所以重新取一遍
      const fresh = await getApplication(ctx.env, loser.id)
      if (fresh) sends.push(await sendApplicationNotice(ctx.env, ctx.mail, fresh, plan.thanks, notice, ctx.actor))
    }
  }

  const state = await setState(ctx.env, RECRUIT_ACTION_META[action].to)
  const moved = promoted.length + losers.length
  await audit(
    ctx,
    action,
    `晋级 ${promoted.length} 人、判未通过 ${losers.length} 人；${summarizeMailResults(sends)}`,
  )
  return buildResult(action, state, moved, {
    sent: sends.filter((item) => item.sent).length,
    failed: sends.filter((item) => !item.sent).length,
    summary: summarizeMailResults(sends),
  }, null)
}

// ---------------------------------------------------------------------------
// 强制结束报名并清空数据（推倒重来）
// ---------------------------------------------------------------------------

/**
 * 强制结束报名并清空数据：**删掉本届已收到的报名与材料，然后回到「备招」**。
 *
 * 为什么需要它：报名被刷屏、或本届配置搞错（名称 / 群号写错、模板先发错了）时，
 * 已经收上来的那批表全是脏数据 —— 与其在名单里一条条删、还要一个个去清理孤儿文件，
 * 不如一键回到起点重新收一批干净的。
 *
 * 与「关闭本届」的三点区别（都是刻意的）：
 *   1. **不导出存档**：它就是为了丢掉这批数据，导出反而是在留下不想要的东西；
 *   2. **不因对象存储不可用而拒绝**：库该清就得清，删不掉的文件如实报数让管理员去处理；
 *   3. **结束在「备招」而不是「休眠」**：报名流程结束了，但本届还在（名称与群号保留），
 *      可以立刻重新「开启报名」。
 *
 * 先删文件再清库：库一清就再也找不回 `fileUrl`，对象存储里会留下无人认领的孤儿对象。
 */
async function resetApply(ctx: ActionContext): Promise<RecruitActionResult> {
  const { env } = ctx
  const records = await listAllApplications(env)
  const withFile = records.filter((record) => record.fileUrl !== '')

  let files = 0
  let filesFailed = 0
  if (await storageReady(env, 'applications')) {
    const storage = await getStorage(env, 'applications')
    for (const record of withFile) {
      const ref = await resolveFileRef(env, record.fileUrl)
      // 归档 CSV 也在 applications/ 前缀下，但它不属于任何人 —— 别顺手删了往届存档
      if (!ref || ref.purpose !== 'applications' || ref.key.startsWith(RECRUIT_ARCHIVE_SCOPE)) continue
      try {
        await storage.delete(ref.key)
        files += 1
      } catch {
        filesFailed += 1
      }
    }
  } else {
    // 存储没接通：库照清，但要让管理员知道文件还在桶里
    filesFailed = withFile.length
  }

  await clearRecruitData(env)
  const state = await setState(env, RECRUIT_ACTION_META.reset_apply.to)

  await audit(
    ctx,
    'reset_apply',
    `清空本届报名：删除 ${records.length} 条报名记录、${files} 个报名表文件` +
      `${filesFailed > 0 ? `（${filesFailed} 个文件没删掉，需到对象存储里手动清理）` : ''}；回到备招`,
  )

  return {
    ...buildResult('reset_apply', state, records.length, EMPTY_MAIL, null),
    cleaned: { applications: records.length, files, filesFailed },
  }
}

// ---------------------------------------------------------------------------
// 关闭本届
// ---------------------------------------------------------------------------

/**
 * 关闭本届：导出存档 → 删报名表文件 → 清空报名数据与发信日志 → 回到休眠。
 *
 * **先导出再清库**：对象存储没接通（或写入失败）就直接拒绝关闭 ——
 * 否则一次误点就可能把整届材料清空却拿不出存档。
 */
async function closeCycle(ctx: ActionContext, notice: NoticeContext): Promise<RecruitActionResult> {
  const { env } = ctx

  // 1. 还没确认的人记为「未参加」，让存档如实反映结局（学生端不提供拒绝，所以这里替他们落一笔）
  const initial = await listAllApplications(env)
  const pending = initial.filter((record) => record.stage === 'onboard' && record.result === '')
  if (pending.length > 0) {
    await updateApplications(
      env,
      pending.map((record) => ({ id: record.id, result: 'absent' as const })),
    )
  }

  // 2. 导出存档
  const records = pending.length > 0 ? await listAllApplications(env) : initial
  const rows = records.map((record) => ({
    ...record,
    stageLabel: RECRUIT_STAGE_LABELS[record.stage],
    resultLabel: record.result === '' ? '待定' : record.result,
    statusLabel: applicationLabel(record.stage, record.result),
  }))
  const csv = buildCsv(rows)

  if (!(await storageReady(env, 'applications'))) {
    throw new RecruitActionError(
      'STORAGE_UNAVAILABLE',
      '对象存储未接通，导出存档失败。为避免数据丢失，本届没有关闭 —— 请先到「对象存储」页接通后重试',
    )
  }

  const storage = await getStorage(env, 'applications')
  const key = `${RECRUIT_ARCHIVE_SCOPE}/${new Date().toISOString().slice(0, 10)}-${Date.now().toString(36)}.csv`
  try {
    await storage.put(key, new Blob([csv], { type: 'text/csv;charset=utf-8' }), {
      contentType: 'text/csv;charset=utf-8',
    })
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new RecruitActionError('ARCHIVE_FAILED', `存档写入失败（${reason}），本届未关闭，数据都还在`)
  }
  const archiveUrl = storage.objectUrl(key)

  // 3. 删报名表（归档 CSV 也在 applications/ 前缀下，保留）
  for (const record of records) {
    const ref = await resolveFileRef(env, record.fileUrl)
    if (ref?.purpose === 'applications' && !ref.key.startsWith(RECRUIT_ARCHIVE_SCOPE)) {
      await storage.delete(ref.key).catch(() => {})
    }
  }

  // 4. 清空报名数据、发信日志与签到凭证，回到休眠
  await clearRecruitData(env)
  await purgeCheckinTokens(env)
  const state = await setState(env, 'dormant')

  const members = records.filter((record) => record.stage === 'onboard' && record.result === 'passed').length
  await audit(
    ctx,
    'close_cycle',
    `本届「${notice.cycle.name || '未命名'}」关闭：共 ${rows.length} 人报名、${members} 人转正；存档 ${archiveUrl}`,
  )

  return buildResult('close_cycle', state, rows.length, EMPTY_MAIL, {
    url: archiveUrl,
    total: rows.length,
    members,
  })
}
