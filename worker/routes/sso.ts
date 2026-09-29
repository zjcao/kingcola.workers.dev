/**
 * 教务网单点登录（OAuth 2.0 授权码模式）的消费端。
 *
 *   GET  /api/auth/login    发起登录：生成 state 后跳转到授权服务器
 *   GET  /api/auth/callback 接收授权码，换取身份并签发报名会话
 *   GET  /api/auth/me       前端查询当前登录态
 *   POST /api/auth/logout   退出登录
 *
 * 全程不接触教务网 —— 那是授权服务器的事。本站只在回调里做一件事：
 * 用授权码换回身份，验证凭证确由授权服务器签发，然后种下自己的报名会话。
 *
 * 注意：这里只操作报名会话（kc_student），与管理员的 kc_admin 完全无关，
 * 互相登出、互相失效都不受影响。
 */

import {
  APPLY_TOKEN_AUDIENCE,
  buildAuthorizeUrl,
  idpTokenUrl,
  OAUTH_STATE_TTL_SECONDS,
  SSO_CLIENT_ID,
  type SsoMeResponse,
} from '../../shared/sso'
import { isSsoReady } from '../../shared/runtime'
import {
  OAUTH_STATE_COOKIE,
  type Env,
} from '../env'
import { randomHex, verifyToken } from '../lib/crypto'
import { ok, parseCookies, serializeCookie } from '../lib/http'
import type { RequestContext } from '../lib/router'
import {
  clearStudentCookie,
  issueStudentToken,
  readStudentSession,
  studentCookie,
} from '../lib/student-auth'
import { resolveRuntimeConfig } from './config'

/** 凭证验签密钥，需与授权服务器共用 */
function tokenSecret(env: Env): string {
  return env.QR_SIGN_SECRET ?? 'kingcola-dev-insecure-qr-sign-secret-change-me'
}

/**
 * 取授权服务器地址 —— 以后台设置为准（存在 D1），环境变量仅作老部署的引导值。
 * 未接通（开关关掉或地址为空）时返回空串，调用方一律回首页提示。
 */
async function idpBase(ctx: RequestContext): Promise<string> {
  const runtime = await resolveRuntimeConfig(ctx)
  if (!isSsoReady(runtime.sso)) return ''
  return runtime.sso.authorizeBase.trim().replace(/\/+$/, '')
}

function clientId(env: Env): string {
  return (env.SSO_CLIENT_ID ?? '').trim() || SSO_CLIENT_ID
}

/**
 * 回调地址必须与授权服务器白名单里的登记值逐字一致。
 * 生产环境建议用 SSO_REDIRECT_URI 固定下来，避免自定义域名与预览域名不一致；
 * 留空时按当前访问域名推导，方便本地调试。
 */
function callbackUrl(ctx: RequestContext): string {
  const fixed = (ctx.env.SSO_REDIRECT_URI ?? '').trim()
  return fixed || new URL('/api/auth/callback', ctx.url.origin).toString()
}

function clearStateCookie(): string {
  return serializeCookie(OAUTH_STATE_COOKIE, '', { maxAge: 0, httpOnly: true, sameSite: 'Lax' })
}

/** 回调失败时回首页并带上原因，不把错误码留在地址栏里 */
function backToHome(origin: string, reason: string): Response {
  const headers = new Headers({
    location: `${origin}/?login=${encodeURIComponent(reason)}`,
    'cache-control': 'no-store',
  })
  headers.append('set-cookie', clearStateCookie())
  return new Response(null, { status: 302, headers })
}

/** 发起登录：种 state 后跳走 */
export async function ssoLogin(ctx: RequestContext): Promise<Response> {
  const base = await idpBase(ctx)
  // 这是整页跳转的入口，出错也回首页说明，不把 JSON 错误页甩给用户
  if (!base) return backToHome(ctx.url.origin, 'not_configured')

  const state = randomHex(16)
  const target = buildAuthorizeUrl(base, {
    clientId: clientId(ctx.env),
    redirectUri: callbackUrl(ctx),
    state,
  })

  return new Response(null, {
    status: 302,
    headers: {
      location: target,
      'set-cookie': serializeCookie(OAUTH_STATE_COOKIE, state, {
        maxAge: OAUTH_STATE_TTL_SECONDS,
        httpOnly: true,
        sameSite: 'Lax',
      }),
      'cache-control': 'no-store',
    },
  })
}

/** 接收授权码：校验 state → 换身份 → 验凭证 → 种报名会话 */
export async function ssoCallback(ctx: RequestContext): Promise<Response> {
  const code = ctx.url.searchParams.get('code') ?? ''
  const state = ctx.url.searchParams.get('state') ?? ''
  const expected = parseCookies(ctx.request)[OAUTH_STATE_COOKIE] ?? ''
  const origin = ctx.url.origin

  // 用户在授权页点了取消：授权服务器会带着 error 回来，不带 code
  if (!code) return backToHome(origin, 'denied')

  // state 必须与本机种下的 cookie 一致，挡住伪造的回调
  if (!state || !expected || state !== expected) return backToHome(origin, 'state_mismatch')

  const base = await idpBase(ctx)
  if (!base) return backToHome(origin, 'not_configured')

  const clientSecret = (ctx.env.SSO_CLIENT_SECRET ?? '').trim()
  if (!clientSecret) return backToHome(origin, 'not_configured')

  let tokenResponse: Response
  try {
    tokenResponse = await fetch(idpTokenUrl(base), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, clientId: clientId(ctx.env), clientSecret }),
    })
  } catch {
    return backToHome(origin, 'upstream_unreachable')
  }

  const payload = (await tokenResponse.json().catch(() => null)) as
    | { ok?: boolean; studentId?: string; name?: string; applyToken?: string }
    | null

  if (!tokenResponse.ok || !payload?.ok || !payload.studentId || !payload.applyToken) {
    return backToHome(origin, 'exchange_failed')
  }

  // 凭证必须用共用密钥验签通过，才认这份身份 —— 不因为「是服务端调的」就无条件相信
  const claims = await verifyToken<{ sub: string; name: string; sid: string; aud?: string }>(
    payload.applyToken,
    tokenSecret(ctx.env),
  )
  if (!claims || claims.aud !== APPLY_TOKEN_AUDIENCE) return backToHome(origin, 'invalid_credential')

  const token = await issueStudentToken(ctx.env, {
    studentId: claims.sub,
    name: claims.name ?? payload.name ?? '',
    sid: claims.sid ?? '',
  })

  const headers = new Headers({
    location: `${origin}/?login=ok`,
    'cache-control': 'no-store',
  })
  headers.append('set-cookie', studentCookie(token))
  headers.append('set-cookie', clearStateCookie())
  return new Response(null, { status: 302, headers })
}

/** 当前报名登录态 */
export async function ssoMe(ctx: RequestContext): Promise<Response> {
  const session = await readStudentSession(ctx.request, ctx.env)
  const headers = { 'cache-control': 'no-store' }

  if (!session) return ok<SsoMeResponse>({ authenticated: false }, { headers })
  return ok<SsoMeResponse>(
    { authenticated: true, studentId: session.sub, name: session.name },
    { headers },
  )
}

/** 退出登录：只清报名会话 */
export async function ssoLogout(ctx: RequestContext): Promise<Response> {
  void ctx
  return ok(
    { loggedOut: true },
    { headers: { 'set-cookie': clearStudentCookie(), 'cache-control': 'no-store' } },
  )
}
