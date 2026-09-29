/**
 * 邮件日志：谁在什么时候收到了哪封信、结果如何。
 *
 * 发信失败**不阻断流程**（状态照常推进），失败的可以在「名单」里对那个人重发；
 * 关闭本届时这份日志会随报名数据一起清空。
 */

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Loader2, Mail, RefreshCw } from 'lucide-react'
import { RECRUIT_MAIL_META, RECRUIT_MAIL_KINDS, type RecruitMailKind } from '@shared/recruit'
import { formatTime } from './recruit-ui'
import type { RecruitAdmin } from './useRecruitAdmin'

/** 日志里的 kind 是自由文本（含「自定义通知」与关闭本届这类非模板记录） */
function mailLabel(kind: string): string {
  if ((RECRUIT_MAIL_KINDS as readonly string[]).includes(kind)) {
    return RECRUIT_MAIL_META[kind as RecruitMailKind].label
  }
  if (kind === 'close_cycle') return '关闭本届'
  return '自定义通知'
}

export function RecruitMailView({ admin }: { admin: RecruitAdmin }) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">邮件日志</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            最近 {admin.mails.length} 条。发信失败不影响流程推进，可以在「名单」里对那个人重发。
            关闭本届时这份日志会随报名数据一起清空。
          </p>
        </div>
        <Button variant="outline" className="gap-1.5" onClick={admin.reload} disabled={admin.loading}>
          {admin.loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          刷新
        </Button>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-44">时间</TableHead>
              <TableHead className="w-40">信件</TableHead>
              <TableHead className="w-56">收件人</TableHead>
              <TableHead className="w-24">结果</TableHead>
              <TableHead>说明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {admin.mails.map((mail) => (
              <TableRow key={mail.id}>
                <TableCell className="text-xs text-muted-foreground">{formatTime(mail.createdAt)}</TableCell>
                <TableCell className="text-xs">{mailLabel(mail.kind)}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{mail.recipient || '—'}</TableCell>
                <TableCell className="text-xs">
                  {mail.ok ? (
                    <span className="text-emerald-700">已发出</span>
                  ) : (
                    <span className="text-destructive">{mail.code || '失败'}</span>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  <div className="truncate">{mail.subject}</div>
                  {!mail.ok && <div className="text-muted-foreground">{mail.message}</div>}
                </TableCell>
              </TableRow>
            ))}
            {admin.mails.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-14">
                  <div className="flex flex-col items-center text-center">
                    <Mail className="h-6 w-6 text-muted-foreground" />
                    <p className="mt-3 text-sm text-muted-foreground">
                      还没有发过信。确认笔试名单之后，这里会出现每一封邀请函与感谢信。
                    </p>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
