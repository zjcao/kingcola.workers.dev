/**
 * 对象存储契约 —— 适配层（worker/lib/storage/）与后台「对象存储」管理页共用。
 *
 * 两种业务目标（purpose），各自可指向**不同的桶 / 不同的服务商**：
 *   - site          站点内图片（成员头像、首页轮播图、Logo 等公开文件）
 *   - applications  报名表收集（含个人信息的私有文件，仅管理员可下载）
 *
 * 接入方式是**插件式适配器**（worker/lib/storage/registry.ts 的 registerStorageAdapter）：
 * 主流对象存储都兼容 AWS S3 API，内置 `s3` 适配器直接吃 endpoint + 密钥即可接入
 * R2 S3 端点 / MinIO / 腾讯 COS / 阿里 OSS（S3 兼容模式）/ AWS S3 等，无需为每家写胶水层；
 * Cloudflare R2 另有 `r2` 适配器走 Workers binding 直连（零配置、免密钥）。
 * 新服务商只需注册一个新的 provider id，业务代码零改动。
 *
 * 配置存 D1 `site_config['storage']`（JSON 合并默认值，无需迁移）。
 * ⚠️ secretAccessKey 会落库但**绝不下发前端**：接口只回 `secretConfigured`，
 * 保存时 secret 留空表示保留旧值。这与邮件「密码只走环境变量」刻意不同——
 * 两个目标可能是不同服务商的桶，环境变量无法一一对应。
 */

/** 业务目标：站点图片 / 报名表收集 */
export type StoragePurpose = 'site' | 'applications'

export const STORAGE_PURPOSE_LABELS: Record<StoragePurpose, string> = {
  site: '站点图片',
  applications: '报名表收集',
}

export const STORAGE_PURPOSE_HINTS: Record<StoragePurpose, string> = {
  site: '成员头像、首页轮播图、Logo 等站点图片。可配置公开直链基址（自定义域名），访客直接从桶读图，不经 Worker 中转。',
  applications: '招新报名表（PDF / DOCX，含学号姓名等隐私）。独立桶便于按隐私策略管控与整体销毁。',
}

/** 单个目标的配置 */
export interface StorageTargetConfig {
  /** 适配器 id：内置 'r2'（Workers binding 直连）/ 's3'（S3 兼容 API），可由插件扩展 */
  provider: string
  /** r2 模式：env 中的 R2Bucket 绑定名（如 FILES）；s3 模式忽略 */
  binding: string
  /** s3 模式：S3 兼容 API 端点，如 https://<accountid>.r2.cloudflarestorage.com */
  endpoint: string
  /** s3 模式：区域，R2 填 auto */
  region: string
  /** 桶名 */
  bucket: string
  /** s3 模式：Access Key ID */
  accessKeyId: string
  /** s3 模式：Secret Access Key（落库但不下发） */
  secretAccessKey: string
  /** 桶内路径前缀，如 site/ —— 留空表示桶根 */
  pathPrefix: string
  /**
   * 公开读取基址（仅站点图片有意义）：配置自定义域名后，库里直接存
   * `${publicBase}/${key}`，访客直连桶读取，完全绕开 Worker。
   */
  publicBase: string
  /** s3 模式：path-style 寻址（endpoint/bucket/key）。R2、MinIO 需要 true；AWS 可 false */
  forcePathStyle: boolean
  /** 直连令牌有效期（秒），预签名 URL / 一次性令牌共用，默认 900 */
  directTtlSeconds: number
}

export const DEFAULT_STORAGE_TARGET: StorageTargetConfig = {
  provider: 'r2',
  binding: 'FILES',
  endpoint: '',
  region: 'auto',
  bucket: '',
  accessKeyId: '',
  secretAccessKey: '',
  pathPrefix: '',
  publicBase: '',
  forcePathStyle: true,
  directTtlSeconds: 900,
}

export interface StorageConfig {
  site: StorageTargetConfig
  applications: StorageTargetConfig
}

export const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  site: { ...DEFAULT_STORAGE_TARGET },
  applications: { ...DEFAULT_STORAGE_TARGET, pathPrefix: '' },
}

/** 下发给前端的视图：secret 被抹掉，只告知有没有配置 */
export type StorageTargetView = Omit<StorageTargetConfig, 'secretAccessKey'> & {
  secretConfigured: boolean
}

export interface StorageConfigView {
  site: StorageTargetView
  applications: StorageTargetView
}

/** 一次性 / 预签名直连访问的描述（后台管理页用它生成可复制的链接） */
export interface DirectAccessInfo {
  /** presigned = 直连桶（不过后端）；one-time = 单次有效的中转地址（binding 模式的退化方案） */
  mode: 'presigned' | 'one-time'
  method: 'GET' | 'PUT'
  purpose: StoragePurpose
  key: string
  url: string
  expiresAt: string
}

/** 内置适配器的元数据（管理页渲染下拉与说明；第三方插件可在 worker 侧追加注册） */
export interface StorageProviderMeta {
  id: string
  label: string
  description: string
  /** 该模式需要填 S3 凭证（endpoint/bucket/accessKey/secret） */
  needsS3Credentials: boolean
}

export const BUILTIN_STORAGE_PROVIDERS: ReadonlyArray<StorageProviderMeta> = [
  {
    id: 'r2',
    label: 'Cloudflare R2（binding 直连）',
    description: '使用 wrangler.toml 里声明的 R2 桶绑定，零密钥、免运维。binding 不支持预签名，直连退化为「一次性令牌 + 单次中转」。',
    needsS3Credentials: false,
  },
  {
    id: 's3',
    label: 'S3 兼容 API（AWS / R2 / MinIO / COS / OSS…）',
    description: '填端点与 Access Key 即可，SigV4 预签名直传直链，完全绕开后端。绝大多数对象存储都兼容这套 API。',
    needsS3Credentials: true,
  },
]

/**
 * 目标是否填齐了必要字段（不判密钥有效性，连通性由「测试连接」验证）。
 * r2 模式只要绑定名非空；s3 模式要端点 + 桶 + Access Key。
 */
export function isTargetConfigured(target: StorageTargetConfig | undefined | null): boolean {
  if (!target) return false
  if (target.provider === 's3') {
    return Boolean(target.endpoint.trim() && target.bucket.trim() && target.accessKeyId.trim())
  }
  return Boolean(target.binding.trim())
}

/** 目标状态的人话描述（管理页与接口共用；同时接受完整配置与抹掉密钥的视图） */
export function storageTargetStatusText(
  target: StorageTargetConfig | StorageTargetView | undefined | null,
  secretConfigured = false,
): string {
  if (!target) return '未配置'
  if (target.provider === 's3') {
    if (!target.endpoint.trim()) return '未接通 —— 请填写 S3 端点'
    if (!target.bucket.trim()) return '未接通 —— 请填写桶名'
    if (!target.accessKeyId.trim()) return '未接通 —— 请填写 Access Key ID'
    if (!secretConfigured) return '未接通 —— 请填写 Secret Access Key'
    return `已接通：${target.bucket} @ ${target.endpoint.trim().replace(/^https?:\/\//, '')}`
  }
  if (!target.binding.trim()) return '未接通 —— 请填写 R2 绑定名'
  return `已接通：绑定 ${target.binding}`
}

/** 抹掉密钥、补上 secretConfigured，供接口下发 */
export function toTargetView(target: StorageTargetConfig): StorageTargetView {
  const { secretAccessKey, ...rest } = target
  return { ...rest, secretConfigured: Boolean(secretAccessKey.trim()) }
}

/** 按目标浅合并两份配置（保留默认值兜底） */
export function mergeStorageConfig(base: StorageConfig, patch: Partial<StorageConfig>): StorageConfig {
  return {
    site: { ...base.site, ...(patch.site ?? {}) },
    applications: { ...base.applications, ...(patch.applications ?? {}) },
  }
}
