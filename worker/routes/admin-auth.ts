/**
 * 管理员认证。
 *
 * 设计取向（针对「工作室换届交接」这一真实约束）：
 *  - 账号密码存在 D1 而不是只绑定某个云账号，下一届登录后台即可自行改密码；
 *  - 单用户但表结构支持多人，换届时可以再加一个账号；
 *  - RECOVERY_TOKEN 环境变量是最后的兜底：密码彻底丢失时用它重置，
 *    该值写在 docs/HANDOVER.md 里由工作室保管。
 */

import { countAdmins, clearSessionCookie, issueSessionToken, readSession, sessionCookie, type AdminRow } from '../lib/auth'
import { hashPassword, randomId, verifyPassword } from '../lib/crypto'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { setConfigValue, writeAudit } from '../lib/repo'
import { seedContentIfEmpty, type SeedOutcome } from '../lib/seed-content'
import type { RequestContext } from '../lib/router'

interface LoginBody {
  username?: string
  password?: string
}

interface ChangePasswordBody {
  currentPassword?: string
  newPassword?: string
}

interface BootstrapBody {
  token?: string
  username?: string
  password?: string
  displayName?: string
  /** 是否同时写入演示内容 */
  seedContent?: boolean
}

function minPasswordLength(): number {
  return 8
}

export async function login(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<LoginBody>(ctx.request)
  const username = body?.username?.trim() ?? ''
  const password = body?.password ?? ''
  const ip = clientIp(ctx.request)
  const ua = ctx.request.headers.get('user-agent') ?? ''

  if (!username || !password) {
    return fail(400, 'INVALID_INPUT', '请输入用户名与密码')
  }

  const admins = await countAdmins(ctx.env)
  if (admins === 0) {
    return fail(409, 'NOT_INITIALIZED', '系统尚未初始化管理员账号，请使用交接文档中的初始化口令完成初始化')
  }

  const admin = await ctx.env.DB.prepare(
    'SELECT id, username, password_hash, display_name, is_owner FROM admin_users WHERE username = ?',
  )
    .bind(username)
    .first<AdminRow>()

  const matched = admin ? await verifyPassword(password, admin.password_hash) : false
  if (!admin || !matched) {
    await writeAudit(ctx.env, { actor: username || '(unknown)', action: 'login_failed', ip, ua })
    // 统一话术，不泄露用户名是否存在
    return fail(401, 'INVALID_CREDENTIALS', '用户名或密码不正确')
  }

  const now = new Date().toISOString()
  await ctx.env.DB.prepare('UPDATE admin_users SET last_login_at = ? WHERE id = ?').bind(now, admin.id).run()
  await writeAudit(ctx.env, { actor: admin.username, action: 'login', ip, ua })

  const token = await issueSessionToken(ctx.env, admin)
  return ok(
    { username: admin.username, name: admin.display_name || admin.username, isOwner: admin.is_owner === 1 },
    { headers: { 'set-cookie': sessionCookie(token) } },
  )
}

export async function logout(ctx: RequestContext): Promise<Response> {
  const session = await readSession(ctx.request, ctx.env)
  if (session) {
    await writeAudit(ctx.env, {
      actor: session.username,
      action: 'logout',
      ip: clientIp(ctx.request),
      ua: ctx.request.headers.get('user-agent') ?? '',
    })
  }
  return ok({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } })
}

export async function me(ctx: RequestContext): Promise<Response> {
  const session = await readSession(ctx.request, ctx.env)
  if (!session) return fail(401, 'UNAUTHENTICATED', '未登录或会话已过期')
  return ok({ username: session.username, name: session.name })
}

export async function changePassword(ctx: RequestContext): Promise<Response> {
  const session = await readSession(ctx.request, ctx.env)
  if (!session) return fail(401, 'UNAUTHENTICATED', '未登录或会话已过期')

  const body = await readJsonBody<ChangePasswordBody>(ctx.request)
  const current = body?.currentPassword ?? ''
  const next = body?.newPassword ?? ''

  if (next.length < minPasswordLength()) {
    return fail(400, 'WEAK_PASSWORD', `新密码至少 ${minPasswordLength()} 位`)
  }

  const admin = await ctx.env.DB.prepare('SELECT id, username, password_hash FROM admin_users WHERE id = ?')
    .bind(session.sub)
    .first<AdminRow>()

  if (!admin || !(await verifyPassword(current, admin.password_hash))) {
    return fail(400, 'INVALID_CREDENTIALS', '当前密码不正确')
  }

  const hash = await hashPassword(next)
  const now = new Date().toISOString()
  await ctx.env.DB.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .bind(hash, now, admin.id)
    .run()

  await writeAudit(ctx.env, {
    actor: admin.username,
    action: 'change_password',
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  // 密码版本已变化，旧会话全部失效；这里直接清掉当前 Cookie，要求重新登录
  return ok({ ok: true }, { headers: { 'set-cookie': clearSessionCookie() } })
}

/**
 * **安装**：把表建好（打包进产物的迁移，按 `_migrations` 台账执行）+ 生成运行期密钥 + 创建第一个管理员。
 *
 * 不再需要任何 recovery 口令 —— 「系统里还没有管理员」本身就是授权的全部依据；
 * 装完之后这个接口直接拒绝（重置密码请在登录后自行修改）。
 */
export async function bootstrap(ctx: RequestContext): Promise<Response> {
  const { isInstalled, runPendingMigrations } = await import('../lib/migrate')
  const { generateSecrets } = await import('../lib/secrets')
  const body = await readJsonBody<BootstrapBody>(ctx.request)

  if (await isInstalled(ctx.env)) {
    return fail(
      409,
      'ALREADY_INSTALLED',
      '已经安装过了：请直接登录；忘记密码请在登录后修改（或由另一位管理员重置）',
    )
  }

  // 1) 建表（应用自建表：SQL 随产物发布，台账保证只执行一次）
  const migrated = await runPendingMigrations(ctx.env)
  if (!migrated.ok) {
    return fail(503, 'DB_NOT_READY', migrated.reason ?? '数据库未就绪')
  }

  // 2) 生成运行期密钥（SESSION_SECRET / STUDENT_SESSION_SECRET）→ 写进 D1，已存在的不动
  await generateSecrets(ctx.env)

  // 3) 建管理员
  const username = (body?.username?.trim() || ctx.env.BOOTSTRAP_USERNAME || 'admin').toLowerCase()
  const password = body?.password ?? ctx.env.BOOTSTRAP_PASSWORD ?? ''
  if (password.length < minPasswordLength()) {
    return fail(400, 'WEAK_PASSWORD', `密码至少 ${minPasswordLength()} 位`)
  }

  const existingAdmins = await countAdmins(ctx.env)
  const hash = await hashPassword(password)
  const now = new Date().toISOString()

  if (existingAdmins === 0) {
    await ctx.env.DB.prepare(
      'INSERT INTO admin_users (id, username, password_hash, display_name, is_owner, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
    )
      .bind(randomId('adm'), username, hash, body?.displayName?.trim() || '管理员', now, now)
      .run()
  } else {
    const target = await ctx.env.DB.prepare('SELECT id FROM admin_users WHERE username = ?')
      .bind(username)
      .first<{ id: string }>()
    if (!target) return fail(404, 'USER_NOT_FOUND', `不存在管理员账号 ${username}`)
    await ctx.env.DB.prepare('UPDATE admin_users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .bind(hash, now, target.id)
      .run()
  }

  let seeded: SeedOutcome | null = null
  if (body?.seedContent) {
    // 只在空表上写入，避免覆盖已有正式内容
    seeded = await seedContentIfEmpty(ctx.env)
    await setConfigValue(ctx.env, 'seeded', { at: now, by: username, result: seeded })
  }

  await writeAudit(ctx.env, {
    actor: username,
    action: existingAdmins === 0 ? 'bootstrap_admin' : 'reset_password',
    detail: seeded ? `初始化内容：${JSON.stringify(seeded)}` : '',
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok({ username, created: existingAdmins === 0, seeded })
}

/** 后台「初始化演示数据」按钮：只在内容表为空时执行，避免覆盖正式内容 */
export async function seedContent(ctx: RequestContext): Promise<Response> {
  const session = await readSession(ctx.request, ctx.env)
  if (!session) return fail(401, 'UNAUTHENTICATED', '未登录或会话已过期')

  const result = await seedContentIfEmpty(ctx.env)

  await writeAudit(ctx.env, {
    actor: session.username,
    action: 'seed_content',
    detail: JSON.stringify(result),
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok({ result })
}
