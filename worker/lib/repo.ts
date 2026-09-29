import {
  columnList,
  defaultEntity,
  entityToRow,
  isSafeIdentifier,
  normalizeId,
  rowToEntity,
  type ResourceDef,
} from '../../shared/resources'
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '../../shared/types'
import type { Env } from '../env'
import { randomId } from './crypto'

export type Entity = Record<string, unknown>

export interface ListOptions {
  search?: string
  limit?: number
  offset?: number
}

const CONFIG_SITE_KEY = 'site'

function searchClause(def: ResourceDef, search?: string): { where: string; binds: unknown[] } {
  const term = search?.trim()
  if (!term || def.searchKeys.length === 0) return { where: '', binds: [] }

  const clauses: string[] = []
  const binds: unknown[] = []
  for (const key of def.searchKeys) {
    const field = def.fields.find((f) => f.key === key)
    if (!field || !isSafeIdentifier(field.column)) continue
    clauses.push(`${field.column} LIKE ?`)
    binds.push(`%${term}%`)
  }
  if (clauses.length === 0) return { where: '', binds: [] }
  return { where: ` WHERE (${clauses.join(' OR ')})`, binds }
}

export async function listEntities(env: Env, def: ResourceDef, options: ListOptions = {}): Promise<Entity[]> {
  const { where, binds } = searchClause(def, options.search)
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 1000)
  const offset = Math.max(options.offset ?? 0, 0)

  const sql = `SELECT ${columnList(def).join(', ')} FROM ${def.table}${where} ORDER BY ${def.orderBy} LIMIT ? OFFSET ?`
  const result = await env.DB.prepare(sql)
    .bind(...binds, limit, offset)
    .all<Record<string, unknown>>()

  return (result.results ?? []).map((row) => rowToEntity(def, row))
}

export async function countEntities(env: Env, def: ResourceDef, search?: string): Promise<number> {
  const { where, binds } = searchClause(def, search)
  const row = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${def.table}${where}`)
    .bind(...binds)
    .first<{ n: number }>()
  return row?.n ?? 0
}

export async function getEntity(env: Env, def: ResourceDef, id: string): Promise<Entity | null> {
  const row = await env.DB.prepare(
    `SELECT ${columnList(def).join(', ')} FROM ${def.table} WHERE id = ?`,
  )
    .bind(normalizeId(def, id))
    .first<Record<string, unknown>>()
  return row ? rowToEntity(def, row) : null
}

export async function createEntity(env: Env, def: ResourceDef, input: Entity): Promise<Entity> {
  const now = new Date().toISOString()
  // 创建时先用资源默认值补齐缺省字段，保证 INSERT 覆盖**全部**列 ——
  // 这样「新增」出来的记录每个字段都有明确取值，而不是依赖建表 SQL 的 DEFAULT。
  const row = entityToRow(def, { ...defaultEntity(def), ...input })
  const columns = Object.keys(row)

  // 自增主键：不带 id 插入，用 D1 返回的 last_row_id 取回分配到的值
  if (def.autoId) {
    const insertColumns = [...columns, 'created_at', 'updated_at']
    const sql = `INSERT INTO ${def.table} (${insertColumns.join(', ')}) VALUES (${insertColumns
      .map(() => '?')
      .join(', ')})`
    const result = await env.DB.prepare(sql)
      .bind(...columns.map((c) => row[c]), now, now)
      .run()

    const newId = result.meta?.last_row_id
    if (newId) {
      const created = await getEntity(env, def, String(newId))
      if (created) return created
    }
    return { id: Number(newId ?? 0), ...input }
  }

  const id = typeof input.id === 'string' && input.id.trim() ? input.id.trim() : randomId(def.key.slice(0, 2))
  const insertColumns = ['id', ...columns, 'created_at', 'updated_at']
  const sql = `INSERT INTO ${def.table} (${insertColumns.join(', ')}) VALUES (${insertColumns
    .map(() => '?')
    .join(', ')})`
  await env.DB.prepare(sql)
    .bind(id, ...columns.map((c) => row[c]), now, now)
    .run()

  // 回读整行再返回：新增接口的返回值要和后续「读」的完全同形（字段一个不少）。
  // 不能直接返回 input —— 那样补上的默认值与时间戳都看不到，读写两端形状会不一致。
  return (await getEntity(env, def, id)) ?? { id, ...input }
}

export async function updateEntity(
  env: Env,
  def: ResourceDef,
  id: string,
  input: Entity,
): Promise<Entity | null> {
  const existing = await getEntity(env, def, id)
  if (!existing) return null

  const row = entityToRow(def, input)
  const columns = Object.keys(row).filter((c) => isSafeIdentifier(c))
  if (columns.length === 0) return existing

  const now = new Date().toISOString()
  const assignments = columns.map((c) => `${c} = ?`).join(', ')
  await env.DB.prepare(`UPDATE ${def.table} SET ${assignments}, updated_at = ? WHERE id = ?`)
    .bind(...columns.map((c) => row[c]), now, normalizeId(def, id))
    .run()

  return { ...existing, ...input, id: existing.id }
}

export async function deleteEntity(env: Env, def: ResourceDef, id: string): Promise<boolean> {
  const result = await env.DB.prepare(`DELETE FROM ${def.table} WHERE id = ?`)
    .bind(normalizeId(def, id))
    .run()
  return (result.meta?.changes ?? 0) > 0
}

/**
 * 种子数据写入。
 * 非自增主键按 id 覆盖；自增主键直接插入（由调用方保证只在空表上执行）。
 */
export async function insertSeedEntity(env: Env, def: ResourceDef, entity: Entity): Promise<void> {
  const now = new Date().toISOString()
  // 与 createEntity 同一口径：种子数据也补齐全部列，缺省值不落到建表 SQL 的 DEFAULT 上
  const row = entityToRow(def, { ...defaultEntity(def), ...entity })
  const columns = Object.keys(row)

  if (def.autoId) {
    const insertColumns = [...columns, 'created_at', 'updated_at']
    const sql = `INSERT INTO ${def.table} (${insertColumns.join(', ')}) VALUES (${insertColumns
      .map(() => '?')
      .join(', ')})`
    await env.DB.prepare(sql)
      .bind(...columns.map((c) => row[c]), now, now)
      .run()
    return
  }

  const insertColumns = ['id', ...columns, 'created_at', 'updated_at']
  const sql = `INSERT OR REPLACE INTO ${def.table} (${insertColumns.join(', ')}) VALUES (${insertColumns
    .map(() => '?')
    .join(', ')})`
  await env.DB.prepare(sql)
    .bind(String(entity.id), ...columns.map((c) => row[c]), now, now)
    .run()
}

// ===== 站点配置（键值） =====

export async function getConfigValue<T>(env: Env, key: string): Promise<T | null> {
  const row = await env.DB.prepare('SELECT value FROM site_config WHERE key = ?')
    .bind(key)
    .first<{ value: string }>()
  if (!row) return null
  try {
    return JSON.parse(row.value) as T
  } catch {
    return null
  }
}

export async function setConfigValue(env: Env, key: string, value: unknown): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO site_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
  )
    .bind(key, JSON.stringify(value), new Date().toISOString())
    .run()
}

export async function getSiteConfig(env: Env): Promise<SiteConfig> {
  const stored = await getConfigValue<Partial<SiteConfig>>(env, CONFIG_SITE_KEY)
  return { ...DEFAULT_SITE_CONFIG, ...(stored ?? {}) }
}

export async function setSiteConfig(env: Env, patch: Partial<SiteConfig>): Promise<SiteConfig> {
  const next = { ...(await getSiteConfig(env)), ...patch }
  await setConfigValue(env, CONFIG_SITE_KEY, next)
  return next
}

// ===== 审计日志 =====

export interface AuditEntry {
  actor: string
  action: string
  resource?: string
  targetId?: string
  detail?: string
  ip?: string
  ua?: string
}

export async function writeAudit(env: Env, entry: AuditEntry): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO audit_logs (id, actor, action, resource, target_id, detail, ip, ua, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(
      randomId('log'),
      entry.actor,
      entry.action,
      entry.resource ?? '',
      entry.targetId ?? '',
      entry.detail ?? '',
      entry.ip ?? '',
      (entry.ua ?? '').slice(0, 200),
      new Date().toISOString(),
    )
    .run()
}

export async function listAuditLogs(env: Env, limit = 100): Promise<Record<string, unknown>[]> {
  const result = await env.DB.prepare(
    'SELECT id, actor, action, resource, target_id, detail, ip, created_at FROM audit_logs ORDER BY created_at DESC LIMIT ?',
  )
    .bind(Math.min(limit, 500))
    .all<Record<string, unknown>>()
  return result.results ?? []
}
