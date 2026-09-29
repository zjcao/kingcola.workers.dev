import { useState } from 'react'
import { MemberAvatar } from '@/components/brand'
import type { Member, MemberStatus } from '@/types'
import { cn } from '@/lib/utils'
import { Globe, Mail } from 'lucide-react'

/** 主页链接可能没带协议（同学常写 github.com/xxx），补上 https:// 免得被当成站内相对路径 */
function homeHref(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** 年份分界线：两侧细线，中间大年份数字 */
function YearDivider({ year }: { year: string }) {
  return (
    <div className="my-14 flex items-center gap-6 sm:gap-10">
      <div className="h-px flex-1 bg-border" />
      <span className="font-display text-5xl font-bold text-foreground/85 sm:text-6xl">{year}</span>
      <div className="h-px flex-1 bg-border" />
    </div>
  )
}

/** 成员卡片：圆形头像 + 中文名 / 英文名 / 方向 */
function MemberCard({ member }: { member: Member }) {
  const isAlumni = member.status === 'alumni'
  // 在组看负责方向，已毕业看毕业去向；老数据可能只填了其中一个，做一下兜底
  const focus = isAlumni ? member.destination || member.direction : member.direction
  return (
    <div className="group relative flex flex-col items-center py-6 text-center">
      <MemberAvatar
        name={member.name}
        seed={member.id}
        src={member.avatarUrl}
        size="xl"
        className={cn('transition-transform duration-300 group-hover:-translate-y-1', isAlumni && 'opacity-90 saturate-0')}
      />
      <h3 className="mt-5 font-display text-2xl font-bold">
        {member.name}
        {isAlumni && (
          <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 align-middle text-xs font-normal text-muted-foreground">
            已毕业
          </span>
        )}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">{member.nameEn}</p>
      <p className="mt-2 text-sm font-medium text-accent">{member.title}</p>
      <p className="mt-1.5 line-clamp-2 max-w-[16rem] text-sm leading-relaxed text-foreground/70">
        {focus || '—'}
      </p>
      {member.email && (
        <a
          href={`mailto:${member.email}`}
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-accent"
        >
          <Mail className="h-3 w-3" /> {member.email}
        </a>
      )}
      {member.homepageUrl && (
        <a
          href={homeHref(member.homepageUrl)}
          target="_blank"
          rel="noreferrer noopener"
          className="mt-1.5 inline-flex items-center gap-1.5 text-xs font-medium text-accent underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
        >
          <Globe className="h-3 w-3" /> 点击进入个人主页
        </a>
      )}
    </div>
  )
}

export function MembersSection({ members }: { members: Member[] }) {
  const [tab, setTab] = useState<MemberStatus>('current')

  const pi = members.find((m) => m.isPI && m.status === 'current')
  const tabMembers = members.filter((m) => m.status === tab && !m.isPI)
  const currentCount = members.filter((m) => m.status === 'current').length
  const alumniCount = members.filter((m) => m.status === 'alumni').length

  // 按加入年份分组，新加入在前
  const yearGroups = Array.from(
    new Map<string, Member[]>(
      [...tabMembers]
        .sort((a, b) => (Number(b.joinYear) || 0) - (Number(a.joinYear) || 0))
        .reduce((map, m) => {
          const key = m.joinYear || '未知'
          if (!map.has(key)) map.set(key, [])
          map.get(key)!.push(m)
          return map
        }, new Map<string, Member[]>()),
    ),
  )

  return (
    <div className="mx-auto max-w-6xl animate-fade-up px-4 py-14 sm:px-6">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl font-bold sm:text-5xl">团队成员</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            在组 {currentCount} 人 · 已毕业 {alumniCount} 人
          </p>
        </div>
      </div>

      {/* ===== 负责人 ===== */}
      {pi && (
        <section className="mb-14 flex flex-col items-center gap-8 border-y border-border py-10 text-center sm:flex-row sm:items-center sm:gap-12 sm:px-4 sm:text-left">
          <MemberAvatar
            name={pi.name}
            seed={pi.id}
            src={pi.avatarUrl}
            size="xl"
            className="h-36 w-36 shrink-0"
          />
          <div className="flex-1">
            <div className="flex flex-wrap items-baseline justify-center gap-3 sm:justify-start">
              <h2 className="font-display text-3xl font-bold">{pi.name}</h2>
              <span className="text-lg text-muted-foreground">{pi.nameEn}</span>
              <span className="rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
                {pi.title} · 工作室负责人
              </span>
            </div>
            {pi.bio && (
              <p className="mx-auto mt-4 max-w-2xl text-sm leading-relaxed text-foreground/75 sm:mx-0">{pi.bio}</p>
            )}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm text-muted-foreground sm:justify-start">
              <span>指导方向：{pi.direction}</span>
              {pi.email && (
                <a href={`mailto:${pi.email}`} className="inline-flex items-center gap-1.5 hover:text-accent">
                  <Mail className="h-3.5 w-3.5" /> {pi.email}
                </a>
              )}
              {pi.homepageUrl && (
                <a
                  href={homeHref(pi.homepageUrl)}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1.5 font-medium text-accent underline decoration-dotted underline-offset-2 transition-colors hover:decoration-solid"
                >
                  <Globe className="h-3.5 w-3.5" /> 点击进入个人主页
                </a>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ===== 在组 / 已毕业 切换 ===== */}
      <div className="mb-8 flex items-center gap-2">
        {(
          [
            { key: 'current', label: `在组成员 ${currentCount - (pi ? 1 : 0)}` },
            { key: 'alumni', label: `已毕业成员 ${alumniCount}` },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-full px-5 py-2 text-sm transition-colors',
              tab === t.key
                ? 'bg-primary text-primary-foreground'
                : 'border border-border text-foreground/70 hover:bg-secondary',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ===== 按年份分组展示 ===== */}
      {yearGroups.length === 0 ? (
        <div className="border border-dashed border-border py-20 text-center text-sm text-muted-foreground">
          暂无成员
        </div>
      ) : (
        <div>
          {yearGroups.map(([year, group]) => (
            <section key={year}>
              <YearDivider year={year} />
              <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
                {group.map((m) => (
                  <MemberCard key={m.id} member={m} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
