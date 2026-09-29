import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { fetchCheckinInfo, submitCheckin, type CheckinInfo } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { validateCheckin } from '@shared/recruit'
import { PAGE_PATHS, type SiteConfig } from '@/types'
import { CheckCircle2, Loader2, ScanLine } from 'lucide-react'
import { toast } from 'sonner'

type Phase = 'loading' | 'form' | 'done' | 'invalid'

/**
 * 扫码签到页（`/checkin/:token`）。
 *
 * 这条路径**不进导航**，只由后台按阶段（笔试 / 面试 / 答辩）签发的二维码指向它：
 * 凭证就是 URL 里的 token（只绑阶段 + 带失效时间 + 可随时作废），所以不需要登录态。
 * token 无效 / 过期 / 被作废时后端不返回任何信息，
 * 页面只显示一句「二维码无效」，不泄露场上信息。
 */
export function CheckinSection({ site }: { site: SiteConfig }) {
  const { token = '' } = useParams<{ token: string }>()

  const [phase, setPhase] = useState<Phase>('loading')
  const [info, setInfo] = useState<CheckinInfo | null>(null)
  const [name, setName] = useState('')
  const [studentId, setStudentId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ already: boolean; name: string } | null>(null)

  const load = useCallback(async () => {
    if (!token) {
      setPhase('invalid')
      return
    }
    try {
      setInfo(await fetchCheckinInfo(token))
      setPhase('form')
    } catch {
      setPhase('invalid')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    const invalid = validateCheckin({ name, studentId })
    if (invalid) return toast.error(invalid)

    setSubmitting(true)
    try {
      const response = await submitCheckin(token, { name: name.trim(), studentId: studentId.trim() })
      setResult({ already: response.already, name: response.name })
      setPhase('done')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '签到失败，请稍后重试或联系工作人员')
    } finally {
      setSubmitting(false)
    }
  }

  const shell = (children: React.ReactNode) => (
    <div className="mx-auto max-w-lg animate-fade-up px-4 py-16 sm:px-6">
      <div className="rounded-2xl border border-border bg-card p-6 sm:p-10">{children}</div>
    </div>
  )

  if (phase === 'invalid') {
    return shell(
      <div className="py-6 text-center">
        <h1 className="font-display text-2xl font-bold">二维码无效</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          这个签到二维码已失效、已被作废，或者链接没有复制完整。请向现场工作人员确认后再扫一次。
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

  if (phase === 'loading') {
    return shell(
      <div className="flex flex-col items-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-sm text-muted-foreground">正在准备签到…</p>
      </div>,
    )
  }

  if (phase === 'done') {
    return shell(
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h1 className="mt-4 font-display text-2xl font-bold">
          {result?.already ? '你已签到过' : '签到成功'}
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {result?.name} 同学，已记录你的{info?.stageLabel}签到
          {result?.already ? '，此前已经签过，无需重复' : '，祝顺利'}。
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          结果出来后我们会通过邮箱通知你，也可以在「加入我们」页面查看自己的进度。
        </p>
        <Link
          to={PAGE_PATHS.join}
          className="mt-6 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          查看我的报名进度
        </Link>
      </div>,
    )
  }

  return shell(
    <>
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <ScanLine className="h-4 w-4 text-accent" />
        {site.studioName} · {info?.cycleName || '招新'}
      </div>
      <h1 className="mt-3 font-display text-3xl font-bold">{info?.stageLabel}签到</h1>

      <p className="mt-3 rounded-lg bg-secondary px-3 py-2 text-sm text-foreground/80">
        这里只登记「{info?.stageLabel}已到场」；具体时间与地点以群里通知为准。
      </p>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        填写报名时用的姓名与学号即可完成签到，一个字都不能差。
      </p>

      <div className="mt-8 grid gap-4">
        <div className="grid gap-1.5">
          <Label>姓名 *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="报名时填写的姓名" />
        </div>
        <div className="grid gap-1.5">
          <Label>学号 *</Label>
          <Input
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
            placeholder="教务网登录时使用的学号"
          />
        </div>
      </div>

      <Button onClick={() => void submit()} className="mt-6 w-full gap-2" disabled={submitting}>
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {submitting ? '正在签到…' : '确认签到'}
      </Button>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        没找到你的报名记录？请核对姓名与学号是否与报名时一致，或直接找现场工作人员补签。
      </p>
    </>
  )
}
