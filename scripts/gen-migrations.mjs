#!/usr/bin/env node
// ============================================================================
// 构建时把 `migrations/*.sql` 打包成一个应用可读的文本模块：
//   worker/migrations.generated.ts  →  `export const MIGRATIONS = [{ name, sql }, …]`
//
// 为什么：安装页要能**由跑在 Cloudflare 上的应用自己建表**（不依赖任何本机脚本、也不需要 CI token 的 D1 权限）。
// 应用要执行 SQL，就得先把 SQL 带在产物里 —— 这一步挂在 `npm run build` 最前面，
// 构建在哪儿跑（本机 / Cloudflare 的构建镜像）就在哪儿生成，结果一样。
//
// 用法：node scripts/gen-migrations.mjs      （npm run build 会自动调用）
// ============================================================================

import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const DIR = resolve(ROOT, 'migrations')
const OUT = resolve(ROOT, 'worker', 'migrations.generated.ts')

const files = readdirSync(DIR)
  .filter((name) => name.endsWith('.sql'))
  .sort()

const entries = files.map((name) => {
  const sql = readFileSync(resolve(DIR, name), 'utf8')
  return `  { name: ${JSON.stringify(name)}, sql: ${JSON.stringify(sql)} },`
})

writeFileSync(
  OUT,
  `// 由 scripts/gen-migrations.mjs 在构建时生成 —— 不要手改（改了也会被下一次构建覆盖）。
/* eslint-disable */
export const MIGRATIONS: ReadonlyArray<{ name: string; sql: string }> = [
${entries.join('\n')}
]
`,
)

console.log(`· 已生成 worker/migrations.generated.ts（${files.length} 个迁移文件）`)
