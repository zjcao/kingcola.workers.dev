/**
 * 应用自建表：把**打包进产物**的迁移（`migrations.generated.ts`）按 `_migrations` 台账执行掉。
 *
 * 为什么由应用来做：安装页需要「零手工」完成安装 —— 不依赖任何本机脚本，也不依赖 CI token 的 D1 权限。
 * 代码跑在 Cloudflare 上，所以建表也就发生在 Cloudflare 上（走 Worker 自己的 D1 binding）。
 *
 * 与 `scripts/migrate.mjs` 的关系：两者共用同一套台账语义（执行过的不再执行）。
 * 本地/CI 仍可用脚本；线上则由这里在安装时兜底。
 */
import { MIGRATIONS } from '../migrations.generated'
import type { Env } from '../env'

export interface MigrateResult {
  ok: boolean
  /** 本次实际执行了的迁移文件 */
  applied: string[]
  /** 失败原因（会原样回给安装页，方便排查） */
  reason?: string
}

export async function runPendingMigrations(env: Env): Promise<MigrateResult> {
  if (!env.DB) {
    return { ok: false, applied: [], reason: 'D1 未绑定：请先在 Cloudflare 面板创建数据库，并绑定为 DB' }
  }

  const applied: string[] = []
  try {
    await env.DB.exec('CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);')
    const rows = await env.DB.prepare('SELECT name FROM _migrations').all<{ name: string }>()
    const done = new Set((rows.results ?? []).map((row) => String(row.name)))

    for (const migration of MIGRATIONS) {
      if (done.has(migration.name)) continue
      await env.DB.exec(migration.sql)
      await env.DB.prepare("INSERT OR REPLACE INTO _migrations (name, applied_at) VALUES (?, datetime('now'))")
        .bind(migration.name)
        .run()
      applied.push(migration.name)
    }
  } catch (error) {
    return {
      ok: false,
      applied,
      reason: `建表失败：${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { ok: true, applied }
}

/**
 * 是否已经安装：**部署配置显式声明** 或 **D1 里已有管理员**。
 *
 * `INSTALL_STATE` 是部署侧（构建/面板）写进来的标志，运行时改不了它 —— 所以：
 * 装完之后请在**面板的环境变量里**把它覆盖成 `installed`（不要把这个状态提交回仓库，
 * 它属于「某个部署的当前状态」，不是项目的通用默认值）。它的好处是：
 * 重新部署后不必等一次 D1 查询就能直接锁死安装入口。
 */
export async function isInstalled(env: Env): Promise<boolean> {
  if ((env.INSTALL_STATE ?? '').trim().toLowerCase() === 'installed') return true
  if (!env.DB) return false
  try {
    const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM admin_users').first<{ n: number }>()
    return Number(row?.n ?? 0) > 0
  } catch {
    // 表还不存在 —— 就是「没安装」
    return false
  }
}
