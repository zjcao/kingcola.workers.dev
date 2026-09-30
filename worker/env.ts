/** Worker 绑定与环境变量 */

export interface Env {
  /** D1：唯一事实源 */
  DB: D1Database
  /** KV：运行时配置缓存（可选） */
  CONFIG_KV?: KVNamespace
  /**
   * R2 桶绑定（可在 wrangler.toml 追加更多绑定，如 FILES_SITE / FILES_APPLICATIONS）。
   * 哪个业务目标用哪个绑定，由后台「对象存储」页按绑定名选择；也可改用 S3 兼容存储。
   */
  FILES?: R2Bucket
  /** 静态资源（Vite dist/） */
  ASSETS: Fetcher

  /** 允许跨域的来源，逗号分隔；同源部署时留空 */
  ALLOWED_ORIGINS?: string

  /** 授权服务器基址（可选兜底：后台「系统设置 → 流量通道」填过就以后台为准） */
  SSO_AUTHORIZE_BASE?: string
  /** 主站在授权服务器处的注册标识，需与其客户端白名单一致 */
  SSO_CLIENT_ID?: string
  /**
   * 与授权服务器约定的客户端密钥。
   * **正常在后台填写**（加密存 D1、接口不回显）；这里仅作老部署的兜底。
   */
  SSO_CLIENT_SECRET?: string
  /** 回调地址（可选兜底：后台填过就以后台为准）；两处都没有时按访问域名自动推导 */
  SSO_REDIRECT_URI?: string

  /** SMTP 登录密码 / 授权码，只走服务端（wrangler secret put SMTP_PASSWORD） */
  SMTP_PASSWORD?: string

  /** 管理员会话签名密钥（wrangler secret put SESSION_SECRET） */
  SESSION_SECRET?: string
  /** 报名学生会话签名密钥，与管理员各自独立（wrangler secret put STUDENT_SESSION_SECRET） */
  STUDENT_SESSION_SECRET?: string
  /**
   * applyToken 验签密钥，须与授权服务器的 `APPLY_TOKEN_SECRET` 一致。
   * **正常在后台填写**（加密存 D1、接口不回显）；这里仅作老部署的兜底。
   */
  QR_SIGN_SECRET?: string
  /**
   * 是否已安装的标志（由构建脚本写入初始值 `uninstalled`）。
   * ⚠️ 运行期改不了环境变量，所以**真正的状态在 D1**（`admin_users` 有没有记录）；
   * 这里只作为「首次部署的提示位」，安装页以 D1 为准。
   */
  INSTALL_STATE?: string

  /** 首次部署引导用的初始管理员账号（可选，建议改用 RECOVERY_TOKEN 引导） */
  BOOTSTRAP_USERNAME?: string
  BOOTSTRAP_PASSWORD?: string
}

/** 管理员会话有效期：12 小时 */
export const SESSION_TTL_SECONDS = 12 * 60 * 60

/** 管理员会话 Cookie 名 */
export const SESSION_COOKIE = 'kc_admin'

/** 报名学生会话有效期：30 天，覆盖整个招新周期 */
export const STUDENT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** 报名学生会话 Cookie 名 —— 与管理员会话各自独立，互不影响 */
export const STUDENT_SESSION_COOKIE = 'kc_student'

/** OAuth state Cookie 名，仅用于防跨站请求伪造 */
export const OAUTH_STATE_COOKIE = 'kc_oauth_state'

/** state 有效期：从发起登录到回调必须在这个窗口内完成 */
export const OAUTH_STATE_TTL_SECONDS = 10 * 60
