import { useCallback, useEffect, useState } from 'react'
import { ApplicationProgress } from '@/components/ApplicationProgress'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  STUDENT_LOGIN_URL,
  fetchRecruitStatus,
  myApplication,
  studentLogout,
  studentMe,
  submitApplication,
  type RecruitStatus,
} from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { useSsoTarget } from '@/api/hooks'
import {
  APPLICATION_DOC_ACCEPT,
  APPLICATION_DOC_HINT,
  APPLICATION_DOC_LIMIT,
  validateApplicationForm,
} from '@shared/recruit'
import { isSsoReady } from '@shared/runtime'
import { parseJoinSteps, splitLines } from '@shared/site'
import type { Application, SiteConfig } from '@/types'
import { CalendarClock, CheckCircle2, QrCode, ShieldCheck, Upload, X } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

interface Identity {
  studentId: string
  name: string
}

type AuthState = 'checking' | 'anonymous' | 'authenticated'

/** 回调原因 → 给用户看的话。登录失败一律回首页并带一个原因码，这里翻译成人话。 */
const LOGIN_NOTICE: Record<string, string> = {
  denied: '你取消了授权，未登录',
  state_mismatch: '登录校验未通过，请重试',
  not_configured: '教务网登录尚未接通',
  upstream_unreachable: '暂时联系不上登录服务，请稍后重试',
  exchange_failed: '登录服务未能确认你的身份，请重试',
  invalid_credential: '身份凭证校验未通过，请重新登录',
}

/** 读取并清掉地址栏里的回调提示，避免刷新时重复弹出 */
function consumeLoginNotice(): { ok: boolean; text: string } | null {
  const params = new URLSearchParams(window.location.search)
  const flag = params.get('login')
  if (!flag) return null

  params.delete('login')
  const query = params.toString()
  window.history.replaceState(
    null,
    '',
    `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`,
  )

  if (flag === 'ok') return { ok: true, text: '登录成功' }
  return { ok: false, text: LOGIN_NOTICE[flag] ?? '登录未完成，请重试' }
}

function formatSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function JoinSection({ site }: { site: SiteConfig }) {
  const steps = parseJoinSteps(site.joinSteps)
  const requirements = splitLines(site.joinRequirements)
  const sso = useSsoTarget()
  const ssoReady = isSsoReady(sso)

  /** 本届招新状态（后台点「开启报名 / 结束报名」决定，没有任何时间窗） */
  const [cycle, setCycle] = useState<RecruitStatus | null>(null)

  const [auth, setAuth] = useState<AuthState>('checking')
  const [identity, setIdentity] = useState<Identity | null>(null)
  const [application, setApplication] = useState<Application | null>(null)
  /** 他此刻该进的群（报名阶段为空） */
  const [group, setGroup] = useState({ label: '', number: '' })
  const [inviteUrl, setInviteUrl] = useState('')
  const [appLoading, setAppLoading] = useState(false)

  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [qq, setQq] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const loadApplication = useCallback(async () => {
    setAppLoading(true)
    try {
      const result = await myApplication()
      setApplication(result.application)
      setGroup({ label: result.groupLabel, number: result.group })
      setInviteUrl(result.inviteUrl ?? '')
    } catch {
      // 查询失败不阻断页面：表单照常可用，提交时后端还会再查一次
      setApplication(null)
    } finally {
      setAppLoading(false)
    }
  }, [])

  const refreshIdentity = useCallback(async () => {
    try {
      const me = await studentMe()
      if (me.authenticated && me.studentId) {
        setIdentity({ studentId: me.studentId, name: me.name ?? '' })
        setAuth('authenticated')
        await loadApplication()
      } else {
        setIdentity(null)
        setApplication(null)
        setGroup({ label: '', number: '' })
        setInviteUrl('')
        setAuth('anonymous')
      }
    } catch {
      setIdentity(null)
      setAuth('anonymous')
    }
  }, [loadApplication])

  useEffect(() => {
    const notice = consumeLoginNotice()
    if (notice) {
      if (notice.ok) toast.success(notice.text)
      else toast.error(notice.text)
    }
    void fetchRecruitStatus()
      .then(setCycle)
      .catch(() => setCycle(null))
    void refreshIdentity()
  }, [refreshIdentity])

  // 已经报过名的同学：把联系方式预填上 —— 被驳回要重传时尤其省事，不用照着邮件重敲一遍
  useEffect(() => {
    if (!application) return
    setEmail((prev) => prev || application.email)
    setPhone((prev) => prev || application.phone)
    setQq((prev) => prev || application.qq)
  }, [application])

  const signIn = () => {
    // 整页跳转：授权流程跨域，必须交给浏览器，不能用 fetch
    window.location.href = STUDENT_LOGIN_URL
  }

  const signOut = async () => {
    try {
      await studentLogout()
    } catch {
      // 接口失败也继续刷新状态，避免界面与实际登录态不一致
    }
    await refreshIdentity()
    toast.success('已退出登录')
  }

  // ===== 报名表文件：校验真实文件头，仅改后缀无效 =====
  const checkFile = async (f: File): Promise<boolean> => {
    const head = new Uint8Array(await f.slice(0, 8).arrayBuffer())
    const isPdf = head[0] === 0x25 && head[1] === 0x50 // %P
    const isDocx = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 // ZIP 头
    if (isPdf || isDocx) return true
    setFileError('文件校验失败：仅支持 PDF 或 DOCX 格式的真实文件，仅修改后缀无效')
    return false
  }

  const onPickFile = async (f: File | null) => {
    setFileError('')
    if (!f) return
    if (!/\.(pdf|docx)$/i.test(f.name)) {
      setFileError('仅支持 .pdf 或 .docx 文件')
      return
    }
    if (f.size > APPLICATION_DOC_LIMIT) {
      setFileError(`文件不能超过 ${formatSize(APPLICATION_DOC_LIMIT)}`)
      return
    }
    if (!(await checkFile(f))) return
    setFile(f)
  }

  /**
   * 同一学号重复提交 = **替换材料**（换报名表、删旧文件）。
   * 覆盖不可逆，所以第一次会被服务端拦下来要求确认 ——
   * 这里把确认状态翻成「已确认」，按钮随之变成「确认替换」，再点一次才真的交。
   */
  const [replaceConfirmed, setReplaceConfirmed] = useState(false)

  const submit = async (forceReplace = false) => {
    if (!file) return toast.error('请先选择报名表文件')
    const invalid = validateApplicationForm({ email, phone, qq })
    if (invalid) return toast.error(invalid)

    const form = new FormData()
    form.append('file', file)
    form.append('email', email.trim())
    form.append('phone', phone.trim())
    form.append('qq', qq.trim())

    setSubmitting(true)
    try {
      // forceReplace：「材料被驳回后重新提交」这条路径，点下去就是替换 ——
      // 意图已经够明确，不必再让他确认一次「会覆盖原来那份」（旧文件仍由后端删除）
      const created = await submitApplication(form, replaceConfirmed || forceReplace)
      setApplication(created)
      setInviteUrl('')
      setFile(null)
      setReplaceConfirmed(false)
      toast.success(replaceConfirmed ? '报名表已替换' : '报名表已提交，我们会尽快安排笔试', {
        description: replaceConfirmed
          ? '原来的材料已被新的一份取代'
          : '笔试通知会发到你的邮箱，具体安排见邮件里的 QQ 群',
      })
      // 顺带把最新的进度与群号取回来
      await loadApplication()
    } catch (error) {
      if (error instanceof ApiError && error.code === 'REPLACE_CONFIRM') {
        // 第一次撞上「已报过名」：不直接拒绝，而是让同学明确选择是否替换
        setReplaceConfirmed(true)
        toast.info(error.message)
      } else {
        toast.error(error instanceof ApiError ? error.message : '提交失败，请稍后重试')
      }
    } finally {
      setSubmitting(false)
    }
  }

  // ===== 报名通道是否开放：完全由后台的「开启报名 / 结束报名」决定 =====
  const applyOpen = cycle?.applyOpen ?? false
  const gate = cycle?.gate ?? 'not_open'

  /**
   * 「此刻该改材料」：材料被驳回、报名通道还开着，且他自己没选择先看进度。
   *
   * 这时直接把提交表单摆出来 —— 这才是他该做的事，而不是把入口藏在进度页里让人找。
   * 想看进度点一下就能切回去（`showProgress`），两边都不耽误。
   */
  const [showProgress, setShowProgress] = useState(false)
  const reupload = Boolean(application && applyOpen && application.materialStatus === 'rejected' && !showProgress)

  /** 右侧面板的「不能报名」形态：还没开 / 已截止 */
  const closedNotice = (() => {
    if (gate === 'closed') {
      return {
        title: '报名已截止',
        desc: '本次报名通道已关闭；已报名的同学登录后可继续查看自己的进度。',
      }
    }
    return cycle?.state === 'prepare'
      ? { title: '报名尚未开始', desc: '本届招新即将开始，请留意后续通知。' }
      : { title: '招新尚未开始', desc: '请稍后再来，或先通过页脚邮箱与我们取得联系。' }
  })()

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-14 sm:px-6">
      <div className="mb-12">
        <h1 className="font-display text-4xl font-bold sm:text-5xl">{site.joinTitle}</h1>
        <p className="mt-3 max-w-2xl whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
          {site.joinIntro}
        </p>
        {cycle?.notice && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-secondary/70 px-4 py-1.5 text-xs text-foreground/75">
            <CalendarClock className="h-3.5 w-3.5 text-accent" />
            {cycle.notice}
          </p>
        )}
      </div>

      <div className="grid gap-14 lg:grid-cols-[1fr_1.1fr]">
        {/* ===== 左：流程说明 ===== */}
        <div>
          <h2 className="mb-6 font-display text-2xl font-bold">招新流程</h2>
          <div>
            {steps.map((s) => (
              <div key={s.no} className="grid grid-cols-[3rem_1fr] gap-4 border-t border-border py-6 last:border-b">
                <span className="font-display text-xl text-accent">{s.no}</span>
                <div>
                  <h3 className="font-display text-lg font-semibold">{s.title}</h3>
                  {s.desc && <p className="mt-1 text-sm leading-relaxed text-foreground/75">{s.desc}</p>}
                </div>
              </div>
            ))}
            {steps.length === 0 && (
              <div className="border-y border-border py-8 text-center text-sm text-muted-foreground">
                暂未填写招新流程
              </div>
            )}
          </div>
          {requirements.length > 0 && (
            <div className="mt-8 text-sm leading-relaxed text-muted-foreground">
              <p>我们希望你：</p>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {requirements.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* ===== 右：登录 / 提交 / 进度 ===== */}
        <div className="border border-border bg-card p-6 sm:p-8">
          {auth === 'checking' || (auth === 'authenticated' && appLoading) ? (
            <div className="flex flex-col items-center py-16">
              <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
              <p className="mt-3 text-sm text-muted-foreground">
                {auth === 'checking' ? '正在确认登录状态…' : '正在读取你的报名进度…'}
              </p>
            </div>
          ) : auth === 'anonymous' ? (
            !ssoReady ? (
              <div className="flex flex-col items-center py-12 text-center">
                <h3 className="font-display text-2xl font-bold">教务网登录暂未开放</h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  身份认证入口尚未开放，请稍后再来，或先通过页脚邮箱与我们取得联系。
                </p>
              </div>
            ) : (
              // 登录按钮在**两种情况下都要有**：报名开着是「来报名」，
              // 报名关了就是「已经报过名的回来看进度」—— 后者过去没有入口，同学只能干看着。
              <div className="flex flex-col items-center py-10 text-center">
                <h3 className="font-display text-2xl font-bold">
                  {applyOpen ? '提交你的报名表' : closedNotice.title}
                </h3>
                <p className="mt-3 max-w-sm text-sm leading-relaxed text-muted-foreground">
                  {applyOpen
                    ? '提交前需通过学校教务网完成身份认证。登录状态保留 30 天，期间无需重复验证。'
                    : '本次报名通道已经关闭，不能再提交新的报名表。已经报过名的同学登录后可以继续查看自己的进度 —— 材料审核结果与后续安排都在那里。'}
                </p>
                {/* 报名中 → 登录为了提交；报名已结束 → 登录为了查进度。
                    还没开招（休眠 / 备招）就不给按钮了 —— 那时登录也没有东西可看。 */}
                {(applyOpen || gate === 'closed') && (
                  <>
                    <Button className="mt-6 gap-2" onClick={signIn}>
                      <QrCode className="h-4 w-4" />
                      {applyOpen ? '使用教务网账号登录' : '扫码登录，查看我的进度'}
                    </Button>
                    <p className="mt-3 text-xs text-muted-foreground">
                      将跳转到教务网认证页面，用微信扫码并在手机上确认后自动返回本页
                    </p>
                  </>
                )}
              </div>
            )
          ) : application && !reupload ? (
            <>
              <ApplicationProgress
                application={application}
                groupLabel={group.label}
                group={group.number}
                inviteUrl={inviteUrl}
              />
              {/* 材料被驳回时：进度照看，同时给一条直通「改材料」的路 */}
              {applyOpen && application.materialStatus === 'rejected' && (
                <div className="mt-6 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs leading-relaxed">
                  <p className="text-destructive">材料被驳回：{application.materialReason || '（未填写理由）'}</p>
                  <Button size="sm" className="mt-3" onClick={() => setShowProgress(false)}>
                    去修改材料
                  </Button>
                </div>
              )}
              <div className="mt-5 flex items-center justify-between border-t border-border pt-4 text-xs text-muted-foreground">
                <span>
                  {identity?.name || '已登录'} {identity?.studentId}
                </span>
                <button onClick={() => void signOut()} className="hover:text-accent">
                  更换账号
                </button>
              </div>
            </>
          ) : !applyOpen ? (
            /* 已登录、但名下没有报名记录，且通道已经关闭 */
            <div className="flex flex-col items-center py-16 text-center">
              <h3 className="font-display text-2xl font-bold">{closedNotice.title}</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">{closedNotice.desc}</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-display text-2xl font-bold">
                  {reupload ? '按驳回理由重新提交材料' : '提交你的报名表'}
                </h2>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" /> 已登录
                </span>
              </div>

              <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-border bg-secondary/40 px-4 py-3">
                <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-600" />
                <div className="min-w-0 text-sm">
                  <span className="font-medium">{identity?.name || '已登录'}</span>
                  <span className="ml-2 text-muted-foreground">{identity?.studentId}</span>
                </div>
                <button
                  onClick={() => void signOut()}
                  className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-accent"
                >
                  更换账号
                </button>
              </div>

              <p className="mt-2 text-xs text-muted-foreground">
                身份信息由学校教务网提供，不可手动修改 · {APPLICATION_DOC_HINT}
              </p>

              {reupload && application && (
                <div className="mt-4 rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-3 text-xs leading-relaxed">
                  <p className="text-destructive">
                    材料被驳回：{application.materialReason || '（管理员没有填写理由）'}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    按上面的说明改好后重新选择文件提交即可；提交后审核状态会回到「待审核」，
                    我们会再看一遍。
                  </p>
                  <button
                    onClick={() => setShowProgress(true)}
                    className="mt-2 text-muted-foreground underline hover:text-accent"
                  >
                    先看看我的进度
                  </button>
                </div>
              )}

              <label
                onDragOver={(e) => {
                  e.preventDefault()
                  setDragOver(true)
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  void onPickFile(e.dataTransfer.files?.[0] ?? null)
                }}
                className={cn(
                  'mt-6 flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition-colors',
                  dragOver ? 'border-accent bg-accent/5' : 'border-border bg-secondary/40 hover:border-accent/50',
                )}
              >
                <input
                  type="file"
                  accept={APPLICATION_DOC_ACCEPT}
                  className="hidden"
                  onChange={(e) => void onPickFile(e.target.files?.[0] ?? null)}
                />
                <Upload className="h-8 w-8 text-muted-foreground" />
                <p className="mt-3 text-sm font-medium">
                  {file ? file.name : '点击选择或拖拽报名表到此处'}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {file
                    ? `${formatSize(file.size)} · 校验通过`
                    : '仅限 .pdf / .docx，仅修改后缀的文件无法通过校验'}
                </p>
                {fileError && <p className="mt-3 max-w-xs text-xs text-destructive">{fileError}</p>}
              </label>

              {file && (
                <div className="mt-4 flex items-center justify-between rounded-xl border border-border bg-secondary/50 px-4 py-2.5">
                  <span className="truncate text-sm">{file.name}</span>
                  <button
                    onClick={() => setFile(null)}
                    className="ml-3 shrink-0 rounded-full p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                    title="移除文件"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label>邮箱 *</Label>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@example.edu.cn"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    笔试、面试通知与邀请函都会发到这个邮箱，请填写常用的
                  </p>
                </div>
                <div className="grid gap-1.5">
                  <Label>手机号 *</Label>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="11 位手机号"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>QQ 号 *</Label>
                  <Input value={qq} onChange={(e) => setQq(e.target.value)} placeholder="用于加入招新通知群" />
                </div>
              </div>

              {replaceConfirmed && (
                <div className="mt-6 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-xs leading-relaxed text-amber-700">
                  你之前已经提交过报名表。再点一次「确认替换」会<strong>覆盖原来的材料并删除旧文件</strong>；
                  不想替换的话换掉文件前先别点。
                </div>
              )}

              <Button
                onClick={() => void submit(reupload)}
                className="mt-6 w-full"
                disabled={!file || submitting}
              >
                {submitting
                  ? '正在上传…'
                  : reupload
                    ? '重新上传并提交'
                    : replaceConfirmed
                      ? '确认替换报名表'
                      : '上传并提交'}
              </Button>
              <p className="mt-3 text-xs text-muted-foreground">
                {reupload
                  ? '提交后会替换掉现在这份材料（旧文件会被删除），并重新进入审核。'
                  : '提交后可在本页随时查看进度；一位同学只保留一条报名记录，重复提交会替换材料。'}
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
