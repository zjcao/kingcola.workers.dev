import { useMemo, useState } from 'react'
import { type Project } from '@/types'
import { cn } from '@/lib/utils'
import { ArrowUpRight, Award, ChevronDown, Star } from 'lucide-react'

/** 年份分界线：两侧细线，中间大年份数字（与成员页一致） */
function YearDivider({ year }: { year: string }) {
  return (
    <div className="my-14 flex items-center gap-6 sm:gap-10">
      <div className="h-px flex-1 bg-border" />
      <span className="font-display text-5xl font-bold text-foreground/85 sm:text-6xl">{year}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/** 折叠状态下最多展示的荣誉条数（超过这个数才出现展开三角） */
const HONOR_COLLAPSED_COUNT = 2

/** 荣誉是一条「；」分隔的长文本（见 shared/resources.ts 的 hint），这里拆成一条条：去空、去重 */
function splitHonors(honor: string): string[] {
  const items = honor
    .split(/[；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
  return Array.from(new Set(items))
}

/**
 * 荣誉块：逐条隔断展示。
 * 条数超过 HONOR_COLLAPSED_COUNT 时默认只显示前几条，用下三角展开 / 收起。
 * 注意：卡片是 grid item（默认 stretch），展开会把**同一行**的卡片一起撑高 —— 这是刻意保留的
 * 「同行等高、底部对齐」行为，别改成 items-start。
 */
function HonorList({ honor }: { honor: string }) {
  const [expanded, setExpanded] = useState(false)
  const items = useMemo(() => splitHonors(honor), [honor])
  if (items.length === 0) return null

  const collapsible = items.length > HONOR_COLLAPSED_COUNT
  const visible = collapsible && !expanded ? items.slice(0, HONOR_COLLAPSED_COUNT) : items

  return (
    <div className="mt-4 rounded-xl bg-amber-500/5 px-3 py-2 text-xs leading-relaxed text-amber-700">
      <div className="flex items-start gap-2">
        <Award className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <div className="min-w-0 flex-1 divide-y divide-amber-500/15">
          {visible.map((item) => (
            <p key={item} className="py-1 first:pt-0">
              {item}
            </p>
          ))}
        </div>
      </div>
      {collapsible && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          className="mt-1 flex w-full items-center justify-center gap-1 border-t border-amber-500/15 pt-1.5 text-[11px] text-amber-700/80 transition-colors hover:text-amber-800"
        >
          {expanded ? '收起' : `展开全部 ${items.length} 项`}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
        </button>
      )}
    </div>
  )
}

export function ProjectsSection({ projects }: { projects: Project[] }) {
  // 按年份分组，新项目在前；同年内保持接口给出的顺序（精选在前）
  const yearGroups = useMemo(
    () =>
      Array.from(
        new Map<string, Project[]>(
          [...projects]
            .sort((a, b) => b.year.localeCompare(a.year))
            .reduce((map, p) => {
              const key = p.year || '未知'
              if (!map.has(key)) map.set(key, [])
              map.get(key)!.push(p)
              return map
            }, new Map<string, Project[]>()),
        ),
      ),
    [projects],
  )

  const featuredCount = projects.filter((p) => p.featured).length

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-14 sm:px-6">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold sm:text-5xl">项目介绍</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            工作室的真实项目，涵盖 Web、移动应用与 AI 系统
            {featuredCount > 0 && ` · 其中 ${featuredCount} 个精选`}
          </p>
        </div>
      </div>

      {yearGroups.length === 0 ? (
        <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
          暂无项目
        </div>
      ) : (
        <div>
          {yearGroups.map(([year, group]) => (
            <section key={year}>
              <YearDivider year={year} />
              <div className="grid gap-6 sm:grid-cols-2">
                {group.map((p) => (
                  <div
                    key={p.id}
                    className="group relative flex flex-col rounded-2xl border border-border bg-card p-6 transition-shadow hover:shadow-lg hover:shadow-black/5 sm:p-7"
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-display text-sm text-muted-foreground">{p.year}</span>
                      {p.featured && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-accent/10 px-2 py-0.5 text-[11px] text-accent">
                          <Star className="h-3 w-3" /> 精选
                        </span>
                      )}
                    </div>
                    <h3 className="mt-4 font-display text-2xl font-bold">{p.name}</h3>
                    <p className="mt-1 text-sm font-medium text-accent">{p.tagline}</p>
                    <p className="mt-3 flex-1 text-sm leading-relaxed text-foreground/75">{p.description}</p>
                    <HonorList honor={p.honor ?? ''} />
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      {p.tags.map((t) => (
                        <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-foreground/70">
                          {t}
                        </span>
                      ))}
                    </div>
                    {p.link && (
                      <a
                        href={p.link}
                        target="_blank"
                        rel="noreferrer"
                        className="group/link mt-4 flex items-center justify-between gap-2 border-t border-border pt-3 text-xs font-medium text-accent transition-colors hover:text-accent/80"
                      >
                        点击跳转到项目仓库
                        <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover/link:-translate-y-0.5 group-hover/link:translate-x-0.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
