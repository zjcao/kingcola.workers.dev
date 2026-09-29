/**
 * 「填写毕业去向」凭证：签发 / 校验 / 回填。
 *
 * **为什么不放进 `shared/resources.ts` 的字段表**：
 * 公开的 `/api/public/bootstrap` 是按字段表逐列回传的，token 一旦进了字段表就会下发出去。
 * 所以它只活在这一层的裸 SQL 里 —— 与 `applications.invite_token` 完全同一路数。
 * 副作用是通用 CRUD 也碰不到它：管理员在后台编辑成员**不会**把链接冲掉。
 *
 * 生命周期：签发时覆盖旧值（旧链接立即失效，即「重发换新链接」）；
 * 提交后立刻清空（一条链接只能用一次）。刻意**没有过期时间** ——
 * 毕业去向可能过几个月才回填，到点失效只会让人填不了。
 */

import type { Env } from '../env'
import { randomId } from './crypto'

export interface DestinationRecord {
  id: string
  name: string
  /** 已有的毕业去向（可能是后台手填的，也可能是上次提交的） */
  destination: string
  status: string
}

/** 签发一条新链接：直接覆盖旧 token，所以旧链接立刻失效 */
export async function issueDestinationToken(env: Env, memberId: string): Promise<string> {
  const token = randomId('gd')
  await env.DB.prepare('UPDATE members SET destination_token = ?, updated_at = ? WHERE id = ?')
    .bind(token, new Date().toISOString(), memberId)
    .run()
  return token
}

export async function getByDestinationToken(
  env: Env,
  token: string,
): Promise<DestinationRecord | null> {
  // 别拿超长串去查库（URL 里什么都可能被塞进来）
  if (!token || token.length > 80) return null

  const row = await env.DB.prepare(
    'SELECT id, name, destination, status FROM members WHERE destination_token = ?',
  )
    .bind(token)
    .first<Record<string, unknown>>()
  if (!row) return null

  return {
    id: String(row.id ?? ''),
    name: String(row.name ?? ''),
    destination: String(row.destination ?? ''),
    status: String(row.status ?? ''),
  }
}

/**
 * 回填去向并**立即作废**这条链接。
 *
 * `WHERE destination_token = ?` 而不是 `WHERE id = ?`：这样两次并发提交里
 * 只有第一次会命中（第二次 changes=0），天然幂等、也不会被重放。
 */
export async function submitDestination(
  env: Env,
  token: string,
  destination: string,
): Promise<boolean> {
  const result = await env.DB.prepare(
    "UPDATE members SET destination = ?, destination_token = '', updated_at = ? WHERE destination_token = ?",
  )
    .bind(destination, new Date().toISOString(), token)
    .run()
  return (result.meta?.changes ?? 0) > 0
}
