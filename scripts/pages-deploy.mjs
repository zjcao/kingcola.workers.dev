#!/usr/bin/env node
// ============================================================================
// Pages 形态的部署（与 Workers 形态的 `npm run deploy` 并存）
//
//   npm run pages:deploy              # 先构建，再部署到 Pages
//   npm run pages:deploy -- --no-build # 只部署（dist 已经构建好）
//
// 它做的事：
//   1. 读本机 `.env.deploy`（项目名 / 账号 / D1 ID / KV ID）—— 仓库里保持通用，不含任何账号信息
//   2. 生成一份**临时**配置（wrangler.pages.local.toml，已 gitignore）并注入这些值
//   3. `wrangler pages deploy dist`，带上 `--project-name` 与本机账号/Token
//
// 国内可直接访问：`https://<项目名>.pages.dev`（实测 pages.dev 可达、workers.dev 不可达）。
// ============================================================================

import { spawnSync } from 'node:child_process'
import { readFileSync, rmSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deployTarget, readDeployFile } from './lib/deploy-target.mjs'

const ROOT = resolve(import.meta.dirname, '..')
const WRANGLER = resolve(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js')
/** 生成的临时配置（部署完即删，同时已写进 .gitignore 兜底） */
const GENERATED = 'wrangler.pages.local.toml'

const TARGET = deployTarget()
const file = readDeployFile()
const dryRun = process.argv.includes('--dry-run')

let config = readFileSync(resolve(ROOT, 'wrangler.pages.toml'), 'utf8')
config = config.replace(/^name\s*=\s*".*"$/m, `name = "${TARGET.name}"`)

const d1 = (file.D1_DATABASE_ID ?? '').trim()
if (d1) config = config.replace(/^(\s*database_name\s*=\s*"[^"]*"\s*)$/m, `$1\ndatabase_id = "${d1}"`)
const kv = (file.KV_NAMESPACE_ID ?? '').trim()
if (kv) config = config.replace(/^(\s*binding\s*=\s*"CONFIG_KV"\s*)$/m, `$1\nid = "${kv}"`)

try {
  writeFileSync(resolve(ROOT, GENERATED), config)
  if (!process.argv.includes('--no-build')) {
    console.log('· 构建前端 …')
    const build = spawnSync('npm', ['run', 'build'], { cwd: ROOT, shell: true, stdio: 'inherit' })
    if ((build.status ?? 1) !== 0) process.exit(build.status ?? 1)
  }

  console.log(`· 部署到 Pages 项目 ${TARGET.name}（账号 ${file.CLOUDFLARE_ACCOUNT_ID || '凭据默认'}）`)
  const args = ['pages', 'deploy', 'dist', '--project-name', TARGET.name, '--config', GENERATED]
  if (dryRun) args.push('--dry-run')
  const result = spawnSync(process.execPath, [WRANGLER, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...TARGET.env },
  })
  const out = `${result.stdout ?? ''}${result.stderr ?? ''}`
    .replace(/\u001b\[[0-9;]*m/g, '')
    .trim()
    .split('\n')
    .filter(Boolean)
  console.log(out.slice(-12).join('\n'))
  process.exitCode = result.status ?? 1
} finally {
  rmSync(resolve(ROOT, GENERATED), { force: true })
}
