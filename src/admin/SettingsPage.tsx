import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { DEFAULT_SMTP_CONFIG, isMailReady, mailStatusText, SMTP_PORT_PRESETS, type SmtpConfig } from '@shared/mail'
import { DEFAULT_RUNTIME_CONFIG, isSsoReady, ssoStatusText, type RuntimeConfig } from '@shared/runtime'
import { DEFAULT_SITE_CONFIG, type SiteConfig } from '@shared/types'
import { parseJoinSteps, parseStatLabels, renderCopyright, splitLines, splitParagraphs } from '@shared/site'
import { ImageField } from './ImageField'
import {
  adminChangePassword,
  adminGetConfig,
  adminSendTestMail,
  adminUpdateConfig,
  type AdminIdentity,
} from '@/api/endpoints'
import { ApiError, refreshRuntimeConfig } from '@/api/client'
import { toast } from 'sonner'
import { AlertTriangle, ArrowLeftRight, Eye, KeyRound, Mail, Save, Send } from 'lucide-react'
import { cn } from '@/lib/utils'

/** 密码来源决定后台该提示什么 */
const MAIL_PASSWORD_HINT: Record<'database' | 'env' | 'none', string> = {
  database: '密码已保存在数据库中（加密存储，任何接口都不会回显）',
  env: '当前用的是服务端环境变量 SMTP_PASSWORD；在上面填写即可改为保存在数据库',
  none: '尚未设置密码 —— 需要认证的服务器会发送失败',
}

/** 教务网登录的客户端密钥同理（来源不同，提示不同） */
const SSO_SECRET_HINT: Record<'database' | 'env' | 'none', string> = {
  database: '密钥已保存在数据库中（加密存储，任何接口都不会回显）',
  env: '当前用的是服务端环境变量 SSO_CLIENT_SECRET；在上面填写即可改为保存在数据库',
  none: '尚未设置客户端密钥 —— 回调换身份会失败',
}

/** 凭证验签密钥（QR_SIGN_SECRET）：它必须与授权服务器的 APPLY_TOKEN_SECRET 一致 */
const QR_SECRET_HINT: Record<'database' | 'env' | 'none', string> = {
  database: '密钥已保存在数据库中（加密存储，任何接口都不会回显）',
  env: '当前用的是服务端环境变量 QR_SIGN_SECRET；在上面填写即可改为保存在数据库',
  none: '尚未设置 —— 换票会成功但验签必然失败（回调报 invalid_credential）',
}

/** 带标签 + 提示的输入项 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  )
}

export function SettingsPage({ identity }: { identity: AdminIdentity }) {
  const [site, setSite] = useState<SiteConfig>(DEFAULT_SITE_CONFIG)
  const [runtime, setRuntime] = useState<RuntimeConfig>(DEFAULT_RUNTIME_CONFIG)
  const [loading, setLoading] = useState(true)
  const [savingSite, setSavingSite] = useState(false)
  const [savingRuntime, setSavingRuntime] = useState(false)

  const [mailPasswordSource, setMailPasswordSource] = useState<'database' | 'env' | 'none'>('none')
  const [mailPassword, setMailPassword] = useState('')
  const [clearMailPassword, setClearMailPassword] = useState(false)

  const [ssoClientSecretSource, setSsoClientSecretSource] = useState<'database' | 'env' | 'none'>('none')
  const [ssoClientSecret, setSsoClientSecret] = useState('')
  const [clearSsoSecret, setClearSsoSecret] = useState(false)

  const [qrSignSecretSource, setQrSignSecretSource] = useState<'database' | 'env' | 'none'>('none')
  const [qrSignSecret, setQrSignSecret] = useState('')
  const [clearQrSecret, setClearQrSecret] = useState(false)
  const [testTo, setTestTo] = useState('')
  const [sendingTest, setSendingTest] = useState(false)

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changing, setChanging] = useState(false)

  useEffect(() => {
    let active = true
    adminGetConfig()
      .then((response) => {
        if (!active) return
        setSite(response.site)
        setRuntime(response.runtime)
        setMailPasswordSource(response.mailPasswordSource)
        setSsoClientSecretSource(response.ssoClientSecretSource)
        setQrSignSecretSource(response.qrSignSecretSource)
      })
      .catch((error) => toast.error(error instanceof ApiError ? error.message : '加载配置失败'))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [])

  /** 局部更新站点配置 */
  const patch = (next: Partial<SiteConfig>) => setSite((prev) => ({ ...prev, ...next }))

  /** 邮件配置：后端一定会下发（merge 默认值），这里再兜一层，防止旧后端返回体缺字段时白屏 */
  const mail = runtime.mail ?? DEFAULT_SMTP_CONFIG
  const patchMail = (next: Partial<SmtpConfig>) => setRuntime({ ...runtime, mail: { ...mail, ...next } })

  const saveSite = async () => {
    setSavingSite(true)
    try {
      await adminUpdateConfig({ site })
      toast.success('已保存，官网 30 秒内生效')
      refreshRuntimeConfig()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSavingSite(false)
    }
  }

  /**
   * 教务网登录保存：两把密钥与邮件密码同一套「不改 / 改 / 清除」语义 ——
   * 后台永远拿不到原值，所以不带对应的键就是不修改。
   */
  const saveSso = async () => {
    const nextSso = { ...runtime.sso }
    delete nextSso.clientSecret
    delete nextSso.qrSignSecret
    if (clearSsoSecret) nextSso.clientSecret = ''
    else if (ssoClientSecret.trim()) nextSso.clientSecret = ssoClientSecret.trim()
    if (clearQrSecret) nextSso.qrSignSecret = ''
    else if (qrSignSecret.trim()) nextSso.qrSignSecret = qrSignSecret.trim()

    setSavingRuntime(true)
    try {
      const response = await adminUpdateConfig({ runtime: { sso: nextSso } })
      if (response.runtime) setRuntime(response.runtime)
      if (response.ssoClientSecretSource) setSsoClientSecretSource(response.ssoClientSecretSource)
      if (response.qrSignSecretSource) setQrSignSecretSource(response.qrSignSecretSource)

      const notes: string[] = []
      if (clearSsoSecret) notes.push('客户端密钥已清除')
      else if (ssoClientSecret.trim()) notes.push('客户端密钥已加密保存')
      if (clearQrSecret) notes.push('验签密钥已清除')
      else if (qrSignSecret.trim()) notes.push('验签密钥已加密保存')

      setSsoClientSecret('')
      setClearSsoSecret(false)
      setQrSignSecret('')
      setClearQrSecret(false)
      toast.success('教务网登录配置已保存', {
        description: notes.length ? notes.join('；') : '密钥未改动，最迟 1 分钟内对全部访客生效',
      })
      refreshRuntimeConfig()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSavingRuntime(false)
    }
  }

  /**
   * 邮件配置保存：密码要区分「不改 / 改 / 清除」三种意图 ——
   * 后台永远拿不到原值，所以不带 password 键就是不修改。
   */
  const saveMail = async () => {
    const nextMail: SmtpConfig = { ...mail }
    // 后台永远拿不到原值：不带 password 键 = 不修改；空串 = 清除；有值 = 更新
    delete nextMail.password
    if (clearMailPassword) nextMail.password = ''
    else if (mailPassword.trim()) nextMail.password = mailPassword.trim()

    setSavingRuntime(true)
    try {
      const response = await adminUpdateConfig({ runtime: { mail: nextMail } })
      if (response.runtime) setRuntime(response.runtime)
      if (response.mailPasswordSource) setMailPasswordSource(response.mailPasswordSource)
      const changedPassword = Boolean(mailPassword.trim())
      setMailPassword('')
      setClearMailPassword(false)
      toast.success('邮件配置已保存', {
        description: clearMailPassword
          ? '已清除数据库中的密码'
          : changedPassword
            ? '密码已加密保存到数据库'
            : '密码未改动',
      })
      refreshRuntimeConfig()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSavingRuntime(false)
    }
  }

  /** 测试邮件走的是「已保存」的配置 —— 改完表单要先保存再点这里 */
  const sendTestMail = async () => {
    setSendingTest(true)
    try {
      const result = await adminSendTestMail(testTo.trim() || undefined)
      toast.success('测试邮件已发出', { description: `收件人：${result.accepted.join('、')}` })
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '发送失败')
    } finally {
      setSendingTest(false)
    }
  }

  const changePassword = async () => {
    if (newPassword.length < 8) return toast.error('新密码至少 8 位')
    if (newPassword !== confirmPassword) return toast.error('两次输入的新密码不一致')
    setChanging(true)
    try {
      await adminChangePassword(currentPassword, newPassword)
      toast.success('密码已修改，请使用新密码重新登录')
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '修改失败')
    } finally {
      setChanging(false)
    }
  }

  // ===== 实时预览：把多行文本框解析成人能读懂的结果，避免填错格式 =====
  const preview = useMemo(
    () => ({
      paragraphs: splitParagraphs(site.aboutParagraphs).length,
      statLabels: parseStatLabels(site.statLabels, ['在组成员', '毕业成员', '工作室项目', '团队动态']),
      steps: parseJoinSteps(site.joinSteps),
      requirements: splitLines(site.joinRequirements),
      copyright: renderCopyright(site.footerCopyright),
    }),
    [site],
  )

  const SaveBar = ({ children }: { children?: ReactNode }) => (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
      <div className="text-[11px] text-muted-foreground">{children}</div>
      <Button onClick={() => void saveSite()} disabled={savingSite} className="gap-1.5">
        <Save className="h-4 w-4" /> {savingSite ? '保存中…' : '保存'}
      </Button>
    </div>
  )

  if (loading) {
    return <div className="py-20 text-center text-sm text-muted-foreground">加载中…</div>
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">系统设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            工作室的品牌、文案、联系方式与流量通道都在这里维护，保存后官网 30 秒内生效
          </p>
        </div>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={() => window.open('/', '_blank')}>
          <Eye className="h-3.5 w-3.5" /> 预览官网
        </Button>
      </div>

      <Tabs defaultValue="brand">
        <TabsList className="flex h-auto flex-wrap justify-start gap-1">
          <TabsTrigger value="brand">品牌与联系方式</TabsTrigger>
          <TabsTrigger value="about">首页简介</TabsTrigger>
          <TabsTrigger value="recruit">招新与加入我们</TabsTrigger>
          <TabsTrigger value="footer">页脚</TabsTrigger>
          <TabsTrigger value="channel">流量通道</TabsTrigger>
          <TabsTrigger value="mail">邮件通知</TabsTrigger>
          <TabsTrigger value="security">管理员密码</TabsTrigger>
        </TabsList>

        {/* ===== 品牌与联系方式 ===== */}
        <TabsContent value="brand" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="工作室 Logo" hint="建议正方形透明底 PNG，≤2MB；留空则使用内置标识">
              <ImageField
                value={site.logoUrl}
                onChange={(next) => patch({ logoUrl: next })}
                scope="brand"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="工作室名称" hint="用于导航栏、页脚与浏览器标题">
                <Input value={site.studioName} onChange={(e) => patch({ studioName: e.target.value })} />
              </Field>
              <Field label="英文名 / 副标题" hint="显示在页脚右下角">
                <Input value={site.studioNameEn} onChange={(e) => patch({ studioNameEn: e.target.value })} />
              </Field>
            </div>

            <Field label="一句话定位" hint="显示在页脚，建议不超过 40 字">
              <Textarea value={site.slogan} rows={2} onChange={(e) => patch({ slogan: e.target.value })} />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="联系邮箱">
                <Input
                  value={site.contactEmail}
                  onChange={(e) => patch({ contactEmail: e.target.value })}
                  placeholder="studio@example.edu.cn"
                />
              </Field>
              <Field label="联系电话" hint="留空则页脚不显示这一行">
                <Input
                  value={site.contactPhone}
                  onChange={(e) => patch({ contactPhone: e.target.value })}
                  placeholder="选填"
                />
              </Field>
              <Field label="联系地址">
                <Input
                  value={site.contactAddress}
                  onChange={(e) => patch({ contactAddress: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <SaveBar>修改名称或 Logo 后，官网导航栏、页脚与浏览器标签会一起更新</SaveBar>
        </TabsContent>

        {/* ===== 首页简介 ===== */}
        <TabsContent value="about" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="简介标题">
              <Input value={site.aboutTitle} onChange={(e) => patch({ aboutTitle: e.target.value })} />
            </Field>

            <Field
              label="简介正文"
              hint={`空行分段，当前 ${preview.paragraphs} 段`}
            >
              <Textarea
                value={site.aboutParagraphs}
                rows={10}
                onChange={(e) => patch({ aboutParagraphs: e.target.value })}
                placeholder="第一段…&#10;&#10;第二段…"
              />
            </Field>

            <Field
              label="统计数字的标签"
              hint="逗号分隔，共 4 个，依次对应下方四个数字"
            >
              <Input value={site.statLabels} onChange={(e) => patch({ statLabels: e.target.value })} />
            </Field>

            <div className="flex flex-wrap gap-2">
              {preview.statLabels.map((label, index) => (
                <span key={index} className="rounded-full bg-secondary px-3 py-1 text-xs text-foreground/70">
                  {label}
                </span>
              ))}
            </div>
          </div>
          <SaveBar>统计数字本身由成员 / 项目 / 新闻数量自动计算，这里只改标签文字</SaveBar>
        </TabsContent>

        {/* ===== 招新与加入我们 ===== */}
        <TabsContent value="recruit" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            {/* 招新总开关已移除：报名入口与首页横幅由招新周期自动派生（见后台「招新 → 准备」） */}
            <Field label="首页招新横幅标题">
              <Input value={site.recruitTitle} onChange={(e) => patch({ recruitTitle: e.target.value })} />
            </Field>

            <Field label="首页招新横幅描述">
              <Textarea value={site.recruitDesc} rows={3} onChange={(e) => patch({ recruitDesc: e.target.value })} />
            </Field>

            <div className="border-t border-border pt-5">
              <Field label="「加入我们」页面标题">
                <Input value={site.joinTitle} onChange={(e) => patch({ joinTitle: e.target.value })} />
              </Field>
            </div>

            <Field label="「加入我们」页面描述">
              <Textarea value={site.joinIntro} rows={3} onChange={(e) => patch({ joinIntro: e.target.value })} />
            </Field>

            <Field
              label="招新流程"
              hint={`每行一条，格式「标题 | 描述」，当前 ${preview.steps.length} 条`}
            >
              <Textarea
                value={site.joinSteps}
                rows={6}
                onChange={(e) => patch({ joinSteps: e.target.value })}
                placeholder="扫码完成身份认证 | 使用微信扫描二维码…"
              />
            </Field>

            <div className="grid gap-1.5">
              <Label>流程预览</Label>
              <div className="rounded-xl border border-border bg-secondary/30 p-4">
                {preview.steps.map((step) => (
                  <div key={step.no} className="grid grid-cols-[2.5rem_1fr] gap-3 border-b border-border py-2.5 last:border-b-0">
                    <span className="font-display text-accent">{step.no}</span>
                    <div>
                      <div className="text-sm font-medium">{step.title || '（缺少标题）'}</div>
                      <div className="text-xs text-muted-foreground">{step.desc || '（无描述）'}</div>
                    </div>
                  </div>
                ))}
                {preview.steps.length === 0 && (
                  <p className="text-xs text-muted-foreground">还没有填写流程</p>
                )}
              </div>
            </div>

            <Field
              label="对报名者的期望"
              hint={`每行一条，当前 ${preview.requirements.length} 条；留空则不显示该区块`}
            >
              <Textarea
                value={site.joinRequirements}
                rows={5}
                onChange={(e) => patch({ joinRequirements: e.target.value })}
              />
            </Field>
          </div>
          <SaveBar>这里的内容同时驱动首页招新横幅与「加入我们」页面</SaveBar>
        </TabsContent>

        {/* ===== 页脚 ===== */}
        <TabsContent value="footer" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <div className="grid gap-5">
            <Field label="底部跑马灯文案" hint="会横向滚动重复播放，建议用「·」分隔的短语">
              <Textarea value={site.marqueeText} rows={2} onChange={(e) => patch({ marqueeText: e.target.value })} />
            </Field>
            <Field label="版权行" hint="可用 {year} 表示当前年份">
              <Input
                value={site.footerCopyright}
                onChange={(e) => patch({ footerCopyright: e.target.value })}
              />
            </Field>
            <div className="rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm">
              预览：{preview.copyright}
            </div>
          </div>
          <SaveBar>页脚右上角的英文名与「一句话定位」在「品牌与联系方式」里修改</SaveBar>
        </TabsContent>

        {/* ===== 流量通道 ===== */}
        <TabsContent value="channel" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            教务网登录的开关、授权服务器地址、回调地址与客户端密钥都在这里维护，保存后官网立即生效，
            不必改环境变量、也不必重新部署；
            文件存储（站点图片 / 报名表桶）已移至「对象存储」页面
          </p>

          <div className="mt-5 grid gap-4">
            <div className="rounded-xl border border-border p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">教务网登录</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    关闭后官网不展示登录入口；已登录的同学保持登录态，不受影响
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-xs',
                      runtime.sso.enabled ? 'font-medium text-emerald-600' : 'text-muted-foreground',
                    )}
                  >
                    {runtime.sso.enabled ? '已开启' : '已关闭'}
                  </span>
                  <Switch
                    checked={runtime.sso.enabled}
                    onCheckedChange={(checked) =>
                      setRuntime({ ...runtime, sso: { ...runtime.sso, enabled: checked } })
                    }
                  />
                </div>
              </div>

              <div className="mt-4 grid gap-1.5">
                <Label className="text-xs">授权服务器地址</Label>
                <Input
                  value={runtime.sso.authorizeBase}
                  onChange={(e) =>
                    setRuntime({ ...runtime, sso: { ...runtime.sso, authorizeBase: e.target.value } })
                  }
                  placeholder="https://sso.example.cn"
                />
                <p
                  className={cn(
                    'text-[11px]',
                    isSsoReady(runtime.sso) ? 'text-emerald-600' : 'text-amber-600',
                  )}
                >
                  {ssoStatusText(runtime.sso)}
                </p>
              </div>

              <div className="mt-4 grid gap-1.5">
                <Label className="text-xs">回调地址</Label>
                <Input
                  value={runtime.sso.redirectUri}
                  onChange={(e) =>
                    setRuntime({ ...runtime, sso: { ...runtime.sso, redirectUri: e.target.value } })
                  }
                  placeholder="https://sso.example.cn/api/auth/callback"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  留空则按当前访问域名推导（本地调试够用）；线上建议固定下来，
                  且必须与授权服务器白名单里的登记值逐字一致（含协议、域名、路径）。
                </p>
              </div>

              <div className="mt-4 grid gap-1.5">
                <Label className="text-xs">客户端密钥</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={ssoClientSecret}
                  onChange={(e) => {
                    setSsoClientSecret(e.target.value)
                    setClearSsoSecret(false)
                  }}
                  disabled={clearSsoSecret}
                  placeholder={
                    ssoClientSecretSource === 'none' ? '尚未设置' : '已保存 —— 留空表示不修改'
                  }
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span
                    className={cn(
                      clearSsoSecret || ssoClientSecretSource === 'none'
                        ? 'text-amber-600'
                        : 'text-muted-foreground',
                    )}
                  >
                    {clearSsoSecret
                      ? '保存后将清除数据库中的密钥'
                      : SSO_SECRET_HINT[ssoClientSecretSource]}
                  </span>
                  {clearSsoSecret ? (
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => setClearSsoSecret(false)}
                    >
                      取消清除
                    </button>
                  ) : (
                    ssoClientSecretSource === 'database' && (
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => {
                          setSsoClientSecret('')
                          setClearSsoSecret(true)
                        }}
                      >
                        清除已保存的密钥
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="mt-4 grid gap-1.5">
                <Label className="text-xs">凭证验签密钥</Label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={qrSignSecret}
                  onChange={(e) => {
                    setQrSignSecret(e.target.value)
                    setClearQrSecret(false)
                  }}
                  disabled={clearQrSecret}
                  placeholder={qrSignSecretSource === 'none' ? '尚未设置' : '已保存 —— 留空表示不修改'}
                />
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <span
                    className={cn(
                      clearQrSecret || qrSignSecretSource === 'none'
                        ? 'text-amber-600'
                        : 'text-muted-foreground',
                    )}
                  >
                    {clearQrSecret ? '保存后将清除数据库中的密钥' : QR_SECRET_HINT[qrSignSecretSource]}
                  </span>
                  {clearQrSecret ? (
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => setClearQrSecret(false)}
                    >
                      取消清除
                    </button>
                  ) : (
                    qrSignSecretSource === 'database' && (
                      <button
                        type="button"
                        className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                        onClick={() => {
                          setQrSignSecret('')
                          setClearQrSecret(true)
                        }}
                      >
                        清除已保存的密钥
                      </button>
                    )
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  必须与授权服务器的 <code className="rounded bg-secondary px-1">APPLY_TOKEN_SECRET</code>{' '}
                  逐字一致 —— 不一致时换票成功、验签失败（回调报 invalid_credential）。
                </p>
              </div>

              <p className="mt-4 border-t border-border pt-3 text-[11px] leading-relaxed text-muted-foreground">
                授权服务器部署在国内 EdgeOne（另一个仓库维护）。上面四项都在这里维护、保存后立即生效：
                地址与回调地址必须与其登记值逐字一致；两把密钥加密保存在数据库里，任何接口都不会回显
                （填一次即可，留空表示不修改）。服务端环境变量{' '}
                <code className="rounded bg-secondary px-1">SSO_CLIENT_SECRET</code> /{' '}
                <code className="rounded bg-secondary px-1">QR_SIGN_SECRET</code> /{' '}
                <code className="rounded bg-secondary px-1">SSO_REDIRECT_URI</code>{' '}
                只是老部署的兜底，后台填过以后一律以后台为准。
              </p>
            </div>

            <p className="text-[11px] text-muted-foreground">
              当前生效版本 v{runtime.version}
              {runtime.updatedAt ? ` · 最近切换 ${new Date(runtime.updatedAt).toLocaleString('zh-CN')}` : ''}
            </p>
          </div>

          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <Button onClick={() => void saveSso()} disabled={savingRuntime} className="gap-1.5">
              <ArrowLeftRight className="h-4 w-4" /> {savingRuntime ? '保存中…' : '保存并生效'}
            </Button>
          </div>
        </TabsContent>

        {/* ===== 邮件通知（SMTP） ===== */}
        <TabsContent value="mail" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <Mail className="h-4 w-4 text-accent" /> 邮件通知
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            报名通知等邮件通过 SMTP 发出。密码保存在数据库里（加密存储，任何接口都不会回显），
            也可以用服务端环境变量 <code className="rounded bg-secondary px-1">SMTP_PASSWORD</code> 兜底。
          </p>

          <div className="mt-5 grid gap-4">
            <div className="flex items-center justify-between rounded-xl border border-border px-4 py-3">
              <div>
                <div className="text-sm font-medium">启用邮件通知</div>
                <p className="mt-0.5 text-xs text-muted-foreground">关闭后全站不发送任何邮件</p>
              </div>
              <Switch checked={mail.enabled} onCheckedChange={(checked) => patchMail({ enabled: checked })} />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="SMTP 服务器" hint="如 smtp.exmail.qq.com">
                <Input
                  value={mail.host}
                  onChange={(e) => patchMail({ host: e.target.value })}
                  placeholder="smtp.example.com"
                />
              </Field>
              <Field label="登录用户名" hint="多数服务商等于发件邮箱；留空表示不认证">
                <Input
                  value={mail.username}
                  onChange={(e) => patchMail({ username: e.target.value })}
                  placeholder="选填"
                />
              </Field>
            </div>

            <div className="grid gap-1.5">
              <Label>SMTP 密码 / 授权码</Label>
              <Input
                type="password"
                autoComplete="new-password"
                value={mailPassword}
                onChange={(e) => {
                  setMailPassword(e.target.value)
                  setClearMailPassword(false)
                }}
                disabled={clearMailPassword}
                placeholder={mailPasswordSource === 'none' ? '尚未设置' : '已保存 —— 留空表示不修改'}
              />
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                <span
                  className={cn(
                    clearMailPassword || mailPasswordSource === 'none'
                      ? 'text-amber-600'
                      : 'text-muted-foreground',
                  )}
                >
                  {clearMailPassword ? '保存后将清除数据库中的密码' : MAIL_PASSWORD_HINT[mailPasswordSource]}
                </span>
                {clearMailPassword ? (
                  <button
                    type="button"
                    className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    onClick={() => setClearMailPassword(false)}
                  >
                    取消清除
                  </button>
                ) : (
                  mailPasswordSource === 'database' && (
                    <button
                      type="button"
                      className="text-muted-foreground underline underline-offset-2 hover:text-foreground"
                      onClick={() => {
                        setMailPassword('')
                        setClearMailPassword(true)
                      }}
                    >
                      清除已保存的密码
                    </button>
                  )
                )}
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label>连接方式</Label>
              <div className="flex flex-wrap gap-2">
                {SMTP_PORT_PRESETS.map((preset) => (
                  <button
                    key={preset.port}
                    onClick={() => patchMail({ port: preset.port, security: preset.security })}
                    className={cn(
                      'rounded-full px-3 py-1.5 text-xs transition-colors',
                      mail.port === preset.port
                        ? 'bg-primary text-primary-foreground'
                        : 'border border-border text-foreground/70 hover:bg-secondary',
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="h-3 w-3" />
                Cloudflare 封锁了 25 端口，只能用 465（SSL/TLS）或 587（STARTTLS）
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="发件邮箱" hint="必须在服务商允许的发信白名单内">
                <Input
                  value={mail.fromAddress}
                  onChange={(e) => patchMail({ fromAddress: e.target.value })}
                  placeholder="studio@example.edu.cn"
                />
              </Field>
              <Field label="发件人显示名">
                <Input
                  value={mail.fromName}
                  onChange={(e) => patchMail({ fromName: e.target.value })}
                  placeholder={site.studioName}
                />
              </Field>
              <Field label="回信地址" hint="留空则用发件邮箱">
                <Input
                  value={mail.replyTo}
                  onChange={(e) => patchMail({ replyTo: e.target.value })}
                  placeholder="选填"
                />
              </Field>
            </div>

            <div className="rounded-xl border border-border p-4">
              <div className="text-sm font-medium">发送测试邮件</div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                配置对不对只有真发一封才知道。收件人留空则发到「品牌与联系方式」里的联系邮箱，
                <strong className="font-medium">测试使用的是已保存的配置，改完表单请先保存</strong>。
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  value={testTo}
                  onChange={(e) => setTestTo(e.target.value)}
                  placeholder={site.contactEmail || 'you@example.com'}
                  className="sm:max-w-xs"
                />
                <Button variant="outline" className="gap-1.5" onClick={() => void sendTestMail()} disabled={sendingTest}>
                  <Send className="h-4 w-4" /> {sendingTest ? '发送中…' : '发送测试邮件'}
                </Button>
              </div>
              <p className={cn('mt-3 text-[11px]', isMailReady(mail) ? 'text-emerald-600' : 'text-amber-600')}>
                {mailStatusText(mail)}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-[11px] text-muted-foreground">
              保存后立即生效（与「流量通道」共用同一份运行时配置）
            </p>
            <Button onClick={() => void saveMail()} disabled={savingRuntime} className="gap-1.5">
              <Save className="h-4 w-4" /> {savingRuntime ? '保存中…' : '保存'}
            </Button>
          </div>
        </TabsContent>

        {/* ===== 管理员密码 ===== */}
        <TabsContent value="security" className="mt-5 rounded-2xl border border-border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 font-display text-lg font-bold">
            <KeyRound className="h-4 w-4 text-accent" /> 管理员密码
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            当前账号：{identity.name}（@{identity.username}）· 修改后所有已登录设备都会退出
          </p>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <Field label="当前密码">
              <Input
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </Field>
            <Field label="新密码（≥8 位）">
              <Input
                type="password"
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </Field>
            <Field label="确认新密码">
              <Input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </Field>
          </div>

          <div className="mt-6 flex justify-end border-t border-border pt-4">
            <Button onClick={() => void changePassword()} disabled={changing}>
              {changing ? '修改中…' : '修改密码'}
            </Button>
          </div>

          <div className="mt-6 rounded-xl border border-dashed border-border bg-secondary/30 p-4">
            <h3 className="text-sm font-bold">换届交接说明</h3>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              账号数据存放在 Cloudflare D1，不绑定任何个人云账号。交接时把项目交接文档与 Cloudflare 账号一并移交，
              下一届成员即可在此页面自行改密码、继续维护内容。若密码丢失，可用交接文档中保管的恢复口令重置。
            </p>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
