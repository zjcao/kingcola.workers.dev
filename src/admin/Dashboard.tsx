import { useState } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import { RESOURCES, RESOURCE_KEYS } from '@shared/resources'
import { useAsync } from '@/api/hooks'
import { adminSeedContent, adminStats } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { toast } from 'sonner'
import { AlertTriangle, ArrowUpRight, DatabaseZap } from 'lucide-react'

export function Dashboard() {
  const stats = useAsync(() => adminStats())
  const [seeding, setSeeding] = useState(false)

  const seed = async () => {
    setSeeding(true)
    try {
      const response = await adminSeedContent()
      const inserted = Object.entries(response.result)
        .map(([key, value]) => `${RESOURCES[key as keyof typeof RESOURCES]?.label ?? key}: ${value}`)
        .join('，')
      toast.success('初始化完成', { description: inserted })
      stats.reload()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '初始化失败')
    } finally {
      setSeeding(false)
    }
  }

  const counts = stats.data?.counts

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold">概览</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          官网内容一改即生效（公开接口缓存 30 秒），所有改动都会记入操作日志
        </p>
      </div>

      {stats.error && (
        <div className="mb-4 flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700">
          <AlertTriangle className="h-4 w-4" /> {stats.error}
          <button onClick={stats.reload} className="ml-auto underline underline-offset-2">
            重试
          </button>
        </div>
      )}

      {/* 统计卡片 */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {RESOURCE_KEYS.map((key) => (
          <Link
            key={key}
            to={`/admin/content/${key}`}
            className="group rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-lg hover:shadow-black/5"
          >
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              {RESOURCES[key].label}
              <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </div>
            <div className="mt-3 font-display text-4xl font-bold">
              {counts ? counts[key] : stats.loading ? '—' : 0}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">条记录</div>
          </Link>
        ))}
      </div>

      {/* 快捷操作 */}
      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-bold">最近发布的新闻</h2>
          <div className="mt-3">
            {(stats.data?.recentNews ?? []).map((n) => (
              <Link
                key={n.id}
                to="/admin/content/news"
                className="flex items-center gap-2 border-t border-border py-2.5 text-sm last:border-b hover:text-accent"
              >
                <span className="shrink-0 font-display text-xs text-muted-foreground">{n.date}</span>
                <span className="truncate">{n.title}</span>
              </Link>
            ))}
            {!stats.loading && (stats.data?.recentNews ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无新闻</p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card p-5">
          <h2 className="font-display text-lg font-bold">最近加入的成员</h2>
          <div className="mt-3">
            {(stats.data?.recentMembers ?? []).map((m) => (
              <Link
                key={m.id}
                to="/admin/content/members"
                className="flex items-center gap-2 border-t border-border py-2.5 text-sm last:border-b hover:text-accent"
              >
                <span className="shrink-0 font-display text-xs text-muted-foreground">{m.joinYear}</span>
                <span className="truncate">{m.name}</span>
                <span className="ml-auto shrink-0 text-xs text-muted-foreground">{m.title}</span>
              </Link>
            ))}
            {!stats.loading && (stats.data?.recentMembers ?? []).length === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">暂无成员</p>
            )}
          </div>
        </section>
      </div>

      {/* 初始化演示数据 */}
      <section className="mt-6 rounded-2xl border border-dashed border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="flex items-center gap-2 font-display text-lg font-bold">
              <DatabaseZap className="h-4 w-4 text-accent" /> 初始化演示内容
            </h2>
            <p className="mt-1 max-w-xl text-sm text-muted-foreground">
              首次部署后使用：把内置的示例成员、项目、新闻与轮播写入数据库。
              已有数据的表会被跳过，不会覆盖正式内容。
            </p>
          </div>
          <Button variant="outline" onClick={() => void seed()} disabled={seeding}>
            {seeding ? '写入中…' : '写入演示数据'}
          </Button>
        </div>
      </section>
    </div>
  )
}
