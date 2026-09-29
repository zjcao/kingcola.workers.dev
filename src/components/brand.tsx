import { cn } from '@/lib/utils'

/** 工作室标识：终端光标符号 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn('h-7 w-7', className)}
      aria-label="工作室标识"
    >
      <rect
        x="1.5"
        y="1.5"
        width="29"
        height="29"
        rx="7"
        stroke="currentColor"
        strokeWidth="2.2"
      />
      <path
        d="M9 11l5 5-5 5"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M16.5 22H23"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** 成员头像：姓名首字 + 中性灰阶渐变，代码绘制 */
const AVATAR_TONES = [
  'from-[#2a2a2e] to-[#0c0c0f]',
  'from-[#3a3f4b] to-[#1a1d24]',
  'from-[#334155] to-[#0f172a]',
  'from-[#374151] to-[#111827]',
  'from-[#1e3a5f] to-[#0b1e33]',
  'from-[#44403c] to-[#1c1917]',
]

export function InitialAvatar({
  name,
  seed,
  size = 'md',
  className,
}: {
  name: string
  seed: string
  size?: 'md' | 'lg' | 'xl'
  className?: string
}) {
  let hash = 0
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0
  const tone = AVATAR_TONES[hash % AVATAR_TONES.length]
  const sizeCls =
    size === 'xl'
      ? 'h-32 w-32 text-5xl'
      : size === 'lg'
        ? 'h-24 w-24 text-3xl'
        : 'h-16 w-16 text-xl'
  return (
    <div
      className={cn(
        'flex shrink-0 select-none items-center justify-center rounded-2xl bg-gradient-to-br font-semibold text-white',
        tone,
        sizeCls,
        className,
      )}
    >
      {name.slice(0, 1)}
    </div>
  )
}

/**
 * 成员头像：配置了 avatarUrl 就显示真实照片，否则回退到姓名首字占位头像。
 * 占位头像在图片加载失败时也会兜底（onError）。
 */
export function MemberAvatar({
  name,
  seed,
  src,
  size = 'md',
  className,
}: {
  name: string
  seed: string
  src?: string
  size?: 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizeCls =
    size === 'xl' ? 'h-32 w-32' : size === 'lg' ? 'h-24 w-24' : 'h-16 w-16'
  if (src) {
    return (
      <img
        src={src}
        alt={name}
        loading="lazy"
        className={cn('shrink-0 select-none rounded-2xl object-cover', sizeCls, className)}
        onError={(e) => {
          // 图片挂了也不要出现破图，隐藏后由外层结构保持布局
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
    )
  }
  return <InitialAvatar name={name} seed={seed} size={size} className={className} />
}

/** 工作室标识：后台配置了 logoUrl 就用自定义图片，否则用内置矢量标识 */
export function StudioLogo({ logoUrl, className }: { logoUrl?: string; className?: string }) {
  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt="工作室标识"
        className={cn('h-7 w-7 shrink-0 rounded-lg object-cover', className)}
      />
    )
  }
  return <LogoMark className={className} />
}
