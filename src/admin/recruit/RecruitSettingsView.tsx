/**
 * 设置 —— **只放跨届通用的东西**：
 *
 *   ① 八封邮件的模板（写给所有届用的通用文案，靠 `{变量}` 逐人/逐届渲染）；
 *   ② 官网「招新与加入我们」的文案（首页横幅 + 加入我们页面）。
 *
 * **属于「本届」的东西一律不放这里** —— 本届名称、四个 QQ 群号、阶段推进、
 * 名单与签到二维码都在「流程」页（见 `RecruitPage` 的「本届信息」）。
 * 判据很简单：**下一届还要不要重新填一次？** 要，就是流程里的东西。
 *
 * 模板里没有任何时间与地点变量 —— 安排一律让同学看对应的 QQ 群；
 * 四个群号是「本届」的值，这里只**读取**它们用于预览（改在流程页）。
 * 未知变量由后端算好（`admin.unknownVariables`），前端不另判一套。
 */

import { useEffect, useState } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { AlertTriangle, Loader2, Save } from 'lucide-react'
import { toast } from 'sonner'
import {
  cycleMailVars,
  RECRUIT_MAIL_KINDS,
  RECRUIT_MAIL_META,
  RECRUIT_MAIL_VARIABLES,
  renderTemplate,
  type RecruitMailKind,
  type RecruitTemplates,
} from '@shared/recruit'
import type { SiteConfig } from '@shared/types'
import { adminGetConfig, adminUpdateConfig } from '@/api/endpoints'
import type { RecruitAdmin } from './useRecruitAdmin'

/**
 * 变量此刻的值：本届的取本价值（只读，改在流程页），逐人的给一句说明。
 * 没值就老实说「还没配置」——发信时它会保持原文（见 `renderTemplate`）。
 */
function variableValue(token: string, vars: Record<string, string>): { text: string; ready: boolean } {
  const key = token.slice(1, -1)
  if (key === 'name' || key === 'studentId') return { text: '逐人不同（按收信人渲染）', ready: true }
  if (key === 'inviteLink') return { text: '逐人签发，仅正式邀请函有值', ready: true }
  if (key === 'rejectReason') return { text: '驳回时由管理员逐次填写', ready: true }
  const value = (vars[key] ?? '').trim()
  return value ? { text: value, ready: true } : { text: '还没配置（发送时保持原文）', ready: false }
}

/** 「招新与加入我们」这一块改的是站点配置（与招新周期无关，休眠期也能改） */
type JoinCopy = Pick<
  SiteConfig,
  'recruitTitle' | 'recruitDesc' | 'joinTitle' | 'joinIntro' | 'joinSteps' | 'joinRequirements'
>

export function RecruitSettingsView({ admin }: { admin: RecruitAdmin }) {
  const [templates, setTemplates] = useState<RecruitTemplates>(admin.templates)
  const [active, setActive] = useState<RecruitMailKind>('written_invite')
  const [site, setSite] = useState<SiteConfig | null>(null)
  const [join, setJoin] = useState<JoinCopy | null>(null)
  const [saving, setSaving] = useState(false)

  // 别处（流程页）改过模板后跟着刷新
  useEffect(() => setTemplates(admin.templates), [admin.templates])

  useEffect(() => {
    adminGetConfig()
      .then((config) => {
        setSite(config.site)
        setJoin({
          recruitTitle: config.site.recruitTitle,
          recruitDesc: config.site.recruitDesc,
          joinTitle: config.site.joinTitle,
          joinIntro: config.site.joinIntro,
          joinSteps: config.site.joinSteps,
          joinRequirements: config.site.joinRequirements,
        })
      })
      .catch(() => toast.error('官网文案加载失败，稍后可重试'))
  }, [])

  const template = templates[active]
  const meta = RECRUIT_MAIL_META[active]
  const unknown = admin.unknownVariables[active] ?? []

  /**
   * 预览数据：只有「逐人不同」的姓名、学号与邀请链接用示例值；
   * 本届名称与四个群号**读本届的实际值**（在流程页改） —— 没填就保持 `{writtenGroup}` 原样
   * （`renderTemplate` 对未配置的招新变量不做替换），一眼能看出还差哪些没配。
   *
   * ⚠️ 本届变量必须走 `cycleMailVars()`：配置里是短名（`written`），模板里是 `{writtenGroup}`，
   * 直接铺 `...admin.cycle.groups` 会让**配好的群号也显示成「还没配置」**（发信侧却是好的）。
   */
  const previewVars: Record<string, string> = {
    name: '张同学',
    studentId: '2026001',
    ...cycleMailVars(admin.cycle),
    inviteLink: `${window.location.origin}/invite/abc123`,
    // 毕业去向填写链接：只有「毕业去向征集」用得上（由成员管理里的批量动作签发）
    destinationLink: `${window.location.origin}/graduate/abc123`,
    // 驳回理由本来就是「由管理员逐次填写」的，给个示例比显示「还没配置」有用
    rejectReason: '报名表缺成绩单页，请补齐后重新上传。',
    studio: site?.studioName ?? '',
    contactEmail: site?.contactEmail ?? '',
    contactAddress: site?.contactAddress ?? '',
  }

  const patchTemplate = (changes: Partial<RecruitTemplates[RecruitMailKind]>) =>
    setTemplates((prev) => ({ ...prev, [active]: { ...prev[active], ...changes } }))

  const saveAll = async () => {
    setSaving(true)
    try {
      await admin.saveTemplates(templates)
      if (join) {
        await adminUpdateConfig({ site: join })
        toast.success('官网文案已保存')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">设置</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            这里只有跨届通用的东西：八封邮件模板与官网招新文案。
            本届的名称、四个 QQ 群号、阶段推进与签到二维码都属于流程，在「流程」页里改。
          </p>
        </div>
        <Button className="gap-1.5" onClick={() => void saveAll()} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存全部设置
        </Button>
      </div>

      <Tabs defaultValue="mail">
        <TabsList>
          <TabsTrigger value="mail">邮件模板</TabsTrigger>
          <TabsTrigger value="join">官网招新文案</TabsTrigger>
        </TabsList>

        <TabsContent value="mail" className="mt-4">
          <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
            <div className="space-y-4">
              <div className="space-y-1">
                {RECRUIT_MAIL_KINDS.map((kind) => (
                  <button
                    key={kind}
                    onClick={() => setActive(kind)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2 text-left text-xs transition-colors',
                      active === kind
                        ? 'border-transparent bg-primary text-primary-foreground'
                        : 'border-border text-foreground/70 hover:bg-secondary',
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="truncate">{RECRUIT_MAIL_META[kind].label}</span>
                      {!templates[kind].enabled && (
                        <span
                          className={cn(
                            'ml-auto rounded px-1.5 text-[10px]',
                            active === kind ? 'bg-primary-foreground/20' : 'bg-secondary',
                          )}
                        >
                          已停用
                        </span>
                      )}
                    </div>
                    <div
                      className={cn(
                        'mt-0.5 text-[10px] leading-snug',
                        active === kind ? 'text-primary-foreground/70' : 'text-muted-foreground',
                      )}
                    >
                      {RECRUIT_MAIL_META[kind].trigger}
                    </div>
                  </button>
                ))}
              </div>

              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="mb-1 text-xs font-semibold">可用变量</h3>
                <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
                  本届的变量（名称、四个群号）在这里只读显示当前值 —— 改它们请去「流程 → 本届信息」。
                  没配置的值在发信时会保持原文，不会变成空白。
                </p>
                <ul className="space-y-1.5">
                  {RECRUIT_MAIL_VARIABLES.map((item) => {
                    const current = variableValue(item.token, previewVars)
                    return (
                      <li key={item.token} className="text-[11px]">
                        <div className="flex items-baseline gap-1.5">
                          <code className="shrink-0 text-foreground">{item.token}</code>
                          <span
                            className={cn(
                              'min-w-0 truncate',
                              current.ready ? 'text-muted-foreground' : 'text-amber-700',
                            )}
                          >
                            {current.text}
                          </span>
                        </div>
                        <div className="text-muted-foreground/80">{item.desc}</div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            </div>

            <div className="space-y-4">
              <div className="space-y-3 rounded-xl border border-border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-semibold">{meta.label}</h3>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      发给{meta.audience} · {meta.trigger}
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs">
                    <Switch
                      checked={template.enabled}
                      onCheckedChange={(checked) => patchTemplate({ enabled: checked })}
                    />
                    启用自动发送
                  </label>
                </div>

                <div className="grid gap-1.5">
                  <Label className="text-xs">主题</Label>
                  <Input
                    value={template.subject}
                    onChange={(event) => patchTemplate({ subject: event.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label className="text-xs">正文</Label>
                  <Textarea
                    rows={14}
                    value={template.body}
                    onChange={(event) => patchTemplate({ body: event.target.value })}
                  />
                </div>

                {unknown.length > 0 && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-700">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      这些变量系统不认识：{unknown.join('、')}。发信时会原样保留，请对照左侧变量清单检查拼写。
                    </span>
                  </div>
                )}

                {!template.enabled && (
                  <p className="text-[11px] text-muted-foreground">
                    这封信当前停用：状态照常流转，只是不发出这封信（日志里也不会出现）。
                  </p>
                )}
              </div>

              <div className="rounded-xl border border-border bg-card p-5">
                <h3 className="mb-3 text-xs font-semibold text-muted-foreground">预览（示例数据）</h3>
                <div className="rounded-lg bg-secondary/40 p-4">
                  <div className="text-sm font-medium">
                    {renderTemplate(template.subject, previewVars) || '（没有主题）'}
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                    {renderTemplate(template.body, previewVars)}
                  </pre>
                  <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
                    预览里的本届名称与四个群号取自「流程 → 本届信息」；还没填的会保持 {'{writtenGroup}'} 原文。
                  </p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="join" className="mt-4 space-y-4">
          <div className="rounded-xl border border-dashed border-border bg-secondary/30 px-5 py-4 text-[11px] leading-relaxed text-muted-foreground">
            本届名称与四个 QQ 群号属于「本届」（下一届要重新填），所以它们在
            <strong className="mx-1 text-foreground">流程 → 本届信息</strong>
            里改，不放在这里。这里只管跨届通用的邮件模板与官网文案。
          </div>

          {join && (
            <div className="grid gap-5 rounded-xl border border-border bg-card p-5">
              <div className="grid gap-1.5">
                <Label className="text-xs">首页招新横幅标题</Label>
                <Input
                  value={join.recruitTitle}
                  onChange={(event) => setJoin({ ...join, recruitTitle: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">首页招新横幅描述</Label>
                <Textarea
                  rows={2}
                  value={join.recruitDesc}
                  onChange={(event) => setJoin({ ...join, recruitDesc: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">「加入我们」页面标题</Label>
                <Input
                  value={join.joinTitle}
                  onChange={(event) => setJoin({ ...join, joinTitle: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">「加入我们」页面描述</Label>
                <Textarea
                  rows={2}
                  value={join.joinIntro}
                  onChange={(event) => setJoin({ ...join, joinIntro: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">招新流程（每行一条「标题 | 描述」）</Label>
                <Textarea
                  rows={4}
                  value={join.joinSteps}
                  onChange={(event) => setJoin({ ...join, joinSteps: event.target.value })}
                />
              </div>
              <div className="grid gap-1.5">
                <Label className="text-xs">对报名者的期望（每行一条）</Label>
                <Textarea
                  rows={3}
                  value={join.joinRequirements}
                  onChange={(event) => setJoin({ ...join, joinRequirements: event.target.value })}
                />
              </div>
              <p className="text-[11px] text-muted-foreground">
                同时驱动首页招新横幅与「加入我们」页面（横幅只在报名通道开着时显示）。改完记得点右上角「保存全部设置」。
              </p>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
