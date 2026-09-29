/**
 * 邮件（SMTP）配置契约 —— 后台「系统设置」、`worker/lib/mailer.ts` 与前端共用同一份定义。
 *
 * 与教务网登录（`shared/sso.ts`）保持同样的分工：
 * - 非敏感项（开关、服务器、端口、发件人）存在 D1 的 `site_config['runtime'].mail`，由后台维护；
 * - 密码只走服务端环境变量 `SMTP_PASSWORD`（`wrangler secret put`），不落库、不下发前端；
 * - 是否可用统一用 `isMailReady()` 判定，避免「后台显示已接通、实际发不出去」。
 *
 * ⚠️ 当前为**空实现阶段**：本文件只冻结契约，真正投递见 `worker/lib/mailer.ts`。
 *    新增字段不需要 D1 迁移（JSON 合并默认值）。
 */

/** 传输加密方式：隐式 TLS（465）/ STARTTLS（587）/ 明文（仅本地调试用） */
export type SmtpSecurity = 'tls' | 'starttls' | 'none'

export interface SmtpConfig {
  /** 总开关：关闭时全站不发送任何邮件 */
  enabled: boolean
  /** SMTP 服务器地址，如 smtp.exmail.qq.com */
  host: string
  /** 端口，常见 465（隐式 TLS）与 587（STARTTLS） */
  port: number
  security: SmtpSecurity
  /** 登录用户名，多数服务商等于发件邮箱；留空表示不认证 */
  username: string
  /** 发件人显示名，如「拾光工作室」 */
  fromName: string
  /** 发件邮箱，必须落在服务商允许的发信地址白名单内 */
  fromAddress: string
  /** 回信地址，留空则用发件邮箱 */
  replyTo: string
  /**
   * SMTP 登录密码 / 授权码。
   *
   * **只存在于服务端与 D1**：落库前用服务端 secret 加密成 `enc$…`，
   * 所有下发接口一律剥离（`publicSmtpConfig()`），前端永远拿不到它。
   * 取值优先级高于 `SMTP_PASSWORD` 环境变量 —— 那个只作兜底。
   */
  password?: string
}

export const DEFAULT_SMTP_CONFIG: SmtpConfig = {
  enabled: false,
  host: '',
  port: 465,
  security: 'tls',
  username: '',
  fromName: '',
  fromAddress: '',
  replyTo: '',
  password: '',
}

export const SMTP_SECURITY_LABELS: Record<SmtpSecurity, string> = {
  tls: 'SSL/TLS',
  starttls: 'STARTTLS',
  none: '不加密',
}

/**
 * 常见端口与加密方式的搭配。
 * 云厂商普遍封禁 25 端口的明文投递，后台只提供这两组可用组合。
 */
export const SMTP_PORT_PRESETS: ReadonlyArray<{ port: number; security: SmtpSecurity; label: string }> = [
  { port: 465, security: 'tls', label: '465 · SSL/TLS（推荐）' },
  { port: 587, security: 'starttls', label: '587 · STARTTLS' },
]

/** 按端口推导加密方式，后台切换端口时用来纠正配置 */
export function securityForPort(port: number, fallback: SmtpSecurity = 'tls'): SmtpSecurity {
  return SMTP_PORT_PRESETS.find((preset) => preset.port === port)?.security ?? fallback
}

/**
 * 配置是否填齐（**不判断密码**：密码是否必需取决于服务商，由服务端拿到 `SMTP_PASSWORD` 后再判）。
 */
export function isMailReady(mail?: SmtpConfig | null): boolean {
  if (!mail || !mail.enabled) return false
  if (!mail.host.trim()) return false
  if (!mail.fromAddress.trim()) return false
  return mail.port > 0 && mail.port <= 65535
}

/**
 * 下发给前端之前剥掉敏感字段。
 *
 * 返回值里的 `password` 是 `undefined`，`JSON.stringify` 会直接丢掉这个键 ——
 * 前端拿到的 mail 根本没有密码字段，也就不可能把它误提交回来（留空即「不修改」）。
 */
export function publicSmtpConfig(mail: SmtpConfig): SmtpConfig {
  return { ...mail, password: undefined }
}

/** 未接通的原因，用于后台提示 */
export function mailStatusText(mail?: SmtpConfig | null): string {
  if (!mail || !mail.enabled) return '已关闭 —— 全站不发送邮件'
  if (!mail.host.trim()) return '未接通 —— 请填写 SMTP 服务器地址'
  if (!mail.fromAddress.trim()) return '未接通 —— 请填写发件邮箱'
  return `已接通：${mail.host.trim()}:${mail.port}（${SMTP_SECURITY_LABELS[mail.security]}）`
}
