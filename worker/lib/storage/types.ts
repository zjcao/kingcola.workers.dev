/**
 * 存储适配器的最小接口 —— 所有对象存储接入都实现它，业务代码只认这套方法。
 *
 * 插件式接入：实现 StorageAdapter 后调用 registry.ts 的 registerStorageAdapter(id, factory)
 * 注册即可，shared/storage.ts 的 provider 列表 + 本注册表共同决定后台能选到谁。
 */

import type { StorageTargetConfig } from '../../../shared/storage'
import type { Env } from '../../env'

/** 可交给底层存储的请求体形态 */
export type StorageBody = Blob | ArrayBuffer | Uint8Array | ReadableStream

export interface StoredObject {
  body: ReadableStream | null
  contentType: string | null
  etag: string | null
  size: number | null
}

/** 预签名直连信息（url 直接指向桶，不过 Worker） */
export interface PresignedAccess {
  url: string
  method: 'GET' | 'PUT'
  expiresAt: string
}

export interface StorageAdapter {
  readonly id: string
  /** 写入对象；失败应抛错，由调用方决定怎么呈现 */
  put(key: string, body: StorageBody, opts?: { contentType?: string; cacheControl?: string }): Promise<void>
  /** 读取对象；不存在返回 null */
  get(key: string): Promise<StoredObject | null>
  /** 删除对象；对象不存在时不应报错 */
  delete(key: string): Promise<void>
  /**
   * 预签名直传/直链。不支持的实现（如 R2 binding）返回 null，
   * 调用方退化为「一次性令牌 + 单次中转」。
   */
  presign?(key: string, action: 'get' | 'put', ttlSeconds: number): Promise<PresignedAccess | null>
  /** 连通性探测；返回错误消息，null 表示成功 */
  ping(): Promise<string | null>
}

export type StorageAdapterFactory = (target: StorageTargetConfig, env: Env) => StorageAdapter
