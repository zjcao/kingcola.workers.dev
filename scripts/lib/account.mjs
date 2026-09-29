// ============================================================================
// 账号专属的部署参数：**ACCOUNT_ID**
//
// 仓库要保持通用，所以「部署到哪个 Cloudflare 账号」这种只属于某个人的信息不进仓库，
// 放在本机 `.env.deploy`（已 gitignore）里：
//
//   ACCOUNT_ID=738bff0cfc073b8d2647295f8016748b
//
// 取值顺序：环境变量 CLOUDFLARE_ACCOUNT_ID → 本机 .env.deploy → 空（= 用 wrangler 登录时的默认账号）。
// 三个脚本（ci-deploy / migrate / init-secrets）都通过这里拿账号，换账号时只改一处。
// ============================================================================

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** 目标账号 id；空串表示「用登录时的默认账号」 */
export function accountId() {
  const fromEnv = (process.env.CLOUDFLARE_ACCOUNT_ID ?? '').trim()
  if (fromEnv) return fromEnv

  try {
    for (const line of readFileSync(resolve(ROOT, '.env.deploy'), 'utf8').split('\n')) {
      const hit = /^\s*ACCOUNT_ID\s*=\s*(.+?)\s*$/.exec(line)
      if (hit) return hit[1].replace(/^["']|["']$/g, '')
    }
  } catch {
    // 没有 .env.deploy（CI 里、或别人刚 clone）—— 正常情况，用默认账号
  }
  return ''
}

/** 跑 wrangler 时用的环境变量：指定了账号才注入 CLOUDFLARE_ACCOUNT_ID */
export function wranglerEnv(id = accountId()) {
  return id ? { ...process.env, CLOUDFLARE_ACCOUNT_ID: id } : process.env
}
