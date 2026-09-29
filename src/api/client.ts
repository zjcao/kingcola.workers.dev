/**
 * API 传输层：统一错误处理。
 *
 * 历史上曾有「报名提交走国内 EdgeOne 通道」的分流/灰度（runtime.join），
 * 2026-09-24 随对象存储管理页一起移除 —— API 恒定同源，文件接入由存储适配层负责。
 */

import {
  DEFAULT_RUNTIME_CONFIG,
  RUNTIME_CACHE_KEY,
  type RuntimeConfig,
  type RuntimeConfigResponse,
} from '@shared/runtime'
import { DEFAULT_SITE_CONFIG, type ApiResult, type SiteConfig } from '@shared/types'

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code = 'UNKNOWN', status = 0) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }
}

// ===== 运行时配置缓存 =====

let runtime: RuntimeConfig = loadCachedRuntime()
let site: SiteConfig = DEFAULT_SITE_CONFIG
let initialized = true
let refreshPromise: Promise<void> | null = null

function loadCachedRuntime(): RuntimeConfig {
  try {
    const raw = sessionStorage.getItem(RUNTIME_CACHE_KEY)
    if (raw) return { ...DEFAULT_RUNTIME_CONFIG, ...(JSON.parse(raw) as RuntimeConfig) }
  } catch {
    // 隐私模式或数据损坏，走默认配置
  }
  return DEFAULT_RUNTIME_CONFIG
}

export function getRuntimeConfig(): RuntimeConfig {
  return runtime
}

export function getSiteConfig(): SiteConfig {
  return site
}

export function isInitialized(): boolean {
  return initialized
}

/** 拉取运行时配置；并发调用会合并为一次请求 */
export async function refreshRuntimeConfig(): Promise<void> {
  if (refreshPromise) return refreshPromise
  refreshPromise = (async () => {
    try {
      const response = await fetch('/api/config/runtime', { credentials: 'include', cache: 'no-store' })
      if (!response.ok) return
      const result = (await response.json()) as ApiResult<RuntimeConfigResponse>
      if (!result.ok) return
      runtime = { ...DEFAULT_RUNTIME_CONFIG, ...result.data.config }
      site = { ...DEFAULT_SITE_CONFIG, ...result.data.site }
      initialized = result.data.initialized
      try {
        sessionStorage.setItem(RUNTIME_CACHE_KEY, JSON.stringify(runtime))
      } catch {
        // 忽略存储失败
      }
    } catch {
      // 保留上一次（或默认）配置，站点不能因为配置接口故障而不可用
    } finally {
      refreshPromise = null
    }
  })()
  return refreshPromise
}

// ===== 底层请求 =====

export interface RequestOptions {
  timeoutMs?: number
  signal?: AbortSignal
}

async function doFetch<T>(base: string, path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  // 调用方传入的 signal 与超时信号合并
  if (init.signal) {
    init.signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const response = await fetch(`${base}${path}`, {
      ...init,
      credentials: 'include',
      signal: controller.signal,
    })

    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('application/json')) {
      if (response.ok) return undefined as T
      throw new ApiError(`服务返回了非 JSON 响应（HTTP ${response.status}）`, 'BAD_RESPONSE', response.status)
    }

    const result = (await response.json()) as ApiResult<T>
    if (!result.ok) {
      throw new ApiError(result.error.message, result.error.code, response.status)
    }
    return result.data
  } catch (error) {
    if (error instanceof ApiError) throw error
    const aborted = (error as Error)?.name === 'AbortError'
    throw new ApiError(aborted ? '请求超时，请检查网络' : '网络异常，无法连接服务', aborted ? 'TIMEOUT' : 'NETWORK_ERROR', 0)
  } finally {
    clearTimeout(timer)
  }
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  options: RequestOptions = {},
): Promise<T> {
  const { timeoutMs = 15_000 } = options
  return doFetch<T>('', path, { ...init }, timeoutMs)
}

export function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }
}

/** 页面重新可见或长时间停留时刷新配置，让存量页面也能感知通道切换 */
export function installConfigRefresh(): () => void {
  const onVisible = () => {
    if (document.visibilityState === 'visible') void refreshRuntimeConfig()
  }
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(() => void refreshRuntimeConfig(), 5 * 60 * 1000)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
  }
}
