/**
 * 站点文案的解析规则。
 *
 * 后台为了好编辑，把「段落 / 列表 / 步骤」都存在单个多行文本框里；
 * 这里统一约定解析方式，前后端共用，避免各处 split 规则不一致。
 *
 *   aboutParagraphs  空行分段
 *   joinRequirements 每行一条
 *   joinSteps        每行一条，格式「标题 | 描述」
 *   statLabels       逗号分隔
 *   footerCopyright  可用 {year} 表示当前年份
 */

import type { SiteConfig } from './types'

/** 空行分段；若没有空行则按单行分段 */
export function splitParagraphs(text: string): string[] {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean)
  if (blocks.length > 1) return blocks
  return text
    .split('\n')
    .map((b) => b.trim())
    .filter(Boolean)
}

/** 每行一条 */
export function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export interface JoinStep {
  no: string
  title: string
  desc: string
}

/** 每行「标题 | 描述」；缺少分隔符时整行当作标题 */
export function parseJoinSteps(text: string): JoinStep[] {
  return splitLines(text).map((line, index) => {
    const separator = line.search(/[|｜]/)
    const title = separator === -1 ? line : line.slice(0, separator).trim()
    const desc = separator === -1 ? '' : line.slice(separator + 1).trim()
    return { no: String(index + 1).padStart(2, '0'), title, desc }
  })
}

/** 逗号分隔（中英文逗号都支持），不足时用兜底值补齐 */
export function parseStatLabels(text: string, fallback: string[]): string[] {
  const labels = text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  return fallback.map((defaultLabel, index) => labels[index] ?? defaultLabel)
}

/** 把 {year} 替换成当前年份 */
export function renderCopyright(text: string, now: Date = new Date()): string {
  return text.replace(/\{year\}/g, String(now.getFullYear()))
}

/** 展示用：没有联系方式时返回占位符而不是空白 */
export function orDash(value: string | undefined): string {
  return value && value.trim() ? value : '—'
}

export type { SiteConfig }
