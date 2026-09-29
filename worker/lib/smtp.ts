/**
 * SMTP 传输层 —— 基于 `cloudflare:sockets` 的最小实现。
 *
 * 只负责「把一封已经组装好的 MIME 报文投出去」，不碰业务语义（收件人从哪来、正文怎么排版）。
 *
 * 三种连接方式：
 *   - `tls`      → `secureTransport: 'on'`，465 端口，TCP 建连即 TLS
 *   - `starttls` → `secureTransport: 'starttls'`，587 端口，明文 EHLO → STARTTLS → `startTls()`
 *                  → **用返回的新 socket 重建读写器** → 再 EHLO 一次（TLS 会话里必须重新 EHLO）
 *   - `none`     → 明文，仅供本地调试
 *
 * 平台硬约束（2026-09 官方文档，改代码前先记住）：
 *   - **25 端口被封**，只能走 465 / 587；相关邮件需求官方引导用 Email Workers
 *   - **不能连 localhost 与私有网段**，也不能连 Cloudflare 自己的 IP 段
 *   - `startTls()` 只能在 `secureTransport: 'starttls'` 的 socket 上调用一次，
 *     调用后**旧 socket 与旧 reader/writer 全部失效**，必须用新 socket 重新取
 *   - socket 不能在全局作用域创建，必须在请求处理里建（本模块由 handler 调用，天然满足）
 *
 * 设计取舍：STARTTLS 协商失败时**不静默降级成明文**，而是直接报错让后台改用 465 ——
 * 悄悄明文发信等于把 SMTP 密码和邮件内容暴露在链路上。
 */

// 注意：`cloudflare:sockets` 只导出 `connect`；`Socket` 是 @cloudflare/workers-types 里的全局接口
import { connect } from 'cloudflare:sockets'
import type { SmtpSecurity } from '../../shared/mail'

export type SmtpErrorCode =
  | 'CONNECT_FAILED'
  | 'TLS_FAILED'
  | 'AUTH_FAILED'
  | 'REJECTED'
  | 'TIMEOUT'
  | 'PROTOCOL_ERROR'

export class SmtpError extends Error {
  code: SmtpErrorCode
  /** 服务端原话或底层异常信息，用于后台排查（不含密码） */
  detail?: string

  constructor(code: SmtpErrorCode, message: string, detail?: string) {
    super(message)
    this.name = 'SmtpError'
    this.code = code
    this.detail = detail
  }
}

export interface SmtpConnectionOptions {
  host: string
  port: number
  security: SmtpSecurity
  /** 留空表示不认证（本地调试服务器常见） */
  username?: string
  password?: string
  /** 整个会话（建连 + 全部命令）的总超时，默认 20s */
  timeoutMs?: number
  /** EHLO 里报出的客户端域名，默认取发件邮箱域名 */
  clientName?: string
}

export interface SmtpDelivery {
  from: string
  to: string[]
  /** 完整 MIME 报文（CRLF 行尾）；行首点数化与结束点由本层补 */
  data: string
}

const DEFAULT_TIMEOUT_MS = 20_000
const encoder = new TextEncoder()

interface SmtpStream {
  reader: ReadableStreamDefaultReader<Uint8Array>
  writer: WritableStreamDefaultWriter<Uint8Array>
  decoder: TextDecoder
  buffered: string
}

interface SmtpReply {
  code: number
  /** 多行响应拼在一起，便于日志与报错 */
  text: string
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

/** 超时统一用「会话截止时间」判定，避免每一步各自 new 一个定时器 */
async function withTimeout<T>(promise: Promise<T>, deadline: number, label: string): Promise<T> {
  const left = deadline - Date.now()
  if (left <= 0) throw new SmtpError('TIMEOUT', `${label} 超时`)
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new SmtpError('TIMEOUT', `${label} 超时`)), left)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function base64(value: string): string {
  const bytes = encoder.encode(value)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function openStream(socket: Socket): SmtpStream {
  return {
    reader: socket.readable.getReader(),
    writer: socket.writable.getWriter(),
    decoder: new TextDecoder(),
    buffered: '',
  }
}

async function readLine(stream: SmtpStream, deadline: number, label: string): Promise<string> {
  for (;;) {
    const index = stream.buffered.indexOf('\n')
    if (index >= 0) {
      const line = stream.buffered.slice(0, index + 1)
      stream.buffered = stream.buffered.slice(index + 1)
      return line.replace(/[\r\n]+$/, '')
    }
    const chunk = await withTimeout(stream.reader.read(), deadline, label)
    if (chunk.done) throw new SmtpError('PROTOCOL_ERROR', `等待${label}时连接被服务端关闭`)
    stream.buffered += stream.decoder.decode(chunk.value, { stream: true })
  }
}

/** 读一条完整响应：`250-xxx` 续行继续读，遇到 `250 xxx` 才结束 */
async function readResponse(stream: SmtpStream, deadline: number, label: string): Promise<SmtpReply> {
  const lines: string[] = []
  for (;;) {
    const line = await readLine(stream, deadline, label)
    if (line.length < 3) continue
    lines.push(line)
    if (line[3] === '-') continue
    const code = Number(line.slice(0, 3))
    if (!Number.isInteger(code)) {
      throw new SmtpError('PROTOCOL_ERROR', `无法解析服务端响应：${line}`)
    }
    return { code, text: lines.join(' / ') }
  }
}

async function write(stream: SmtpStream, data: string, deadline: number, label: string): Promise<void> {
  try {
    await withTimeout(stream.writer.write(encoder.encode(data)), deadline, `发送${label}`)
  } catch (error) {
    if (error instanceof SmtpError) throw error
    throw new SmtpError('PROTOCOL_ERROR', `发送${label}失败：${describe(error)}`)
  }
}

/** 发命令 + 校验响应码；不符合预期就把服务端原话带出去 */
async function command(
  stream: SmtpStream,
  deadline: number,
  line: string,
  expected: number[],
  label: string,
  code: SmtpErrorCode = 'REJECTED',
): Promise<SmtpReply> {
  await write(stream, `${line}\r\n`, deadline, label)
  const reply = await readResponse(stream, deadline, label)
  if (!expected.includes(reply.code)) {
    throw new SmtpError(code, `${label}失败（服务端返回 ${reply.code}）`, reply.text)
  }
  return reply
}

/** 行首的 `.` 要写成 `..`，否则会被当作报文结束标记 */
function dotStuff(message: string): string {
  return message.replace(/\r?\n/g, '\r\n').replace(/(^|\r\n)\./g, '$1..')
}

function domainOf(address: string): string {
  const at = address.lastIndexOf('@')
  return at >= 0 && at < address.length - 1 ? address.slice(at + 1).trim() : ''
}

async function closeQuietly(socket: Socket): Promise<void> {
  try {
    await socket.close()
  } catch {
    // 连接已经断了就当关好了
  }
}

async function hello(stream: SmtpStream, deadline: number, clientName: string): Promise<void> {
  try {
    await command(stream, deadline, `EHLO ${clientName}`, [250], 'EHLO')
  } catch (error) {
    // 极老的服务器不认 EHLO，退回 HELO（只在「命令不认识」时才退回）
    if (!(error instanceof SmtpError) || !/^(500|501|502|504)/.test(error.detail ?? '')) throw error
    await command(stream, deadline, `HELO ${clientName}`, [250], 'HELO')
  }
}

async function authenticate(
  stream: SmtpStream,
  deadline: number,
  options: SmtpConnectionOptions,
): Promise<void> {
  const username = (options.username ?? '').trim()
  if (!username) return

  const password = options.password ?? ''
  if (!password) {
    throw new SmtpError('AUTH_FAILED', 'SMTP 服务器需要认证，但服务端没有配置 SMTP_PASSWORD')
  }

  // 首选 AUTH LOGIN（兼容性最好）
  try {
    await command(stream, deadline, 'AUTH LOGIN', [334], 'AUTH LOGIN', 'AUTH_FAILED')
    await command(stream, deadline, base64(username), [334], '提交 SMTP 用户名', 'AUTH_FAILED')
    await command(stream, deadline, base64(password), [235], '提交 SMTP 密码', 'AUTH_FAILED')
    return
  } catch (error) {
    if (!(error instanceof SmtpError) || error.code !== 'AUTH_FAILED') throw error
    // 只有「服务器不认这个认证方式」才换 PLAIN；真正的认证失败不重试，避免被风控锁定
    if (!/^(500|501|504)/.test(error.detail ?? '')) throw error
  }

  await command(
    stream,
    deadline,
    `AUTH PLAIN ${base64(`\0${username}\0${password}`)}`,
    [235],
    'AUTH PLAIN',
    'AUTH_FAILED',
  )
}

/** 投递一封邮件。成功即代表服务器已返回 `250` 收下（不代表已进对方收件箱） */
export async function deliverMail(
  options: SmtpConnectionOptions,
  delivery: SmtpDelivery,
): Promise<void> {
  const host = options.host.trim()
  if (!host) throw new SmtpError('CONNECT_FAILED', 'SMTP 服务器地址为空')
  if (delivery.to.length === 0) throw new SmtpError('REJECTED', '没有可投递的收件人')

  const deadline = Date.now() + (options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  const clientName = options.clientName?.trim() || domainOf(delivery.from) || 'localhost'
  const secureTransport =
    options.security === 'tls' ? 'on' : options.security === 'starttls' ? 'starttls' : 'off'

  let socket: Socket
  try {
    socket = connect({ hostname: host, port: options.port }, { secureTransport, allowHalfOpen: false })
    await withTimeout(socket.opened, deadline, `连接 ${host}:${options.port}`)
  } catch (error) {
    if (error instanceof SmtpError) throw error
    const message = describe(error)
    // message 只写「发生了什么」，底层原话放 detail —— 调用方会把两者拼成一句给用户看
    if (/tls|ssl|handshake|certificate/i.test(message)) {
      throw new SmtpError('TLS_FAILED', `与 ${host}:${options.port} 建立 TLS 失败`, message)
    }
    throw new SmtpError('CONNECT_FAILED', `无法连接 ${host}:${options.port}`, message)
  }

  let stream = openStream(socket)

  try {
    const greeting = await readResponse(stream, deadline, '读取服务端问候')
    if (greeting.code !== 220) {
      throw new SmtpError('PROTOCOL_ERROR', `服务端未就绪（${greeting.code}）`, greeting.text)
    }

    await hello(stream, deadline, clientName)

    if (options.security === 'starttls') {
      await command(stream, deadline, 'STARTTLS', [220], 'STARTTLS', 'TLS_FAILED')
      // 升级后旧 socket 与旧读写器全部作废，必须重建（官方文档明确要求）
      socket = socket.startTls()
      stream = openStream(socket)
      await hello(stream, deadline, clientName)
    }

    await authenticate(stream, deadline, options)

    await command(stream, deadline, `MAIL FROM:<${delivery.from}>`, [250], 'MAIL FROM')

    const rejected: string[] = []
    let accepted = 0
    for (const recipient of delivery.to) {
      await write(stream, `RCPT TO:<${recipient}>\r\n`, deadline, 'RCPT TO')
      const reply = await readResponse(stream, deadline, 'RCPT TO')
      if (reply.code === 250 || reply.code === 251) accepted += 1
      else rejected.push(`${recipient}（${reply.code}）`)
    }

    // 部分收件人被拒仍继续投递，交给对方服务器决定；全被拒才算失败
    if (accepted === 0) {
      throw new SmtpError('REJECTED', '所有收件人都被拒收', rejected.join(', '))
    }

    await command(stream, deadline, 'DATA', [354], 'DATA')

    // 正文可能很大，一次写下去由 server 侧消费；点数化必须做，否则正文里的独立 "." 会提前结束报文
    await write(stream, `${dotStuff(delivery.data)}\r\n.\r\n`, deadline, '邮件正文')

    const stored = await readResponse(stream, deadline, '邮件正文')
    if (stored.code !== 250) {
      throw new SmtpError('REJECTED', `服务端拒收邮件（${stored.code}）`, stored.text)
    }

    try {
      await write(stream, 'QUIT\r\n', deadline, 'QUIT')
    } catch {
      // 有的服务器收下信就直接关了连接，QUIT 发不出去不算失败
    }
  } finally {
    await closeQuietly(socket)
  }
}
