import {
  applicationLabel,
  applicationTone,
  isApplicationFinished,
  MATERIAL_STATUS_LABELS,
  RECRUIT_STAGES,
  RECRUIT_STAGE_LABELS,
  stageIndex,
  type MaterialStatus,
  type RecruitTone,
} from '@shared/recruit'
import type { Application } from '@shared/types'
import { cn } from '@/lib/utils'
import { ArrowRight, Check, CircleDot, FileText, Users, X } from 'lucide-react'

/** ISO 或北京时间字符串 → 展示用（统一按北京时间口径解） */
function formatMoment(value: string): string {
  const raw = (value ?? '').trim()
  if (!raw) return ''
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2}))?/.exec(raw)
  if (match) {
    const [, y, m, d, h, min] = match
    return h ? `${y}-${m}-${d} ${h}:${min}` : `${y}-${m}-${d}`
  }
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  // 入库的 ISO（审计时间等）按 UTC+8 展示
  const shifted = new Date(parsed.getTime() + 8 * 3600 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(
    shifted.getUTCDate(),
  )} ${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`
}

/** 材料审核状态的配色：与后台名单里的徽标保持一致（灰 / 绿 / 红） */
const MATERIAL_TONE: Record<MaterialStatus, string> = {
  '': 'bg-secondary text-muted-foreground',
  approved: 'bg-emerald-500/10 text-emerald-700',
  rejected: 'bg-destructive/10 text-destructive',
}

const TONE_STYLES: Record<RecruitTone, string> = {
  pending: 'bg-secondary text-foreground',
  active: 'bg-accent/15 text-accent',
  passed: 'bg-emerald-500/10 text-emerald-700',
  done: 'bg-emerald-500/15 text-emerald-700',
  failed: 'bg-destructive/10 text-destructive',
}

/** 各阶段的签到时间（学生自己做过的事，可以给他看） */
function checkinAtOf(application: Application, stage: string): string {
  if (stage === 'written') return application.writtenCheckinAt
  if (stage === 'interview') return application.interviewCheckinAt
  if (stage === 'defense') return application.defenseCheckinAt
  return ''
}

/**
 * 报名进度：五段进度条 + 当前状态 + 该进的群 + 我的时间线。
 *
 * 状态的中文名与阶段划分全部来自 `@shared/recruit`，前台不重复维护一份。
 * **刻意不展示任何时间地点**：安排一律通过对应的 QQ 群通知（还有邮件），
 * 所以这里只告诉他「现在该进哪个群」，而不是把可能已经改期的信息钉在页面上。
 */
export function ApplicationProgress({
  application,
  groupLabel,
  group,
  inviteUrl,
}: {
  application: Application
  /** 此刻该进的群（报名阶段还没有群，两个字段都是空串） */
  groupLabel: string
  group: string
  /** 已发出邀请函时的确认页地址 */
  inviteUrl?: string
}) {
  const tone = applicationTone(application.stage, application.result)
  const label = applicationLabel(application.stage, application.result)
  const currentStage = stageIndex(application.stage)
  const finished = isApplicationFinished(application.stage, application.result)
  const failed = tone === 'failed'

  const timeline = [
    { label: '提交报名', value: application.createdAt ?? '' },
    { label: '笔试签到', value: application.writtenCheckinAt },
    { label: '面试签到', value: application.interviewCheckinAt },
    { label: '答辩签到', value: application.defenseCheckinAt },
    { label: '邀请函发出', value: application.invitedAt },
    { label: '确认加入', value: application.confirmedAt },
  ].filter((item) => item.value.trim())

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-bold">我的报名进度</h2>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-3 py-1 text-xs text-emerald-700">
          <Check className="h-3.5 w-3.5" /> 已登录
        </span>
      </div>

      {/* 当前状态 */}
      <div className="mt-5 rounded-2xl border border-border bg-secondary/40 p-5">
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium',
              TONE_STYLES[tone],
            )}
          >
            {failed ? <X className="h-3.5 w-3.5" /> : <CircleDot className="h-3.5 w-3.5" />}
            {label}
          </span>
          <span className="text-xs text-muted-foreground">
            {application.name} · {application.studentId}
          </span>
        </div>

        {/* 材料审核状态：报名阶段同学最关心的就是这个（只在报名阶段显示） */}
        {application.stage === 'apply' && (
          <div className="mt-3 rounded-xl bg-background/60 px-3 py-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">材料审核</span>
              <span
                className={cn('rounded-full px-2 py-0.5 font-medium', MATERIAL_TONE[application.materialStatus])}
              >
                {MATERIAL_STATUS_LABELS[application.materialStatus]}
              </span>
            </div>
            {application.materialStatus === 'rejected' ? (
              <p className="mt-1 leading-relaxed text-destructive">
                驳回理由：{application.materialReason || '（管理员未填写理由）'}
              </p>
            ) : (
              <p className="mt-1 text-muted-foreground">
                {application.materialStatus === 'approved'
                  ? '材料没问题，审核已经通过。'
                  : '我们已经收到你的材料，正在审核中。'}
              </p>
            )}
          </div>
        )}

        {group && groupLabel ? (
          <div className="mt-3 space-y-1 text-sm text-foreground/80">
            <div className="flex flex-wrap items-center gap-2">
              <Users className="h-4 w-4 shrink-0 text-accent" />
              <span className="font-medium">{groupLabel}</span>
              <span className="font-mono">{group}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              具体时间与地点都在群里通知，请尽快加群并留意群公告。
            </p>
          </div>
        ) : (
          <p className="mt-3 text-xs text-muted-foreground">
            {finished ? '' : '下一步的安排会通过邮件与对应的 QQ 群通知你。'}
          </p>
        )}
      </div>

      {/* 五段进度 */}
      <ol className="mt-6">
        {RECRUIT_STAGES.map((stage, index) => {
          const stepFailed = failed && index === currentStage
          const done = index < currentStage || (index === currentStage && tone === 'passed')
          const current = index === currentStage
          const checkin = checkinAtOf(application, stage)
          return (
            <li
              key={stage}
              className="grid grid-cols-[1.75rem_1fr] items-center gap-3 border-t border-border py-3 last:border-b"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium',
                  stepFailed
                    ? 'bg-destructive/10 text-destructive'
                    : done
                      ? 'bg-emerald-500/15 text-emerald-700'
                      : current
                        ? 'bg-accent text-accent-foreground'
                        : 'bg-secondary text-muted-foreground',
                )}
              >
                {stepFailed ? (
                  <X className="h-3.5 w-3.5" />
                ) : done ? (
                  <Check className="h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span
                className={cn(
                  'flex flex-wrap items-baseline gap-2 text-sm',
                  current ? 'font-medium' : done ? 'text-foreground/75' : 'text-muted-foreground',
                )}
              >
                {RECRUIT_STAGE_LABELS[stage]}
                {checkin && (
                  <span className="text-xs text-emerald-700">已签到 {formatMoment(checkin)}</span>
                )}
              </span>
            </li>
          )
        })}
      </ol>

      {/* 我的时间线 */}
      {timeline.length > 0 && (
        <div className="mt-6 space-y-2 text-xs text-muted-foreground">
          {timeline.map((item) => (
            <div key={item.label} className="flex items-center gap-2">
              <span className="w-20 shrink-0">{item.label}</span>
              <span className="text-foreground/75">{formatMoment(item.value)}</span>
            </div>
          ))}
        </div>
      )}

      {/* 邀请函入口 */}
      {inviteUrl && (
        <a
          href={inviteUrl}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
        >
          填写成员信息并确认加入 <ArrowRight className="h-4 w-4" />
        </a>
      )}

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        {finished
          ? tone === 'done'
            ? '欢迎加入工作室！后续通知会发到你的邮箱。'
            : '本次招新到这里就结束了。感谢你的参与，欢迎关注我们后续的公开活动。'
          : '进度会随笔试、面试、答辩的推进自动更新；重要的安排会同时发到你的邮箱与对应的 QQ 群。'}
      </p>
    </div>
  )
}
