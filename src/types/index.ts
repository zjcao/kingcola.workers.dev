/**
 * 实体类型统一从 shared/ 引入，保证前端与 Worker 使用同一份契约。
 * 保留本文件是为了让既有 `@/types` 引用继续可用。
 */
export * from '@shared/types'
