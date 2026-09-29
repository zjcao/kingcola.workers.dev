/**
 * 邮件发送（SMTP）业务层。
 *
 * 分工：本文件负责「业务语义」—— 读配置、校验、组装 MIME、把传输层错误归一化成可读结果；
 * 真正的 SMTP 握手在 `worker/lib/smtp.ts`（基于 `cloudflare:sockets`）。
 *
 * 关于平台限制：Workers 没有 Node 的 net/tls，nodemailer 之类用不了；
 * 25 端口被 Cloudflare 封锁，因此配置里只提供 465（隐式 TLS）与 587（STARTTLS）两组组合。
 *
 * 密码不在这份配置里（`SmtpConfig` 无 password 字段），只从服务端 `SMTP_PASSWORD` 取，
 * 不落库、不下发前端 —— 错误信息里也绝不回显密码。
 */

import { isMailReady, type SmtpConfig } from '../../shared/mail'
import type { Env } from '../env'
import { decryptSecret, encryptSecret, isEncryptedSecret, randomHex } from './crypto'
import { deliverMail, SmtpError } from './smtp'

/** 收件人：`a@b.com` 或 `名字 <a@b.com>` 都接受，也允许传数组 */
export type MailRecipient = string | string[]

export interface MailMessage {
  to: MailRecipient
  subject: string
  /** 纯文本正文，必填 —— 不支持 HTML 的客户端靠它兜底 */
  text: string
  html?: string
  /** 回信地址，留空则用配置里的 `replyTo` / `fromAddress` */
  replyTo?: string
  cc?: MailRecipient
}

export type MailFailureCode =
  /** 开关关闭或字段没填齐 */
  | 'NOT_CONFIGURED'
  /** 收件人为空或格式不对 */
  | 'INVALID_MESSAGE'
  | 'CONNECT_FAILED'
  | 'TLS_FAILED'
  | 'AUTH_FAILED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'PROTOCOL_ERROR'

export type MailResult =
  | { ok: true; accepted: string[]; messageId: string }
  | { ok: false; code: MailFailureCode; message: string; detail?: string }

const CRLF = '\r\n'
const encoder = new TextEncoder()

/** 从 `名字 <a@b.com>` / `a@b.com` / 数组里取出纯邮箱地址，顺带过滤掉不合法的项 */
export function normalizeRecipients(value: MailRecipient | undefined): string[] {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return list
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const angled = /<([^>]+)>\s*$/.exec(item)
      return (angled ? angled[1] : item).trim()
    })
    .filter((item) => item.includes('@'))
}

/** 加密凭据用的密钥：与管理员会话同源，不额外新增环境变量（换了它需要到后台重填密码） */
function mailSecretKey(env: Env): string {
  return env.SESSION_SECRET ?? 'kingcola-dev-insecure-session-secret-change-me'
}

/**
 * 取当前生效的 SMTP 密码：**数据库里保存的优先**，环境变量 `SMTP_PASSWORD` 只作兜底。
 * 传进来的 `config.password` 应当已经由 `resolveMailPassword()` 还原成明文。
 */
export function mailPasswordOf(env: Env, config?: SmtpConfig | null): string {
  return (config?.password ?? '').trim() || (env.SMTP_PASSWORD ?? '').trim()
}

/** 密码来自哪里，用于后台提示（数据库 / 环境变量 / 都没有） */
export function mailPasswordSourceOf(
  env: Env,
  config?: SmtpConfig | null,
): 'database' | 'env' | 'none' {
  if ((config?.password ?? '').trim()) return 'database'
  if ((env.SMTP_PASSWORD ?? '').trim()) return 'env'
  return 'none'
}

/** 配置 + 密码都齐了才算能发（填了用户名就必须有密码） */
export function isMailConfigured(env: Env, config?: SmtpConfig | null): boolean {
  if (!isMailReady(config) || !config) return false
  if (!config.username.trim()) return true // 服务器不要求认证（本地调试、内网中继）
  return Boolean(mailPasswordOf(env, config))
}

/**
 * 还原 D1 里存的 SMTP 密码（`enc$…` 密文 → 明文）。
 *
 * 空值、解密失败都返回空串，让调用方自然回退到环境变量；
 * 解密失败多半是 `SESSION_SECRET` 换过了，日志里留一句便于排查。
 */
export async function resolveMailPassword(env: Env, stored?: string): Promise<string> {
  const value = (stored ?? '').trim()
  if (!value) return ''
  if (!isEncryptedSecret(value)) return value // 兼容历史直接手填的明文
  const plain = await decryptSecret(value, mailSecretKey(env))
  if (plain === null) {
    console.warn('[mailer] SMTP 密码解密失败（SESSION_SECRET 是否更换过？），已回退到 SMTP_PASSWORD')
    return ''
  }
  return plain
}

/** 后台保存密码时调用：落库前加密 */
export function encryptMailPassword(env: Env, plain: string): Promise<string> {
  return encryptSecret(plain, mailSecretKey(env))
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 && at < address.length - 1 ? address.slice(at + 1).trim() : ''
}

function toBase64(value: string): string {
  const bytes = encoder.encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

/** 正文按 MIME 要求每 76 字符折行 */
function base64Body(value: string): string {
  const encoded = toBase64(value)
  const lines: string[] = []
  for (let i = 0; i < encoded.length; i += 76) lines.push(encoded.slice(i, i + 76))
  return lines.join(CRLF)
}

function stripBreaks(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim()
}

/** 显示名：纯 ASCII 且不含特殊字符时原样，否则按 RFC 2047 用 Base64 编码 */
function encodeDisplayName(value: string): string {
  const clean = stripBreaks(value)
  if (/^[\x20-\x7E]*$/.test(clean)) {
    return /[",;:<>@\\[\]()]/.test(clean) ? `"${clean.replace(/(["\\])/g, '\\$1')}"` : clean
  }
  return `=?UTF-8?B?${toBase64(clean)}?=`
}

/** 主题：只要含非 ASCII 字符就必须编码，否则部分客户端会显示乱码 */
function encodeSubject(value: string): string {
  const clean = stripBreaks(value)
  return /^[\x20-\x7E]*$/.test(clean) ? clean : `=?UTF-8?B?${toBase64(clean)}?=`
}

const MIME_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIME_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** RFC 5322 的日期格式，固定按 UTC 写成 +0000 */
function formatDate(date: Date): string {
  const day = `${MIME_DAYS[date.getUTCDay()]}, ${pad2(date.getUTCDate())} ${MIME_MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
  const time = `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())}`
  return `${day} ${time} +0000`
}

export interface MimePayload {
  from: string
  fromName?: string
  to: string[]
  cc?: string[]
  subject: string
  text: string
  html?: string
  replyTo?: string
}

export interface BuiltMime {
  /** 完整报文，CRLF 行尾，可直接交给 smtp.ts 的点数化逻辑 */
  raw: string
  messageId: string
}

/**
 * 组装 MIME 报文。
 * 有 HTML 就用 `multipart/alternative` 包一层（纯文本在前、HTML 在后，符合 RFC 2046 的偏好顺序）；
 * 正文一律 Base64 + UTF-8，中文不需要额外处理。
 */
export function buildMimeMessage(payload: MimePayload): BuiltMime {
  const from = payload.from.trim()
  const domain = domainOf(from) || 'kingcola.local'
  const messageId = `<${randomHex(16)}@${domain}>`
  const displayName = payload.fromName?.trim()

  const headers = [
    `From: ${displayName ? `${encodeDisplayName(displayName)} <${from}>` : `<${from}>`}`,
    `To: ${payload.to.join(', ')}`,
  ]
  if (payload.cc?.length) headers.push(`Cc: ${payload.cc.join(', ')}`)
  if (payload.replyTo?.trim()) headers.push(`Reply-To: <${payload.replyTo.trim()}>`)
  headers.push(
    `Subject: ${encodeSubject(payload.subject)}`,
    `Date: ${formatDate(new Date())}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
  )

  let body: string
  if (payload.html?.trim()) {
    const boundary = `kc-${randomHex(12)}`
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Body(payload.text),
      `--${boundary}`,
      'Content-Type: text/html; charset="utf-8"',
      'Content-Transfer-Encoding: base64',
      '',
      base64Body(payload.html),
      `--${boundary}--`,
      '',
    ].join(CRLF)
  } else {
    headers.push('Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64')
    body = `${base64Body(payload.text)}${CRLF}`
  }

  return { raw: `${headers.join(CRLF)}${CRLF}${CRLF}${body}`, messageId }
}

/**
 * 发送一封邮件。
 *
 * 成功只代表 SMTP 服务器返回 250 收下（`accepted` 是真正被接收的收件人）；
 * 不代表已进对方收件箱 —— 后续退信与垃圾箱判定不在我们这一侧。
 */
export async function sendMail(env: Env, config: SmtpConfig, message: MailMessage): Promise<MailResult> {
  const to = normalizeRecipients(message.to)
  const cc = normalizeRecipients(message.cc)
  if (to.length === 0) {
    return { ok: false, code: 'INVALID_MESSAGE', message: '收件人为空或格式不正确' }
  }
  if (!config.enabled) {
    return { ok: false, code: 'NOT_CONFIGURED', message: '邮件通知已关闭，未发送' }
  }
  if (!isMailConfigured(env, config)) {
    return {
      ok: false,
      code: 'NOT_CONFIGURED',
      message: '邮件配置不完整：请检查 SMTP 服务器地址、发件邮箱与登录密码',
    }
  }

  const from = config.fromAddress.trim()
  const replyTo = (message.replyTo ?? config.replyTo ?? '').trim() || from
  const recipients = [...to, ...cc]

  const { raw, messageId } = buildMimeMessage({
    from,
    fromName: config.fromName,
    to,
    cc,
    subject: message.subject.trim() || '（无主题）',
    text: message.text,
    html: message.html,
    replyTo,
  })

  try {
    await deliverMail(
      {
        host: config.host,
        port: config.port,
        security: config.security,
        username: config.username,
        // 密码在这里才取出（数据库优先、环境变量兜底），不进日志、不进返回值
        password: mailPasswordOf(env, config),
        clientName: domainOf(from),
      },
      { from, to: recipients, data: raw },
    )
  } catch (error) {
    if (error instanceof SmtpError) {
      return { ok: false, code: error.code, message: error.message, detail: error.detail }
    }
    const detail = error instanceof Error ? error.message : String(error)
    console.error('[mailer] sendMail 未预期的错误', detail)
    return { ok: false, code: 'PROTOCOL_ERROR', message: '发送邮件时发生未预期的错误', detail }
  }

  return { ok: true, accepted: recipients, messageId }
}
