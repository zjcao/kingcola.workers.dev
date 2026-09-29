/**
 * 「部署到哪个账号、哪个 Worker」= 账号专属信息，**不进仓库**。
 *
 * 取值顺序：环境变量 → 本机 `.env.deploy`（已 gitignore）→ `wrangler.toml` 里的默认名。
 * 支持的键：
 *   WORKER_NAME              部署到哪个 Worker（给 wrangler 的 `--name`）
 *   CLOUDFLARE_API_TOKEN     目标账号里创建的 API Token —— 有它就**不用** wrangler 的浏览器登录
 *   CLOUDFLARE_ACCOUNT_ID    多账号凭据下明确指定部署到哪个账号
 *
 * 为什么支持 API Token：wrangler 的 OAuth 登录要靠 `http://localhost:8976/oauth/callback`
 * 回调（本机只绑 IPv6、又可能被代理挡），实测在这台机器上不稳；API Token 完全不走这条链路，
 * 而且**不会覆盖已有的 wrangler 登录态**（想管另一个账号的站时不用来回登录）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** 极简 .env 解析：KEY=VALUE；`#` 注释与空行忽略，值两侧引号去掉 */
export function readDeployFile() {
  const path = resolve(ROOT, '.env.deploy')
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim() || /^\s*#/.test(line)) continue
    const hit = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line)
    if (hit) out[hit[1]] = hit[2].replace(/^["']|["']$/g, '')
  }
  return out
}

/** 环境变量优先，其次 .env.deploy */
function pick(file, key) {
  const fromEnv = (process.env[key] ?? '').trim()
  return fromEnv || (file[key] ?? '').trim()
}

/** 都没配时的兜底：`wrangler.toml` 里的通用名 */
function configName() {
  try {
    const hit = /^\s*name\s*=\s*"([^"]+)"/m.exec(readFileSync(resolve(ROOT, 'wrangler.toml'), 'utf8'))
    return hit ? hit[1] : 'kingcola'
  } catch {
    return 'kingcola'
  }
}

/**
 * @returns {{ name: string, env: Record<string,string> }}
 *   name 给 wrangler 的 `--name`；env 是要补进子进程的环境变量（只带「配了的」项，
 *   没配 token 就继续用 wrangler 的登录态 —— CI 里就是这个情况）。
 */
export function deployTarget() {
  const file = readDeployFile()
  const env = {}
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID']) {
    const value = pick(file, key)
    if (value) env[key] = value
  }
  return { name: pick(file, 'WORKER_NAME') || configName(), env }
}
