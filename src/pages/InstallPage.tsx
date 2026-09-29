/**
 * 安装页 `/install` —— 一个页面完成安装：**建表 + 生成运行期密钥 + 创建管理员**。
 *
 * 服务端只有一件事要做：`POST /api/admin/bootstrap`（不再需要任何口令；
 * 系统里已经有管理员时它会直接拒绝）。建表与密钥生成都在服务端/Cloudflare 上完成
 * （SQL 随产物发布、密钥写进 D1），所以这里只管收集管理员信息。
 *
 * 已安装时页面锁死：只提示「已经安装过了」，不再给表单。
 */
import { useEffect, useState } from 'react'

type State = 'checking' | 'open' | 'installed'

export function InstallPage() {
  const [state, setState] = useState<State>('checking')
  const [username, setUsername] = useState('admin')
  const [displayName, setDisplayName] = useState('管理员')
  const [password, setPassword] = useState('')
  const [seedContent, setSeedContent] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    fetch('/api/config/runtime')
      .then(async (res) => {
        if (!alive) return
        // 表还没建时这个接口会报错 —— 那正是「还没安装」
        if (!res.ok) {
          setState('open')
          return
        }
        const body = await res.json().catch(() => null)
        setState(body?.data?.initialized ? 'installed' : 'open')
      })
      .catch(() => {
        if (alive) setState('open')
      })
    return () => {
      alive = false
    }
  }, [])

  const submit = async () => {
    setError('')
    if (password.length < 8) {
      setError('密码至少 8 位')
      return
    }
    setBusy(true)
    try {
      const res = await fetch('/api/admin/bootstrap', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, password, displayName, seedContent }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok || !body?.ok) {
        setError(body?.error?.message ?? `安装失败（HTTP ${res.status}）`)
        return
      }
      window.location.href = '/admin'
    } catch (err) {
      setError(err instanceof Error ? err.message : '网络异常，请重试')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-secondary/40 px-4 py-10">
      <div className="w-full max-w-md rounded-xl border border-border bg-background p-7 shadow-sm">
        <h1 className="text-lg font-semibold text-foreground">安装拾光工作室官网</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          只需要设置管理员账号：建表、生成签名密钥都由系统在云端自动完成。
        </p>

        {state === 'checking' && <p className="mt-6 text-sm text-muted-foreground">正在检查安装状态…</p>}

        {state === 'installed' && (
          <div className="mt-6 rounded-lg border border-border bg-secondary/50 px-4 py-3 text-sm">
            这个站点**已经安装过了**。请直接去 <a className="text-primary underline" href="/admin">后台登录</a>；
            忘记密码请在登录后修改（或由另一位管理员重置）。
          </div>
        )}

        {state === 'open' && (
          <div className="mt-6 grid gap-4">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">管理员用户名</span>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoComplete="username"
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">显示名称（可选）</span>
              <input
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium">密码（至少 8 位）</span>
              <input
                type="password"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={seedContent}
                onChange={(event) => setSeedContent(event.target.checked)}
              />
              <span>同时写入演示内容（新闻 / 项目 / 成员等，之后可随时删改）</span>
            </label>

            {error && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={busy}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {busy ? '正在安装…' : '开始安装'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default InstallPage
