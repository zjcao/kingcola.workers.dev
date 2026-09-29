/**
 * Cloudflare Pages Functions 适配层。
 *
 * 本项目原本是 Workers + Static Assets（`worker/index.ts` 导出一个 fetch 处理器）。
 * Pages Functions 与 Worker 是**同一个运行时**，所以这里只是把那个处理器原样挂上去 ——
 * 业务代码一行都不用改。
 *
 * 两个形态的差别由配置承担：
 *   · Workers：`run_worker_first = ["/api/*"]`（只有 /api/* 进 Worker）
 *   · Pages  ：`public/_routes.json` 的 `include: ["/api/*"]`（同一件事）
 * 静态资源两边都由边缘直接返回，不消耗函数调用。
 *
 * 注意：Pages 里没有 `ASSETS` 绑定，Worker 侧凡是「回落到静态资源」的分支
 * 交给 Pages 自己处理即可（Pages 默认就是「先静态，命中 include 才进 Function」）。
 */
import worker from '../worker/index'

interface PagesContext {
  request: Request
  env: Record<string, unknown>
  waitUntil: (promise: Promise<unknown>) => void
}

export const onRequest = (context: PagesContext): Promise<Response> =>
  // worker/index.ts 导出的是标准的 `{ fetch(request, env, ctx) }`
  (worker as { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> }).fetch(
    context.request,
    context.env,
    context,
  )
