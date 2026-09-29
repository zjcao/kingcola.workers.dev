import type { Env } from '../env'
import type { AdminSession } from './auth'
import type { StudentSession } from './student-auth'

export interface RequestContext {
  request: Request
  env: Env
  url: URL
  params: Record<string, string>
  exec: ExecutionContext
  /** 通过 auth: 'admin' 的路由会带上当前管理员会话 */
  admin?: AdminSession
  /** 通过 auth: 'student' 的路由会带上当前报名学生会话（教务网登录） */
  student?: StudentSession
}

export type RouteHandler = (ctx: RequestContext) => Promise<Response> | Response

export interface RouteDef {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  /**
   * 支持 `:param` 占位（如 /api/admin/content/:resource/:id），
   * 以及放在末尾的 `*` 通配（如 /api/files/*，捕获剩余路径到 params['*']）。
   */
  path: string
  handler: RouteHandler
  /**
   * 会话要求：
   * - 'admin'   管理员（kc_admin）
   * - 'student' 报名学生（kc_student，教务网登录后签发）
   * 两套会话完全独立，互不影响。
   */
  auth?: 'admin' | 'student'
}

export interface MatchResult {
  route: RouteDef
  params: Record<string, string>
}

export function matchRoute(routes: RouteDef[], method: string, pathname: string): MatchResult | null {
  const segments = pathname.split('/').filter(Boolean)

  for (const route of routes) {
    if (route.method !== method) continue
    const routeSegments = route.path.split('/').filter(Boolean)
    const wildcardIndex = routeSegments.indexOf('*')

    if (wildcardIndex === -1) {
      if (routeSegments.length !== segments.length) continue
    } else if (segments.length < wildcardIndex) {
      continue
    }

    const params: Record<string, string> = {}
    let matched = true
    for (let i = 0; i < routeSegments.length; i++) {
      const expected = routeSegments[i]

      if (expected === '*') {
        params['*'] = segments.slice(i).map((s) => decodeURIComponent(s)).join('/')
        break
      }
      if (expected.startsWith(':')) {
        if (i >= segments.length) {
          matched = false
          break
        }
        params[expected.slice(1)] = decodeURIComponent(segments[i])
      } else if (expected !== segments[i]) {
        matched = false
        break
      }
    }
    if (matched) return { route, params }
  }
  return null
}
