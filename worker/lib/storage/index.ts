/**
 * 对象存储门面 —— 业务模块唯一应该 import 的入口。
 *
 *   const storage = await getStorage(env, 'site')
 *   await storage.put(key, file, { contentType: 'image/png' })
 *   const object = await storage.get(key)
 *   await storage.delete(key)
 *   storage.objectUrl(key)            // 数据库里存的访问地址
 *
 * 职责：
 *   1. 从 D1 读两个业务目标（site / applications）的配置并合并默认值；
 *   2. 按 provider 从注册表实例化适配器（插件机制见 registry.ts）；
 *   3. 统一处理 pathPrefix 与访问地址（/api/files/ 中转 or publicBase 直链）；
 *   4. 提供一次性直连令牌（KV 保证只能用一次）作为 binding 模式的直连兜底。
 */

import {
  DEFAULT_STORAGE_CONFIG,
  isTargetConfigured,
  mergeStorageConfig,
  type DirectAccessInfo,
  type StorageConfig,
  type StoragePurpose,
  type StorageTargetConfig,
} from '../../../shared/storage'
import { APPLICATION_DOC_SCOPE } from '../../../shared/recruit'
import type { Env } from '../../env'
import { getConfigValue, setConfigValue } from '../repo'
import { getRegisteredAdapter } from './registry'
import type { PresignedAccess, StorageAdapter, StorageBody, StoredObject } from './types'

export type { PresignedAccess, StorageAdapter, StorageBody, StoredObject } from './types'
export { registerStorageAdapter, listRegisteredAdapterIds, getRegisteredAdapter } from './registry'

const STORAGE_CONFIG_KEY = 'storage'

// ===== 配置读写 =====

export async function getStorageConfig(env: Env): Promise<StorageConfig> {
  const stored = await getConfigValue<Partial<StorageConfig>>(env, STORAGE_CONFIG_KEY)
  if (!stored) return structuredClone(DEFAULT_STORAGE_CONFIG)
  return mergeStorageConfig(DEFAULT_STORAGE_CONFIG, stored)
}

/**
 * 保存配置。secret 留空 = 保留旧值（前端拿不到旧密钥，不能要求它回传）；
 * 只挑选已知字段（客户端回传的是 secret 已抹掉的视图，携带 secretConfigured 等额外键）；
 * pathPrefix 做清洗，防止路径穿越。
 */
export async function saveStorageConfig(
  env: Env,
  patch: { site?: Partial<StorageTargetConfig>; applications?: Partial<StorageTargetConfig> },
): Promise<StorageConfig> {
  const current = await getStorageConfig(env)
  const clean = (raw: Partial<StorageTargetConfig> | undefined, previous: StorageTargetConfig): StorageTargetConfig | undefined => {
    if (!raw) return undefined
    return {
      provider: raw.provider ?? previous.provider,
      binding: (raw.binding ?? previous.binding).trim(),
      endpoint: (raw.endpoint ?? previous.endpoint).trim(),
      region: (raw.region ?? previous.region).trim(),
      bucket: (raw.bucket ?? previous.bucket).trim(),
      accessKeyId: (raw.accessKeyId ?? previous.accessKeyId).trim(),
      secretAccessKey: raw.secretAccessKey?.trim() || previous.secretAccessKey || '',
      pathPrefix: (raw.pathPrefix ?? previous.pathPrefix).replace(/\\/g, '/').replace(/\.{2,}/g, '').replace(/^\/+|\/+$/g, ''),
      publicBase: (raw.publicBase ?? previous.publicBase).trim(),
      forcePathStyle: raw.forcePathStyle ?? previous.forcePathStyle,
      directTtlSeconds: Math.min(604800, Math.max(60, Number(raw.directTtlSeconds ?? previous.directTtlSeconds) || 900)),
    }
  }
  const next = mergeStorageConfig(current, {
    site: clean(patch.site, current.site),
    applications: clean(patch.applications, current.applications),
  })
  await setConfigValue(env, STORAGE_CONFIG_KEY, next)
  return next
}

// ===== 目标与适配器 =====

/** 目标当前是否可用：r2 看绑定是否存在，s3 看必填项是否填齐 */
export function targetReady(env: Env, target: StorageTargetConfig): boolean {
  if (!isTargetConfigured(target)) return false
  if (target.provider !== 's3') {
    const value = (env as unknown as Record<string, unknown>)[target.binding.trim()]
    return Boolean(value && typeof value === 'object')
  }
  return getRegisteredAdapter(target.provider) !== null
}

/** 桶内逻辑 key → 实际 key（拼接 pathPrefix） */
function fullKey(target: StorageTargetConfig, key: string): string {
  const prefix = target.pathPrefix.trim().replace(/^\/+|\/+$/g, '')
  return prefix ? `${prefix}/${key.replace(/^\/+/, '')}` : key
}

export class Storage {
  readonly purpose: StoragePurpose
  readonly target: StorageTargetConfig
  private readonly env: Env

  constructor(purpose: StoragePurpose, target: StorageTargetConfig, env: Env) {
    this.purpose = purpose
    this.target = target
    this.env = env
  }

  /** 适配器实例；provider 未注册时抛错（管理页会拦截未知 provider，这里只是兜底） */
  adapter(): StorageAdapter {
    const factory = getRegisteredAdapter(this.target.provider)
    if (!factory) throw new Error(`STORAGE_PROVIDER_MISSING: 未注册的存储适配器 ${this.target.provider}`)
    return factory(this.target, this.env)
  }

  /** 数据库里应存的访问地址：站点图优先 publicBase 直链，其余走 /api/files/ 中转 */
  objectUrl(key: string): string {
    if (this.purpose === 'site' && this.target.publicBase.trim()) {
      const base = this.target.publicBase.trim().replace(/\/+$/, '')
      return `${base}/${fullKey(this.target, key)}`
    }
    return `/api/files/${key}`
  }

  async put(key: string, body: StorageBody, opts?: { contentType?: string; cacheControl?: string }) {
    await this.adapter().put(fullKey(this.target, key), body, opts)
  }

  async get(key: string): Promise<StoredObject | null> {
    return this.adapter().get(fullKey(this.target, key))
  }

  async delete(key: string) {
    await this.adapter().delete(fullKey(this.target, key))
  }

  /**
   * 预签名直连（s3 模式）：URL 直指桶，不过 Worker。
   * 返回 null 表示当前适配器不支持（r2 binding），调用方退化为一次性令牌。
   */
  async presign(key: string, action: 'get' | 'put', ttlSeconds?: number): Promise<PresignedAccess | null> {
    const adapter = this.adapter()
    if (!adapter.presign) return null
    return adapter.presign(fullKey(this.target, key), action, ttlSeconds ?? this.target.directTtlSeconds)
  }

  /** 连通性探测；返回错误消息，null 表示成功 */
  async ping(): Promise<string | null> {
    return this.adapter().ping()
  }
}

export async function getStorage(env: Env, purpose: StoragePurpose): Promise<Storage> {
  const config = await getStorageConfig(env)
  return new Storage(purpose, config[purpose], env)
}

/** 目标可用性快捷判断（上传/提交入口的 503 检查用） */
export async function storageReady(env: Env, purpose: StoragePurpose): Promise<boolean> {
  const config = await getStorageConfig(env)
  return targetReady(env, config[purpose])
}

// ===== 地址 ↔ key 反解 =====

/** 中转前缀：数据库历史数据与私有文件都存这个形态 */
const FILE_URL_PREFIX = '/api/files/'

/** 按 key 前缀判断归属：applications/ 前缀属于报名表目标，其余归站点图片 */
export function purposeFromKey(key: string): StoragePurpose {
  return key.startsWith(`${APPLICATION_DOC_SCOPE}/`) ? 'applications' : 'site'
}

/**
 * 数据库里的文件地址 → { purpose, key }。
 * 兼容两种形态：`/api/files/<key>`（中转）与 `${publicBase}/<fullKey>`（站点直链）。
 */
export async function resolveFileRef(env: Env, url: string | undefined | null): Promise<{ purpose: StoragePurpose; key: string } | null> {
  if (!url) return null
  const clean = url.trim()
  if (clean.startsWith(FILE_URL_PREFIX)) {
    const key = clean.slice(FILE_URL_PREFIX.length).split('?')[0].replace(/^\/+/, '')
    if (!key || key.includes('..')) return null
    return { purpose: purposeFromKey(key), key }
  }
  const config = await getStorageConfig(env)
  const base = config.site.publicBase.trim().replace(/\/+$/, '')
  if (base && clean.startsWith(`${base}/`)) {
    const full = clean.slice(base.length + 1).split('?')[0]
    const prefix = config.site.pathPrefix.trim().replace(/^\/+|\/+$/g, '')
    const key = prefix && full.startsWith(`${prefix}/`) ? full.slice(prefix.length + 1) : full
    if (!key || key.includes('..')) return null
    return { purpose: 'site', key }
  }
  return null
}

/** 删除库里引用的文件；外部链接或失败都静默忽略（只留下孤儿对象，不阻断业务） */
export async function deleteStoredFile(env: Env, url: string | undefined | null): Promise<void> {
  try {
    const ref = await resolveFileRef(env, url)
    if (!ref) return
    await (await getStorage(env, ref.purpose)).delete(ref.key)
  } catch {
    // 清理失败不阻断主流程
  }
}

// ===== 一次性直连令牌（r2 binding 模式的直连兜底） =====

const DIRECT_TOKEN_PREFIX = 'kc-direct:'

interface DirectTokenPayload {
  purpose: StoragePurpose
  key: string
  method: 'GET' | 'PUT'
  exp: number
}

/**
 * 签发一次性令牌：令牌换 key 与动作，且**只能用一次**（消费即删除）。
 * 需要 CONFIG_KV；没有 KV 时该能力不可用（预签名直连不受影响）。
 */
export async function issueDirectToken(
  env: Env,
  payload: { purpose: StoragePurpose; key: string; method: 'GET' | 'PUT' },
  ttlSeconds: number,
): Promise<{ token: string; expiresAt: string }> {
  if (!env.CONFIG_KV) throw new Error('NEED_KV: 一次性令牌需要绑定 KV（CONFIG_KV）')
  const token = crypto.randomUUID().replace(/-/g, '')
  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString()
  await env.CONFIG_KV.put(
    `${DIRECT_TOKEN_PREFIX}${token}`,
    JSON.stringify({ ...payload, exp: Date.now() + ttlSeconds * 1000 } satisfies DirectTokenPayload),
    { expirationTtl: Math.max(60, ttlSeconds + 60) },
  )
  return { token, expiresAt }
}

/** 消费一次性令牌：先删后用，保证 token 只能兑换一次 */
export async function consumeDirectToken(env: Env, token: string): Promise<DirectTokenPayload | null> {
  if (!env.CONFIG_KV || !token || token.includes('/')) return null
  const cacheKey = `${DIRECT_TOKEN_PREFIX}${token}`
  const raw = await env.CONFIG_KV.get(cacheKey)
  if (!raw) return null
  await env.CONFIG_KV.delete(cacheKey)
  try {
    const payload = JSON.parse(raw) as DirectTokenPayload
    if (!payload.exp || payload.exp < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

/** 统一直连签发入口：预签名优先，退化一次性令牌 */
export async function issueDirectAccess(
  env: Env,
  purpose: StoragePurpose,
  key: string,
  method: 'GET' | 'PUT',
  ttlSeconds?: number,
): Promise<DirectAccessInfo> {
  const storage = await getStorage(env, purpose)
  const ttl = ttlSeconds && ttlSeconds > 0 ? Math.min(604800, ttlSeconds) : storage.target.directTtlSeconds
  const presigned = method === 'GET' ? await storage.presign(key, 'get', ttl) : await storage.presign(key, 'put', ttl)
  if (presigned) {
    return { mode: 'presigned', method, purpose, key, url: presigned.url, expiresAt: presigned.expiresAt }
  }
  const issued = await issueDirectToken(env, { purpose, key, method }, ttl)
  return {
    mode: 'one-time',
    method,
    purpose,
    key,
    url: `/api/files/direct/${issued.token}`,
    expiresAt: issued.expiresAt,
  }
}
