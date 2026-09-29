# 拾光工作室官网

学生工作室的对外门户 + 内部内容管理后台。

- **前台**：每个板块一个独立路径 —— 首页 `/` · 新闻动态 `/news`（详情 `/news/:id`）· 项目介绍 `/projects` ·
  团队成员 `/members` · 加入我们 `/join` · 邀请函确认 `/invite/:token` · 扫码签到 `/checkin/:token`
  （只读，数据来自后端接口；可直接输地址、刷新、分享链接）
- **后台**：`/admin`，单管理员登录。招新是**一个入口 `/admin/recruit`**，内部四个视图
  （**流程**（时间线 + 阶段面板 + 本届信息）/ **名单** / **邮件日志** / **设置**），
  阶段推进全靠按钮；另有成员、项目、新闻、轮播、**方向与身份**、站点设置、对象存储与流量通道

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | React 19 · TypeScript · Vite 7 · Tailwind CSS 3 · shadcn/ui |
| 后端 | Cloudflare Workers + Static Assets |
| 数据 | Cloudflare D1（唯一事实源）· KV（配置缓存）· R2（站点图片与报名表，经存储适配层，可换成任意 S3 兼容存储） |
| 教务网登录 | 国内腾讯云 EdgeOne（授权服务器；主站只消费授权码，不接触教务网） |

前端与后端**同仓同部署**。`wrangler.toml` 里配置了 `run_worker_first = ["/api/*"]`，
静态资源由 Cloudflare 边缘直接返回，**不消耗 Worker 调用配额**，只有 API 请求才进 Worker。

## 目录结构

```
src/            前台页面 + /admin 后台
shared/         ★ 前后端共享契约（类型、资源字段表、登录契约、运行时配置）
worker/         Worker 后端（路由、认证、加密、D1 仓储）
migrations/     D1 建表 SQL
scripts/        端到端冒烟测试
docs/           交接文档
```

## 环境要求

- Node.js **22.12+**（Vite 7 要求；20.15 会告警）
- 首次部署需要 Cloudflare 账号

## 本地开发与测试

```bash
npm install
npm run db:migrate:local      # 首次执行：在本地 .wrangler/state 建表（按顺序执行 migrations/*.sql）
```

本地密钥放在 `.dev.vars`（已 gitignore），格式见文件内注释。

### 方式一：一条命令，和线上完全一致（**推荐用来做功能验收**）

```bash
npm run local                 # = npm run build && wrangler dev
```

浏览器打开 <http://127.0.0.1:8787>。
前端静态资源与 API **同源**，和线上 Workers + Static Assets 的形态一模一样，
适合完整测试 CMS、后台、报名流程。缺点是改了代码需要重新执行 `npm run local`。

### 方式二：两个终端，带热更新（适合改代码）

```bash
# 终端 A：本地后端（8787）
npm run dev:api

# 终端 B：前端（5175，/api 自动代理到 8787）
npm run dev
```

浏览器打开 <http://127.0.0.1:5175>。

> **端口说明**：本机 3000 与 5173 已被其它服务长期占用，因此前端固定用 **5175**，
> 并设置了 `strictPort: true` —— 端口被占时会直接报错，而不是悄悄换到别的端口让你访问到别的服务。

### 首次使用需要初始化管理员

本地 D1 是空的，先创建管理员账号（只会成功一次），并可选写入演示内容：

**推荐：打开 <http://127.0.0.1:8787/install>** —— 填管理员用户名 + 密码即可；
建表、生成签名密钥都由应用自己完成（密钥写进本地 D1 的 `app_secrets`）。

也可以敲命令（不再需要任何口令）：

```bash
curl -X POST http://127.0.0.1:8787/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"username":"admin","password":"kingcola-dev-2026","seedContent":true}'
```

- 也可以登录后在「概览 → 写入演示数据」补内容
- 已安装后再调这个接口会被拒绝；改密码请在登录后自行修改

### 本地自检脚本

```bash
pwsh -NoProfile -File scripts/smoke-api.ps1    # 接口：认证 / 四类内容 CRUD / 站点设置 / 流量切换 / 教务网登录 / 审计
pwsh -NoProfile -File scripts/probe-local.ps1  # 页面：前台与后台深层路由、静态资源引用
```

> 含中文的 `.ps1` 必须用 `pwsh`（PowerShell 7）运行；Windows PowerShell 5.1 会因编码问题报语法错误。
> **只有这几个自检脚本依赖 PowerShell**：部署（`npm run deploy`）与建表（`npm run db:migrate:*`）
> 都是普通 Node 脚本，macOS / Linux 上照样能跑；非 Windows 想跑自检就装个 PowerShell 7
> （macOS：`brew install --cask powershell`）。
> 两个脚本都会自行启动 `wrangler dev`、测完再关闭；它们**只会清理自己启动的进程**，
> 不会影响你用 `npm run local` 开着的服务。运行前请确认 8787 端口空闲。

## 部署

### 1. 云资源（**首次部署会自动创建，不用先手动建**）

三个资源与绑定别名都是预设好的，`wrangler.toml` 里已经写好，**默认不需要你填任何 ID**：

| 资源 | 预设名字 | 代码里的绑定别名 | 首次部署时 |
|---|---|---|---|
| D1 数据库 | `kingcola-db` | `DB` | 自动创建（按 `database_name` 找，找不到就建） |
| KV 命名空间 | 由 wrangler 定 | `CONFIG_KV` | 自动创建（KV 没有名字字段，所以你不用管它叫什么） |
| R2 存储桶 | `kingcola-files` | `FILES` | 开通了 R2 就自动建；没开通就自动降级（见下） |

**想复用自己已经建好的资源**（比如数据要留在老库里），就把 ID 填进 `wrangler.toml` 对应段落 ——
填了就不会再自动创建：

```toml
[[d1_databases]]
binding = "DB"
database_name = "kingcola-db"
database_id = "你的库 ID"          # 不填 = 首次部署自动创建

[[kv_namespaces]]
binding = "CONFIG_KV"
id = "你的命名空间 ID"              # 不填 = 首次部署自动创建
```

> ⚠️ **绑定以 `wrangler.toml` 为准**：别只在 Cloudflare 面板的 Bindings 里手动绑定 ——
> 下次 `wrangler deploy` 会按配置文件整体覆盖绑定，面板里多出来的会消失。
> （`keep_vars` 只能保住环境**变量**；绑定的 `keep_bindings` 在 wrangler 4.x 里并不存在。）
>
> ⚠️ **别写假的占位符 ID**：`database_id` / `id` 会被**原样发给 API**，填 `REPLACE_WITH_...`
> 会让整个部署失败（我们撞过的 `KV namespace ... is not valid` 就是这么来的）。
> 要么留空（= 自动创建），要么填真实 ID。

> **没有开通 R2？不用管，部署会自动降级。** R2 属于「要先在面板开通一次」的服务，没开通的账号
> 直接 `wrangler deploy` 会在 provision 那一步失败。所以部署统一走 `node scripts/ci-deploy.mjs`
> （`npm run deploy` 与 Workers Builds 的 Deploy command 都用它）：它先探测 R2 能不能用 ——
> 能用就按 `wrangler.toml` 原样部署（零配置拿到 FILES 绑定），不能用就临时把 `[[r2_buckets]]`
> 剔掉再部署。降级后**站点不会崩**：上传 / 报名表接口返回 503「对象存储未接通」，
> 后台「对象存储」页可改接任意 S3 兼容存储（MinIO / 腾讯 COS / 阿里 OSS，或 R2 自己的 S3 API，
> 无需重新部署），关闭本届会因无法归档而拒绝（保护数据）。
> 想强制按「没有 R2」部署：构建环境变量加 `FORCE_NO_R2=1`；想完全跳过探测：
> 把 Deploy command 直接写成 `npx wrangler deploy`。
>
> ⚠️ `wrangler.toml` 里的 `[[r2_buckets]]` **不要手动删** —— `wrangler dev` 靠它模拟本地 R2 桶，
> 本地开发与 `scripts/smoke-api.ps1` 的头像上传都依赖它（删了本地自检会挂）。

### 2. 写入密钥（名字是预设的，共 6 个）

| 名称 | 用途 |
|---|---|
| `SESSION_SECRET` | 管理员会话签名 |
| `STUDENT_SESSION_SECRET` | 报名学生会话签名（与管理员各自独立） |
| ~~`RECOVERY_TOKEN`~~ | **已废弃**：安装与建管理员改由 `/install` 页面完成，不再需要任何口令 |
| `QR_SIGN_SECRET` | 校验授权服务器签发的身份凭证（**须与其 `APPLY_TOKEN_SECRET` 一致**） |
| `SSO_CLIENT_SECRET` | 向授权服务器换取身份的客户端凭据（**须与其同名变量一致**） |
| `SMTP_PASSWORD` | 邮件通知的 SMTP 密码 / 授权码（未启用邮件可不填） |

```bash
npx wrangler secret put SESSION_SECRET            # 其余五个同理，逐个执行（交互式粘贴值）
```

> ⚠️ **批量写入要带 `--name`**：写成 `npx wrangler secret bulk .env --name <你的 Worker 名>`。
> 不带 `--name` 时 wrangler 会用 `wrangler.toml` 里的通用名（默认 `kingcola`），
> **把密钥写到别的 Worker 上、甚至新建一个同名 Worker** —— 站点看起来就像「密钥没生效」。
> 写完立即生效，**不需要重新部署**。
>
> ⚠️ **用脚本/管道批量写入时，别用 `echo '值' | wrangler secret put NAME`** —— 实测会把**换行也存进去**，
> 于是之后无论怎么手输都对不上（表现为「恢复口令不正确」这类「值明明对却报错」的现象）。
> 脚本化请改成 `wrangler secret bulk secrets.json`，JSON 里的字符串值不会被带上换行。
> 手动逐个执行 `secret put` 后按回车结束输入的方式不受影响。

本地开发用同名变量放在 `.dev.vars`（已 gitignore）。

**或者一条命令自动生成并写入**（推荐，尤其首次部署）：

```bash
npm run secrets:init              # 缺哪个补哪个：随机生成 → 写入 Worker → 打印出来
npm run secrets:init -- --rotate  # 全部重新生成（⚠️ 所有登录态立即失效）
npm run secrets:init -- --show    # 只看 .env 里现在的值，不改也不写
```

它会自动取你的 Worker 名（`--name` → `WORKER_NAME` → `.env.deploy` → 配置里的默认名）——
**写密钥必须带对名字**，否则会写到一个新建的同名 Worker 上、看起来「密钥没生效」。
生成的值同时写进 `.env`（已 gitignore）并打印在终端：Cloudflare 的 secret 是**只写不读**的，丢了只能重设。

必须与授权服务器一致的 `SSO_CLIENT_SECRET` / `QR_SIGN_SECRET`、以及邮箱授权码 `SMTP_PASSWORD`
**不会被自动生成**（只提示你去填），避免两边对不上。

### 3. 构建并部署（**这一步会把 D1 / KV / R2 建出来**）

```bash
npm run deploy        # = npm run build && node scripts/ci-deploy.mjs
```

`scripts/ci-deploy.mjs` 会先探测账号能不能用 R2：能用就按 `wrangler.toml` 原样部署，
不能用就自动剔掉 R2 绑定再部署（见下面那条说明），所以**没有开通 R2 也能一次部署成功**。

> **部署到哪个 Worker、绑哪个域名**（这两项是「账号专属」，刻意**没有**写死在仓库里）：
>
> - **Worker 名**：`wrangler.toml` 里放的是通用默认名 `kingcola`。要部署到自己面板里的项目，
>   在本机建一个 `.env.deploy`（已 gitignore）写 `WORKER_NAME=<面板里的项目名>`，
>   `scripts/ci-deploy.mjs` 会自动给 `wrangler deploy` 带上 `--name`；
>   临时一次性的也可以 `npm run deploy -- --name <项目名>`，或设环境变量 `WORKER_NAME`。
>   （用 Git 连接构建时没有这个文件，就按默认名走 —— Cloudflare 会用面板项目名覆盖，
>   日志里那句 `Failed to match Worker name` 只是警告，部署照样成功。）
>   同一个 `.env.deploy` 里还能写 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`：**换账号时比重新
>   `wrangler login` 稳**（不走 `localhost` 回调，也不会覆盖你已有的登录态），部署 / 迁移 / 写密钥三个脚本都会自动带上。
> - **自定义域名**：面板 → 选中本 Worker → Settings → Domains & Routes → Add custom domain
>   （加一次即可，后续部署不会清掉）；也可以 `npm run deploy -- --domains <你的域名>`。
>   线上**必须**有自己的域名：`*.workers.dev` 在国内被 DNS 污染，干脆访问不了
>   —— 这也是 `workers_dev = false` 的原因。
>   **还没买域名？** 先把 `wrangler.toml` 里的 `workers_dev = false` 删掉（或改成 `true`），
>   部署完就能用 `https://<Worker 名>.<你的子域>.workers.dev` 访问（国内需代理）；
>   有域名后到面板挂上、再把 `workers_dev` 改回来即可。

构建日志里出现 `Provisioning` / `Creating new D1 Database | KV Namespace | R2 Bucket` 就是它在建资源。
再构建一次若还不断出现 `Creating new ...`，说明没能复用 —— 去面板把它的 ID 填进 `wrangler.toml`
（照上面「想复用已有资源」的写法），就不会再重复建了。

### 4. 建表（**必须在首次部署之后** —— 库那时候才存在）

```bash
npm run db:migrate:remote        # 按库名 kingcola-db 执行，不需要 ID
```

### 5. 初始化管理员（线上只需一次）

**推荐：在页面上做。** 打开 `https://<你的域名>/admin` —— 系统发现还没有管理员时，
登录页会变成「**首次初始化**」引导：填**初始化口令**（就是上一步设置的 `RECOVERY_TOKEN`）+
用户名 + 密码，可勾选同时写入演示内容；提交后直接建号并进入后台
（之后这一页就恢复成普通登录表单，不再显示引导）。

**也可以自己敲命令**（效果完全一样）：

```bash
curl -X POST https://<你的域名>/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<RECOVERY_TOKEN>","username":"admin","password":"<至少 8 位>","seedContent":true}'
```

> 这条命令还有个用途：**忘记密码时用它重置**（库里已有管理员时，它的行为是「重置该用户名的密码」，
> 不会重复建号；用户名不存在则返回 404）。登录后建议立刻去「系统设置 → 管理员密码」改成自己的密码。

### 6. 部署完自查这 6 项

| 检查 | 期望 |
|---|---|
| 构建日志 | Build command 绿、`Provisioning` / `Creating new ...` 出现过（首次），最后 `Deployed` |
| 资源 | 面板里能看到 D1 `kingcola-db`、KV、R2 `kingcola-files`（缺哪样看第 1 节的说明） |
| 密钥 | 6 个 secret 都已写入（`npx wrangler secret list`） |
| 建表 | `npm run db:migrate:remote` 跑过（否则后台一进去就报错） |
| 管理员 | `/admin` 能初始化并登录 |
| **登录/初始化报「服务异常」** | 多半是 **PBKDF2 迭代数超过了 Workers 免费版的 CPU 预算**（纯读接口都正常，只有要算密码哈希的接口挂）。本项目实测：10 万次通过、**15 万次必挂**，故取 5 万次；详见 `worker/lib/crypto.ts` 顶部注释。要更高强度就升级 Workers Paid 再调大 |
| 健康检查 | `curl https://<你的域名>/api/health` → `database: ok`，`storage.site/applications` 符合预期 |

> **也可以连 Git 自动部署**（Cloudflare 面板 → Worker → Settings → Builds → Connect）：
>
> | 构建配置项 | 填什么 |
> |---|---|
> | Build command | `npm run build` |
> | Deploy command | `node scripts/ci-deploy.mjs`（**不要**用 `npm run deploy`，那会二次构建） |
> | Root directory | 留空 |
>
> 四点注意：
> ① **项目名（Worker 名）必须和 `wrangler.toml` 的 `name` 一致** —— 面板从仓库导入时默认用仓库名，
> 不一致会看到 `Failed to match Worker name... Overriding using the CI provided Worker name` 并自动开 PR；
> ② 构建镜像默认 Node 24（实测跑得通），想钉住就加构建变量 `NODE_VERSION=22`；
> ③ **数据库迁移不会自动跑**，上面第 4 步仍要手动执行（Workers Builds 自带的 token 没有 D1 权限）；
> ④ `[env.preview]` 里没有重写绑定（wrangler 的绑定**不会**从顶层继承到具名环境），
> 要开预览构建得先给它补上 D1/KV/R2。

完整步骤与交接事项见 [`docs/HANDOVER.md`](docs/HANDOVER.md)。

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 前端开发服务器（5175，见上方端口说明） |
| `npm run dev:api` | Worker 本地运行（8787） |
| `npm run build` | 类型检查 + 构建前端 |
| `npm run deploy` | 构建并部署到 Cloudflare |
| `npm run typecheck` | 只做类型检查（前端 + Worker） |
| `npm run db:migrate:local` / `:remote` | 执行 `migrations/*.sql`（Node 脚本，跨平台）。已执行的记在 `_migrations` 台账里，**重复运行自动跳过**；老库（台账之前建的）首次要 `node scripts/migrate.mjs <local\|remote> --adopt` 登记一次 |
| `npm run secrets:init` | 生成密钥 → 写入 Worker → 打印出来（值同时存进 `.env`）。`-- --rotate` 全部轮换，`-- --show` 只看 |
| `pwsh -File scripts/smoke-api.ps1` | 内容 / 设置 / 认证 端到端自检 |
| `pwsh -File scripts/smoke-applications.ps1` | 招新全链路自检（状态机、材料审核、替换与补录、签到二维码、通知邮件、归档清空） |

## 设计要点

- **一份元数据驱动两端**：`shared/resources.ts` 描述每个内容类型的字段，
  Worker 据此生成 SQL 与校验，后台据此渲染表格与表单。新增内容类型只需改这一处。
  字段还支持 `showWhen`（按另一字段取值条件显示，如成员「在组只填负责方向、已毕业只填毕业去向」）
  与 `scope`（上传目录）等声明式配置。
- **成员「方向 / 角色」是后台可维护的字典**（`/admin` → **方向与身份**，契约在 `shared/identity.ts`）：
  字段上标 `optionsSource: 'memberRoles'`，`shared/resources.ts` 里的 `options` 只作兜底，
  真实合法取值由调用方注入。它**存的是中文方向名本身**，所以改名单只影响之后新增的成员，
  已保存的成员保留当时的角色名（老照片、新闻稿里的称谓不会跟着变）—— 也正因为如此，
  删改方向永远安全、不需要任何数据迁移。标为「指导老师 / 管理岗」的方向**不会出现在邀请函里**，
  学生只能自助选择学生方向（后端还会独立再校验一次）。
- **官网没有任何写死的文案**：工作室名称、Logo、简介、联系方式、页脚、招新文案全部来自 D1
  的 `site_config`，后台「系统设置」分页签维护；前后台共用 `shared/types.ts` 的 `SiteConfig`
  与 `shared/site.ts` 的解析规则（列表类文案的格式约定都收在这里）。新增字段**不需要数据库迁移**。
- **招新是一个覆盖整届的模块**：状态用「阶段 + 该阶段结果」两列描述（报名/笔试/面试/答辩/转正 ×
  待定/已参加/通过/未通过/未参加/婉拒/退出），规则集中在 `shared/recruit.ts`，后台会拒绝跳阶段。
  **整届没有任何时间字段**：每一次开与关都由管理员点按钮（`RECRUIT_ACTION_META` 一张表驱动按钮文案与可点性），
  没有到点自动开 / 自动关，也没有 cron。
  **也没有「场次」概念**（考试安排走对应的 QQ 群通知）：签到二维码**只绑阶段**，带失效时间、可一键作废
  （同一阶段至多一张有效码），前端 `qrcode.react` 渲染；同学填「姓名 + 学号」即签到。
  报名阶段可逐个「**通过 / 驳回**」材料：驳回自动发信说明理由，同学重传后回到待审核，
  **未通过审核的人进不了下一阶段**。
  同一学号重复提交会**替换材料并删除旧文件**（文件统一重命名为「姓名+学号+报名表」）；
  未报名但来考的人由管理员在报名阶段补录。
  需要决策的动作一律**先预览名单、勾选后执行**（谁进笔试 / 谁被录取），按模板发出对应通知邮件；
  关闭本届 = **先归档 CSV 再清空**，对象存储没接通就拒绝关闭。
  报名表与存档落在对象存储的 `applications/` 前缀下，**只有管理员会话能下载**（含学号姓名，匿名一律 404）。
  答辩通过后凭邮件里的一次性链接 `/invite/:token` 补齐档案（**头像必传**，走凭证鉴权的
  `POST /api/applications/invite/:token/avatar`，不需要登录态），确认后后端当场写入成员表。
- **响应统一信封**：所有接口返回 `{ ok: true, data }` 或 `{ ok: false, error }`。
- **运行时配置**：`/api/config/runtime` 只下发公开项（站点文案、`runtime.sso` 开关等），
  SMTP 密码与对象存储密钥**永不下发**；API 恒定同源，**没有**通道切换与灰度
  （旧的 `join` 通道、`failover` / `rolloutPercent` 已作废，字段仅为兼容旧 JSON 保留）。
- **教务网登录走授权码模式**：官网不接触教务网，跳转到国内授权服务器完成认证与授权，
  回调时用授权码换回身份、验签后再种下自己的会话。管理员与报名同学两套会话各自独立，
  换密钥或登出互不影响。
- **管理员账号存 D1**：不绑定个人云账号，换届时下一届可自行改密码，
  配合 `RECOVERY_TOKEN` 做灾备找回。
