import { useEffect, useState } from 'react'

/**
 * localStorage 持久化状态（前端原型用）。
 * 注意：数据仅保存在当前浏览器，清除缓存或更换设备后丢失。
 */
export function usePersistentState<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw != null) return JSON.parse(raw) as T
    } catch {
      // 数据损坏时回退到初始值
    }
    return initial
  })

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // 存储失败（如隐私模式）时静默忽略
    }
  }, [key, value])

  return [value, setValue] as const
}
