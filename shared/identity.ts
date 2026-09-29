/**
 * 成员「方向 / 角色」字典 —— 前台、后台、邀请函三方共用的唯一契约。
 *
 * 这是一份**数据字典**：跨届通用、数量很少、一年改几次，由管理员在后台维护
 * （页面：内容管理 → 方向与身份），存储见 `worker/lib/identity-config.ts`。
 * 它不参与招新周期，也不随某一届招新重来。
 *
 * ---------------------------------------------------------------------------
 * 一、为什么 `members.title` 直接存中文名，而不是「稳定 id + 指针」
 * ---------------------------------------------------------------------------
 * 这是**刻意的取舍**，配套的语义是：
 *
 *     改名单只影响之后新增的记录；已经写进 members 的历史值**原样保留、不回写**。
 *
 * 也就是说，「方向」在成员记录里是**一份当时的快照**：19 级同学当年填的是
 * 「算法工程师」，后来我们把它改成「算法与 AI」，他的卡片仍然显示「算法工程师」。
 * 这正是我们要的效果 —— 不要因为一次改名，把整届历史的称谓都改掉
 * （那会让老成员的卡片和当年的合影、名单、新闻稿对不上）。
 *
 * 由此得到的三个好处，都是这一条语义直接带来的：
 *   1. **删除 / 改名一个方向永远是安全的**：历史数据自带显示文案，不依赖字典里还有没有它。
 *      所以这里不需要 `labelOf(...) ?? value` 那种「查不到就兜底」的翻译层 —— 少一层间接。
 *   2. **不需要数据迁移**：`members.title` 自 0001 起就是 TEXT，字典怎么改都不动表结构。
 *   3. **导出 / 审计直接可读**：CSV、日志里就是人能看懂的词，不用反查字典。
 *
 * 代价也如实写在这里：**做不到「一键把历史上的旧叫法统一改成新叫法」**。
 * 真需要时就是一条显式的 `UPDATE members SET title = ...`，属于有意为之的例外，
 * 不是这里的默认行为。若哪天真把「改名要追溯历史」当成常规需求，
 * 那才需要换成「存 id + 显示名走字典」的指针方案 —— 届时这个文件是唯一要改的契约层。
 *
 * ---------------------------------------------------------------------------
 * 二、边界：身份是组织授予的，不能自己填
 * ---------------------------------------------------------------------------
 * `kind !== 'student'` 的方向（指导老师、顾问…）**永远不能被学生自助选择**：
 * 邀请函只下发 `selectableBySelf === true` 的学生方向（见 `selfSelectableLabels()`），
 * 后端 `confirmInvite` 还会独立再校验一次 —— 即使有人绕过前端直接调接口，
 * 也不可能把自己写成「指导老师」。这是本文件存在的最初原因。
 */

/** 方向所属的群体。决定它能不能出现在「学生自助转正」的列表里。 */
export const MEMBER_ROLE_KINDS = ['student', 'faculty', 'staff'] as const
export type MemberRoleKind = (typeof MEMBER_ROLE_KINDS)[number]

export const MEMBER_ROLE_KIND_LABELS: Record<MemberRoleKind, string> = {
  student: '学生成员',
  faculty: '指导老师',
  staff: '管理岗',
}

export interface MemberRole {
  /**
   * 显示名 —— **同时也是入库值**（`members.title`）。
   * 因为 label 就是主键，所以它必须在字典内唯一，且**不要为了改措辞而删旧建新**：
   * 直接改这里的 label 即可，历史记录不会跟着变（见文件头「一」）。
   */
  label: string
  kind: MemberRoleKind
  /** 是否允许学生**本人**在邀请函里选择。非 student 一律为 false（后端强制纠正）。 */
  selectableBySelf: boolean
  /** 列表顺序，小的在前。 */
  order: number
  /**
   * 停用：不再出现在任何选择项里，但**保留在字典中**（历史记录照常显示、随时可重新启用）。
   * 与「删除」的区别：删除会把这条方向从字典里抹掉，而它只影响以后能不能选到它 ——
   * 两者都不会动任何已保存的成员记录。
   */
  retired: boolean
}

/** 未配置时的默认字典：内容与历史常量 `MEMBER_ROLES` 完全一致，所以升级前后前台无变化。 */
export const DEFAULT_MEMBER_ROLES: readonly MemberRole[] = [
  { label: '指导老师', kind: 'faculty', selectableBySelf: false, order: 0, retired: false },
  { label: '前端开发', kind: 'student', selectableBySelf: true, order: 10, retired: false },
  { label: '后端开发', kind: 'student', selectableBySelf: true, order: 20, retired: false },
  { label: '算法工程师', kind: 'student', selectableBySelf: true, order: 30, retired: false },
  { label: '移动端开发', kind: 'student', selectableBySelf: true, order: 40, retired: false },
  { label: 'UI 设计', kind: 'student', selectableBySelf: true, order: 50, retired: false },
  { label: '产品运营', kind: 'student', selectableBySelf: true, order: 60, retired: false },
]

/** 方向名的长度上限（与后台输入框一致，避免有人往字典里塞一整段话） */
export const MEMBER_ROLE_LABEL_MAX = 24
/** 字典规模上限：够用就行，防止误把整张表导进来 */
export const MEMBER_ROLE_LIMIT = 60

function cloneDefaultRoles(): MemberRole[] {
  return DEFAULT_MEMBER_ROLES.map((role) => ({ ...role }))
}

function isKind(value: unknown): value is MemberRoleKind {
  return MEMBER_ROLE_KINDS.includes(value as MemberRoleKind)
}

/** 按 order 升序；order 相同时保持原有先后（稳定排序），避免保存一次顺序就乱跳。 */
export function sortedMemberRoles(roles: readonly MemberRole[]): MemberRole[] {
  return roles
    .map((role, index) => ({ role, index }))
    .sort((a, b) => a.role.order - b.role.order || a.index - b.index)
    .map((item) => item.role)
}

/**
 * 读容错：把 KV / D1 里读到的任意 JSON 收敛成一份可用的字典。
 *
 * 与 `mergeCycle`（招新周期）同一路数 —— **不要把库里的 JSON 直接铺开回显**：
 * 老版本写下的键、被手工改坏的条目、重复的 label，都在这里被丢弃或纠正。
 * 任何异常都退回默认字典，绝不抛错（字典读不出来不该让整站跟着挂）。
 */
export function normalizeMemberRoles(raw: unknown): MemberRole[] {
  const rows = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const out: MemberRole[] = []

  rows.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const record = item as Record<string, unknown>
    // label 就是主键：空的、重复的（保留先出现的那个）一律丢弃
    const label = String(record.label ?? '').trim()
    if (!label || seen.has(label)) return
    seen.add(label)

    const kind: MemberRoleKind = isKind(record.kind) ? record.kind : 'student'
    const order = Number(record.order)

    out.push({
      label,
      kind,
      // 硬不变量：非学生方向永远不允许自助选择（写入侧会再次纠正，这里是读侧的防线）
      selectableBySelf: kind === 'student' && record.selectableBySelf === true,
      order: Number.isFinite(order) ? order : index * 10,
      retired: record.retired === true,
    })
  })

  // 空数组按「没配过」处理：退默认，而不是把一个空字典当成有效状态
  return out.length ? sortedMemberRoles(out) : cloneDefaultRoles()
}

/**
 * 写入校验（严格）：交给后台保存时用。
 *
 * 与 `normalizeMemberRoles` 的「宽容」是刻意分开的两个口径 ——
 * 读的时候要尽量把数据救回来，写的时候必须让管理员知道哪里填错了，
 * 不能悄悄丢掉他写的一整行。
 */
export function validateMemberRoles(input: unknown): { roles: MemberRole[]; error: string | null } {
  if (!Array.isArray(input)) return { roles: [], error: '提交的数据必须是一个方向列表' }
  if (input.length === 0) return { roles: [], error: '至少要保留一个方向' }
  if (input.length > MEMBER_ROLE_LIMIT) {
    return { roles: [], error: `方向最多 ${MEMBER_ROLE_LIMIT} 个` }
  }

  const seen = new Set<string>()
  const roles: MemberRole[] = []

  for (const [index, item] of input.entries()) {
    if (!item || typeof item !== 'object') {
      return { roles: [], error: `第 ${index + 1} 条不是合法的方向内容` }
    }
    const record = item as Record<string, unknown>
    const label = String(record.label ?? '').trim()
    if (!label) return { roles: [], error: `第 ${index + 1} 条没有填方向名` }
    if (label.length > MEMBER_ROLE_LABEL_MAX) {
      return { roles: [], error: `「${label}」太长了，方向名不要超过 ${MEMBER_ROLE_LABEL_MAX} 个字` }
    }
    if (seen.has(label)) {
      // label 就是 members.title 的取值，重复会导致两条不同的方向在数据里无法区分
      return { roles: [], error: `方向名重复：「${label}」` }
    }
    seen.add(label)

    const kind: MemberRoleKind = isKind(record.kind) ? record.kind : 'student'
    const order = Number(record.order)
    roles.push({
      label,
      kind,
      // 非学生方向一律强制关闭自助选择：与其报错，不如直接纠正 ——
      // 「指导老师」本来就不该出现在学生能选的地方，这是不变量而不是偏好。
      selectableBySelf: kind === 'student' && record.selectableBySelf === true,
      order: Number.isFinite(order) ? order : index * 10,
      retired: record.retired === true,
    })
  }

  return { roles: sortedMemberRoles(roles), error: null }
}

/** 未停用的方向（后台表格、下拉用） */
export function activeRoles(roles: readonly MemberRole[]): MemberRole[] {
  return roles.filter((role) => !role.retired)
}

/** 后台选择项：未停用的全部方向名 */
export function adminRoleLabels(roles: readonly MemberRole[]): string[] {
  return activeRoles(roles).map((role) => role.label)
}

/**
 * 学生能自助选择的方向名 —— 邀请函下发的就是这一份，`confirmInvite` 也只放行这一份。
 *
 * 三个条件缺一不可：是学生方向、允许自助选择、没有停用。
 */
export function selfSelectableLabels(roles: readonly MemberRole[]): string[] {
  return roles
    .filter((role) => !role.retired && role.kind === 'student' && role.selectableBySelf)
    .map((role) => role.label)
}

/** 某个方向名此刻是否允许学生自助选择（`confirmInvite` 的唯一判据） */
export function isSelfSelectable(roles: readonly MemberRole[], label: string): boolean {
  return selfSelectableLabels(roles).includes(label)
}
