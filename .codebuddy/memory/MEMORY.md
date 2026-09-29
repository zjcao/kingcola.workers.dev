# kingcola（拾光工作室官网）· 长期记忆

> 只记跨会话仍成立的事实；过程与踩坑全过程写 `YYYY-MM-DD.md`。
> 整理：2026-09-29 第六次压缩（合并重复、去过程，只留决策与坑；机制细节以代码为准）。

## 定位与架构
学生工作室官网 + 内部后台：Vite React（`src/`）+ Cloudflare Workers（`worker/`，`run_worker_first = ["/api/*"]`）。前台只读，写操作收敛到 `/admin/*`。
- **`shared/` 是前后端唯一契约源**：types / resources / identity / qr（冻结）/ runtime / mail / recruit / sso / site / seed / storage。
- **`shared/resources.ts` 一份元数据同时驱动 Worker 的 SQL·校验与后台表格·表单**：`type`(text/textarea/select/switch/number/date/tags/image)、`required`、`showWhen`/`requiredWhen`、`optionsSource`、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`、`defaultValue`，以及列表层的 `groups`（按 select 字段拆页签）与 `bulk`。新增内容类型只加一条。
- **后台内容页只有一份 `ContentPage`**：`def.groups` 拆页签时列集合跟着页签走（`isFieldActive(field, { [groups.key]: 当前页签 })`）；新增用 `prefillOnCreate` 预置分组字段。跨记录批量动作不走通用 CRUD：`worker/routes/admin-members.ts`（`POST /api/admin/members/graduate` 幂等只改 status、`POST /api/admin/members/destination-mail`）。
- **批量动作两类**（`ResourceBulkDef`）：① 简单动作（`confirmTitle`/`confirmNote`，需先勾人）；② `wizard:true` 走专属两步向导 —— 目前只有「到了说再见的时候了」（`src/admin/GraduateWizard.tsx`，文案用户定的）：`preselect:'latest-group'` 让它不用先勾人，进去自动勾最晚一届在组成员，第二步回显「送走几位 · 哪几届」+ 是否寄信。⚠️ 该向导是成员专用组件，里面直接用 `status/joinYear/name/title/email` 字段名。
- **读写口径**：读 `columnList(def)` 全列（`rowToEntity` 只映射 `def.fields`，不含 createdAt/updatedAt）；创建 = 补默认值整行 INSERT 后回读；更新只写提交上来的列；唯一校验口径 `validateEntity(def, input, ctx)`；互斥字段用 `requiredWhen` + `showWhen` 同条件。
- **主键两制**：默认文本 `randomId`；`projects` 用 `autoId:true` 自增整数（查库前 `normalizeId()`）。
- **前台是真实路由**：`PAGE_PATHS` 在 shared/types.ts；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。
- 接口信封 `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。**D1 唯一事实源**；KV 只做配置缓存（写 D1 后删 KV）。
- 站点文案来自 `site_config['site']`（JSON 合并、无迁移）；新增字段改三处：shared/types.ts → SettingsPage → section；解析在 `shared/site.ts`。
- 管理员存 D1 `admin_users`（PBKDF2）。运维文档 `docs/HANDOVER.md`（部分旧文案仍写 `RECOVERY_TOKEN`，已废弃）。

## 环境与命令
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（Vite 7 要求 22.23.2；**每开一个新 shell 都要先做**）；npm 加 `--registry=https://registry.npmmirror.com`。
- 含中文的 `.ps1` 必须 `pwsh`（5.1 编码错乱）。wrangler 4.137.0。本地密钥 `.dev.vars`（gitignore），本地管理员 `admin` / `kingcola-dev-2026`。
- 命令：本地验收 `npm run local`（8787）/ 开发 `dev:api`+`dev`（5175）/ `typecheck`·`build`·`deploy` / `db:migrate:local|remote` / `secrets:init`。自检：`scripts/smoke-api.ps1`、`smoke-applications.ps1`、`probe-local.ps1`。

## Git 远端（⚠️ 绝不能强推 main）
- **`cao-teachers-fork`** → `https://github.com/zjcao/kingcola.pages.dev`：**`main` 的 upstream**，`git push` 即推它。
  ⚠️ 旧的 `kingcalo-icg-home` / `thebestskinhead/kingcola-icg-home` 已不存在，写它会报 `does not appear to be a git repository`。
- **`test-dev`** → `https://github.com/thebestskinhead/kingcola.git`（2026-09-29 已推送）：它的 `main` 是 cloudflare[bot] 的一条
  `source repo import`，与本仓库**无共同祖先**、内容等于本仓库较早状态 → 合并用
  `git merge test-dev/main --allow-unrelated-histories -X ours`（保留双方历史、内容以本地为准）后普通推送，**不要 `--force`**。
- 中文提交信息一律写 UTF-8 文件 + `git commit -F <file>`（勿用 `-m`）。

## 线上与部署（Cloudflare）
- **当前线上入口**：`https://kingcola-pages-dev.zjcao.workers.dev`（账号 `czjing` `738bff0c…`，工作室对方建的 Worker `kingcola-pages-dev`，绑定/密钥已就绪、只差 `RECOVERY_TOKEN` 且已补；代码由我们 `ci-deploy.mjs` 部署）。
  它已部署成功 ✓，但静态页 200 而 **API 全 500** —— 那个 D1 从未建过表，而我们对它**没有 D1 写权限**（`Authentication error`）→ 迁移只能由对方跑。
- ⚠️ **`*.workers.dev` 在国内不可达**：早期表现为 DNS 污染（解析到 Facebook IP），后来实测 HTTPS 被 **SNI 阻断**（`curl:(35) Connection was reset`），只有纯 HTTP + 固定边缘 IP 能通 → 验证用 `curl --resolve <host>:80:<CF 边缘IP> http://<host>/api/health`。
  `*.pages.dev` 国内可达（`https://kingcola.pages.dev/` 200 ✓），但那是**另一份纯静态介绍页**、不是本站，别往同名项目部署（会覆盖）。
- **`czjing` 权限残缺**：D1/KV/R2 全 `Authentication error`、读自定义域名 403、**账号里没有 zone** → 表与域名只能对方处理；我们只部署代码（`ci-deploy.mjs` 的 `injectIds()` 从本机 `.env.deploy` 的 `D1_DATABASE_ID` / `KV_NAMESPACE_ID` 注入临时配置后 `--config` 部署，仓库保持无 ID；有 ID 时不做 R2 降级）。
- **另一个登录身份 `3343503027@qq.com`（账号 `3343503027@qq.com's Account` `86c3d67c…`）权限完整**：D1 ✓、KV ✓、R2 无桶（部署自动降级 ✓）、3 个 zone `bilibili.fit` / `mcrem.top` / `mcserver.top` → **要「国内能正常访问」就部署到这个账号**（这份登录含两个账号，命令必须显式 `CLOUDFLARE_ACCOUNT_ID`）。
- 旧账号 `fzqcloud`（`539135b7…`）下的 `kingcola.002038.xyz` 站点仍在跑，但**登录已按用户要求清空 → 以后管不到**；其孤儿 Worker `kingcola-icg-home`、误建的 `kingcola` 均已删除。
- ⚠️ **配置必须通用，账号专属值一律不进仓库**（用户两次指出）：
  · Worker 名用通用默认 `kingcola`，实际部署名放本机 `.env.deploy` 的 `WORKER_NAME`（`ci-deploy.mjs` 自动补 `--name`）；
  · **不写 `[[routes]]` 自定义域名**（写死等于逼每个 clone 挂别人的域名，zone 不符直接部署失败）；
  · **不写 `workers_dev = false`**（否则换账号部署后没有任何入口，"先用 workers.dev 顶着"也做不到）；
  · D1 `database_id` / KV `id` **留空 = 首次部署自动创建**（想复用才填；**绝不写假占位符**，否则整个部署失败）；R2 按桶名绑定，自动创建；
  · ⚠️ `[[r2_buckets]]` **绝不能删** —— `wrangler dev` 靠它模拟本地桶，本地开发与 smoke 8a/8b 依赖。
  实测：配置里不声明域名时 `wrangler deploy` 打 `No targets deployed`，但**不会摘掉**面板挂的域名；绑定则相反（**配置文件是绑定的唯一事实源**，面板多出来的会被清；`keep_bindings` 在 4.137 不存在）。
  **动 `wrangler.toml` 前先问用户。**
- ⚠️ **用户硬约束（2026-09-29）：「不要用本机脚本操作 Cloudflare，建表必须由跑在 Cloudflare 上的东西完成」** —— 不在本机跑 `migrate.mjs` / `d1 execute` / `pages secret` / `wrangler deploy` 去动线上；建表要么由**应用自己在运行时**做（SQL 打包进产物 + `_migrations` 台账），要么由**面板 Git 构建**做。允许：git 推送、HTTP 观察状态、用户点头后的账号级资源创建。
- ⚠️ **凭据**：用户明确「不要给他备份凭据」，也已清空过所有 wrangler 登录 → 别顺手复制 token / 留备份。要操作 Cloudflare 就用用户给的 **API Token**（写本机 `.env.deploy` 的 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`；`scripts/lib/deploy-target.mjs` 统一读取，`ci-deploy.mjs` / `migrate.mjs` / `init-secrets.mjs` 都透传，且不覆盖现有 OAuth 登录态）。
  `wrangler login` 在这台机器上不稳：回调只绑 IPv6 `::1`、多次尝试会残留进程占 8976 → 必须**先清 8976 残留进程**、再用**单个独立进程**（`Start-Process` + 日志落盘）跑。
- ⚠️ **密钥按 Worker 各存一套**：换 Worker 名 / 迁域名后必须重写（否则签不了会话、bootstrap 503）。
  `wrangler secret` 系列**默认取 `wrangler.toml` 的 `name`**（通用名 `kingcola`）→ 必须带 `--name <面板项目名>`，否则会写到甚至**新建**另一个 Worker；写完**立即生效、不需要重新部署**。
  **`secret put` 绝不能用管道喂值**（会把换行存进去 → 之后怎么手输都对不上，本项目踩过），脚本化用 `wrangler secret bulk`。
  **密钥台账＝本机 `.env`**（已 gitignore、永不入库）：`npm run secrets:init` 生成/轮换/显示（现为当前值来源）；`SSO_CLIENT_SECRET` / `QR_SIGN_SECRET` / `SMTP_PASSWORD` **刻意不生成**（必须与对端逐字一致）。
  `wrangler dev` 读的是 `.dev.vars`（另一套联调值）；前端不用 Vite 环境变量，`.env` 不影响构建。
- ⚠️ **`/api/health` 会被边缘缓存**（响应没带 `no-store`）：改完绑定/密钥后直接查可能拿到旧值，排查时加 `?nocache=<时间戳>`。
- ⚠️⚠️ **PBKDF2 迭代数受免费版 CPU 预算硬约束**：`worker/lib/crypto.ts` 原 150 000 → 线上登录/初始化必 `500 服务异常`（`worker/index.ts` 的全局 catch；纯读接口全 200，极易误判成数据库/绑定问题）。二分实测 4万/6万/10万通过、**15万必挂** → 定为 **50 000**。哈希自带迭代数，改常量不会让旧密码失效。想恢复高强度先升 Workers Paid。
- **建表脚本 `scripts/migrate.mjs`**（跨平台 Node，取代 `migrate.ps1`）：带 `_migrations` 台账（name/applied_at），执行过即跳过、重复运行安全；老库（台账之前建的）首次要 `migrate.mjs <local|remote> --adopt` 只登记不执行。
  ⚠️ 坑：`spawnSync('npx', [...], { shell: true })` 下 `--command "SELECT ... "` 的空格会被 shell 拆成多个参数 → 静默失败 → 误判「库是空的」→ **在线上跑起了 0001**（万幸全是 `CREATE TABLE IF NOT EXISTS`，无数据损失）。修法：直接跑 `node node_modules/wrangler/bin/wrangler.js`（不过 shell）+ 探测失败**中止**而不是继续。
- **`npm run deploy` = `node scripts/ci-deploy.mjs`**（Workers Builds 的 Deploy command 也用它，别用 `npm run deploy` 以免二次构建）：先探测 R2，不能用就临时剔掉 `[[r2_buckets]]` 再 `--config` 部署（自动降级；`FORCE_NO_R2=1` 强制、`--dry-run` 演练）。
  **部署前先跑 `migrate.mjs remote`**：成功继续、**失败只警告不阻断**（`MIGRATE_STRICT=1` 可阻断、`SKIP_MIGRATE=1` 跳过）—— CI 自动生成的 token **没有 D1 权限**，这步在 CI 必然失败，不该把部署一起拖挂。

## 安装流程（2026-09-29 定案，别再引入 RECOVERY_TOKEN）
- **`/install` 页**（`src/pages/InstallPage.tsx` + `src/App.tsx` 路由）：未安装时**任何人可访问、不加门槛**；装完**自动锁死**。它做三件事：
  ① **建表** —— 用**打包进产物的** `worker/migrations.generated.ts`（由 `scripts/gen-migrations.mjs` 在 `npm run build` 时生成）+ `_migrations` 台账，**建表跑在 Cloudflare 上** ✓；
  ② **生成初始密钥**（`SESSION_SECRET` / `STUDENT_SESSION_SECRET`）写进 D1 的 `app_secrets`（迁移 `0013`）—— 运行时改不了自己的环境变量，这是唯一可行路径；
  ③ **创建第一个管理员**（只填用户名 + 密码，**不再要 recovery 口令**）。
- `POST /api/admin/bootstrap` 已改成**安装接口**，只允许「还没有管理员」时调用。**`RECOVERY_TOKEN` 已从代码/文档/`.env`/`scripts/init-secrets.mjs` 中彻底移除。**
- 取密钥口径：**D1 优先、环境变量兜底** —— `worker/lib/secrets.ts` 的 `secretOf()` + 每个请求入口 `worker/index.ts` 的 `await warmSecrets(env)`（实例级缓存）。
- **D1 / KV / R2 由用户手动在面板创建并绑定**（构建自动 token 没有 D1 权限；手动绑定最可控）；D1 未绑定时安装页要给明确提示而不是 500。
- **是否已安装** `isInstalled()` = `env.INSTALL_STATE === 'installed'` **或** D1 里有管理员。`INSTALL_STATE` 是 `wrangler.toml` / `wrangler.pages.toml` 里的占位 var（`uninstalled`）；**装完后在面板里覆盖成 `installed`、不要提交回仓库**（那是某次部署的状态，不是项目通用默认值）。
- 两端密码下限一致 **8 位**（`LoginPage.MIN_PASSWORD` ↔ worker `minPasswordLength()`）。未安装时登录页显示「首次初始化」卡片，已安装则登录表单 + 口令重置说明。
- ⚠️ 待办：**端到端没跑过**（本地 `wrangler dev` + 本地 D1 走一遍「打开 /install → 建表 → 建号 → 登录」）；`POST /api/admin/bootstrap` 在 0 管理员时本地曾报 **503 `DB_NOT_READY`**，且 `0013_app_secrets` 没进本地库（台账只登记 12 个，疑 `worker/migrations.generated.ts` 与 `migrations/*.sql` 不同步）。

## 多会话并行（重要）
工作区被多会话并行修改（含本记忆文件）：**动文件前先读当前内容**。提交前逐文件 `git diff`，并用 `git show HEAD:<file> | findstr /C:"符号"` 验证 HEAD 是否自洽 —— 若别人新代码引用的符号不在 HEAD 里（曾出现在 applications.ts / endpoints.ts / index.ts），必须把那批文件一起提交，否则留下**编译不过的 HEAD**。中文提交信息写 UTF-8 文件 + `git commit -F`。杀 8787 上的服务时，`Get-NetTCPConnection` 给的只是 workerd，**父进程 pwsh/npm 也要清**，否则残留进程又抢回端口。

## 对象存储适配层
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（可各配桶）；配置存 `site_config['storage']`，无迁移。
- `worker/lib/storage/`：`registry.ts` 插件表（内置 `r2` 与 `s3`——自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无 SDK）；`index.ts` 的 `getStorage(env, purpose)` 门面。
- 直连：s3 预签名 GET/PUT；r2 不支持 → 退化 KV 一次性 token + `/api/files/direct/:token`（用后即焚）。签发口 `POST /api/admin/storage/direct-token`。后台存储页只有配置/连通性探测/直连签发，**没有文件浏览器，也没有单独的「删文件」接口**。
- `secretAccessKey` 落库但**永不下发**（只回 `secretConfigured`；保存时空值 = 保留旧值）；`resolveFileRef()` 能反解 `/api/files/<key>` 与 publicBase 直链；`applications/` 前缀私有（`GET /api/files/*` 一律 404/要求管理员会话）。
- **报名表没有独立的删除入口**：文件与记录同生死（删记录、替换材料、`reset_apply`、`close_cycle` 归档后删、落库失败回滚）。

## 招新（以 `shared/recruit.ts` + `worker/lib/recruit-cycle.ts` 为准）
- 入口 `/admin/recruit`（四视图：流程/名单/邮件日志/设置，共用 `useRecruitAdmin.ts`；纯函数与常量放 `recruit-ui.ts`，**只放非组件**，否则踩 react-refresh）。
- **三条用户边界**：①「设置 vs 流程」判据 = **下一届还要不要重填一次**（要 → 本届流程：名称/四个群号/阶段/名单/评语/签到码；不要 → 通用设置：邮件模板/官网招新文案）；后端只有 `PUT /api/admin/recruit`（**不接受 state**）+ `POST /api/admin/recruit/actions`。②「资料随时可改」：名单行内改姓名/学号/邮箱/手机/QQ 与报名表，`IMMUTABLE_KEYS` 只剩 id/createdAt；**笔试现场补录不要求报名表**。③「关闭/清空」= **推倒重来**（`reset_apply`），不是临时停收、不是退回未开启。
- **状态 = `stage` + `result` 两列**：stage ∈ apply/written/interview/defense/onboard；result ∈ ''(待定)/attended/passed/failed/absent/declined/withdrawn；中文标签由 `applicationLabel()` 派生、**不入库**；阶段只相邻推进或退一步。**整届没有时间字段、也没有场次**；所有动作集中在 `RECRUIT_ACTION_META`（from/to/needsSelection/文案），后台按钮文案与可点性同源。缺考在「结束笔试/面试/答辩」里一次标完。服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`（差 8 小时）。
- ⚠️ **已作废、别再引入**：`recruit-auto.ts`、`/api/admin/recruit/auto`、`[triggers] crons`、`recruitPhase()`/时间窗/`site.recruitOpen`、周期的 `archives`、`shared/time.ts`、`recruit_sessions`。
- 周期配置存 D1 `site_config['recruit']`（刻意不放 runtime：模板正文不该下发给访客）；读时 `mergeCycle` 逐字段取值并校验 state。报名通道只由 `isApplyOpen(state)` 决定。
- **邮件九模板**（招新八条 + `graduation_destination`「毕业去向征集」—— 收件人是**成员**、由成员管理的批量毕业发出，**暂寄居在招新模板页**）：变量仅 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{destinationLink}{rejectReason}{studio}{contactEmail}{contactAddress}`；**缺考与未过初筛一律不发信**；发信失败不阻断流转；只按目标状态决定发哪封 → 改判不会误发。⚠️ 群号短名（`groups.written`）≠ 模板令牌（`{writtenGroup}`），统一走 `cycleMailVars(cycle)`；**模板变量别手写键名**（出过「预览骗人」）。⚠️ 「可补发」清单是 `RECRUIT_APPLICATION_MAIL_KINDS`（= 全部模板 − 毕业去向征集），名单下拉与 `isApplicationNoticeKind()` 都用它，别再直接用 `RECRUIT_MAIL_KINDS`。
- **材料审核**（`0010`）：`applications` 加 `material_status`(''待审/approved/rejected)+`material_reason`+`material_reviewed_at`；报名阶段可逐个/批量「通过·驳回」（驳回必写理由并自动逐人发信）；**重传材料自动回到待审核**；只在 apply/apply_review 可审；**未过审不能被勾进笔试**（`MATERIAL_NOT_APPROVED`，只作用于报名→笔试）。
- **报名截止后的进度入口**：`gate=closed` 时未登录者看到「报名已截止」+「扫码登录，查看我的进度」；登录后可见审核状态与驳回理由，报名未结束可直接重传（`POST /api/applications?replace=true`，**`replace` 只认 query 参数**）。
- **签到 = 阶段 + 凭证**：`recruit_checkin_tokens` 只绑 `stage`(written/interview/defense)+`expires_at`+`revoked_at`，**签发新码自动作废该阶段旧码**；签到页只有 `/checkin/<token>`。⚠️ `QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，**不是**签到码密钥。
- **`close_cycle`**：未确认的记 absent → 导出 CSV 到 `applications/archives/` → 存档信息进周期 → 删报名表 → 清空报名与发信日志 + 签到凭证 → 写 `closedAt` → 回 dormant；**对象存储没接通就拒绝关闭**。
- **`reset_apply`**：只在 apply/apply_review 可用；删光报名记录+报名表+发信日志（**跳过 `RECRUIT_ARCHIVE_SCOPE`**，别误删往届存档），state 退回 `prepare`；**不导出存档、不因存储不可用拒绝**；返回 `cleaned{applications,files,filesFailed}`。
- **邀请函转正** `POST /api/applications/invite/:token`（凭证即密权，14 天、只能确认一次）→ 写 `members` 并回记 `memberId`；**头像必传**（`/invite/:token/avatar`，同凭证、免登录），确认时只接受本站 `avatars/` 前缀（拒任意外链）；「负责方向」必填；三个入口共用 `pendingInviteError()`。
- **上传公共实现** `worker/routes/uploads.ts: receiveImage(ctx, resolveScope)`（multipart → 体积 → 魔数 → 落站点存储，**不含鉴权**）；管理员口读表单 `scope`，邀请函**硬编码 `avatars`**。
- **毕业去向填写页**（`/graduate/:token`，凭证即密权、免登录）：成员管理「批量毕业」或「发送去向征集」时签发 `members.destination_token`（**签发即覆盖旧的**；提交后清空 → 一条只能用一次；**没有过期时间**）。页面 `src/sections/GraduateSection.tsx`；接口 `GET|POST /api/members/destination/:token`（`worker/routes/members.ts` + `lib/member-destination.ts`），**裸 SQL**，因为 token 绝不能进 `shared/resources.ts` 字段表（那会让公开 bootstrap 把它下发出去）。⚠️ 因此 `destination` 也**不再是 `requiredWhen`**（由本人异步填，强制必填会让管理员连改头像都被挡住）。
- ⚠️ **没有「毕业年份」字段**（用户明确：届别就是**加入年份** `joinYear`）：别再引入 `graduation_year` / `Member.graduationYear` / 向导年份输入。`graduate` 接口只把 `status` 改成 `alumni`（幂等，无 `year` 参数）；界面「哪一届」全由 `joinYear` 分组回显。曾短暂加过 `0013_member_graduation_year.sql`，**当天整体撤回**。
- **表/文件**：`applications` + `application_mails` + `recruit_checkin_tokens`；**已有数据的库必须单独**执行新迁移 SQL。报名表与存档都在 `applications/` 前缀（私有）；下载 `GET /api/admin/applications/:id/file`，后补/替换 `POST .../:id/file`。
- 自检 `scripts/smoke-applications.ps1`（109 项，需 8787）。**别把输出接到 `Select-Object -First N`**（上游 pwsh 会继续跑，两条自检互相推进状态机）。⚠️ 该脚本从「关闭本届」跑到底 → **会归档并清空本地报名数据**；跑前先杀掉手动起的服务。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**：用 `SESSION_SECRET` 经 HKDF 派生的密钥做 AES-GCM 加密成 `enc$<iv>.<密文>`；`SMTP_PASSWORD` 仅兜底（库里优先）。下发一律剥离密码，后台只拿 `mailPasswordSource`；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**；KV 存的是密文版。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts`（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## SSO
`shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话 `kc_admin`(12h) / `kc_student`(30d)；判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。RuntimeConfig **已删 `join` 通道**（请求恒定同源）；failover/rolloutPercent 只为兼容旧 JSON 保留、无人消费。
- ✅ **2026-09-29 起「授权地址 / 回调地址 / 客户端密钥」全部改为在后台填**（用户要求），与 SMTP 密码同一套分工：`redirectUri` 明文存 D1，`clientSecret` **加密**存 D1（`worker/lib/sso-config.ts`：`ssoClientSecretOf/SourceOf`、`resolveSsoClientSecret`、`encryptSsoClientSecret`；`ssoRedirectUriOf()` = 后台 → 环境变量 → 按域名推导三级兜底；密钥走 `secretOf(env,'SESSION_SECRET')`）。下发用 `publicSsoConfig()` 剥离密钥；`worker/routes/sso.ts` 的 `ssoContext()` 一次取齐四样，**后台一改即生效、不必重新部署**。环境变量（`SSO_AUTHORIZE_BASE` / `SSO_REDIRECT_URI` / `SSO_CLIENT_SECRET` / `SMTP_PASSWORD`）退为兜底；**只有 `QR_SIGN_SECRET` 必须在环境变量里**。
- ⚠️ **保存运行时配置时基线必须取「未解密」的那份**（`resolveStoredRuntimeConfig()`）：拿 `resolveRuntimeConfig()` 的明文当基线再落库，会把库里的 `enc$` 密文**悄悄降级成明文**（首次保存正常，第二次「留空不修改」就中招；SMTP 密码同样受影响）。

## 前台约定
- `slides`：type='text'（kicker/title/subtitle/cta，showWhen）/ 'image'（只有图铺满）；`HERO_HEIGHT` 常量两种类型共用高度。导航：首页/新闻/项目/成员/加入我们。
- **成员「方向 / 角色」字典**（取代原 `MEMBER_ROLES`）：契约 `shared/identity.ts` → 存储 `worker/lib/identity-config.ts`（KV `member_roles` 优先，D1 `site_config['memberRoles']` 是事实源，写 D1 后删 KV）→ 接口 `GET|PUT /api/admin/member-roles`（PUT **整份覆盖**；移除「还有人在用」的方向需 `confirmRemoval:true`，否则 409 `ROLE_IN_USE`；停用不算移除）→ 页面 `/admin/roles`。
  **刻意存中文名、不做稳定 id**：改名单只影响之后新增的记录，历史值原样保留 → 删改方向零迁移（`members.title` 自 0001 起是 TEXT）；代价是没法一键统一改历史叫法。
  **边界**：非学生方向**永不允许** `selectableBySelf`（validate 强制纠正）；邀请函只下发 `selfSelectableLabels()`，`confirmInvite` 再独立校验 → 学生写不成「指导老师」。
  字段侧 `optionsSource:'memberRoles'`（`options` 只是兜底，白名单由 `validateEntity(def, input, ctx.memberRoles)` 注入）；**更新记录时必须把原值并进白名单**（`admin-content.ts: validationContext()` 与 `ContentPage.tsx: resolvedFields` 必须同规则），否则改名后老记录连电话都改不了。
- 成员卡片：`direction`=负责方向（在组必填 `requiredWhen`）、`destination`=毕业去向（不设必填）；卡片取 `destination || direction` 兜底；头像为空用姓名首字；`homepageUrl` 非空时显示「点击进入个人主页」（`homeHref()` 补 `https://`）。
- 上传：`POST /api/admin/uploads`（魔数嗅探）；`UPLOAD_IMAGE_LIMITS`（avatars 2MB / slides 50MB / 默认 2MB）。
- 项目页 `ProjectsSection`：按年份分组、`sm:grid-cols-2`；卡片 `flex flex-col` + 描述 `flex-1`（grid 默认 stretch → 同行等高、底部对齐，**别改成 `items-start`**）。荣誉是**单个字符串** `honor`（后台提示「；」分隔），前端 `splitHonors` 拆条 + `divide-y`，**超过 2 条**才出现「展开全部 N 项 / 收起」。卡片底部固定一行链接，文案「**点击跳转到项目仓库**」，`link` 为空则整行不渲染。

## 已知坑
- `vite.config.ts` base 必须 `'/'`（后台多级路由，`'./'` 深层刷新 404）。本机 3000/5173 被 IDE 占用，前端固定 5175 + strictPort；wrangler dev 只听 IPv4。
- **`wrangler dev` 按请求从 `dist/` 读文件**：改完前端跑一次 `npm run build` 刷新即可，不用重启服务。
- wrangler 异常退出残留 workerd 占 8787（`Get-NetTCPConnection -LocalPort 8787` 查 PID 更快）。
- PowerShell 7 `Invoke-RestMethod -Form` 上传缺 name 会炸 formData；用 `curl.exe -F`。
- 路由支持 `*` 通配（捕获在 `ctx.params['*']`）；`/api/files/*` 必须注册在更具体的 `/api/files/direct/:token` 之后。
- `db:migrate:*` 旧脚本会重跑全部 migrations（靠报错跳过）；有数据的库只单独执行新增文件。
- `smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认还原。
- **React 列表 key 不能取自可编辑内容**：敲一个字 key 就变 → React 重建该行 → 焦点丢失（表现为「编辑框打不了字」）。用与内容无关的本地 id（`MemberRolesPage.tsx` 的 `EditableRole.rowId` 是范例）。
- 全量 `npx eslint src shared worker` 有 8 个**既有**错误，都在 `src/components/ui/*`（shadcn），与业务改动无关。
- `git commit --no-verify=false` 会**静默失败**（非法参数）—— 布尔开关不要带 `=值`。
- 本机日志已在 `.gitignore`（`dev*.out|err`、`.codebuddy/*.out|err`、`*.log`）；曾误提交的已 `git rm --cached`。**别再 `git add -A`** 把运行产物提交进去。
