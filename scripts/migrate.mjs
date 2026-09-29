#!/usr/bin/env node
// ============================================================================
// 建表：按文件名顺序执行 migrations/ 下的 .sql，并记录到 `_migrations` 台账
//
//   node scripts/migrate.mjs local      # 本地 .wrangler/state
//   node scripts/migrate.mjs remote     # 线上 D1
//   （npm 脚本：npm run db:migrate:local / npm run db:migrate:remote）
//
// 老库（台账出现之前就建好的，例如本项目线上库）第一次跑会提示先登记一次：
//   node scripts/migrate.mjs remote --adopt     # 只写台账、不执行任何 SQL
//
// 为什么用自己的台账，而不是 `wrangler d1 migrations apply`：
//   本项目从头就是用 `d1 execute` 手工建表的，库里没有 d1_migrations 记录，
//   切过去会把所有文件整体重跑 —— 而 0004 / 0007 是**重建表**的写法，
//   重跑会丢字段、重排 id（docs/HANDOVER.md 专门警告过）。
//   于是这里记录「哪些文件已经执行过」：执行过的**直接跳过、不碰库**，重复运行安全。
//
// 跨平台：普通 Node 脚本，Windows / macOS / Linux / Workers Builds 构建镜像都能跑
// （上一版是 PowerShell 脚本，非 Windows 或精简环境没有 pwsh，别人连建表都做不了）。
// ============================================================================

import { spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deployTarget } from './lib/deploy-target.mjs'

/** 部署目标（账号 / API Token）：环境变量 → .env.deploy —— 换账号时不用改仓库 */
const TARGET = deployTarget()

const ROOT = resolve(import.meta.dirname, '..')
/**
 * 直接 node 起本地安装的 wrangler —— **不过 shell**。
 * 过 shell 时 `--command "SELECT ... "` 里的空格会被拆成多个参数（Windows 上实测），
 * 命令会静默失败、查不出东西；而且各平台引号规则也不一样。
 */
const WRANGLER = resolve(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
/** 台账表：记录已执行过的迁移文件名 */
const LEDGER = '_migrations'
/** 「这个库已经建过表」的哨兵：0001 建的这些表任意一张在，就说明不是空库 */
const SENTINELS = ['site_config', 'admin_users', 'members']
/** 「其实已经执行过」的报错特征：表/索引已存在、列重复 */
const ALREADY_APPLIED = /already exists|duplicate column|has already been applied/i

const argv = process.argv.slice(2)
/** --adopt：老库（台账出现之前就建好的）首次登记用，只写台账、不执行 SQL */
const adopt = argv.includes('--adopt')
const target = (argv.find((arg) => !arg.startsWith('--')) ?? 'local').toLowerCase()
if (target !== 'local' && target !== 'remote') {
  console.error('用法：node scripts/migrate.mjs <local|remote> [--adopt]')
  process.exit(1)
}

/**
 * 目标库名**从 wrangler.toml 读**，不写死 —— 别人把库名换成自己的也不用改这个脚本
 * （`d1 execute` 认库名，不需要 database_id）。
 */
function databaseName() {
  const hit = /^\s*database_name\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8'))
  return hit ? hit[1] : 'kingcola-db'
}

const DB = databaseName()

/** 跑一段 wrangler 命令，把 stdout / stderr 都收回来（已去 ANSI 颜色） */
function wrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...TARGET.env },
  })
  const text = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '')
  return { status: result.status ?? 1, text }
}

/**
 * 从输出里抠出 `--json` 的 JSON —— 前面可能夹着 `▲ [WARNING] ...` 之类的干扰行，
 * 所以从每个 `[` 依次试着往后解析，谁先解析成数组就用谁。返回原始条目（含 success 标记）。
 */
function parseEntries(text) {
  for (let start = text.indexOf('['); start !== -1; start = text.indexOf('[', start + 1)) {
    const end = text.lastIndexOf(']')
    if (end <= start) break
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {
      // 不是 JSON，继续往后找下一个 `[`
    }
  }
  return []
}

/**
 * 执行一条 SQL 并读结果。
 * ⚠️ `ok` 必须为 false 时**绝不能**当作「查出来是空」——调用方靠它区分
 * 「表不存在」与「查询本身失败了」，后者要继续建表/迁移会出大事。
 */
function query(sql) {
  const { status, text } = wrangler(['d1', 'execute', DB, `--${target}`, '--json', '--command', sql])
  const entries = parseEntries(text)
  const rows = entries.flatMap((entry) => entry?.results ?? [])
  const ok = status === 0 && entries.length > 0 && entries.every((entry) => entry?.success !== false)
  return { ok, rows, text }
}

/** 执行一个迁移文件（整文件交给 wrangler，它按语句顺序跑） */
function runFile(file) {
  return wrangler(['d1', 'execute', DB, `--${target}`, `--file=${resolve(ROOT, 'migrations', file)}`])
}

/** 挑一句人话报错（截断） */
function reasonFrom(text) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !/^[─—\-·⛅✨🪵]+$/.test(line) && !/^Logs were written/i.test(line))
  const hit = [...lines].reverse().find((line) => /error|invalid|forbidden|permission|no such/i.test(line))
  return (hit ?? lines[lines.length - 1] ?? '')
    .replace(/^[X✘]\s*/, '')
    .replace(/\[ERROR\]\s*/i, '')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
}

function record(file) {
  const safe = file.replace(/'/g, "''")
  return query(`INSERT OR REPLACE INTO ${LEDGER} (name, applied_at) VALUES ('${safe}', datetime('now'));`)
}

/** 探测失败（网络 / 登录 / 权限）时不要继续，避免把「查不到」当成「库是空的」 */
function abort(reason, hint) {
  console.error(`✘ ${reason}`)
  if (hint) console.error(`  ${hint}`)
  console.error('  排查：npx wrangler whoami / 检查网络；本地库可删掉 .wrangler/state 重来。')
  process.exit(1)
}

// ---------------------------------------------------------------------------

const files = readdirSync(resolve(ROOT, 'migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort()

if (files.length === 0) {
  console.log('migrations/ 下没有 .sql 文件')
  process.exit(0)
}

console.log(`目标：${DB}（${target}）\n`)

// 1. 建台账表
const created = query(
  `CREATE TABLE IF NOT EXISTS ${LEDGER} (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`,
)
if (!created.ok) abort(`无法在「${DB}」上创建台账表 ${LEDGER}`, reasonFrom(created.text))

// 2. 读台账
const ledger = query(`SELECT name FROM ${LEDGER};`)
if (!ledger.ok) abort(`读不到台账表 ${LEDGER}`, reasonFrom(ledger.text))
let applied = new Set(ledger.rows.map((row) => String(row.name)))

// 3. 台账出现之前就建好的库：显式确认一次（--adopt），只写台账、不执行 SQL
if (applied.size === 0) {
  const quoted = SENTINELS.map((name) => `'${name}'`).join(', ')
  const existing = query(`SELECT name FROM sqlite_master WHERE type='table' AND name IN (${quoted});`)
  if (!existing.ok) abort('无法确认库里是否已有业务表', reasonFrom(existing.text))

  if (existing.rows.length > 0) {
    if (!adopt) {
      console.log(`⚠️ 库里已经有业务表（${existing.rows.map((row) => row.name).join('、')}），但没有台账（${LEDGER}）。`)
      console.log('   说明它是「台账出现之前」就建好的库。若这些迁移确实都执行过，先登记一次（只写台账、不碰数据）：')
      console.log(`     node scripts/migrate.mjs ${target} --adopt`)
      console.log('   登记之后，以后只有**新增**的迁移文件会被执行。')
      process.exit(1)
    }
    for (const file of files) record(file)
    applied = new Set(files)
    console.log(`已把现有 ${files.length} 个迁移文件登记为「已执行」（只写台账，未执行 SQL）\n`)
  }
}

// 4. 只跑没登记过的
const pending = files.filter((file) => !applied.has(file))
if (pending.length === 0) {
  console.log(`没有需要执行的迁移：${files.length} 个文件都已执行过（台账 ${LEDGER}）`)
  process.exit(0)
}

console.log(`待执行 ${pending.length} 个（已跳过 ${files.length - pending.length} 个已执行的）\n`)

let done = 0
for (const file of pending) {
  const { status, text } = runFile(file)
  if (status === 0) {
    record(file)
    done++
    console.log(`✔ ${file}`)
    continue
  }
  if (ALREADY_APPLIED.test(text)) {
    // 老库没有台账时可能已手工执行过：登记为已执行，不当作失败
    record(file)
    console.log(`· ${file}   （库里已存在，登记为已执行）`)
    continue
  }
  console.log(`✘ ${file}\n  ${reasonFrom(text)}`)
  console.log(`\n已执行 ${done} 个后中断。修好这个文件再跑一次即可（已执行的会被跳过）。`)
  process.exit(1)
}

console.log(`\n完成：本次执行 ${done} 个`)
