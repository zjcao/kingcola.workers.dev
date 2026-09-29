import { useEffect, useMemo } from 'react'
import { Link, Route, Routes, useLocation } from 'react-router'
import { Header } from '@/sections/Header'
import { HomeSection } from '@/sections/HomeSection'
import { MembersSection } from '@/sections/MembersSection'
import { ProjectsSection } from '@/sections/ProjectsSection'
import { NewsSection } from '@/sections/NewsSection'
import { JoinSection } from '@/sections/JoinSection'
import { InviteSection } from '@/sections/InviteSection'
import { CheckinSection } from '@/sections/CheckinSection'
import { GraduateSection } from '@/sections/GraduateSection'
import { Footer } from '@/sections/Footer'
import { CHECKIN_PATH } from '@shared/recruit'
import { Toaster } from '@/components/ui/sonner'
import { AdminApp } from '@/admin/AdminApp'
import { InstallPage } from '@/pages/InstallPage'
import { refreshRuntimeConfig } from '@/api/client'
import { useSiteData } from '@/api/hooks'
import { GRADUATE_PATH, INVITE_PATH, PAGE_LABELS, PAGE_PATHS, type PageKey } from '@/types'
import { AlertTriangle } from 'lucide-react'

/** 公开站点兜底页：只有后台有独立路由，其余未知路径都落在这里 */
function NotFound() {
  return (
    <div className="mx-auto max-w-3xl animate-fade-up px-4 py-24 text-center sm:px-6">
      <p className="font-display text-6xl font-black text-foreground/10">404</p>
      <h1 className="mt-6 font-display text-2xl font-bold">这个页面不存在</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        链接可能已经调整，或者这条内容已被删除。
      </p>
      <Link
        to={PAGE_PATHS.home}
        className="mt-8 inline-flex items-center rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
      >
        回到首页
      </Link>
    </div>
  )
}

/**
 * 公开站点：数据在这里取一次，各板块按路径渲染。
 * 每个板块都是独立路径（`/`、`/news`、`/projects`、`/members`、`/join`，详情页 `/news/:id`），
 * 直接输地址、刷新、分享链接都能落到对应板块 —— 不再靠内存里的状态切页面。
 */
function PublicSite() {
  const { pathname } = useLocation()
  const { data, loading, error, site, usingFallback, reload } = useSiteData()

  /** 当前板块名（用于标签页标题，详情页算它所属的板块） */
  const sectionLabel = useMemo(() => {
    if (pathname.startsWith(`${PAGE_PATHS.news}/`)) return PAGE_LABELS.news
    const key = (Object.keys(PAGE_PATHS) as PageKey[]).find((k) => PAGE_PATHS[k] === pathname)
    return key ? PAGE_LABELS[key] : null
  }, [pathname])

  // 浏览器标签标题跟随后台配置的工作室名称；非首页带上板块名，便于书签与历史记录辨认
  useEffect(() => {
    const base = site.studioName || '工作室官网'
    document.title =
      sectionLabel && sectionLabel !== PAGE_LABELS.home ? `${sectionLabel} · ${base}` : base
  }, [site.studioName, sectionLabel])

  // 切换板块时回到顶部（原先是在 navigate() 里手动滚的）
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])

  const members = data?.members ?? []
  const projects = data?.projects ?? []
  const news = data?.news ?? []
  const slides = data?.slides ?? []

  return (
    <div className="flex min-h-screen flex-col">
      <Header site={site} recruit={data?.recruit} />

      {usingFallback && (
        <div className="flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-1.5 text-center text-xs text-amber-700">
          <AlertTriangle className="h-3.5 w-3.5" />
          内容接口暂不可用，当前展示内置备用内容
          <button onClick={reload} className="underline underline-offset-2">
            重试
          </button>
        </div>
      )}

      <main className="flex-1">
        {loading && !data ? (
          <div className="flex min-h-[60vh] items-center justify-center">
            <span className="h-6 w-6 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        ) : (
          <Routes>
            <Route
              path={PAGE_PATHS.home}
              element={
                <HomeSection
                  members={members}
                  news={news}
                  projects={projects}
                  slides={slides}
                  site={site}
                  recruit={data?.recruit}
                />
              }
            />
            <Route path={PAGE_PATHS.members} element={<MembersSection members={members} />} />
            <Route path={PAGE_PATHS.projects} element={<ProjectsSection projects={projects} />} />
            <Route path={PAGE_PATHS.news} element={<NewsSection news={news} />} />
            <Route path={`${PAGE_PATHS.news}/:id`} element={<NewsSection news={news} />} />
            <Route path={PAGE_PATHS.join} element={<JoinSection site={site} />} />
            {/* 邀请函确认页：链接由邮件发出，凭 token 进入，不要求登录 */}
            <Route path={`${INVITE_PATH}/:token`} element={<InviteSection site={site} />} />
            {/* 扫码签到页：只有后台签发的签到二维码会指向这里（token 即凭证，只绑阶段），
                没有裸入口 —— 不填 token 或 token 失效都拿不到任何签到信息 */}
            <Route path={`${CHECKIN_PATH}/:token`} element={<CheckinSection site={site} />} />
            {/* 毕业去向填写页：批量毕业那封信里的专属链接指向这里，同样凭 token 进入、不要求登录 */}
            <Route path={`${GRADUATE_PATH}/:token`} element={<GraduateSection site={site} />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        )}

        {error && !usingFallback && (
          <div className="mx-auto max-w-6xl px-4 py-6 text-center text-xs text-muted-foreground">{error}</div>
        )}
      </main>

      <Footer site={site} />
      <Toaster position="top-center" />
    </div>
  )
}

export default function App() {
  useEffect(() => {
    void refreshRuntimeConfig()
  }, [])

  return (
    <Routes>
      {/* 安装页：一个页面完成建表 + 生成密钥 + 建管理员；装完自动锁死 */}
      <Route path="/install" element={<InstallPage />} />
      <Route path="/admin/*" element={<AdminApp />} />
      <Route path="/*" element={<PublicSite />} />
    </Routes>
  )
}
