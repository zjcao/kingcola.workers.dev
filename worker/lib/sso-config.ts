/**
 * 教务网登录（SSO）的敏感配置解析。
 *
 * 与邮件（`worker/lib/mailer.ts`）保持同一套分工：
 * - 开关、授权服务器地址、回调地址存在 D1 的 `site_config['runtime'].sso`，由后台「系统设置 → 流量通道」维护；
 * - **两把密钥**（客户端密钥 `clientSecret`、凭证验签密钥 `qrSignSecret`）同样在后台填，
 *   但落库前都用服务端 secret 加密成 `enc$…`，所有下发接口一律剥离（`publicSsoConfig()`），
 *   前端永远拿不到它们；
 * - 环境变量 `SSO_CLIENT_SECRET` / `QR_SIGN_SECRET` 只作老部署的兜底，取值优先级低于数据库里的值。
 *
 * ⚠️ 环境变量是**运行期只读**的：所以「装完就改后台」而不是「改环境变量再重新部署」是这里的默认姿势。
 */

import type { SsoTarget } from '../../shared/runtime'
import type { Env } from '../env'
import { decryptSecret, encryptSecret, isEncryptedSecret } from './crypto'
import { secretOf } from './secrets'

/**
 * 加密客户端密钥用的密钥：与管理员会话（`SESSION_SECRET`）同源。
 * 走 `secretOf()` 是为了兼容「安装页把 SESSION_SECRET 生成到 D1」的部署方式；
 * 换了它需要到后台把客户端密钥重填一次。
 */
function ssoSecretKey(env: Env): string {
  return secretOf(env, 'SESSION_SECRET') || 'kingcola-dev-insecure-session-secret-change-me'
}

/** 取当前生效的客户端密钥：**数据库里的优先**，环境变量 `SSO_CLIENT_SECRET` 只作兜底 */
export function ssoClientSecretOf(env: Env, sso?: SsoTarget | null): string {
  return (sso?.clientSecret ?? '').trim() || (env.SSO_CLIENT_SECRET ?? '').trim()
}

/** 密钥来自哪里，用于后台提示（数据库 / 环境变量 / 都没有） */
export function ssoClientSecretSourceOf(
  env: Env,
  sso?: SsoTarget | null,
): 'database' | 'env' | 'none' {
  if ((sso?.clientSecret ?? '').trim()) return 'database'
  if ((env.SSO_CLIENT_SECRET ?? '').trim()) return 'env'
  return 'none'
}

/**
 * 还原 D1 里存的客户端密钥（`enc$…` 密文 → 明文）。
 * 空值、解密失败都返回空串，让调用方自然回退到环境变量。
 */
export async function resolveSsoClientSecret(env: Env, stored?: string): Promise<string> {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (!isEncryptedSecret(value)) return value // 兼容历史上直接手填的明文
  const plain = await decryptSecret(value, ssoSecretKey(env))
  if (plain === null) {
    console.warn('[sso] 客户端密钥解密失败（SESSION_SECRET 是否更换过？），已回退到 SSO_CLIENT_SECRET')
    return ''
  }
  return plain
}

/** 后台保存密钥时调用：落库前加密 */
export function encryptSsoClientSecret(env: Env, plain: string): Promise<string> {
  return encryptSecret(plain, ssoSecretKey(env))
}

/**
 * 取当前生效的**凭证验签密钥**（applyToken）：数据库优先，环境变量 `QR_SIGN_SECRET` 兜底。
 *
 * 注意这里不会回退到任何「开发兜底串」—— 兜底串由调用方（`routes/sso.ts`）自己加，
 * 因为「两处都没配」和「配了个空串」对调用方是同一件事：验签必然失败。
 */
export function qrSignSecretOf(env: Env, sso?: SsoTarget | null): string {
  return (sso?.qrSignSecret ?? '').trim() || (env.QR_SIGN_SECRET ?? '').trim()
}

/** 验签密钥来自哪里，用于后台提示（数据库 / 环境变量 / 都没有） */
export function qrSignSecretSourceOf(
  env: Env,
  sso?: SsoTarget | null,
): 'database' | 'env' | 'none' {
  if ((sso?.qrSignSecret ?? '').trim()) return 'database'
  if ((env.QR_SIGN_SECRET ?? '').trim()) return 'env'
  return 'none'
}

/** 还原 D1 里存的验签密钥（`enc$…` 密文 → 明文）；失败返回空串，调用方自然回退到环境变量 */
export async function resolveQrSignSecret(env: Env, stored?: string): Promise<string> {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (!isEncryptedSecret(value)) return value
  const plain = await decryptSecret(value, ssoSecretKey(env))
  if (plain === null) {
    console.warn('[sso] 凭证验签密钥解密失败（SESSION_SECRET 是否更换过？），已回退到 QR_SIGN_SECRET')
    return ''
  }
  return plain
}

/** 后台保存验签密钥时调用：落库前加密 */
export function encryptQrSignSecret(env: Env, plain: string): Promise<string> {
  return encryptSecret(plain, ssoSecretKey(env))
}

/**
 * 回调地址：后台设置 → 环境变量 → 按当前访问域名推导。
 *
 * 三级兜底是为了两件事：生产用后台固定值（避免自定义域名与预览域名不一致），
 * 本地调试不用配任何东西也能跑通。
 */
export function ssoRedirectUriOf(
  env: Env,
  sso: SsoTarget | undefined | null,
  origin: string,
): string {
  const fromAdmin = (sso?.redirectUri ?? '').trim()
  if (fromAdmin) return fromAdmin
  const fromEnv = (env.SSO_REDIRECT_URI ?? '').trim()
  if (fromEnv) return fromEnv
  return new URL('/api/auth/callback', origin).toString()
}
