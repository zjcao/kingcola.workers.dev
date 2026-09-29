/**
 * 名单：跨阶段的全量数据入口 —— 筛选、搜索、导出 CSV、批量处理、单人详情。
 *
 * 流程页只露出「当前这一步该做的事」，翻旧账、找人、导数据都来这里。
 * 成绩与评语是内部评审记录，只在详情里改（就地编辑容易误触）。
 */

import { useEffect, useMemo, useState } from 'react'
import {
  canMoveStage,
  MATERIAL_REASON_MAX,
  MATERIAL_STATUS_LABELS,
  nextStageOf,
  prevStageOf,
  RECRUIT_APPLICATION_MAIL_KINDS,
  RECRUIT_MAIL_KINDS,
  RECRUIT_MAIL_META,
  RECRUIT_STAGE_LABELS,
  RECRUIT_STAGES,
  STAGE_RESULTS,
  type CheckinStage,
  type MaterialStatus,
  type RecruitMailKind,
  type RecruitResult,
  type RecruitStage,
} from '@shared/recruit'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import {
  Check,
  Copy,
  Download,
  FileText,
  Loader2,
  Mail,
  Save,
  Search,
  Send,
  Trash2,
  UserMinus,
  UserX,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  adminGetApplication,
  applicationFileUrl,
  recruitExportUrl,
  type AdminApplication,
  type MailLogRow,
} from '@/api/endpoints'
import { downloadFile, formatSize, formatTime, resultLabel } from './recruit-ui'
import type { RecruitAdmin } from './useRecruitAdmin'

/** 该阶段的成绩/签到字段（报名与转正没有） */
function examFieldOf(stage: RecruitStage): CheckinStage | null {
  return stage === 'written' || stage === 'interview' || stage === 'defense' ? stage : null
}

/** 关键词搜索：姓名 / 学号 / 邮箱 / 手机 / QQ 都能命中 */
function matches(app: AdminApplication, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [app.name, app.studentId, app.email, app.phone, app.qq].some((field) =>
    field.toLowerCase().includes(q),
  )
}

export function RecruitRosterView({ admin }: { admin: RecruitAdmin }) {
  // 默认停在当前阶段（备招与休眠期没有对应阶段，就落在报名）
  const [stage, setStage] = useState<RecruitStage>(admin.timelineKey === 'prepare' ? 'apply' : admin.timelineKey)
  const [result, setResult] = useState<string>('all')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [deleting, setDeleting] = useState<AdminApplication | null>(null)
  /** 材料审核筛选（只在报名阶段与「待确认笔试名单」期间有意义） */
  const [material, setMaterial] = useState<'all' | MaterialStatus>('all')
  /** 驳回对话框：要驳回的那批人（行内进来是 1 个，批量条进来是一批）；null = 关着 */
  const [rejecting, setRejecting] = useState<string[] | null>(null)

  /** 材料审核只在报名阶段可用（后端同样会拒），其余阶段不显示这些入口 */
  const reviewable = admin.state === 'apply' || admin.state === 'apply_review'

  const stageList = useMemo(() => admin.apps.filter((app) => app.stage === stage), [admin.apps, stage])
  const filtered = useMemo(
    () =>
      stageList.filter(
        (app) =>
          (result === 'all' || app.result === result) &&
          (!reviewable || material === 'all' || app.materialStatus === material) &&
          matches(app, query),
      ),
    [stageList, result, material, reviewable, query],
  )

  /** 审核状态各自多少人（筛选条上的计数） */
  const materialCounts = useMemo(() => {
    const counts: Record<string, number> = { all: stageList.length }
    for (const app of stageList) counts[app.materialStatus] = (counts[app.materialStatus] ?? 0) + 1
    return counts
  }, [stageList])
  const detail = detailId ? (admin.apps.find((app) => app.id === detailId) ?? null) : null
  const allChecked = filtered.length > 0 && filtered.every((app) => selected.has(app.id))
  const checkinStage = examFieldOf(stage)

  const toggleAll = () =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (allChecked) filtered.forEach((app) => next.delete(app.id))
      else filtered.forEach((app) => next.add(app.id))
      return next
    })

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const selectedIds = [...selected]

  /** 通过材料（单个也走批量接口：同一条规则、同一句 toast） */
  const approveMaterial = async (ids: string[]) => {
    if (await admin.bulk(ids, 'approve_material')) setSelected(new Set())
  }

  /** 驳回材料：理由必填（会逐人发信，见 RejectDialog 的说明） */
  const rejectMaterial = async (reason: string) => {
    const ids = rejecting
    setRejecting(null)
    if (!ids) return
    if (await admin.bulk(ids, 'reject_material', { materialReason: reason })) setSelected(new Set())
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">名单</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            跨阶段的全量数据：筛选、搜索、导出 CSV，勾选后批量处理。
            点「详情 · 改资料」可以**补 / 改这个人的任何信息**（含报名表）—— 补录时没带齐的东西都在那里补。
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            const today = new Date().toISOString().slice(0, 10)
            downloadFile(
              recruitExportUrl({
                stage,
                result: result === 'all' ? undefined : result,
                q: query.trim() || undefined,
              }),
              `报名名单-${RECRUIT_STAGE_LABELS[stage]}-${today}.csv`,
            )
            toast.success(`正在导出 ${filtered.length} 条记录`)
          }}
        >
          <Download className="h-4 w-4" /> 导出 CSV（当前筛选 {filtered.length} 条）
        </Button>
      </div>

      {/* 阶段与结果筛选 */}
      <div className="space-y-3 rounded-xl border border-border bg-card px-5 py-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {RECRUIT_STAGES.map((item) => {
            const count = admin.apps.filter((app) => app.stage === item).length
            return (
              <button
                key={item}
                onClick={() => {
                  setStage(item)
                  setResult('all')
                  setSelected(new Set())
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  stage === item
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : 'border-border text-foreground/70 hover:bg-secondary',
                )}
              >
                {RECRUIT_STAGE_LABELS[item]} {count}
              </button>
            )
          })}
          <div className="relative ml-auto min-w-56">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              value={query}
              placeholder="搜姓名 / 学号 / 邮箱 / 手机 / QQ"
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
          {(['all', ...STAGE_RESULTS[stage]] as string[]).map((item) => {
            const count =
              item === 'all' ? stageList.length : stageList.filter((app) => app.result === item).length
            return (
              <button
                key={item || 'pending'}
                onClick={() => setResult(item)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  result === item ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {item === 'all' ? '全部' : resultLabel(item as RecruitResult)} {count}
              </button>
            )
          })}
        </div>

        {/* 材料审核筛选：报名阶段的主线任务就是把这些「待审核」清空 */}
        {reviewable && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
            <span className="mr-1 text-[11px] text-muted-foreground">材料审核</span>
            {(['all', 'approved', 'rejected', ''] as const).map((item) => (
              <button
                key={item || 'pending'}
                onClick={() => setMaterial(item)}
                className={cn(
                  'rounded-full px-3 py-1 text-xs transition-colors',
                  material === item ? 'bg-accent/15 text-accent' : 'text-muted-foreground hover:bg-secondary',
                )}
              >
                {item === 'all' ? '全部' : MATERIAL_STATUS_LABELS[item]} {materialCounts[item] ?? 0}
              </button>
            ))}
            <span className="ml-2 text-[11px] text-muted-foreground">
              只有「材料已通过」的人才能被勾选进笔试名单
            </span>
          </div>
        )}
      </div>

      {/* 批量操作条 */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-accent/40 bg-accent/5 px-4 py-2.5 text-xs">
          <span className="font-medium">已勾选 {selected.size} 人</span>
          {reviewable && (
            <>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                onClick={() => void approveMaterial(selectedIds)}
              >
                <Check className="h-3.5 w-3.5" /> 通过材料
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1 text-destructive"
                onClick={() => setRejecting(selectedIds)}
              >
                <XCircle className="h-3.5 w-3.5" /> 驳回材料…
              </Button>
            </>
          )}
          {checkinStage && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={async () => {
                if (await admin.bulk(selectedIds, 'checkin', { stage: checkinStage })) setSelected(new Set())
              }}
            >
              <Check className="h-3.5 w-3.5" /> 标记已签到
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={async () => {
              if (await admin.bulk(selectedIds, 'absent')) setSelected(new Set())
            }}
          >
            <UserX className="h-3.5 w-3.5" /> 标记未参加
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-1"
            onClick={async () => {
              if (await admin.bulk(selectedIds, 'withdraw')) setSelected(new Set())
            }}
          >
            <UserMinus className="h-3.5 w-3.5" /> 退出报名
          </Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={() => setNotifyOpen(true)}>
            <Mail className="h-3.5 w-3.5" /> 群发通知
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            取消选择
          </Button>
          <span className="text-muted-foreground">缺考与退出都不发信。</span>
        </div>
      )}

      {/* 表格 */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[hsl(var(--accent))]"
                  checked={allChecked}
                  onChange={toggleAll}
                  aria-label="全选"
                />
              </TableHead>
              <TableHead className="w-48">报名人</TableHead>
              <TableHead>联系方式</TableHead>
              {checkinStage && <TableHead className="w-24">成绩</TableHead>}
              {checkinStage && <TableHead className="w-24">签到</TableHead>}
              {reviewable && <TableHead className="w-24">材料</TableHead>}
              <TableHead className="w-28">当前状态</TableHead>
              <TableHead className="w-56" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((app) => (
              <TableRow key={app.id}>
                <TableCell>
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[hsl(var(--accent))]"
                    checked={selected.has(app.id)}
                    onChange={() => toggle(app.id)}
                    aria-label={`选择 ${app.name}`}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    {app.name}
                    {app.source === 'manual' && (
                      <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                        补录
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">{app.studentId}</div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {app.email || '—'}
                  <br />
                  {app.phone}
                </TableCell>
                {checkinStage && (
                  <TableCell className="text-xs">
                    {app[`${checkinStage}Score` as 'writtenScore' | 'interviewScore' | 'defenseScore'] || '—'}
                  </TableCell>
                )}
                {checkinStage && (
                  <TableCell className="text-xs">
                    {app[`${checkinStage}CheckinAt` as 'writtenCheckinAt' | 'interviewCheckinAt' | 'defenseCheckinAt'] ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Check className="h-3.5 w-3.5" /> 已签到
                      </span>
                    ) : (
                      <span className="text-muted-foreground">未签到</span>
                    )}
                  </TableCell>
                )}
                {reviewable && (
                  <TableCell>
                    <MaterialBadge status={app.materialStatus} />
                  </TableCell>
                )}
                <TableCell className="text-xs">{app.statusLabel}</TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    {reviewable && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs"
                          onClick={() => void approveMaterial([app.id])}
                        >
                          <Check className="h-3.5 w-3.5" /> 通过
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 gap-1 text-xs text-destructive"
                          onClick={() => setRejecting([app.id])}
                        >
                          <XCircle className="h-3.5 w-3.5" /> 驳回
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDetailId(app.id)}>
                      详情 · 改资料
                    </Button>
                    {app.fileName && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 gap-1 text-xs"
                        onClick={() => window.open(applicationFileUrl(app.id), '_blank')}
                      >
                        <FileText className="h-3.5 w-3.5" /> 报名表
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-destructive"
                      onClick={() => setDeleting(app)}
                      aria-label="删除"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5 + (checkinStage ? 2 : 0) + (reviewable ? 1 : 0)}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  {admin.loading ? '正在加载…' : '没有符合条件的记录'}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {detail && (
        <AppDetailDialog
          key={detail.id}
          admin={admin}
          app={detail}
          onClose={() => setDetailId(null)}
        />
      )}

      <NotifyDialog
        open={notifyOpen}
        count={selected.size}
        onClose={() => setNotifyOpen(false)}
        onSend={async (subject, body) => {
          if (await admin.notify(selectedIds, subject, body)) {
            setNotifyOpen(false)
            setSelected(new Set())
          }
        }}
      />

      {rejecting && (
        <RejectDialog
          count={rejecting.length}
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => void rejectMaterial(reason)}
        />
      )}

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除这条报名记录？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除 {deleting?.name}（{deleting?.studentId}）的报名记录及其报名表文件，不可撤销。
              该同学需要重新报名才能再次参与。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (deleting) await admin.deleteApp(deleting.id, deleting.name)
                setDeleting(null)
              }}
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/** 材料审核状态的徽标：三种状态一眼分清（灰 / 绿 / 红） */
function MaterialBadge({ status }: { status: MaterialStatus }) {
  const tone =
    status === 'approved'
      ? 'bg-emerald-500/10 text-emerald-700'
      : status === 'rejected'
        ? 'bg-destructive/10 text-destructive'
        : 'bg-secondary text-muted-foreground'
  return (
    <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[11px]', tone)}>
      {MATERIAL_STATUS_LABELS[status]}
    </span>
  )
}

/**
 * 驳回理由对话框。
 *
 * 理由**不能用默认值糊过去**：它会被写进发给同学的那封「材料驳回通知」，
 * 是对方改材料的唯一依据 —— 所以按钮上直接写「驳回并发出通知」，让人知道自己按下去会发生什么。
 */
function RejectDialog({
  count,
  onClose,
  onConfirm,
}: {
  count: number
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>驳回 {count} 人的材料</DialogTitle>
          <DialogDescription>
            理由会逐人写进「材料驳回通知」邮件里，是同学修改材料的唯一依据 —— 写具体一点，
            比如「报名表缺成绩单页」「附件打不开」「手机号少一位」。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-1.5">
          <Label className="text-xs">驳回理由 *</Label>
          <Textarea
            rows={4}
            value={reason}
            maxLength={MATERIAL_REASON_MAX}
            placeholder="例：报名表里没有成绩单页，请补齐后重新上传。"
            onChange={(event) => setReason(event.target.value)}
          />
          <p className="text-[11px] text-muted-foreground">
            同学重新上传材料后，审核状态会回到「待审核」，你可以再看一遍（在此之前他不能进笔试名单）。
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button
            variant="destructive"
            className="gap-1.5"
            disabled={!reason.trim()}
            onClick={() => onConfirm(reason.trim())}
          >
            <XCircle className="h-4 w-4" /> 驳回并发出通知
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 群发通知：主题与正文都支持 {变量}，由后端逐人渲染 */
function NotifyDialog({
  open,
  count,
  onClose,
  onSend,
}: {
  open: boolean
  count: number
  onClose: () => void
  onSend: (subject: string, body: string) => Promise<void> | void
}) {
  const [subject, setSubject] = useState('【拾光工作室】招新通知 · {name}')
  const [body, setBody] = useState(
    '{name} 同学：\n\n你好，关于本次招新有一则通知：\n（在这里写内容，可用 {studio} 等变量）\n\n拾光工作室',
  )
  const [sending, setSending] = useState(false)

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>群发通知（{count} 人）</DialogTitle>
          <DialogDescription>发给勾选的同学，邮件发出后无法撤回。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label className="text-xs">主题</Label>
            <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-xs">正文</Label>
            <Textarea rows={8} value={body} onChange={(event) => setBody(event.target.value)} />
            <p className="text-[11px] text-muted-foreground">
              可用变量：{'{name}'}、{'{studentId}'}、{'{cycleName}'}、{'{studio}'}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button
            className="gap-1.5"
            disabled={sending || !subject.trim()}
            onClick={async () => {
              setSending(true)
              try {
                await onSend(subject, body)
              } finally {
                setSending(false)
              }
            }}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} 发送
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 单人详情：状态流转、材料、成绩与评语、补发邮件、发信记录 */
function AppDetailDialog({
  admin,
  app,
  onClose,
}: {
  admin: RecruitAdmin
  app: AdminApplication
  onClose: () => void
}) {
  const [scores, setScores] = useState({
    writtenScore: app.writtenScore,
    interviewScore: app.interviewScore,
    defenseScore: app.defenseScore,
  })
  const [notes, setNotes] = useState({
    writtenNote: app.writtenNote,
    interviewNote: app.interviewNote,
    defenseNote: app.defenseNote,
  })
  const [remark, setRemark] = useState(app.note)
  /**
   * 资料草稿：姓名 / 学号 / 联系方式。
   * 与成绩评语分开保存（各有各的按钮）—— 一类是「这个人的信息」，一类是「这一轮的结论」。
   */
  const [profile, setProfile] = useState({
    name: app.name,
    studentId: app.studentId,
    email: app.email,
    phone: app.phone,
    qq: app.qq,
  })
  const [savingProfile, setSavingProfile] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [mailKind, setMailKind] = useState<RecruitMailKind | ''>('')
  const [mails, setMails] = useState<MailLogRow[]>([])
  const [saving, setSaving] = useState(false)
  /** 详情里的驳回理由草稿（与列表页的驳回对话框同一套规则：必填） */
  const [rejectReason, setRejectReason] = useState('')

  /** 材料审核只在报名阶段与「待确认笔试名单」期间可用（后端同样会拒） */
  const reviewable = admin.state === 'apply' || admin.state === 'apply_review'
  const checkinStage = examFieldOf(app.stage)
  const prev = prevStageOf(app.stage)
  const next = nextStageOf(app.stage)
  const checkedIn = checkinStage ? Boolean(app[`${checkinStage}CheckinAt` as keyof AdminApplication]) : false

  // 详情里的发信记录按人拉（比从全局日志里筛更准，也不受 200 条上限影响）
  useEffect(() => {
    adminGetApplication(app.id)
      .then((detail) => setMails(detail.mails))
      .catch(() => setMails([]))
  }, [app.id])

  const save = async () => {
    setSaving(true)
    try {
      await admin.updateApp(app.id, { ...scores, ...notes, note: remark })
    } finally {
      setSaving(false)
    }
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      await admin.updateApp(app.id, profile)
    } finally {
      setSavingProfile(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {app.name}
            <span className="text-sm font-normal text-muted-foreground">{app.studentId}</span>
            {app.source === 'manual' && (
              <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                补录
              </span>
            )}
          </DialogTitle>
          <DialogDescription>
            {app.stageLabel} · {app.resultLabel} · {app.statusLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          {/* 材料审核：报名阶段最常做的事，所以放在最上面 */}
          {reviewable && (
            <section className="rounded-lg border border-border px-4 py-3">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">材料审核</h3>
                <MaterialBadge status={app.materialStatus} />
                <span className="text-[11px] text-muted-foreground">
                  只有「材料已通过」的人能被勾选进笔试名单
                </span>
              </div>
              {app.materialStatus === 'rejected' && app.materialReason && (
                <p className="mb-2 rounded-md bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
                  已驳回：{app.materialReason}
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" className="gap-1" onClick={() => void admin.reviewMaterial(app, 'approved')}>
                  <Check className="h-3.5 w-3.5" /> 通过材料
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1 text-destructive"
                  disabled={!rejectReason.trim()}
                  onClick={() => void admin.reviewMaterial(app, 'rejected', rejectReason)}
                >
                  <XCircle className="h-3.5 w-3.5" /> 驳回并发出通知
                </Button>
                {app.materialStatus !== '' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-xs"
                    onClick={() => void admin.reviewMaterial(app, '')}
                  >
                    退回待审核
                  </Button>
                )}
              </div>
              <div className="mt-2 grid gap-1.5">
                <Label className="text-xs">驳回理由（会发进邮件，同学照着它改）</Label>
                <Textarea
                  rows={2}
                  value={rejectReason}
                  maxLength={MATERIAL_REASON_MAX}
                  placeholder="例：报名表缺成绩单页，请补齐后重新上传。"
                  onChange={(event) => setRejectReason(event.target.value)}
                />
              </div>
            </section>
          )}

          {/* 状态与流转 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">状态与流转</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!prev || !canMoveStage(app.stage, prev)}
                onClick={() => prev && void admin.updateApp(app.id, { stage: prev, result: '' })}
              >
                退回{prev ? RECRUIT_STAGE_LABELS[prev] : '—'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!next || !canMoveStage(app.stage, next)}
                onClick={() => next && void admin.updateApp(app.id, { stage: next, result: '' })}
              >
                推进到{next ? RECRUIT_STAGE_LABELS[next] : '—'}
              </Button>
              <Select
                value={app.result || 'pending'}
                onValueChange={(value) =>
                  void admin.updateApp(app.id, { result: value === 'pending' ? '' : (value as RecruitResult) })
                }
              >
                <SelectTrigger className="h-8 w-28 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_RESULTS[app.stage].map((item) => (
                    <SelectItem key={item || 'pending'} value={item || 'pending'}>
                      {resultLabel(item)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {checkinStage && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() =>
                    void admin.updateApp(app.id, { checkin: { stage: checkinStage, value: !checkedIn } })
                  }
                >
                  <Check className="h-3.5 w-3.5" />
                  {checkedIn ? '取消签到' : '标记签到'}
                </Button>
              )}
              {app.result !== 'withdrawn' && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => void admin.updateApp(app.id, { result: 'withdrawn' })}
                >
                  退出报名
                </Button>
              )}
              {app.inviteUrl && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1"
                  onClick={() => {
                    void navigator.clipboard
                      .writeText(app.inviteUrl)
                      .then(() => toast.success('邀请链接已复制'))
                      .catch(() => toast.error('复制失败，请手动复制'))
                  }}
                >
                  <Copy className="h-3.5 w-3.5" /> 复制邀请链接
                </Button>
              )}
            </div>
          </section>

          {/* 资料（可修改）：补录时没拿到的信息与材料，都在这里后补；学号撞人会被后端拦下 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <div className="mb-3 flex flex-wrap items-baseline gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">资料（可修改）</h3>
              <span className="text-[11px] text-muted-foreground">
                补录时没拿到的东西可以后补；学号与别人重复时会被拦下
              </span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label className="text-xs">姓名</Label>
                <Input
                  className="h-8 text-xs"
                  value={profile.name}
                  onChange={(event) => setProfile({ ...profile, name: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">学号</Label>
                <Input
                  className="h-8 text-xs"
                  value={profile.studentId}
                  onChange={(event) => setProfile({ ...profile, studentId: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">邮箱</Label>
                <Input
                  className="h-8 text-xs"
                  placeholder="后面发通知要用"
                  value={profile.email}
                  onChange={(event) => setProfile({ ...profile, email: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">手机</Label>
                <Input
                  className="h-8 text-xs"
                  value={profile.phone}
                  onChange={(event) => setProfile({ ...profile, phone: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">QQ</Label>
                <Input
                  className="h-8 text-xs"
                  value={profile.qq}
                  onChange={(event) => setProfile({ ...profile, qq: event.target.value })}
                />
              </div>
              <div className="flex items-end justify-between gap-2 text-[11px] text-muted-foreground">
                <span>报名时间 {formatTime(app.createdAt ?? '')}</span>
                <Button
                  size="sm"
                  className="h-8 gap-1"
                  disabled={savingProfile}
                  onClick={() => void saveProfile()}
                >
                  {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存资料
                </Button>
              </div>
            </div>

            {/* 报名表：后补 / 替换（与官网报名同一套校验，成功后旧文件会被删掉） */}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                {app.fileName ? (
                  <>
                    <span className="font-medium">{app.fileName}</span>
                    <span className="text-muted-foreground">{formatSize(app.fileSize)}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 gap-1 text-xs"
                      onClick={() => window.open(applicationFileUrl(app.id), '_blank')}
                    >
                      <Download className="h-3 w-3" /> 下载
                    </Button>
                  </>
                ) : (
                  <span className="text-amber-700">还没有报名表 —— 现场没带或是在这里补上</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="file"
                  accept=".pdf,.docx"
                  disabled={uploading}
                  className="h-8 max-w-60 text-xs"
                  onChange={(event) => {
                    const picked = event.target.files?.[0]
                    // 选完就清空 input，否则同一个文件连选两次不会再触发 change
                    event.target.value = ''
                    if (!picked) return
                    void (async () => {
                      setUploading(true)
                      try {
                        await admin.uploadDoc(app.id, picked)
                      } finally {
                        setUploading(false)
                      }
                    })()
                  }}
                />
                {uploading && <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" />}
                <span className="text-[11px] text-muted-foreground">
                  {app.fileUrl ? '选文件即替换（旧文件会被删掉）' : '选文件即上传'}，PDF / DOCX，单个不超过 20MB
                </span>
              </div>
            </div>
          </section>

          {/* 成绩与评语 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">成绩与评语（内部可见）</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {RECRUIT_STAGES.filter((item) => examFieldOf(item)).map((item) => {
                const key = item as CheckinStage
                const scoreKey = `${key}Score` as 'writtenScore' | 'interviewScore' | 'defenseScore'
                const noteKey = `${key}Note` as 'writtenNote' | 'interviewNote' | 'defenseNote'
                return (
                  <div key={item} className="grid gap-1.5">
                    <Label className="text-xs">{RECRUIT_STAGE_LABELS[item]}成绩</Label>
                    <Input
                      className="h-8 text-xs"
                      value={scores[scoreKey]}
                      placeholder="如 78"
                      onChange={(event) => setScores({ ...scores, [scoreKey]: event.target.value })}
                    />
                    <Input
                      className="h-8 text-xs"
                      value={notes[noteKey]}
                      placeholder={item === 'interview' ? '面试评语' : '阅卷备注'}
                      onChange={(event) => setNotes({ ...notes, [noteKey]: event.target.value })}
                    />
                  </div>
                )
              })}
            </div>
            <div className="mt-3 grid gap-1.5">
              <Label className="text-xs">管理员备注</Label>
              <Textarea
                rows={2}
                className="text-xs"
                value={remark}
                onChange={(event) => setRemark(event.target.value)}
              />
            </div>
            <Button size="sm" className="mt-3 gap-1.5" onClick={() => void save()} disabled={saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} 保存
            </Button>
          </section>

          {/* 补发通知邮件 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">补发通知邮件</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Select
                value={mailKind || 'none'}
                onValueChange={(value) => setMailKind(value === 'none' ? '' : (value as RecruitMailKind))}
              >
                <SelectTrigger className="h-8 w-56 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">不发送</SelectItem>
                  {RECRUIT_APPLICATION_MAIL_KINDS.map((kind) => (
                    <SelectItem key={kind} value={kind}>
                      {RECRUIT_MAIL_META[kind].label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                variant="outline"
                className="gap-1"
                disabled={!mailKind}
                onClick={() => {
                  if (mailKind) void admin.sendMail(app.id, mailKind)
                }}
              >
                <Send className="h-3.5 w-3.5" /> 发送
              </Button>
              <span className="text-[11px] text-muted-foreground">
                {mailKind ? RECRUIT_MAIL_META[mailKind].trigger : '选一封信补发给他'}
              </span>
            </div>
          </section>

          {/* 发信记录 */}
          <section className="rounded-lg border border-border px-4 py-3">
            <h3 className="mb-2 text-xs font-semibold text-muted-foreground">发信记录</h3>
            {mails.length === 0 ? (
              <p className="text-xs text-muted-foreground">还没有给他发过信。</p>
            ) : (
              <ul className="space-y-1.5 text-xs">
                {mails.map((mail) => (
                  <li key={mail.id} className="flex flex-wrap items-center gap-2">
                    <span className="text-muted-foreground">{formatTime(mail.createdAt)}</span>
                    <span className="font-medium">
                      {(RECRUIT_MAIL_KINDS as readonly string[]).includes(mail.kind)
                        ? RECRUIT_MAIL_META[mail.kind as RecruitMailKind].label
                        : '自定义通知'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{mail.subject}</span>
                    <span className={mail.ok ? 'text-emerald-700' : 'text-destructive'}>
                      {mail.ok ? '已发出' : `${mail.code} ${mail.message}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
