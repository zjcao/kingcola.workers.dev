import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { LogoMark } from '@/components/brand'
import { PAGE_PATHS, type Slide } from '@/types'
import { cn } from '@/lib/utils'
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react'

/** 图片版：必须选了图片版且确实传了图；缺图时退回文字版，避免首屏出现空白 */
function isImageSlide(slide: Slide | undefined): boolean {
  return Boolean(slide && slide.type === 'image' && slide.imageUrl)
}

/**
 * 首屏的固定尺寸：文字版与图片版**必须用同一套高度**，
 * 否则自动轮播切换时页面会跟着跳，看起来像是两种不同的组件。
 */
const HERO_HEIGHT = 'h-[62svh] min-h-[400px] md:h-[calc(100svh-4rem)] md:max-h-[840px]'

/** 轮播控制器：两种类型都放在内容框右下角，只有配色随底色变（图片上为深色胶囊） */
function CarouselControls({
  slides,
  index,
  onGo,
  dark,
  className,
}: {
  slides: Slide[]
  index: number
  onGo: (next: number) => void
  dark?: boolean
  className?: string
}) {
  return (
    <div className={cn('flex items-center gap-4', className)}>
      <button
        onClick={() => onGo(index - 1)}
        aria-label="上一张"
        className={cn(
          'rounded-full border p-2 transition-colors',
          dark ? 'border-white/40 text-white/85 hover:bg-white/15' : 'border-border text-foreground/70 hover:bg-secondary',
        )}
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <div className="flex gap-2">
        {slides.map((s, i) => (
          <button
            key={s.id}
            onClick={() => onGo(i)}
            aria-label={`第 ${i + 1} 张`}
            className={cn(
              'h-1.5 rounded-full transition-all',
              i === index
                ? cn('w-8', dark ? 'bg-white' : 'bg-foreground')
                : cn('w-1.5', dark ? 'bg-white/40 hover:bg-white/70' : 'bg-foreground/25 hover:bg-foreground/50'),
            )}
          />
        ))}
      </div>
      <button
        onClick={() => onGo(index + 1)}
        aria-label="下一张"
        className={cn(
          'rounded-full border p-2 transition-colors',
          dark ? 'border-white/40 text-white/85 hover:bg-white/15' : 'border-border text-foreground/70 hover:bg-secondary',
        )}
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      <span className={cn('font-display text-sm', dark ? 'text-white/75' : 'text-muted-foreground')}>
        {index + 1} / {slides.length}
      </span>
    </div>
  )
}

export function HeroCarousel({ slides }: { slides: Slide[] }) {
  const [index, setIndex] = useState(0)

  const count = slides.length
  const safeIndex = count === 0 ? 0 : Math.min(index, count - 1)

  // 自动轮播（多条时）
  useEffect(() => {
    if (count <= 1) return
    const timer = setInterval(() => setIndex((i) => (i + 1) % count), 5000)
    return () => clearInterval(timer)
  }, [count])

  const go = (i: number) => setIndex(((i % count) + count) % count)
  const current = slides[safeIndex]
  const imageMode = isImageSlide(current)
  const showControls = count > 1

  return (
    <section
      className={cn('relative overflow-hidden border-b border-border', HERO_HEIGHT, !imageMode && 'dot-grid')}
    >
      {count === 0 || !current ? (
        <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground sm:px-6">
          暂无轮播内容
        </div>
      ) : (
        <>
          {/* 图片版：图片铺满整个首屏（object-cover 自动裁切），不叠加任何文字 */}
          {imageMode && (
            <img
              key={current.id}
              src={current.imageUrl}
              alt={current.title || current.kicker || '首页轮播图'}
              className="absolute inset-0 h-full w-full animate-fade-up object-cover"
            />
          )}

          {/* 两种类型共用同一套骨架：内容垂直居中，控制器恒定在内容框右下角 */}
          <div className="relative mx-auto flex h-full max-w-6xl flex-col px-4 pt-14 sm:px-6 sm:pt-16">
            <div className="flex flex-1 items-center">
              {!imageMode && (
                <div key={current.id} className="animate-fade-up">
                  <div className="mb-6 flex items-center gap-3 text-xs tracking-[0.3em] text-muted-foreground">
                    <LogoMark className="h-5 w-5" />
                    {current.kicker}
                  </div>
                  <h1 className="font-display text-[12vw] font-black leading-[1.08] tracking-tight sm:text-[7vw] lg:text-[5.5rem]">
                    {current.title}
                  </h1>
                  <p className="mt-6 max-w-2xl text-base leading-relaxed text-foreground/75 sm:text-lg">
                    {current.subtitle}
                  </p>
                  <div className="mt-8 flex flex-wrap gap-3">
                    <Link
                      to={PAGE_PATHS[current.ctaPage]}
                      className="group inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm text-primary-foreground transition-opacity hover:opacity-85"
                    >
                      {current.ctaText || '了解更多'}
                      <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                    <Link
                      to={PAGE_PATHS.join}
                      className="inline-flex items-center gap-2 rounded-full border border-border px-6 py-2.5 text-sm transition-colors hover:bg-secondary"
                    >
                      招新报名
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {showControls && (
              <div className="flex justify-end pb-5 sm:pb-6">
                <CarouselControls
                  slides={slides}
                  index={safeIndex}
                  onGo={go}
                  dark={imageMode}
                  // 两种类型保持同样的几何：都留出 py-2，图片版只是多一层深色胶囊底
                  className={cn('py-2', imageMode && 'rounded-full bg-black/40 px-4 backdrop-blur')}
                />
              </div>
            )}
          </div>
        </>
      )}
    </section>
  )
}
