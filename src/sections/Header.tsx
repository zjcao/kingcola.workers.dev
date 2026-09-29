import { Link, NavLink } from 'react-router'
import { StudioLogo } from '@/components/brand'
import { isRecruitVisible } from '@shared/recruit'
import type { RecruitStatusInfo } from '@/api/endpoints'
import { PAGE_LABELS, PAGE_PATHS, type PageKey, type SiteConfig } from '@/types'
import { cn } from '@/lib/utils'

/**
 * 导航顺序（与 PAGE_KEYS 的契约顺序无关，这里只管展示顺序）。
 * 每个板块都有自己的路径，直接改地址栏 / 刷新 / 分享链接都能落到对应板块。
 */
const NAV_ORDER: PageKey[] = ['home', 'news', 'projects', 'members', 'join']

export function Header({ site, recruit }: { site: SiteConfig; recruit?: RecruitStatusInfo }) {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to={PAGE_PATHS.home} className="flex items-center gap-2.5 text-foreground">
          <StudioLogo logoUrl={site.logoUrl} />
          <span className="text-lg font-bold tracking-wide">{site.studioName}</span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {NAV_ORDER.map((key) => (
            <NavLink
              key={key}
              to={PAGE_PATHS[key]}
              // 首页是 "/"，不加 end 会在所有子路径上保持选中
              end={key === 'home'}
              className={({ isActive }) =>
                cn(
                  'rounded-full px-4 py-1.5 text-sm transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-foreground/65 hover:bg-secondary hover:text-foreground',
                )
              }
            >
              {PAGE_LABELS[key]}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* 移动端导航 */}
      <nav className="flex items-center gap-1 overflow-x-auto border-t border-border px-4 py-2 md:hidden">
        {NAV_ORDER.map((key) => (
          <NavLink
            key={key}
            to={PAGE_PATHS[key]}
            end={key === 'home'}
            className={({ isActive }) =>
              cn(
                'whitespace-nowrap rounded-full px-3.5 py-1 text-sm',
                isActive ? 'bg-primary text-primary-foreground' : 'text-foreground/65',
              )
            }
          >
            {PAGE_LABELS[key]}
          </NavLink>
        ))}
      </nav>

      {/* 招新提示：由整届状态派生 —— 报名中与流程中都提示，文案按报名是否还开着区分 */}
      {recruit && isRecruitVisible(recruit.state) && (
        <div className="bg-emerald-500/10 px-4 py-1.5 text-center text-xs text-emerald-700">
          {recruit.applyOpen
            ? '招新进行中：「加入我们」报名通道已开放'
            : '招新进行中：本届报名已截止，后续安排请在对应的 QQ 群查看'}
        </div>
      )}
    </header>
  )
}
