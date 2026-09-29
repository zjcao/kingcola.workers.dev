/**
 * 「方向 / 角色」字典的存储层。
 *
 * ## 存哪：KV 优先读，D1 存一份事实源
 *
 * 需求是「后台能自由增删改这份名单」，所以不能是代码常量（`shared/types.ts` 里原来的
 * `MEMBER_ROLES` 就是常量，改一个词都要发一次版）。选择 KV 是因为它**读多写极少**
 * （几十条、一年改几次）、边缘就近读、后台一改立刻生效。
 *
 * 但它**同时会在 D1 `site_config['memberRoles']` 写一份**，理由有三条，都是实际会遇到的：
 *   1. 与全仓约定一致：「D1 唯一事实源，KV 只做配置缓存」。KV 是缓存，删了也不该丢数据；
 *   2. 本地开发 / 预览环境可能没绑 `CONFIG_KV`（绑定是可选的），那时直接走 D1，功能不受影响；
 *   3. KV 没有事务也没有备份，把唯一的字典放在里面风险不对称 —— 丢的是数据，不是缓存。
 *
 * ## 失效策略
 * 写入时**删掉 KV 缓存**，让下一次读回落 D1 并顺手回填（与 `routes/config.ts` 的
 * runtime 配置完全同一套做法）。为什么不直接 `put` 新值？因为「D1 写成功、KV 写失败」
 * 会留下一份**永久过期**的缓存（KV 条目没有 TTL），而「删掉」最坏也只是多读一次 D1。
 *
 * ⚠️ KV 是最终一致的：后台改完，其他机房最多约 60 秒后才会看到新名单
 * （与 runtime 配置同样的时效，属于可接受范围）。
 */

import { normalizeMemberRoles, type MemberRole } from '../../shared/identity'
import type { Env } from '../env'
import { getConfigValue, setConfigValue } from './repo'

/** KV 命名空间是全局的，key 加前缀避免与 runtime 缓存之类撞名 */
const ROLE_KV_KEY = 'member_roles'

/** D1 site_config 里的键名（与 KV 键分开写：两者命名习惯不同，硬绑成同一个容易看错） */
const ROLE_CONFIG_KEY = 'memberRoles'

/**
 * 读取当前字典。
 * 顺序：KV 缓存 → D1（事实源，读到就顺手回填 KV）→ 内置默认值。
 * **任何异常都退回默认值**，绝不抛错 —— 字典读不出来不该让官网与招新一起挂。
 */
export async function getMemberRoles(env: Env): Promise<MemberRole[]> {
  if (env.CONFIG_KV) {
    const cached = await env.CONFIG_KV.get(ROLE_KV_KEY, 'json').catch(() => null)
    if (cached) return normalizeMemberRoles(cached)
  }

  const stored = await getConfigValue<unknown>(env, ROLE_CONFIG_KEY)
  const roles = normalizeMemberRoles(stored)

  // 只在实际配过的时候回填：没配过就走默认值，不必在 KV 里留下一条「等于默认」的副本
  // （否则将来改动 DEFAULT_MEMBER_ROLES 时，这条旧副本会把它盖住）
  if (stored && env.CONFIG_KV) {
    await env.CONFIG_KV.put(ROLE_KV_KEY, JSON.stringify(roles)).catch(() => {})
  }

  return roles
}

/** 保存整份字典（调用方已经过 `validateMemberRoles` 校验） */
export async function setMemberRoles(env: Env, roles: MemberRole[]): Promise<void> {
  // 先写事实源，再删缓存：顺序反了的话，中间失败会留下「缓存是新的、D1 是旧的」的组合
  await setConfigValue(env, ROLE_CONFIG_KEY, roles)
  if (env.CONFIG_KV) await env.CONFIG_KV.delete(ROLE_KV_KEY).catch(() => {})
}

/**
 * 每个方向名当前有多少成员在用 —— 后台删除 / 停用方向时的提示依据。
 *
 * 这里刻意**不排除已毕业成员**：字典改动对「在组」和「已毕业」是一视同仁的
 * （都不回写历史值），提示的数字当然也应该涵盖他们。
 */
export async function memberRoleUsage(env: Env): Promise<Record<string, number>> {
  const rows = await env.DB.prepare('SELECT title, COUNT(*) AS count FROM members GROUP BY title')
    .all<{ title: string; count: number }>()

  const usage: Record<string, number> = {}
  for (const row of rows.results ?? []) {
    const label = String(row.title ?? '').trim()
    if (label) usage[label] = Number(row.count) || 0
  }
  return usage
}
