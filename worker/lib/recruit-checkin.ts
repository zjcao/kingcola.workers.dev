/**
 * 签到二维码凭证：**token 只绑阶段**（笔试 / 面试 / 答辩），带有效期、可一键作废。
 *
 * 为什么没有场次：整届的考试安排一律通过对应的 QQ 群通知，系统不需要知道「哪天几点在哪考」。
 * 一张码对应一个阶段，同学扫哪张就记哪个阶段。
 *
 * 同一阶段**至多一张有效码**：签发新码时自动作废旧码 —— 二维码会被拍照转发，
 * 重发往往正是因为旧码泄了，两张都有效等于作废动作白做。
 */

import {
  CHECKIN_TOKEN_TTL_HOURS,
  CHECKIN_TOKEN_TTL_MAX_HOURS,
  CHECKIN_TOKEN_TTL_MIN_HOURS,
  isCheckinStage,
  type CheckinStage,
} from '../../shared/recruit'
import type { Env } from '../env'

export interface CheckinTokenRecord {
  token: string
  stage: CheckinStage
  expiresAt: string
  /** 非空 = 已被作废 */
  revokedAt: string
  createdBy: string
  createdAt: string
}

const SELECT = 'token, stage, expires_at, revoked_at, created_by, created_at'

function rowToToken(row: Record<string, unknown>): CheckinTokenRecord {
  const stage = String(row.stage ?? '')
  return {
    token: String(row.token ?? ''),
    // 库里的 stage 只可能是 CHECKIN_STAGES 之一（写入前已校验），脏数据按笔试兜底
    stage: isCheckinStage(stage) ? stage : 'written',
    expiresAt: String(row.expires_at ?? ''),
    revokedAt: String(row.revoked_at ?? ''),
    createdBy: String(row.created_by ?? ''),
    createdAt: String(row.created_at ?? ''),
  }
}

/** 凭证 token：16 字节随机十六进制（32 位），塞进二维码足够短、也足够不可猜 */
function newToken(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** 把后台传来的有效期收敛到合法区间；不合法就用默认值 */
export function normalizeTtlHours(value: unknown): number {
  const hours = Number(value)
  if (!Number.isFinite(hours)) return CHECKIN_TOKEN_TTL_HOURS
  return Math.min(Math.max(Math.round(hours), CHECKIN_TOKEN_TTL_MIN_HOURS), CHECKIN_TOKEN_TTL_MAX_HOURS)
}

export async function getCheckinToken(env: Env, token: string): Promise<CheckinTokenRecord | null> {
  if (!token) return null
  const row = await env.DB.prepare(`SELECT ${SELECT} FROM recruit_checkin_tokens WHERE token = ?`)
    .bind(token)
    .first<Record<string, unknown>>()
  return row ? rowToToken(row) : null
}

/** 某阶段当前还有效的那张码（已作废或已过期的都不算） */
export async function getActiveCheckinToken(
  env: Env,
  stage: CheckinStage,
  now: Date = new Date(),
): Promise<CheckinTokenRecord | null> {
  const row = await env.DB.prepare(
    `SELECT ${SELECT} FROM recruit_checkin_tokens
       WHERE stage = ? AND revoked_at = '' AND expires_at > ?
       ORDER BY created_at DESC LIMIT 1`,
  )
    .bind(stage, now.toISOString())
    .first<Record<string, unknown>>()
  return row ? rowToToken(row) : null
}

/** 三个阶段的当前有效码，一次查完（后台页面一次要显示三张卡片） */
export async function listActiveCheckinTokens(
  env: Env,
  now: Date = new Date(),
): Promise<Record<CheckinStage, CheckinTokenRecord | null>> {
  const result = await env.DB.prepare(
    `SELECT ${SELECT} FROM recruit_checkin_tokens
       WHERE revoked_at = '' AND expires_at > ?
       ORDER BY created_at DESC`,
  )
    .bind(now.toISOString())
    .all<Record<string, unknown>>()

  const out: Record<CheckinStage, CheckinTokenRecord | null> = {
    written: null,
    interview: null,
    defense: null,
  }
  // 每个阶段取最新的一张（结果是倒序的，先到先得）
  for (const row of result.results ?? []) {
    const record = rowToToken(row)
    if (!out[record.stage]) out[record.stage] = record
  }
  return out
}

/**
 * 签发（或重发）某阶段的签到二维码。
 * **该阶段旧码一并作废** —— 保证任何时刻只有一张码能扫。
 */
export async function issueCheckinToken(
  env: Env,
  input: { stage: CheckinStage; ttlHours?: unknown; actor: string; now?: Date },
): Promise<CheckinTokenRecord> {
  const now = input.now ?? new Date()
  const ttlHours = normalizeTtlHours(input.ttlHours)
  const record: CheckinTokenRecord = {
    token: newToken(),
    stage: input.stage,
    expiresAt: new Date(now.getTime() + ttlHours * 3600 * 1000).toISOString(),
    revokedAt: '',
    createdBy: input.actor,
    createdAt: now.toISOString(),
  }

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE recruit_checkin_tokens SET revoked_at = ?
         WHERE stage = ? AND revoked_at = ''`,
    ).bind(record.createdAt, input.stage),
    env.DB.prepare(
      `INSERT INTO recruit_checkin_tokens (token, stage, expires_at, revoked_at, created_by, created_at)
       VALUES (?, ?, ?, '', ?, ?)`,
    ).bind(record.token, record.stage, record.expiresAt, record.createdBy, record.createdAt),
  ])

  return record
}

/** 作废某阶段（或全部）的二维码；返回作废条数 */
export async function revokeCheckinTokens(
  env: Env,
  input: { stage?: CheckinStage | null; actor: string; now?: Date },
): Promise<number> {
  const now = (input.now ?? new Date()).toISOString()
  const stage = input.stage
  const statement = stage
    ? env.DB.prepare(
        `UPDATE recruit_checkin_tokens SET revoked_at = ?
           WHERE stage = ? AND revoked_at = ''`,
      ).bind(now, stage)
    : env.DB.prepare(`UPDATE recruit_checkin_tokens SET revoked_at = ? WHERE revoked_at = ''`).bind(now)
  const result = await statement.run()
  void input.actor
  return result.meta?.changes ?? 0
}

/** 该阶段（含已作废的）历史码数量，后台显示「已重发 N 次」用 */
export async function countCheckinTokens(env: Env, stage: CheckinStage): Promise<number> {
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM recruit_checkin_tokens WHERE stage = ?',
  )
    .bind(stage)
    .first<{ n: number }>()
  return row?.n ?? 0
}

/** 清理过期很久的凭证（关闭本届时调用，避免表越堆越大） */
export async function purgeCheckinTokens(env: Env): Promise<number> {
  const result = await env.DB.prepare('DELETE FROM recruit_checkin_tokens').run()
  return result.meta?.changes ?? 0
}
