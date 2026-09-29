/** 轻量数据获取 hooks（不引入额外依赖，请求层已具备超时与失败切换）。 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, getRuntimeConfig, getSiteConfig, isInitialized, refreshRuntimeConfig } from './client'
import { fetchBootstrap, type BootstrapData, type RecruitStatusInfo } from './endpoints'
import { RECRUIT_STATE_LABELS } from '@shared/recruit'
import type { SsoTarget } from '@shared/runtime'
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@shared/types'
import { SEED_BY_RESOURCE } from '@shared/seed'

const FALLBACK: BootstrapData = {
  members: SEED_BY_RESOURCE.members as BootstrapData['members'],
  projects: SEED_BY_RESOURCE.projects as BootstrapData['projects'],
  news: SEED_BY_RESOURCE.news as BootstrapData['news'],
  slides: SEED_BY_RESOURCE.slides as BootstrapData['slides'],
  site: DEFAULT_SITE_CONFIG,
  // 接口不可达时按「休眠」处理：不显示招新横幅，也不显示「已结束」
  recruit: {
    state: 'dormant',
    stateLabel: RECRUIT_STATE_LABELS.dormant,
    applyOpen: false,
    gate: 'not_open',
    name: '',
    notice: '',
  } satisfies RecruitStatusInfo,
}

export interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string | null
  reload: () => void
}

/** 通用异步加载：带卸载保护与手动重载 */
export function useAsync<T>(loader: (signal: AbortSignal) => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const loaderRef = useRef(loader)
  loaderRef.current = loader

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError(null)

    loaderRef
      .current(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
      })
      .catch((err: unknown) => {
        if (!active || (err as Error)?.name === 'AbortError') return
        setError(err instanceof ApiError ? err.message : '加载失败，请稍后重试')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  const reload = useCallback(() => setTick((n) => n + 1), [])
  return { data, loading, error, reload }
}

/**
 * 前台首屏聚合数据。
 * 接口不可达时回退到内置种子数据，保证官网永远不白屏。
 */
export function useSiteData() {
  const state = useAsync<BootstrapData>((signal) => fetchBootstrap(signal))
  const site: SiteConfig = state.data?.site ?? getSiteConfig() ?? DEFAULT_SITE_CONFIG
  return {
    ...state,
    data: state.data ?? (state.error ? FALLBACK : null),
    site,
    usingFallback: Boolean(state.error),
  }
}

/**
 * 教务网登录的当前状态（开关 + 授权服务器地址）。
 * 由后台「系统设置 → 流量通道」维护，官网据此决定是否展示登录入口。
 */
export function useSsoTarget(): SsoTarget {
  const [sso, setSso] = useState<SsoTarget>(() => getRuntimeConfig().sso)

  useEffect(() => {
    let active = true
    // 模块级缓存可能来自上次会话，重新拉一次保证与后台一致
    void refreshRuntimeConfig().then(() => {
      if (active) setSso(getRuntimeConfig().sso)
    })
    return () => {
      active = false
    }
  }, [])

  return sso
}

export function useSiteInitialized(): boolean {
  const [initialized, setInitialized] = useState(isInitialized())
  useEffect(() => {
    const timer = window.setInterval(() => setInitialized(isInitialized()), 3000)
    return () => window.clearInterval(timer)
  }, [])
  return initialized
}
