import { Link } from 'react-router'
import {
  PAGE_PATHS,
  newsPath,
  type Member,
  type NewsItem,
  type Project,
  type SiteConfig,
  type Slide,
} from '@/types'
import type { RecruitStatusInfo } from '@/api/endpoints'
import { parseStatLabels, splitParagraphs } from '@shared/site'
import { ArrowRight, ArrowUpRight, Award, Users, FolderKanban, UserCheck, Newspaper } from 'lucide-react'
import { HeroCarousel } from '@/sections/HeroCarousel'

const FALLBACK_STAT_LABELS = ['在组成员', '毕业成员', '工作室项目', '团队动态']

export function HomeSection({
  members,
  news,
  projects,
  slides,
  site,
  recruit,
}: {
  members: Member[]
  news: NewsItem[]
  projects: Project[]
  slides: Slide[]
  site: SiteConfig
  /** 招新状态（来自首屏聚合）；报名进行中才显示横幅 —— 笔试/面试期间的横幅只会误导人来报名 */
  recruit?: RecruitStatusInfo
}) {
  const currentCount = members.filter((m) => m.status === 'current').length
  const alumniCount = members.filter((m) => m.status === 'alumni').length
  const latestNews = [...news].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3)
  // 「精选项目」优先展示后台标记为精选的；一个都没标时退回最新的 3 个，避免整块空白
  const featuredProjects = projects.filter((p) => p.featured)
  const latestProjects = (
    featuredProjects.length > 0
      ? featuredProjects
      : [...projects].sort((a, b) => b.year.localeCompare(a.year))
  ).slice(0, 3)
  const statLabels = parseStatLabels(site.statLabels, FALLBACK_STAT_LABELS)

  return (
    <div className="animate-fade-up">
      {/* ===== 轮播图 ===== */}
      <HeroCarousel slides={slides} />

      {/* ===== 招新横幅：报名通道开着才出现（后台点「开启报名」即开） ===== */}
      {recruit?.applyOpen && (
        <section className="animate-fade-up bg-primary text-primary-foreground">
          <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-6 px-4 py-12 sm:flex-row sm:items-center sm:px-6">
            <div>
              <h2 className="font-display text-2xl font-bold sm:text-3xl">{site.recruitTitle}</h2>
              <p className="mt-2 max-w-xl text-sm leading-relaxed text-primary-foreground/75">
                {site.recruitDesc}
              </p>
            </div>
            <Link
              to={PAGE_PATHS.join}
              className="group inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-foreground px-6 py-2.5 text-sm font-medium text-primary transition-opacity hover:opacity-85"
            >
              立即报名
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          </div>
        </section>
      )}

      {/* ===== 最新动态 ===== */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 flex items-baseline justify-between">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">最新动态</h2>
            <Link
              to={PAGE_PATHS.news}
              className="group inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground"
            >
              全部新闻
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div>
            {latestNews.map((n) => (
              <Link
                key={n.id}
                to={newsPath(n.id)}
                className="group flex w-full items-center gap-2.5 border-t border-border py-3.5 pl-2 text-left transition-colors last:border-b hover:bg-secondary/60"
              >
                <span className="shrink-0 text-muted-foreground/60">•</span>
                <span className="shrink-0 font-display text-sm text-foreground/70">{n.date}</span>
                <span className="shrink-0 rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground/70">
                  【{n.category}】
                </span>
                <span className="truncate font-medium leading-snug group-hover:text-accent">
                  {n.title}
                </span>
              </Link>
            ))}
            {latestNews.length === 0 && (
              <div className="border-y border-border py-10 text-center text-sm text-muted-foreground">
                暂无新闻
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ===== 精选项目 ===== */}
      <section className="border-b border-border bg-secondary/40">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 flex items-baseline justify-between">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">精选项目</h2>
            <Link
              to={PAGE_PATHS.projects}
              className="group inline-flex items-center gap-1 text-sm text-foreground/70 hover:text-foreground"
            >
              全部项目
              <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </Link>
          </div>
          <div className="grid gap-6 sm:grid-cols-3">
            {latestProjects.map((p) => (
              <Link
                key={p.id}
                to={PAGE_PATHS.projects}
                className="flex flex-col rounded-2xl border border-border bg-card p-6 text-left transition-shadow hover:shadow-lg hover:shadow-black/5"
              >
                <span className="font-display text-sm text-muted-foreground">{p.year}</span>
                <h3 className="mt-3 font-display text-xl font-bold">{p.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-foreground/70">{p.tagline}</p>
                {p.honor && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-amber-700">
                    <Award className="mt-0.5 h-3 w-3 shrink-0" />
                    <span className="line-clamp-2">{p.honor}</span>
                  </p>
                )}
                <div className="mt-4 flex flex-1 flex-wrap items-start gap-1.5">
                  {p.tags.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-full bg-secondary px-2.5 py-0.5 text-xs text-foreground/70">
                      {t}
                    </span>
                  ))}
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ===== 工作室简介 ===== */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <div className="mb-10 flex items-baseline justify-between">
            <h2 className="font-display text-3xl font-bold sm:text-4xl">{site.aboutTitle}</h2>
            <span className="text-xs tracking-[0.3em] text-muted-foreground">ABOUT US</span>
          </div>
          <div className="grid gap-12 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-4 text-sm leading-loose text-foreground/80 sm:text-base">
              {splitParagraphs(site.aboutParagraphs).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border">
              {[
                { icon: Users, num: currentCount, label: statLabels[0] },
                { icon: UserCheck, num: alumniCount, label: statLabels[1] },
                { icon: FolderKanban, num: projects.length, label: statLabels[2] },
                { icon: Newspaper, num: news.length, label: statLabels[3] },
              ].map((stat) => (
                <div key={stat.label} className="bg-card p-6">
                  <stat.icon className="h-5 w-5 text-accent" />
                  <div className="mt-3 font-display text-4xl font-bold">{stat.num}</div>
                  <div className="mt-1 text-xs tracking-[0.2em] text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
