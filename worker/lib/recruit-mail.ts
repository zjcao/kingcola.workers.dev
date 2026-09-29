/**
 * 招新通知邮件：把「可配置模板」渲染成真实信件并投递，同时落一条发信日志。
 *
 * 与 `lib/mailer.ts` 的分工：本文件负责业务语义（收件人、变量、文案、日志、失败归一化），
 * 传输与 MIME 组装全在 mailer/smtp 里。
 *
 * 设计要点：
 * - **邮件发不出去不阻断状态流转** —— 状态该改还是改，失败原因如实返回给后台，重发即可；
 * - 模板正文与主题存在 `site_config['recruit'].templates`，由后台「邮件模板」页维护；
 * - 每次发送（含失败）都写一行 `application_mails`，回答「他到底收到没有」。
 */

import type { RecruitMailKind } from '../../shared/recruit'
import {
  cycleMailVars,
  RECRUIT_APPLICATION_MAIL_KINDS,
  RECRUIT_MAIL_META,
  renderTemplate,
  type RecruitCycleConfig,
  type RecruitTemplates,
} from '../../shared/recruit'
import type { SmtpConfig } from '../../shared/mail'
import { invitePath, type SiteConfig } from '../../shared/types'
import type { Env } from '../env'
import type { ApplicationRecord } from './applications'
import { writeMailLog } from './applications'
import { isMailConfigured, sendMail } from './mailer'

export interface NoticeContext {
  studio: SiteConfig
  cycle: RecruitCycleConfig
  templates: RecruitTemplates
  /** 站点原始地址，用于拼邀请函链接 */
  origin: string
}

/** 邀请函确认链接（收件人凭它一次性确认加入） */
export function buildInviteUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${invitePath(token)}`
}

/**
 * 模板变量。
 *
 * **没有任何时间与地点** —— 安排一律让同学看对应的 QQ 群，所以这里给的是四个群号。
 *
 * 群号与本届名称**原样传出去，不做兜底**：没填就是空串，
 * `renderTemplate` 遇到空值会保留 `{writtenGroup}` 原文（见 shared/recruit.ts），
 * 所以「还没配群号」这件事在预览与真实信件里都看得见，而不是变成一行空白。
 */
export function buildNoticeVars(record: ApplicationRecord, ctx: NoticeContext): Record<string, string> {
  const { cycle, studio } = ctx
  return {
    name: record.name || '同学',
    studentId: record.studentId,
    // 本届名称与四个群号走共享映射（后台预览读的是同一个函数，见 shared/recruit.ts 的 cycleMailVars）
    ...cycleMailVars(cycle),
    inviteLink: record.inviteToken ? buildInviteUrl(ctx.origin, record.inviteToken) : '',
    // 驳回理由：只在「材料驳回通知」里有值（其它信里会渲染成空串，见 renderTemplate 的规则）
    rejectReason: record.materialReason,
    studio: studio.studioName,
    contactEmail: studio.contactEmail,
    contactAddress: studio.contactAddress,
  }
}

export interface BuiltNotice {
  kind: RecruitMailKind
  to: string
  subject: string
  text: string
}

/** 渲染一封信；返回 null 表示没有收件邮箱 */
export function buildApplicationNotice(
  record: ApplicationRecord,
  kind: RecruitMailKind,
  ctx: NoticeContext,
): BuiltNotice | null {
  const to = record.email.trim()
  if (!to) return null

  const template = ctx.templates[kind]
  const vars = buildNoticeVars(record, ctx)
  return {
    kind,
    to,
    subject: renderTemplate(template.subject, vars).trim() || RECRUIT_MAIL_META[kind].label,
    text: renderTemplate(template.body, vars),
  }
}

export interface SendNoticeResult {
  kind: RecruitMailKind
  /** 邮件服务是否真的收下了这封信 */
  sent: boolean
  /** 跳过或失败的原因码：NO_RECIPIENT / TEMPLATE_DISABLED / NOT_CONFIGURED / … */
  code: string
  message: string
  to: string
}

/**
 * 发一封信并记日志。**任何失败都只返回结果、不抛异常** —— 状态流转不能被邮件拖垮。
 */
export async function sendApplicationNotice(
  env: Env,
  config: SmtpConfig,
  record: ApplicationRecord,
  kind: RecruitMailKind,
  ctx: NoticeContext,
  actor = 'system',
): Promise<SendNoticeResult> {
  const label = RECRUIT_MAIL_META[kind].label

  const built = buildApplicationNotice(record, kind, ctx)
  if (!built) {
    return { kind, sent: false, code: 'NO_RECIPIENT', message: '该报名记录没有邮箱，无法发送邮件', to: '' }
  }

  const log = async (result: SendNoticeResult) => {
    await writeMailLog(env, {
      applicationId: record.id,
      kind,
      recipient: result.to,
      subject: built.subject,
      ok: result.sent,
      code: result.code,
      message: result.message,
      actor,
    })
    return result
  }

  if (!ctx.templates[kind].enabled) {
    return log({
      kind,
      sent: false,
      code: 'TEMPLATE_DISABLED',
      message: `${label}模板已停用，未发送`,
      to: built.to,
    })
  }

  if (!isMailConfigured(env, config)) {
    return log({
      kind,
      sent: false,
      code: 'NOT_CONFIGURED',
      message: '邮件通道未接通（系统设置 → 邮件通知），本封信未发送',
      to: built.to,
    })
  }

  const result = await sendMail(env, config, {
    to: built.to,
    subject: built.subject,
    text: built.text,
    replyTo: ctx.studio.contactEmail.trim() || undefined,
  })

  if (!result.ok) {
    return log({
      kind,
      sent: false,
      code: result.code,
      message: `${label}发送失败：${result.message}`,
      to: built.to,
    })
  }

  return log({
    kind,
    sent: true,
    code: 'OK',
    message: `${label}已发送至 ${built.to}`,
    to: built.to,
  })
}

/** 批量发同一封信（生成名单、录取时一次发几十封）；串行发送，避免把 SMTP 连接打满 */
export async function sendApplicationNotices(
  env: Env,
  config: SmtpConfig,
  records: Array<{ record: ApplicationRecord; kind: RecruitMailKind }>,
  ctx: NoticeContext,
  actor = 'system',
): Promise<SendNoticeResult[]> {
  const results: SendNoticeResult[] = []
  for (const item of records) {
    results.push(await sendApplicationNotice(env, config, item.record, item.kind, ctx, actor))
  }
  return results
}

/** 结果汇总成人话，后台弹窗直接用 */
export function summarizeMailResults(results: SendNoticeResult[]): string {
  if (results.length === 0) return '没有需要发送的邮件'
  const sent = results.filter((r) => r.sent).length
  const failed = results.length - sent
  const reason = results.find((r) => !r.sent)
  const parts = [`已发送 ${sent} 封`]
  if (failed > 0) {
    parts.push(`${failed} 封未发出`)
    if (reason) parts.push(`（${reason.code}：${reason.message}）`)
  }
  return parts.join('，')
}

/** 供后台预览：告诉调用方这封信会不会真的发出去 */
export function noticePreviewHint(kind: RecruitMailKind, ctx: NoticeContext): string {
  if (!ctx.templates[kind].enabled) return '模板已停用，执行时不会发送'
  return RECRUIT_MAIL_META[kind].trigger
}

/** 判断一个字符串是不是合法的通知类型（接口入参校验用） */
export function isNoticeKind(value: string): value is RecruitMailKind {
  return Object.prototype.hasOwnProperty.call(RECRUIT_MAIL_META, value)
}

/**
 * 能不能按**报名记录**补发这封信。
 * 与 `isNoticeKind` 的区别只有一个：排除只发给成员的「毕业去向征集」。
 */
export function isApplicationNoticeKind(value: string): value is RecruitMailKind {
  return (RECRUIT_APPLICATION_MAIL_KINDS as readonly string[]).includes(value)
}
