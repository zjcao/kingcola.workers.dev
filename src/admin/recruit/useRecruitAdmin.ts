/**
 * 招新后台的数据与动作（全部走真接口）。
 *
 * 一个 hook 管四件事，四个视图共用：
 *   1. 读：整届状态 + 名称 + 群号 + 模板、统计、全部报名记录、签到二维码、发信日志；
 *   2. 写：推进整届（`RECRUIT_ACTION_META` 里的动作）、改名与群号、改模板、
 *      签发/作废二维码、单人改动、批量、群发、删除；
 *   3. 派生：时间线节点、当前该显示的二维码阶段、可执行动作、下一步提示；
 *   4. 反馈：每个写操作都 toast 一句人话，然后整体重载（招新量级小，重载最省心也最不容易不一致）。
 *
 * 「关闭本届」是唯一有本地状态的写操作：服务端清库并回到休眠后，
 * 页面还要把存档入口留在屏幕上（`archive`），管理员下载完再回到休眠大屏。
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  actionBlockedReason,
  checkinStageOf,
  cycleTimelineKey,
  isReviewState,
  DEFAULT_RECRUIT_CYCLE,
  DEFAULT_RECRUIT_TEMPLATES,
  RECRUIT_ACTION_META,
  RECRUIT_STATE_LABELS,
  type CheckinStage,
  type MaterialStatus,
  type RecruitAction,
  type RecruitCheckinCodeMap,
  type RecruitCycleConfig,
  type RecruitCycleState,
  type RecruitMailKind,
  type RecruitQQGroups,
  type RecruitStats,
  type RecruitTemplates,
} from '@shared/recruit'
import { ApiError } from '@/api/client'
import {
  adminDeleteApplication,
  adminBulkApplications,
  adminGetRecruit,
  adminGetRecruitMails,
  adminGetRecruitStats,
  adminIssueCheckinCode,
  adminListApplications,
  adminListCheckinCodes,
  adminNotifyApplications,
  adminRevokeCheckinCode,
  adminRunRecruitAction,
  adminSaveRecruit,
  adminUpdateApplication,
  adminUploadApplicationDoc,
  type AdminApplication,
  type MailLogRow,
  type RunRecruitActionResult,
  type UpdateApplicationBody,
} from '@/api/endpoints'
import { downloadFile } from './recruit-ui'

const EMPTY_CODES: RecruitCheckinCodeMap = { written: null, interview: null, defense: null }

export interface ArchiveInfo {
  url: string
  total: number
  members: number
}

/** 动作执行后的汇总（就是接口返回的形态：含按钮名与「接下来做什么」） */
export type RecruitActionResultBundle = RunRecruitActionResult

function describeError(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback
}

/**
 * 动作结果 → 一句人话。
 *
 * 「清空报名」这类破坏性动作要把删掉的东西如实报出来（含**没删掉**的文件数），
 * 其余动作照旧报「改了几条 / 发了几封 / 接下来做什么」。
 */
function describeAction(result: RecruitActionResultBundle): string {
  if (result.cleaned) {
    return [
      `已删除 ${result.cleaned.applications} 条报名记录、${result.cleaned.files} 个报名表文件`,
      result.cleaned.filesFailed > 0
        ? `有 ${result.cleaned.filesFailed} 个文件没能删掉（对象存储不可用或已失联），建议到「对象存储」页确认`
        : '',
      '现在处于「备招」，可以重新「开启报名」从头收一批干净的表',
    ]
      .filter(Boolean)
      .join(' · ')
  }
  return [
    result.moved > 0 ? `${result.moved} 条记录已更新` : '',
    result.mail.summary || '没有需要发送的邮件',
    result.next ? `接下来：${result.next.label}` : '',
  ]
    .filter(Boolean)
    .join(' · ')
}

export function useRecruitAdmin() {
  const [cycle, setCycle] = useState<RecruitCycleConfig>(DEFAULT_RECRUIT_CYCLE)
  const [templates, setTemplates] = useState<RecruitTemplates>(DEFAULT_RECRUIT_TEMPLATES)
  const [unknownVariables, setUnknownVariables] = useState<Record<string, string[]>>({})
  const [stats, setStats] = useState<RecruitStats | null>(null)
  const [apps, setApps] = useState<AdminApplication[]>([])
  const [codes, setCodes] = useState<RecruitCheckinCodeMap>(EMPTY_CODES)
  const [mails, setMails] = useState<MailLogRow[]>([])
  const [archive, setArchive] = useState<ArchiveInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [settings, statsResult, list, codeMap, mailResult] = await Promise.all([
        adminGetRecruit(),
        adminGetRecruitStats(),
        adminListApplications({ limit: 2000 }),
        adminListCheckinCodes(),
        adminGetRecruitMails(200),
      ])
      setCycle(settings.cycle)
      setTemplates(settings.templates)
      setUnknownVariables(settings.unknownVariables)
      setStats(statsResult)
      setApps(list.items)
      setCodes(codeMap.codes)
      setMails(mailResult.logs)
      setError('')
    } catch (err) {
      setError(describeError(err, '招新数据加载失败，请刷新重试'))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // ----- 派生 -----

  const state: RecruitCycleState = cycle.state
  const timelineKey = cycleTimelineKey(state)
  const checkinStage = checkinStageOf(state)
  const review = isReviewState(state)

  /** 当前状态下能执行的动作（按钮就按它渲染，文案也用同一份） */
  const availableActions = useMemo(
    () => (Object.keys(RECRUIT_ACTION_META) as RecruitAction[]).filter((action) =>
      RECRUIT_ACTION_META[action].from.includes(state),
    ),
    [state],
  )

  const blockedReason = (action: RecruitAction, selected: number) =>
    actionBlockedReason(action, state, selected)

  // ----- 写操作 -----

  /** 推进整届。返回 null 表示被拒（toast 里已经说明原因） */
  const runAction = useCallback(
    async (action: RecruitAction, selectedIds: string[] = []): Promise<RecruitActionResultBundle | null> => {
      try {
        const result = await adminRunRecruitAction({ action, selectedIds })
        setArchive(result.archive ?? null)
        await load()
        toast.success(`${result.label}：已完成`, { description: describeAction(result) })
        return result
      } catch (err) {
        toast.error(describeError(err, '操作失败，请稍后重试'))
        return null
      }
    },
    [load],
  )

  /** 保存名称与群号（真实现：PUT /api/admin/recruit，state 不受影响） */
  const saveCycleInfo = useCallback(
    async (patch: { name?: string; groups?: RecruitQQGroups }) => {
      try {
        const saved = await adminSaveRecruit({ cycle: patch })
        setCycle(saved.cycle)
        toast.success('已保存', { description: '群号改动会立即体现在之后发出的邀请函里。' })
        return true
      } catch (err) {
        toast.error(describeError(err, '保存失败'))
        return false
      }
    },
    [],
  )

  /** 保存邮件模板（八条一起交，避免半套模板落在库里） */
  const saveTemplates = useCallback(
    async (next: RecruitTemplates) => {
      try {
        const saved = await adminSaveRecruit({ templates: next })
        setTemplates(saved.templates)
        toast.success('邮件模板已保存')
        return true
      } catch (err) {
        toast.error(describeError(err, '模板保存失败'))
        return false
      }
    },
    [],
  )

  /** 签发签到二维码：重发会自动作废该阶段旧码 */
  const issueCode = useCallback(
    async (stage: CheckinStage, ttlHours?: number) => {
      try {
        const result = await adminIssueCheckinCode(stage, ttlHours)
        await load()
        toast.success('签到二维码已生成', {
          description: `有效至 ${new Date(result.code.expiresAt).toLocaleString('zh-CN', { hour12: false })}；该阶段旧码已自动作废。`,
        })
        return true
      } catch (err) {
        toast.error(describeError(err, '生成失败'))
        return false
      }
    },
    [load],
  )

  const revokeCode = useCallback(
    async (stage: CheckinStage) => {
      try {
        const result = await adminRevokeCheckinCode(stage)
        await load()
        toast.success(`已作废 ${result.revoked} 张二维码`)
        return true
      } catch (err) {
        toast.error(describeError(err, '作废失败'))
        return false
      }
    },
    [load],
  )

  /** 单条改动：改阶段/结果/签到/成绩评语/补发某封信 */
  const updateApp = useCallback(
    async (id: string, body: UpdateApplicationBody) => {
      try {
        const result = await adminUpdateApplication(id, body)
        await load()
        if (result.mail) {
          toast[result.mail.sent ? 'success' : 'info'](result.mail.message)
        } else {
          toast.success('已保存')
        }
        return true
      } catch (err) {
        toast.error(describeError(err, '保存失败'))
        return false
      }
    },
    [load],
  )

  /** 后补 / 替换报名表（补录时没带材料、或本人换了版本） */
  const uploadDoc = useCallback(
    async (id: string, file: File) => {
      try {
        const result = await adminUploadApplicationDoc(id, file)
        await load()
        toast.success('报名表已更新', {
          description: `${result.application.fileName}（旧文件已删除）`,
        })
        return true
      } catch (err) {
        toast.error(describeError(err, '上传失败'))
        return false
      }
    },
    [load],
  )

  const deleteApp = useCallback(
    async (id: string, name: string) => {
      try {
        await adminDeleteApplication(id)
        await load()
        toast.success(`已删除 ${name} 的报名记录`, { description: '报名表文件一并删除，不可撤销。' })
        return true
      } catch (err) {
        toast.error(describeError(err, '删除失败'))
        return false
      }
    },
    [load],
  )

  /**
   * 单人材料审核。
   *
   * **驳回会自动发出一封「材料驳回通知」**（理由就是他改材料的依据），
   * 所以这里要把发信结果如实说出来 —— 管理员得知道信到底出去没有。
   */
  const reviewMaterial = useCallback(
    async (app: AdminApplication, status: MaterialStatus, reason = '') => {
      try {
        const result = await adminUpdateApplication(app.id, {
          material: status,
          materialReason: status === 'rejected' ? reason : undefined,
        })
        await load()
        if (status === 'rejected') {
          const mail = result.mail
          toast.success(`已驳回 ${app.name} 的材料`, {
            description: mail
              ? mail.sent
                ? `驳回通知已发到 ${mail.to}`
                : `驳回通知没发出去：${mail.message}（可在名单里补发）`
              : '信没有发出（模板被停用或本人没有邮箱）',
          })
        } else {
          toast.success(`已通过 ${app.name} 的材料`, {
            description: '他现在可以被勾选进笔试名单了。',
          })
        }
        return true
      } catch (err) {
        toast.error(describeError(err, '审核失败'))
        return false
      }
    },
    [load],
  )

  const bulk = useCallback(
    async (
      ids: string[],
      action: 'checkin' | 'absent' | 'withdraw' | 'approve_material' | 'reject_material',
      options: { stage?: CheckinStage; materialReason?: string } = {},
    ) => {
      try {
        const result = await adminBulkApplications({ ids, action, ...options })
        await load()
        if (action === 'approve_material') {
          toast.success(`已通过 ${result.moved} 人的材料`, {
            description: '只有通过审核的人才能被勾选进笔试名单。',
          })
          return true
        }
        if (action === 'reject_material') {
          toast.success(`已驳回 ${result.moved} 人的材料`, {
            description: `驳回通知：${result.mail?.summary || '没有发出（请检查邮件通道或模板开关）'}`,
          })
          return true
        }
        const label = action === 'checkin' ? '标记已签到' : action === 'absent' ? '标记未参加' : '退出报名'
        toast.success(`已${label} ${result.moved} 人`, {
          description: action === 'checkin' ? '人确实来过，缺考标记会一并撤销。' : '不发信。',
        })
        return true
      } catch (err) {
        toast.error(describeError(err, '批量操作失败'))
        return false
      }
    },
    [load],
  )

  /** 群发自定义通知 */
  const notify = useCallback(
    async (ids: string[], subject: string, body: string) => {
      try {
        const result = await adminNotifyApplications({ ids, subject, body })
        await load()
        toast.success(result.summary, { description: '邮件发出后无法撤回。' })
        return true
      } catch (err) {
        toast.error(describeError(err, '群发失败'))
        return false
      }
    },
    [load],
  )

  /** 补发某一封信（走单条改动的 notice 字段：状态不变也能发） */
  const sendMail = useCallback(
    async (id: string, kind: RecruitMailKind) => {
      return await updateApp(id, { notice: kind })
    },
    [updateApp],
  )

  /**
   * 下载归档 CSV 并回到休眠。
   * 服务端此时已经是休眠状态（关闭本届时就清了库），所以这里只是把文件交给浏览器，
   * 再重载一次让页面回到休眠大屏。
   */
  const finishCycle = useCallback(
    (info: ArchiveInfo) => {
      downloadFile(info.url, `招新名单-${new Date().toISOString().slice(0, 10)}.csv`)
      setArchive(null)
      void load()
      toast.success('归档已下载，系统回到休眠', { description: '要再招新就点「启动系统」开一个新周期。' })
    },
    [load],
  )

  return {
    // 数据
    cycle,
    templates,
    unknownVariables,
    stats,
    apps,
    codes,
    mails,
    archive,
    loading,
    error,
    reload: load,

    // 派生
    state,
    stateLabel: RECRUIT_STATE_LABELS[state],
    timelineKey,
    checkinStage,
    isReview: review,
    availableActions,
    blockedReason,

    // 写
    runAction,
    saveCycleInfo,
    saveTemplates,
    issueCode,
    revokeCode,
    updateApp,
    uploadDoc,
    reviewMaterial,
    deleteApp,
    bulk,
    notify,
    sendMail,
    finishCycle,
  }
}

export type RecruitAdmin = ReturnType<typeof useRecruitAdmin>
