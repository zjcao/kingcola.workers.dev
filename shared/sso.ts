/**
 * 教务网单点登录契约（OAuth 2.0 授权码模式）。
 *
 * 两个角色：
 *   - 授权服务器（IdP）：部署在国内 EdgeOne 的服务，是唯一能访问学校教务网的一方，
 *     浏览器与主站都不直接接触教务网。
 *   - 主站（SP）：拾光工作室官网，运行在 Cloudflare Workers。
 *
 * 一次登录的完整往返：
 *   1) 浏览器打开主站 /api/auth/login
 *      主站生成 state 并写入 HttpOnly Cookie，302 跳转到 IdP 授权页
 *   2) 授权页展示二维码，用户用微信扫码并在手机上确认
 *   3) 授权页展示「申请获取你的 姓名、学号」，用户点同意
 *      → 调 IdP approve 换一次性 code
 *      → 浏览器跳回主站 /api/auth/callback?code=...&state=...
 *   4) 主站比对 state，用 code + clientSecret 调 IdP token
 *      → 取得学号、姓名与 applyToken
 *   5) 主站签发报名会话 Cookie，302 回首页
 *
 * 凭证格式：applyToken 是紧凑签名令牌 `base64url(JSON) + "." + base64url(HMAC-SHA256)`，
 * 与主站 worker/lib/crypto.ts 的 signToken 完全一致，主站因此不需要第二套验签实现。
 * 两端共用同一个 QR_SIGN_SECRET，IdP 签发、主站验签。
 *
 * 响应信封：IdP 侧为扁平 `{ ok, ...字段 }`，主站侧为 `{ ok, data }`。
 */

/** 主站在 IdP 处的注册标识 */
export const SSO_CLIENT_ID = 'kingcola'

/** 授权码有效期：一次性且极短，换取后即可丢弃 */
export const AUTH_CODE_TTL_SECONDS = 60

/** 二维码有效期（秒） */
export const QR_TTL_SECONDS = 300

/** state 有效期：从发起登录到回调必须在这个窗口内完成 */
export const OAUTH_STATE_TTL_SECONDS = 600

/** 报名会话有效期：30 天，覆盖整个招新周期 */
export const STUDENT_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60

/** applyToken 有效期，与报名会话一致 */
export const APPLY_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60

/** applyToken 用途声明，验签时校验 */
export const APPLY_TOKEN_AUDIENCE = 'kingcola-apply'

/** 扫码会话状态 */
export type SsoScanStatus =
  | 'pending' // 等待扫码
  | 'scanned' // 已扫码，等待手机确认
  | 'confirmed' // 已确认，身份已取回，等待用户授权
  | 'expired' // 二维码过期
  | 'error' // 链路失败

/** 授权失败的机器可读原因 */
export type SsoErrorCode =
  | 'invalid_request'
  | 'invalid_client'
  | 'redirect_uri_mismatch'
  | 'access_denied'
  | 'invalid_grant'
  | 'upstream_error'

/* ---------------- IdP 侧端点 ---------------- */

/** 申请扫码会话 */
export interface SsoStartRequest {
  clientId: string
  redirectUri: string
}

export interface SsoStartResponse {
  /** 授权会话 id，与 seal 一并回传 */
  sessionId: string
  /** 教务网返回的二维码图片，data:image/png;base64,... —— 原样展示，不可自行生成 */
  qrcode: string
  /** 无状态密封串：教务网 uuid、Cookie 容器与计数器都在里面，由浏览器保管 */
  seal: string
  expiresIn: number
}

/** 单次轮询，轮询节奏由浏览器决定 */
export interface SsoPollRequest {
  sessionId: string
  seal: string
}

export interface SsoPollResponse {
  status: SsoScanStatus
  message?: string
  /** 轮换后的新封印，调用方须覆盖旧的；流程结束时不返回 */
  seal?: string
}

/** 用户点击同意后换取授权码 */
export interface SsoApproveRequest {
  sessionId: string
  seal: string
  clientId: string
  redirectUri: string
  state: string
}

export interface SsoApproveResponse {
  /** 一次性授权码 */
  code: string
  /** 拼接好的回跳地址，浏览器直接跳过去即可 */
  redirectTo: string
  expiresIn: number
}

/** 主站服务端用授权码换身份（server-to-server） */
export interface SsoTokenRequest {
  code: string
  clientId: string
  clientSecret: string
}

export interface SsoTokenResponse {
  studentId: string
  name: string
  /** 与主站共用密钥签发的紧凑令牌 */
  applyToken: string
  expiresIn: number
}

/* ---------------- 主站侧端点 ---------------- */

/** 当前报名登录态，供前端在页面加载时查询 */
export interface SsoMeResponse {
  authenticated: boolean
  studentId?: string
  name?: string
}

/* ---------------- 凭证载荷 ---------------- */

export interface ApplyTokenPayload {
  /** 授权会话 id */
  sid: string
  /** 学号 */
  sub: string
  name: string
  iat: number
  exp: number
  aud: typeof APPLY_TOKEN_AUDIENCE
}

/** 授权页要展示给用户确认的字段，与教务网实际可取到的信息一一对应 */
export const SSO_SHARED_CLAIMS = [
  { key: 'name', label: '姓名', note: '用于报名表署名与面谈通知' },
  { key: 'studentId', label: '学号', note: '用于核对在校生身份' },
] as const

/** IdP 授权页地址：根路径 + 授权参数 */
export function buildAuthorizeUrl(
  idpBase: string,
  params: { clientId: string; redirectUri: string; state: string },
): string {
  const url = new URL(idpBase.replace(/\/+$/, '') + '/')
  url.searchParams.set('client_id', params.clientId)
  url.searchParams.set('redirect_uri', params.redirectUri)
  url.searchParams.set('state', params.state)
  url.searchParams.set('response_type', 'code')
  return url.toString()
}

/** IdP 的授权码换取端点 */
export function idpTokenUrl(idpBase: string): string {
  return idpBase.replace(/\/+$/, '') + '/api/auth/token'
}
