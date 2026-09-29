import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { adminMemberRoles, adminUpdateMemberRoles } from '@/api/endpoints'
import { ApiError } from '@/api/client'
import {
  MEMBER_ROLE_KIND_LABELS,
  MEMBER_ROLE_KINDS,
  MEMBER_ROLE_LABEL_MAX,
  sortedMemberRoles,
  validateMemberRoles,
  type MemberRole,
  type MemberRoleKind,
} from '@shared/identity'
import { ArrowDown, ArrowUp, Info, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

/**
 * 表格行的本地标识 —— **只用于 React 列表渲染，不参与保存**。
 *
 * 为什么必须有它：方向名（label）是这一行里**可编辑的输入**，所以它绝不能当 React 的 key。
 * 拿它当 key 的话，敲一个字 → key 变 → React 认为这是「另一行」→ 卸载重建输入框 →
 * 焦点丢失（中文输入法更是直接断在合成途中），表现出来就是「编辑框没法正常打字」。
 * 用一个与内容无关的稳定 id，输入过程中 key 不变，DOM 节点就不会被重建。
 */
type EditableRole = MemberRole & { rowId: string }

let rowSeq = 0
function newRowId(): string {
  rowSeq += 1
  return `role-row-${rowSeq}`
}

/**
 * 「方向与身份」管理页（内容管理 → 方向与身份）。
 *
 * 这份字典决定：邀请函转正时学生能选什么方向、后台编辑成员时角色下拉里有什么。
 * 它**不是**招新周期的一部分 —— 招新一届一届地重来，方向是跨届通用的。
 *
 * 页面交互刻意做成「整表编辑 + 一次保存」：存储形态是一个 JSON 数组，
 * 逐条即时保存会引入一堆半写状态（见 worker/routes/admin-roles.ts 的说明）。
 */
export function MemberRolesPage() {
  const [rows, setRows] = useState<EditableRole[]>([])
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [kvReady, setKvReady] = useState(true)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  /** 上次载入 / 保存成功的快照，用来判断「有没有改动」 */
  const [snapshot, setSnapshot] = useState('')
  /** 后端拒绝了「移除还有人在用的方向」时，把冲突信息挂在这里等确认 */
  const [conflict, setConflict] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await adminMemberRoles()
      const loaded: EditableRole[] = sortedMemberRoles(result.roles).map((role) => ({
        ...role,
        rowId: newRowId(),
      }))
      setRows(loaded)
      setUsage(result.usage)
      setKvReady(result.kvReady)
      setSnapshot(JSON.stringify(loaded))
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载方向列表失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /**
   * 行内改动统一走这里：改完立刻按数组顺序重排 order。
   * 让「数组顺序」永远等于「显示顺序」，排序就不会出现两个方向抢同一个 order 的诡异情况。
   */
  const commit = (next: EditableRole[]) => {
    setRows(next.map((role, index) => ({ ...role, order: index * 10 })))
  }

  const patch = (index: number, changes: Partial<MemberRole>) => {
    commit(rows.map((role, i) => (i === index ? { ...role, ...changes } : role)))
  }

  const move = (index: number, delta: number) => {
    const target = index + delta
    if (target < 0 || target >= rows.length) return
    const next = [...rows]
    ;[next[index], next[target]] = [next[target], next[index]]
    commit(next)
  }

  const remove = (index: number) => {
    commit(rows.filter((_, i) => i !== index))
  }

  const add = () => {
    commit([
      ...rows,
      {
        rowId: newRowId(),
        label: '',
        kind: 'student',
        selectableBySelf: true,
        order: rows.length * 10,
        retired: false,
      },
    ])
  }

  const dirty = useMemo(() => JSON.stringify(rows) !== snapshot, [rows, snapshot])

  const save = async (confirmRemoval = false) => {
    // 用**后端同一个**校验函数先跑一遍，避免白跑一趟接口才拿到 400（也保证前后端口径一致）
    const { roles, error } = validateMemberRoles(rows)
    if (error) {
      toast.error(error)
      return
    }

    setSaving(true)
    try {
      const result = await adminUpdateMemberRoles(roles, confirmRemoval)
      // 保存后以服务端返回的规范化结果为准，但**按位置保留本地的 rowId**：
      // 换了新 rowId 会让整张表重建、把正在编辑的输入框焦点弄丢。
      // 位置能对齐是因为提交前 order 已按显示顺序写成 i*10，服务端也按 order 排序。
      const saved: EditableRole[] = sortedMemberRoles(result.roles).map((role, index) => ({
        ...role,
        rowId: rows[index]?.rowId ?? newRowId(),
      }))
      setRows(saved)
      setUsage(result.usage)
      setKvReady(result.kvReady)
      setSnapshot(JSON.stringify(saved))
      setConflict(null)
      toast.success(
        result.droppedInUse?.length
          ? `已保存；移除了 ${result.droppedInUse.join('、')}（已有成员不受影响）`
          : '已保存方向列表',
      )
    } catch (error) {
      // 409 ROLE_IN_USE：后端拦下了「移除还有人在用的方向」，交给管理员再确认一次
      if (error instanceof ApiError && error.code === 'ROLE_IN_USE') {
        setConflict(error.message)
      } else {
        toast.error(error instanceof ApiError ? error.message : '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">方向与身份</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            成员卡片的角色标签、邀请函转正时的可选项，都来自这份列表 · 共 {rows.length} 个
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={() => void load()} title="重新载入（放弃未保存的改动）">
            <RefreshCw className="h-4 w-4" />
          </Button>
          <Button disabled={!dirty || saving} onClick={() => void save()}>
            {saving ? '保存中…' : '保存'}
          </Button>
        </div>
      </div>

      {/* 这份说明不是装饰：字典语义（改了名单历史怎么办）不写在界面上，管理员一定会误操作 */}
      <div className="mb-5 flex gap-3 rounded-xl border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <div className="space-y-1">
          <p>
            <span className="text-foreground">改名单只影响之后新增的成员。</span>
            已经保存过的成员保留他们当时的角色名（例如把「算法工程师」改成「算法与 AI」，
            老成员的卡片仍显示「算法工程师」）—— 这是刻意的，避免一次改名把历届记录都改掉。
          </p>
          <p>
            <span className="text-foreground">「停用」</span>
            只是让它不再出现在选择项里，随时可以启用回来；
            <span className="text-foreground">「删除」</span>
            会把它从列表里去掉，两者都不会动任何已有成员的资料。
          </p>
          <p>
            标为<span className="text-foreground">非「学生成员」</span>的方向（指导老师、管理岗）
            <span className="text-foreground">不会出现在邀请函里</span>，同学无法自助选择这类身份。
          </p>
          {!kvReady ? (
            <p className="text-amber-600">
              当前环境没有绑定 KV，这份列表存放在 D1（功能完全一致，只是没有边缘缓存）。
            </p>
          ) : null}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[12rem]">方向名</TableHead>
              <TableHead className="w-36">群体</TableHead>
              <TableHead className="w-32">学生可自选</TableHead>
              <TableHead className="w-24">使用中</TableHead>
              <TableHead className="w-24">状态</TableHead>
              <TableHead className="w-32 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((role, index) => (
              // key 用与内容无关的 rowId：label 是这个表格里可编辑的输入，
              // 拿它当 key 会导致「敲一个字就重建输入框、焦点丢失」（见文件头 EditableRole 的说明）
              <TableRow key={role.rowId} className={role.retired ? 'opacity-60' : undefined}>
                <TableCell>
                  <Input
                    value={role.label}
                    maxLength={MEMBER_ROLE_LABEL_MAX}
                    placeholder="如：前端开发"
                    onChange={(e) => patch(index, { label: e.target.value })}
                  />
                </TableCell>
                <TableCell>
                  <Select
                    value={role.kind}
                    onValueChange={(value: MemberRoleKind) =>
                      // 切到非学生群体时顺手关掉自助选择：与后端的不变量保持一致，
                      // 否则界面上会短暂出现一个「指导老师 · 学生可自选」的非法组合
                      patch(index, {
                        kind: value,
                        selectableBySelf: value === 'student' ? role.selectableBySelf : false,
                      })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {MEMBER_ROLE_KINDS.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {MEMBER_ROLE_KIND_LABELS[kind]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell>
                  <Switch
                    checked={role.selectableBySelf}
                    disabled={role.kind !== 'student'}
                    onCheckedChange={(checked) => patch(index, { selectableBySelf: checked })}
                  />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {usage[role.label] ? `${usage[role.label]} 人` : '—'}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={!role.retired}
                      onCheckedChange={(checked) => patch(index, { retired: !checked })}
                    />
                    <span className="text-xs text-muted-foreground">{role.retired ? '停用' : '启用'}</span>
                  </div>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <button
                      onClick={() => move(index, -1)}
                      disabled={index === 0}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      title="上移"
                    >
                      <ArrowUp className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => move(index, 1)}
                      disabled={index === rows.length - 1}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-30"
                      title="下移"
                    >
                      <ArrowDown className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(index)}
                      className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                      title="移除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {!loading && rows.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                  还没有任何方向，点下面的「新增方向」开始
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell colSpan={6} className="py-14 text-center text-sm text-muted-foreground">
                  加载中…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={add} className="gap-1.5">
          <Plus className="h-4 w-4" /> 新增方向
        </Button>
        <p className="text-xs text-muted-foreground">
          {dirty ? '有未保存的改动' : '与线上一致'} · 改完记得点右上角「保存」
        </p>
      </div>

      {/* 后端拒绝「移除还有人在用的方向」时的二次确认 */}
      <AlertDialog open={conflict !== null} onOpenChange={(open) => !open && setConflict(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认移除这些方向？</AlertDialogTitle>
            <AlertDialogDescription>{conflict}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => void save(true)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              确认移除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
