/**
 * 运行时配置契约 —— 支撑「Cloudflare 主站 + 国内 serverless 降级」的流量切换。
 *
 * 前端启动时拉取一次，缓存到 sessionStorage；后续按需刷新。
 * 切换通道只需改后台的一个开关，前端不需要重新构建部署。
 */

import { DEFAULT_SMTP_CONFIG, type SmtpConfig } from './mail'
import type { ApiResult, SiteConfig } from './types'

/**
 * ⚠️ 旧版本曾有 `join: ChannelTarget`（报名提交通道，mode/cloudflare/edgeone），
 * 2026-09-24 随对象存储管理页一起移除：文件类接入统一由「对象存储」页管理，
 * API 恒定同源。存量 D1 数据里残留的 join 字段会被 merge 自然忽略。
 */

/**
 * 教务网登录（单点登录）。
 *
 * 开关与授权服务器地址都在后台「系统设置 → 流量通道」维护，
 * 不再需要改环境变量。客户端密钥与回调地址属于敏感/部署相关配置，仍放服务端。
 */
export interface SsoTarget {
  /** 后台开关：是否开放登录入口（关闭后官网不展示，已登录的同学仍保持登录态） */
  enabled: boolean
  /** 授权服务器基址，后台填写；留空视为未接通 */
  authorizeBase: string
}

/**
 * 是否真正可用：开关打开 **且** 填了地址。
 * 两端共用同一条判定，避免「后台说已接通、官网却没有入口」这类不一致。
 */
export function isSsoReady(sso: SsoTarget | undefined | null): boolean {
  if (!sso || !sso.enabled) return false
  return sso.authorizeBase.trim().length > 0
}

/** 未接通的原因，用于后台提示 */
export function ssoStatusText(sso: SsoTarget | undefined | null): string {
  if (!sso || !sso.enabled) return '已关闭 —— 官网不展示登录入口'
  if (!sso.authorizeBase.trim()) return '未接通 —— 请填写授权服务器地址'
  return `已接通：${sso.authorizeBase.trim()}`
}

export interface RuntimeConfig {
  /** 配置版本号，切换时 +1，前端据此判断是否需要刷新 */
  version: number
  updatedAt: string
  /** 教务网单点登录 */
  sso: SsoTarget
  /** 邮件通知（SMTP）。密码不在其中，走服务端 SMTP_PASSWORD */
  mail: SmtpConfig
  /** @deprecated 历史 join 通道遗留字段，已无消费方，仅为兼容旧 JSON 保留 */
  failover: boolean
  /** @deprecated 历史 join 通道灰度比例，已无消费方，仅为兼容旧 JSON 保留 */
  rolloutPercent: number
}

export interface RuntimeConfigResponse {
  config: RuntimeConfig
  site: SiteConfig
  /** 服务端是否已初始化（无管理员账号时为 false） */
  initialized: boolean
}

/** 前端在拉不到运行时配置时的兜底（保证站点不会因配置接口故障而不可用） */
export const DEFAULT_RUNTIME_CONFIG: RuntimeConfig = {
  version: 0,
  updatedAt: '',
  sso: { enabled: false, authorizeBase: '' },
  mail: DEFAULT_SMTP_CONFIG,
  failover: true,
  rolloutPercent: 0,
}

/** 站点配置的客户端缓存键 */
export const RUNTIME_CACHE_KEY = 'kc-runtime-config'

export type RuntimeConfigResult = ApiResult<RuntimeConfigResponse>
