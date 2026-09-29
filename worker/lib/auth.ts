import { SESSION_COOKIE, SESSION_TTL_SECONDS, type Env } from '../env'
import { secretOf } from './secrets'
import { passwordVersion, signToken, verifyToken } from './crypto'
import { parseCookies, serializeCookie } from './http'

export interface AdminSession {
  sub: string
  username: string
  name: string
  /** 密码版本，改密码后旧会话自动失效 */
  pv: string
  exp: number
}

export interface AdminRow {
  id: string
  username: string
  password_hash: string
  display_name: string
  is_owner: number
}

function sessionSecret(env: Env): string {
  // D1 里由安装页生成的优先，环境变量兜底（本地开发/老部署）
  return secretOf(env, 'SESSION_SECRET') || 'kingcola-dev-insecure-session-secret-change-me'
}

export async function issueSessionToken(env: Env, admin: AdminRow): Promise<string> {
  const payload: AdminSession = {
    sub: admin.id,
    username: admin.username,
    name: admin.display_name || admin.username,
    pv: passwordVersion(admin.password_hash),
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }
  return signToken(payload, sessionSecret(env))
}

export function sessionCookie(token: string): string {
  return serializeCookie(SESSION_COOKIE, token, {
    maxAge: SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
  })
}

export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' })
}

/**
 * 读取并校验会话：除签名与有效期外，还要与 D1 中的当前密码版本比对，
 * 这样「改密码 / 重置密码」可以立即踢掉所有旧会话，无需额外的会话表。
 */
export async function readSession(request: Request, env: Env): Promise<AdminSession | null> {
  const token = parseCookies(request)[SESSION_COOKIE]
  if (!token) return null

  const session = await verifyToken<AdminSession & { sub: string }>(token, sessionSecret(env))
  if (!session || typeof session.sub !== 'string') return null

  const admin = await env.DB.prepare(
    'SELECT id, username, password_hash, display_name, is_owner FROM admin_users WHERE id = ?',
  )
    .bind(session.sub)
    .first<AdminRow>()

  if (!admin) return null
  if (passwordVersion(admin.password_hash) !== session.pv) return null

  return {
    sub: admin.id,
    username: admin.username,
    name: admin.display_name || admin.username,
    pv: session.pv,
    exp: session.exp,
  }
}

export async function countAdmins(env: Env): Promise<number> {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>()
  return row?.n ?? 0
}
