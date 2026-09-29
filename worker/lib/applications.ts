/**
 * 招新报名的 D1 仓储（含发信日志）。
 *
 * 与 `lib/repo.ts`（由 shared/resources.ts 驱动的通用 CRUD）分开：
 * applications 是「学生写、管理员读」的流水线，状态用 stage + result 两列描述，
 * 有自己的批量推进与清空语义，不适合塞进通用资源的声明式模型。
 *
 * 列名只来自本文件的常量表，不接受任何外部输入拼 SQL。
 */

import type { CheckinStage, RecruitResult, RecruitStage } from '../../shared/recruit'
import type { Application, ApplicationSource } from '../../shared/types'
import type { Env } from '../env'
import { randomId } from './crypto'

/**
 * 阶段 → 签到时间列名。
 * 签到、缺考判定、批量补签三处都要用，放在仓储这里，避免各文件抄一份。
 */
export const CHECKIN_COLUMN: Record<
  CheckinStage,
  'writtenCheckinAt' | 'interviewCheckinAt' | 'defenseCheckinAt'
> = {
  written: 'writtenCheckinAt',
  interview: 'interviewCheckinAt',
  defense: 'defenseCheckinAt',
}

/** 含邀请凭证的内部记录 —— 凭证是密权，只给管理员/发信逻辑用，不下发学生端 */
export interface ApplicationRecord extends Application {
  inviteToken: string
}

/** 字段 → 列名。顺序即 SELECT 顺序，新增字段只改这里。 */
const COLUMNS: ReadonlyArray<readonly [keyof ApplicationRecord, string]> = [
  ['id', 'id'],
  ['studentId', 'student_id'],
  ['name', 'name'],
  ['email', 'email'],
  ['phone', 'phone'],
  ['qq', 'qq'],
  ['fileUrl', 'file_url'],
  ['fileName', 'file_name'],
  ['fileSize', 'file_size'],
  ['stage', 'stage'],
  ['result', 'result'],
  ['stageChangedAt', 'stage_changed_at'],
  ['writtenCheckinAt', 'written_checkin_at'],
  ['interviewCheckinAt', 'interview_checkin_at'],
  ['defenseCheckinAt', 'defense_checkin_at'],
  // 报名来源：web 官网自助提交 / manual 管理员补录
  ['source', 'source'],
  ['writtenScore', 'written_score'],
  ['interviewScore', 'interview_score'],
  ['defenseScore', 'defense_score'],
  ['writtenNote', 'written_note'],
  ['interviewNote', 'interview_note'],
  ['defenseNote', 'defense_note'],
  ['inviteToken', 'invite_token'],
  ['inviteExpiresAt', 'invite_expires_at'],
  ['invitedAt', 'invited_at'],
  ['confirmedAt', 'confirmed_at'],
  ['memberId', 'member_id'],
  // 材料审核（报名阶段后台逐个通过 / 驳回；同学重传后重置为待审核）
  ['materialStatus', 'material_status'],
  ['materialReason', 'material_reason'],
  ['materialReviewedAt', 'material_reviewed_at'],
  ['note', 'note'],
  ['createdAt', 'created_at'],
  ['updatedAt', 'updated_at'],
]

const COLUMN_OF = new Map<string, string>(COLUMNS.map(([key, column]) => [key, column]))
const SELECT_LIST = COLUMNS.map(([, column]) => column).join(', ')

/**
 * 更新时不允许改的列（主键 / 创建时间）。
 *
 * **姓名与学号允许改**：补录时听错/写错、或本人改名字都常见，
 * 而「资料能不能改」不该由发现渠道决定 —— 官网报的人管理员也能改（后台统一走「改全部资料」）。
 * 学号的唯一性由路由层校验（冲突返回 409），这里不拦。
 */
const IMMUTABLE_KEYS = new Set<string>(['id', 'createdAt'])

function decodeValue(key: keyof ApplicationRecord, raw: unknown): unknown {
  if (key === 'fileSize') return Number(raw) || 0
  if (raw === null || raw === undefined) return ''
  return String(raw)
}

function rowToRecord(row: Record<string, unknown>): ApplicationRecord {
  const out: Record<string, unknown> = {}
  for (const [key] of COLUMNS) {
    out[key] = decodeValue(key, row[COLUMN_OF.get(key) ?? key])
  }
  return out as unknown as ApplicationRecord
}

function encodeValue(key: string, value: unknown): unknown {
  if (key === 'fileSize') return Number(value) || 0
  return value === null || value === undefined ? '' : String(value)
}

// ===== 写入 =====

/** 新建报名的入参（stage / result / 时间戳由本文件补） */
export interface NewApplication {
  studentId: string
  name: string
  email: string
  phone: string
  qq: string
  fileUrl: string
  fileName: string
  fileSize: number
  /** 报名来源：官网自助提交（默认）或管理员补录的未报名考生 */
  source?: ApplicationSource
}

export async function createApplication(env: Env, input: NewApplication): Promise<ApplicationRecord> {
  const now = new Date().toISOString()
  const id = randomId('app')

  await env.DB.prepare(
    `INSERT INTO applications
       (id, student_id, name, email, phone, qq, file_url, file_name, file_size,
        source, stage, result, stage_changed_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'apply', '', ?, ?, ?)`,
  )
    .bind(
      id,
      input.studentId,
      input.name,
      input.email,
      input.phone,
      input.qq,
      input.fileUrl,
      input.fileName,
      input.fileSize,
      input.source ?? 'web',
      now,
      now,
      now,
    )
    .run()

  const created = await getApplication(env, id)
  if (!created) throw new Error('报名记录写入后读取失败')
  return created
}

/**
 * 局部更新：只写传入的字段。
 * 键必须在 COLUMNS 白名单里，否则直接忽略（杜绝拼出任意列名）。
 */
/** 局部更新：`id` 与 `createdAt` 不可改，其余（含姓名 / 学号 / 联系方式）都能改 */
export type ApplicationPatch = Partial<Omit<ApplicationRecord, 'id' | 'createdAt'>>

export async function updateApplication(
  env: Env,
  id: string,
  patch: ApplicationPatch,
): Promise<ApplicationRecord | null> {
  const assignments: string[] = []
  const binds: unknown[] = []

  for (const [key, value] of Object.entries(patch)) {
    if (IMMUTABLE_KEYS.has(key)) continue
    const column = COLUMN_OF.get(key)
    if (!column || value === undefined) continue
    assignments.push(`${column} = ?`)
    binds.push(encodeValue(key, value))
  }

  if (assignments.length > 0) {
    assignments.push('updated_at = ?')
    binds.push(new Date().toISOString())
    await env.DB.prepare(`UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`)
      .bind(...binds, id)
      .run()
  }

  return getApplication(env, id)
}

/**
 * 批量推进：一次改多条（生成面试名单、录取、发感谢信都靠它）。
 * 单条 SQL 的绑定参数上限是 100，这里按 20 条一批切片，避免参数过多。
 */
export async function updateApplications(
  env: Env,
  updates: Array<{ id: string } & ApplicationPatch>,
): Promise<number> {
  let changed = 0
  const now = new Date().toISOString()
  const CHUNK = 20

  for (let start = 0; start < updates.length; start += CHUNK) {
    const chunk = updates.slice(start, start + CHUNK)
    const statements = chunk.map((update) => {
      const assignments: string[] = []
      const binds: unknown[] = []
      for (const [key, value] of Object.entries(update)) {
        if (key === 'id' || IMMUTABLE_KEYS.has(key)) continue
        const column = COLUMN_OF.get(key)
        if (!column || value === undefined) continue
        assignments.push(`${column} = ?`)
        binds.push(encodeValue(key, value))
      }
      assignments.push('updated_at = ?')
      binds.push(now)
      binds.push(update.id)
      return env.DB.prepare(
        `UPDATE applications SET ${assignments.join(', ')} WHERE id = ?`,
      ).bind(...binds)
    })

    if (statements.length > 0) {
      await env.DB.batch(statements)
      changed += statements.length
    }
  }

  return changed
}

export async function deleteApplication(env: Env, id: string): Promise<boolean> {
  const result = await env.DB.prepare('DELETE FROM applications WHERE id = ?').bind(id).run()
  return (result.meta?.changes ?? 0) > 0
}

/** 关闭本届时清空报名数据（发信日志同生命周期，一并清掉） */
export async function clearRecruitData(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM applications'),
    env.DB.prepare('DELETE FROM application_mails'),
  ])
}

// ===== 读取 =====

export async function getApplication(env: Env, id: string): Promise<ApplicationRecord | null> {
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE id = ?`)
    .bind(id)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

export async function getApplicationByStudentId(
  env: Env,
  studentId: string,
): Promise<ApplicationRecord | null> {
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE student_id = ?`)
    .bind(studentId)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

/** 按邀请函凭证取（凭证即密权，公开接口靠它认人） */
export async function getApplicationByInviteToken(
  env: Env,
  token: string,
): Promise<ApplicationRecord | null> {
  if (!token) return null
  const row = await env.DB.prepare(`SELECT ${SELECT_LIST} FROM applications WHERE invite_token = ?`)
    .bind(token)
    .first<Record<string, unknown>>()
  return row ? rowToRecord(row) : null
}

export interface ListApplicationsOptions {
  /** 只看这些阶段 */
  stages?: RecruitStage[]
  /** 只看这些结果（空串表示「尚无结论」，需要显式传 ''） */
  results?: RecruitResult[]
  search?: string
  limit?: number
  offset?: number
}

function whereClause(options: ListApplicationsOptions): { where: string; binds: unknown[] } {
  const clauses: string[] = []
  const binds: unknown[] = []

  const stages = (options.stages ?? []).filter(Boolean)
  if (stages.length > 0) {
    clauses.push(`stage IN (${stages.map(() => '?').join(', ')})`)
    binds.push(...stages)
  }

  const results = options.results
  if (results && results.length > 0) {
    clauses.push(`result IN (${results.map(() => '?').join(', ')})`)
    binds.push(...results)
  }

  const term = options.search?.trim()
  if (term) {
    // 能搜的就是「人」——姓名 / 学号 / 邮箱 / 手机号 / QQ
    const columns = ['name', 'student_id', 'email', 'phone', 'qq']
    clauses.push(`(${columns.map((c) => `${c} LIKE ?`).join(' OR ')})`)
    binds.push(...columns.map(() => `%${term}%`))
  }

  return { where: clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : '', binds }
}

export interface ListApplicationsResult {
  items: ApplicationRecord[]
  total: number
}

export async function listApplications(
  env: Env,
  options: ListApplicationsOptions = {},
): Promise<ListApplicationsResult> {
  const { where, binds } = whereClause(options)
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 2000)
  const offset = Math.max(options.offset ?? 0, 0)

  const [rows, count] = await Promise.all([
    // 报名时间倒序：招新期最关心的就是刚到的新报名
    env.DB
      .prepare(`SELECT ${SELECT_LIST} FROM applications${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`)
      .bind(...binds, limit, offset)
      .all<Record<string, unknown>>(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM applications${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
  ])

  return {
    items: (rows.results ?? []).map(rowToRecord),
    total: count?.n ?? 0,
  }
}

/** 全量拉取（看板统计、CSV 导出、关闭归档用；招新量级最多几百条） */
export async function listAllApplications(env: Env): Promise<ApplicationRecord[]> {
  const result = await env.DB.prepare(
    `SELECT ${SELECT_LIST} FROM applications ORDER BY created_at ASC`,
  ).all<Record<string, unknown>>()
  return (result.results ?? []).map(rowToRecord)
}

// ===== 发信日志 =====

export interface MailLogEntry {
  applicationId: string
  kind: string
  recipient: string
  subject: string
  ok: boolean
  code: string
  message: string
  actor: string
}

export async function writeMailLog(env: Env, entry: MailLogEntry): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO application_mails
       (id, application_id, kind, recipient, subject, ok, code, message, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      randomId('mail'),
      entry.applicationId,
      entry.kind,
      entry.recipient,
      entry.subject,
      entry.ok ? 1 : 0,
      entry.code,
      entry.message.slice(0, 500),
      entry.actor,
      new Date().toISOString(),
    )
    .run()
}

export interface MailLogRow extends MailLogEntry {
  id: string
  createdAt: string
}

export async function listMailLogs(
  env: Env,
  options: { applicationId?: string; limit?: number } = {},
): Promise<MailLogRow[]> {
  const limit = Math.min(Math.max(options.limit ?? 200, 1), 1000)
  const where = options.applicationId ? ' WHERE application_id = ?' : ''
  const statement = env.DB.prepare(
    `SELECT id, application_id, kind, recipient, subject, ok, code, message, actor, created_at
       FROM application_mails${where} ORDER BY created_at DESC LIMIT ?`,
  )
  const result = options.applicationId
    ? await statement.bind(options.applicationId, limit).all<Record<string, unknown>>()
    : await statement.bind(limit).all<Record<string, unknown>>()

  return (result.results ?? []).map((row) => ({
    id: String(row.id ?? ''),
    applicationId: String(row.application_id ?? ''),
    kind: String(row.kind ?? ''),
    recipient: String(row.recipient ?? ''),
    subject: String(row.subject ?? ''),
    ok: Number(row.ok ?? 0) === 1,
    code: String(row.code ?? ''),
    message: String(row.message ?? ''),
    actor: String(row.actor ?? ''),
    createdAt: String(row.created_at ?? ''),
  }))
}

// ===== 学生可见视图 =====

/**
 * 给报名同学本人看的视图：
 * - 隐去邀请凭证（那是邮件里的密权）与管理员备注；
 * - 隐去笔试 / 面试 / 答辩成绩与评语 —— 这些是内部评审记录，不对本人展示；
 * - 保留各阶段时间与签到情况（他自己做过的事）。
 */
export function toStudentView(record: ApplicationRecord): Application {
  const view: Application = { ...record }
  return {
    ...view,
    writtenScore: '',
    interviewScore: '',
    defenseScore: '',
    writtenNote: '',
    interviewNote: '',
    defenseNote: '',
    note: '',
  }
}
