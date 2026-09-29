/**
 * 存储适配器注册表（插件机制）。
 *
 * 内置适配器（r2 / s3）在文件末尾自注册；第三方接入只需：
 *   1. 写一个实现 StorageAdapter 的工厂（可放在 storage/plugins/ 下）；
 *   2. 在本文件（或 index.ts）里 import 并 registerStorageAdapter('<id>', factory)；
 *   3. 需要出现在后台下拉里的话，往 shared/storage.ts 的 BUILTIN_STORAGE_PROVIDERS 追加元数据。
 *
 * 业务代码永远通过 getStorage(env, purpose) 取门面，感知不到具体服务商。
 */

import type { StorageAdapterFactory } from './types'

const registry = new Map<string, StorageAdapterFactory>()

export function registerStorageAdapter(id: string, factory: StorageAdapterFactory): void {
  registry.set(id, factory)
}

export function getRegisteredAdapter(id: string): StorageAdapterFactory | null {
  return registry.get(id) ?? null
}

export function listRegisteredAdapterIds(): string[] {
  return [...registry.keys()]
}

// ---- 内置适配器注册 ----
import { r2BindingAdapter } from './binding'
import { s3Adapter } from './s3'

registerStorageAdapter('r2', r2BindingAdapter)
registerStorageAdapter('s3', s3Adapter)
