import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useAsync } from '@/api/hooks'
import { adminAudit } from '@/api/endpoints'
import { RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  create: { label: '新增', className: 'bg-emerald-500/10 text-emerald-700' },
  update: { label: '修改', className: 'bg-sky-500/10 text-sky-700' },
  delete: { label: '删除', className: 'bg-destructive/10 text-destructive' },
  login: { label: '登录', className: 'bg-secondary text-foreground/70' },
  logout: { label: '登出', className: 'bg-secondary text-foreground/70' },
  login_failed: { label: '登录失败', className: 'bg-amber-500/10 text-amber-700' },
  change_password: { label: '改密码', className: 'bg-amber-500/10 text-amber-700' },
  switch_channel: { label: '切换通道', className: 'bg-purple-500/10 text-purple-700' },
  seed_content: { label: '初始化内容', className: 'bg-secondary text-foreground/70' },
  bootstrap_admin: { label: '初始化管理员', className: 'bg-purple-500/10 text-purple-700' },
  reset_password: { label: '重置密码', className: 'bg-amber-500/10 text-amber-700' },
  bootstrap_denied: { label: '恢复口令被拒', className: 'bg-destructive/10 text-destructive' },
}

export function AuditPage() {
  const { data, loading, reload } = useAsync(() => adminAudit(200))
  const logs = data?.logs ?? []

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">操作日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            最近 {logs.length} 条记录 · 换届交接时可据此了解历次改动
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={reload} className="gap-1.5">
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> 刷新
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">时间</TableHead>
              <TableHead className="w-28">操作人</TableHead>
              <TableHead className="w-28">动作</TableHead>
              <TableHead className="w-28">对象</TableHead>
              <TableHead>详情</TableHead>
              <TableHead className="w-32">IP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {logs.map((log) => {
              const action = ACTION_LABELS[log.action] ?? {
                label: log.action,
                className: 'bg-secondary text-foreground/70',
              }
              return (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(log.created_at).toLocaleString('zh-CN')}
                  </TableCell>
                  <TableCell className="text-sm font-medium">{log.actor}</TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-0.5 text-xs', action.className)}>
                      {action.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{log.resource || '—'}</TableCell>
                  <TableCell className="max-w-[26rem] truncate text-xs text-muted-foreground" title={log.detail}>
                    {log.detail || '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{log.ip || '—'}</TableCell>
                </TableRow>
              )
            })}
            {!loading && logs.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                  暂无操作记录
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
