/**
 * 招新报名的**后台明细接口**（全部需要管理员会话）。
 *
 *   GET    /api/admin/applications              列表（阶段 / 结果 / 关键词筛选 + 分页）
 *   GET    /api/admin/applications/:id          单条详情（含该同学的发信记录）
 *   PUT    /api/admin/applications/:id          改状态 / 记成绩 / 勾签到 / 补发某封信
 *   POST   /api/admin/applications/bulk         批量：签到、标记未参加、退出报名
 *   POST   /api/admin/applications/notify       批量通知信（自定义主题与正文）
 *   GET    /api/admin/applications/:id/file     下载报名表（唯一能拿到该文件的入口）
 *   DELETE /api/admin/applications/:id          删除记录（连带清理报名表与发信日志）
 *
 * 状态只有两列（stage + result），所以校验也很直接：
 *   1. result 必须是该 stage 允许的取值（STAGE_RESULTS）；
 *   2. 跨阶段只能相邻一步（canMoveStage），允许退回一步改判。
 * 整批人的晋级与录取走 `/api/admin/recruit/actions`（勾选名单后执行），
 * 那里会把名单、邮件与整届状态一次性处理完；这里的单条改动主要用于改判与补漏。
 */

import { formatLimit } from '../../shared/resources'
import {
  applicationLabel,
  APPLICATION_DOC_LIMIT,
  APPLICATION_DOC_SCOPE,
  applicationDocFileName,
  APPLICATION_EMAIL_PATTERN,
  APPLICATION_PHONE_PATTERN,
  APPLICATION_QQ_PATTERN,
  canMoveStage,
  isMaterialStatus,
  isRecruitResult,
  isRecruitStage,
  isValidStageResult,
  MATERIAL_REASON_MAX,
  MATERIAL_STATUS_LABELS,
  renderTemplate,
  RECRUIT_STAGE_LABELS,
  RECRUIT_STATE_LABELS,
  type CheckinStage,
  type MaterialStatus,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
} from '../../shared/recruit'
import {
  CHECKIN_COLUMN,
  createApplication,
  deleteApplication,
  getApplication,
  getApplicationByStudentId,
  listApplications,
  listMailLogs,
  updateApplication,
  updateApplications,
  writeMailLog,
  type ApplicationPatch,
  type ApplicationRecord,
} from '../lib/applications'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { isMailConfigured, sendMail } from '../lib/mailer'
import { getRecruitSettings } from '../lib/recruit-config'
import {
  buildNoticeVars,
  isApplicationNoticeKind,
  sendApplicationNotice,
  summarizeMailResults,
  type NoticeContext,
  type SendNoticeResult,
} from '../lib/recruit-mail'
import { getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { deleteStoredFile, getStorage, resolveFileRef, storageReady } from '../lib/storage'
import { buildObjectKey, sniffDocument } from '../lib/uploads'
import { resolveRuntimeConfig } from './config'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

async function noticeContext(ctx: RequestContext): Promise<NoticeContext> {
  const [settings, studio] = await Promise.all([getRecruitSettings(ctx.env), getSiteConfig(ctx.env)])
  return {
    studio,
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.url.origin,
  }
}

/** 后台视图：补上派生标签，省得前端再算一遍 */
export interface AdminApplicationView extends ApplicationRecord {
  inviteUrl: string
  stageLabel: string
  resultLabel: string
  statusLabel: string
}

function toAdminView(record: ApplicationRecord, origin: string): AdminApplicationView {
  return {
    ...record,
    inviteUrl: record.inviteToken ? `${origin.replace(/\/+$/, '')}/invite/${record.inviteToken}` : '',
    stageLabel: RECRUIT_STAGE_LABELS[record.stage],
    resultLabel: record.result === '' ? '待定' : record.result,
    statusLabel: applicationLabel(record.stage, record.result),
  }
}

// ===== 列表 / 详情 =====

export async function listApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const stageParam = (ctx.url.searchParams.get('stage') ?? '').trim()
  const stages = stageParam
    ? (stageParam.split(',').filter((value) => isRecruitStage(value)) as RecruitStage[])
    : undefined

  const resultParam = ctx.url.searchParams.get('result')
  const results =
    resultParam === null
      ? undefined
      : (resultParam.split(',').filter((value) => isRecruitResult(value)) as RecruitResult[])

  const result = await listApplications(ctx.env, {
    stages,
    results,
    search: ctx.url.searchParams.get('q') ?? undefined,
    limit: Number(ctx.url.searchParams.get('limit') ?? 500),
    offset: Number(ctx.url.searchParams.get('offset') ?? 0),
  })

  return ok({
    items: result.items.map((item) => toAdminView(item, ctx.url.origin)),
    total: result.total,
  })
}

export async function getApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const logs = await listMailLogs(ctx.env, { applicationId: record.id, limit: 50 })
  return ok({ application: toAdminView(record, ctx.url.origin), mails: logs })
}

// ===== 单条更新 =====

interface UpdateApplicationBody {
  stage?: string
  result?: string
  /** 勾选 / 取消签到；取消时传 value: false */
  checkin?: { stage?: string; value?: boolean }
  writtenScore?: string
  interviewScore?: string
  defenseScore?: string
  writtenNote?: string
  interviewNote?: string
  defenseNote?: string
  note?: string
  /** 补发某封信（状态不变也能发） */
  notice?: string
  /** 「改全部资料」：姓名 / 学号 / 联系方式都能改（学号要过唯一性） */
  name?: string
  studentId?: string
  email?: string
  phone?: string
  qq?: string
  /** 材料审核：approved 通过 / rejected 驳回 / '' 退回待审核 */
  material?: string
  /** 驳回理由：**必填**（会写进给同学的邮件，就是让他照着改的） */
  materialReason?: string
}

/**
 * 材料审核的公共前置：只在报名阶段与「待确认笔试名单」期间可用。
 *
 * 审核的意义就是决定谁能进笔试 —— 笔试都开考了再来改审核状态只会让人困惑。
 */
async function materialReviewGate(ctx: RequestContext): Promise<Response | null> {
  const { cycle } = await getRecruitSettings(ctx.env)
  if (cycle.state === 'apply' || cycle.state === 'apply_review') return null
  return fail(
    409,
    'STAGE_NOT_APPLICABLE',
    `当前是「${RECRUIT_STATE_LABELS[cycle.state]}」，材料审核只在报名阶段与「待确认笔试名单」期间可用`,
  )
}

/** 驳回理由的公共校验（单人与批量共用同一套话术） */
function validateRejectReason(raw: unknown): { reason: string } | Response {
  const reason = String(raw ?? '').trim()
  if (!reason) {
    return fail(400, 'REASON_REQUIRED', '驳回要写清理由 —— 这封邮件就是让同学照着改的')
  }
  if (reason.length > MATERIAL_REASON_MAX) {
    return fail(400, 'VALIDATION_FAILED', `驳回理由请控制在 ${MATERIAL_REASON_MAX} 字以内`)
  }
  return { reason }
}

export async function updateApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const body = await readJsonBody<UpdateApplicationBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const nowIso = new Date().toISOString()
  const patch: ApplicationPatch = {}

  // ---- 文字字段 ----
  for (const key of [
    'writtenScore',
    'interviewScore',
    'defenseScore',
    'writtenNote',
    'interviewNote',
    'defenseNote',
    'note',
    'email',
    'phone',
    'qq',
  ] as const) {
    if (body[key] !== undefined) patch[key] = String(body[key] ?? '').trim()
  }

  // ---- 身份：姓名可改，学号可改但要过唯一性 ----
  // 补录时听错学号、或本人改名都常见；官网报的人也可能要更正。
  if (body.name !== undefined) {
    const name = String(body.name).trim()
    if (!name) return fail(400, 'VALIDATION_FAILED', '姓名不能为空')
    patch.name = name
  }

  if (body.studentId !== undefined) {
    const studentId = String(body.studentId).trim()
    if (!studentId) return fail(400, 'VALIDATION_FAILED', '学号不能为空')
    if (studentId !== record.studentId) {
      const occupied = await getApplicationByStudentId(ctx.env, studentId)
      if (occupied && occupied.id !== record.id) {
        return fail(409, 'ALREADY_EXISTS', `学号 ${studentId} 已经在名单里（${occupied.name}），不能重复`)
      }
      patch.studentId = studentId
    }
  }

  // ---- 状态：stage + result ----
  const nextStageRaw = (body.stage ?? '').trim()
  const nextResultRaw = body.result
  let nextStage: RecruitStage = record.stage
  let nextResult: RecruitResult = record.result

  if (nextStageRaw && nextStageRaw !== record.stage) {
    if (!isRecruitStage(nextStageRaw)) return fail(400, 'INVALID_STAGE', `未知的阶段：${nextStageRaw}`)
    if (!canMoveStage(record.stage, nextStageRaw)) {
      return fail(
        409,
        'INVALID_TRANSITION',
        `只能推进到相邻阶段：当前「${RECRUIT_STAGE_LABELS[record.stage]}」。如需跳阶段，请逐步操作。`,
      )
    }
    nextStage = nextStageRaw
  }

  if (nextResultRaw !== undefined && nextResultRaw !== record.result) {
    if (!isRecruitResult(nextResultRaw)) {
      return fail(400, 'INVALID_RESULT', `未知的结果：${nextResultRaw}`)
    }
    nextResult = nextResultRaw
  }

  const statusChanged = nextStage !== record.stage || nextResult !== record.result
  if (statusChanged) {
    // 跨阶段迁移时，结果回到「尚无结论」是默认行为；显式传了就按传的来
    if (nextStage !== record.stage && nextResultRaw === undefined) nextResult = ''
    if (!isValidStageResult(nextStage, nextResult)) {
      return fail(
        400,
        'INVALID_STAGE_RESULT',
        `「${RECRUIT_STAGE_LABELS[nextStage]}」阶段不支持「${nextResult === '' ? '待定' : nextResult}」这个结果`,
      )
    }
    patch.stage = nextStage
    patch.result = nextResult
    patch.stageChangedAt = nowIso
  }

  // ---- 签到 ----
  const checkinStage = (body.checkin?.stage ?? '').trim()
  if (checkinStage) {
    const column = CHECKIN_COLUMN[checkinStage as CheckinStage]
    if (!column) return fail(400, 'INVALID_STAGE', `未知的签到阶段：${checkinStage}`)
    const on = body.checkin?.value !== false
    patch[column] = on ? nowIso : ''
    // 补勾签到：结果推进到「已参加」；被标过「缺考」的一并撤销 ——
    // 人确实来过就不该因为漏签被刷掉（后台按钮上写的就是「补签（撤销缺考）」）。
    if (on && patch.result === undefined && (record.result === '' || record.result === 'absent')) {
      patch.result = 'attended'
      patch.stageChangedAt = nowIso
    }
  }

  // ---- 材料审核（报名阶段后台逐个通过 / 驳回） ----
  //
  // 用 `!== undefined` 判断「这次请求是否在改审核状态」：
  // 空串是**合法取值**（退回待审核），不能当成「没传」。
  const materialRaw = String(body.material ?? '').trim()
  let rejectReason = ''
  if (body.material !== undefined) {
    if (!isMaterialStatus(materialRaw)) {
      return fail(400, 'INVALID_MATERIAL_STATUS', `未知的审核状态：${materialRaw}`)
    }
    const gate = await materialReviewGate(ctx)
    if (gate) return gate
    if (materialRaw === 'rejected') {
      const checked = validateRejectReason(body.materialReason)
      if (checked instanceof Response) return checked
      rejectReason = checked.reason
    }
    patch.materialStatus = materialRaw
    // 通过时顺手清掉上一次的驳回理由，免得名单里留着一句对不上的旧话
    patch.materialReason = materialRaw === 'rejected' ? rejectReason : ''
    patch.materialReviewedAt = nowIso
  }

  // ---- 格式校验：联系方式的格式任何时候都不该垮掉；留空仍然允许（信息可以后补） ----
  if (patch.email && !APPLICATION_EMAIL_PATTERN.test(patch.email)) {
    return fail(400, 'VALIDATION_FAILED', '邮箱格式不正确')
  }
  if (patch.phone && !APPLICATION_PHONE_PATTERN.test(patch.phone)) {
    return fail(400, 'VALIDATION_FAILED', '手机号应为 11 位数字')
  }
  if (patch.qq && !APPLICATION_QQ_PATTERN.test(patch.qq)) {
    return fail(400, 'VALIDATION_FAILED', 'QQ 号应为 5–12 位数字')
  }

  // 改了姓名 / 学号就把报名表的**下载名**一起改掉：那份文件叫「姓名+学号+报名表」，
  // 否则会出现「资料里是张三、下载下来写着李四」。
  const nextName = patch.name ?? record.name
  const nextStudentId = patch.studentId ?? record.studentId
  if (record.fileUrl && (nextName !== record.name || nextStudentId !== record.studentId)) {
    const ext = record.fileName.split('.').pop()?.toLowerCase() || 'pdf'
    patch.fileName = applicationDocFileName(nextName, nextStudentId, ext)
  }

  let updated: ApplicationRecord | null
  try {
    updated = await updateApplication(ctx.env, record.id, patch)
  } catch (error) {
    // student_id 上有唯一约束：万一上面检查过之后被人抢先占了，这里兜住并给出人话
    if (patch.studentId && (await getApplicationByStudentId(ctx.env, patch.studentId))) {
      return fail(409, 'ALREADY_EXISTS', `学号 ${patch.studentId} 已经在名单里了`)
    }
    console.error('[applications] 更新失败', { id: record.id, error })
    return fail(500, 'UPDATE_FAILED', '保存失败，请稍后重试')
  }
  if (!updated) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // ---- 邮件 ----
  let mail = null as Awaited<ReturnType<typeof sendApplicationNotice>> | null
  const materialChanged = patch.materialStatus !== undefined

  // 驳回**自动**发信：理由都填好了，再让管理员去点一次「补发」纯属多余。
  // 通过则不发（他没做错什么，不必打扰）—— 这与「缺考不发信」是同一条取向。
  if (updated.materialStatus === 'rejected' && rejectReason) {
    const runtime = await resolveRuntimeConfig(ctx)
    mail = await sendApplicationNotice(
      ctx.env,
      runtime.mail,
      updated,
      'material_rejected',
      await noticeContext(ctx),
      actorOf(ctx),
    )
  }

  const noticeRaw = (body.notice ?? '').trim()
  if (noticeRaw && isApplicationNoticeKind(noticeRaw)) {
    const runtime = await resolveRuntimeConfig(ctx)
    mail = await sendApplicationNotice(
      ctx.env,
      runtime.mail,
      updated,
      noticeRaw as RecruitMailKind,
      await noticeContext(ctx),
      actorOf(ctx),
    )
  }

  // 「改了资料」值得单独记一笔：它是不走状态流转的一类改动，审计里要能一眼认出
  const profileChanged = [patch.name, patch.studentId, patch.email, patch.phone, patch.qq].some(
    (value) => value !== undefined,
  )

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: statusChanged
      ? 'advance_application'
      : materialChanged
        ? 'review_material'
        : profileChanged
          ? 'update_profile'
          : 'update_application',
    resource: 'applications',
    targetId: record.id,
    detail: [
      `${record.name}(${record.studentId})`,
      statusChanged
        ? `${applicationLabel(record.stage, record.result)} → ${applicationLabel(nextStage, nextResult)}`
        : materialChanged
          ? `材料审核 → ${MATERIAL_STATUS_LABELS[updated.materialStatus]}`
          : '字段更新',
      rejectReason ? `理由：${rejectReason}` : '',
      profileChanged && `${updated.name}(${updated.studentId}) 资料已改`,
      mail ? `mail=${mail.code}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(updated, ctx.url.origin), mail })
}

// ===== 手动补录考生 =====

interface CreateApplicationBody {
  name?: string
  studentId?: string
  email?: string
  phone?: string
  qq?: string
  /** apply = 补录进报名阶段（默认）；written = 笔试现场补录，录入即视为已参加笔试 */
  stage?: string
}

/**
 * 手动补录考生：**没有在官网报名、但现场来考的人**。
 *
 * 两种情形共用一个入口，靠 `stage` 区分：
 *   - 报名阶段的补录（默认）：人已经在现场了，不要求报名表、联系方式全部可选；
 *   - 笔试现场补录（stage=written）：**邮箱 / 手机 / QQ 必填**（后面发通知全靠它），
 *     **报名表可以先空着** —— 现场常常真拿不到，之后在「名单 → 改全部资料」里补上/替换即可；
 *     录入即视为已参加笔试（直接写好签到时间），不会被「结束笔试」的缺考扫描误伤。
 *
 * 共同点：`source = 'manual'`，名单里带「补录」标记，一眼能和官网报名区分开。
 * 请求体既可以是 JSON（无附件），也可以是 multipart（带报名表，字段同上 + file）。
 */
export async function createApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const contentType = ctx.request.headers.get('content-type') ?? ''
  const multipart = contentType.includes('multipart/form-data')

  let body: CreateApplicationBody = {}
  let file: File | null = null

  if (multipart) {
    let form: FormData
    try {
      form = await ctx.request.formData()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return fail(400, 'INVALID_BODY', `请求必须是 multipart/form-data 表单：${reason}`)
    }
    body = {
      name: String(form.get('name') ?? ''),
      studentId: String(form.get('studentId') ?? ''),
      email: String(form.get('email') ?? ''),
      phone: String(form.get('phone') ?? ''),
      qq: String(form.get('qq') ?? ''),
      stage: String(form.get('stage') ?? ''),
    }
    const candidate = form.get('file')
    if (candidate instanceof File && candidate.size > 0) file = candidate
  } else {
    const parsed = await readJsonBody<CreateApplicationBody>(ctx.request)
    if (!parsed) return fail(400, 'INVALID_BODY', '请求体必须是 JSON 或 multipart 表单')
    body = parsed
  }

  const name = String(body.name ?? '').trim()
  const studentId = String(body.studentId ?? '').trim()
  if (!name) return fail(400, 'VALIDATION_FAILED', '请填写姓名')
  if (!studentId) return fail(400, 'VALIDATION_FAILED', '请填写学号')

  const email = String(body.email ?? '').trim()
  const phone = String(body.phone ?? '').trim()
  const qq = String(body.qq ?? '').trim()
  const walkIn = String(body.stage ?? '').trim() === 'written'

  // 报名阶段的补录只校验「填了的」字段；笔试现场补录要求三样都齐（否则后面根本联系不上人）
  if (walkIn && (!email || !phone || !qq)) {
    return fail(400, 'VALIDATION_FAILED', '笔试现场补录需要邮箱、手机、QQ 都填上（后面发通知要用）')
  }
  // 报名表刻意**不**必填：现场往往真拿不到，之后在「名单 → 改全部资料」里补就行
  if (email && !APPLICATION_EMAIL_PATTERN.test(email)) {
    return fail(400, 'VALIDATION_FAILED', '邮箱格式不正确')
  }
  if (phone && !APPLICATION_PHONE_PATTERN.test(phone)) {
    return fail(400, 'VALIDATION_FAILED', '手机号应为 11 位数字')
  }
  if (qq && !APPLICATION_QQ_PATTERN.test(qq)) {
    return fail(400, 'VALIDATION_FAILED', 'QQ 号应为 5–12 位数字')
  }

  // 报名表（可选，但带着就必须是真文件）：与官网报名同一套校验与存桶规则
  let doc = { fileUrl: '', fileName: '', fileSize: 0 }
  let uploadedKey = ''
  if (file) {
    if (file.size > APPLICATION_DOC_LIMIT) {
      return fail(413, 'TOO_LARGE', `报名表不能超过 ${formatLimit(APPLICATION_DOC_LIMIT)}`)
    }
    if (!/\.(pdf|docx)$/i.test(file.name || '')) {
      return fail(415, 'UNSUPPORTED_TYPE', '仅支持 .pdf 或 .docx 文件')
    }
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
    const kind = sniffDocument(head, file.name)
    if (!kind) {
      return fail(415, 'UNSUPPORTED_TYPE', '文件校验失败：仅支持 PDF / DOCX 格式的真实文件，仅改后缀无效')
    }
    if (!(await storageReady(ctx.env, 'applications'))) {
      return fail(503, 'STORAGE_UNAVAILABLE', '对象存储未接通，暂时无法保存报名表')
    }
    const storage = await getStorage(ctx.env, 'applications')
    uploadedKey = buildObjectKey(APPLICATION_DOC_SCOPE, file.name || 'application', kind.ext)
    await storage.put(uploadedKey, file, { contentType: kind.mime })
    doc = {
      fileUrl: storage.objectUrl(uploadedKey),
      fileName: applicationDocFileName(name, studentId, kind.ext),
      fileSize: file.size,
    }
  }

  let created
  try {
    created = await createApplication(ctx.env, {
      studentId,
      name,
      email,
      phone,
      qq,
      ...doc,
      source: 'manual',
    })

    if (walkIn) {
      const now = new Date().toISOString()
      // 录入即视为已参加：写好签到时间，结束笔试时不会被判缺考
      const updated = await updateApplication(ctx.env, created.id, {
        stage: 'written',
        result: 'attended',
        writtenCheckinAt: now,
        stageChangedAt: now,
      })
      if (updated) created = updated
    }
  } catch (error) {
    // 落库失败就把刚传上去的报名表删掉，别在桶里留孤儿对象
    if (uploadedKey) await deleteStoredFile(ctx.env, doc.fileUrl || uploadedKey).catch(() => {})
    // student_id 有唯一约束，撞上就是这位同学已经存在（官网报过或已被补录过）
    if (await getApplicationByStudentId(ctx.env, studentId)) {
      return fail(409, 'ALREADY_EXISTS', '这个学号已经在名单里了，无需重复补录')
    }
    console.error('[applications] 补录失败', { studentId, walkIn, error })
    return fail(500, 'CREATE_FAILED', '补录失败，请稍后重试')
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'create',
    resource: 'applications',
    targetId: created.id,
    detail: `${walkIn ? '笔试现场补录' : '补录考生'} ${name}（${studentId}）${doc.fileName ? ` 报名表 ${doc.fileName}` : ''}`,
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(created, ctx.url.origin) }, { status: 201 })
}

// ===== 批量操作 =====

interface BulkBody {
  ids?: string[]
  /** checkin 勾签到 / absent 标记未参加 / withdraw 退出报名 / approve_material 通过材料 / reject_material 驳回材料 */
  action?: string
  /** checkin 需要指定阶段 */
  stage?: string
  /** reject_material 需要理由（会写进每个人的驳回邮件） */
  materialReason?: string
}

export async function bulkApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<BulkBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const ids = (body.ids ?? []).map((id) => String(id).trim()).filter(Boolean)
  if (ids.length === 0) return fail(400, 'NO_SELECTION', '请先勾选要处理的同学')

  const action = (body.action ?? '').trim()
  const nowIso = new Date().toISOString()
  const updates: Array<{ id: string } & ApplicationPatch> = []

  switch (action) {
    case 'checkin': {
      const stage = (body.stage ?? '').trim() as CheckinStage
      const column = CHECKIN_COLUMN[stage]
      if (!column) return fail(400, 'INVALID_STAGE', '批量签到需要指定阶段')
      for (const id of ids) {
        const record = await getApplication(ctx.env, id)
        if (!record) continue
        const patch: { id: string } & ApplicationPatch = { id, [column]: nowIso }
        // 与单人补签同一条规则：待定的记为已参加，已经判过「缺考」的撤销
        if (record.result === '' || record.result === 'absent') {
          patch.result = 'attended'
          patch.stageChangedAt = nowIso
        }
        updates.push(patch)
      }
      break
    }
    case 'absent':
    case 'withdraw': {
      const result: RecruitResult = action === 'absent' ? 'absent' : 'withdrawn'
      for (const id of ids) {
        const record = await getApplication(ctx.env, id)
        if (!record) continue
        if (!isValidStageResult(record.stage, result)) continue
        updates.push({ id, result, stageChangedAt: nowIso })
      }
      break
    }
    case 'approve_material':
    case 'reject_material': {
      const gate = await materialReviewGate(ctx)
      if (gate) return gate
      const status: MaterialStatus = action === 'approve_material' ? 'approved' : 'rejected'
      let reason = ''
      if (status === 'rejected') {
        const checked = validateRejectReason(body.materialReason)
        if (checked instanceof Response) return checked
        reason = checked.reason
      }
      for (const id of ids) {
        updates.push({
          id,
          materialStatus: status,
          materialReason: status === 'rejected' ? reason : '',
          materialReviewedAt: nowIso,
        })
      }
      break
    }
    default:
      return fail(400, 'INVALID_ACTION', `未知的批量操作：${action}`)
  }

  const moved = await updateApplications(ctx.env, updates)

  // 批量驳回要**逐人**发信：理由相同，但每个人收到的是一封写着自己名字的信。
  // 批量通过则不发（与单人一致：通过不打扰）。
  let mail: { sent: number; failed: number; summary: string } | null = null
  if (action === 'reject_material' && updates.length > 0) {
    const [runtime, context] = await Promise.all([resolveRuntimeConfig(ctx), noticeContext(ctx)])
    const sends: SendNoticeResult[] = []
    for (const update of updates) {
      const record = await getApplication(ctx.env, update.id)
      if (record) {
        sends.push(
          await sendApplicationNotice(ctx.env, runtime.mail, record, 'material_rejected', context, actorOf(ctx)),
        )
      }
    }
    mail = {
      sent: sends.filter((item) => item.sent).length,
      failed: sends.filter((item) => !item.sent).length,
      summary: summarizeMailResults(sends),
    }
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: `bulk_${action}`,
    resource: 'applications',
    targetId: action,
    detail: [
      `勾选 ${ids.length} 条，实际改动 ${moved} 条`,
      action === 'reject_material' ? `驳回理由：${(body.materialReason ?? '').trim()}` : '',
      mail ? mail.summary : '',
    ]
      .filter(Boolean)
      .join(' · '),
    ...requestMeta(ctx),
  })

  return ok({ moved, mail })
}

// ===== 批量通知信 =====

interface NotifyBody {
  ids?: string[]
  subject?: string
  body?: string
}

/**
 * 给勾选的同学群发一封自定义邮件（如「面试地点改了」）。
 * 主题与正文同样支持 `{变量}`，渲染规则与系统通知一致。
 */
export async function notifyApplicationsAdmin(ctx: RequestContext): Promise<Response> {
  const payload = await readJsonBody<NotifyBody>(ctx.request)
  if (!payload) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const ids = (payload.ids ?? []).map((id) => String(id).trim()).filter(Boolean)
  if (ids.length === 0) return fail(400, 'NO_SELECTION', '请先勾选要通知的同学')

  const subject = (payload.subject ?? '').trim()
  const text = (payload.body ?? '').trim()
  if (!subject) return fail(400, 'VALIDATION_FAILED', '请填写邮件主题')
  if (!text) return fail(400, 'VALIDATION_FAILED', '请填写邮件正文')

  const [settings, studio, runtime] = await Promise.all([
    getRecruitSettings(ctx.env),
    getSiteConfig(ctx.env),
    resolveRuntimeConfig(ctx),
  ])
  const context: NoticeContext = {
    studio,
    cycle: settings.cycle,
    templates: settings.templates,
    origin: ctx.url.origin,
  }

  const results: SendNoticeResult[] = []
  for (const id of ids) {
    const record = await getApplication(ctx.env, id)
    if (!record) continue

    // 自定义通知复用系统通知的变量与渲染规则，只是换了文案
    const to = record.email.trim()
    if (!to) {
      results.push({
        kind: 'written_invite',
        sent: false,
        code: 'NO_RECIPIENT',
        message: `${record.name} 没有邮箱，未发送`,
        to: '',
      })
      continue
    }

    const vars = buildNoticeVars(record, context)
    const built = {
      to,
      subject: renderTemplate(subject, vars).trim() || subject,
      text: renderTemplate(text, vars),
    }

    const outcome = isMailConfigured(ctx.env, runtime.mail)
      ? await sendMail(ctx.env, runtime.mail, {
          to: built.to,
          subject: built.subject,
          text: built.text,
          replyTo: studio.contactEmail.trim() || undefined,
        })
      : {
          ok: false as const,
          code: 'NOT_CONFIGURED' as const,
          message: '邮件通道未接通，本封信未发送',
        }

    const result: SendNoticeResult = {
      kind: 'written_invite',
      sent: outcome.ok,
      code: outcome.ok ? 'OK' : outcome.code,
      message: outcome.ok ? `已发送至 ${built.to}` : outcome.message,
      to: built.to,
    }
    results.push(result)

    // 自定义通知同样进发信日志，后台能看到「谁收到过什么」
    await writeMailLog(ctx.env, {
      applicationId: record.id,
      kind: 'custom',
      recipient: built.to,
      subject: built.subject,
      ok: result.sent,
      code: result.code,
      message: result.sent ? '自定义通知' : result.message,
      actor: actorOf(ctx),
    })
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'notify_applications',
    resource: 'applications',
    targetId: 'notify',
    detail: `群发「${subject}」给 ${ids.length} 人：${summarizeMailResults(results)}`,
    ...requestMeta(ctx),
  })

  return ok({ summary: summarizeMailResults(results), results })
}

// ===== 报名表：上传替换 / 下载 / 删除 =====

/**
 * 替换报名表（后台「改全部资料」的一部分）。
 *
 * 为什么需要它：补录时同学手头没带材料、或官网报的人后来换了版本 ——
 * 之前「报名时上传」是唯一入口，错过就再也补不上，名单里那份材料只能一直缺着。
 *
 * 与官网报名**同一套校验**（大小 / 后缀 / 文件头魔数），成功后删掉旧文件，
 * 下载名统一是「姓名+学号+报名表」（改了姓名也会跟着变，见 updateApplicationAdmin）。
 */
export async function uploadApplicationDocAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  let form: FormData
  try {
    form = await ctx.request.formData()
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return fail(400, 'INVALID_BODY', `请求必须是 multipart/form-data 表单：${reason}`)
  }

  let file = form.get('file')
  if (!(file instanceof File)) {
    // 与其它上传口同样的容错：个别客户端上传的文件片段不带 name
    for (const value of form.values()) {
      if (value instanceof File && value.size > 0) {
        file = value
        break
      }
    }
  }
  if (!(file instanceof File)) return fail(400, 'NO_FILE', '请上传报名表文件（PDF / DOCX）')
  if (file.size === 0) return fail(400, 'EMPTY_FILE', '报名表文件内容为空')
  if (file.size > APPLICATION_DOC_LIMIT) {
    return fail(413, 'TOO_LARGE', `报名表不能超过 ${formatLimit(APPLICATION_DOC_LIMIT)}`)
  }

  const filename = file.name || ''
  if (filename && !/\.(pdf|docx)$/i.test(filename)) {
    return fail(415, 'UNSUPPORTED_TYPE', '仅支持 .pdf 或 .docx 文件')
  }

  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const kind = sniffDocument(head, filename)
  if (!kind) {
    return fail(415, 'UNSUPPORTED_TYPE', '文件校验失败：仅支持 PDF / DOCX 格式的真实文件，仅改后缀无效')
  }
  if (!(await storageReady(ctx.env, 'applications'))) {
    return fail(503, 'STORAGE_UNAVAILABLE', '对象存储未接通，暂时无法保存报名表')
  }

  const storage = await getStorage(ctx.env, 'applications')
  const key = buildObjectKey(APPLICATION_DOC_SCOPE, filename || 'application', kind.ext)
  await storage.put(key, file, { contentType: kind.mime })

  let updated: ApplicationRecord | null
  try {
    updated = await updateApplication(ctx.env, record.id, {
      fileUrl: storage.objectUrl(key),
      fileName: applicationDocFileName(record.name, record.studentId, kind.ext),
      fileSize: file.size,
      // 后台换了一版材料同样要重新审核（旧结论是针对旧文件给的）
      materialStatus: '',
      materialReason: '',
      materialReviewedAt: '',
    })
  } catch (error) {
    // 落库失败就把刚传上去的删掉，别在桶里留孤儿对象
    await storage.delete(key).catch(() => {})
    console.error('[applications] 报名表替换失败', { id: record.id, error })
    return fail(500, 'UPDATE_FAILED', '报名表保存失败，请稍后重试')
  }
  if (!updated) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // **新文件落库成功之后**才删旧的：顺序反了的话，一次失败就把人家原来的材料弄丢了
  if (record.fileUrl) await deleteStoredFile(ctx.env, record.fileUrl)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'replace_application_doc',
    resource: 'applications',
    targetId: record.id,
    detail: `${updated.name}(${updated.studentId}) 报名表 → ${updated.fileName} ${(file.size / 1024).toFixed(1)}KB`,
    ...requestMeta(ctx),
  })

  return ok({ application: toAdminView(updated, ctx.url.origin) })
}

// ===== 下载 / 删除 =====

/** 报名表下载：这是唯一能取到 `applications/` 文件内容的接口（学生隐私不外泄） */
export async function downloadApplicationFile(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const ref = await resolveFileRef(ctx.env, record.fileUrl)
  if (!ref) return fail(404, 'FILE_MISSING', '该记录没有报名表文件')

  const storage = await getStorage(ctx.env, ref.purpose)
  const object = await storage.get(ref.key)
  if (!object) return fail(404, 'FILE_NOT_FOUND', '报名表文件已丢失')

  const fallbackName = record.fileName || ref.key.split('/').pop() || 'application'
  const headers = new Headers({
    'content-type': object.contentType ?? 'application/octet-stream',
    // 隐私材料，禁止任何中间缓存
    'cache-control': 'no-store',
    // 中文文件名必须走 RFC 5987 的 filename*，只给 filename 在部分浏览器会乱码
    'content-disposition': `attachment; filename="application"; filename*=UTF-8''${encodeURIComponent(
      fallbackName,
    )}`,
  })

  return new Response(object.body as unknown as BodyInit, { headers })
}

export async function deleteApplicationAdmin(ctx: RequestContext): Promise<Response> {
  const record = await getApplication(ctx.env, ctx.params.id)
  if (!record) return fail(404, 'NOT_FOUND', '报名记录不存在')

  const removed = await deleteApplication(ctx.env, record.id)
  if (!removed) return fail(404, 'NOT_FOUND', '报名记录不存在')

  // 顺手清掉存储桶里的报名表，避免留下含个人信息的孤儿文件
  await deleteStoredFile(ctx.env, record.fileUrl)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'delete',
    resource: 'applications',
    targetId: record.id,
    detail: `${record.name}(${record.studentId})`,
    ...requestMeta(ctx),
  })

  return ok({ id: record.id })
}


