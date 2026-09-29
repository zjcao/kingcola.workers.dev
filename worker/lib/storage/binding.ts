/**
 * Cloudflare R2 binding 适配器 —— 直接操作 wrangler.toml 声明的 R2Bucket。
 *
 * 优点：零密钥、零配置、Workers 内网直连不占公网流量。
 * 限制：binding 不支持 SigV4 预签名，「直连」退化为
 *       一次性令牌（KV 保证只能用一次）+ Worker 单次中转（routes/storage.ts）。
 */

import type { Env } from '../../env'
import type { StorageAdapter, StorageAdapterFactory, StorageBody } from './types'

function resolveBucket(env: Env, name: string): R2Bucket | null {
  if (!name.trim()) return null
  const value = (env as unknown as Record<string, unknown>)[name.trim()]
  if (!value || typeof value !== 'object') return null
  const candidate = value as Partial<R2Bucket>
  return typeof candidate.get === 'function' && typeof candidate.put === 'function' ? (value as R2Bucket) : null
}

export const r2BindingAdapter: StorageAdapterFactory = (target, env): StorageAdapter => {
  const bindingName = target.binding.trim()

  return {
    id: 'r2',

    async put(key: string, body: StorageBody, opts?: { contentType?: string; cacheControl?: string }) {
      const bucket = resolveBucket(env, bindingName)
      if (!bucket) throw new Error(`STORAGE_UNAVAILABLE: 未找到 R2 绑定 ${bindingName}`)
      await bucket.put(key, body as unknown as Parameters<R2Bucket['put']>[1], {
        httpMetadata: {
          ...(opts?.contentType ? { contentType: opts.contentType } : {}),
          ...(opts?.cacheControl ? { cacheControl: opts.cacheControl } : {}),
        },
      })
    },

    async get(key) {
      const bucket = resolveBucket(env, bindingName)
      if (!bucket) return null
      const object = await bucket.get(key)
      if (!object) return null
      return {
        body: object.body,
        contentType: object.httpMetadata?.contentType ?? null,
        etag: object.httpEtag,
        size: object.size,
      }
    },

    async delete(key) {
      const bucket = resolveBucket(env, bindingName)
      await bucket?.delete(key)
    },

    async ping() {
      if (!resolveBucket(env, bindingName)) {
        return `未找到 R2 绑定 ${bindingName}（检查 wrangler.toml 是否声明、部署是否生效）`
      }
      return null
    },
  }
}
