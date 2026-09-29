/**
 * 邮件相关后台接口。
 *
 *   POST /api/admin/mail/test   发一封测试邮件，验证 SMTP 配置是否真能投递
 *
 * 「配置对不对」只有真发一封才知道，所以后台的探活就是走真实投递链路。
 * 失败按原因区分状态码：配置没填齐 / 收件人非法算 400（用户可自行修正），
 * 连不上、TLS、认证失败、被拒收算 502（上游 SMTP 的问题），错误码原样透出，
 * 后台据此给出「该改哪一项」的提示。
 */

import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { sendMail } from '../lib/mailer'
import { getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { resolveRuntimeConfig } from './config'

interface TestMailBody {
  /** 收件人；留空则退回站点配置里的「联系邮箱」 */
  to?: string
}

export async function sendTestMail(ctx: RequestContext): Promise<Response> {
  const [runtime, site] = await Promise.all([resolveRuntimeConfig(ctx), getSiteConfig(ctx.env)])
  const body = await readJsonBody<TestMailBody>(ctx.request)
  const to = (body?.to ?? '').trim() || site.contactEmail.trim()

  if (!to) {
    return fail(400, 'NO_RECIPIENT', '请填写收件邮箱，或先在「品牌与联系方式」里配置联系邮箱')
  }

  const result = await sendMail(ctx.env, runtime.mail, {
    to,
    subject: `【${site.studioName}】邮件通道测试`,
    text: [
      `这是一封来自 ${site.studioName} 官网后台的测试邮件。`,
      '',
      `发送时间：${new Date().toISOString()}`,
      `SMTP 服务器：${runtime.mail.host}:${runtime.mail.port}（${runtime.mail.security}）`,
      `发件邮箱：${runtime.mail.fromAddress}`,
      '',
      '收到这封邮件，说明邮件通道可用。',
    ].join('\n'),
  })

  await writeAudit(ctx.env, {
    actor: ctx.admin?.username ?? '(unknown)',
    action: 'send_test_mail',
    resource: 'mail',
    detail: `${to} → ${result.ok ? `ok ${result.messageId}` : result.code}`,
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  if (!result.ok) {
    // 配置缺失/收件人有问题属于可修正的输入错误；其余是上游 SMTP 的锅
    const status = result.code === 'NOT_CONFIGURED' || result.code === 'INVALID_MESSAGE' ? 400 : 502
    return fail(status, result.code, result.detail ? `${result.message}（${result.detail}）` : result.message)
  }

  return ok({ accepted: result.accepted, messageId: result.messageId })
}
