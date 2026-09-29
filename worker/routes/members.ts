/**
 * 成员侧的**公开**接口（凭证即密权，不要求登录）：
 *
 *   GET  /api/members/destination/:token   打开「填写毕业去向」页
 *   POST /api/members/destination/:token   提交去向（提交后这条链接立即失效）
 *
 * 为什么不要求登录：同学毕业之后教务网会话早就过期了（邀请函转正也是同样的处理），
 * 「填一句话」这件事不该先让人去登录一遍。
 *
 * 管理员侧的成员接口（批量毕业 / 发送去向征集）在 `routes/admin-members.ts`。
 */

import { DESTINATION_MAX } from '../../shared/types'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { getByDestinationToken, submitDestination } from '../lib/member-destination'
import { getSiteConfig, writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'

const LINK_GONE = '这个链接无效，或你已经填写过了（每条链接只能提交一次）'

export async function getDestinationForm(ctx: RequestContext): Promise<Response> {
  const record = await getByDestinationToken(ctx.env, ctx.params.token ?? '')
  if (!record) return fail(404, 'LINK_NOT_FOUND', LINK_GONE)

  const site = await getSiteConfig(ctx.env)
  return ok(
    {
      name: record.name,
      studioName: site.studioName,
      /** 已有的值（后台手填过 / 上次提交过）——预填进去，改起来更省事 */
      current: record.destination,
    },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function submitDestinationForm(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<{ destination?: unknown }>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const destination = String(body.destination ?? '').trim()
  if (!destination) return fail(400, 'VALIDATION_FAILED', '请填写你的毕业去向')
  if (destination.length > DESTINATION_MAX) {
    return fail(400, 'VALIDATION_FAILED', `毕业去向最多 ${DESTINATION_MAX} 个字`)
  }

  const record = await getByDestinationToken(ctx.env, ctx.params.token ?? '')
  if (!record) return fail(404, 'LINK_NOT_FOUND', LINK_GONE)

  const saved = await submitDestination(ctx.env, ctx.params.token ?? '', destination)
  if (!saved) return fail(409, 'ALREADY_SUBMITTED', '这条链接刚刚已经被提交过了')

  await writeAudit(ctx.env, {
    actor: `member:${record.id}`,
    action: 'submit_destination',
    resource: 'members',
    targetId: record.id,
    detail: destination.slice(0, 120),
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok({ name: record.name, destination })
}
