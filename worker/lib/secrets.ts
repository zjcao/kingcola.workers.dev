/**
 * 运行期密钥：**D1 里的 `app_secrets` 表优先，环境变量兜底**。
 *
 * 背景：安装页要能「零手工」完成安装 —— 包括生成 `SESSION_SECRET` / `STUDENT_SESSION_SECRET` 这些
 * 签名密钥。但运行时**无法写自己的环境变量**，所以生成后只能存进 D1；
 * 于是签名/验签这些**同步**取密钥的地方，改成读这里维护的模块级缓存：
 *
 *   · 每个请求入口先 `await warmSecrets(env)` 一次（worker/index.ts 里），把缓存填好；
 *   · 取不到（例如本地开发、老部署环境变量里有值）就回退到 `env.X`，行为完全不变。
 *
 * 缓存是「实例级」的：Workers/Pages 的同一个 isolate 会复用，冷启动各拉一次，开销可忽略。
 */
import type { Env } from '../env'

/** 由安装页生成并写入 D1 的密钥（按需扩充） */
export const GENERATED_SECRET_KEYS = ['SESSION_SECRET', 'STUDENT_SESSION_SECRET'] as const
export type GeneratedSecretKey = (typeof GENERATED_SECRET_KEYS)[number]

const cache = new Map<string, string>()

/** 同步取密钥：缓存 → 环境变量 → 空串（调用方自己决定兜底默认值） */
export function secretOf(env: Env, key: GeneratedSecretKey): string {
  const cached = cache.get(key)
  if (cached) return cached
  return ((env as unknown as Record<string, string | undefined>)[key] ?? '').trim()
}

/** 该隔离环境是否已经把 D1 里的密钥读进来了 */
let warmed = false

/** 每个请求入口调一次：把 D1 里的密钥读进缓存（失败/没有表都只是跳过） */
export async function warmSecrets(env: Env): Promise<void> {
  if (warmed || !env.DB) return
  try {
    const rows = await env.DB.prepare('SELECT name, value FROM app_secrets').all<{ name: string; value: string }>()
    for (const row of rows.results ?? []) {
      if (row?.name && row.value) cache.set(row.name, String(row.value))
    }
    warmed = true
  } catch {
    // 还没安装（表不存在）或没有 D1 —— 继续用环境变量，不打扰请求
  }
}

/** 安装时调用：为缺失的密钥生成随机值并写库（已存在的保持不变） */
export async function generateSecrets(env: Env): Promise<{ generated: string[]; ok: boolean }> {
  if (!env.DB) return { generated: [], ok: false }
  const generated: string[] = []
  for (const key of GENERATED_SECRET_KEYS) {
    const exists = await env.DB.prepare('SELECT value FROM app_secrets WHERE name = ?').bind(key).first<{ value: string }>()
    if (exists?.value) {
      cache.set(key, String(exists.value))
      continue
    }
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    const value = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await env.DB.prepare('INSERT OR REPLACE INTO app_secrets (name, value, created_at) VALUES (?, ?, ?)')
      .bind(key, value, new Date().toISOString())
      .run()
    cache.set(key, value)
    generated.push(key)
  }
  warmed = true
  return { generated, ok: true }
}
