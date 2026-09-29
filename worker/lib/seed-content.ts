/**
 * 演示内容初始化。
 *
 * 只在**表为空**时写入，绝不覆盖正式内容 —— 因此可以安全地重复调用
 *（后台「写入演示数据」按钮、首次部署 bootstrap 都走这里）。
 */

import { RESOURCES, isResourceKey } from '../../shared/resources'
import { SEED_BY_RESOURCE } from '../../shared/seed'
import type { Env } from '../env'
import { insertSeedEntity } from './repo'

export interface SeedOutcome {
  [resource: string]: string
}

export async function seedContentIfEmpty(env: Env): Promise<SeedOutcome> {
  const result: SeedOutcome = {}

  for (const [key, items] of Object.entries(SEED_BY_RESOURCE)) {
    if (!isResourceKey(key)) continue
    const def = RESOURCES[key]

    const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${def.table}`).first<{ n: number }>()
    if ((row?.n ?? 0) > 0) {
      result[key] = 'skipped:已有数据'
      continue
    }

    for (const item of items) {
      await insertSeedEntity(env, def, item as unknown as Record<string, unknown>)
    }
    result[key] = `inserted:${items.length}`
  }

  return result
}
