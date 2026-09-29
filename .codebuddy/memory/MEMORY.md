# kingcola（拾光工作室官网）· 长期记忆

> 只记跨会话仍成立的事实；日流水写 `YYYY-MM-DD.md`（过程与踩坑全过程在日文件里）。
> 整理：2026-09-29 第五次压缩（合并重复、去过程，只留决策与坑；机制细节以代码为准）。

## 定位与架构
学生工作室官网 + 内部后台：Vite React（`src/`）+ Cloudflare Workers（`worker/`，`run_worker_first = ["/api/*"]`）。前台只读，写操作收敛到 `/admin/*`。
- **`shared/` 是前后端唯一契约源**：types / resources / identity / qr（冻结）/ runtime / mail / recruit / sso / site / seed / storage。
- **`shared/resources.ts` 一份元数据同时驱动 Worker 的 SQL·校验与后台表格·表单**：`type`(text/textarea/select/switch/number/date/tags/image)、`required`、`showWhen`/`requiredWhen`、`optionsSource`、`optionLabels`、`preview`、`inList`/`compact`、`hint`、`autoId`、`defaultValue`，以及列表层的 `groups`（按 select 字段拆页签）与 `bulk`。新增内容类型只加一条。
- **后台内容页只有一份 `ContentPage`**：`def.groups` 拆页签时列集合跟着页签走（`isFieldActive(field, { [groups.key]: 当前页签 })`，在组里看不到毕业去向），新增用 `prefillOnCreate` 预置分组字段。跨记录批量动作不走通用 CRUD：`worker/routes/admin-members.ts`（`POST /api/admin/members/graduate` 幂等只改 status、`POST /api/admin/members/destination-mail`）。
- **批量动作两类**（`ResourceBulkDef`）：① 简单动作（`confirmTitle`/`confirmNote`，需先勾人）走通用确认框；② `wizard:true` 走专属两步向导 —— 目前只有「到了说再见的时候了」（`src/admin/GraduateWizard.tsx`，文案用户定的）：`preselect:'latest-group'` 让它不用先勾人，进去自动勾最晚一届在组成员，第二步回显「送走几位 · 哪几届」+ 是否寄信，成功后才切结果屏。⚠️ 该向导是成员专用组件，里面直接用 `status/joinYear/name/title/email` 字段名。
- **读写口径**：读 `columnList(def)` 全列（`rowToEntity` 只映射 `def.fields`，不含 createdAt/updatedAt）；创建 = 补默认值整行 INSERT 后回读；更新只写提交上来的列；校验唯一口径 `validateEntity(def, input, ctx)`；互斥字段用 `requiredWhen` + `showWhen` 同条件。
- **主键两制**：默认文本 `randomId`；`projects` 用 `autoId:true` 自增整数（查库前 `normalizeId()`）。
- **前台是真实路由**：`PAGE_PATHS` 在 shared/types.ts；新增板块改四处（PageKey → LABELS/PATHS → App.tsx Routes → Header NAV_ORDER）。
- 接口信封 `{ ok, data }` / `{ ok, error:{code,message} }`，前端 `apiRequest` 解包。**D1 唯一事实源**；KV 只做配置缓存（写 D1 后删 KV）。
- 站点文案来自 `site_config['site']`（JSON 合并、无迁移）；新增字段改三处：shared/types.ts → SettingsPage → section；解析在 `shared/site.ts`。
- 管理员存 D1 `admin_users`（PBKDF2）；`RECOVERY_TOKEN` 灾备；运维文档 `docs/HANDOVER.md`。**首次初始化有页面引导**：`/admin` 登录页读 `/api/config/runtime` 的 `initialized`（= `countAdmins()>0`），空库显示「首次初始化」卡片，已初始化则是登录表单 + 口令重置说明；两端密码下限都是 8 位（`LoginPage.MIN_PASSWORD` ↔ worker `minPasswordLength()`）。

## 环境与命令
- PATH 无 node/npm：`Import-Module D:\usexxx\use-xxx.psm1; use-node 22.23.2`（Vite 7 要求 22.23.2；**每开一个新 shell 都要先做**）；npm 加 `--registry=https://registry.npmmirror.com`。
- 含中文的 `.ps1` 必须 `pwsh`（5.1 编码错乱）。wrangler 4.137.0。本地密钥 `.dev.vars`（gitignore），本地管理员 `admin` / `kingcola-dev-2026`。
- 命令：本地验收 `npm run local`（8787）/ 开发 `dev:api`+`dev`（5175）/ `typecheck`·`build`·`deploy` / `db:migrate:local|:remote`。自检：`scripts/smoke-api.ps1`、`smoke-applications.ps1`、`probe-local.ps1`。
- **线上（2026-09-29 首次部署完成）**：入口 **https://kingcola.002038.xyz**（自定义域，域名托管在同一账号）。
  ⚠️ `*.workers.dev` 在国内**被 DNS 污染**（解析到 31.13.94.23 这类 Facebook IP），完全不可用 → `wrangler.toml` 必须有 `[[routes]] pattern="kingcola.002038.xyz"` + `custom_domain=true`，否则下次 Git 部署会摘掉域名（配置是绑定的唯一事实源）；另加了 `workers_dev=false`。
  - **Worker 名是 `kingcola-icg-home2`**（= 面板里那个 Git 项目的名字，2026-09-29 收到 CI 自动 PR 后确认并统一；
    `wrangler.toml` 的 `name` 已改成它，**自定义域名与密钥都已迁过去**）。
    ⚠️ `kingcola-icg-home` 是我最早用 CLI 直接部署时创建的**孤儿 Worker**（现在没有域名、别再往它部署）；
    D1 `kingcola-db`（`c6f303e8-74f8-4234-b3a7-7f38263e717f`）；KV `kingcola-icg-home-config-kv`（`f62ab355096b41eeab512132ed0f6e2f`）；R2 `kingcola-files`。**D1/KV 由 CLI 部署时自动创建，ID 没回写进 wrangler.toml**。12 个迁移已在远程跑过。
  - 已写密钥：`SESSION_SECRET` / `STUDENT_SESSION_SECRET` / `RECOVERY_TOKEN`（值不记录）；`SSO_CLIENT_SECRET` / `QR_SIGN_SECRET` / `SMTP_PASSWORD` **尚未配** → `ssoEnabled:false`、邮件未接通。管理员靠 `/admin` 首次初始化建。
    ⚠️ **密钥是「按 Worker 各存一套」**：换 Worker 名或迁域名后必须重新写一遍（否则登录签发不了会话、bootstrap 直接 503）；
    2026-09-29 迁到 `-home2` 后就用 `wrangler secret bulk` 补了 3 个（**别用管道 `secret put`**，会带换行）。
    ⚠️ **`/api/health` 会被边缘缓存**（没带 `no-store`）：改完绑定/密钥后直接查可能拿到旧值，排查时加 `?nocache=<时间戳>` 绕开。
  - **密钥台账＝本地 `.env`**（2026-09-29 生成，已 gitignore、**永不入库**，模板头部写清用法）：
    含 `SESSION_SECRET` / `STUDENT_SESSION_SECRET` / `RECOVERY_TOKEN` 三个**真实值**，并已 `wrangler secret bulk .env` 写入 `-home2`
    （改完 health 三项 true、bootstrap/login 实测 200）；
    `SMTP_PASSWORD` / `SSO_CLIENT_SECRET` / `QR_SIGN_SECRET` **保持注释**（占位符若被 bulk 上去会把线上写坏）——填好后取消注释再 bulk 一次。
    本地 `wrangler dev` 读的仍是 `.dev.vars`（另一套联调值，别混）；前端不用 Vite 环境变量（无 `import.meta.env`），`.env` 不影响构建。
    ⚠️ **`wrangler secret` 系列命令默认取 `wrangler.toml` 的 `name`（现在是通用名 `kingcola`）**：必须带
    `--name <面板项目名>`，否则密钥会写到 —— 甚至**新建**出 —— 另一个 Worker（本项目就误建过一个 `kingcola`，
    表现为 `-home2` 上「密钥写不进去」）。正确写法：`npx wrangler secret bulk .env --name kingcola-icg-home2`；
    写完**立即生效、不需要重新部署**（2026-09-29 先误判成「要 deploy 才生效」，已在 README / .env 里纠正）。
    `-home2` 现有 5 个密钥（SESSION_SECRET / STUDENT_SESSION_SECRET / RECOVERY_TOKEN / SSO_CLIENT_SECRET / QR_SIGN_SECRET），
    只差 `SMTP_PASSWORD`（只有用户知道）。孤儿 Worker `kingcola-icg-home` 与误建的 `kingcola` 均已删除。
- ⚠️ **另有一个账号 `czjing`（`738bff0cfc073b8d2647295f8016748b`）访问不了**：用户被邀请进去，但成员资格一直是
  **`pending`（邀请未接受）** —— `/accounts` 里看不到它，连 `PUT /memberships/{id}`（尝试代为接受）都是 **403**
  （OAuth 凭据没这个权限，只能用户本人在面板 / 邀请邮件里点接受）。该邀请还**只授权单个 Worker**
  （user group 名 `kingcola`，scope `com.cloudflare.edge.worker.script.38d6bfc75445412ab02149c1d30fbf37`），
  **没有 zone / DNS 权限** → 即便接受，在那个账号里也**挂不了自定义域名**（这正是「无法创建域名」的另一个可能来源）。
  域名 `002038.xyz` 的 zone 在 `Fzqcloud@outlook.com's Account`（539135b7…）下 ——
  **Cloudflare 的自定义域名必须与 Worker 同账号**，跨账号做不到。
- **OAuth 登录在这台机器上不稳 → 一律走 API Token**（2026-09-29 实测）：`wrangler login` 的回调服务只绑
  **IPv6 `::1`**（`127.0.0.1:8976` 连不上、浏览器走 IPv4 或被代理拦 → 用户看到 `localhost 拒绝连接`），
  且多次尝试会**残留进程占着 8976**（新进程抢不到端口），最终 `Timed out waiting for authorization code`。
  改用目标账号创建的 **API Token**：写进本机 `.env.deploy` 的 `CLOUDFLARE_API_TOKEN`（可选 `CLOUDFLARE_ACCOUNT_ID`），
  `scripts/lib/deploy-target.mjs` 统一读取，`ci-deploy.mjs` / `migrate.mjs` / `init-secrets.mjs` 都会透给 wrangler ——
  不走浏览器回调、也**不覆盖**现有 OAuth 登录态（fzqcloud 那套线上站仍可管理）。
  ⚠️ 若一定要 `wrangler login`：必须作为**独立进程**跑（`Start-Process` + 日志落盘），后台化/被取消的会被杀掉。
  ⚠️ **用户 2026-09-29 明确要求：不要给他备份凭据，并清空所有 wrangler 登录** ——
  以后再处理账号/凭据类操作时，**不要**顺手复制 token / 配置文件留备份（`wrangler logout` 已执行、备份已删）。
  需要操作 Cloudflare 时改为让用户提供 API Token（写进本机 `.env.deploy`）或由用户自己重新登录。
- **2026-09-29 晚换账号（用户：「重新登录」）— `wrangler login` 这次成功了**：关键是**先清掉占着 8976 的残留进程**、
  再用**单个独立进程**跑（`Start-Process` + 日志落盘），回调就通了。新登录身份 **`3343503027@qq.com`**，可见两个账号：
  · **`czjing`（`738bff0cfc073b8d2647295f8016748b`）基本没权限** —— D1 / KV / R2 全部 `Authentication error`，
    被授权的那个 Worker 也是 `No access to the specified resource` → **没法在它里面部署整套站**（本应用强依赖 D1）；
  · **`3343503027@qq.com's Account`（`86c3d67ccc8a24f34dae7dcf7ff6e4ee`）权限完整可行** —— D1 ✓、KV ✓（已有 `vless3`）、
    R2 未建桶（部署脚本会自动降级 ✓）、**有 3 个 zone**：`bilibili.fit` / `mcrem.top` / `mcserver.top`（都 active ✓）。
  ⚠️ 旧账号 `fzqcloud` 的登录已按用户要求清空 → `kingcola.002038.xyz` 那套线上站**以后管不到**（站点本身仍在跑）。
  ⚠️ 这份登录含两个账号 → wrangler 命令必须显式 `CLOUDFLARE_ACCOUNT_ID`，否则可能走错账号。
- ⚠️ **绝不把「某次部署的选择」写进仓库配置**（2026-09-29 我自己的错，用户两次指出）：
  `wrangler.toml` 是仓库通用文件，不能出现只对某一次部署成立的设置。已犯两例，且**是同一个提交 `ad0b2d1` 里一起写进去的**：
  ① `[[routes]] custom_domain = "kingcola.002038.xyz"`（我的域名；已在 `e195675` 移除 ✓）
  ② `workers_dev = false`（2026-09-29 用户要求后**已删除** ✓ —— `wrangler.toml` 现在刻意不写这个键，
  默认「谁部署谁有个 workers.dev 地址」）。两行叠在一起的后果曾是「不绑域名 + 也不给 workers.dev」——
  任何人（包括换账号后的自己）部署完线上**没有任何入口**，连"先用 workers.dev 顶着"都做不到。
  正确做法：仓库只留通用默认（`workers_dev` 干脆不写 = 谁部署谁有个 workers.dev 地址），
  要关的人自己在本地改；账号 / Worker 名 / Token 这类差异一律放本机 `.env.deploy`（gitignore）
  —— `scripts/lib/deploy-target.mjs` 就是这么做的 ✓。**动 `wrangler.toml` 前先问用户**（上次就是这么出问题的）。
- **密钥一条命令搞定：`npm run secrets:init`**（`scripts/init-secrets.mjs`，2026-09-29）：缺哪个补哪个 ——
  随机生成 `SESSION_SECRET` / `STUDENT_SESSION_SECRET`（base64url 32B）与 `RECOVERY_TOKEN`（`kc-<18 hex>`，短好手输），
  用**推导出的 Worker 名**写入（`--name` → `WORKER_NAME` → `.env.deploy` → 配置默认名），然后**打印出来**并写进本机 `.env`。
  `--rotate` 全部重新生成（登录态立即失效）、`--show` 只看不改。`SSO_CLIENT_SECRET` / `QR_SIGN_SECRET` / `SMTP_PASSWORD`
  **刻意不生成**（必须与授权服务器/邮箱服务商一致），只提示怎么补。
  2026-09-29 用 `--rotate` 实测：轮换后 bootstrap 200、login 200 ✓ —— 当前 `RECOVERY_TOKEN` 已是 `kc-` 开头的新值（值只看 `.env`）。
  - ⚠️ `wrangler dev --remote` 不支持 ID-less 绑定（报 `CONFIG_KV bindings must have an "id" field`）；本地普通 `wrangler dev` 不受影响。
- **远程仓库**：remote 名 `kingcalo-icg-home` → `https://github.com/thebestskinhead/kingcola-icg-home.git`（GPL-3.0）。本地与远程原是两条互不相关的历史，2026-09-29 用 `git merge kingcalo-icg-home/main --allow-unrelated-histories` 合并（`e223097`）后推送成功。⚠️ **绝不能强推 main**（本地历史没有 LICENSE，强推会抹掉 GPL-3.0）。`main` 没设 upstream，推送写全 `git push kingcalo-icg-home main`。**仓库里 `wrangler.toml` 的 `name` 是通用默认值 `kingcola`**（用户 2026-09-29 明确：配置要通用，账号专属的东西不许进仓库）。实际部署名放在本机 `.env.deploy` 的 `WORKER_NAME`（`scripts/ci-deploy.mjs` 会自动补 `--name`）；CI 里没有这个文件，于是走默认名、再由 Cloudflare 用面板项目名覆盖（仅警告，部署照常成功）。本项目的面板项目名是 `kingcola-icg-home2`；`kingcola-icg-home` 是早期 CLI 部署留下的**孤儿 Worker**（已无域名）。
- **云资源绑定约定（2026-09-29 用户口径，以此为准）**：**首次部署自动创建 D1 / KV / R2** —— `wrangler.toml` 里 D1 的 `database_id` 与 KV 的 `id` **故意留空**（wrangler 按 `database_name` 找、找不到就建；KV 名字由 wrangler 定），R2 由 `scripts/ci-deploy.mjs` 探测后决定建还是降级。**只有想复用已有资源**才填 ID（填了就不再自动创建）；⚠️ 绝不要写假占位符（`REPLACE_WITH_...` 会让整个部署失败，撞过 `KV namespace ... is not valid`）。预设名：D1 `kingcola-db`→`DB`、R2 `kingcola-files`→`FILES`、KV 绑定名 `CONFIG_KV`；命名表与 6 个密钥名在 **README「部署」**。⚠️ 绑定以 `wrangler.toml` 为准，别只在面板 Bindings 里绑；`keep_bindings` 在 wrangler 4.137 不存在，只有 `keep_vars`。
- **自定义域名刻意不写进 `wrangler.toml`**（2026-09-29 用户指出「配置应该通用」）：写死 `pattern = "kingcola.002038.xyz"`
  等于让每个 clone 的人去挂别人的域名 → zone 归属不符直接部署失败。绑法：面板 Domains & Routes 加一次，或 `npm run deploy -- --domains <域名>`。
  实测：配置里不声明 `[[routes]]` 时 `wrangler deploy` 打印 `No targets deployed`，但**不会摘掉面板挂的域名**（部署后 `kingcola.002038.xyz` 仍 200）。
  ⚠️ 与**绑定**的处置相反：绑定以配置文件为准、面板里多出来的会被覆盖清掉；域名不会被清。
- **建表脚本 = `scripts/migrate.mjs`（跨平台 Node，2026-09-29 取代 `migrate.ps1`）**：`npm run db:migrate:local|remote`
  在任何平台都能跑（含 Workers Builds 的 Ubuntu 镜像）—— 旧的 `pwsh` 版让非 Windows 的人连建表都做不了，等于无法部署。
  带 `_migrations` 台账（name / applied_at）：执行过的文件**直接跳过、不碰库**，重复运行安全；
  老库（台账之前建的）首次跑会提示先 `node scripts/migrate.mjs <local|remote> --adopt` 登记一次（只写台账、不执行 SQL）。
  本地与线上库 2026-09-29 都已登记 12 个文件。
  ⚠️ 坑：`spawnSync('npx', [...], { shell: true })` 下，`--command "SELECT ... "` 里的**空格会被 shell 拆成多个参数** →
  命令静默失败 → 脚本误判「库是空的」→ 曾在线上跑起 `0001`（万幸它全是 `CREATE TABLE IF NOT EXISTS`，无数据损失）。
  修法：直接 `node node_modules/wrangler/bin/wrangler.js`（不过 shell）＋ 探测失败时**中止**而不是继续跑迁移。
- **部署入口 `node scripts/ci-deploy.mjs`**（`npm run deploy` 与 Workers Builds 的 Deploy command 都用它）：先 `wrangler r2 bucket list` 探测 R2，能用就原样部署，**不能用就临时剔掉 `[[r2_buckets]]` 再部署**（自动降级）。`FORCE_NO_R2=1` 强制降级、`--dry-run` 演练。⚠️ 因此 `wrangler.toml` 的 `[[r2_buckets]]` 绝不能手动删（`wrangler dev` 靠它模拟本地 R2 桶，本地开发与 smoke 8a/8b 都依赖）。
- ⚠️⚠️ **PBKDF2 迭代数受 Workers CPU 预算硬约束**：本项目账号是免费版，`worker/lib/crypto.ts` 原 150 000 次 → 线上必挂（登录/初始化返 `500 服务异常`，纯读接口全正常，极易误判成数据库/绑定问题）。实测 4 万/6 万/10 万通过、**15 万必挂** → 已改成 **50 000** 并部署验证。**已存哈希自带迭代数**，改常量不会让旧密码失效；旧哈希若本身超预算仍 500，用 bootstrap 重置一次即可。想恢复 60 万次：先升级 Workers Paid。
- ⚠️ **`wrangler secret put` 千万别用管道喂值**（会把换行一起存进去，之后怎么手输都对不上 —— 本项目踩过「恢复口令不正确」）。脚本化写密钥用 **`wrangler secret bulk secrets.json`**。排查技巧：bootstrap **先验口令、后验密码**，可用「真口令 + 1 位密码」非破坏性校验（`400 WEAK_PASSWORD`=口令对，`403 INVALID_TOKEN`=口令错，都不建号）。
- **本机日志已在 `.gitignore`**（`dev*.out|err`、`.codebuddy/*.out|err`、`*.log`）；曾被误提交的几个已 `git rm --cached` 取消跟踪（文件仍在本地）。**别再 `git add -A`** 把运行产物提交进去。

## 多会话并行（重要）
工作区被多会话并行修改（含本记忆文件）：**动文件前先读当前内容**。提交前逐文件 `git diff`，并用 `git show HEAD:<file> | findstr /C:"符号"` 验证 HEAD 是否自洽 —— 若别人新代码引用的符号不在 HEAD 里（曾出现在 applications.ts / endpoints.ts / index.ts），必须把那批文件一起提交，否则留下**编译不过的 HEAD**。中文提交信息写 UTF-8 文件 + `git commit -F`。杀 8787 上的服务时，`Get-NetTCPConnection` 给的只是 workerd，**父进程 pwsh/npm 也要清**，否则残留进程又抢回端口。

## 对象存储适配层
- 契约 `shared/storage.ts`：`StoragePurpose = 'site' | 'applications'`（可各配桶）；配置存 `site_config['storage']`，无迁移。
- `worker/lib/storage/`：`registry.ts` 插件表（内置 `r2` 与 `s3`——自实现 SigV4 预签名，兼容 R2 S3 API/MinIO/COS/OSS，无 SDK）；`index.ts` 的 `getStorage(env, purpose)` 门面。
- 直连：s3 预签名 GET/PUT；r2 不支持 → 退化 KV 一次性 token + `/api/files/direct/:token`（用后即焚）。签发口 `POST /api/admin/storage/direct-token`。后台存储页只有配置/连通性探测/直连签发，**没有文件浏览器，也没有单独的「删文件」接口**。
- `secretAccessKey` 落库但**永不下发**（只回 `secretConfigured`；保存时空值 = 保留旧值）；`resolveFileRef()` 能反解 `/api/files/<key>` 与 publicBase 直链；`applications/` 前缀私有（`GET /api/files/*` 一律 404/要求管理员会话）。

## 招新（以 `shared/recruit.ts` + `worker/lib/recruit-cycle.ts` 为准）
- 入口 `/admin/recruit`（四视图：流程/名单/邮件日志/设置，共用 `useRecruitAdmin.ts`；纯函数与常量放 `recruit-ui.ts`，**只放非组件**，否则踩 react-refresh）。
- **三条用户边界**：①「设置 vs 流程」判据 = **下一届还要不要重填一次**（要 → 本届流程：名称/四个群号/阶段/名单/评语/签到码；不要 → 通用设置：邮件模板/官网招新文案）；后端只有 `PUT /api/admin/recruit`（**不接受 state**）+ `POST /api/admin/recruit/actions`。②「资料随时可改」：名单行内改姓名/学号/邮箱/手机/QQ 与报名表，`IMMUTABLE_KEYS` 只剩 id/createdAt；**笔试现场补录不要求报名表**。③「关闭/清空」= **推倒重来**（`reset_apply`），不是临时停收、不是退回未开启。
- **状态 = `stage` + `result` 两列**：stage ∈ apply/written/interview/defense/onboard；result ∈ ''(待定)/attended/passed/failed/absent/declined/withdrawn；中文标签由 `applicationLabel()` 派生、**不入库**；阶段只相邻推进或退一步。**整届没有时间字段、也没有场次**；所有动作集中在 `RECRUIT_ACTION_META`（from/to/needsSelection/文案），后台按钮文案与可点性同源（不会「界面能点但后端拒绝」）。缺考在「结束笔试/面试/答辩」里一次标完。服务器在 UTC，**绝不能** `new Date('2026-09-25T09:00')`（差 8 小时）。
- ⚠️ **已作废、别再引入**：`recruit-auto.ts`、`/api/admin/recruit/auto`、`[triggers] crons`、`recruitPhase()`/时间窗/`site.recruitOpen`、周期的 `archives`、`shared/time.ts`、`recruit_sessions`。
- 周期配置存 D1 `site_config['recruit']`（刻意不放 runtime：模板正文不该下发给访客）；读时 `mergeCycle` 逐字段取值并校验 state。报名通道只由 `isApplyOpen(state)` 决定。
- **邮件九模板**（招新八条 + `graduation_destination`「毕业去向征集」—— 收件人是**成员**、由成员管理的批量毕业发出，**暂寄居在招新模板页**，计划日后整体迁出）：变量仅 `{name}{studentId}{cycleName}{writtenGroup}{interviewGroup}{probationGroup}{formalGroup}{inviteLink}{destinationLink}{rejectReason}{studio}{contactEmail}{contactAddress}`；**缺考与未过初筛一律不发信**；发信失败不阻断流转；只按目标状态决定发哪封 → 改判不会误发。⚠️ 群号短名（`groups.written`）≠ 模板令牌（`{writtenGroup}`），统一走 `cycleMailVars(cycle)`；**模板变量别手写键名**（出过「预览骗人」）。⚠️ 「可补发」清单是 `RECRUIT_APPLICATION_MAIL_KINDS`（= 全部模板 − 毕业去向征集），名单下拉与 `isApplicationNoticeKind()` 都用它，别再直接用 `RECRUIT_MAIL_KINDS`。
- **材料审核**（`0010`）：`applications` 加 `material_status`(''待审/approved/rejected)+`material_reason`+`material_reviewed_at`；报名阶段可逐个/批量「通过·驳回」（驳回必写理由并自动逐人发信）；**重传材料自动回到待审核**；只在 apply/apply_review 可审；**未过审不能被勾进笔试**（`MATERIAL_NOT_APPROVED`，只作用于报名→笔试）。
- **报名截止后的进度入口**：`gate=closed` 时未登录者看到「报名已截止」+「扫码登录，查看我的进度」；登录后可见审核状态与驳回理由，报名未结束可直接重传（`POST /api/applications?replace=true`，**`replace` 只认 query 参数**）。
- **签到 = 阶段 + 凭证**：`recruit_checkin_tokens` 只绑 `stage`(written/interview/defense)+`expires_at`+`revoked_at`，**签发新码自动作废该阶段旧码**；签到页只有 `/checkin/<token>`。⚠️ `QR_SIGN_SECRET` 是 SSO applyToken 验签密钥，**不是**签到码密钥。
- **`close_cycle`**：未确认的记 absent → 导出 CSV 到 `applications/archives/` → 存档信息进周期 → 删报名表 → 清空报名与发信日志 + 签到凭证 → 写 `closedAt` → 回 dormant；**对象存储没接通就拒绝关闭**。
- **`reset_apply`**：只在 apply/apply_review 可用；删光报名记录+报名表+发信日志（**跳过 `RECRUIT_ARCHIVE_SCOPE`**，别误删往届存档），state 退回 `prepare`；**不导出存档、不因存储不可用拒绝**；返回 `cleaned{applications,files,filesFailed}`。
- **邀请函转正** `POST /api/applications/invite/:token`（凭证即密权，14 天、只能确认一次）→ 写 `members` 并回记 `memberId`；**头像必传**（`/invite/:token/avatar`，同凭证、免登录），确认时只接受本站 `avatars/` 前缀（拒任意外链）；「负责方向」必填；三个入口共用 `pendingInviteError()`。
- **上传公共实现** `worker/routes/uploads.ts: receiveImage(ctx, resolveScope)`（multipart → 体积 → 魔数 → 落站点存储，**不含鉴权**）；管理员口读表单 `scope`，邀请函**硬编码 `avatars`**。
- **毕业去向填写页**（`/graduate/:token`，凭证即密权、免登录）：成员管理「批量毕业」或「发送去向征集」时签发 `members.destination_token`（**签发即覆盖旧的**；提交后清空 → 一条只能用一次；**没有过期时间**）。页面 `src/sections/GraduateSection.tsx`；接口 `GET|POST /api/members/destination/:token`（`worker/routes/members.ts` + `lib/member-destination.ts`），**裸 SQL**，因为 token 绝不能进 `shared/resources.ts` 字段表（那会让公开 bootstrap 把它下发出去）。⚠️ 因此 `destination` 也**不再是 `requiredWhen`**（由本人异步填，强制必填会让管理员连改头像都被挡住）。
- ⚠️ **没有「毕业年份」字段**（2026-09-29 用户明确：届别就是**加入年份** `joinYear`）：别再引入 `graduation_year`/`Member.graduationYear`/向导年份输入。`graduate` 接口只把 `status` 改成 `alumni`（幂等，无 `year` 参数）；界面「哪一届」全由 `joinYear` 分组回显。曾短暂加过 `0013_member_graduation_year.sql` + `year` 入参，**当天已整体撤回**。
- **表/文件**：`applications` + `application_mails` + `recruit_checkin_tokens`；**已有数据的库必须单独**执行新迁移 SQL。报名表与存档都在 `applications/` 前缀（私有）；下载 `GET /api/admin/applications/:id/file`，后补/替换 `POST .../:id/file`。
- 自检 `scripts/smoke-applications.ps1`（109 项，需 8787）。**别把输出接到 `Select-Object -First N`**（上游 pwsh 会继续跑，两条自检互相推进状态机）。⚠️ 该脚本从「关闭本届」跑到底 → **会归档并清空本地报名数据**；跑前先杀掉手动起的服务。

## 邮件（SMTP）
- 契约 `shared/mail.ts`；配置存 `site_config['runtime'].mail`。
- **密码存 D1**：`SESSION_SECRET` 经 HKDF 派生密钥 AES-GCM 加密成 `enc$<iv>.<密文>`；`SMTP_PASSWORD` 仅兜底（库里优先）。下发一律剥离密码，后台只拿 `mailPasswordSource`；保存三态：**不带 password 键=不改 / 空串=清除 / 有值=更新**；KV 存的是密文版。
- `worker/lib/smtp.ts`（cloudflare:sockets，465 TLS / 587 STARTTLS → startTls 后必须重建 reader/writer 再 EHLO）；`worker/lib/mailer.ts`（RFC 2047 + Base64 折行）；`POST /api/admin/mail/test`（400=配置错 / 502=发送失败）。
- 25 端口被封；生产不能连 localhost/私有网段（本地 miniflare 可以）；`import { connect, type Socket } from 'cloudflare:sockets'` 会 TS2305（Socket 是全局类型）。

## SSO
`shared/sso.ts` + `worker/routes/sso.ts` + `worker/lib/student-auth.ts`；两套会话 `kc_admin`(12h)/`kc_student`(30d)；开关与地址存 `runtime.sso`，判定统一 `isSsoReady()`；回调失败 302 首页 `?login=<原因>`。授权服务器在另一仓库（EdgeOne），契约改动三方同步。2026-09-24 起 RuntimeConfig **已删 `join` 通道**（请求恒定同源）；failover/rolloutPercent 只为兼容旧 JSON 保留、无人消费。

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
- `db:migrate:*` 会重跑全部 migrations（靠报错跳过）；有数据的库只单独执行新增文件。
- `smoke-api.ps1` 异常中断会留下「冒烟测试工作室」配置，跑完到后台确认还原。
- **React 列表 key 不能取自可编辑内容**：敲一个字 key 就变 → React 重建该行 → 焦点丢失（表现为「编辑框打不了字」）。用与内容无关的本地 id（`MemberRolesPage.tsx` 的 `EditableRole.rowId` 是范例）。
- 全量 `npx eslint src shared worker` 有 8 个**既有**错误，都在 `src/components/ui/*`（shadcn），与业务改动无关。
- `git commit --no-verify=false` 会**静默失败**（非法参数，被 `Select-String` 过滤后看着像没输出）—— 布尔开关不要带 `=值`。
