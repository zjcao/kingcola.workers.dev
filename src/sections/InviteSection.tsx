import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { MemberAvatar } from '@/components/brand'
import { confirmInvite, fetchInvite, inviteUploadAvatar, type InviteInfo } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { formatLimit, uploadImageLimit } from '@shared/resources'
import { PAGE_PATHS, type SiteConfig } from '@/types'
import { CheckCircle2, ImagePlus, Loader2, PartyPopper } from 'lucide-react'
import { toast } from 'sonner'

type Phase = 'loading' | 'ready' | 'already' | 'error' | 'done'

/**
 * 邀请函确认页（`/invite/:token`）。
 *
 * 通过答辩的同学会收到一封带专属链接的邮件，打开就是这里：
 * 填写成员档案 → 确认 → 后端写入 `members`，本人立刻出现在官网「团队成员」里。
 *
 * 链接本身就是凭证（有效期 14 天、只能确认一次），所以这一页不要求登录 ——
 * 同学的教务网会话可能早就过期了，不应该因此卡住转正。
 */
export function InviteSection({ site }: { site: SiteConfig }) {
  const { token = '' } = useParams<{ token: string }>()

  const [phase, setPhase] = useState<Phase>('loading')
  const [info, setInfo] = useState<InviteInfo | null>(null)
  const [errorText, setErrorText] = useState('')

  const [title, setTitle] = useState('')
  const [nameEn, setNameEn] = useState('')
  const [direction, setDirection] = useState('')
  const [bio, setBio] = useState('')
  const [email, setEmail] = useState('')
  const [homepageUrl, setHomepageUrl] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  // 上限与 Worker 校验同源（头像 2MB），前端先拦一道省得白传一趟
  const avatarLimit = uploadImageLimit('avatars')

  const pickAvatar = async (file: File | null | undefined) => {
    if (!file) return
    if (file.size > avatarLimit) {
      toast.error(`头像不能超过 ${formatLimit(avatarLimit)}`)
      return
    }
    setUploadingAvatar(true)
    try {
      const result = await inviteUploadAvatar(token, file)
      setAvatarUrl(result.url)
      toast.success('头像已上传')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '头像上传失败，请重试')
    } finally {
      setUploadingAvatar(false)
      if (avatarInputRef.current) avatarInputRef.current.value = ''
    }
  }

  const load = useCallback(async () => {
    setPhase('loading')
    setErrorText('')
    try {
      const result = await fetchInvite(token)
      setInfo(result)
      setEmail(result.email ?? '')
      setPhase(result.alreadyMember ? 'already' : 'ready')
    } catch (error) {
      setErrorText(error instanceof ApiError ? error.message : '邀请函加载失败，请稍后重试')
      setPhase('error')
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (!avatarUrl) return toast.error('请先上传个人头像')
    if (!title) return toast.error('请选择你在工作室的方向')
    if (!direction.trim()) return toast.error('请填写你在工作室的负责方向')

    setSubmitting(true)
    try {
      await confirmInvite(token, {
        title,
        nameEn: nameEn.trim(),
        direction: direction.trim(),
        bio: bio.trim(),
        email: email.trim(),
        homepageUrl: homepageUrl.trim(),
        avatarUrl,
      })
      setPhase('done')
      toast.success('已确认加入，欢迎加入工作室！')
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '确认失败，请稍后重试')
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
        <p className="mt-3 text-sm text-muted-foreground">正在读取邀请函…</p>
      </div>,
    )
  }

  if (phase === 'error') {
    return shell(
      <div className="py-6 text-center">
        <h1 className="font-display text-2xl font-bold">邀请函不可用</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{errorText}</p>
        <Link
          to={PAGE_PATHS.home}
          className="mt-6 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          回到首页
        </Link>
      </div>,
    )
  }

  if (phase === 'already') {
    return shell(
      <div className="py-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <h1 className="mt-4 font-display text-2xl font-bold">你已确认加入</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          {info?.name} 同学，你的成员档案已经建立，无需重复提交。
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

  if (phase === 'done') {
    return shell(
      <div className="py-6 text-center">
        <PartyPopper className="mx-auto h-10 w-10 text-accent" />
        <h1 className="mt-4 font-display text-2xl font-bold">欢迎加入 {site.studioName}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          成员档案已建立，头像也收到了 —— 你现在就出现在官网「团队成员」页面。
        </p>
        <Link
          to={PAGE_PATHS.members}
          className="mt-6 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          前往团队成员页
        </Link>
      </div>,
    )
  }

  return shell(
    <>
      <p className="text-xs tracking-[0.2em] text-muted-foreground">{site.studioNameEn}</p>
      <h1 className="mt-3 font-display text-3xl font-bold">填写成员信息，确认加入</h1>
      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        {info?.name} 同学（{info?.studentId}），恭喜你通过全部考核！
        请补齐下面的成员档案信息（<strong className="font-medium text-foreground">头像必传</strong>
        ，会直接显示在官网成员卡片上），确认后我们会立刻为你开通成员身份。
      </p>

      <div className="mt-8 grid gap-4">
        <div className="grid gap-1.5">
          <Label>个人头像 *</Label>
          <div className="flex items-center gap-4">
            <MemberAvatar
              name={info?.name ?? ''}
              seed={info?.studentId ?? token}
              src={avatarUrl}
              size="lg"
            />
            <div className="grid gap-2">
              <input
                ref={avatarInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={uploadingAvatar}
                onClick={() => avatarInputRef.current?.click()}
              >
                {uploadingAvatar ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5" />
                )}
                {uploadingAvatar ? '上传中…' : avatarUrl ? '更换头像' : '选择头像'}
              </Button>
              <p className="text-[11px] text-muted-foreground">
                建议正方形（1:1），JPG / PNG / WebP / GIF，不超过 {formatLimit(avatarLimit)}
                ；会显示在官网「团队成员」页
              </p>
            </div>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>方向 / 角色 *</Label>
          <Select value={title} onValueChange={setTitle}>
            <SelectTrigger>
              <SelectValue placeholder="请选择你在工作室的方向" />
            </SelectTrigger>
            <SelectContent>
              {(info?.roleOptions ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">会用在你成员卡片的角色标签上</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label>英文名</Label>
            <Input value={nameEn} onChange={(e) => setNameEn(e.target.value)} placeholder="San Zhang" />
          </div>
          <div className="grid gap-1.5">
            <Label>负责方向 *</Label>
            <Input
              value={direction}
              onChange={(e) => setDirection(e.target.value)}
              placeholder="如：Web 前端 · 可视化"
            />
            <p className="text-[11px] text-muted-foreground">会显示在成员卡片的角色下方</p>
          </div>
        </div>

        <div className="grid gap-1.5">
          <Label>邮箱</Label>
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <p className="text-[11px] text-muted-foreground">默认用你报名时填的邮箱，可在此修正</p>
        </div>

        <div className="grid gap-1.5">
          <Label>个人主页</Label>
          <Input
            value={homepageUrl}
            onChange={(e) => setHomepageUrl(e.target.value)}
            placeholder="github.com/your-name 或 https://blog.example.com"
          />
          <p className="text-[11px] text-muted-foreground">
            博客 / GitHub / 作品集，可留空；填了会显示在你的成员卡片上
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label>个人简介</Label>
          <Textarea
            rows={4}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="一两句介绍你的技术方向与正在做的事…"
          />
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <Button onClick={() => void submit()} disabled={submitting} className="gap-2">
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {submitting ? '正在提交…' : '确认加入'}
        </Button>
        <span className="text-xs text-muted-foreground">
          确认后你会立即出现在「团队成员」页面；加入年份按 {info?.joinYear ?? '今年'} 记录
        </span>
      </div>

      <p className="mt-6 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
        不打算加入了？直接忽略本页即可，也可以回复邀请邮件告诉我们，我们会记录你的选择。
      </p>
    </>,
  )
}
