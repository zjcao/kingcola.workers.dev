#!/usr/bin/env node
// ============================================================================
// 部署入口（Workers Builds 的 Deploy command 用 `node scripts/ci-deploy.mjs`）
//
// 解决什么问题：`[[r2_buckets]]` 写在 wrangler.toml 里，wrangler 部署时会尝试
// provision（创建/校验）这个桶 —— **账号没开通 R2 的会直接部署失败**，
// 而且是部署期硬失败、不是运行时降级（日志里是 `Provisioning FILES (R2 Bucket)`）。
//
// 为什么不能干脆把这段从 wrangler.toml 删掉：**本地开发需要它** ——
// `wrangler dev` 靠它模拟一个本地 R2 桶，头像上传与 `scripts/smoke-api.ps1` 的
// 8a/8b 两节都依赖这个绑定，删掉会让本地开发与自检直接挂掉。
//
// 于是：**部署时先探测账号能不能用 R2**
//   · 能用   → 按仓库里的 wrangler.toml 原样部署（含 FILES 绑定，零配置用 R2）
//   · 不能用 → 把 [[r2_buckets]] 整段剔掉生成一份临时配置再部署
//             （应用自动降级：上传/报名表接口 503、后台「对象存储」页可改接
//              任意 S3 兼容存储（MinIO / COS / OSS / 就是 R2 的 S3 API 也行）、
//              关闭本届因无法归档而拒绝 —— 数据不会丢）
//
// 用法：
//   node scripts/ci-deploy.mjs                 # Workers Builds 的 Deploy command
//   node scripts/ci-deploy.mjs --dry-run       # 本地演练：只构建不上传
//   FORCE_NO_R2=1 node scripts/ci-deploy.mjs   # 跳过探测，强制按「没有 R2」部署
//   （其余参数原样透传给 wrangler，如 `--env=""`、`--name 项目名`）
//
// 部署到哪个 Worker：`wrangler.toml` 里只是**通用默认名**，账号专属的名字放本机
// （`.env.deploy` 的 `WORKER_NAME`，或环境变量 WORKER_NAME）—— 仓库里不留任何人的项目名，
// CI 里没有这个文件，于是走 wrangler.toml 的默认名、再由 Cloudflare 用面板项目名覆盖。
// ============================================================================

import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { deployTarget, readDeployFile } from './lib/deploy-target.mjs'

/** 部署目标（Worker 名 / 账号 / API Token）：环境变量 → .env.deploy → wrangler.toml */
const TARGET = deployTarget()

const ROOT = resolve(import.meta.dirname, '..')
/** 生成出来的「无 R2」配置：部署完即删，同时也写进 .gitignore 兜底 */
const GENERATED = 'wrangler.ci-no-r2.toml'
const IS_WINDOWS = process.platform === 'win32'
/** Windows 上 npx 是 .cmd，必须过 shell；Linux 构建镜像里就是 npx */
const NPX = IS_WINDOWS ? 'npx.cmd' : 'npx'

/** 跑 wrangler；探测类命令收走输出，部署类命令把输出透传给构建日志 */
function wrangler(args, { inherit = false } = {}) {
  return spawnSync(NPX, ['wrangler', ...args], {
    cwd: ROOT,
    shell: IS_WINDOWS,
    encoding: 'utf8',
    stdio: inherit ? 'inherit' : 'pipe',
    // 配了 API Token / 账号 ID 就带上（没配 = 继续用 wrangler 的登录态）
    env: { ...process.env, ...TARGET.env },
  })
}

/**
 * 把 wrangler.toml 里 `[[r2_buckets]]` 整段剔掉（含它下面的 binding / bucket_name 等子键）。
 * 逐行扫表头：遇到 `[[r2_buckets]]` 开始跳过，遇到下一个 `[` 开头的行就恢复。
 * 注释掉的 `# [[r2_buckets]]` 不以 `[` 开头，所以会被原样保留。
 */
export function stripR2Block(source) {
  const kept = []
  let skipping = false
  for (const line of source.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      skipping = /^\[\[?\s*r2_buckets/.test(trimmed)
      if (skipping) continue
    }
    if (!skipping) kept.push(line)
  }
  return kept.join('\n')
}

/** 从 wrangler 的输出里挑出一句人话报错（去颜色 / 去横幅 / 去日志路径 / 截断） */
function reasonFrom(output) {
  const lines = `${output ?? ''}`
    .replace(/\u001b\[[0-9;]*m/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line &&
        !/^[─—\-·⛅✨🪵]+$/.test(line) &&
        !/^⛅️?\s*wrangler\s/i.test(line) &&
        !/^Logs were written/i.test(line),
    )
  const hit =
    lines.find((line) => /error|invalid|authenticated|forbidden|permission/i.test(line)) ??
    lines[lines.length - 1] ??
    ''
  return hit
    .replace(/^[X✘]\s*/, '')
    .replace(/\[ERROR\]\s*/i, '')
    .replace(/\s*Logs were written.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160)
}

/** 探测账号能不能用 R2：能列出桶 = 已开通（Workers Builds 自带的 token 有 R2 权限） */
function probeR2() {
  if (process.env.FORCE_NO_R2 === '1' || process.env.FORCE_NO_R2 === 'true') {
    return { ok: false, reason: 'FORCE_NO_R2 已设置，跳过探测' }
  }
  const result = wrangler(['r2', 'bucket', 'list'])
  if (result.status === 0) return { ok: true }
  return {
    ok: false,
    reason: reasonFrom(`${result.stderr ?? ''}${result.stdout ?? ''}`) || `wrangler 退出码 ${result.status}`,
  }
}

/**
 * 「部署到哪个 Worker」= 账号专属信息，仓库里只放通用默认名。
 * 优先环境变量 `WORKER_NAME`，其次本机 `.env.deploy`（已 gitignore）；都没有就空串，
 * 让 wrangler 用 `wrangler.toml` 里的 name（CI 场景：再由 Cloudflare 用面板项目名覆盖）。
 */
function deployName() {
  const fromEnv = (process.env.WORKER_NAME ?? '').trim()
  if (fromEnv) return fromEnv
  try {
    for (const line of readFileSync(resolve(ROOT, '.env.deploy'), 'utf8').split('\n')) {
      const hit = /^\s*WORKER_NAME\s*=\s*(.+?)\s*$/.exec(line)
      if (hit) return hit[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // 本机没有 .env.deploy（例如跑在 CI 里）—— 正常情况，用默认名
  }
  return ''
}

/**
 * 复用已有资源：把本机 `.env.deploy` 里的 D1 / KV ID 写进临时配置。
 * 仓库里永远不出现 ID；对「没有 D1 读权限」的账号（例如此次的工作室账号）也只有这样
 * 才不会去「按名字找」（那一步会因权限不足而失败）。
 */
function injectIds(source) {
  const file = readDeployFile()
  let out = source
  const d1 = (file.D1_DATABASE_ID ?? '').trim()
  if (d1) out = out.replace(/^(\s*database_name\s*=\s*"[^"]*"\s*)$/m, `$1\ndatabase_id = "${d1}"`)
  const kv = (file.KV_NAMESPACE_ID ?? '').trim()
  if (kv) out = out.replace(/^(\s*binding\s*=\s*"CONFIG_KV"\s*)$/m, `$1\nid = "${kv}"`)
  return out
}

function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const passthrough = argv.filter((arg) => arg !== '--dry-run')

  const r2 = probeR2()
  const args = ['deploy', ...passthrough]

  // 「部署到哪个 Worker」是账号专属信息，不进仓库：优先环境变量，其次本机 .env.deploy
  const name = deployName()
  if (name && !passthrough.some((arg) => /^--name(=|$)/.test(arg))) {
    console.log(`· 按本机 .env.deploy / WORKER_NAME 指定的名字部署：${name}`)
    args.push('--name', name)
  }

  const fileVars = readDeployFile()
  const hasIds = Boolean((fileVars.D1_DATABASE_ID ?? '').trim() || (fileVars.KV_NAMESPACE_ID ?? '').trim())

  if (r2.ok || hasIds) {
    // 「资源早就绑好了」的场景（本机 .env.deploy 给了 ID）：原样声明，不降级、不删绑定
    console.log(
      r2.ok
        ? '· 检测到账号已开通 R2 → 按 wrangler.toml 原样部署（含 FILES 绑定）'
        : '· R2 探测不可用，但目标 Worker 的资源已就绪 → 原样声明，不做降级',
    )
    if (hasIds) console.log('· 按本机 .env.deploy 里的 D1 / KV ID 复用已有资源（不在账号里新建）')
    writeFileSync(
      resolve(ROOT, GENERATED),
      `${injectIds(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8')).trimEnd()}\n`,
    )
    args.push('--config', GENERATED)
  } else {
    console.log(`· 未探测到可用的 R2（${r2.reason}）→ 自动降级：本次部署不带 FILES 绑定`)
    console.log('  应用不会崩：上传/报名表接口返回 503「对象存储未接通」。')
    console.log('  部署后到后台「对象存储」页改接任意 S3 兼容存储（含 R2 的 S3 API）即可，无需重新部署。')
    console.log('  若账号确实有 R2 却被降级：看上面那行报错排查；也可以把 Deploy command')
    console.log('  直接写成 `npx wrangler deploy` 跳过本脚本。')
    writeFileSync(
      resolve(ROOT, GENERATED),
      `${stripR2Block(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8')).trimEnd()}\n`,
    )
    args.push('--config', GENERATED)
  }

  if (dryRun) args.push('--dry-run')

  try {
    const result = wrangler(args, { inherit: true })
    process.exitCode = result.status ?? 1
  } finally {
    // 临时配置不留在工作区（部署已读走它了）
    rmSync(resolve(ROOT, GENERATED), { force: true })
  }
}

// 只有「直接运行本文件」才部署；被 import（例如单测 stripR2Block）时什么都不做
if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main()
