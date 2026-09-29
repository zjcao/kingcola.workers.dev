/**
 * 后台：成员「方向 / 角色」字典的维护接口。
 *
 *   GET  /api/admin/member-roles   读当前字典 + 每个方向的使用人数
 *   PUT  /api/admin/member-roles   整份覆盖保存
 *
 * 为什么是「整份覆盖」而不是 RESTful 的逐条 POST / PATCH / DELETE？
 * 因为这份字典的存储形态是**一个 JSON 数组**（KV + D1 的一个键），没有行级语义。
 * 整份覆盖天然是原子的、不会出现「改到一半」的中间状态，也刚好匹配后台
 * 「在表格里改一堆、最后点一次保存」的交互。逐条接口会引入一堆并发写半份的问题，
 * 换不来任何好处 —— 这是**存储形态决定接口形态**的典型例子。
 *
 * 边界（最重要的那条）：`kind !== 'student'` 的方向不允许 `selectableBySelf`，
 * 由 `validateMemberRoles` 强制纠正；邀请函侧还有第二道校验（见 routes/applications.ts）。
 */

import { validateMemberRoles } from '../../shared/identity'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { getMemberRoles, memberRoleUsage, setMemberRoles } from '../lib/identity-config'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

export async function getMemberRolesAdmin(ctx: RequestContext): Promise<Response> {
  const [roles, usage] = await Promise.all([getMemberRoles(ctx.env), memberRoleUsage(ctx.env)])
  return ok({
    roles,
    usage,
    /** KV 是否已绑定。未绑定时读写走 D1，功能一样 —— 只是让后台能把这件事说清楚 */
    kvReady: Boolean(ctx.env.CONFIG_KV),
  })
}

interface UpdateRolesBody {
  roles?: unknown
  /**
   * 「确认移除还有人在用的方向」。
   *
   * 前端在界面上已经确认过一次（显示了人数），这里再要一个显式标记，是为了防住
   * 「界面上误删一行 + 保存」这种静默事故 —— 它不会动任何历史数据，但会让之后
   * 新建成员时再也选不到这个方向，属于不可从界面察觉的损失。
   */
  confirmRemoval?: boolean
}

export async function updateMemberRolesAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<UpdateRolesBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const { roles, error } = validateMemberRoles(body.roles)
  if (error) return fail(400, 'VALIDATION_FAILED', error)

  const [current, usage] = await Promise.all([getMemberRoles(ctx.env), memberRoleUsage(ctx.env)])

  const nextLabels = new Set(roles.map((role) => role.label))
  const droppedInUse = current
    .filter((role) => !nextLabels.has(role.label) && (usage[role.label] ?? 0) > 0)
    .map((role) => role.label)

  if (droppedInUse.length && body.confirmRemoval !== true) {
    const detail = droppedInUse.map((label) => `${label}（${usage[label]} 人）`).join('、')
    return fail(
      409,
      'ROLE_IN_USE',
      `这些方向还有成员在用：${detail}。移除只影响以后能否选到它，已有成员的资料不会改变 —— 确认要移除吗？`,
    )
  }

  // 停用（retired）不算移除：它留在字典里、随时能启用回来，所以不需要上面的确认
  await setMemberRoles(ctx.env, roles)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'update',
    resource: 'member_roles',
    detail: [
      `${current.length} → ${roles.length} 个方向`,
      droppedInUse.length ? `移除在用方向：${droppedInUse.join('、')}` : '',
    ]
      .filter(Boolean)
      .join('；')
      .slice(0, 500),
    ...requestMeta(ctx),
  })

  return ok({ roles, usage, droppedInUse, kvReady: Boolean(ctx.env.CONFIG_KV) })
}
