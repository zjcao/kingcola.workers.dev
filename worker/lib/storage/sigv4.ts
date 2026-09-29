/**
 * 极简 AWS SigV4 **查询串预签名**实现（只做 presign，不做请求头签名）。
 *
 * 为什么自己写：presign 只需要 HMAC-SHA256 + 字符串拼接，百来行搞定，
 * 不必为此引入 aws4fetch 之类的依赖（Node 生态包在 Workers 下的兼容性参差）。
 * 适配器的 put/get/delete 也复用同一套预签名 —— 给自己签个 URL 再自己 fetch，
 * 请求体无需参与签名（UNSIGNED-PAYLOAD），省去读全量内容算哈希的开销。
 *
 * 兼容：AWS S3、Cloudflare R2 S3 端点、MinIO、腾讯 COS / 阿里 OSS 的 S3 兼容模式。
 */

export interface SigV4Credentials {
  accessKeyId: string
  secretAccessKey: string
  /** 区域，R2 填 auto */
  region: string
  /** 服务名，固定 s3 */
  service?: string
}

/** AWS URI 编码：RFC 3986，且 ! ' ( ) * 也要转义 */
function uriEncode(value: string, encodeSlash = true): string {
  let out = ''
  for (const ch of value) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) {
      out += ch
    } else if (ch === '/') {
      out += encodeSlash ? '%2F' : '/'
    } else {
      const bytes = new TextEncoder().encode(ch)
      for (const b of bytes) out += '%' + b.toString(16).toUpperCase().padStart(2, '0')
    }
  }
  return out
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function hmacRaw(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key instanceof Uint8Array ? key : new Uint8Array(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data))
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const encoder = new TextEncoder()

/**
 * 生成带 X-Amz-Signature 查询参数的预签名 URL。
 *
 * @param method   GET / PUT / DELETE / HEAD
 * @param endpoint 完整对象地址（含桶与 key 路径、可带额外查询参数，如 response-content-disposition）
 */
export async function presignS3Url(
  method: string,
  endpoint: URL,
  credentials: SigV4Credentials,
  expiresSeconds: number,
): Promise<URL> {
  const service = credentials.service ?? 's3'
  const now = new Date()
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '') // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8)
  const scope = `${dateStamp}/${credentials.region}/${service}/aws4_request`
  const payloadHash = 'UNSIGNED-PAYLOAD'

  const query = new URLSearchParams(endpoint.search)
  query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  query.set('X-Amz-Credential', `${credentials.accessKeyId}/${scope}`)
  query.set('X-Amz-Date', amzDate)
  query.set('X-Amz-Expires', String(Math.max(1, Math.min(604800, Math.floor(expiresSeconds)))))
  query.set('X-Amz-SignedHeaders', 'host')
  query.set('x-amz-content-sha256', payloadHash)

  // 规范查询串：按 key 排序 + URI 编码
  const canonicalQuery = [...query.entries()]
    .map(([k, v]) => [uriEncode(k), uriEncode(v)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&')

  const canonicalUri = endpoint.pathname.split('/').map((seg) => uriEncode(seg)).join('/')
  const canonicalHeaders = `host:${endpoint.host.toLowerCase()}\n`
  const canonicalRequest = [method.toUpperCase(), canonicalUri, canonicalQuery, canonicalHeaders, 'host', payloadHash].join('\n')

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n')

  const kDate = await hmacRaw(encoder.encode(`AWS4${credentials.secretAccessKey}`), dateStamp)
  const kRegion = await hmacRaw(kDate, credentials.region)
  const kService = await hmacRaw(kRegion, service)
  const kSigning = await hmacRaw(kService, 'aws4_request')
  const signature = hex(await hmacRaw(kSigning, stringToSign))

  const signed = new URL(endpoint.toString())
  signed.search = canonicalQuery
  signed.searchParams.set('X-Amz-Signature', signature)
  return signed
}

/** 桶内 key → 对象 URL 的路径部分（逐段编码，保留 / 分隔） */
export function s3ObjectPath(key: string): string {
  return key.split('/').map((seg) => uriEncode(seg)).join('/')
}
