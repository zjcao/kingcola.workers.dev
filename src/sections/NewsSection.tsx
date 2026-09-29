import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { NEWS_CATEGORIES, PAGE_PATHS, newsPath, type NewsItem } from '@/types'
import { cn } from '@/lib/utils'
import { ArrowLeft, Pin } from 'lucide-react'

export function NewsSection({ news }: { news: NewsItem[] }) {
  // 详情页是独立路径 /news/:id，刷新与分享链接都能直接落到某条新闻
  const { id } = useParams<{ id: string }>()
  const [category, setCategory] = useState<string>('全部')

  const sorted = useMemo(
    () =>
      [...news].sort((a, b) =>
        a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : b.date.localeCompare(a.date),
      ),
    [news],
  )
  const list = category === '全部' ? sorted : sorted.filter((n) => n.category === category)

  // ===== 新闻详情 =====
  if (id) {
    const selected = news.find((n) => n.id === id)
    if (!selected) {
      return (
        <div className="mx-auto max-w-3xl animate-fade-up px-4 py-24 text-center sm:px-6">
          <p className="text-sm text-muted-foreground">这条新闻不存在，可能已被删除或链接有误。</p>
          <Link
            to={PAGE_PATHS.news}
            className="mt-6 inline-flex items-center gap-1.5 text-sm text-accent hover:underline"
          >
            <ArrowLeft className="h-4 w-4" /> 返回新闻列表
          </Link>
        </div>
      )
    }

    return (
      <div className="mx-auto max-w-3xl animate-fade-up px-4 py-14 sm:px-6">
        <Link
          to={PAGE_PATHS.news}
          className="mb-8 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> 返回新闻列表
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
          <span className="rounded-full border border-border px-3 py-0.5 text-xs">{selected.category}</span>
          <span className="font-display">{selected.date}</span>
          {selected.pinned && (
            <span className="inline-flex items-center gap-1 text-xs text-accent">
              <Pin className="h-3 w-3" /> 置顶
            </span>
          )}
        </div>
        <h1 className="mt-4 font-display text-3xl font-bold leading-snug sm:text-4xl">{selected.title}</h1>
        <div className="mt-8 space-y-4 border-t border-border pt-8">
          {selected.content
            .split('\n')
            .filter(Boolean)
            .map((p, i) => (
              <p key={i} className="leading-loose text-foreground/85">
                {p}
              </p>
            ))}
          {!selected.content && <p className="text-muted-foreground">{selected.summary}</p>}
        </div>
      </div>
    )
  }

  // ===== 新闻列表 =====
  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-14 sm:px-6">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold sm:text-5xl">新闻动态</h1>
          <p className="mt-3 text-sm text-muted-foreground">共 {news.length} 条</p>
        </div>
      </div>

      {/* 分类筛选 */}
      <div className="mb-8 flex flex-wrap gap-2">
        {['全部', ...NEWS_CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cn(
              'rounded-full px-4 py-1.5 text-sm transition-colors',
              category === c
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground/70 hover:bg-secondary',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
          该分类下暂无新闻
        </div>
      ) : (
        <div>
          {list.map((n) => (
            <div key={n.id} className="group relative border-t border-border last:border-b">
              <Link
                to={newsPath(n.id)}
                className="flex w-full items-center gap-2.5 py-3.5 pl-2 text-left transition-colors hover:bg-secondary/60"
              >
                <span className="shrink-0 text-muted-foreground/60">•</span>
                <span className="shrink-0 font-display text-sm text-foreground/70">{n.date}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span className="rounded-full border border-border px-2.5 py-0.5 text-xs text-foreground/70">
                    【{n.category}】
                  </span>
                  {n.pinned && <Pin className="h-3.5 w-3.5 text-accent" />}
                </span>
                <span className="truncate font-medium leading-snug group-hover:text-accent">{n.title}</span>
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
