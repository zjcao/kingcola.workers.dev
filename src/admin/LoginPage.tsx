import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { LogoMark } from '@/components/brand'
import { adminBootstrap, adminLogin, type AdminIdentity } from '@/api/endpoints'
import { ApiError, isInitialized, refreshRuntimeConfig } from '@/api/client'
import { toast } from 'sonner'
import { KeyRound, ShieldCheck, Sparkles } from 'lucide-react'

/** 密码长度下限，与 worker 侧的 `minPasswordLength()` 保持一致 */
const MIN_PASSWORD = 8

/**
 * 后台入口 —— 两种形态共用一个页面：
 *
 *   · **还没初始化**（库里一个管理员都没有）→ 显示「首次初始化」引导：用部署时设置的
 *     `RECOVERY_TOKEN` 现场创建第一个管理员，建完直接登录进后台，不用去翻文档敲 curl。
 *   · 已有管理员 → 常规登录表单（外加「忘记密码」的恢复说明）。
 *
 * 是否已初始化取自公开接口 `/api/config/runtime` 的 `initialized`（后端就是 `countAdmins() > 0`），
 * 因此不需要新开接口；探不出来（接口不可达）时按「已初始化」处理，至少还能照常登录。
 */
export function LoginPage({ onSuccess }: { onSuccess: (identity: AdminIdentity) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [token, setToken] = useState('')
  const [seedContent, setSeedContent] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  /** null = 还在问后端；true = 显示首次初始化引导 */
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null)

  useEffect(() => {
    let active = true
    void refreshRuntimeConfig()
      .then(() => active && setNeedsSetup(!isInitialized()))
      .catch(() => active && setNeedsSetup(false))
    return () => {
      active = false
    }
  }, [])

  const submit = async () => {
    const name = username.trim() || 'admin'
    setError('')

    if (needsSetup && !token.trim()) {
      setError('请填写初始化口令（部署时设置的 RECOVERY_TOKEN）')
      return
    }
    if (!needsSetup && !username.trim()) {
      setError('请输入用户名')
      return
    }
    if (!password) {
      setError('请输入密码')
      return
    }
    if (needsSetup) {
      if (password.length < MIN_PASSWORD) {
        setError(`密码至少 ${MIN_PASSWORD} 位`)
        return
      }
      if (password !== confirm) {
        setError('两次输入的密码不一致')
        return
      }
    }

    setSubmitting(true)
    try {
      if (needsSetup) {
        const result = await adminBootstrap({ token: token.trim(), username: name, password, seedContent })
        if (result.seeded) {
          const summary = Object.entries(result.seeded)
            .map(([key, value]) => `${key}：${value}`)
            .join('，')
          toast.success('演示内容已写入', { description: summary })
        }
      }
      const identity = await adminLogin(name, password)
      toast.success(needsSetup ? `初始化完成，欢迎加入，${identity.name}` : `欢迎回来，${identity.name}`)
      onSuccess(identity)
    } catch (err) {
      const fallback = needsSetup ? '初始化失败，请检查初始化口令' : '登录失败，请稍后重试'
      setError(err instanceof ApiError ? err.message : fallback)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/30 px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <LogoMark className="h-10 w-10" />
          <h1 className="mt-4 font-display text-2xl font-bold">内容管理后台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {needsSetup ? '首次使用，先创建管理员账号' : '拾光工作室 · 仅限内部成员使用'}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-6 sm:p-7">
          {needsSetup && (
            <p className="mb-5 flex items-start gap-2 rounded-lg border border-accent/40 bg-accent/5 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
              <span>
                这套系统还没有管理员账号。填上部署时设置的<b className="text-foreground">初始化口令</b>
                （环境变量 <code className="rounded bg-secondary px-1">RECOVERY_TOKEN</code>）
                即可现场创建第一个管理员，建好就直接进后台。
              </span>
            </p>
          )}

          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            {needsSetup && (
              <div className="grid gap-1.5">
                <Label htmlFor="admin-token">初始化口令</Label>
                <Input
                  id="admin-token"
                  type="password"
                  autoComplete="off"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="RECOVERY_TOKEN 的值"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="admin-username">用户名</Label>
              <Input
                id="admin-username"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder={needsSetup ? '留空即用 admin' : 'admin'}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="admin-password">
                {needsSetup ? `设置密码（至少 ${MIN_PASSWORD} 位）` : '密码'}
              </Label>
              <Input
                id="admin-password"
                type="password"
                autoComplete={needsSetup ? 'new-password' : 'current-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            {needsSetup && (
              <>
                <div className="grid gap-1.5">
                  <Label htmlFor="admin-confirm">确认密码</Label>
                  <Input
                    id="admin-confirm"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    placeholder="再输一次"
                  />
                </div>
                <label className="flex items-start gap-2.5 text-xs leading-relaxed text-muted-foreground">
                  <Checkbox
                    checked={seedContent}
                    onCheckedChange={(checked) => setSeedContent(checked === true)}
                    className="mt-0.5"
                  />
                  <span>同时写入演示内容（成员 / 项目 / 新闻 / 轮播）—— 只在空表上写，不会覆盖已有内容</span>
                </label>
              </>
            )}

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
            )}

            <Button type="submit" disabled={submitting || needsSetup === null} className="mt-1 w-full gap-1.5">
              <KeyRound className="h-4 w-4" />
              {submitting
                ? needsSetup
                  ? '正在创建…'
                  : '登录中…'
                : needsSetup
                  ? '创建管理员并进入后台'
                  : '登录'}
            </Button>
          </form>

          {needsSetup ? (
            <p className="mt-5 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              口令就是部署时用 <code className="rounded bg-secondary px-1">wrangler secret put RECOVERY_TOKEN</code>{' '}
              写入的那个值。创建成功后这个引导会自动消失，以后都从这一页登录。
            </p>
          ) : (
            <details className="mt-5 text-[11px] leading-relaxed text-muted-foreground">
              <summary className="cursor-pointer">忘记密码？用初始化口令重置</summary>
              <p className="mt-2">
                在任意能联网的终端里执行下面这条命令即可重设密码（<code className="rounded bg-secondary px-1">token</code>{' '}
                填部署时的 RECOVERY_TOKEN）：
              </p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-secondary/60 px-3 py-2 text-[10px] leading-relaxed">{`curl -X POST https://<你的域名>/api/admin/bootstrap \\
  -H 'content-type: application/json' \\
  -d '{"token":"<RECOVERY_TOKEN>","username":"admin","password":"<新密码>"}'`}</pre>
            </details>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          <a href="/" className="hover:text-foreground">
            ← 返回官网
          </a>
        </p>
      </div>
    </div>
  )
}
