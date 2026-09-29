/**
 * S3 兼容 API 适配器 —— 一个实现通吃 AWS S3 / Cloudflare R2 S3 端点 / MinIO /
 * 腾讯 COS / 阿里 OSS（S3 兼容模式）等绝大多数对象存储。
 *
 * 所有操作都基于 SigV4 查询串预签名（UNSIGNED-PAYLOAD，见 sigv4.ts）：
 *   - put/get/delete = 自己给自己签 URL 再自己 fetch，请求体不参与签名；
 *   - presign        = 直接把签好的 URL 交给浏览器，**直连桶、不过 Worker**。
 */

import type { StorageTargetConfig } from '../../../shared/storage'
import { presignS3Url, s3ObjectPath, type SigV4Credentials } from './sigv4'
import type { PresignedAccess, StorageAdapter, StorageAdapterFactory, StorageBody } from './types'

/**
 * 桶内对象地址（forcePathStyle / 虚拟主机两种寻址）。
 * 注意：pathPrefix 由门面（index.ts）负责拼接，适配器只管「拿到的 key 就是完整 key」。
 */
function objectEndpoint(target: StorageTargetConfig, key: string): URL {
  const base = target.endpoint.trim().replace(/\/+$/, '')
  const bucket = target.bucket.trim()
  const path = s3ObjectPath(key)
  if (target.forcePathStyle) {
    return new URL(`${base}/${bucket}/${path}`)
  }
  const parsed = new URL(base)
  return new URL(`${parsed.protocol}//${bucket}.${parsed.host}/${path}`)
}

export const s3Adapter: StorageAdapterFactory = (target): StorageAdapter => {
  const credentials: SigV4Credentials = {
    accessKeyId: target.accessKeyId.trim(),
    secretAccessKey: target.secretAccessKey,
    region: target.region.trim() || 'auto',
  }
  const ttl = target.directTtlSeconds > 0 ? target.directTtlSeconds : 900

  const presign = async (key: string, action: 'get' | 'put', ttlSeconds: number): Promise<PresignedAccess> => {
    const method = action === 'get' ? 'GET' : 'PUT'
    const url = await presignS3Url(method, objectEndpoint(target, key), credentials, ttlSeconds)
    return {
      url: url.toString(),
      method,
      expiresAt: new Date(Date.now() + Math.max(1, ttlSeconds) * 1000).toISOString(),
    }
  }

  return {
    id: 's3',

    async put(key: string, body: StorageBody, opts?: { contentType?: string; cacheControl?: string }) {
      const signed = await presign(key, 'put', ttl)
      const headers: Record<string, string> = {}
      if (opts?.contentType) headers['content-type'] = opts.contentType
      if (opts?.cacheControl) headers['cache-control'] = opts.cacheControl
      const response = await fetch(signed.url, { method: 'PUT', body: body as BodyInit, headers })
      if (!response.ok) {
        const detail = await response.text().catch(() => '')
        throw new Error(`S3_PUT_FAILED: HTTP ${response.status} ${detail.slice(0, 200)}`.trim())
      }
    },

    async get(key) {
      const signed = await presign(key, 'get', ttl)
      const response = await fetch(signed.url, { method: 'GET' })
      if (response.status === 404) return null
      if (!response.ok) {
        throw new Error(`S3_GET_FAILED: HTTP ${response.status}`)
      }
      return {
        body: response.body,
        contentType: response.headers.get('content-type'),
        etag: response.headers.get('etag'),
        size: Number(response.headers.get('content-length')) || null,
      }
    },

    async delete(key) {
      const url = await presignS3Url('DELETE', objectEndpoint(target, key), credentials, 60)
      const response = await fetch(url, { method: 'DELETE' })
      // 404 = 本来就不存在，按幂等成功处理
      if (!response.ok && response.status !== 404) {
        throw new Error(`S3_DELETE_FAILED: HTTP ${response.status}`)
      }
    },

    presign,

    async ping() {
      // 对一个大概率不存在的 key 发预签名 GET：404 = 认证与桶都通；403 = 密钥/权限/桶名不对
      try {
        const probe = objectEndpoint(target, '.kc-storage-probe')
        const signed = await presignS3Url('GET', probe, credentials, 60)
        const response = await fetch(signed, { method: 'GET' })
        if (response.ok || response.status === 404) return null
        if (response.status === 403) return '认证失败（403）：请检查 Access Key、Secret 与桶名'
        return `探测返回 HTTP ${response.status}`
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
  }
}
