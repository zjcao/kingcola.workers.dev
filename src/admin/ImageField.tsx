import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { adminUploadImage } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/utils'
import { formatLimit, uploadImageLimit } from '@shared/resources'
import { ImagePlus, Loader2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

/** 表格里的缩略图 */
export function ImageThumb({ src, alt, className }: { src?: string; alt: string; className?: string }) {
  if (!src) return <span className="text-muted-foreground">—</span>
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={cn('h-10 w-10 rounded-lg border border-border object-cover', className)}
    />
  )
}

/** 图片上传控件：选择 → 校验 → 上传到 R2 → 回写相对地址 */
export function ImageField({
  value,
  onChange,
  scope = 'misc',
  shape = 'square',
}: {
  value: unknown
  onChange: (next: string) => void
  scope?: string
  /** 预览框形状：头像用圆形，轮播等横图用 wide（16:9 宽幅） */
  shape?: 'square' | 'circle' | 'wide'
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const url = typeof value === 'string' ? value : ''
  // 上限与 Worker 校验同源（头像 2MB、首页轮播 50MB），前端先拦一道省得白传
  const limit = uploadImageLimit(scope)

  const pick = async (file: File | null | undefined) => {
    if (!file) return
    if (file.size > limit) {
      toast.error(`图片不能超过 ${formatLimit(limit)}`)
      return
    }
    setUploading(true)
    try {
      const result = await adminUploadImage(file, scope)
      onChange(result.url)
      toast.success('图片已上传', { description: `${(result.size / 1024).toFixed(1)}KB · ${result.contentType}` })
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '上传失败，请重试')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="flex items-start gap-4">
      <div
        className={cn(
          'flex shrink-0 items-center justify-center overflow-hidden border border-dashed border-border bg-secondary/40',
          shape === 'wide' ? 'aspect-video w-56 rounded-xl' : 'h-24 w-24',
          shape === 'circle' ? 'rounded-full' : shape === 'square' ? 'rounded-xl' : '',
        )}
      >
        {url ? (
          <img src={url} alt="预览" className="h-full w-full object-cover" />
        ) : (
          <span className="text-[11px] text-muted-foreground">暂无</span>
        )}
      </div>

      <div className="grid min-w-0 gap-2">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          className="hidden"
          onChange={(e) => void pick(e.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={uploading}
            className="gap-1.5"
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />}
            {uploading ? '上传中…' : url ? '更换图片' : '选择图片'}
          </Button>
          {url && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5 text-destructive hover:bg-destructive/10"
              onClick={() => onChange('')}
            >
              <Trash2 className="h-3.5 w-3.5" /> 移除
            </Button>
          )}
        </div>
        {url && <p className="break-all text-[11px] text-muted-foreground">{url}</p>}
      </div>
    </div>
  )
}
