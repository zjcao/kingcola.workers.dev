import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { LogoMark } from '@/components/brand'
import { RESOURCES, RESOURCE_KEYS } from '@shared/resources'
import type { AdminIdentity } from '@/api/endpoints'
import { cn } from '@/lib/utils'
import {
  Activity,
  ClipboardList,
  Database,
  ExternalLink,
  FolderKanban,
  Images,
  LayoutDashboard,
  LogOut,
  Newspaper,
  Settings,
  Shapes,
  Users,
} from 'lucide-react'

const RESOURCE_ICONS: Record<string, ReactNode> = {
  members: <Users className="h-4 w-4" />,
  projects: <FolderKanban className="h-4 w-4" />,
  news: <Newspaper className="h-4 w-4" />,
  slides: <Images className="h-4 w-4" />,
}

function NavItem({ to, icon, label }: { to: string; icon: ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/admin'}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors',
          isActive
            ? 'bg-primary text-primary-foreground'
            : 'text-foreground/70 hover:bg-secondary hover:text-foreground',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

export function AdminLayout({
  identity,
  onLogout,
  children,
}: {
  identity: AdminIdentity
  onLogout: () => void
  children: ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-secondary/30">
      {/* 侧边栏 */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-card md:flex">
        <a
          href="/"
          className="flex items-center gap-2.5 border-b border-border px-4 py-4 text-foreground"
          title="返回官网首页"
        >
          <LogoMark className="h-6 w-6" />
          <div className="leading-tight">
            <div className="text-sm font-bold">拾光工作室</div>
            <div className="text-[11px] text-muted-foreground">内容管理后台</div>
          </div>
        </a>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          <NavItem to="/admin" icon={<LayoutDashboard className="h-4 w-4" />} label="概览" />

          <div className="mt-3 px-3 pb-1 text-[11px] tracking-[0.2em] text-muted-foreground">招新</div>
          {/* 整个招新模块一个入口：休眠 → 启动 → 备招 → 报名 → 笔试 → 面试 → 答辩 → 转正 → 归档，
              阶段推进全靠按钮，内部分「流程 / 名单 / 邮件日志 / 设置」视图 */}
          <NavItem to="/admin/recruit" icon={<ClipboardList className="h-4 w-4" />} label="招新" />

          <div className="mt-3 px-3 pb-1 text-[11px] tracking-[0.2em] text-muted-foreground">内容管理</div>
          {RESOURCE_KEYS.map((key) => (
            <NavItem
              key={key}
              to={`/admin/content/${key}`}
              icon={RESOURCE_ICONS[key]}
              label={RESOURCES[key].label}
            />
          ))}
          {/* 方向字典：给「团队成员」的角色字段提供选项，也决定邀请函里学生能选什么 */}
          <NavItem to="/admin/roles" icon={<Shapes className="h-4 w-4" />} label="方向与身份" />

          <div className="mt-3 px-3 pb-1 text-[11px] tracking-[0.2em] text-muted-foreground">系统</div>
          <NavItem to="/admin/storage" icon={<Database className="h-4 w-4" />} label="对象存储" />
          <NavItem to="/admin/audit" icon={<Activity className="h-4 w-4" />} label="操作日志" />
          <NavItem to="/admin/settings" icon={<Settings className="h-4 w-4" />} label="系统设置" />
        </nav>

        <div className="border-t border-border p-3">
          <div className="mb-2 px-1">
            <div className="truncate text-sm font-medium">{identity.name}</div>
            <div className="truncate text-xs text-muted-foreground">@{identity.username}</div>
          </div>
          <button
            onClick={onLogout}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-foreground/70 transition-colors hover:bg-destructive/10 hover:text-destructive"
          >
            <LogOut className="h-4 w-4" /> 退出登录
          </button>
        </div>
      </aside>

      {/* 主区域 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* 移动端顶部条 */}
        <div className="flex items-center justify-between border-b border-border bg-card px-4 py-3 md:hidden">
          <span className="text-sm font-bold">拾光工作室 · 后台</span>
          <button onClick={onLogout} className="text-xs text-muted-foreground">
            退出
          </button>
        </div>

        <header className="hidden items-center justify-between border-b border-border bg-card px-6 py-3 md:flex">
          <div className="text-sm text-muted-foreground">
            数据存储于 Cloudflare D1 · 所有写操作都会记录到操作日志
          </div>
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="h-3.5 w-3.5" /> 查看官网
          </a>
        </header>

        {/* 移动端导航 */}
        <nav className="flex gap-1 overflow-x-auto border-b border-border bg-card px-3 py-2 md:hidden">
          <NavLink to="/admin" end className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70">
            概览
          </NavLink>
          <NavLink
            to="/admin/recruit"
            className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70"
          >
            招新
          </NavLink>
          {RESOURCE_KEYS.map((key) => (
            <NavLink
              key={key}
              to={`/admin/content/${key}`}
              className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70"
            >
              {RESOURCES[key].label}
            </NavLink>
          ))}
          <NavLink to="/admin/roles" className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70">
            方向与身份
          </NavLink>
          <NavLink to="/admin/storage" className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70">
            对象存储
          </NavLink>
          <NavLink to="/admin/settings" className="whitespace-nowrap rounded-full px-3 py-1 text-xs text-foreground/70">
            设置
          </NavLink>
        </nav>

        <main className="min-w-0 flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  )
}
