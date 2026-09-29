/**
 * 对象存储管理接口（配置类需管理员会话；直连令牌本身即凭证，不要求会话）。
 *
 *   GET  /api/admin/storage                 当前配置（secret 已抹除）+ 可用 provider/绑定
 *   PUT  /api/admin/storage                 保存配置（secret 留空 = 保留旧值）
 *   POST /api/admin/storage/test            连通性探测（按 purpose）
 *   POST /api/admin/storage/direct-token    签发直连访问（预签名 URL / 一次性令牌）
 *   GET  /api/files/direct/:token           消费一次性令牌读取（单次有效）
 *   PUT  /api/files/direct/:token           消费一次性令牌写入（单次有效）
 */

import {
  STORAGE_PURPOSE_LABELS,
  storageTargetStatusText,
  toTargetView,
  type DirectAccessInfo,
  type StorageConfigView,
  type StoragePurpose,
  type StorageTargetConfig,
} from '../../shared/storage'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import { writeAudit } from '../lib/repo'
import type { RequestContext } from '../lib/router'
import {
  consumeDirectToken,
  getRegisteredAdapter,
  getStorage,
  getStorageConfig,
  issueDirectAccess,
  listRegisteredAdapterIds,
  saveStorageConfig,
  targetReady,
} from '../lib/storage'

function isPurpose(value: unknown): value is StoragePurpose {
  return value === 'site' || value === 'applications'
}

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

/** 从 env 里挑出「长得像 R2Bucket」的绑定名，供管理页的绑定名下拉提示 */
function detectBucketBindings(env: RequestContext['env']): string[] {
  return Object.keys(env as unknown as Record<string, unknown>).filter((key) => {
    const value = (env as unknown as Record<string, unknown>)[key]
    if (!value || typeof value !== 'object') return false
    const candidate = value as Record<string, unknown>
    // R2Bucket 独有 head()（KVNamespace 也有 get/put/delete/list，会被误判）
    return (
      typeof candidate.get === 'function' &&
      typeof candidate.put === 'function' &&
      typeof candidate.delete === 'function' &&
      typeof candidate.head === 'function'
    )
  })
}

// ===== 配置 =====

export async function getStorageAdmin(ctx: RequestContext): Promise<Response> {
  const config = await getStorageConfig(ctx.env)
  const view: StorageConfigView = {
    site: toTargetView(config.site),
    applications: toTargetView(config.applications),
  }
  return ok({
    config: view,
    providers: [...new Set([...listRegisteredAdapterIds()])],
    bindings: detectBucketBindings(ctx.env),
    ready: {
      site: targetReady(ctx.env, config.site),
      applications: targetReady(ctx.env, config.applications),
    },
  })
}

interface StoragePatchBody {
  site?: Partial<StorageTargetConfig>
  applications?: Partial<StorageTargetConfig>
}

export async function updateStorageAdmin(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<StoragePatchBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  // provider 必须是已注册的适配器（内置或插件）
  for (const target of [body.site, body.applications]) {
    if (target?.provider && !getRegisteredAdapter(target.provider)) {
      return fail(400, 'UNKNOWN_PROVIDER', `未注册的存储适配器：${target.provider}`)
    }
  }

  const next = await saveStorageConfig(ctx.env, body)

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'update',
    resource: 'storage_config',
    detail: `site=${next.site.provider}:${next.site.bucket || next.site.binding} applications=${next.applications.provider}:${next.applications.bucket || next.applications.binding}`,
    ip: clientIp(ctx.request),
    ua: ctx.request.headers.get('user-agent') ?? '',
  })

  return ok({
    config: { site: toTargetView(next.site), applications: toTargetView(next.applications) },
  })
}

// ===== 连通性探测 =====

export async function testStorage(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<{ purpose?: string }>(ctx.request)
  if (!body || !isPurpose(body.purpose)) {
    return fail(400, 'INVALID_BODY', "purpose 必须是 'site' 或 'applications'")
  }
  const purpose = body.purpose
  const config = await getStorageConfig(ctx.env)
  if (!targetReady(ctx.env, config[purpose])) {
    return ok({
      ok: false,
      message: `${STORAGE_PURPOSE_LABELS[purpose]}：${storageTargetStatusText(config[purpose])}`,
    })
  }
  try {
    const message = await (await getStorage(ctx.env, purpose)).ping()
    return ok({ ok: message === null, message: message ?? `${STORAGE_PURPOSE_LABELS[purpose]}连接正常` })
  } catch (error) {
    return ok({ ok: false, message: error instanceof Error ? error.message : String(error) })
  }
}

// ===== 直连访问 =====

interface DirectTokenBody {
  purpose?: string
  key?: string
  /** 'get' 读取 / 'put' 直传 */
  action?: string
  ttlSeconds?: number
}

/** 签发直连访问：s3 模式给预签名 URL（真直连），r2 binding 给一次性令牌（单次中转） */
export async function issueDirectTokenRoute(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<DirectTokenBody>(ctx.request)
  if (!body || !isPurpose(body.purpose)) {
    return fail(400, 'INVALID_BODY', "purpose 必须是 'site' 或 'applications'")
  }
  const purpose = body.purpose
  const key = (body.key ?? '').trim().replace(/^\/+/, '')
  if (!key || key.includes('..')) return fail(400, 'INVALID_KEY', '对象 key 不合法')
  if (body.action !== 'get' && body.action !== 'put') {
    return fail(400, 'INVALID_ACTION', "action 必须是 'get' 或 'put'")
  }

  try {
    const info: DirectAccessInfo = await issueDirectAccess(
      ctx.env,
      purpose,
      key,
      body.action === 'put' ? 'PUT' : 'GET',
      body.ttlSeconds,
    )
    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'issue_direct_token',
      resource: 'storage',
      targetId: `${purpose}/${key}`,
      detail: `${info.mode} ${info.method} 有效期至 ${info.expiresAt}`,
      ip: clientIp(ctx.request),
      ua: ctx.request.headers.get('user-agent') ?? '',
    })
    return ok(info)
  } catch (error) {
    return fail(503, 'DIRECT_ISSUE_FAILED', error instanceof Error ? error.message : '签发直连访问失败')
  }
}

/** 一次性令牌读取：令牌即凭证，用后即焚 */
export async function consumeDirectDownload(ctx: RequestContext): Promise<Response> {
  const payload = await consumeDirectToken(ctx.env, ctx.params.token ?? '')
  if (!payload || payload.method !== 'GET') {
    return fail(403, 'TOKEN_INVALID', '直连令牌无效、已使用或已过期')
  }
  const object = await (await getStorage(ctx.env, payload.purpose)).get(payload.key)
  if (!object) return fail(404, 'FILE_NOT_FOUND', '对象不存在或已被删除')

  return new Response(object.body as unknown as BodyInit, {
    headers: {
      'content-type': object.contentType ?? 'application/octet-stream',
      'cache-control': 'no-store',
    },
  })
}

/** 一次性令牌直传：令牌即凭证，用后即焚 */
export async function consumeDirectUpload(ctx: RequestContext): Promise<Response> {
  const payload = await consumeDirectToken(ctx.env, ctx.params.token ?? '')
  if (!payload || payload.method !== 'PUT') {
    return fail(403, 'TOKEN_INVALID', '直连令牌无效、已使用或已过期')
  }
  await (
    await getStorage(ctx.env, payload.purpose)
  ).put(payload.key, ctx.request.body as unknown as ReadableStream, {
    contentType: ctx.request.headers.get('content-type') ?? undefined,
  })
  return ok({ key: payload.key })
}
