/**
 * 报名学生会话。
 *
 * 与管理员会话（lib/auth.ts）**完全独立**：不同的 Cookie 名、不同的签名密钥、
 * 不同的有效期、不同的读取函数、不同的登出接口。任一侧登出、换密钥或全部失效，
 * 都不会影响另一侧。
 *
 * 会话由本站在授权码换回身份后自行签发，因此授权服务器暂时不可用时，
 * 已登录的同学依然可以正常报名。
 */

import { STUDENT_SESSION_COOKIE, STUDENT_SESSION_TTL_SECONDS, type Env } from '../env'
import { secretOf } from './secrets'
import { signToken, verifyToken } from './crypto'
import { parseCookies, serializeCookie } from './http'

export interface StudentSession {
  /** 学号 */
  sub: string
  name: string
  /** 授权会话 id，便于追溯是哪一次扫码授权 */
  sid: string
  exp: number
}

function studentSecret(env: Env): string {
  // D1 里由安装页生成的优先，环境变量兜底
  return secretOf(env, 'STUDENT_SESSION_SECRET') || 'kingcola-dev-insecure-student-secret-change-me'
}

export async function issueStudentToken(
  env: Env,
  student: { studentId: string; name: string; sid: string },
): Promise<string> {
  const payload: StudentSession = {
    sub: student.studentId,
    name: student.name,
    sid: student.sid,
    exp: Math.floor(Date.now() / 1000) + STUDENT_SESSION_TTL_SECONDS,
  }
  return signToken(payload, studentSecret(env))
}

export function studentCookie(token: string): string {
  return serializeCookie(STUDENT_SESSION_COOKIE, token, {
    maxAge: STUDENT_SESSION_TTL_SECONDS,
    httpOnly: true,
    sameSite: 'Lax',
  })
}

export function clearStudentCookie(): string {
  return serializeCookie(STUDENT_SESSION_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' })
}

/** 读取报名学生会话：不查库，仅校验签名与有效期 */
export async function readStudentSession(request: Request, env: Env): Promise<StudentSession | null> {
  const token = parseCookies(request)[STUDENT_SESSION_COOKIE]
  if (!token) return null

  const session = await verifyToken<StudentSession>(token, studentSecret(env))
  if (!session || typeof session.sub !== 'string') return null
  return session
}
