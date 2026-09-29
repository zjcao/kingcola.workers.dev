import type { ApiErr, ApiOk } from '../../shared/types'

export function ok<T>(data: T, init: ResponseInit = {}): Response {
  const body: ApiOk<T> = { ok: true, data }
  return json(body, init)
}

export function fail(status: number, code: string, message: string, init: ResponseInit = {}): Response {
  const body: ApiErr = { ok: false, error: { code, message } }
  return json(body, { status, ...init })
}

export function json(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(value), { ...init, headers })
}

/** 可被 CDN 缓存的成功响应，用于公开只读接口（同样使用 { ok, data } 信封） */
export function cacheable<T>(data: T, maxAge: number): Response {
  return ok(data, {
    headers: {
      'cache-control': `public, max-age=${maxAge}, s-maxage=${maxAge * 5}`,
    },
  })
}

export function resolveAllowedOrigin(request: Request, env: { ALLOWED_ORIGINS?: string }): string | null {
  const origin = request.headers.get('origin')
  if (!origin) return null
  if (new URL(request.url).origin === origin) return origin

  const allowed = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  // 本地开发：Vite 默认端口
  if (allowed.length === 0) {
    if (/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) return origin
    return null
  }
  return allowed.includes(origin) ? origin : null
}

export function withCors(response: Response, request: Request, env: { ALLOWED_ORIGINS?: string }): Response {
  const origin = resolveAllowedOrigin(request, env)
  if (!origin) return response
  const headers = new Headers(response.headers)
  headers.set('access-control-allow-origin', origin)
  headers.set('access-control-allow-credentials', 'true')
  headers.set('vary', 'origin')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

export function preflight(request: Request, env: { ALLOWED_ORIGINS?: string }): Response {
  const origin = resolveAllowedOrigin(request, env)
  const headers = new Headers({
    'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,authorization,x-idempotency-key',
    'access-control-max-age': '86400',
  })
  if (origin) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-credentials', 'true')
  }
  return new Response(null, { status: 204, headers })
}

export function clientIp(request: Request): string {
  return (
    request.headers.get('cf-connecting-ip') ??
    request.headers.get('x-real-ip') ??
    (request.headers.get('x-forwarded-for') ?? '').split(',')[0]?.trim() ??
    ''
  )
}

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('cookie')
  if (!header) return {}
  const out: Record<string, string> = {}
  for (const part of header.split(';')) {
    const idx = part.indexOf('=')
    if (idx === -1) continue
    const key = part.slice(0, idx).trim()
    const value = part.slice(idx + 1).trim()
    if (key) out[key] = decodeURIComponent(value)
  }
  return out
}

export function serializeCookie(
  name: string,
  value: string,
  options: { maxAge?: number; httpOnly?: boolean; sameSite?: string; path?: string } = {},
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`]
  parts.push(`Path=${options.path ?? '/'}`)
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`)
  if (options.httpOnly !== false) parts.push('HttpOnly')
  parts.push('Secure')
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`)
  return parts.join('; ')
}

export async function readJsonBody<T>(request: Request): Promise<T | null> {
  try {
    const contentType = request.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) return null
    return (await request.json()) as T
  } catch {
    return null
  }
}
