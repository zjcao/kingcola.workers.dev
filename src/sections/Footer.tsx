import { Link } from 'react-router'
import { StudioLogo } from '@/components/brand'
import { orDash, renderCopyright } from '@shared/site'
import { PAGE_LABELS, PAGE_PATHS, type PageKey, type SiteConfig } from '@/types'

/** 页脚的板块入口（顺序与顶部导航一致） */
const FOOTER_LINKS: PageKey[] = ['news', 'projects', 'members', 'join']

export function Footer({ site }: { site: SiteConfig }) {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-3 sm:px-6">
        <div>
          <Link to={PAGE_PATHS.home} className="flex items-center gap-2.5">
            <StudioLogo logoUrl={site.logoUrl} />
            <span className="text-lg font-bold">{site.studioName}</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">{site.slogan}</p>
        </div>

        <div>
          <h3 className="text-xs tracking-[0.25em] text-muted-foreground">联系方式</h3>
          <ul className="mt-4 space-y-2 text-sm text-foreground/85">
            <li>邮箱：{orDash(site.contactEmail)}</li>
            {site.contactPhone && <li>电话：{site.contactPhone}</li>}
            <li>地址：{orDash(site.contactAddress)}</li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs tracking-[0.25em] text-muted-foreground">快捷入口</h3>
          <ul className="mt-4 space-y-2 text-sm text-foreground/85">
            {FOOTER_LINKS.map((key) => (
              <li key={key}>
                <Link to={PAGE_PATHS[key]} className="transition-colors hover:text-accent">
                  {PAGE_LABELS[key]}
                </Link>
              </li>
            ))}
            <li className="text-muted-foreground">
              内容维护请前往{' '}
              {/* 后台用普通链接整页跳转：换一套布局时不会带着前台的滚动位置与状态 */}
              <a href="/admin" className="text-accent hover:underline">
                管理后台
              </a>
            </li>
          </ul>
        </div>
      </div>

      {/* 跑马灯 */}
      <div className="overflow-hidden border-t border-border bg-primary py-3 text-primary-foreground">
        <div className="animate-marquee flex w-max whitespace-nowrap font-display text-sm tracking-[0.35em]">
          <span>{site.marqueeText.repeat(4)}</span>
          <span>{site.marqueeText.repeat(4)}</span>
        </div>
      </div>

      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 text-xs text-muted-foreground sm:px-6">
        <span>{renderCopyright(site.footerCopyright)}</span>
        <span>{site.studioNameEn}</span>
      </div>
    </footer>
  )
}
