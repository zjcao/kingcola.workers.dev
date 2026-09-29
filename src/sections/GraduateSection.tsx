import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchDestinationForm, submitDestinationForm, type DestinationForm } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { DESTINATION_MAX, PAGE_PATHS, type SiteConfig } from '@/types'
import { CheckCircle2, Loader2, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'

type Phase = 'loading' | 'ready' | 'done' | 'error'

/**
 * 毕业去向填写页（`/graduate/:token`）。
 *
 * 「批量毕业」时发出的那封信里的专属链接指向这里：点开 → 填一句话 → 直接写进成员档案
 * 的「毕业去向」，本人立刻出现在官网「团队成员 → 已毕业」里。
 *
 * 与邀请函确认页同一路数：**链接本身就是凭证**（每条只能用一次、重发换新的），
 * 所以这一页不要求登录 —— 同学毕业时教务网会话早就过期了。
 */
export function GraduateSection({ site }: { site: SiteConfig }) {
  const { token = '' } = useParams<{ token: string }>()

  const [phase, setPhase] = useState<Phase>('loading')
  const [info, setInfo] = useState<DestinationForm | null>(null)
  const [errorText, setErrorText] = useState('')
  const [destination, setDestination] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    setPhase('loading')
    setErrorText('')
    try {
      const result = await fetchDestinationForm(token)
      setInfo(result)
      setDestination(result.current)
      setPhase('ready')
    } catch (error) {
      setErrorText(error instanceof ApiError ? error.message : '页面加载失败，请稍后重试')
      setPhase('error')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    const value = destination.trim()
    if (!value) return toast.error('请填写你的毕业去向')

    setSubmitting(true)
    try {
      await submitDestinationForm(token, value)
      setPhase('done')
      toast.success('已提交，谢谢！')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '提交失败，请稍后重试')
    } finally {
      setSubmitting(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-2xl animate-fade-up px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">{children}</div>
    </div>
  )

  if (phase === 'loading') {
    return shell(
      <div className="flex flex-col items-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-sm text-muted-foreground">正在读取链接…</p>
      </div>,
    )
  }

  if (phase === 'error') {
    return shell(
      <div className="py-6 text-center">
        <h1 className="font-display text-2xl font-bold">链接不可用</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{errorText}</p>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          如果还需要修改去向，直接回复那封邮件告诉我们即可。
        </p>
        <Link
          to={PAGE_PATHS.home}
          className="mt-6 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          回到首页
        </Link>
      </div>,
    )
  }

  if (phase === 'done') {
    return shell(
      <div className="py-6 text-center">
        <PartyPopper className="mx-auto h-10 w-10 text-accent" />
        <h1 className="mt-4 font-display text-2xl font-bold">已记录，谢谢 {info?.name}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          你的毕业去向已写进 {site.studioName} 的团队档案：
        </p>
        <p className="mt-2 rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm font-medium">
          {destination.trim()}
        </p>
        <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
          这条链接已经失效了。要改的话，回复那封邮件告诉我们。
        </p>
        <Link
          to={PAGE_PATHS.members}
          className="mt-6 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          看看团队成员页
        </Link>
      </div>,
    )
  }

  return shell(
    <>
      <p className="text-xs tracking-[0.2em] text-muted-foreground">{site.studioNameEn}</p>
      <h1 className="mt-3 font-display text-3xl font-bold">登记你的毕业去向</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {info?.name} 同学，好久不见。工作室想把你的毕业去向记进「已毕业成员」档案 ——
        对学弟学妹是很好的参考，也方便大家以后保持联系。
      </p>

      <div className="mt-8 grid gap-4">
        <div className="grid gap-1.5">
          <Label>毕业去向 *</Label>
          <Input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            maxLength={DESTINATION_MAX}
            placeholder="如：某互联网大厂 前端工程师 / 本校读研深造"
          />
          <p className="text-[11px] text-muted-foreground">
            一句话即可，最多 {DESTINATION_MAX} 字；会显示在官网「团队成员 → 已毕业」里。
            不想公开的话，回复那封邮件说明一下就行。
          </p>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit()} disabled={submitting} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
          {submitting ? '正在提交…' : '提交'}
        </Button>
        <span className="text-xs text-muted-foreground">提交后这条链接立即失效，只能填一次</span>
      </div>
    </>,
  )
}
