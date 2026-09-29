/**
 * 成员管理里那些**跨记录**的动作 —— 批量毕业、发送「毕业去向征集」。
 *
 * 单条增删改仍走通用内容接口（`/api/admin/content/members`，由 shared/resources.ts 驱动）；
 * 这里只处理「一次动一批人、还可能发一批信」的事，因为它要写库 + 发信 + 汇总结果，
 * 塞进那个刻意保持「资源无关」的通用接口里不合适。
 *
 * 「毕业」的语义很窄，只有一件事：把 `status` 由 `current` 改成 `alumni`。
 * 毕业去向**不在这里填** —— 由本人点邮件里的专属链接自己填（见 `lib/member-destination.ts`）。
 */

import { renderTemplate } from '../../shared/recruit'
import { RESOURCES } from '../../shared/resources'
import { graduatePath } from '../../shared/types'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { isMailConfigured, sendMail } from '../lib/mailer'
import { issueDestinationToken } from '../lib/member-destination'
import { getRecruitSettings } from '../lib/recruit-config'
import { getEntity, getSiteConfig, updateEntity, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { resolveRuntimeConfig } from './config'

/** 一次最多处理多少人：发信是串行的，别让一次误点变成几百封 */
const MAX_IDS = 200

interface BulkIdsBody {
  ids?: unknown
  /** 「批量毕业」里是否同时发出「毕业去向征集」信 */
  sendMail?: unknown
}

/** 发信/发链接需要的三个字段，够用了 */
interface MemberLite {
  id: string
  name: string
  email: string
}

export interface DestinationMailSummary {
  sent: number
  failed: number
  /** 没填邮箱 / 模板停用 / 通道没接通，都算跳过 */
  skipped: number
  /** 本次**新签发**的链接数（= 真正尝试发送的人数） */
  issued: number
  message: string
}

export interface GraduateResult {
  graduated: number
  /** 本来就是「已毕业」，没重复改也没重复发信 */
  already: number
  /** 找不到的 id（多半是别处已经删了） */
  missing: string[]
  mail: DestinationMailSummary | null
  /** 汇总成一句人话，后台 toast 直接用 */
  message: string
}

export type DestinationMailResult = DestinationMailSummary

/** 取一份干净的 id 列表；空 / 超限时返回错误响应 */
function readIds(body: BulkIdsBody | null): string[] | Response {
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')
  const ids = Array.isArray(body.ids)
    ? [...new Set(body.ids.map((id) => String(id)).filter(Boolean))]
    : []
  if (ids.length === 0) return fail(400, 'VALIDATION_FAILED', '请先勾选成员')
  if (ids.length > MAX_IDS) return fail(400, 'VALIDATION_FAILED', `一次最多处理 ${MAX_IDS} 人`)
  return ids
}

export async function graduateMembers(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<BulkIdsBody>(ctx.request)
  const ids = readIds(body)
  if (ids instanceof Response) return ids

  const sendMailRequested = body?.sendMail === true
  const def = RESOURCES.members

  const graduated: MemberLite[] = []
  const already: string[] = []
  const missing: string[] = []

  for (const id of ids) {
    const before = await getEntity(ctx.env, def, id)
    if (!before) {
      missing.push(id)
      continue
    }
    // 幂等：已经毕业的人不重复改、也不重复发信（重按一次按钮不该再骚扰同学）
    if (String(before.status) === 'alumni') {
      already.push(id)
      continue
    }
    // 只改状态：届别看的是加入年份（joinYear），不必再单独记一个毕业年份
    const updated = await updateEntity(ctx.env, def, id, { status: 'alumni' })
    if (!updated) {
      missing.push(id)
      continue
    }
    graduated.push({ id, name: String(updated.name ?? ''), email: String(updated.email ?? '') })
  }

  const mail = sendMailRequested ? await deliverDestinationMails(ctx, graduated) : null

  const parts = [`已把 ${graduated.length} 位移到「已毕业」`]
  if (already.length > 0) parts.push(`${already.length} 位本来就是已毕业，未重复处理`)
  if (missing.length > 0) parts.push(`${missing.length} 条已不存在`)
  if (mail) parts.push(mail.message)
  const message = parts.join('；')

  await writeAudit(ctx.env, {
    actor: ctx.admin?.username ?? '(unknown)',
    action: 'graduate_members',
    resource: def.key,
    targetId: graduated.map((m) => m.id).join(',').slice(0, 200),
    detail: message,
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  const result: GraduateResult = {
    graduated: graduated.length,
    already: already.length,
    missing,
    mail,
    message,
  }
  return ok(result)
}

/**
 * 「发送去向征集」：给选中的已毕业成员（重新）发信。
 *
 * 与「批量毕业时顺带发一次」共用同一个实现 —— 信里带专属填写链接。
 * 重发会**换一条新链接**（旧链接立即失效），所以同学弄丢了邮件也能再要一次。
 */
export async function sendDestinationMails(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<BulkIdsBody>(ctx.request)
  const ids = readIds(body)
  if (ids instanceof Response) return ids

  const def = RESOURCES.members
  const targets: MemberLite[] = []
  const missing: string[] = []

  for (const id of ids) {
    const member = await getEntity(ctx.env, def, id)
    if (!member) {
      missing.push(id)
      continue
    }
    targets.push({ id, name: String(member.name ?? ''), email: String(member.email ?? '') })
  }

  const mail = await deliverDestinationMails(ctx, targets)
  const message = missing.length > 0 ? `${mail.message}；${missing.length} 条已不存在` : mail.message

  await writeAudit(ctx.env, {
    actor: ctx.admin?.username ?? '(unknown)',
    action: 'send_destination_mail',
    resource: def.key,
    targetId: targets.map((m) => m.id).join(',').slice(0, 200),
    detail: message,
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok({ ...mail, message })
}

/**
 * 发「毕业去向征集」信：每人**新签一条链接**。
 *
 * ⚠️ 签发在发送之前：发失败的人链接其实已经换了（旧链接作废、新的没送到）。
 * 这是刻意的取舍 —— 失败会如实回报，重发一次即可，而重发又会换一条新的。
 *
 * 三种「不发」都只算跳过、不报错：模板停用 / 通道没接通 / 本人没填邮箱。
 */
async function deliverDestinationMails(
  ctx: RequestContext,
  members: MemberLite[],
): Promise<DestinationMailSummary> {
  if (members.length === 0) {
    return { sent: 0, failed: 0, skipped: 0, issued: 0, message: '没有需要发信的成员' }
  }

  const { templates } = await getRecruitSettings(ctx.env)
  const template = templates.graduation_destination
  if (!template.enabled) {
    return {
      sent: 0,
      failed: 0,
      skipped: members.length,
      issued: 0,
      message: '「毕业去向征集」模板已停用，未发送',
    }
  }

  const runtime = await resolveRuntimeConfig(ctx)
  if (!isMailConfigured(ctx.env, runtime.mail)) {
    return {
      sent: 0,
      failed: 0,
      skipped: members.length,
      issued: 0,
      message: '邮件通道未接通，未发送（链接也没签发）',
    }
  }

  const site = await getSiteConfig(ctx.env)
  const replyTo = site.contactEmail.trim() || undefined
  const origin = ctx.url.origin.replace(/\/+$/, '')

  let sent = 0
  let failed = 0
  let skipped = 0
  let issued = 0
  let firstError = ''

  for (const member of members) {
    const to = member.email.trim()
    if (!to) {
      // 没邮箱就不签链接了 —— 签了也没人能用上（后台要手递链接再说）
      skipped++
      continue
    }

    const token = await issueDestinationToken(ctx.env, member.id)
    issued++

    // 变量只用现有那批 + 新加的 {destinationLink}：这封信不属于招新，所以没有本届名称与群号
    const vars = {
      name: member.name || '同学',
      destinationLink: `${origin}${graduatePath(token)}`,
      studio: site.studioName,
      contactEmail: site.contactEmail,
      contactAddress: site.contactAddress,
    }
    const result = await sendMail(ctx.env, runtime.mail, {
      to,
      subject: renderTemplate(template.subject, vars).trim() || '毕业去向登记',
      text: renderTemplate(template.body, vars),
      replyTo,
    })

    if (result.ok) {
      sent++
    } else {
      failed++
      if (!firstError) firstError = result.message
    }
  }

  const parts = [`已发出 ${sent} 封（含专属填写链接）`]
  if (skipped > 0) parts.push(`${skipped} 人没填邮箱，已跳过`)
  if (failed > 0) parts.push(`${failed} 封发送失败${firstError ? `（${firstError}）` : ''}`)
  return { sent, failed, skipped, issued, message: parts.join('，') }
}
