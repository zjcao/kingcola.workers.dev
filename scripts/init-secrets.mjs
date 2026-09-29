#!/usr/bin/env node
// ============================================================================
// 一键把 Worker 的密钥准备好：**能自动生成的自动生成 → 写入 Worker → 打印出来**
//
//   npm run secrets:init              # 缺哪个补哪个，然后写进 Worker 并打印
//   npm run secrets:init -- --rotate  # 全部重新生成（⚠️ 所有登录态立即失效）
//   npm run secrets:init -- --show    # 只显示 .env 里现在的值，不改也不写
//
// 分两类：
//   · 自己用的（SESSION_SECRET / STUDENT_SESSION_SECRET）→ 随机生成
//   · 必须与「别人」一致的（SSO_CLIENT_SECRET / QR_SIGN_SECRET 对授权服务器，
//     SMTP_PASSWORD 对邮箱服务商）→ **不会瞎生成**，只提示你去填
//     （其中 SSO_CLIENT_SECRET 与 SMTP_PASSWORD 也可以直接在后台填，加密存 D1；
//     后台填过就以后台为准，这里只是兜底 —— 见 README「写入密钥」一节）
//
// 两个关键细节（都是踩过的坑）：
//   1. 写入时必须带 `--name <面板项目名>` —— wrangler 的 secret 命令默认取 wrangler.toml 里的
//      通用名，不带就会写到（甚至新建出）另一个 Worker，站点看起来「密钥没生效」。
//      这里自动取：`--name` 参数 → 环境变量 WORKER_NAME → 本机 .env.deploy → wrangler.toml。
//   2. Cloudflare 的 secret 是**只写不读**的，所以生成的值同时写进 `.env`（已 gitignore）留档，
//      并在终端打印出来 —— 丢了就再也找不回来。
// ============================================================================

import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deployTarget } from './lib/deploy-target.mjs'

/** 部署目标（Worker 名 / 账号 / API Token）：环境变量 → .env.deploy → wrangler.toml */
const TARGET = deployTarget()

const ROOT = resolve(import.meta.dirname, '..')
const WRANGLER = resolve(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
const ENV_PATH = resolve(ROOT, '.env')

const argv = process.argv.slice(2)
const rotate = argv.includes('--rotate')
const showOnly = argv.includes('--show')

/** 自己用的密钥：可以就地随机生成 */
const GENERATED = [
  {
    key: 'SESSION_SECRET',
    note: '管理员会话签名（改动会让所有管理员掉线）',
    make: () => randomBytes(32).toString('base64url'),
  },
  {
    key: 'STUDENT_SESSION_SECRET',
    note: '报名学生会话签名（与上面各自独立）',
    make: () => randomBytes(32).toString('base64url'),
  },

]

/** 必须与「别人」一致的密钥：脚本不生成，只提示 */
const EXTERNAL = [
  {
    key: 'SSO_CLIENT_SECRET',
    note: '须与授权服务器上的同名变量逐字一致；也可直接填在后台「系统设置 → 流量通道」（推荐），这里只是兜底',
  },
  { key: 'QR_SIGN_SECRET', note: '须与授权服务器上的 APPLY_TOKEN_SECRET 逐字一致' },
  { key: 'SMTP_PASSWORD', note: '邮箱服务商后台生成的授权码，只有你知道' },
]

/** 部署到哪个 Worker：--name → 环境变量 → .env.deploy → wrangler.toml */
function targetName() {
  const inline = argv.find((arg) => arg.startsWith('--name='))
  if (inline) return inline.slice('--name='.length)
  const at = argv.indexOf('--name')
  if (at !== -1 && argv[at + 1]) return argv[at + 1]
  if ((process.env.WORKER_NAME ?? '').trim()) return process.env.WORKER_NAME.trim()

  try {
    for (const line of readFileSync(resolve(ROOT, '.env.deploy'), 'utf8').split('\n')) {
      const hit = /^\s*WORKER_NAME\s*=\s*(.+?)\s*$/.exec(line)
      if (hit) return hit[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // 没有 .env.deploy（CI / 别人首次跑）—— 正常
  }

  const config = readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8')
  const hit = /^\s*name\s*=\s*"([^"]+)"/m.exec(config)
  return hit ? hit[1] : 'kingcola'
}

/** 读一行**生效**的赋值（注释行不算） */
function activeValue(text, key) {
  const hit = new RegExp(`^${key}=(.*)$`, 'm').exec(text)
  return hit ? hit[1].trim() : ''
}

/** 写入/更新一行：已有生效行就改值，只有注释行就取消注释，都没有就追加 */
function setValue(text, key, value) {
  const active = new RegExp(`^${key}=.*$`, 'm')
  if (active.test(text)) return text.replace(active, `${key}=${value}`)
  const commented = new RegExp(`^#\\s*${key}=.*$`, 'm')
  if (commented.test(text)) return text.replace(commented, `${key}=${value}`)
  return `${text.trimEnd()}\n${key}=${value}\n`
}

function wrangler(args) {
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...TARGET.env },
  })
  return `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\u001b\[[0-9;]*m/g, '').trim()
}

// ---------------------------------------------------------------------------

let text = existsSync(ENV_PATH)
  ? readFileSync(ENV_PATH, 'utf8')
  : [
      '# 由 `npm run secrets:init` 生成并维护（本文件已 gitignore，**永不入库**）',
      '# Cloudflare 的 secret 只写不读，这里是唯一的一份明文存档。',
      '',
    ].join('\n')

const name = targetName()
console.log(`目标 Worker：${name}`)
console.log(showOnly ? '（--show：只看不改）\n' : '')
if (!showOnly && rotate) console.log('⚠️ --rotate：以下密钥会被重新生成，正在使用中的登录态会立即失效\n')

const rows = []
for (const item of GENERATED) {
  const current = activeValue(text, item.key)
  if (showOnly) {
    rows.push([item.key, current || '(未设置)', current ? '已存在' : '缺失'])
    continue
  }
  if (rotate || !current) {
    const value = item.make()
    text = setValue(text, item.key, value)
    rows.push([item.key, value, rotate ? '已重新生成' : '新生成'])
  } else {
    rows.push([item.key, current, '沿用原值'])
  }
}
for (const item of EXTERNAL) {
  const current = activeValue(text, item.key)
  rows.push([item.key, current || '(未设置)', current ? '沿用原值' : `需你自己填 —— ${item.note}`])
}

if (!showOnly) writeFileSync(ENV_PATH, text.endsWith('\n') ? text : `${text}\n`)

/** 打印值（中文按 2 格宽算，尽量对齐） */
const width = (s) => [...s].reduce((n, ch) => n + (/[\u4e00-\u9fa5]/.test(ch) ? 2 : 1), 0)
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - width(s)))

console.log('密钥一览（.env 台账里的值，请离线保管）：\n')
for (const [key, value, tag] of rows) {
  console.log(`  ${pad(key, 24)}${pad(value, 46)}${tag}`)
}

if (showOnly) {
  console.log(`\n（文件：${ENV_PATH}）`)
  process.exit(0)
}

// 写入 Worker —— 必须带 --name，否则会写到 wrangler.toml 里那个通用名上
console.log('\n写入 Worker ...')
const bulk = wrangler(['secret', 'bulk', ENV_PATH, '--name', name])
const lines = bulk.split('\n').map((line) => line.trim()).filter(Boolean)
// 只挑结果那行（wrangler 会夹带 [env.preview] 的多环境提示等噪音）
const done = [...lines].reverse().find((line) => /successfully|created|error|fail/i.test(line))
console.log(`  ${done ?? lines[lines.length - 1] ?? '（无输出）'}`)

const listed = [...wrangler(['secret', 'list', '--name', name]).matchAll(/"name":\s*"([^"]+)"/g)].map(
  (hit) => hit[1],
)
console.log(`\n${name} 现有密钥：${listed.length ? listed.join('、') : '（无）'}`)

const missing = [...GENERATED, ...EXTERNAL].map((item) => item.key).filter((key) => !listed.includes(key))
if (missing.length > 0) console.log(`还缺：${missing.join('、')}（上面的说明里有各自怎么补）`)

const token = activeValue(readFileSync(ENV_PATH, 'utf8'), 'RECOVERY_TOKEN')
console.log(`\n下一步：打开 https://<你的域名>/admin 首次初始化，口令就是 RECOVERY_TOKEN = ${token}`)
console.log(`（文件：${ENV_PATH}，已 gitignore）`)
