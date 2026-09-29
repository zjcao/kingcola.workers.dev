import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { adminGraduateMembers } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { Loader2, Mail, PartyPopper, Send } from 'lucide-react'
import { toast } from 'sonner'

type Entity = Record<string, unknown>

/**
 * 「到了说再见的时候了」——毕业向导（成员专用）。
 *
 * 为什么单独做两步向导，而不是复用通用的批量确认框：
 * 毕业是**一届一届**发生的，最自然的默认就是「把最晚那一届全体勾上」，
 * 而不是让管理员自己去列表里一个个点；寄信又是发了就收不回的动作，值得单独一屏确认。
 *
 *   第 1 步：选人（默认勾好最晚一届，可改）
 *   第 2 步：确认这一届 + 决定是否寄「毕业去向征集」信
 *   第 3 步：结果（成功后才切过来，避免「点了没反应」）
 *
 * 只改状态，不记「毕业年份」——届别就是**加入年份**（`joinYear`），
 * 所以第 1 步按加入年份分届，第 2 步把这几届回显一遍就够了。
 */
export function GraduateWizard({
  items,
  onClose,
  onFinished,
}: {
  /** 成员列表（含在组与已毕业，本组件自己只用「在组」的） */
  items: Entity[]
  onClose: () => void
  /** 成功之后收尾：刷新列表（由调用方提供） */
  onFinished: () => void | Promise<void>
}) {
  /** 「在组」按加入年份分届，从新到旧；没填年份的归到「未知」并排最后 */
  const cohorts = useMemo(() => {
    const map = new Map<string, Entity[]>()
    for (const item of items) {
      if (String(item.status) !== 'current') continue
      const year = String(item.joinYear ?? '').trim() || '未知'
      const group = map.get(year)
      if (group) group.push(item)
      else map.set(year, [item])
    }
    return [...map.entries()].sort((a, b) => {
      if (a[0] === '未知') return 1
      if (b[0] === '未知') return -1
      return Number(b[0]) - Number(a[0])
    })
  }, [items])

  const latest = cohorts[0]
  const [selected, setSelected] = useState<string[]>(
    () => latest?.[1].map((item) => String(item.id)) ?? [],
  )
  const [step, setStep] = useState<1 | 2 | 3>(1)
  const [sendMail, setSendMail] = useState(true)
  const [running, setRunning] = useState(false)
  const [summary, setSummary] = useState('')

  const toggleOne = (id: string, next: boolean) =>
    setSelected((prev) => (next ? [...prev, id] : prev.filter((item) => item !== id)))

  const toggleCohort = (ids: string[], next: boolean) =>
    setSelected((prev) =>
      next ? [...new Set([...prev, ...ids])] : prev.filter((id) => !ids.includes(id)),
    )

  /** 选中的人属于哪几届（按加入年份，从新到旧）—— 第一步就是按届勾的，第二步回显一下更安心 */
  const selectedCohorts = useMemo(() => {
    const years = new Set<string>()
    for (const item of items) {
      if (selected.includes(String(item.id))) {
        years.add(String(item.joinYear ?? '').trim() || '未知')
      }
    }
    return [...years].sort((a, b) => {
      if (a === '未知') return 1
      if (b === '未知') return -1
      return Number(b) - Number(a)
    })
  }, [items, selected])

  /** 勾了但没填邮箱的人数 —— 寄信时会跳过他们，提前说清楚比事后报数强 */
  const noEmailCount = useMemo(
    () =>
      items.filter(
        (item) => selected.includes(String(item.id)) && !String(item.email ?? '').trim(),
      ).length,
    [items, selected],
  )

  const run = async () => {
    setRunning(true)
    try {
      const result = await adminGraduateMembers(selected, sendMail)
      setSummary(result.message)
      await onFinished()
      setStep(3)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '操作失败，请稍后重试')
    } finally {
      setRunning(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !running && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {step === 1 && '哪一届要毕业了？'}
            {step === 2 && '寄一封信，问问他们去哪儿了'}
            {step === 3 && '送走了'}
          </DialogTitle>
        </DialogHeader>

        {step === 1 && (
          <>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {latest
                ? `已经替你勾好最晚的一届（${latest[0]} 届 · ${latest[1].length} 人），可以再改。`
                : '「在组」里还没有人。'}
            </p>

            <div className="max-h-[46vh] space-y-3 overflow-y-auto py-1">
              {cohorts.map(([cohortYear, group]) => {
                const ids = group.map((item) => String(item.id))
                return (
                  <div key={cohortYear} className="overflow-hidden rounded-lg border border-border">
                    <label className="flex cursor-pointer items-center gap-2.5 border-b border-border bg-secondary/40 px-3 py-2 text-sm font-medium">
                      <Checkbox
                        checked={ids.length > 0 && ids.every((id) => selected.includes(id))}
                        onCheckedChange={(checked) => toggleCohort(ids, checked === true)}
                      />
                      {cohortYear} 届
                      <span className="text-xs font-normal text-muted-foreground">{group.length} 人</span>
                    </label>
                    <ul>
                      {group.map((item) => (
                        <li key={String(item.id)} className="border-b border-border last:border-b-0">
                          <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm">
                            <Checkbox
                              checked={selected.includes(String(item.id))}
                              onCheckedChange={(checked) => toggleOne(String(item.id), checked === true)}
                            />
                            <span>{String(item.name ?? '')}</span>
                            <span className="text-xs text-muted-foreground">{String(item.title ?? '')}</span>
                            {!String(item.email ?? '').trim() && (
                              <span className="ml-auto text-[11px] text-muted-foreground">没填邮箱</span>
                            )}
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {step === 2 && (
          <div className="grid gap-4 py-1">
            <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-sm leading-relaxed">
              即将送走 <strong className="text-foreground">{selected.length}</strong> 位同学
              （{selectedCohorts.join(' + ')} 届）。他们会被记成「已毕业」，届别就是加入年份。
            </div>

            <label className="flex items-start gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm">
              <Checkbox
                checked={sendMail}
                onCheckedChange={(checked) => setSendMail(checked === true)}
                className="mt-0.5"
              />
              <span>
                同时寄出「毕业去向征集」信
                <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                  信里带一条专属链接，同学点开填一句话就写进成员档案。没填邮箱的会被跳过
                  {noEmailCount > 0 ? `（这次有 ${noEmailCount} 位没邮箱）` : ''}。
                  模板在「招新 → 设置 → 邮件模板」里改。
                </span>
              </span>
            </label>
          </div>
        )}

        {step === 3 && (
          <div className="py-3 text-center">
            <PartyPopper className="mx-auto h-10 w-10 text-accent" />
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">{summary}</p>
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              他们现在在「已毕业」页签里。等本人填完去向，成员卡片上就会显示出来。
            </p>
          </div>
        )}

        <DialogFooter>
          {step === 1 && (
            <>
              <Button variant="outline" onClick={onClose}>
                先不送了
              </Button>
              <Button
                className="gap-1.5"
                disabled={selected.length === 0}
                onClick={() => setStep(2)}
              >
                下一步 <Send className="h-3.5 w-3.5" />
              </Button>
            </>
          )}

          {step === 2 && (
            <>
              <Button variant="outline" disabled={running} onClick={() => setStep(1)}>
                上一步
              </Button>
              <Button className="gap-1.5" disabled={running} onClick={() => void run()}>
                {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                {sendMail ? '寄出这封信，祝他们前程似锦' : '就到这儿，送他们毕业'}
              </Button>
            </>
          )}

          {step === 3 && <Button onClick={onClose}>完成</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
