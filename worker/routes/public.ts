/**
 * 公开只读接口（匿名可访问，可被 CDN 缓存）。
 *
 * 关键设计：`/api/public/bootstrap` 用一次请求返回前台首屏所需的全部数据，
 * 把招新高峰期的请求数从 5 次压到 1 次，显著降低 Worker 调用量与首屏时间。
 */

import { RESOURCES, isResourceKey } from '../../shared/resources'
import { isSsoReady } from '../../shared/runtime'
import {
  applyGate,
  isApplyOpen,
  recruitNotice,
  RECRUIT_STATE_LABELS,
  type RecruitPublicStatus,
} from '../../shared/recruit'
import { cacheable, fail, ok } from '../lib/http'
import { getRecruitSettings } from '../lib/recruit-config'
import { getSiteConfig, listEntities } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { getStorageConfig, targetReady } from '../lib/storage'
import { resolveRuntimeConfig } from './config'

/** 公开内容缓存 30 秒：后台改完内容最迟 30 秒内全球生效，同时挡住绝大部分重复请求 */
const PUBLIC_MAX_AGE = 30

export async function getSiteConfigRoute(ctx: RequestContext): Promise<Response> {
  return cacheable(await getSiteConfig(ctx.env), PUBLIC_MAX_AGE)
}

export async function getPublicContent(ctx: RequestContext): Promise<Response> {
  const key = ctx.params.resource
  if (!isResourceKey(key)) {
    return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${key}`)
  }
  const def = RESOURCES[key]
  if (!def.isPublic) {
    return fail(403, 'RESOURCE_PRIVATE', '该内容不允许公开读取')
  }

  const search = ctx.url.searchParams.get('q') ?? undefined
  const limit = Number(ctx.url.searchParams.get('limit') ?? 500)

  return cacheable(await listEntities(ctx.env, def, { search, limit }), PUBLIC_MAX_AGE)
}

/** 前台首屏聚合接口：一次请求拿全部内容 */
export async function getBootstrap(ctx: RequestContext): Promise<Response> {
  const [members, projects, news, slides, site, recruitSettings] = await Promise.all([
    listEntities(ctx.env, RESOURCES.members, { limit: 500 }),
    listEntities(ctx.env, RESOURCES.projects, { limit: 200 }),
    listEntities(ctx.env, RESOURCES.news, { limit: 200 }),
    listEntities(ctx.env, RESOURCES.slides, { limit: 20 }),
    getSiteConfig(ctx.env),
    // 招新状态顺带带上：首页横幅与顶部提示的显隐由它派生，前台不必再发一次请求
    getRecruitSettings(ctx.env),
  ])

  const cycle = recruitSettings.cycle
  const recruit: RecruitPublicStatus = {
    state: cycle.state,
    stateLabel: RECRUIT_STATE_LABELS[cycle.state],
    applyOpen: isApplyOpen(cycle.state),
    gate: applyGate(cycle.state),
    name: cycle.name,
    notice: recruitNotice(cycle),
  }

  return cacheable({ members, projects, news, slides, site, recruit }, PUBLIC_MAX_AGE)
}

/** 无副作用探活，用于部署自检与前端调试 */
export async function health(ctx: RequestContext): Promise<Response> {
  const started = Date.now()
  let database = 'ok'
  try {
    await ctx.env.DB.prepare('SELECT 1 AS ok').first()
  } catch {
    database = 'error'
  }

  // 是否接通以后台设置（D1）为准，环境变量只是引导值
  const [runtime, storageConfig] = await Promise.all([resolveRuntimeConfig(ctx), getStorageConfig(ctx.env)])

  return ok({
    service: 'kingcola',
    database,
    ssoEnabled: runtime.sso.enabled,
    ssoConfigured: isSsoReady(runtime.sso),
    // 两个业务目标各自是否接通（配置在后台「对象存储」页维护）
    storage: {
      site: targetReady(ctx.env, storageConfig.site),
      applications: targetReady(ctx.env, storageConfig.applications),
    },
    bindings: {
      kv: Boolean(ctx.env.CONFIG_KV),
      // 文件存储的接通状态看上面的 storage（按业务目标判定，S3 兼容存储同样算接通），
      // 这里不再报告某个具体绑定，避免「没配 R2 但配了 S3」时被误判为未接通
      adminSecret: Boolean(ctx.env.SESSION_SECRET),
      studentSecret: Boolean(ctx.env.STUDENT_SESSION_SECRET),
      ssoClientSecret: Boolean(ctx.env.SSO_CLIENT_SECRET),
      qrSignSecret: Boolean(ctx.env.QR_SIGN_SECRET),
      // 「是否已安装」不在这里报：它要查 D1，而 health 是同步拼装的轻接口。
      // 安装页用 `/api/config/runtime` 的 `initialized`（表还没建时它会报错 = 未安装）判断。
    },
    elapsedMs: Date.now() - started,
  })
}
