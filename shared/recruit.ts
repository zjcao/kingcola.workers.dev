/**
 * 招新（报名）契约 —— 状态模型、周期状态机、邮件模板、动作表。
 *
 * 这是整个招新模块的**唯一事实源**：前台、后台、Worker 都引它。
 * 改规则只改这里，不会出现「后台显示通过、Worker 认为是未通过」这类分歧。
 *
 * ── 两条总原则 ───────────────────────────────────────────────
 * ① **没有任何时间字段**。整届的推进完全由管理员点按钮决定；
 *    考试的时间与地点通过对应的 QQ 群通知，邮件里不出现。
 * ② **没有「场次」概念**。同一阶段就一场（同学按群里的通知来），
 *    签到二维码只绑阶段：stage + 有效期 + 可作废。
 *
 * ── 状态模型 ───────────────────────────────────────────────
 * 两条线，都存字符串、中文标签一律派生（`applicationLabel()` / `RECRUIT_STATE_LABELS`）：
 *
 *   个人：`stage`（报名/笔试/面试/答辩/转正）+ `result`（待定/已参加/通过/未通过/未参加/…）
 *   整届：`state`（见 RecruitCycleState）—— 由 RECRUIT_ACTIONS 这张动作表驱动。
 *
 * 「笔试是否已安排」这种全局问题由整届 state 回答（written = 笔试进行中），
 * 不再往每个人身上存「已安排」。
 */

import { formatLimit } from './resources'
import type { Application } from './types'

// ============================================================================
// 一、阶段与结果（个人）
// ============================================================================

export type RecruitStage = 'apply' | 'written' | 'interview' | 'defense' | 'onboard'

export const RECRUIT_STAGES: readonly RecruitStage[] = [
  'apply',
  'written',
  'interview',
  'defense',
  'onboard',
]

export const RECRUIT_STAGE_LABELS: Record<RecruitStage, string> = {
  apply: '报名',
  written: '笔试',
  interview: '面试',
  defense: '答辩',
  onboard: '转正',
}

/** 阶段说明（后台页签提示） */
export const RECRUIT_STAGE_HINTS: Record<RecruitStage, string> = {
  apply: '已提交报名表、等待安排笔试的同学',
  written: '笔试环节：签到、补录、录入成绩、定面试名单',
  interview: '面试环节：签到、评语、确认录取',
  defense: '预备期 / 答辩：考核通过后转正',
  onboard: '已发邀请函，等待本人确认加入',
}

/**
 * 该阶段的结果。空串 '' 表示「尚无结论 / 正在进行」。
 * 刻意没有「已安排」——是否已安排是整届状态的事，不是每个人的状态。
 */
export type RecruitResult =
  | ''
  | 'attended'
  | 'passed'
  | 'failed'
  | 'absent'
  | 'declined'
  | 'withdrawn'

export const RECRUIT_RESULT_LABELS: Record<Exclude<RecruitResult, ''>, string> = {
  attended: '已参加',
  passed: '通过',
  failed: '未通过',
  absent: '未参加',
  declined: '婉拒',
  withdrawn: '退出',
}

/** 每个阶段允许出现的结果（校验用；withdrawn 任何阶段都可） */
export const STAGE_RESULTS: Record<RecruitStage, readonly RecruitResult[]> = {
  apply: ['', 'failed', 'withdrawn'],
  written: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  interview: ['', 'attended', 'passed', 'failed', 'absent', 'withdrawn'],
  defense: ['', 'passed', 'failed', 'withdrawn'],
  onboard: ['', 'passed', 'declined', 'withdrawn'],
}

export function isRecruitStage(value: string): value is RecruitStage {
  return (RECRUIT_STAGES as readonly string[]).includes(value)
}

export function isRecruitResult(value: string): value is RecruitResult {
  if (value === '') return true
  return Object.prototype.hasOwnProperty.call(RECRUIT_RESULT_LABELS, value)
}

export function isValidStageResult(stage: RecruitStage, result: RecruitResult): boolean {
  return STAGE_RESULTS[stage].includes(result)
}

// ============================================================================
// 二、派生标签（不入库）
// ============================================================================

/** 这个组合在流程里的性质，用于配色 */
export type RecruitTone = 'pending' | 'active' | 'passed' | 'failed' | 'done'

/** 阶段 + 结果 → 给同学看的中文（后台筛选按钮也用同一份） */
export function applicationLabel(stage: RecruitStage, result: RecruitResult): string {
  if (result === 'withdrawn') return '已退出报名'

  switch (stage) {
    case 'apply':
      return result === 'failed' ? '未通过初筛' : '已提交报名'
    case 'written':
      switch (result) {
        case 'attended':
          return '已参加笔试'
        case 'passed':
          return '笔试通过'
        case 'failed':
          return '笔试未通过'
        case 'absent':
          return '笔试未参加'
        default:
          return '待参加笔试'
      }
    case 'interview':
      switch (result) {
        case 'attended':
          return '已参加面试'
        case 'passed':
          return '面试通过'
        case 'failed':
          return '面试未通过'
        case 'absent':
          return '面试未参加'
        default:
          return '待参加面试'
      }
    case 'defense':
      switch (result) {
        case 'passed':
          return '答辩通过'
        case 'failed':
          return '答辩未通过'
        default:
          return '预备期中'
      }
    case 'onboard':
      switch (result) {
        case 'passed':
          return '正式成员'
        case 'declined':
          return '已婉拒邀请'
        default:
          return '已发邀请函'
      }
  }
}

export function applicationTone(stage: RecruitStage, result: RecruitResult): RecruitTone {
  if (result === 'withdrawn' || result === 'failed' || result === 'absent' || result === 'declined') {
    return 'failed'
  }
  if (stage === 'onboard' && result === 'passed') return 'done'
  if (result === 'passed') return 'passed'
  if (result === 'attended') return 'active'
  // 待定：报名阶段算「待处理」，后续阶段算「进行中」
  return stage === 'apply' ? 'pending' : 'active'
}

/** 流程是否已经结束（不会再往下走） */
export function isApplicationFinished(stage: RecruitStage, result: RecruitResult): boolean {
  if (result === 'withdrawn' || result === 'failed' || result === 'absent') return true
  if (stage === 'onboard') return result === 'passed' || result === 'declined'
  return false
}

/** 是否还在候选池里（漏斗与「待处理」计数用） */
export function isApplicationActive(application: Pick<Application, 'stage' | 'result'>): boolean {
  return !isApplicationFinished(application.stage, application.result)
}

/** 阶段序号（0 起），进度条用 */
export function stageIndex(stage: RecruitStage): number {
  return RECRUIT_STAGES.indexOf(stage)
}

// ============================================================================
// 三、流转规则
// ============================================================================

/**
 * 允许的跨阶段迁移：**只能一步一步走，也允许退回一步改判**。
 * 例如 `written → interview` 可以，`written → defense` 不行（那等于跳过面试）。
 */
export function canMoveStage(from: RecruitStage, to: RecruitStage): boolean {
  if (from === to) return false
  return Math.abs(stageIndex(from) - stageIndex(to)) === 1
}

/** 当前阶段可推进到的下一阶段 */
export function nextStageOf(stage: RecruitStage): RecruitStage | null {
  return RECRUIT_STAGES[stageIndex(stage) + 1] ?? null
}

/** 当前阶段可退回的上一阶段（改判用） */
export function prevStageOf(stage: RecruitStage): RecruitStage | null {
  return RECRUIT_STAGES[stageIndex(stage) - 1] ?? null
}

/** 退出报名：任何未结束的状态都能进 */
export function canWithdraw(stage: RecruitStage, result: RecruitResult): boolean {
  return !isApplicationFinished(stage, result)
}

// ============================================================================
// 四、报名表单与材料
// ============================================================================

/** 报名表（PDF / DOCX）体积上限 —— 前端提示与 Worker 校验共用 */
export const APPLICATION_DOC_LIMIT = 20 * 1024 * 1024

/** 报名表在存储桶里的逻辑前缀；同时决定它归属 applications 目标、且被当作私有文件（仅管理员可下载） */
export const APPLICATION_DOC_SCOPE = 'applications'

/** 关闭本届时导出的名单存档（同样落在 applications 前缀下 → 自动私有） */
export const RECRUIT_ARCHIVE_SCOPE = `${APPLICATION_DOC_SCOPE}/archives`

export const APPLICATION_DOC_ACCEPT = '.pdf,.docx'

/**
 * 报名表的「对外文件名」：姓名+学号+报名表。
 *
 * 同学上传时多半叫「个人简历.pdf」「报名表(1).pdf」，一堆重名根本分不出是谁，
 * 所以统一在入库时重命名 —— 管理员下载、归档拿到的那一份文件名就是他本人。
 *
 * 注意：这只是**下载时用的名字**（存 file_name），桶内对象 key 仍走
 * `buildObjectKey()` 的随机 ASCII 名 —— key 要保证唯一、便于长缓存，
 * 而中文 key 还会让 `/api/files/*` 的路径解析与百分号编码变得别扭。
 */
export function applicationDocFileName(name: string, studentId: string, ext: string): string {
  return `${name.trim()}+${studentId.trim()}+报名表.${ext}`
}

export const APPLICATION_DOC_HINT = `支持 PDF / DOCX，单个文件不超过 ${formatLimit(
  APPLICATION_DOC_LIMIT,
)}。仅修改后缀的文件无法通过校验。`

/** 11 位大陆手机号 */
export const APPLICATION_PHONE_PATTERN = /^1\d{10}$/

/** QQ 号：5–12 位数字 */
export const APPLICATION_QQ_PATTERN = /^\d{5,12}$/

/** 邮箱：宽松校验即可，真正的有效性靠发信验证 */
export const APPLICATION_EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface ApplicationFormInput {
  email: string
  phone: string
  qq: string
}

/** 校验报名表单；返回 null 表示通过。前台与 Worker 共用，避免两端规则跑偏。 */
export function validateApplicationForm(input: Partial<ApplicationFormInput>): string | null {
  const email = (input.email ?? '').trim()
  if (!email) return '请填写邮箱，后续的笔试 / 面试通知都会发到这里'
  if (!APPLICATION_EMAIL_PATTERN.test(email)) return '邮箱格式不正确'

  const phone = (input.phone ?? '').trim()
  if (!phone) return '请填写手机号，便于面试安排时联系你'
  if (!APPLICATION_PHONE_PATTERN.test(phone)) return '请填写正确的 11 位手机号'

  const qq = (input.qq ?? '').trim()
  if (!qq) return '请填写 QQ 号，我们会建立招新通知群'
  if (!APPLICATION_QQ_PATTERN.test(qq)) return 'QQ 号应为 5–12 位数字'

  return null
}

// ---- 材料审核（报名阶段后台逐个通过 / 驳回） ----

/**
 * 材料审核状态。只在报名阶段有意义 —— 它决定的就是「这个人能不能进笔试名单」。
 *
 * 空串 = **待审核**：任何新报名都是待审核，**同学重传材料后也会回到待审核**
 * （否则「改好了却还是被驳回」，而理由指向的那一版材料早就不在了）。
 */
export type MaterialStatus = '' | 'approved' | 'rejected'

export const MATERIAL_STATUSES: readonly MaterialStatus[] = ['', 'approved', 'rejected']

export const MATERIAL_STATUS_LABELS: Record<MaterialStatus, string> = {
  '': '待审核',
  approved: '材料已通过',
  rejected: '材料已驳回',
}

export function isMaterialStatus(value: string): value is MaterialStatus {
  return (MATERIAL_STATUSES as readonly string[]).includes(value)
}

/** 驳回理由长度上限：它会进邮件正文，太长会把信写得很怪 */
export const MATERIAL_REASON_MAX = 200

/**
 * 「确认笔试名单」的门禁：**只让审核通过的人进下一阶段**。
 *
 * 没有这道闸，审核就只是装饰 —— 后台辛苦看完一轮，勾选时照样能把被驳回的人送进笔试。
 * 被拦住时后台会明确报出是哪几个人没通过（见 `worker/lib/recruit-cycle.ts` 的 `promote()`）。
 */
export function isMaterialApproved(record: Pick<Application, 'materialStatus'>): boolean {
  return record.materialStatus === 'approved'
}

// ============================================================================
// 五、邀请函
// ============================================================================

/** 邀请函链接的兜底有效期（14 天；不用配置，够长也够安全） */
export const APPLICATION_INVITE_TTL_HOURS = 14 * 24

/** 邀请函过期时间（ISO 字符串） */
export function applicationInviteExpiry(
  from: Date = new Date(),
  hours = APPLICATION_INVITE_TTL_HOURS,
): string {
  return new Date(from.getTime() + hours * 3600 * 1000).toISOString()
}

/** 邀请函是否仍可用（已转正、已过期、状态不对都返回 false） */
export function isInviteUsable(
  expiresAt: string,
  stage: RecruitStage,
  result: RecruitResult,
): boolean {
  if (stage !== 'onboard' || result !== '') return false
  const expires = Date.parse(expiresAt)
  return Number.isFinite(expires) && expires > Date.now()
}

// ============================================================================
// 六、签到（二维码只绑阶段，带有效期、可作废）
// ============================================================================

export type CheckinStage = 'written' | 'interview' | 'defense'

export const CHECKIN_STAGES: readonly CheckinStage[] = ['written', 'interview', 'defense']

export const CHECKIN_STAGE_LABELS: Record<CheckinStage, string> = {
  written: '笔试',
  interview: '面试',
  defense: '答辩',
}

export function isCheckinStage(value: string): value is CheckinStage {
  return (CHECKIN_STAGES as readonly string[]).includes(value)
}

/**
 * 签到页路径。**必须带凭证**（`/checkin/<token>`），没有裸入口：
 * 签到页只从二维码进来，导航里不出现，直接访问裸路径按「找不到页面」处理。
 */
export const CHECKIN_PATH = '/checkin'

/** 签到二维码指向的地址；token 来自 recruit_checkin_tokens */
export function checkinTokenPath(token: string): string {
  return `${CHECKIN_PATH}/${encodeURIComponent(token)}`
}

/**
 * 签到二维码是否还能用。过期或已作废都不行 ——
 * 二维码会被拍照、会贴在考场墙上，所以「失效时间 + 一键作废」是必需的。
 */
export function isCheckinTokenUsable(
  expiresAt: string,
  revokedAt: string,
  now: Date = new Date(),
): boolean {
  if (revokedAt) return false
  const expires = Date.parse(expiresAt)
  // 没设失效时间的码视为长期有效（后台可以随时作废）；设了就必须还没到点
  if (!Number.isFinite(expires)) return true
  return expires > now.getTime()
}

/** 后台签发二维码时默认给多长的有效期 */
export const CHECKIN_TOKEN_TTL_HOURS = 12

/** 有效期的上下限（小时）：太短容易扫到时已过期，太长等于没设 */
export const CHECKIN_TOKEN_TTL_MIN_HOURS = 1
export const CHECKIN_TOKEN_TTL_MAX_HOURS = 24 * 14

export interface CheckinRequest {
  /** 同学自己填写的姓名与学号 —— 与报名记录一致才算签到成功 */
  name: string
  studentId: string
}

export function validateCheckin(input: Partial<CheckinRequest>): string | null {
  if (!(input.name ?? '').trim()) return '请填写姓名'
  if (!(input.studentId ?? '').trim()) return '请填写学号'
  return null
}

/** 姓名比对用的宽松归一化：忽略空格与大小写 */
export function normalizeName(value: string): string {
  return value.replace(/\s+/g, '').toLowerCase()
}

/**
 * 签到时这条记录能不能算「该阶段的参与者」。
 *
 * - `current`：正处在这个阶段 → 正常签到
 * - `ahead`：还没被推进到该阶段（例如报名后后台还没来得及确认名单就开考了）→ 也允许签到，
 *   签到本身会把他推进到该阶段。人在考场就不能因为后台没点按钮而签不上。
 * - `behind`：已经走到后面的阶段了（例如面试完了来扫笔试码）→ 拒绝，并提示他看自己的进度
 * - `closed`：流程已结束（淘汰 / 退出 / 已转正）→ 拒绝
 */
export type CheckinEligibility = 'current' | 'ahead' | 'behind' | 'closed'

export function checkinEligibility(
  recordStage: RecruitStage,
  recordResult: RecruitResult,
  stage: CheckinStage,
): CheckinEligibility {
  if (isApplicationFinished(recordStage, recordResult)) return 'closed'
  const recordIndex = stageIndex(recordStage)
  const targetIndex = stageIndex(stage)
  if (recordIndex === targetIndex) return 'current'
  if (recordIndex < targetIndex) return 'ahead'
  return 'behind'
}

// ============================================================================
// 七、整届状态机（没有任何时间参与，全靠管理员点按钮）
// ============================================================================

export type RecruitCycleState =
  /** 休眠：没有进行中的周期 */
  | 'dormant'
  /** 备招：周期已创建，报名尚未开启 */
  | 'prepare'
  /** 报名进行中 */
  | 'apply'
  /** 报名已结束，待确认笔试名单 */
  | 'apply_review'
  /** 笔试进行中（现场签到 / 补签 / 补录） */
  | 'written'
  /** 笔试已结束，待录成绩、定面试名单 */
  | 'written_review'
  | 'interview'
  | 'interview_review'
  | 'defense'
  | 'defense_review'
  /** 已发邀请函，等本人确认加入 */
  | 'onboard'

export const RECRUIT_CYCLE_STATES: readonly RecruitCycleState[] = [
  'dormant',
  'prepare',
  'apply',
  'apply_review',
  'written',
  'written_review',
  'interview',
  'interview_review',
  'defense',
  'defense_review',
  'onboard',
]

export const RECRUIT_STATE_LABELS: Record<RecruitCycleState, string> = {
  dormant: '休眠中',
  prepare: '备招',
  apply: '报名进行中',
  apply_review: '待确认笔试名单',
  written: '笔试进行中',
  written_review: '笔试已结束',
  interview: '面试进行中',
  interview_review: '面试已结束',
  defense: '答辩进行中',
  defense_review: '答辩已结束',
  onboard: '等待确认加入',
}

export function isRecruitCycleState(value: string): value is RecruitCycleState {
  return (RECRUIT_CYCLE_STATES as readonly string[]).includes(value)
}

/** 是否有进行中的周期（休眠之外都算） */
export function isCycleActive(state: RecruitCycleState): boolean {
  return state !== 'dormant'
}

/** 报名通道是否开放 */
export function isApplyOpen(state: RecruitCycleState): boolean {
  return state === 'apply'
}

/**
 * 前台「加入我们」页面的门禁：开放 / 还没开 / 已截止。
 * 三种情况的文案完全不同，所以由契约给出，避免前端各写一套判断。
 */
export type RecruitApplyGate = 'open' | 'not_open' | 'closed'

export function applyGate(state: RecruitCycleState): RecruitApplyGate {
  if (state === 'apply') return 'open'
  if (state === 'dormant' || state === 'prepare') return 'not_open'
  return 'closed'
}

/** 后台时间线上的节点（把 11 个状态归到 7 个节点） */
export type RecruitTimelineKey = 'prepare' | RecruitStage

export function cycleTimelineKey(state: RecruitCycleState): RecruitTimelineKey {
  switch (state) {
    case 'dormant':
    case 'prepare':
      return 'prepare'
    case 'apply':
    case 'apply_review':
      return 'apply'
    case 'written':
    case 'written_review':
      return 'written'
    case 'interview':
    case 'interview_review':
      return 'interview'
    case 'defense':
    case 'defense_review':
      return 'defense'
    case 'onboard':
      return 'onboard'
  }
}

/** 该状态对应的个人阶段（休眠返回 null） */
export function cycleStageOf(state: RecruitCycleState): RecruitStage | null {
  const key = cycleTimelineKey(state)
  return key === 'prepare' ? null : key
}

/** 是否处于「本阶段已结束、等收尾」 */
export function isReviewState(state: RecruitCycleState): boolean {
  return state.endsWith('_review')
}

/** 该状态下正在进行的考试阶段（决定后台显示哪张签到二维码卡片） */
export function checkinStageOf(state: RecruitCycleState): CheckinStage | null {
  if (state === 'written' || state === 'written_review') return 'written'
  if (state === 'interview' || state === 'interview_review') return 'interview'
  if (state === 'defense' || state === 'defense_review') return 'defense'
  return null
}

/**
 * 前台是否要显示招新相关的横幅 / 提示条。
 * 备招期不显示（还没开），休眠不显示，其余（报名中与流程中）都显示。
 */
export function isRecruitVisible(state: RecruitCycleState): boolean {
  return state !== 'dormant' && state !== 'prepare'
}

/** 给「加入我们」页面的一句话说明 */
export function recruitNotice(cycle: RecruitCycleConfig): string {
  switch (applyGate(cycle.state)) {
    case 'open':
      return `${cycle.name || '本届招新'}正在报名中，欢迎加入我们。`
    case 'not_open':
      return cycle.state === 'prepare'
        ? `${cycle.name || '本届招新'}即将开始报名，请留意后续通知。`
        : '本届招新尚未开始，请留意后续通知。'
    case 'closed':
      return '本届报名已截止。已报名的同学可登录查看自己的进度。'
  }
}

// ============================================================================
// 八、QQ 群（四个群各管一段，邮件里只给对应的那一个）
// ============================================================================

export type RecruitGroupKey = 'written' | 'interview' | 'probation' | 'formal'

export const RECRUIT_GROUP_LABELS: Record<RecruitGroupKey, string> = {
  written: '笔试通知群',
  interview: '面试通知群',
  probation: '预备成员群',
  formal: '正式成员群',
}

export interface RecruitQQGroups {
  written: string
  interview: string
  probation: string
  formal: string
}

export const DEFAULT_RECRUIT_GROUPS: RecruitQQGroups = {
  written: '',
  interview: '',
  probation: '',
  formal: '',
}

/** QQ 群号：5–12 位数字；留空允许（可以先建群后补，邮件里就是空的） */
export function validateQQGroup(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return null
  if (!APPLICATION_QQ_PATTERN.test(trimmed)) return 'QQ 群号应为 5–12 位数字'
  return null
}

/** 校验四个群号；返回第一条错误，全部通过返回 null */
export function validateQQGroups(groups: Partial<RecruitQQGroups>): string | null {
  for (const key of Object.keys(RECRUIT_GROUP_LABELS) as RecruitGroupKey[]) {
    const invalid = validateQQGroup(groups[key] ?? '')
    if (invalid) return `${RECRUIT_GROUP_LABELS[key]}${invalid.replace('QQ 群号', '')}`
  }
  return null
}

/**
 * 某个人此刻该进哪个群。报名阶段还没分群，转正之后进正式成员群。
 * 邮件模板变量与「我的报名进度」页都用它，避免两处各写一套映射。
 */
export function groupKeyOfStage(stage: RecruitStage): RecruitGroupKey {
  switch (stage) {
    case 'written':
      return 'written'
    case 'interview':
      return 'interview'
    case 'defense':
      // 预备期的事在预备成员群里说
      return 'probation'
    case 'onboard':
      return 'formal'
    default:
      return 'written'
  }
}

/** 报名阶段没有群可进（还没到笔试），返回 null */
export function groupKeyForRecord(stage: RecruitStage): RecruitGroupKey | null {
  return stage === 'apply' ? null : groupKeyOfStage(stage)
}

// ============================================================================
// 九、周期配置（单一全局周期，存 site_config['recruit'].cycle）
// ============================================================================

export interface RecruitCycleConfig {
  /** 本届名称，如「2026 年秋季招新」 */
  name: string
  /** 整届状态（唯一的状态来源，由 RECRUIT_ACTIONS 驱动） */
  state: RecruitCycleState
  /** 四个 QQ 群号：每封邀请函只给对应的那一个 */
  groups: RecruitQQGroups
  /** 本届创建时间（只用于界面显示，不参与任何判断） */
  startedAt: string
}

export const DEFAULT_RECRUIT_CYCLE: RecruitCycleConfig = {
  name: '',
  state: 'dormant',
  groups: { ...DEFAULT_RECRUIT_GROUPS },
  startedAt: '',
}

// ============================================================================
// 十、动作表（整届推进的全部入口）
// ============================================================================

export type RecruitAction =
  /** 启动系统：创建新周期，进入备招 */
  | 'start_cycle'
  /** 开启报名（前台出现报名入口） */
  | 'open_apply'
  /** 结束报名（不再收表 / 替换），名单仍可调整 */
  | 'end_apply'
  /**
   * 强制结束报名并清空数据：已收到的报名记录、报名表文件与发信日志全部删除，回到「备招」。
   * 用途是**推倒重来**（报名被刷屏、或本届配置搞错时，与其一条条删不如回到起点重新收）。
   */
  | 'reset_apply'
  /** 确认笔试名单：勾选的人进笔试并发邀请函，其余判未通过初筛（不发信） */
  | 'confirm_written'
  /** 结束笔试：未签到者自动标记缺考（不发信），解锁成绩录入 */
  | 'end_written'
  /** 生成面试名单：勾选的人进面试并发邀请函，其余发感谢信 */
  | 'advance_written'
  | 'end_interview'
  /** 确认录取：勾选的人进预备期并发面试通过通知，其余发感谢信 */
  | 'advance_interview'
  | 'end_defense'
  /** 确认最终名单：勾选的人转正并签发邀请函，其余发感谢信 */
  | 'advance_defense'
  /** 关闭本届：导出名单存档 → 清空报名数据与发信日志 → 回到休眠 */
  | 'close_cycle'

export const RECRUIT_ACTIONS: readonly RecruitAction[] = [
  'start_cycle',
  'open_apply',
  'end_apply',
  'reset_apply',
  'confirm_written',
  'end_written',
  'advance_written',
  'end_interview',
  'advance_interview',
  'end_defense',
  'advance_defense',
  'close_cycle',
]

export interface RecruitActionMeta {
  /** 按钮上的字 */
  label: string
  /** 只有处在这几个状态才能执行 */
  from: readonly RecruitCycleState[]
  /** 执行后整届进入的状态 */
  to: RecruitCycleState
  /** 需要先勾选名单（不勾选就点会被拦） */
  needsSelection: boolean
  /** 按钮旁的说明（写清代价与不发信这类规则） */
  description: string
}

/**
 * 状态机就在这张表里：**校验与推进都读它**，
 * 后台按钮的可见性、文案也读它，所以不可能出现「界面能点但后端拒绝」。
 */
export const RECRUIT_ACTION_META: Record<RecruitAction, RecruitActionMeta> = {
  start_cycle: {
    label: '启动系统，开始新的周期',
    from: ['dormant'],
    to: 'prepare',
    needsSelection: false,
    description: '创建本届并进入备招：先填名称与四个 QQ 群号，报名不会自动开启。',
  },
  open_apply: {
    label: '开启报名',
    from: ['prepare'],
    to: 'apply',
    needsSelection: false,
    description: '官网「加入我们」出现报名入口。什么时候开，完全由这次点击决定。',
  },
  end_apply: {
    label: '结束报名',
    from: ['apply'],
    to: 'apply_review',
    needsSelection: false,
    description: '报名入口关闭，不再收表与替换材料；名单仍可调整，确认名单后才发邀请函。不发信。',
  },
  reset_apply: {
    label: '强制结束报名并清空数据',
    // 报名进行中、或已经点了「结束报名」但发现那批表全是脏的，两种情况都允许清
    from: ['apply', 'apply_review'],
    to: 'prepare',
    needsSelection: false,
    description:
      '官网立刻停收表，并永久删除本届已收到的全部报名记录、报名表文件与发信日志；然后回到「备招」，可以重新「开启报名」从头收一批干净的表。不可撤销。',
  },
  confirm_written: {
    label: '确认名单并发出笔试邀请函',
    from: ['apply_review'],
    to: 'written',
    needsSelection: true,
    description: '勾选的人进入笔试并收到笔试邀请函；未勾选的判「未通过初筛」，不发信。',
  },
  end_written: {
    label: '结束笔试',
    from: ['written'],
    to: 'written_review',
    needsSelection: false,
    description: '未签到的同学自动标记「缺考」（不发信），随后解锁成绩录入与面试名单。',
  },
  advance_written: {
    label: '确认面试名单并发出通知',
    from: ['written_review'],
    to: 'interview',
    needsSelection: true,
    description: '勾选的人进入面试并收到面试邀请函；未勾选的判未通过并立即收到感谢信。',
  },
  end_interview: {
    label: '结束面试',
    from: ['interview'],
    to: 'interview_review',
    needsSelection: false,
    description: '未签到的同学自动标记「缺考」，随后解锁评语与录取确认。',
  },
  advance_interview: {
    label: '确认录取名单',
    from: ['interview_review'],
    to: 'defense',
    needsSelection: true,
    description: '勾选的人进入预备期并收到面试通过通知；未勾选的判未通过并立即收到感谢信。',
  },
  end_defense: {
    label: '结束答辩',
    from: ['defense'],
    to: 'defense_review',
    needsSelection: false,
    description: '未签到的同学自动标记「缺考」，随后解锁成绩与最终名单。',
  },
  advance_defense: {
    label: '确认答辩结果',
    from: ['defense_review'],
    to: 'onboard',
    needsSelection: true,
    description: '勾选的人转正并收到正式邀请函（一次性确认链接）；未勾选的判未通过并收到感谢信。',
  },
  close_cycle: {
    label: '关闭本届',
    from: [
      'prepare',
      'apply',
      'apply_review',
      'written',
      'written_review',
      'interview',
      'interview_review',
      'defense',
      'defense_review',
      'onboard',
    ],
    to: 'dormant',
    needsSelection: false,
    description:
      '导出本届完整名单 CSV 存档，然后清空报名数据、报名表文件与发信日志，回到休眠。不可撤销。',
  },
}

export function isRecruitAction(value: string): value is RecruitAction {
  return Object.prototype.hasOwnProperty.call(RECRUIT_ACTION_META, value)
}

/** 这个动作此刻能不能执行；能则返回 null，不能则返回原因（后台直接显示） */
export function actionBlockedReason(
  action: RecruitAction,
  state: RecruitCycleState,
  selected: number,
): string | null {
  const meta = RECRUIT_ACTION_META[action]
  if (!meta.from.includes(state)) {
    return `当前是「${RECRUIT_STATE_LABELS[state]}」，不能执行「${meta.label}」`
  }
  if (meta.needsSelection && selected <= 0) return '请先勾选名单'
  return null
}

// ============================================================================
// 十一、邮件模板
// ============================================================================

export type RecruitMailKind =
  /** 笔试邀请函 */
  | 'written_invite'
  /** 面试邀请函 */
  | 'interview_invite'
  /** 面试通过 · 进入预备期 */
  | 'interview_passed'
  /** 正式成员邀请函（含确认链接） */
  | 'offer'
  /** 感谢信 · 笔试未通过 */
  | 'thanks_written'
  /** 感谢信 · 面试未通过 */
  | 'thanks_interview'
  /** 感谢信 · 答辩未通过 */
  | 'thanks_defense'
  /** 材料驳回通知（含驳回理由，要求同学改好重传） */
  | 'material_rejected'
  /** 毕业去向征集（成员管理「批量毕业」时发给已毕业的同学） */
  | 'graduation_destination'

export const RECRUIT_MAIL_KINDS: readonly RecruitMailKind[] = [
  'written_invite',
  'interview_invite',
  'interview_passed',
  'offer',
  'thanks_written',
  'thanks_interview',
  'thanks_defense',
  'material_rejected',
  'graduation_destination',
]

/**
 * 「可以按**报名记录**补发」的模板：除「毕业去向征集」以外的全部。
 *
 * 那封信的收件人是**成员**而不是报名同学，出现在名单的「补发某封信」下拉里只会发错人 ——
 * 所以它照旧出现在模板管理页（用户明确要求先放招新里），但不进可补发清单。
 */
export const RECRUIT_APPLICATION_MAIL_KINDS: readonly RecruitMailKind[] = RECRUIT_MAIL_KINDS.filter(
  (kind) => kind !== 'graduation_destination',
)

export interface RecruitMailMeta {
  label: string
  /** 收到这封信的人处于什么状态 */
  audience: string
  /** 什么时候会发出 */
  trigger: string
}

export const RECRUIT_MAIL_META: Record<RecruitMailKind, RecruitMailMeta> = {
  written_invite: { label: '笔试邀请函', audience: '笔试名单中的同学', trigger: '确认笔试名单时发出' },
  interview_invite: { label: '面试邀请函', audience: '笔试通过的同学', trigger: '确认面试名单时发出' },
  interview_passed: { label: '面试通过通知', audience: '面试录取的同学', trigger: '确认录取名单时发出' },
  offer: {
    label: '正式成员邀请函',
    audience: '答辩通过的同学',
    trigger: '确认最终名单时发出，邮件内含一次性确认链接',
  },
  thanks_written: { label: '感谢信 · 笔试', audience: '笔试未通过的同学', trigger: '确认面试名单时发出' },
  thanks_interview: { label: '感谢信 · 面试', audience: '面试未录取的同学', trigger: '确认录取名单时发出' },
  thanks_defense: { label: '感谢信 · 答辩', audience: '答辩未通过的同学', trigger: '确认最终名单时发出' },
  material_rejected: {
    label: '材料驳回通知',
    audience: '材料没通过审核的同学',
    trigger: '后台在报名阶段点「驳回材料」时立即发出，正文含驳回理由',
  },
  graduation_destination: {
    label: '毕业去向征集',
    // 严格说这封信不属于招新，但模板管理页暂时还挂在招新里（用户计划之后整体迁出），
    // 所以这条模板先放这儿，发送时机是成员管理里的「批量毕业」。
    audience: '刚被标记为「已毕业」的成员',
    trigger: '在「团队成员 → 批量毕业」时勾选「同时发信」立即发出',
  },
}

export interface MailTemplate {
  subject: string
  body: string
  /** 关掉后这条信不会发出（状态照常流转） */
  enabled: boolean
}

export type RecruitTemplates = Record<RecruitMailKind, MailTemplate>

/**
 * 模板里可用的变量。
 * **没有任何时间与地点** —— 安排一律让同学看对应的 QQ 群，所以这里只给群号。
 */
export const RECRUIT_MAIL_VARIABLES: ReadonlyArray<{ token: string; desc: string }> = [
  { token: '{name}', desc: '同学姓名' },
  { token: '{studentId}', desc: '学号' },
  { token: '{cycleName}', desc: '本届招新名称' },
  { token: '{writtenGroup}', desc: '笔试通知 QQ 群号' },
  { token: '{interviewGroup}', desc: '面试通知 QQ 群号' },
  { token: '{probationGroup}', desc: '预备成员 QQ 群号' },
  { token: '{formalGroup}', desc: '正式成员 QQ 群号' },
  { token: '{inviteLink}', desc: '邀请函确认链接（仅正式邀请函有值）' },
  { token: '{destinationLink}', desc: '毕业去向填写页链接（仅「毕业去向征集」有值，提交后失效）' },
  { token: '{rejectReason}', desc: '材料驳回理由（仅材料驳回通知有值，管理员填写）' },
  { token: '{studio}', desc: '工作室名称' },
  { token: '{contactEmail}', desc: '工作室联系邮箱' },
  { token: '{contactAddress}', desc: '工作室地址' },
]

const SIGN_DEFAULT = '{studio}\n{contactEmail}'

export const DEFAULT_RECRUIT_TEMPLATES: RecruitTemplates = {
  written_invite: {
    enabled: true,
    subject: '【{studio}】笔试邀请 · {name}',
    body: [
      '{name} 同学：',
      '',
      '你好！感谢你报名 {cycleName}，你的报名表我们已经收到并通过初筛。',
      '现邀请你参加招新笔试。',
      '',
      '笔试的确切时间与地点会通过「笔试通知群」公布，请务必加群并留意群公告：',
      '{writtenGroup}',
      '',
      '加群请备注「姓名 + 学号」。如时间有冲突，直接在群里说一声即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  interview_invite: {
    enabled: true,
    subject: '【{studio}】面试邀请 · {name}',
    body: [
      '{name} 同学：',
      '',
      '恭喜你通过了笔试！接下来是与我们面对面的环节。',
      '',
      '面试的确切时间与地点会通过「面试通知群」公布，请加群并留意群公告：',
      '{interviewGroup}',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  interview_passed: {
    enabled: true,
    subject: '【{studio}】面试通过 · 欢迎进入预备期',
    body: [
      '{name} 同学：',
      '',
      '恭喜！你已通过面试，正式进入 {studio} 的预备期。',
      '',
      '后续安排（包括答辩时间）都会在「预备成员群」里通知，请加群：',
      '{probationGroup}',
      '',
      '预备期里你会加入一个真实项目小组，跟着学长学姐一起做东西。',
      '欢迎随时回复本邮件提问。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  offer: {
    enabled: true,
    subject: '【{studio}】正式邀请函 · 请确认加入',
    body: [
      '{name} 同学：',
      '',
      '恭喜！经过笔试、面试与答辩的考核，我们决定正式邀请你加入 {studio}。',
      '',
      '请点击下面的专属链接，填写你的成员信息并确认加入：',
      '{inviteLink}',
      '',
      '链接仅可使用一次；确认后你会立即出现在官网「团队成员」页面。',
      '正式成员的通知都在「正式成员群」，也请一并加入：',
      '{formalGroup}',
      '',
      '如果链接失效，或者你对加入还有疑问，直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_written: {
    enabled: true,
    subject: '【{studio}】感谢你参加本次笔试',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你报名 {cycleName}，并认真完成了这一轮笔试。',
      '',
      '很遗憾，本次笔试你没能进入下一轮。招新名额有限，这个结果并不代表对你的评价。',
      '我们后续的技术分享与公开活动依旧欢迎你参加，也欢迎下一轮招新再次报名。',
      '',
      '祝你学习顺利。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_interview: {
    enabled: true,
    subject: '【{studio}】感谢你参加本次面试',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你报名 {cycleName}，并抽出时间参加面试。',
      '',
      '很遗憾，本次面试你没能进入预备期。名额有限，这个结果并不代表对你的评价。',
      '欢迎关注我们后续的公开活动，也欢迎下一轮招新再次报名。',
      '',
      '祝你学习顺利。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  thanks_defense: {
    enabled: true,
    subject: '【{studio}】感谢你在预备期的付出',
    body: [
      '{name} 同学：',
      '',
      '你好。感谢你在 {studio} 预备期里的投入与付出。',
      '',
      '很遗憾，本次预备期答辩你没能通过。这个结果并不代表对你的评价，',
      '希望这段时间的项目经历对你之后的成长有所帮助。',
      '',
      '祝你学习顺利，也请继续与我们保持联系。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  material_rejected: {
    enabled: true,
    subject: '【{studio}】请修改你的报名材料 · {name}',
    body: [
      '{name} 同学：',
      '',
      '你好。我们已经收到你报名 {cycleName} 的材料，但这一版还没有通过审核：',
      '',
      '{rejectReason}',
      '',
      '请在报名通道关闭前回到官网「加入我们」页面，按上面的说明修改并重新上传材料。',
      '重新上传后我们会再看一遍，结果会另行通知你。',
      '',
      '如果对这条理由有疑问，直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },

  graduation_destination: {
    enabled: true,
    subject: '【{studio}】毕业去向登记 · {name}',
    body: [
      '{name} 同学：',
      '',
      '祝贺毕业！工作室想把你的毕业去向记进团队档案的「已毕业成员」一栏 ——',
      '既是给学弟学妹的参考，也方便以后联系你。',
      '',
      '点开下面这条链接填一句话就行（约 10 秒）：',
      '{destinationLink}',
      '',
      '例如：某互联网大厂 前端工程师 / 本校读研深造。',
      '暂时还没定也没关系，定了再回来填；链接提交一次就失效，要改直接回复本邮件即可。',
      '',
      SIGN_DEFAULT,
    ].join('\n'),
  },
}

const VARIABLE_PATTERN = /\{([a-zA-Z][a-zA-Z0-9]*)\}/g
const KNOWN_VARIABLES = new Set(RECRUIT_MAIL_VARIABLES.map((item) => item.token.slice(1, -1)))

/**
 * 这些变量**要等招新启用并配置好才有值**：本届名称与四个 QQ 群号。
 * 它们没值时不会被替换成空白 —— 规则见 `renderTemplate`。
 */
export const RECRUIT_CYCLE_VARIABLES: ReadonlySet<string> = new Set([
  'cycleName',
  'writtenGroup',
  'interviewGroup',
  'probationGroup',
  'formalGroup',
])

/**
 * 本届配置 → 模板变量名（worker 发信与后台预览**共用这一份**）。
 *
 * 为什么非得有它：本届配置里存的键是短名（`written` / `interview` / `probation` / `formal`），
 * 而模板里写的是 `{writtenGroup}` …，两者**对不上号**。
 * 直接 `...cycle.groups` 铺进变量表，会把明明配好的群号显示成「还没配置」——
 * 预览与变量清单都骗人，只有真发出去的信是对的（发信侧一直是显式映射）。
 * 收敛成一个函数之后，两边不可能再各写一套。
 */
export function cycleMailVars(cycle: RecruitCycleConfig): Record<string, string> {
  return {
    cycleName: cycle.name,
    writtenGroup: cycle.groups.written,
    interviewGroup: cycle.groups.interview,
    probationGroup: cycle.groups.probation,
    formalGroup: cycle.groups.formal,
  }
}

/**
 * 变量替换。三种情况刻意分开：
 *
 * 1. **未知变量**（多半是打错字）原样保留；
 * 2. **还没配置的招新变量**（本届名称、四个群号）也**原样保留** ——
 *    休眠期或刚启动还没填群号时，把它替换成空白，会让一封邀请函悄悄少掉最关键的那一行，
 *    而预览里也看不出到底哪里没配；留着 `{writtenGroup}` 原文，一眼就知道去「设置」补；
 * 3. 其余已知变量（工作室名称 / 联系邮箱 / 邀请链接等）没值就替换成空串 ——
 *    它们不是「没启用招新」，而是站点本来就没填，把 `{contactEmail}` 这种原文发出去更糟。
 */
export function renderTemplate(text: string, vars: Record<string, string>): string {
  return text.replace(VARIABLE_PATTERN, (whole, key: string) => {
    if (!KNOWN_VARIABLES.has(key)) return whole
    const value = vars[key]
    if (!value && RECRUIT_CYCLE_VARIABLES.has(key)) return whole
    return value ?? ''
  })
}

/** 模板里写了但系统不认识的变量，后台与接口都用来提示 */
export function unknownTemplateVariables(text: string): string[] {
  const found = new Set<string>()
  for (const match of text.matchAll(VARIABLE_PATTERN)) {
    if (!KNOWN_VARIABLES.has(match[1])) found.add(match[0])
  }
  return [...found]
}

// ============================================================================
// 十二、接口载荷（前后端共用，避免各写一份）
// ============================================================================

/** 公开招新状态（「加入我们」页面与首屏聚合都用它） */
export interface RecruitPublicStatus {
  state: RecruitCycleState
  stateLabel: string
  /** open = 可以提交报名表 */
  applyOpen: boolean
  gate: RecruitApplyGate
  name: string
  notice: string
}

/** 某个人的进度页额外需要的信息（当前该进哪个群） */
export interface RecruitProgressInfo {
  state: RecruitCycleState
  cycleName: string
  notice: string
  /** 该进哪个群；报名阶段为空（还没分群） */
  groupLabel: string
  group: string
}

/** 后台看到的签到二维码：一个阶段至多一张有效码 */
export interface RecruitCheckinCodeView {
  token: string
  stage: CheckinStage
  stageLabel: string
  /** 二维码里要编码的绝对地址 */
  url: string
  expiresAt: string
  createdBy: string
  createdAt: string
}

export type RecruitCheckinCodeMap = Record<CheckinStage, RecruitCheckinCodeView | null>

/** 一次动作执行的结果（后台弹给管理员看的汇总） */
export interface RecruitActionResult {
  action: RecruitAction
  state: RecruitCycleState
  stateLabel: string
  /** 改了多少条报名记录 */
  moved: number
  mail: {
    sent: number
    failed: number
    summary: string
  }
  /** 关闭本届时给出存档地址 */
  archive: { url: string; total: number; members: number } | null
  /**
   * 「清空报名」这类动作删掉了什么。
   * 刻意如实报数（含没删掉的文件数）—— 这是破坏性动作，管理员要能立刻核对结果。
   */
  cleaned?: { applications: number; files: number; filesFailed: number }
}

/** 后台看板的统计（漏斗 + 状态细分），由名单实时算出 */
export interface RecruitStats {
  state: RecruitCycleState
  stateLabel: string
  cycleName: string
  funnel: Record<RecruitStage, number>
  byLabel: Record<string, number>
  total: number
  members: number
}

// ============================================================================
// 十三、导出
// ============================================================================

/** 导出 CSV 时的列（顺序即表头顺序） —— 后台「导出名单」与关闭归档共用 */
export const RECRUIT_EXPORT_COLUMNS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'name', label: '姓名' },
  { key: 'studentId', label: '学号' },
  { key: 'email', label: '邮箱' },
  { key: 'phone', label: '手机号' },
  { key: 'qq', label: 'QQ' },
  { key: 'stageLabel', label: '当前阶段' },
  { key: 'resultLabel', label: '阶段结果' },
  { key: 'statusLabel', label: '当前状态' },
  { key: 'writtenScore', label: '笔试成绩' },
  { key: 'interviewScore', label: '面试成绩' },
  { key: 'defenseScore', label: '答辩成绩' },
  { key: 'writtenCheckinAt', label: '笔试签到' },
  { key: 'interviewCheckinAt', label: '面试签到' },
  { key: 'defenseCheckinAt', label: '答辩签到' },
  { key: 'fileName', label: '报名表文件' },
  { key: 'invitedAt', label: '邀请函发出' },
  { key: 'confirmedAt', label: '确认加入' },
  { key: 'createdAt', label: '报名时间' },
  { key: 'note', label: '管理员备注' },
]

/** CSV 单元格转义：含逗号/引号/换行就包一层引号 */
export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 生成 CSV 文本（带 BOM，Excel 打开中文不乱码） */
export function buildCsv(rows: Array<Record<string, unknown>>): string {
  const header = RECRUIT_EXPORT_COLUMNS.map((column) => csvCell(column.label)).join(',')
  const lines = rows.map((row) =>
    RECRUIT_EXPORT_COLUMNS.map((column) => csvCell(row[column.key])).join(','),
  )
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`
}
