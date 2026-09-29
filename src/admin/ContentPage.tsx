import { useCallback, useEffect, useMemo, useState } from 'react'
import { Navigate, useParams } from 'react-router'
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
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ImageField, ImageThumb } from './ImageField'
import {
  RESOURCES,
  defaultEntity,
  isFieldActive,
  isResourceKey,
  validateEntity,
  type FieldDef,
  type ResourceBulkDef,
  type ResourceDef,
} from '@shared/resources'
import {
  adminDeleteContent,
  adminCreateContent,
  adminUpdateContent,
  adminListContent,
  adminSendDestinationMails,
  adminMemberRoles,
} from '@/api/endpoints'
import { GraduateWizard } from './GraduateWizard'
import { adminRoleLabels } from '@shared/identity'
import { ApiError } from '@/api/client'
import { cn } from '@/lib/utils'
import { GraduationCap, Loader2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type Entity = Record<string, unknown>

/** 单个字段的编辑控件，按 FieldDef.type 分发 */
function FieldControl({
  field,
  value,
  onChange,
}: {
  field: FieldDef
  value: unknown
  onChange: (next: unknown) => void
}) {
  switch (field.type) {
    case 'image':
      return (
        <ImageField value={value} onChange={onChange} scope={field.scope} shape={field.preview ?? 'square'} />
      )
    case 'textarea':
      return (
        <Textarea
          value={String(value ?? '')}
          rows={field.key === 'content' ? 8 : 3}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    case 'select':
      return (
        <Select value={String(value ?? '')} onValueChange={onChange}>
          <SelectTrigger>
            <SelectValue placeholder="请选择" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? []).map((option) => (
              <SelectItem key={option} value={option}>
                {field.optionLabels?.[option] ?? option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    case 'switch':
      return (
        <div className="flex h-9 items-center">
          <Switch checked={Boolean(value)} onCheckedChange={onChange} />
          <span className="ml-2.5 text-sm text-muted-foreground">{value ? '是' : '否'}</span>
        </div>
      )
    case 'number':
      return (
        <Input
          type="number"
          value={String(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      )
    case 'date':
      return <Input type="date" value={String(value ?? '')} onChange={(e) => onChange(e.target.value)} />
    case 'tags':
      return (
        <Input
          value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
          placeholder={field.placeholder ?? '用逗号分隔'}
          onChange={(e) => onChange(e.target.value)}
        />
      )
    default:
      return (
        <Input
          value={String(value ?? '')}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )
  }
}

/** 表格单元格展示 */
function CellValue({ field, entity }: { field: FieldDef; entity: Entity }) {
  const value = entity[field.key]
  if (field.type === 'image') {
    return (
      <ImageThumb
        src={typeof value === 'string' ? value : ''}
        alt={String(entity.name ?? entity.title ?? '')}
        className={cn(field.preview === 'circle' && 'rounded-full', field.preview === 'wide' && 'w-16')}
      />
    )
  }
  if (field.type === 'switch') {
    return (
      <span className={value ? 'text-emerald-600' : 'text-muted-foreground'}>{value ? '是' : '否'}</span>
    )
  }
  if (field.type === 'select' && (field.options ?? []).includes('current')) {
    return (
      <span className={cn('rounded-full px-2 py-0.5 text-xs', value === 'current' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-secondary text-muted-foreground')}>
        {value === 'current' ? '在组' : '已毕业'}
      </span>
    )
  }
  if (field.type === 'tags') {
    const tags = Array.isArray(value) ? value : []
    return (
      <span className="flex flex-wrap gap-1">
        {tags.slice(0, 3).map((t) => (
          <span key={String(t)} className="rounded-full bg-secondary px-2 py-0.5 text-xs">
            {String(t)}
          </span>
        ))}
      </span>
    )
  }
  const text =
    field.type === 'select'
      ? (field.optionLabels?.[String(value ?? '')] ?? String(value ?? ''))
      : String(value ?? '')
  return (
    <span className={cn('block truncate', field.compact ? 'max-w-[8rem]' : 'max-w-[22rem]')} title={text}>
      {text || <span className="text-muted-foreground">—</span>}
    </span>
  )
}

export function ContentPage() {
  const { resource } = useParams<{ resource: string }>()
  const def: ResourceDef | null = resource && isResourceKey(resource) ? RESOURCES[resource] : null

  const [items, setItems] = useState<Entity[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState<Entity | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  /** 正在编辑的那条记录的原值；校验「角色」时要把它并进白名单（见下面的 resolvedFields） */
  const [original, setOriginal] = useState<Entity | null>(null)
  const [deleting, setDeleting] = useState<Entity | null>(null)
  const [saving, setSaving] = useState(false)
  /** 运行时方向字典里可用的方向名（进页时拉一次） */
  const [roleLabels, setRoleLabels] = useState<string[]>([])
  /** 分组页签（只有配了 def.groups 的资源用得到，目前是成员的「在组 / 已毕业」） */
  const [tab, setTab] = useState('')
  /** 勾选的行 id（给批量动作用） */
  const [selected, setSelected] = useState<string[]>([])
  /** 待执行的批量动作；非空即弹窗 —— 带 wizard 的走专属向导，其余走简单确认框 */
  const [bulkRequest, setBulkRequest] = useState<ResourceBulkDef | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)

  const groups = def?.groups
  const activeTab = groups ? tab || groups.tabs[0].value : ''
  /** 批量动作按页签收敛：「批量毕业」只出现在「在组」，「发送去向征集」只出现在「已毕业」 */
  const bulkDefs = useMemo(
    () => (def?.bulk ?? []).filter((item) => !item.tabs || item.tabs.includes(activeTab)),
    [def, activeTab],
  )

  /** 页签只做界面层过滤：列表按分组字段取值筛。 */
  const visibleItems = useMemo(
    () => (groups ? items.filter((item) => String(item[groups.key] ?? '') === activeTab) : items),
    [items, groups, activeTab],
  )

  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    if (!groups) return counts
    for (const item of items) {
      const value = String(item[groups.key] ?? '')
      counts[value] = (counts[value] ?? 0) + 1
    }
    return counts
  }, [items, groups])

  /**
   * 列集合跟着页签走：`showWhen` 在这里第二次派上用场 ——
   * 成员的「毕业去向」只在 status=alumni 时生效，所以在「在组」视图里它连列都不出现，
   * 反之「负责方向」也不会出现在「已毕业」视图里。
   */
  const listFields = useMemo(
    () =>
      def
        ? def.fields.filter(
            (field) => field.inList && (!groups || isFieldActive(field, { [groups.key]: activeTab })),
          )
        : [],
    [def, groups, activeTab],
  )

  /** 本资源是否用到了「取值来自运行时字典」的字段（目前只有成员的角色） */
  const usesRoleDictionary = useMemo(
    () => Boolean(def?.fields.some((field) => field.optionsSource === 'memberRoles')),
    [def],
  )

  useEffect(() => {
    if (!usesRoleDictionary) return
    let active = true
    adminMemberRoles()
      .then((result) => {
        // 未停用的方向（含"允许学生自选"与否 —— 后台不受那条限制，它只约束邀请函）
        if (active) setRoleLabels(adminRoleLabels(result.roles))
      })
      .catch(() => {
        // 拉不到就退回 shared/resources.ts 里写死的兜底选项，不阻断内容管理
      })
    return () => {
      active = false
    }
  }, [usesRoleDictionary])

  /**
   * 解析 select 字段此刻的可选值。
   *
   * 「角色」来自运行时字典，而字典是可以被改名的，所以这里要把**这条记录原来的取值**
   * 一并列出来（标注「历史值」）—— 与 Worker 侧 validateEntity 的 ctx 完全同一套规则：
   * 新建只能用当前列表里的方向，编辑时额外允许保留它原本的那个值。
   * 否则会出现「管理员只想改个电话，却被要求先改掉角色」。
   */
  const resolvedFields = useMemo(() => {
    if (!def) return []
    const current = original ? String(original.title ?? '').trim() : ''
    const options = current && !roleLabels.includes(current) ? [...roleLabels, current] : roleLabels

    return def.fields.map((field) => {
      if (field.optionsSource !== 'memberRoles') return field
      const optionLabels: Record<string, string> = { ...field.optionLabels }
      for (const option of options) {
        if (!roleLabels.includes(option)) optionLabels[option] = `${option}（历史值，不在当前列表）`
      }
      return { ...field, options, optionLabels }
    })
  }, [def, original, roleLabels])

  const load = useCallback(async () => {
    if (!def) return
    setLoading(true)
    try {
      const response = await adminListContent(def.key, { q: search || undefined })
      setItems(response.items as Entity[])
      setTotal(response.total)
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [def, search])

  useEffect(() => {
    void load()
  }, [load])

  if (!def) return <Navigate to="/admin" replace />

  const openCreate = () => {
    setEditingId(null)
    setOriginal(null)
    const blank = defaultEntity(def)
    // 在哪个页签新增，分组字段就预置成那个值（「已毕业」页签里新增 → 直接是已毕业）
    if (groups?.prefillOnCreate) blank[groups.key] = activeTab
    setDraft(blank)
  }

  const openEdit = (entity: Entity) => {
    setEditingId(String(entity.id))
    // 记下原值：角色下拉要把它列进去（方向改名后旧值已不在字典里，但必须还能被保留）
    setOriginal(entity)
    const next: Entity = {}
    for (const field of def.fields) {
      const value = entity[field.key]
      next[field.key] = field.type === 'tags' && Array.isArray(value) ? value.join(', ') : (value ?? '')
    }
    setDraft(next)
  }

  const save = async () => {
    if (!draft) return
    const payload: Entity = {}
    for (const field of def.fields) {
      const value = draft[field.key]
      payload[field.key] =
        field.type === 'tags'
          ? String(value ?? '')
              .split(/[,，、]+/)
              .map((s) => s.trim())
              .filter(Boolean)
          : value
    }

    // 提交前先跑一遍与 Worker 完全相同的校验（同一个 validateEntity）：
    // 「新增 / 编辑」时所有必填字段（含按 status 切换的负责方向 / 毕业去向）都必须已填写，
    // 本地先拦一次，免得白跑一趟接口才拿到 400。
    // 方向字典字段要把当前选项一并传进去 —— Worker 侧注入的是同一份规则（见 admin-content.ts）。
    const roleField = resolvedFields.find((field) => field.optionsSource === 'memberRoles')
    const invalid = validateEntity(
      def,
      payload,
      roleField ? { memberRoles: roleField.options } : undefined,
    )
    if (invalid) {
      toast.error(invalid)
      return
    }

    setSaving(true)
    try {
      if (editingId) {
        await adminUpdateContent(def.key, editingId, payload)
        toast.success('已保存修改')
      } else {
        await adminCreateContent(def.key, payload)
        toast.success(`已新增${def.singular}`)
      }
      setDraft(null)
      setEditingId(null)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (!deleting) return
    try {
      await adminDeleteContent(def.key, String(deleting.id))
      toast.success('已删除')
      setDeleting(null)
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : '删除失败')
    }
  }

  /**
   * 执行**简单**批量动作（走确认框的那些）。
   * 「到了说再见的时候了」不在这里 —— 它有自己的两步向导 `GraduateWizard`；
   * 接口语义都留在各自的 worker 路由里，前端不做取舍。
   */
  const runBulk = async () => {
    if (!bulkRequest) return
    setBulkRunning(true)
    try {
      const result = await adminSendDestinationMails(selected)
      toast.success(`${bulkRequest.label}完成`, { description: result.message })
      setBulkRequest(null)
      setSelected([])
      await load()
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : `${bulkRequest.label}失败`)
    } finally {
      setBulkRunning(false)
    }
  }

  const hasBulk = bulkDefs.length > 0
  const allVisibleSelected =
    visibleItems.length > 0 && visibleItems.every((item) => selected.includes(String(item.id)))

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">{def.label}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {def.description} · 共 {total} 条
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索…"
              className="w-44 pl-8"
            />
          </div>
          <Button variant="outline" size="icon" onClick={() => void load()} title="刷新">
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button onClick={openCreate} className="gap-1.5">
            <Plus className="h-4 w-4" /> 新增{def.singular}
          </Button>
        </div>
      </div>

      {/* ===== 分组页签：在组 / 已毕业（只有配了 def.groups 的资源才有） ===== */}
      {groups && (
        <div className="mb-4 flex items-center gap-2">
          {groups.tabs.map((item) => (
            <button
              key={item.value}
              onClick={() => {
                setTab(item.value)
                setSelected([])
              }}
              className={cn(
                'rounded-full px-5 py-2 text-sm transition-colors',
                activeTab === item.value
                  ? 'bg-primary text-primary-foreground'
                  : 'border border-border text-foreground/70 hover:bg-secondary',
              )}
            >
              {item.label} {tabCounts[item.value] ?? 0}
            </button>
          ))}
        </div>
      )}

      {/* ===== 批量动作条 =====
          带 preselect 的动作（毕业向导）不用先勾选，所以这一条一直显示；
          其余动作要先勾人，没勾就置灰。 */}
      {hasBulk && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-secondary/40 px-4 py-2.5">
          <span className="text-sm text-muted-foreground">
            已勾选 <strong className="text-foreground">{selected.length}</strong> 条
          </span>
          {bulkDefs.map((item) => (
            <Button
              key={item.kind}
              size="sm"
              className="gap-1.5"
              title={item.hint}
              disabled={bulkRunning || (!item.preselect && selected.length === 0)}
              onClick={() => setBulkRequest(item)}
            >
              <GraduationCap className="h-3.5 w-3.5" /> {item.label}
            </Button>
          ))}
          {selected.length > 0 && (
            <button
              onClick={() => setSelected([])}
              className="ml-auto text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              清空勾选
            </button>
          )}
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {hasBulk && (
                <TableHead className="w-10">
                  <Checkbox
                    checked={allVisibleSelected}
                    onCheckedChange={(checked) =>
                      setSelected(checked ? visibleItems.map((item) => String(item.id)) : [])
                    }
                  />
                </TableHead>
              )}
              <TableHead className="w-12">#</TableHead>
              {listFields.map((field) => (
                <TableHead key={field.key}>{field.label}</TableHead>
              ))}
              <TableHead className="w-24 text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visibleItems.map((entity, index) => {
              const rowId = String(entity.id)
              return (
                <TableRow key={rowId}>
                  {hasBulk && (
                    <TableCell>
                      <Checkbox
                        checked={selected.includes(rowId)}
                        onCheckedChange={(checked) =>
                          setSelected((prev) =>
                            checked ? [...prev, rowId] : prev.filter((id) => id !== rowId),
                          )
                        }
                      />
                    </TableCell>
                  )}
                  <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                  {listFields.map((field) => (
                    <TableCell key={field.key}>
                      <CellValue field={field} entity={entity} />
                    </TableCell>
                  ))}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => openEdit(entity)}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                        title="编辑"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setDeleting(entity)}
                        className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        title="删除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
            {!loading && visibleItems.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={listFields.length + 2 + (hasBulk ? 1 : 0)}
                  className="py-14 text-center text-sm text-muted-foreground"
                >
                  {groups ? `暂无「${groups.tabs.find((t) => t.value === activeTab)?.label ?? ''}」记录` : '暂无数据'}
                </TableCell>
              </TableRow>
            )}
            {loading && (
              <TableRow>
                <TableCell
                  colSpan={listFields.length + 2 + (hasBulk ? 1 : 0)}
                  className="py-14 text-center text-sm text-muted-foreground"
                >
                  加载中…
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {/* ===== 新增 / 编辑 ===== */}
      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle className="font-display text-xl">
              {editingId ? `编辑${def.singular}` : `新增${def.singular}`}
            </DialogTitle>
          </DialogHeader>

          {draft && (
            <div className="grid gap-4 py-2">
              {resolvedFields
                // showWhen：按另一个字段的取值决定是否显示（如「在组」只填负责方向、轮播的图片只在图片版显示）
                .filter((field) => isFieldActive(field, draft))
                .map((field) => (
                  <div key={field.key} className="grid gap-1.5">
                    <Label>
                      {field.label}
                      {/* requiredWhen 的字段只在该条件成立时才渲染（上面已用 isFieldActive 过滤过），
                          所以这里直接按「有 requiredWhen 即此时必填」标注星号 */}
                      {(field.required || field.requiredWhen) && (
                        <span className="ml-0.5 text-destructive">*</span>
                      )}
                    </Label>
                    <FieldControl
                      field={field}
                      value={draft[field.key]}
                      onChange={(next) => setDraft({ ...draft, [field.key]: next })}
                    />
                    {field.hint && <p className="text-[11px] text-muted-foreground">{field.hint}</p>}
                  </div>
                ))}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setDraft(null)}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? '保存中…' : editingId ? '保存修改' : '确认新增'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ===== 毕业向导：「到了说再见的时候了」走这条（默认勾好最晚一届 → 寄信） ===== */}
      {bulkRequest?.wizard && (
        <GraduateWizard
          items={items}
          onClose={() => setBulkRequest(null)}
          onFinished={async () => {
            setSelected([])
            await load()
          }}
        />
      )}

      {/* ===== 批量动作确认（简单动作：发送去向征集） ===== */}
      <AlertDialog
        open={bulkRequest !== null && !bulkRequest.wizard}
        onOpenChange={(open) => {
          if (!open && !bulkRunning) setBulkRequest(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {(bulkRequest?.confirmTitle ?? `确认${bulkRequest?.label ?? ''}？`).replace(
                '{n}',
                String(selected.length),
              )}
            </AlertDialogTitle>
            <AlertDialogDescription>{bulkRequest?.confirmNote}</AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkRunning}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={bulkRunning}
              onClick={(event) => {
                // 发送是慢操作：先别让弹窗关掉，跑完由 runBulk 自己收尾
                event.preventDefault()
                void runBulk()
              }}
            >
              {bulkRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> 处理中…
                </>
              ) : (
                `确认${bulkRequest?.label ?? ''}`
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ===== 删除确认 ===== */}
      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认删除该{def.singular}？</AlertDialogTitle>
            <AlertDialogDescription>
              将删除「{String(deleting?.name ?? deleting?.title ?? deleting?.kicker ?? '')}」，此操作不可撤销。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void remove()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              确认删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
