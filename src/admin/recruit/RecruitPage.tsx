/**
 * 招新后台（`/admin/recruit`）。
 *
 * 一页到底、事件驱动：**整届没有任何时间字段**，每一步都由管理员点按钮推进。
 *   休眠大屏 →（启动系统）备招 →（开启报名）报名 →（结束报名 / 确认名单）笔试
 *   →（结束笔试 / 生成面试名单）面试 →（结束面试 / 确认录取）答辩
 *   →（结束答辩 / 确认最终名单）转正 →（关闭本届 → 下载归档）回到休眠
 *
 * 本文件负责「流程」视图与顶层切换；名单 / 邮件日志 / 设置分别是另外三个视图，
 * 四个视图共用 `useRecruitAdmin()` 里的同一份数据与动作。
 *
 * 按钮文案与「能不能点」全部读 `RECRUIT_ACTION_META`（后端的同一张表），
 * 所以不会出现「界面能点但后端拒绝」。
 */

import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Button } from '@/components/ui/button'
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { cn } from '@/lib/utils'
import {
  ArrowLeft,
  ArrowRight,
  Ban,
  Check,
  CheckCircle2,
  Clock,
  Download,
  Loader2,
  Lock,
  Mail,
  Moon,
  QrCode,
  RotateCcw,
  Save,
  Settings2,
  UserPlus,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  CHECKIN_STAGE_LABELS,
  RECRUIT_ACTION_META,
  RECRUIT_GROUP_LABELS,
  RECRUIT_STAGE_LABELS,
  type CheckinStage,
  type RecruitAction,
  type RecruitGroupKey,
  type RecruitStage,
} from '@shared/recruit'
import { adminCreateApplication, type UpdateApplicationBody } from '@/api/endpoints'
import { RecruitMailView } from './RecruitMailView'
import { RecruitRosterView } from './RecruitRosterView'
import { RecruitSettingsView } from './RecruitSettingsView'
import { TIMELINE, formatTime, parseScore } from './recruit-ui'
import { useRecruitAdmin, type RecruitAdmin } from './useRecruitAdmin'

type TopView = 'flow' | 'roster' | 'mails' | 'settings'

const TOP_VIEWS: ReadonlyArray<{ key: TopView; label: string }> = [
  { key: 'flow', label: '流程' },
  { key: 'roster', label: '名单' },
  { key: 'mails', label: '邮件日志' },
  { key: 'settings', label: '设置' },
]

/** 该阶段的成绩字段（报名与转正没有成绩） */
function examFieldOf(stage: RecruitStage): CheckinStage | null {
  return stage === 'written' || stage === 'interview' || stage === 'defense' ? stage : null
}

/** 成绩 / 评语要写进哪个字段（三个字段名不同，所以在这里一次性映射清楚） */
function scoreBody(field: CheckinStage, value: string): UpdateApplicationBody {
  if (field === 'written') return { writtenScore: value }
  return field === 'interview' ? { interviewScore: value } : { defenseScore: value }
}

function noteBody(field: CheckinStage, value: string): UpdateApplicationBody {
  if (field === 'written') return { writtenNote: value }
  return field === 'interview' ? { interviewNote: value } : { defenseNote: value }
}

export function RecruitPage() {
  const admin = useRecruitAdmin()
  const [topView, setTopView] = useState<TopView>('flow')

  if (admin.loading && !admin.stats) {
    return (
      <div className="flex flex-col items-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-accent" />
        <p className="mt-3 text-sm text-muted-foreground">正在读取招新数据…</p>
      </div>
    )
  }

  if (admin.error) {
    return (
      <div className="mx-auto max-w-xl rounded-xl border border-border bg-card px-6 py-14 text-center">
        <h2 className="font-display text-xl font-bold">招新数据加载失败</h2>
        <p className="mt-3 text-sm text-muted-foreground">{admin.error}</p>
        <Button className="mt-6" onClick={admin.reload}>
          重试
        </Button>
      </div>
    )
  }

  // 归档完成：服务端已经回到休眠，这里把本届的总结与存档下载留在屏幕上
  if (admin.archive) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="rounded-2xl border border-border bg-card px-6 py-10 text-center">
          <CheckCircle2 className="mx-auto h-9 w-9 text-emerald-600" />
          <h1 className="mt-4 font-display text-2xl font-bold">本届招新已归档</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            名单 CSV 已存进对象存储，报名数据与发信日志已清空。下载完就回到休眠。
          </p>
          <div className="mx-auto mt-6 grid max-w-md gap-3 sm:grid-cols-2">
            <div className="rounded-lg border border-border px-4 py-3">
              <div className="text-2xl font-bold">{admin.archive.total}</div>
              <div className="text-xs text-muted-foreground">报名人数</div>
            </div>
            <div className="rounded-lg border border-border px-4 py-3">
              <div className="text-2xl font-bold">{admin.archive.members}</div>
              <div className="text-xs text-muted-foreground">最终转正</div>
            </div>
          </div>
          <Button className="mt-8 gap-2" onClick={() => admin.finishCycle(admin.archive!)}>
            <Download className="h-4 w-4" /> 下载名单 CSV，回到休眠
          </Button>
        </div>
      </div>
    )
  }

  // 休眠：整页只显示启动大屏（时间线、名单都不出现），但允许先点「设置」把
  // 本届名称与四个群号配好 —— 休眠期改了不影响任何流程，开启报名后第一封邀请函就是对的。
  if (admin.state === 'dormant') {
    if (topView === 'settings') {
      return (
        <div className="mx-auto max-w-5xl">
          <Button variant="ghost" className="mb-4 gap-1.5" onClick={() => setTopView('flow')}>
            <ArrowLeft className="h-4 w-4" /> 返回休眠页
          </Button>
          <RecruitSettingsView admin={admin} />
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-3xl">
        <div className="rounded-2xl border border-border bg-card px-8 py-20 text-center">
          <Moon className="mx-auto h-10 w-10 text-muted-foreground" />
          <h1 className="mt-6 font-display text-3xl font-bold">招新系统休眠中</h1>
          <p className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">
            当前没有任何进行中的招新周期，官网的报名入口处于关闭状态。
            点击下方按钮启动系统，开始一个新周期。
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button size="lg" className="gap-2" onClick={() => void admin.runAction('start_cycle')}>
              <ArrowRight className="h-4 w-4" /> {RECRUIT_ACTION_META.start_cycle.label}
            </Button>
            <Button size="lg" variant="outline" className="gap-2" onClick={() => setTopView('settings')}>
              <Settings2 className="h-4 w-4" /> 邮件模板与官网文案
            </Button>
          </div>
          <p className="mx-auto mt-6 max-w-md text-xs leading-relaxed text-muted-foreground">
            「设置」里是跨届通用的东西（八封邮件模板、官网招新文案），休眠期就能先备好；
            本届的名称与四个 QQ 群号属于流程，点「启动系统」后在流程页里填。
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      {/* ===== 顶层切换 ===== */}
      <div className="mb-5 flex flex-wrap items-center gap-1.5">
        {TOP_VIEWS.map((view) => (
          <button
            key={view.key}
            onClick={() => setTopView(view.key)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs transition-colors',
              topView === view.key
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border text-foreground/70 hover:bg-secondary',
            )}
          >
            {view.label}
            {view.key === 'mails' && admin.mails.length > 0 && (
              <span className="ml-1.5 rounded-full bg-accent/20 px-1.5 text-[10px] text-accent">
                {admin.mails.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {topView === 'roster' && <RecruitRosterView admin={admin} />}
      {topView === 'mails' && <RecruitMailView admin={admin} />}
      {topView === 'settings' && <RecruitSettingsView admin={admin} />}
      {topView === 'flow' && <FlowView admin={admin} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// 流程视图
// ---------------------------------------------------------------------------

function FlowView({ admin }: { admin: RecruitAdmin }) {
  const [view, setView] = useState<string>('')
  const [selection, setSelection] = useState<Set<string>>(new Set())
  const [threshold, setThreshold] = useState('')
  const [confirming, setConfirming] = useState<{ title: string; body: string; run: () => void } | null>(null)

  const current = admin.timelineKey
  const shown = view && view !== current ? view : current

  // 换阶段就把选择清空（勾的是「这一批晋级的人」，跨阶段留着只会误操作）。
  // 刻意不用 effect：在渲染期比对「上一次的阶段」，不一致就当场重置 —— 少一次级联渲染。
  const [selectionStage, setSelectionStage] = useState(admin.state)
  if (selectionStage !== admin.state) {
    setSelectionStage(admin.state)
    setSelection(new Set())
    setThreshold('')
  }

  const stageApps = (stage: RecruitStage) => admin.apps.filter((app) => app.stage === stage)
  const selectedIds = [...selection]

  /** 「下一步」按钮块：文案与说明都来自动作表，不在这里另写一套 */
  const actionCard = (action: RecruitAction, selected: string[] = [], extra = '') => {
    const meta = RECRUIT_ACTION_META[action]
    const reason = admin.blockedReason(action, selected.length)
    const tone = action === 'close_cycle' || action === 'reset_apply' ? 'danger' : 'go'
    return (
      <section
        className={cn(
          'rounded-xl border p-5',
          tone === 'danger' ? 'border-destructive/40 bg-destructive/5' : 'border-amber-500/40 bg-amber-500/5',
        )}
      >
        <h3 className="text-sm font-semibold">{meta.label}</h3>
        <p
          className={cn(
            'mt-1 text-[11px] leading-relaxed',
            tone === 'danger' ? 'text-destructive' : 'text-amber-700',
          )}
        >
          {meta.description}
          {reason ? `（${reason}）` : ''}
        </p>
        <Button
          className="mt-3 gap-1.5"
          variant={tone === 'danger' ? 'destructive' : 'default'}
          disabled={Boolean(reason)}
          onClick={() =>
            setConfirming({
              // 破坏性动作的二次确认要把「到底删掉什么」说清楚，不能只念一遍按钮说明
              title: meta.label,
              body: [
                meta.description,
                extra,
                selected.length > 0 ? `将处理勾选的 ${selected.length} 人。` : '',
              ]
                .filter(Boolean)
                .join('\n\n'),
              run: () => void admin.runAction(action, selected),
            })
          }
        >
          <ArrowRight className="h-4 w-4" /> {meta.label}
        </Button>
      </section>
    )
  }

  const panel = (
    title: string,
    hint: string,
    children: React.ReactNode,
    tone: 'ongoing' | 'after' = 'ongoing',
  ) => (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-[11px]',
            tone === 'ongoing' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-accent/15 text-accent',
          )}
        >
          {tone === 'ongoing' ? '进行中' : '结束后'}
        </span>
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      <div className="space-y-4 px-5 py-4">{children}</div>
    </section>
  )

  /**
   * 材料审核的进度条。
   *
   * 审核是「确认笔试名单」的前置（未通过的人进不了笔试），所以报名与「待确认名单」
   * 两块面板都要看得见 —— 不然管理员点确认时才会发现被拦，还得回头找人。
   */
  const materialBar = () => {
    const list = admin.apps.filter((app) => app.stage === 'apply')
    const pending = list.filter((app) => app.materialStatus === '').length
    const approved = list.filter((app) => app.materialStatus === 'approved').length
    const rejected = list.filter((app) => app.materialStatus === 'rejected').length
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-secondary/50 px-3 py-2 text-xs">
        <span className="font-medium">材料审核</span>
        <span className={pending > 0 ? 'text-amber-700' : 'text-muted-foreground'}>待审核 {pending}</span>
        <span className="text-emerald-700">已通过 {approved}</span>
        <span className={rejected > 0 ? 'text-destructive' : 'text-muted-foreground'}>已驳回 {rejected}</span>
        <span className="text-muted-foreground">
          在「名单」里逐个「通过 / 驳回」：驳回会发信让同学按理由改材料，改完自动回到待审核。
          <strong className="font-medium">没通过审核的人不能被勾选进笔试。</strong>
        </span>
      </div>
    )
  }

  /**
   * 「强制结束报名并清空数据」的确认文案：把此刻真要删掉的东西点清楚。
   * 这类动作最怕的是「以为只是关个开关」，所以宁可用数字说得啰嗦一点。
   */
  const resetInventory = () => {
    const files = admin.apps.filter((app) => app.fileUrl !== '').length
    return `本次将删除：${admin.apps.length} 条报名记录（姓名、学号、联系方式、成绩与评语）、${files} 个报名表文件、以及这些人的发信日志。`
  }

  /** 勾选工具：按分数线批量勾选（成绩在哪一列由阶段决定） */
  const selectionTools = (stage: RecruitStage) => {
    const field = examFieldOf(stage)
    return (
      <div className="flex flex-wrap items-center gap-2">
        {field && (
          <>
            <Input
              className="h-8 w-24"
              value={threshold}
              inputMode="decimal"
              placeholder="分数线"
              onChange={(event) => setThreshold(event.target.value)}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const value = parseScore(threshold)
                if (!Number.isFinite(value)) return toast.error('请先填分数线，如 60')
                const scoreKey = `${field}Score` as 'writtenScore' | 'interviewScore' | 'defenseScore'
                const picked = stageApps(stage).filter((app) => {
                  const score = parseScore(app[scoreKey])
                  return Number.isFinite(score) && score >= value
                })
                setSelection(new Set(picked.map((app) => app.id)))
                toast.success(`已勾选 ${picked.length} 人`, { description: `成绩不低于 ${value} 分的同学` })
              }}
            >
              勾选不低于该分数
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => setSelection(new Set(stageApps(stage).map((app) => app.id)))}>
          全选
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setSelection(new Set())}>
          清空
        </Button>
        <span className="text-[11px] text-muted-foreground">已勾选 {selection.size} 人</span>
      </div>
    )
  }

  const roster = (
    stage: RecruitStage,
    options: { checkbox?: boolean; editable?: boolean } = {},
  ) => {
    const list = stageApps(stage)
    const field = examFieldOf(stage)
    const scoreKey = field ? (`${field}Score` as 'writtenScore' | 'interviewScore' | 'defenseScore') : null
    const noteKey = field ? (`${field}Note` as 'writtenNote' | 'interviewNote' | 'defenseNote') : null
    const checkinKey = field ? (`${field}CheckinAt` as 'writtenCheckinAt' | 'interviewCheckinAt' | 'defenseCheckinAt') : null

    return (
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex items-center justify-between border-b border-border px-5 py-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {RECRUIT_STAGE_LABELS[stage]}阶段共{' '}
            <strong className="text-foreground">{list.length}</strong> 人
          </span>
          <span>要搜人 / 导出 / 批量处理，去「名单」视图</span>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              {options.checkbox && <TableHead className="w-12">勾选</TableHead>}
              <TableHead className="w-44">报名人</TableHead>
              <TableHead>联系方式</TableHead>
              <TableHead className="w-28">状态</TableHead>
              {field && <TableHead className="w-28">签到</TableHead>}
              {options.editable && scoreKey && <TableHead className="w-24">成绩</TableHead>}
              {options.editable && noteKey && <TableHead className="w-52">评语 / 备注</TableHead>}
              {current === 'apply' && <TableHead className="w-32" />}
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((app) => (
              <TableRow key={app.id}>
                {options.checkbox && (
                  <TableCell>
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-[hsl(var(--accent))]"
                      checked={selection.has(app.id)}
                      onChange={() =>
                        setSelection((prev) => {
                          const next = new Set(prev)
                          if (next.has(app.id)) next.delete(app.id)
                          else next.add(app.id)
                          return next
                        })
                      }
                      aria-label={`选择 ${app.name}`}
                    />
                  </TableCell>
                )}
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
                <TableCell className="text-xs text-muted-foreground">{app.email || '—'}</TableCell>
                <TableCell className="text-xs">{app.statusLabel}</TableCell>
                {field && checkinKey && (
                  <TableCell className="text-xs">
                    {app[checkinKey] ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Check className="h-3.5 w-3.5" /> 已签到
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 gap-1 text-xs"
                        onClick={() => void admin.bulk([app.id], 'checkin', { stage: field })}
                      >
                        <Check className="h-3 w-3" /> {app.result === 'absent' ? '补签（撤销缺考）' : '补签'}
                      </Button>
                    )}
                  </TableCell>
                )}
                {options.editable && scoreKey && field && (
                  <TableCell>
                    <CommitInput
                      className="h-8 w-20"
                      value={app[scoreKey]}
                      placeholder="如 78"
                      onCommit={(value) => void admin.updateApp(app.id, scoreBody(field, value))}
                    />
                  </TableCell>
                )}
                {options.editable && noteKey && field && (
                  <TableCell>
                    <CommitInput
                      className="h-8"
                      value={app[noteKey]}
                      placeholder={field === 'interview' ? '面试评语' : '阅卷备注'}
                      onCommit={(value) => void admin.updateApp(app.id, noteBody(field, value))}
                    />
                  </TableCell>
                )}
                {current === 'apply' && (
                  <TableCell className="text-right">
                    {app.result === '' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-destructive"
                        onClick={() => void admin.updateApp(app.id, { result: 'failed' })}
                      >
                        <Ban className="h-3.5 w-3.5" /> 未通过初筛
                      </Button>
                    )}
                  </TableCell>
                )}
              </TableRow>
            ))}
            {list.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-sm text-muted-foreground">
                  这个阶段还没有人
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    )
  }

  const stageBody = () => {
    // 「备招」节点 = **本届信息**（名称 + 四个 QQ 群号）：任何状态下都能点回来改。
    // 群号写错了必须能当场改，所以这里刻意不显示「已走过」的锁定页。
    if (shown === 'prepare') {
      return (
        <div className="space-y-4">
          <CycleInfoPanel admin={admin} />
          {admin.state === 'prepare' ? (
            actionCard('open_apply')
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              本届正在进行中（{admin.stateLabel}）：名称与群号随时可改，改完立即体现在之后发出的邀请函里。
              阶段推进请回「{labelOf(current)}」。
            </p>
          )}
        </div>
      )
    }

    if (shown !== current) {
      const isPast = TIMELINE.findIndex((node) => node.key === shown) < TIMELINE.findIndex((node) => node.key === current)
      return (
        <div className="rounded-xl border border-border bg-card px-6 py-14 text-center">
          <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-display text-xl font-bold">
            {isPast ? `「${labelOf(shown)}」已走过` : `「${labelOf(shown)}」还没到`}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {isPast ? '这一段已经结束，可在「名单」里回看每个人的走向。' : '按顺序走完前面的阶段后，这里会自动解锁。'}
          </p>
          <Button variant="outline" className="mt-5" onClick={() => setView('')}>
            回到当前阶段（{labelOf(current)}）
          </Button>
        </div>
      )
    }

    switch (admin.state) {
      // 没有 'prepare' 分支：备招节点已经被上面接管（任何状态都能查看 / 修改本届信息）
      case 'apply':
        return (
          <div className="space-y-4">
            {panel(
              '收报名表',
              '同学自助提交 / 替换；你在这里补录、审核与剔除',
              <>
                {materialBar()}
                <ManualEntryButton admin={admin} stage="apply" />
                {roster('apply')}
              </>,
            )}
            {actionCard('end_apply')}
            {/* 报名被刷屏、或本届配置搞错时的「推倒重来」：清掉这批表，回到备招重新收 */}
            {actionCard('reset_apply', [], resetInventory())}
          </div>
        )

      case 'apply_review':
        return (
          <div className="space-y-4">
            {panel(
              '确认笔试名单',
              RECRUIT_ACTION_META.confirm_written.description,
              <>
                {materialBar()}
                {selectionTools('apply')}
                {roster('apply', { checkbox: true })}
                {actionCard('confirm_written', selectedIds)}
              </>,
              'after',
            )}
            {/* 已经点了「结束报名」才发现这批表全是脏的 —— 这里也留一条退路 */}
            {actionCard('reset_apply', [], resetInventory())}
          </div>
        )

      case 'written':
        return (
          <div className="space-y-4">
            <QrCard admin={admin} stage="written" />
            {panel(
              '现场',
              '签到 / 补签 / 补录都在这里；此时看不到成绩入口 —— 还没结束笔试',
              <>
                <ManualEntryButton admin={admin} stage="written" />
                {roster('written')}
              </>,
            )}
            {actionCard('end_written')}
          </div>
        )

      case 'written_review':
        return (
          <div className="space-y-4">
            {panel(
              '标记缺考',
              '结束笔试时已自动处理；漏签的可以补签救回',
              <p className="text-xs text-muted-foreground">
                未签到 {stageApps('written').filter((app) => app.result === 'absent').length} 人已标记「缺考」。
                在下面的名单里点「补签」即可撤销缺考（人确实来过就不该被刷掉）。
              </p>,
              'after',
            )}
            {panel('录入笔试成绩', '名次自己看；漏签的也能在这里补签', roster('written', { editable: true }), 'after')}
            {panel(
              '生成面试名单',
              RECRUIT_ACTION_META.advance_written.description,
              <>
                {selectionTools('written')}
                {roster('written', { checkbox: true })}
                {actionCard('advance_written', selectedIds)}
              </>,
              'after',
            )}
          </div>
        )

      case 'interview':
        return (
          <div className="space-y-4">
            <QrCard admin={admin} stage="interview" />
            {panel('现场', '签到与补签（面试阶段没有补录 —— 补录只发生在笔试）', roster('interview'))}
            {actionCard('end_interview')}
          </div>
        )

      case 'interview_review':
        return (
          <div className="space-y-4">
            {panel('录入面试评语', '评语留给自己人看，不发给学生；漏签的也能在这里补签', roster('interview', { editable: true }), 'after')}
            {panel(
              '确认录取',
              RECRUIT_ACTION_META.advance_interview.description,
              <>
                {selectionTools('interview')}
                {roster('interview', { checkbox: true })}
                {actionCard('advance_interview', selectedIds)}
              </>,
              'after',
            )}
          </div>
        )

      case 'defense':
        return (
          <div className="space-y-4">
            {panel(
              '预备期',
              '这段没有要操作的：大家在项目里干活，答辩安排在预备成员群里通知',
              <p className="text-xs text-muted-foreground">预备期无事可做是正常状态 —— 不用反复刷新找按钮。</p>,
            )}
            <QrCard admin={admin} stage="defense" />
            {panel('现场', '答辩签到与补签', roster('defense'))}
            {actionCard('end_defense')}
          </div>
        )

      case 'defense_review':
        return (
          <div className="space-y-4">
            {panel('录入答辩成绩', '答辩成绩决定最终名单；漏签的也能在这里补签', roster('defense', { editable: true }), 'after')}
            {panel(
              '确认最终名单',
              RECRUIT_ACTION_META.advance_defense.description,
              <>
                {selectionTools('defense')}
                {roster('defense', { checkbox: true })}
                {actionCard('advance_defense', selectedIds)}
              </>,
              'after',
            )}
          </div>
        )

      default:
        return (
          <div className="space-y-4">
            {panel(
              '等本人确认',
              '同学点开邀请函里的链接、填完成员信息就自动进成员表；学生端不提供拒绝',
              <div className="space-y-2">
                {stageApps('onboard').map((app) => (
                  <div key={app.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium">{app.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {app.studentId} · {app.statusLabel}
                        {app.confirmedAt ? ` · 确认于 ${formatTime(app.confirmedAt)}` : ''}
                      </div>
                    </div>
                    {app.confirmedAt ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> 已确认加入
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1"
                        onClick={() => void admin.sendMail(app.id, 'offer')}
                      >
                        <Mail className="h-3.5 w-3.5" /> 催确认
                      </Button>
                    )}
                  </div>
                ))}
              </div>,
            )}
            {actionCard('close_cycle')}
          </div>
        )
    }
  }

  return (
    <>
      {/* ===== 顶部时间线 ===== */}
      <div className="mb-6 overflow-x-auto">
        <div className="flex min-w-max items-stretch gap-1">
          {TIMELINE.map((node, index) => {
            const nodeIndex = TIMELINE.findIndex((item) => item.key === current)
            const isCurrent = node.key === current
            const isPast = index < nodeIndex
            const isFuture = index > nodeIndex
            return (
              <button
                key={node.key}
                onClick={() => setView(node.key)}
                className={cn(
                  'min-w-28 flex-1 rounded-xl border px-3 py-2.5 text-left transition-colors',
                  isCurrent
                    ? 'border-transparent bg-primary text-primary-foreground'
                    : isPast
                      ? 'border-border bg-card hover:bg-secondary'
                      : 'border-dashed border-border text-muted-foreground',
                )}
              >
                <div className="flex items-center gap-1.5 text-sm font-semibold">
                  {isPast && <Check className="h-3.5 w-3.5 text-emerald-600" />}
                  {isFuture && <Lock className="h-3 w-3" />}
                  {node.label}
                  {isCurrent && <span className="rounded-full bg-primary-foreground/20 px-1.5 text-[10px]">当前</span>}
                </div>
                <div
                  className={cn(
                    'mt-0.5 text-[10px] leading-snug',
                    isCurrent ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {node.hint}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* ===== 摘要条 ===== */}
      <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-5 py-3 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Clock className="h-3.5 w-3.5 text-accent" /> 当前：{admin.stateLabel}
        </span>
        {(['apply', 'written', 'interview', 'defense', 'onboard'] as const).map((key) => (
          <span key={key} className="text-muted-foreground">
            {RECRUIT_STAGE_LABELS[key]} <strong className="text-foreground">{admin.stats?.funnel[key] ?? 0}</strong>
          </span>
        ))}
        <span className="text-muted-foreground">
          共 <strong className="text-foreground">{admin.stats?.total ?? 0}</strong> 人报名 · 已转正{' '}
          <strong className="text-foreground">{admin.stats?.members ?? 0}</strong>
        </span>
        <Button variant="ghost" size="sm" className="ml-auto gap-1 text-xs" onClick={() => setView('prepare')}>
          <Settings2 className="h-3.5 w-3.5" /> 本届信息
        </Button>
        <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={admin.reload}>
          <RotateCcw className="h-3.5 w-3.5" /> 刷新
        </Button>
      </div>

      {/* ===== 阶段标题 ===== */}
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold">
          {shown === 'prepare' ? '本届信息' : `${labelOf(shown)}阶段`}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {shown === 'prepare'
            ? '本届名称与四个 QQ 群号 —— 只属于这一届，下一届启动时重新填'
            : TIMELINE.find((node) => node.key === shown)?.hint}
        </p>
      </div>

      {stageBody()}

      <AlertDialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirming?.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line">{confirming?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>再想想</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                confirming?.run()
                setConfirming(null)
              }}
            >
              确认执行
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function labelOf(key: string): string {
  return TIMELINE.find((node) => node.key === key)?.label ?? key
}

/**
 * 本届信息：名称 + 四个 QQ 群号。
 *
 * 它属于**本届**（下一届要重新填），所以放在流程里而不是「设置」；
 * 任何状态下都能点时间线的「备招」节点回来改 —— 群号写错了得能当场改。
 * 保存后才落库（避免逐字打接口），且只在点了保存时才写。
 */
function CycleInfoPanel({ admin }: { admin: RecruitAdmin }) {
  const [name, setName] = useState(admin.cycle.name)
  const [groups, setGroups] = useState(admin.cycle.groups)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(admin.cycle.name)
    setGroups(admin.cycle.groups)
  }, [admin.cycle])

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">进行中</span>
        <h3 className="text-sm font-semibold">本届信息 · 名称与四个 QQ 群</h3>
        <span className="text-[11px] text-muted-foreground">
          只属于这一届；每封邀请函只引导进自己对应的那一个群
        </span>
      </div>
      <div className="space-y-4 px-5 py-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label className="text-xs">本届名称</Label>
            <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="如 2026 年秋季招新" />
          </div>
          {(Object.keys(RECRUIT_GROUP_LABELS) as RecruitGroupKey[]).map((key) => (
            <div key={key} className="grid gap-1.5">
              <Label className="text-xs">{RECRUIT_GROUP_LABELS[key]}群号</Label>
              <Input
                inputMode="numeric"
                value={groups[key]}
                placeholder="如 123456789"
                onChange={(event) => setGroups({ ...groups, [key]: event.target.value })}
              />
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={saving}
            onClick={async () => {
              setSaving(true)
              try {
                await admin.saveCycleInfo({ name: name.trim(), groups })
              } finally {
                setSaving(false)
              }
            }}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            保存名称与群号
          </Button>
          <span className="text-[11px] leading-relaxed text-muted-foreground">
            每封邀请函只引导进自己对应的那一个群；所有时间与地点安排都在 QQ 群里通知，邮件里不再出现。
          </span>
        </div>
      </div>
    </section>
  )
}

/**
 * 补录按钮 + 表单。
 * 报名阶段（apply）：不要求报名表，联系方式可以后补；
 * 笔试现场（written）：邮箱 / 手机 / QQ / 报名表都要给 —— 他跳过了报名，材料只能现场补齐。
 */
function ManualEntryButton({ admin, stage }: { admin: RecruitAdmin; stage: 'apply' | 'written' }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', studentId: '', email: '', phone: '', qq: '' })
  const [file, setFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)

  const walkIn = stage === 'written'
  // 报名表刻意不必填：现场常常真拿不到，之后在「名单 → 详情 · 改资料」里补就行
  const ready =
    form.name.trim() &&
    form.studentId.trim() &&
    (!walkIn || (form.email.trim() && form.phone.trim() && form.qq.trim()))

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" className="gap-1" onClick={() => setOpen(true)}>
          <UserPlus className="h-3.5 w-3.5" /> {walkIn ? '补录考生' : '补录未报名考生'}
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {walkIn
            ? '给没赶上报名但来考了的人：邮箱 / 手机 / QQ 必填，报名表可后补；录入即视为已参加（无需签到）。'
            : '补录的人会和官网报名的人一起进笔试名单；学号已经在名单里会被拦下。'}
        </span>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{walkIn ? '补录考生（笔试现场）' : '补录未报名考生'}</DialogTitle>
            <DialogDescription>
              {walkIn
                ? '邮箱 / 手机 / QQ 必填（后面发通知全靠它）；录入即视为已参加笔试，不会被缺考扫描误伤。材料没带齐也没关系，之后到「名单 → 详情 · 改资料」补齐即可。'
                : '人已经站在现场了：联系方式与报名表缺什么后补 —— 之后随时能在「名单 → 详情 · 改资料」里补或改。'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label className="text-xs">姓名 *</Label>
              <Input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">学号 *</Label>
              <Input value={form.studentId} onChange={(event) => setForm({ ...form, studentId: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">邮箱{walkIn ? ' *' : '（选填）'}</Label>
              <Input value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">手机{walkIn ? ' *' : '（选填）'}</Label>
              <Input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">QQ{walkIn ? ' *' : '（选填）'}</Label>
              <Input value={form.qq} onChange={(event) => setForm({ ...form, qq: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label className="text-xs">报名表（PDF / DOCX，可后补）</Label>
              <Input
                type="file"
                accept=".pdf,.docx"
                className="h-9 text-xs"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
              <p className="text-[11px] text-muted-foreground">
                手头有就传、没有就先空着 —— 之后在「名单 → 详情 · 改资料」里补上或替换。
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              className="gap-1.5"
              disabled={!ready || saving}
              onClick={async () => {
                setSaving(true)
                try {
                  await adminCreateApplication(
                    {
                      name: form.name.trim(),
                      studentId: form.studentId.trim(),
                      email: form.email.trim(),
                      phone: form.phone.trim(),
                      qq: form.qq.trim(),
                      stage,
                    },
                    file,
                  )
                  toast.success('已补录', {
                    description: walkIn
                      ? '录入即视为已参加笔试；缺的材料可以在「名单 → 详情 · 改资料」里补。'
                      : '确认名单时会和官网报名的人一起推进；资料缺什么都能在「名单 → 详情 · 改资料」里补。',
                  })
                  setForm({ name: '', studentId: '', email: '', phone: '', qq: '' })
                  setFile(null)
                  setOpen(false)
                  await admin.reload()
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : '补录失败')
                } finally {
                  setSaving(false)
                }
              }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} 确认补录
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/**
 * 签到二维码卡片：按阶段签发（重发自动作废旧码），展示时顺带给个复制地址的入口。
 * 二维码只绑阶段 —— 时间地点一律在对应的 QQ 群里说，码里不带任何安排信息。
 */
function QrCard({ admin, stage }: { admin: RecruitAdmin; stage: CheckinStage }) {
  const [ttl, setTtl] = useState('12')
  const code = admin.codes[stage]

  return (
    <section className="rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] text-emerald-700">进行中</span>
        <h3 className="text-sm font-semibold">{CHECKIN_STAGE_LABELS[stage]}签到二维码</h3>
        <span className="text-[11px] text-muted-foreground">考试开始前再生成即可，不会提前生成</span>
      </div>
      <div className="px-5 py-4">
        {code ? (
          <div className="flex flex-wrap items-center gap-4 rounded-lg bg-secondary/40 p-4">
            <div className="rounded-lg bg-white p-2">
              <QRCodeSVG value={code.url} size={128} level="M" />
            </div>
            <div className="min-w-0 flex-1 text-xs text-muted-foreground">
              有效至 <strong className="text-foreground">{formatTime(code.expiresAt)}</strong>
              <br />
              同学扫码进入签到页，填报名时的姓名 + 学号即可签到（只记「{CHECKIN_STAGE_LABELS[stage]}已到场」）。
              <br />
              <span className="break-all">{code.url}</span>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1"
              onClick={() => void admin.issueCode(stage, Number(ttl) || undefined)}
            >
              <RotateCcw className="h-3.5 w-3.5" /> 重新生成（旧码作废）
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1 text-destructive"
              onClick={() => void admin.revokeCode(stage)}
            >
              <Ban className="h-3.5 w-3.5" /> 作废
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input
              className="h-8 w-32"
              value={ttl}
              inputMode="numeric"
              placeholder="有效期（小时）"
              onChange={(event) => setTtl(event.target.value)}
            />
            <Button size="sm" className="gap-1" onClick={() => void admin.issueCode(stage, Number(ttl) || undefined)}>
              <QrCode className="h-3.5 w-3.5" /> 生成签到二维码
            </Button>
            <span className="text-[11px] text-muted-foreground">
              不提前生成；生成新码会自动作废旧码，同一阶段同时只有一张有效。
            </span>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * 失焦才提交的输入框：成绩与评语边填边改会很吵，
 * 所以本地先记着，失焦或回车时才写一次接口。
 */
function CommitInput({
  value,
  placeholder,
  className,
  onCommit,
}: {
  value: string
  placeholder?: string
  className?: string
  onCommit: (value: string) => void
}) {
  const [draft, setDraft] = useState(value)
  const [seen, setSeen] = useState(value)
  // 外部改了这个值（保存成功后的重新拉取、或别处改了同一条）就跟随；
  // 同样在渲染期比对，避免用 effect 触发级联渲染。
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }

  return (
    <Input
      className={className}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
      }}
    />
  )
}
