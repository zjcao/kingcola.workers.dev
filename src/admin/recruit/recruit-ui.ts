/**
 * 招新后台的界面常量与小工具（纯展示，不含任何业务判断）。
 *
 * 业务语义一律来自 `@shared/recruit`：阶段/结果标签、允许的结果、动作表、状态机……
 * 这里只回答「时间线怎么排、时间怎么显示」这类排版问题。
 */

import {
  RECRUIT_RESULT_LABELS,
  type RecruitResult,
  type RecruitTimelineKey,
} from '@shared/recruit'

/** 顶部时间线（顺序即流程；与后端的 RecruitTimelineKey 一一对应） */
export const TIMELINE: ReadonlyArray<{ key: RecruitTimelineKey; label: string; hint: string }> = [
  { key: 'prepare', label: '备招', hint: '填名称与 QQ 群号 · 手动开启报名' },
  { key: 'apply', label: '报名', hint: '收表 · 替换 · 补录 · 剔除' },
  { key: 'written', label: '笔试', hint: '二维码 / 补签 / 补录 → 结束后录成绩、定面试名单' },
  { key: 'interview', label: '面试', hint: '二维码 / 补签 → 结束后录评语、确认录取' },
  { key: 'defense', label: '答辩', hint: '二维码 / 补签 → 结束后定最终名单' },
  { key: 'onboard', label: '转正', hint: '等本人确认加入' },
]

/** 结果的中文（'' 是「待定」，它不是「没有结果」而是「还没结论」） */
export function resultLabel(value: RecruitResult): string {
  return value === '' ? '待定' : (RECRUIT_RESULT_LABELS[value] ?? value)
}

/** ISO 时间 → 北京时间展示（库里全是 UTC，展示一律换到东八区） */
export function formatTime(iso: string): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function formatSize(bytes: number): string {
  if (!bytes) return '—'
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

/**
 * 从成绩字符串里取数字（「78」「78 分」「78/100」都认）。
 * 成绩是自由文本，所以分数线勾选这里只做宽松解析，非数字就返回 NaN。
 */
export function parseScore(value: string): number {
  return Number(value.match(/-?\d+(\.\d+)?/)?.[0] ?? NaN)
}

/** 让浏览器下载一个后端给出的地址（归档 CSV 走这里） */
export function downloadFile(url: string, filename?: string): void {
  const link = document.createElement('a')
  link.href = url
  if (filename) link.download = filename
  link.click()
}

/** 复制到剪贴板（邀请链接、二维码地址都用它） */
export async function copyText(text: string, label: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    void label
    return false
  }
}
