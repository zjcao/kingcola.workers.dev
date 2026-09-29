/**
 * 拾光工作室官网 · Worker 入口
 *
 * 静态资源由 Cloudflare 直接返回（wrangler.toml 里 run_worker_first = ["/api/*"]），
 * 只有 /api/* 会进入本函数，因此静态访问不消耗 Worker 调用配额。
 */

import type { Env } from './env'
import { readSession } from './lib/auth'
import { fail, preflight, withCors } from './lib/http'
import { warmSecrets } from './lib/secrets'
import { matchRoute, type RequestContext, type RouteDef } from './lib/router'
import { readStudentSession } from './lib/student-auth'
import {
  bootstrap,
  changePassword,
  login,
  logout,
  me,
  seedContent,
} from './routes/admin-auth'
import {
  bulkApplicationsAdmin,
  createApplicationAdmin,
  deleteApplicationAdmin,
  downloadApplicationFile,
  getApplicationAdmin,
  listApplicationsAdmin,
  notifyApplicationsAdmin,
  updateApplicationAdmin,
  uploadApplicationDocAdmin,
} from './routes/admin-applications'
import {
  createContent,
  deleteContent,
  getAdminConfig,
  getAudit,
  getContent,
  getStats,
  listContent,
  updateAdminConfig,
  updateContent,
} from './routes/admin-content'
import { graduateMembers, sendDestinationMails } from './routes/admin-members'
import {
  exportRecruitCsv,
  getRecruitMails,
  getRecruitSettingsRoute,
  getRecruitStats,
  issueCheckinCode,
  listCheckinCodes,
  revokeCheckinCode,
  runRecruitActionRoute,
  updateRecruitSettings,
} from './routes/admin-recruit'
import { getMemberRolesAdmin, updateMemberRolesAdmin } from './routes/admin-roles'
import {
  checkin,
  confirmInvite,
  getCheckinInfo,
  getInvite,
  getRecruitStatus,
  myApplication,
  submitApplication,
  uploadInviteAvatar,
} from './routes/applications'
import { getRuntimeConfig } from './routes/config'
import { sendTestMail } from './routes/mail'
import { getDestinationForm, submitDestinationForm } from './routes/members'
import { getBootstrap, getPublicContent, getSiteConfigRoute, health } from './routes/public'
import {
  consumeDirectDownload,
  consumeDirectUpload,
  getStorageAdmin,
  issueDirectTokenRoute,
  testStorage,
  updateStorageAdmin,
} from './routes/storage'
import { ssoCallback, ssoLogin, ssoLogout, ssoMe } from './routes/sso'
import { serveFile, uploadImage } from './routes/uploads'

const routes: RouteDef[] = [
  // ---- 自检与运行时配置 ----
  { method: 'GET', path: '/api/health', handler: health },
  { method: 'GET', path: '/api/config/runtime', handler: getRuntimeConfig },

  // ---- 公开只读内容 ----
  { method: 'GET', path: '/api/public/site-config', handler: getSiteConfigRoute },
  { method: 'GET', path: '/api/public/bootstrap', handler: getBootstrap },
  { method: 'GET', path: '/api/public/content/:resource', handler: getPublicContent },
  // 本届招新状态（开放 / 还没开 / 已截止）：报名页据此显隐表单
  { method: 'GET', path: '/api/public/recruit', handler: getRecruitStatus },

  // ---- 文件（头像等）：上传需管理员，读取公开且长缓存 ----
  // 例外：applications/ 前缀是报名表（含个人信息），只有管理员下载得到，见 serveFile
  { method: 'POST', path: '/api/admin/uploads', handler: uploadImage, auth: 'admin' },
  // 一次性直连令牌（须注册在 /api/files/* 通配之前）：令牌即凭证，单次有效
  { method: 'GET', path: '/api/files/direct/:token', handler: consumeDirectDownload },
  { method: 'PUT', path: '/api/files/direct/:token', handler: consumeDirectUpload },
  { method: 'GET', path: '/api/files/*', handler: serveFile },

  // ---- 招新报名（学生侧，身份由教务网会话背书） ----
  { method: 'POST', path: '/api/applications', handler: submitApplication, auth: 'student' },
  { method: 'GET', path: '/api/applications/me', handler: myApplication, auth: 'student' },
  // 邀请函：凭证即密权，不要求登录（会话过期了也能确认加入）
  { method: 'GET', path: '/api/applications/invite/:token', handler: getInvite },
  { method: 'POST', path: '/api/applications/invite/:token', handler: confirmInvite },
  // 转正页要传头像，但不能要求登录（同学的教务网会话往往已过期）—— 用邀请函 token 当凭证
  { method: 'POST', path: '/api/applications/invite/:token/avatar', handler: uploadInviteAvatar },
  // 扫码签到：凭证（token）即密权 —— 只绑阶段 + 带失效时间，所以不需要登录态，
  // 也没有裸入口（导航里不出现，直接访问无 token 的路径拿不到任何信息）。
  { method: 'GET', path: '/api/applications/checkin/:token', handler: getCheckinInfo },
  { method: 'POST', path: '/api/applications/checkin/:token', handler: checkin },

  // ---- 毕业去向填写（凭证即密权，不要求登录；与邀请函同一路数） ----
  { method: 'GET', path: '/api/members/destination/:token', handler: getDestinationForm },
  { method: 'POST', path: '/api/members/destination/:token', handler: submitDestinationForm },

  // ---- 教务网单点登录（授权码模式，授权服务器部署在国内 EdgeOne） ----
  { method: 'GET', path: '/api/auth/login', handler: ssoLogin },
  { method: 'GET', path: '/api/auth/callback', handler: ssoCallback },
  { method: 'GET', path: '/api/auth/me', handler: ssoMe },
  { method: 'POST', path: '/api/auth/logout', handler: ssoLogout },

  // ---- 管理员认证 ----
  { method: 'POST', path: '/api/admin/bootstrap', handler: bootstrap },
  { method: 'POST', path: '/api/admin/login', handler: login },
  { method: 'POST', path: '/api/admin/logout', handler: logout },
  { method: 'GET', path: '/api/admin/me', handler: me, auth: 'admin' },
  { method: 'POST', path: '/api/admin/change-password', handler: changePassword, auth: 'admin' },
  { method: 'POST', path: '/api/admin/seed-content', handler: seedContent, auth: 'admin' },

  // ---- 后台：概览 / 审计 / 配置 ----
  { method: 'GET', path: '/api/admin/stats', handler: getStats, auth: 'admin' },
  { method: 'GET', path: '/api/admin/audit', handler: getAudit, auth: 'admin' },
  { method: 'GET', path: '/api/admin/config', handler: getAdminConfig, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/config', handler: updateAdminConfig, auth: 'admin' },

  // ---- 邮件通知（SMTP，当前为空实现，配置见 runtime.mail） ----
  { method: 'POST', path: '/api/admin/mail/test', handler: sendTestMail, auth: 'admin' },

  // ---- 对象存储（两个业务目标独立配桶；provider 插件注册于 lib/storage/registry.ts） ----
  { method: 'GET', path: '/api/admin/storage', handler: getStorageAdmin, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/storage', handler: updateStorageAdmin, auth: 'admin' },
  { method: 'POST', path: '/api/admin/storage/test', handler: testStorage, auth: 'admin' },
  { method: 'POST', path: '/api/admin/storage/direct-token', handler: issueDirectTokenRoute, auth: 'admin' },

  // ---- 后台：招新（整届状态与动作 / 群号与模板 / 签到二维码 / 导出 / 日志） ----
  { method: 'GET', path: '/api/admin/recruit', handler: getRecruitSettingsRoute, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/recruit', handler: updateRecruitSettings, auth: 'admin' },
  { method: 'GET', path: '/api/admin/recruit/stats', handler: getRecruitStats, auth: 'admin' },
  // 整届的每一次推进都走这里：状态机与校验在 lib/recruit-cycle.ts
  { method: 'POST', path: '/api/admin/recruit/actions', handler: runRecruitActionRoute, auth: 'admin' },
  { method: 'GET', path: '/api/admin/recruit/checkin-codes', handler: listCheckinCodes, auth: 'admin' },
  { method: 'POST', path: '/api/admin/recruit/checkin-codes', handler: issueCheckinCode, auth: 'admin' },
  {
    method: 'POST',
    path: '/api/admin/recruit/checkin-codes/revoke',
    handler: revokeCheckinCode,
    auth: 'admin',
  },
  { method: 'GET', path: '/api/admin/recruit/export', handler: exportRecruitCsv, auth: 'admin' },
  { method: 'GET', path: '/api/admin/recruit/mails', handler: getRecruitMails, auth: 'admin' },

  // ---- 后台：报名明细（列表 / 补录 / 详情 / 改状态 / 批量 / 批量通知信 / 下载） ----
  { method: 'GET', path: '/api/admin/applications', handler: listApplicationsAdmin, auth: 'admin' },
  // 补录未报名考生（开放参加制下现场来考的人）；批量与群发走 POST，
  // 与下面的记录级路由（GET/PUT/DELETE）方法不同，不会互相截胡
  { method: 'POST', path: '/api/admin/applications', handler: createApplicationAdmin, auth: 'admin' },
  { method: 'POST', path: '/api/admin/applications/bulk', handler: bulkApplicationsAdmin, auth: 'admin' },
  { method: 'POST', path: '/api/admin/applications/notify', handler: notifyApplicationsAdmin, auth: 'admin' },
  { method: 'GET', path: '/api/admin/applications/:id', handler: getApplicationAdmin, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/applications/:id', handler: updateApplicationAdmin, auth: 'admin' },
  { method: 'GET', path: '/api/admin/applications/:id/file', handler: downloadApplicationFile, auth: 'admin' },
  // 后补 / 替换报名表（补录时没带材料的那份，或本人换了版本）；成功后旧文件会被删掉
  { method: 'POST', path: '/api/admin/applications/:id/file', handler: uploadApplicationDocAdmin, auth: 'admin' },
  { method: 'DELETE', path: '/api/admin/applications/:id', handler: deleteApplicationAdmin, auth: 'admin' },

  // ---- 后台：内容 CRUD（资源无关，由 shared/resources.ts 驱动） ----
  { method: 'GET', path: '/api/admin/content/:resource', handler: listContent, auth: 'admin' },
  { method: 'POST', path: '/api/admin/content/:resource', handler: createContent, auth: 'admin' },
  { method: 'GET', path: '/api/admin/content/:resource/:id', handler: getContent, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/content/:resource/:id', handler: updateContent, auth: 'admin' },
  { method: 'DELETE', path: '/api/admin/content/:resource/:id', handler: deleteContent, auth: 'admin' },

  // ---- 后台：成员管理的批量动作（一次动一批人 + 可选发一批信） ----
  // 路径与 /api/admin/content/* 不同，不会互相截胡
  { method: 'POST', path: '/api/admin/members/graduate', handler: graduateMembers, auth: 'admin' },
  { method: 'POST', path: '/api/admin/members/destination-mail', handler: sendDestinationMails, auth: 'admin' },

  // ---- 后台：成员「方向 / 角色」字典（存 KV + D1，见 lib/identity-config.ts） ----
  // 不是内容类型之一：它不是「一条条记录」，而是一份整读整写的配置 —— 所以走自己的接口，
  // 也不放进 shared/resources.ts 的 RESOURCES（那套是给有主键的表用的）。
  { method: 'GET', path: '/api/admin/member-roles', handler: getMemberRolesAdmin, auth: 'admin' },
  { method: 'PUT', path: '/api/admin/member-roles', handler: updateMemberRolesAdmin, auth: 'admin' },
]

async function handle(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
  const url = new URL(request.url)

  if (request.method === 'OPTIONS') return preflight(request, env)

  const matched = matchRoute(routes, request.method, url.pathname)

  if (!matched) {
    if (url.pathname.startsWith('/api/')) {
      return fail(404, 'NOT_FOUND', `接口不存在：${request.method} ${url.pathname}`)
    }
    // 兜底：若未配置 run_worker_first，静态资源仍可正常返回
    return env.ASSETS.fetch(request)
  }

  const ctx: RequestContext = {
    request,
    env,
    url,
    params: matched.params,
    exec,
  }

  if (matched.route.auth === 'admin') {
    const session = await readSession(request, env)
    if (!session) return fail(401, 'UNAUTHENTICATED', '未登录或会话已过期')
    ctx.admin = session
  } else if (matched.route.auth === 'student') {
    // 报名学生会话（教务网登录后签发），与管理员会话互不影响
    const session = await readStudentSession(request, env)
    if (!session) {
      return fail(401, 'UNAUTHENTICATED', '请先用教务网账号完成身份认证')
    }
    ctx.student = session
  }

  try {
    return await matched.route.handler(ctx)
  } catch (error) {
    console.error('[worker] handler failed', { path: url.pathname, error })
    return fail(500, 'INTERNAL_ERROR', '服务异常，请稍后重试')
  }
}

export default {
  async fetch(request: Request, env: Env, exec: ExecutionContext): Promise<Response> {
    // 安装页生成的运行期密钥存在 D1 里；同步取密钥的地方（会话签名/验签）靠这份缓存
    await warmSecrets(env)
    const response = await handle(request, env, exec)
    return withCors(response, request, env)
  },

  // 刻意没有 scheduled：整届的开与关完全由管理员点按钮决定，
  // 连「到点自动关闭」都不做 —— 见 shared/recruit.ts 的 RECRUIT_ACTION_META。
} satisfies ExportedHandler<Env>
