/**
 * 运行时配置下发 —— 支撑「Cloudflare 主站 + 国内 serverless 降级」的流量切换。
 *
 * 读取优先级：KV 缓存 → D1 site_config['runtime'] → 环境变量默认值。
 * 响应固定 no-store，保证后台一切换，下一个页面加载就能拿到新通道。
 */

import { publicSmtpConfig } from '../../shared/mail'
import {
  DEFAULT_RUNTIME_CONFIG,
  publicSsoConfig,
  type RuntimeConfig,
  type RuntimeConfigResponse,
} from '../../shared/runtime'
import { ok } from '../lib/http'
import { countAdmins } from '../lib/auth'
import { resolveMailPassword } from '../lib/mailer'
import { getConfigValue, getSiteConfig } from '../lib/repo'
import { resolveQrSignSecret, resolveSsoClientSecret } from '../lib/sso-config'
import type { RequestContext } from '../lib/router'

const RUNTIME_CONFIG_KEY = 'runtime'
const KV_CACHE_TTL_SECONDS = 60

/**
 * 部署引导值（可选）。
 *
 * 教务网登录的开关、地址、回调地址与客户端密钥现在**都以后台设置为准**（存在 D1）。
 * 这里保留环境变量只是为了让「已经配了 SSO_* 的老部署」平滑过渡：
 * 一旦后台保存过一次，D1 里的值会覆盖它（merge 时 stored 在最外层）。
 *
 * ⚠️ 客户端密钥（`SSO_CLIENT_SECRET`）刻意**不**写进引导值 —— 它是密钥、不该落进配置 JSON；
 * 后台没填时由 `ssoClientSecretOf()` 直接读环境变量兜底，后台只显示「当前用的是环境变量」。
 */
function bootstrapDefaults(env: RequestContext['env']): Partial<RuntimeConfig> {
  const authorizeBase = (env.SSO_AUTHORIZE_BASE ?? '').trim()
  const redirectUri = (env.SSO_REDIRECT_URI ?? '').trim()
  if (!authorizeBase && !redirectUri) return {}
  return {
    sso: {
      ...DEFAULT_RUNTIME_CONFIG.sso,
      // 老部署里「配了地址」就等于「要开这个入口」，沿用原来的推断
      enabled: DEFAULT_RUNTIME_CONFIG.sso.enabled || Boolean(authorizeBase),
      authorizeBase,
      redirectUri,
    },
  }
}

function merge(base: RuntimeConfig, ...patches: Partial<RuntimeConfig>[]): RuntimeConfig {
  let result = base
  for (const patch of patches) {
    result = {
      ...result,
      ...patch,
      sso: { ...result.sso, ...(patch.sso ?? {}) },
      mail: { ...result.mail, ...(patch.mail ?? {}) },
    }
  }
  return result
}

/**
 * 合并「KV 缓存 → D1 → 环境变量引导值」，**不做解密** —— 凭据保持 `enc$…` 密文。
 */
async function mergedRuntimeConfig(ctx: RequestContext): Promise<RuntimeConfig> {
  const { env } = ctx

  if (env.CONFIG_KV) {
    const cached = await env.CONFIG_KV.get(RUNTIME_CONFIG_KEY, 'json')
    if (cached) return merge(DEFAULT_RUNTIME_CONFIG, cached as Partial<RuntimeConfig>)
  }

  const raw = await getConfigValue<Partial<RuntimeConfig>>(env, RUNTIME_CONFIG_KEY)
  const stored = merge(DEFAULT_RUNTIME_CONFIG, bootstrapDefaults(env), raw ?? {})
  if (env.CONFIG_KV) {
    // 注意：写缓存的是**未解密**的版本（密码、客户端密钥仍是 enc$ 密文），
    // 别把明文凭据放进 KV
    ctx.exec.waitUntil(
      env.CONFIG_KV.put(RUNTIME_CONFIG_KEY, JSON.stringify(stored), { expirationTtl: KV_CACHE_TTL_SECONDS }),
    )
  }
  return stored
}

/**
 * 后台保存配置时的基线：**未解密**的合并结果。
 *
 * ⚠️ 保存时必须用它取「原值」，不能用 `resolveRuntimeConfig()` ——
 * 后者已经把凭据解密成明文，拿明文当基线再写回库，就等于把密文降级成明文
 * （首次保存后一切正常，第二次「留空不修改」就把加密悄悄抹掉了）。
 */
export function resolveStoredRuntimeConfig(ctx: RequestContext): Promise<RuntimeConfig> {
  return mergedRuntimeConfig(ctx)
}

export async function resolveRuntimeConfig(ctx: RequestContext): Promise<RuntimeConfig> {
  const { env } = ctx
  const stored = await mergedRuntimeConfig(ctx)

  // 密码与两把 SSO 密钥在内存里还原成明文，供 mailer / 登录与验签流程使用；
  // 下发前由 publicRuntimeConfig() 统一剥掉
  const [password, clientSecret, qrSignSecret] = await Promise.all([
    resolveMailPassword(env, stored.mail.password),
    resolveSsoClientSecret(env, stored.sso.clientSecret),
    resolveQrSignSecret(env, stored.sso.qrSignSecret),
  ])
  return {
    ...stored,
    mail: { ...stored.mail, password },
    sso: { ...stored.sso, clientSecret, qrSignSecret },
  }
}

/**
 * 下发给前端（含公开接口与后台）的运行时配置：剥掉所有敏感字段。
 * SMTP 密码与 SSO 客户端密钥永远不出服务端 —— 后台也只能看到「有没有配」，看不到值。
 */
export function publicRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return { ...config, mail: publicSmtpConfig(config.mail), sso: publicSsoConfig(config.sso) }
}

/** 后台切换通道后调用，立即失效 KV 缓存 */
export async function invalidateRuntimeConfigCache(env: RequestContext['env']): Promise<void> {
  if (env.CONFIG_KV) await env.CONFIG_KV.delete(RUNTIME_CONFIG_KEY)
}

export async function getRuntimeConfig(ctx: RequestContext): Promise<Response> {
  const [config, site, admins] = await Promise.all([
    resolveRuntimeConfig(ctx),
    getSiteConfig(ctx.env),
    countAdmins(ctx.env),
  ])

  const payload: RuntimeConfigResponse = {
    // 这是公开接口：剥掉 SMTP 密码等敏感字段再下发
    config: publicRuntimeConfig(config),
    site,
    initialized: admins > 0,
  }

  return ok(payload, {
    headers: {
      'cache-control': 'no-store',
      'x-runtime-version': String(config.version),
    },
  })
}
