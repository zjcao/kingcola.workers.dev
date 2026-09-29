/**
 * 纯 Web Crypto 实现的密码哈希、签名与令牌工具。
 * 无第三方依赖，可在 Worker 与边缘函数中通用（EdgeOne 同样支持 Web Crypto）。
 */

const encoder = new TextEncoder()

/**
 * PBKDF2 迭代次数 —— ⚠️ **这个值和 Workers 的 CPU 预算是硬约束**，别随手调大。
 *
 * 2026-09-29 线上实测（免费版账号）：PBKDF2-SHA256 **15 万次会被平台直接掐断**，
 * 表现是登录 / 初始化管理员这类「要算密码哈希」的接口返回 `500 服务异常`（`INTERNAL_ERROR`），
 * 而纯读接口（健康检查、内容、运行时配置）一切正常 —— 排查时很容易误判成数据库或绑定问题。
 * 二分结果：4 万 / 6 万 / 10 万次都能通过，**15 万次必挂**；这里取 5 万，留约 2 倍余量。
 *
 * 想恢复更高强度（OWASP 对 PBKDF2-SHA256 的建议是 60 万次）：先升级到 **Workers Paid**
 * （CPU 上限大幅提高）再调大这里。**已存哈希自带迭代数**（`pbkdf2$<迭代数>$<salt>$<hash>`），
 * 改这个常量不会让旧密码失效；但如果某个旧哈希的迭代数本身超预算（如 15 万），
 * 它每次校验仍会 500 —— 用 `POST /api/admin/bootstrap` 重置一次密码即可。
 */
const PBKDF2_ITERATIONS = 50_000

export function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${randomHex(4)}`
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function base64UrlToBytes(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function utf8ToBase64Url(text: string): string {
  return bytesToBase64Url(encoder.encode(text))
}

function base64UrlToUtf8(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value))
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

// ===== 密码哈希（PBKDF2-SHA256） =====

async function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  )
  return new Uint8Array(bits)
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16)
  crypto.getRandomValues(salt)
  const hash = await deriveKey(password, salt, PBKDF2_ITERATIONS)
  return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(hash)}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false
  const iterations = Number(parts[1])
  if (!Number.isFinite(iterations) || iterations <= 0) return false
  const salt = base64UrlToBytes(parts[2])
  const expected = base64UrlToBytes(parts[3])
  const actual = await deriveKey(password, salt, iterations)
  return timingSafeEqual(actual, expected)
}

/** 密码变更版本号：改密码后所有旧会话自动失效 */
export function passwordVersion(passwordHash: string): string {
  return passwordHash.slice(-12)
}

// ===== HMAC 签名 =====

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ])
}

export async function hmacSign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret)
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return bytesToBase64Url(new Uint8Array(signature))
}

export async function hmacVerify(payload: string, signature: string, secret: string): Promise<boolean> {
  const key = await hmacKey(secret)
  try {
    return await crypto.subtle.verify('HMAC', key, base64UrlToBytes(signature) as unknown as BufferSource, encoder.encode(payload))
  } catch {
    return false
  }
}

// ===== 紧凑签名令牌：base64url(json).base64url(hmac) =====

export interface CompactTokenPayload {
  /** 主体 id */
  sub: string
  /** 过期时间（秒） */
  exp?: number
}

export async function signToken<T extends CompactTokenPayload>(payload: T, secret: string): Promise<string> {
  const body = utf8ToBase64Url(JSON.stringify(payload))
  const signature = await hmacSign(body, secret)
  return `${body}.${signature}`
}

export async function verifyToken<T extends CompactTokenPayload>(token: string, secret: string): Promise<T | null> {
  const idx = token.lastIndexOf('.')
  if (idx <= 0) return null
  const body = token.slice(0, idx)
  const signature = token.slice(idx + 1)
  if (!(await hmacVerify(body, signature, secret))) return null
  try {
    const payload = JSON.parse(base64UrlToUtf8(body)) as T & { exp?: number }
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null
    return payload
  } catch {
    return null
  }
}

// ===== 可还原的凭据（SMTP 密码等）：落库前加密 =====

/** 密文前缀：既能一眼看出「这不是明文」，也给将来换算法留了扩展位 */
const SECRET_PREFIX = 'enc$'

export function isEncryptedSecret(value: string): boolean {
  return value.startsWith(SECRET_PREFIX)
}

async function encryptionKey(secret: string): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', encoder.encode(secret), 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(0),
      info: encoder.encode('kingcola.secret'),
    },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * 加密一段必须能还原的凭据（如 SMTP 密码），格式 `enc$<iv>.<密文>`（base64url）。
 * 密钥由服务端 secret 派生、不落库 —— 所以数据库被读走也拿不到明文。
 */
export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const key = await encryptionKey(secret)
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource },
    key,
    encoder.encode(plain),
  )
  return `${SECRET_PREFIX}${bytesToBase64Url(iv)}.${bytesToBase64Url(new Uint8Array(cipher))}`
}

/**
 * 解密凭据。**解密失败返回 `null`**（换了 secret、数据被改动），
 * 由调用方决定回退策略 —— 绝不抛异常，免得一个坏配置把整个接口带崩。
 * 传入的本来就不是密文时原样返回，兼容历史上直接手填的明文值。
 */
export async function decryptSecret(stored: string, secret: string): Promise<string | null> {
  if (!isEncryptedSecret(stored)) return stored
  const body = stored.slice(SECRET_PREFIX.length)
  const separator = body.indexOf('.')
  if (separator <= 0) return null
  try {
    const iv = base64UrlToBytes(body.slice(0, separator))
    const data = base64UrlToBytes(body.slice(separator + 1))
    const key = await encryptionKey(secret)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as unknown as BufferSource },
      key,
      data as unknown as BufferSource,
    )
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}
