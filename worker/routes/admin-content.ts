/**
 * 后台内容管理接口（全部需要管理员会话）。
 *
 * 路由是「资源无关」的：/api/admin/content/:resource 支持 members|projects|news|slides，
 * 校验、SQL、审计都由 shared/resources.ts 的元数据驱动，新增内容类型无需改这里。
 */

import { adminRoleLabels } from '../../shared/identity'
import type { SmtpConfig } from '../../shared/mail'
import {
  RESOURCES,
  isResourceKey,
  validateEntity,
  type EntityValidationContext,
  type ResourceDef,
} from '../../shared/resources'
import { DEFAULT_RUNTIME_CONFIG, type RuntimeConfig, type SsoTarget } from '../../shared/runtime'
import type { SiteConfig } from '../../shared/types'
import {
  invalidateRuntimeConfigCache,
  publicRuntimeConfig,
  resolveRuntimeConfig,
  resolveStoredRuntimeConfig,
} from './config'
import { getMemberRoles } from '../lib/identity-config'
import { encryptMailPassword, mailPasswordSourceOf } from '../lib/mailer'
import { encryptSsoClientSecret, ssoClientSecretSourceOf } from '../lib/sso-config'
import { clientIp, fail, ok, readJsonBody } from '../lib/http'
import {
  countEntities,
  createEntity,
  deleteEntity,
  getEntity,
  getSiteConfig,
  listAuditLogs,
  listEntities,
  setConfigValue,
  setSiteConfig,
  updateEntity,
  writeAudit,
  type Entity,
} from '../lib/repo'
import type { RequestContext } from '../lib/router'
import { deleteStoredFile } from '../lib/storage'

function resolveDef(ctx: RequestContext) {
  const key = ctx.params.resource
  if (!isResourceKey(key)) return null
  return RESOURCES[key]
}

function actorOf(ctx: RequestContext): string {
  return ctx.admin?.username ?? '(unknown)'
}

function requestMeta(ctx: RequestContext) {
  return { ip: clientIp(ctx.request), ua: ctx.request.headers.get('user-agent') ?? '' }
}

/** 该资源是否含有「取值来自运行时字典」的字段（目前只有成员的角色） */
function usesRoleDictionary(def: ResourceDef): boolean {
  return def.fields.some((field) => field.optionsSource === 'memberRoles')
}

/**
 * 组装校验上下文：把**当前的方向字典**注入进来。
 *
 * 为什么非得在这里做：`shared/resources.ts` 里的 `options` 是模块加载时固定的兜底列表，
 * 而方向字典是管理员随时可改的运行时数据。只有这一层知道「此刻哪些方向合法」。
 *
 * 编辑一条已有记录时额外并上**它原来的取值**：方向改名之后旧值已经不在字典里了，
 * 但那条历史记录必须还能被改（否则管理员只是想把电话改一下，就会收到
 * 「「角色」的取值不合法」—— 这正是「旧值不回写」这个语义必须配套的东西）。
 */
async function validationContext(
  ctx: RequestContext,
  def: ResourceDef,
  before?: Entity,
): Promise<EntityValidationContext | undefined> {
  if (!usesRoleDictionary(def)) return undefined

  const labels = adminRoleLabels(await getMemberRoles(ctx.env))
  const existing = String(before?.title ?? '').trim()
  return { memberRoles: existing && !labels.includes(existing) ? [...labels, existing] : labels }
}

export async function listContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const search = ctx.url.searchParams.get('q') ?? undefined
  const limit = Number(ctx.url.searchParams.get('limit') ?? 500)
  const offset = Number(ctx.url.searchParams.get('offset') ?? 0)

  const [items, total] = await Promise.all([
    listEntities(ctx.env, def, { search, limit, offset }),
    countEntities(ctx.env, def, search),
  ])

  return ok({ resource: def.key, items, total })
}

export async function getContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const item = await getEntity(ctx.env, def, ctx.params.id)
  if (!item) return fail(404, 'NOT_FOUND', '记录不存在')
  return ok(item)
}

export async function createContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const body = await readJsonBody<Entity>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  const error = validateEntity(def, body, await validationContext(ctx, def))
  if (error) return fail(400, 'VALIDATION_FAILED', error)

  const created = await createEntity(ctx.env, def, body)
  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'create',
    resource: def.key,
    targetId: String(created.id),
    detail: JSON.stringify(body).slice(0, 500),
    ...requestMeta(ctx),
  })

  return ok(created, { status: 201 })
}

export async function updateContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const body = await readJsonBody<Entity>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  // 原记录要在校验之前取：校验「角色」这类运行时字典字段时，需要把它**原来的取值**并进白名单
  // （方向改名后旧值已不在字典里，但这条历史记录必须还能被编辑，见 validationContext）
  const before = await getEntity(ctx.env, def, ctx.params.id)
  if (!before) return fail(404, 'NOT_FOUND', '记录不存在')

  const error = validateEntity(def, body, await validationContext(ctx, def, before))
  if (error) return fail(400, 'VALIDATION_FAILED', error)

  const updated = await updateEntity(ctx.env, def, ctx.params.id, body)
  if (!updated) return fail(404, 'NOT_FOUND', '记录不存在')

  // 图片字段被替换时顺手删掉旧文件，避免桶里堆积孤儿文件
  for (const field of def.fields) {
    if (field.type !== 'image') continue
    const oldValue = before[field.key]
    if (typeof oldValue === 'string' && oldValue && oldValue !== body[field.key]) {
      await deleteStoredFile(ctx.env, oldValue)
    }
  }

  const changed = Object.keys(body).filter((key) => JSON.stringify(before[key]) !== JSON.stringify(body[key]))
  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'update',
    resource: def.key,
    targetId: ctx.params.id,
    detail: `字段：${changed.join(', ')}`,
    ...requestMeta(ctx),
  })

  return ok(updated)
}

export async function deleteContent(ctx: RequestContext): Promise<Response> {
  const def = resolveDef(ctx)
  if (!def) return fail(404, 'RESOURCE_NOT_FOUND', `未知的内容类型：${ctx.params.resource}`)

  const before = await getEntity(ctx.env, def, ctx.params.id)
  if (!before) return fail(404, 'NOT_FOUND', '记录不存在')

  const removed = await deleteEntity(ctx.env, def, ctx.params.id)
  if (!removed) return fail(404, 'NOT_FOUND', '记录不存在')

  // 删除记录时一并清理它引用的本站文件
  for (const field of def.fields) {
    if (field.type !== 'image') continue
    await deleteStoredFile(ctx.env, before[field.key] as string | undefined)
  }

  await writeAudit(ctx.env, {
    actor: actorOf(ctx),
    action: 'delete',
    resource: def.key,
    targetId: ctx.params.id,
    detail: String(before.name ?? before.title ?? ''),
    ...requestMeta(ctx),
  })

  return ok({ id: ctx.params.id })
}

// ===== 站点配置与流量开关 =====

export async function getAdminConfig(ctx: RequestContext): Promise<Response> {
  const [site, runtime] = await Promise.all([getSiteConfig(ctx.env), resolveRuntimeConfig(ctx)])
  return ok({
    site,
    // 后台同样拿不到密码 / 客户端密钥明文，只拿到「有没有配、配在哪」—— 所以表单留空即代表「不修改」
    runtime: publicRuntimeConfig(runtime),
    mailPasswordSource: mailPasswordSourceOf(ctx.env, runtime.mail),
    ssoClientSecretSource: ssoClientSecretSourceOf(ctx.env, runtime.sso),
  })
}

interface SiteConfigBody {
  site?: Partial<SiteConfig>
  runtime?: Partial<RuntimeConfig>
}

export async function updateAdminConfig(ctx: RequestContext): Promise<Response> {
  const body = await readJsonBody<SiteConfigBody>(ctx.request)
  if (!body) return fail(400, 'INVALID_BODY', '请求体必须是 JSON')

  let site: SiteConfig | null = null
  let runtime: RuntimeConfig | null = null
  let mailPasswordSource: 'database' | 'env' | 'none' | undefined
  let ssoClientSecretSource: 'database' | 'env' | 'none' | undefined

  if (body.site) {
    site = await setSiteConfig(ctx.env, body.site)
    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'update',
      resource: 'site_config',
      detail: JSON.stringify(body.site).slice(0, 500),
      ...requestMeta(ctx),
    })
  }

  if (body.runtime) {
    // ⚠️ 基线取**未解密**的那份：库里的凭据是 enc$ 密文，
    // 用解密后的明文当基线再写回，会把加密悄悄降级成明文
    const stored = await resolveStoredRuntimeConfig(ctx)

    // SMTP 密码单独处理：前端永远看不到原值，所以
    // 没带 password 键 = 不修改；带空串 = 清除；带内容 = 更新（落库前加密）
    const incomingMail: Partial<SmtpConfig> = { ...(body.runtime.mail ?? {}) }
    const submittedPassword =
      typeof incomingMail.password === 'string' ? incomingMail.password.trim() : undefined
    delete incomingMail.password

    let password = stored.mail.password ?? ''
    if (submittedPassword !== undefined) {
      password = submittedPassword ? await encryptMailPassword(ctx.env, submittedPassword) : ''
    }

    // SSO 客户端密钥同理（后端与前端共用同一套「留空 = 不修改」的约定）
    const incomingSso: Partial<SsoTarget> = { ...(body.runtime.sso ?? {}) }
    const submittedClientSecret =
      typeof incomingSso.clientSecret === 'string' ? incomingSso.clientSecret.trim() : undefined
    delete incomingSso.clientSecret

    let clientSecret = stored.sso.clientSecret ?? ''
    if (submittedClientSecret !== undefined) {
      clientSecret = submittedClientSecret
        ? await encryptSsoClientSecret(ctx.env, submittedClientSecret)
        : ''
    }

    // body.runtime 里可能夹带着提交上来的 mail / sso（含明文凭据），先摘掉再合并，免得明文进落库对象
    const restRuntime: Partial<RuntimeConfig> = { ...body.runtime }
    delete restRuntime.mail
    delete restRuntime.sso

    const next: RuntimeConfig = {
      ...DEFAULT_RUNTIME_CONFIG,
      ...stored,
      ...restRuntime,
      sso: { ...stored.sso, ...incomingSso, clientSecret },
      mail: { ...stored.mail, ...incomingMail, password },
      version: stored.version + 1,
      updatedAt: new Date().toISOString(),
    }
    await setConfigValue(ctx.env, 'runtime', next)
    await invalidateRuntimeConfigCache(ctx.env)
    // 凭据来源要在剥离前算（剥离后就看不出「数据库里有没有」了）
    mailPasswordSource = mailPasswordSourceOf(ctx.env, next.mail)
    ssoClientSecretSource = ssoClientSecretSourceOf(ctx.env, next.sso)
    // 回给前端的永远是剥离过的版本
    runtime = publicRuntimeConfig(next)

    const secretAction =
      submittedClientSecret === undefined ? '' : submittedClientSecret ? ' ssoKey=updated' : ' ssoKey=cleared'
    await writeAudit(ctx.env, {
      actor: actorOf(ctx),
      action: 'switch_channel',
      resource: 'runtime_config',
      detail: `sso=${next.sso.enabled ? 'on' : 'off'} mail=${next.mail.enabled ? 'on' : 'off'}${secretAction} → v${next.version}`,
      ...requestMeta(ctx),
    })
  }

  return ok({ site, runtime, mailPasswordSource, ssoClientSecretSource })
}

// ===== 概览与审计 =====

export async function getStats(ctx: RequestContext): Promise<Response> {
  const [members, projects, news, slides] = await Promise.all([
    countEntities(ctx.env, RESOURCES.members),
    countEntities(ctx.env, RESOURCES.projects),
    countEntities(ctx.env, RESOURCES.news),
    countEntities(ctx.env, RESOURCES.slides),
  ])

  const recent = await listEntities(ctx.env, RESOURCES.news, { limit: 5 })
  const recentMembers = await listEntities(ctx.env, RESOURCES.members, { limit: 5 })

  return ok({
    counts: { members, projects, news, slides },
    recentNews: recent,
    recentMembers,
  })
}

export async function getAudit(ctx: RequestContext): Promise<Response> {
  const limit = Number(ctx.url.searchParams.get('limit') ?? 100)
  const logs = await listAuditLogs(ctx.env, limit)
  return ok({ logs })
}
