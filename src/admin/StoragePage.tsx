import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  BUILTIN_STORAGE_PROVIDERS,
  DEFAULT_STORAGE_CONFIG,
  STORAGE_PURPOSE_HINTS,
  STORAGE_PURPOSE_LABELS,
  storageTargetStatusText,
  type DirectAccessInfo,
  type StorageConfigView,
  type StoragePurpose,
  type StorageProviderMeta,
  type StorageTargetView,
} from '@shared/storage'
import { adminGetStorage, adminIssueDirectToken, adminTestStorage, adminUpdateStorage } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { toast } from 'sonner'
import { Database, Link2, PlugZap, Save } from 'lucide-react'
import { cn } from '@/lib/utils'

/** provider id → 元数据；插件注册的 id 没有内置文案，退化为展示 id */
function providerMeta(id: string): StorageProviderMeta {
  return (
    BUILTIN_STORAGE_PROVIDERS.find((p) => p.id === id) ?? {
      id,
      label: id,
      description: '第三方插件注册的存储适配器。',
      needsS3Credentials: false,
    }
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

/** 单个业务目标的配置卡片 */
function TargetCard({
  purpose,
  target,
  providers,
  bindings,
  onChange,
}: {
  purpose: StoragePurpose
  target: StorageTargetView
  providers: string[]
  bindings: string[]
  onChange: (next: Partial<StorageTargetView>) => void
}) {
  const [testing, setTesting] = useState(false)
  const [testMessage, setTestMessage] = useState<{ ok: boolean; message: string } | null>(null)
  const meta = providerMeta(target.provider)

  const runTest = async () => {
    setTesting(true)
    setTestMessage(null)
    try {
      setTestMessage(await adminTestStorage(purpose))
    } catch (error) {
      setTestMessage({ ok: false, message: error instanceof ApiError ? error.message : '测试请求失败' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Database className="h-4 w-4 text-accent" /> {STORAGE_PURPOSE_LABELS[purpose]}
          </h2>
          <p className="mt-1 max-w-xl text-xs leading-relaxed text-muted-foreground">
            {STORAGE_PURPOSE_HINTS[purpose]}
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void runTest()} disabled={testing}>
          <PlugZap className="h-3.5 w-3.5" /> {testing ? '测试中…' : '测试连接'}
        </Button>
      </div>

      <div className="mt-4 grid gap-4">
        <Field label="存储接入方式（provider）" hint={meta.description}>
          <div className="flex flex-wrap gap-2">
            {providers.map((id) => {
              const info = providerMeta(id)
              return (
                <button
                  key={id}
                  onClick={() => onChange({ provider: id })}
                  className={cn(
                    'rounded-full px-3 py-1.5 text-xs transition-colors',
                    target.provider === id
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-foreground/70 hover:bg-secondary',
                  )}
                >
                  {info.label}
                </button>
              )
            })}
          </div>
        </Field>

        {target.provider !== 's3' ? (
          <Field
            label="R2 桶绑定名"
            hint={`wrangler.toml 里 [[r2_buckets]] 的 binding。当前检测到：${bindings.length ? bindings.join('、') : '无'}`}
          >
            <Input
              value={target.binding}
              onChange={(e) => onChange({ binding: e.target.value })}
              list={`bindings-${purpose}`}
              placeholder="FILES"
            />
            <datalist id={`bindings-${purpose}`}>
              {bindings.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </Field>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="S3 端点（endpoint）" hint="如 https://<accountid>.r2.cloudflarestorage.com 或 MinIO 地址">
                <Input
                  value={target.endpoint}
                  onChange={(e) => onChange({ endpoint: e.target.value })}
                  placeholder="https://example.r2.cloudflarestorage.com"
                />
              </Field>
              <Field label="桶名（bucket）">
                <Input value={target.bucket} onChange={(e) => onChange({ bucket: e.target.value })} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Access Key ID">
                <Input value={target.accessKeyId} onChange={(e) => onChange({ accessKeyId: e.target.value })} />
              </Field>
              <Field
                label="Secret Access Key"
                hint={target.secretConfigured ? '已配置 —— 留空表示保持不变' : '尚未配置'}
              >
                <Input
                  type="password"
                  value=""
                  onChange={(e) => onChange({ secretAccessKey: e.target.value } as Partial<StorageTargetView>)}
                  placeholder={target.secretConfigured ? '········（留空保持不变）' : '输入密钥'}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="区域（region）" hint="Cloudflare R2 填 auto">
                <Input value={target.region} onChange={(e) => onChange({ region: e.target.value })} placeholder="auto" />
              </Field>
              <div className="flex items-end justify-between gap-3 rounded-xl border border-border px-4 py-3">
                <div>
                  <div className="text-sm font-medium">path-style 寻址</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">R2 / MinIO 开启；AWS 可关闭（虚拟主机寻址）</p>
                </div>
                <Switch
                  checked={target.forcePathStyle}
                  onCheckedChange={(checked) => onChange({ forcePathStyle: checked })}
                />
              </div>
            </div>
          </>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="桶内路径前缀" hint="如 site/ 或 applications/2026，留空表示桶根；两个目标可用前缀共用一个桶">
            <Input value={target.pathPrefix} onChange={(e) => onChange({ pathPrefix: e.target.value })} placeholder="选填" />
          </Field>
          <Field label="直连有效期（秒）" hint="预签名 URL / 一次性令牌的有效窗口，默认 900">
            <Input
              type="number"
              min={60}
              max={604800}
              value={String(target.directTtlSeconds)}
              onChange={(e) => onChange({ directTtlSeconds: Math.min(604800, Math.max(60, Number(e.target.value) || 900)) })}
            />
          </Field>
        </div>

        {purpose === 'site' && (
          <Field
            label="公开直链基址（publicBase）"
            hint="配置桶的自定义域名后，站点图片地址直接指向桶（如 https://img.example.com），访客读取完全不经 Worker；留空则走 /api/files/ 由 Worker 中转"
          >
            <Input value={target.publicBase} onChange={(e) => onChange({ publicBase: e.target.value })} placeholder="https://img.example.com" />
          </Field>
        )}

        <p
          className={cn(
            'border-t border-border pt-3 text-[11px]',
            testMessage ? (testMessage.ok ? 'text-emerald-600' : 'text-destructive') : 'text-muted-foreground',
          )}
        >
          {testMessage ? testMessage.message : storageTargetStatusText(target, target.secretConfigured)}
        </p>
      </div>
    </div>
  )
}

/** 直连令牌试验台：签发一个链接，验证「不经后端中转」的读写链路 */
function DirectTokenPanel({ bindings }: { bindings: string[] }) {
  const [purpose, setPurpose] = useState<StoragePurpose>('site')
  const [key, setKey] = useState('')
  const [action, setAction] = useState<'get' | 'put'>('get')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<DirectAccessInfo | null>(null)

  const issue = async () => {
    if (!key.trim()) return toast.error('请填写对象 key')
    setBusy(true)
    try {
      setResult(await adminIssueDirectToken({ purpose, key: key.trim(), action }))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '签发失败')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-2xl border border-dashed border-border bg-card p-5">
      <h2 className="flex items-center gap-2 font-display text-lg font-bold">
        <Link2 className="h-4 w-4 text-accent" /> 直连令牌试验台
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        S3 兼容模式签发的是<b>预签名 URL</b>（浏览器直连桶，完全不经 Worker）；
        R2 binding 不支持预签名，退化为<b>一次性令牌</b>（KV 保证只能用一次，消费即焚）。
        {bindings.length === 0 && ' 当前未检测到 R2 绑定。'}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[auto_1fr_auto_auto]">
        <select
          value={purpose}
          onChange={(e) => setPurpose(e.target.value as StoragePurpose)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="site">站点图片</option>
          <option value="applications">报名表收集</option>
        </select>
        <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="对象 key，如 avatars/test.jpg" />
        <div className="flex gap-1.5">
          {(['get', 'put'] as const).map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={cn(
                'rounded-full px-3 py-1.5 text-xs transition-colors',
                action === a
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground/70 hover:bg-secondary',
              )}
            >
              {a === 'get' ? '读取' : '上传'}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => void issue()} disabled={busy}>
          {busy ? '签发中…' : '签发链接'}
        </Button>
      </div>

      {result && (
        <div className="mt-3 rounded-xl bg-secondary/40 p-3 text-xs">
          <p className="text-muted-foreground">
            {result.mode === 'presigned' ? '预签名直连' : '一次性令牌（单次有效）'} · 有效期至{' '}
            {new Date(result.expiresAt).toLocaleString('zh-CN')}
          </p>
          <code className="mt-1.5 block break-all font-mono text-[11px]">{result.url}</code>
        </div>
      )}
    </div>
  )
}

export function StoragePage() {
  const [config, setConfig] = useState<StorageConfigView>({
    site: { ...DEFAULT_STORAGE_CONFIG.site, secretConfigured: false },
    applications: { ...DEFAULT_STORAGE_CONFIG.applications, secretConfigured: false },
  })
  const [providers, setProviders] = useState<string[]>(['r2', 's3'])
  const [bindings, setBindings] = useState<string[]>([])
  const [ready, setReady] = useState<Record<StoragePurpose, boolean>>({ site: false, applications: false })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    adminGetStorage()
      .then((response) => {
        if (!active) return
        setConfig(response.config)
        setProviders(response.providers.length ? response.providers : ['r2', 's3'])
        setBindings(response.bindings)
        setReady(response.ready)
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : '加载对象存储配置失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const response = await adminUpdateStorage({ site: config.site, applications: config.applications })
      setConfig(response.config)
      toast.success('对象存储配置已保存')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">对象存储</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            站点图片与报名表可分属不同的桶 / 服务商；所有接入都走统一的存储适配层，S3 兼容存储直连桶、不经后端中转
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving} className="gap-1.5">
          <Save className="h-4 w-4" /> {saving ? '保存中…' : '保存配置'}
        </Button>
      </div>

      <div className="grid gap-5">
        <div className="grid gap-2 rounded-xl border border-border bg-card px-4 py-3 text-xs text-muted-foreground sm:grid-cols-2">
          <span>
            站点图片当前状态：
            <b className={cn('ml-1', ready.site ? 'font-medium text-emerald-600' : 'text-amber-600')}>
              {ready.site ? '已接通' : '未接通'}
            </b>
          </span>
          <span>
            报名表收集当前状态：
            <b className={cn('ml-1', ready.applications ? 'font-medium text-emerald-600' : 'text-amber-600')}>
              {ready.applications ? '已接通' : '未接通'}
            </b>
          </span>
        </div>

        <TargetCard
          purpose="site"
          target={config.site}
          providers={providers}
          bindings={bindings}
          onChange={(next) => setConfig((prev) => ({ ...prev, site: { ...prev.site, ...next } }))}
        />
        <TargetCard
          purpose="applications"
          target={config.applications}
          providers={providers}
          bindings={bindings}
          onChange={(next) => setConfig((prev) => ({ ...prev, applications: { ...prev.applications, ...next } }))}
        />

        <DirectTokenPanel bindings={bindings} />

        <div className="rounded-xl border border-dashed border-border bg-secondary/30 p-4">
          <h3 className="text-sm font-bold">扩展新服务商（插件机制）</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            主流对象存储都兼容 AWS S3 API，「S3 兼容 API」一个适配器即可接入。确需自定义协议时，
            在 <code className="rounded bg-secondary px-1">worker/lib/storage/plugins/</code> 下实现
            <code className="mx-1 rounded bg-secondary px-1">StorageAdapter</code>接口并调用
            <code className="mx-1 rounded bg-secondary px-1">registerStorageAdapter('&lt;id&gt;', factory)</code>
            注册，业务代码零改动；配套元数据加入
            <code className="mx-1 rounded bg-secondary px-1">shared/storage.ts</code>
            的 provider 列表即可出现在上方下拉里。
          </p>
        </div>
      </div>
    </div>
  )
}
