# 工作室官网 · 交接文档

> 本文档的唯一目的：**让下一届成员在没有前任在场的情况下，独立完成部署、维护与故障恢复。**
> 请随每届交接一起移交，并在改动后同步更新。

---

## 1. 我们用了什么

| 层 | 技术 | 说明 |
|---|---|---|
| 前端 | React 19 + TypeScript + Vite 7 + Tailwind 3 + shadcn/ui | 构建产物是纯静态文件 |
| 后端 | Cloudflare Workers + Static Assets | 与前端**同仓同部署**，只有 `/api/*` 会进 Worker |
| 数据库 | Cloudflare D1（SQLite） | 唯一事实源：内容、管理员、审计、站点配置 |
| 缓存 | Cloudflare KV（可选） | 运行时配置缓存；缺失时自动降级为直读 D1 |
| 文件 | Cloudflare R2 | 成员头像、首页轮播图、**报名表**（报名表仅管理员可下载） |
| 教务网登录 | 国内腾讯云 EdgeOne（授权服务器） | 因为要访问学校教务网，**必须部署在国内** |

前台只读，所有写操作都在 `/admin` 后台完成。

---

## 2. 仓库结构

```
kingcola/
├─ src/                 前台页面 + 后台页面
│  ├─ api/              前端 API 层（运行时通道解析、失败自动切换）
│  ├─ admin/            /admin 后台（登录、概览、招新、内容管理、设置、日志）
│  └─ sections/         官网各页面（含邀请函确认页）
├─ shared/              ★ 前后端共享契约（改这里要同时考虑两端）
│  ├─ types.ts          实体类型
│  ├─ resources.ts      资源字段表：一份配置驱动 Worker CRUD 与后台表单
│  ├─ recruit.ts        招新报名状态机、表单校验、通知触发规则
│  ├─ identity.ts       成员「方向 / 角色」字典契约（存中文名，改名不回写历史）
│  ├─ mail.ts           邮件（SMTP）配置契约
│  ├─ sso.ts            教务网登录接口契约
│  ├─ runtime.ts        运行时配置 / 流量通道契约
│  └─ seed.ts           演示种子数据
├─ worker/              Cloudflare Worker 后端
│  ├─ index.ts          路由注册与入口
│  ├─ lib/              认证、加密、响应、D1 仓储、报名仓储、邮件、方向字典
│  └─ routes/           公开接口、后台接口、报名、教务网登录、运行时配置、方向字典
├─ migrations/          D1 建表 SQL
├─ scripts/smoke-api.ps1          内容 / 设置 / 认证 端到端冒烟测试
├─ scripts/smoke-applications.ps1 招新报名链路自检（状态机 + 邮件 + 隐私）
└─ wrangler.toml        Cloudflare 绑定与配置
```

---

## 3. 云资源清单（交接时必须逐项确认）

| 资源 | 名称 | 在哪里看 | 备注 |
|---|---|---|---|
| Cloudflare 账号 | （填写主账号邮箱） | dash.cloudflare.com | **必须移交账号或至少移交权限** |
| Worker | `kingcola-icg-home` | Workers & Pages | 部署入口（**名字必须与 `wrangler.toml` 的 `name` 一致**，否则 Git 构建会报 `Failed to match Worker name`） |
| D1 数据库 | `kingcola-db` | Storage & Databases → D1 | **含全部业务数据，务必勿删** |
| KV 命名空间 | `CONFIG_KV` | Storage & Databases → KV | 可随时重建，仅为缓存 |
| R2 存储桶 | `kingcola-files` | R2 | 头像 / 轮播图 / 报名表（报名表仅管理员可下载） |
| 自定义域名 | （填写） | Worker → Settings → Domains | 可选，默认用 `*.workers.dev` |
| 国内授权服务器 | 腾讯云 EdgeOne 项目 | console.cloud.tencent.com | 见第 8 节 |

> 首次拿到 D1 后，把 `database_id` 填进 `wrangler.toml`；KV 的 `id` 同理。

---

## 4. 密钥清单

**所有密钥都不写在代码里**，生产环境用 `npx wrangler secret put <NAME>` 写入；本地开发放在 `.dev.vars`（已 gitignore）。

| 名称 | 用途 | 丢失后果 |
|---|---|---|
| `SESSION_SECRET` | 管理员会话签名 | 换新值即可，代价是管理员被登出 |
| `STUDENT_SESSION_SECRET` | 报名学生会话签名（与管理员各用各的） | 换新值即可，代价是已登录同学需重新登录 |
| `QR_SIGN_SECRET` | 校验授权服务器签发的身份凭证，**必须与其 `APPLY_TOKEN_SECRET` 完全一致** | 回调换身份失败，需两处同时更换 |
| `SSO_CLIENT_SECRET` | 向授权服务器换取身份时的客户端凭据，**必须与其同名变量一致**；**推荐在后台「系统设置 → 流量通道」填**（加密存 D1），环境变量只作兜底 | 回调换身份失败，需两处同时更换 |
| ~~`RECOVERY_TOKEN`~~ | **已废弃（2026-09-29）**：安装与建管理员改由 `/install` 页面自动完成 | 不再需要，见第 5 节 |
| `SMTP_PASSWORD` | SMTP 登录密码 / 授权码（邮件通知用，服务器地址等在后台维护） | 邮件发不出去，去邮箱服务商后台重新生成授权码即可 |

> **交接建议**：把这些值抄写在一张纸上，或放在工作室共用的密码管理器中，
> 与本文档一并交给下一届。**不要把明文写进 git 仓库。**

---

## 5. 首次部署

```bash
# 0. 环境：Node.js 22.12+（Vite 7 的要求，20.19 以下会警告）
npm install

# 1. 云资源：**首次部署会自动创建 D1 / KV / R2**，不需要先手动建
#    （D1 名 kingcola-db、R2 桶名 kingcola-files；想复用已有资源才把 ID 填进 wrangler.toml）

# 2. 建表（Node 脚本，Windows/macOS/Linux 都能跑；老库第一次要先加 --adopt 登记台账）
npm run db:migrate:remote

# 3. 写入密钥
npx wrangler secret put SESSION_SECRET          # 管理员会话
npx wrangler secret put STUDENT_SESSION_SECRET  # 报名学生会话
npx wrangler secret put RECOVERY_TOKEN
npx wrangler secret put QR_SIGN_SECRET          # 校验授权服务器签发的身份凭证
npx wrangler secret put SSO_CLIENT_SECRET       # 可选：与授权服务器约定的客户端凭据，也可在后台填（推荐）
npx wrangler secret put SMTP_PASSWORD           # 邮件通知的 SMTP 登录密码（未启用邮件可不填）

# 4. 构建并部署
npm run deploy

# 5. 初始化管理员（把 <TOKEN> 换成刚设置的 RECOVERY_TOKEN）
curl -X POST https://<你的域名>/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<TOKEN>","username":"admin","password":"<至少8位密码>","seedContent":true}'

# 6. 自检
curl https://<你的域名>/api/health
```

完成后访问 `/admin` 登录。**登录后请立即到「系统设置 → 管理员密码」改成自己的密码。**

---

## 6. 日常运维

| 想做什么 | 怎么做 |
|---|---|
| **开一届招新** | `/admin` → 招新：休眠大屏上点**「启动系统，开始新的周期」**→ 流程页「本届信息」填名称与四个 QQ 群号 → 点**「开启报名」**。整届没有任何时间字段，开不开由你点。后续想改名 / 改群号：流程页顶部「本届信息」，或点时间线的「备招」节点 |
| **招新期推进流程** | 一页到底：报名（收表 / 补录 / 剔除）→「结束报名」→ 勾选「确认笔试名单」→ 笔试（二维码 / 补签 / 补录）→「结束笔试」→ 录成绩 → 勾选「生成面试名单」→ 面试 →「确认录取」→ 答辩 → 勾选「确认最终名单」。每个批量动作都先勾名单再执行 |
| **录笔试/面试/答辩成绩** | 阶段收尾页的名单里就地填（失焦即保存）；也可以在「名单 → 详情」里改 |
| **现场来了没报名的人** | 报名阶段：「补录未报名考生」，姓名 + 学号即可；**笔试现场**：「补录考生」，邮箱 / 手机 / QQ 必填、报名表可后补 |
| **补录后补齐材料 / 改资料** | **名单** → 那个人 →「**详情 · 改资料**」：姓名 / 学号 / 联系方式都能改，报名表可后补或替换（同一套校验，旧文件自动删） |
| **报名被刷屏 / 配错了想推倒重来** | 报名页最下面那张红卡「**强制结束报名并清空数据**」：删光已收的记录与报名表文件，回到备招重新「开启报名」（**不导出存档**，这点与「关闭本届」不同） |
| **看招新进度** | 流程页顶部摘要条（漏斗 + 总人数 + 已转正）；筛人 / 导出 CSV 去「名单」 |
| **审核报名材料（通过 / 驳回）** | 报名阶段 → **名单**：每行「通过 / 驳回」，勾选后可批量「通过材料 / 驳回材料…」。**驳回必须写理由，会立刻发信**要同学改材料；没通过审核的人**不能被勾进笔试** |
| **同学报名结束后想查进度** | 官网「加入我们」→「**扫码登录，查看我的进度**」（教务网微信扫码）：材料审核状态、驳回理由、后续该进的群都在里面；被驳回且报名还没结束时，页面直接给出「重新上传材料」的表单 |
| **改感谢信 / 邀请函文案** | `/admin` → 招新 → **邮件模板**：8 条模板都可改，右侧实时预览，写错的变量会标出来 |
| **查谁收到过什么邮件** | `/admin` → 招新 → **邮件日志** |
| **补签 / 单独通知某人** | `/admin` → 招新 → **名单**：勾选一批人批量补签 / 批量审核材料，或点开单人改全部资料、记评语、补发邮件、复制邀请链接 |
| 改成员 / 项目 / 新闻 / 轮播 | `/admin` → 左侧对应菜单（改完 30 秒内官网生效） |
| 换首页首屏轮播 | `/admin` → 首页轮播 → 编辑「轮播类型」：**文字版**=大标题+描述+按钮排版；**图片版**=只放一张横图铺满首屏（不叠加文字，单张最大 50MB） |
| 上传成员头像 | `/admin` → 团队成员 → 编辑成员 → 「头像」处选择图片（≤2MB，JPG/PNG/WebP/GIF；留空则用姓名首字占位头像） |
| 填「负责方向」/「毕业去向」 | 编辑成员时按「状态」自动切换输入框：选「在组」只显示负责方向，选「已毕业」只显示毕业去向。前台也按状态各取所需 |
| **改成员的角色方向名单（增删改 / 停用）** | `/admin` → **方向与身份**：整表编辑后点「保存」。**改名单只影响之后新增的成员**，已保存的成员保留当时的角色名；标为「指导老师 / 管理岗」的方向不会出现在邀请函里（详见 §6.10） |
| **改工作室名称 / Logo / 简介 / 联系方式** | `/admin` → 系统设置 → 「品牌与联系方式」「首页简介」页签 |
| **改招新文案 / 招新流程 / 报名页文案 / 开关报名** | `/admin` → 系统设置 → 「招新与加入我们」页签 |
| **改页脚跑马灯 / 版权行** | `/admin` → 系统设置 → 「页脚」页签（版权行可用 `{year}`） |
| 高峰期把报名接口切到国内 | `/admin` → 系统设置 → 流量通道 |
| 查谁改了什么 | `/admin` → 操作日志 |

> **官网没有任何写死的文案**，全部来自 `site_config` 表里的 `site` 字段。新增可编辑信息时，
> 在 `shared/types.ts` 的 `SiteConfig` + `DEFAULT_SITE_CONFIG` 加字段，
> 再到 `src/admin/SettingsPage.tsx` 加输入框、到对应 section 读取即可（不需要数据库迁移）。
| 本地开发（推荐） | `npm run local` → 打开 <http://127.0.0.1:8787>（前端与 API 同源，与线上一致） |
| 本地开发（热更新） | `npm run dev:api`（后端 8787）+ `npm run dev`（前端 **5175**，自动代理 /api） |
| 本地重置数据库 | 删除 `.wrangler/state` 后重新执行 `npm run db:migrate:local` |
| 端到端自检（内容 / 设置 / 认证） | `pwsh -File scripts/smoke-api.ps1` |
| 端到端自检（招新报名状态机 + 邮件 + 报名表隐私） | `pwsh -File scripts/smoke-applications.ps1` |

> `npm run db:migrate:*` 现在带 `_migrations` 台账：**执行过的文件直接跳过**，重复运行安全。
> 台账是 2026-09-29 才加的，所以第一次在老库上跑要先登记一次（只写台账、不执行任何 SQL）：
>
> ```bash
> node scripts/migrate.mjs local --adopt      # 线上换成 remote
> ```
>
> 登记之后只有**新增**的 `migrations/*.sql` 会被执行。若怀疑某个文件其实没跑过，
> 把台账里对应那行删掉再跑一次即可。⚠️ 反过来也要小心：删掉台账（或换库）后硬跑全量时，
> `0004` 会重建 `projects` 表 —— 重跑会丢 `honor` / `featured` 并重排 id。
>
> `scripts/smoke-api.ps1` 会临时改写站点配置再还原；**中途异常中断时它来不及还原**，
> 跑完请到 `/admin → 系统设置` 看一眼工作室名称是否还是自己的，别把「冒烟测试工作室」留在库里。

---

## 6.5 文件存储（头像 / 轮播图）

- 上传接口 `POST /api/admin/uploads`（需管理员会话），读取接口 `GET /api/files/*`（公开、长缓存）。
- 数据库里存的是**相对地址**，形如 `/api/files/avatars/xxx.png`；换成 R2 自定义域名时只需改
  `worker/lib/uploads.ts` 里的 `FILE_URL_PREFIX` 与 `fileUrl()`，历史数据用一条 SQL 批量替换即可。
- **安全**：只按文件头魔数判断类型（扩展名与浏览器上报的 MIME 都不可信），匿名无法上传；
  文件名带随机后缀，内容不可变，所以用 `immutable` 长缓存 + ETag 协商。
  类型嗅探只读前 16 字节，整份文件以 Blob 直接交给 R2，所以大图不会在内存里被复制两份。
- **自动清理**：编辑记录换图、或删除记录时，会顺手删掉 R2 里的旧文件，不需要手工维护。
- **大小上限按上传子目录区分**，声明在 `shared/resources.ts` 的 `UPLOAD_IMAGE_LIMITS`（后台表单与 Worker 同源）：
  头像 `avatars` 2MB，首页轮播 `slides` 50MB，其余子目录按 2MB。
  真正的「不限大小」在 Cloudflare 上做不到：单请求体上限约 100MB（超出在到达 Worker 前就被平台拒掉），
  Worker 内存也只有 128MB。要调就改这一个映射表，两端的提示文案会自动跟着变。
- **私有文件**：`applications/` 前缀（报名表）含学号、姓名、联系方式，`GET /api/files/*` 对它一律返回 404，
  只有管理员走 `GET /api/admin/applications/:id/file` 才拿得到，且响应是 `no-store`（不进任何缓存）。
  匿名访问会被当作「文件不存在」，不透露这里有东西。判定前缀写在 `worker/lib/uploads.ts` 的 `PRIVATE_KEY_PREFIXES`。
- 官方不提供缩放能力，请在**上传前**自行处理尺寸：头像裁正方形（建议 ≤512×512）。
- **图片版轮播**走的是同一个通道（`scope=slides`，存到 `slides/` 子目录）。首屏是整屏铺满 + 居中裁切，
  请上传**横图**（16:9 或更宽、≥1920×1080），并把关键内容放在画面中间，避免窄屏时被裁掉。

## 6.6 数据模型约定（改代码前看一下）

- 内容表的字段全部由 `shared/resources.ts` 声明，Worker 据此生成 SQL 与校验，后台据此渲染表格与表单。
- **主键有两种做法**：
  - 默认（members / news / slides）：`id` 是应用生成的文本主键，形如 `m-xxx` / `n-xxx`。
  - **projects：`id` 是 SQLite 自增整数**（资源声明里 `autoId: true`）。新增时**不能指定 id**，由数据库分配；
    路由里的 id 会被 `normalizeId()` 转成数字再查库 —— 否则 `WHERE id = '3'` 匹配不到 INTEGER 3，会出现「找不到记录」。
- **projects 没有「状态」和「排序权重」字段**（按需求删除）。前台展示顺序由接口的
  `featured DESC, year DESC, id ASC` 决定，页面再按年份分组。
- 首页「精选项目」取 `featured = true` 的记录（最多 3 个）；一个都没勾选时自动退回最新的 3 个，避免整块空白。
- projects 的 `honor`（所获荣誉）为空时不显示；项目页会在卡片里用高亮块展示，首页精选卡片也会带一行。
- **slides 有两种形态**：`type` 为 `text`（文字版，大标题排版）或 `image`（图片版，`image_url` 铺满首屏、**只显示图片**）。
  文字版才有的字段（`kicker` / `title` / `subtitle` / `cta_text` / `cta_page`）都用 `showWhen: { key: 'type', equals: ['text'] }` 声明，
  后台表单会自动隐藏、Worker 校验也不要求（标题必填用 `requiredWhen` 表达）；
  这套条件显示/条件必填由 `shared/resources.ts` 的 `isFieldActive()` 统一判断，后台与 Worker 共用一份规则。
  图片版没传图时会自动退回文字版展示，避免首屏开天窗。
- 首屏**两种形态共用同一个固定高度**（`HeroCarousel.tsx` 的 `HERO_HEIGHT`：手机 62svh / 桌面首屏整高，最高 840px），
  内容垂直居中、翻页控制器恒定在内容框右下角（图片版多一层深色胶囊底保证可读）。
  **改高度只改这一个常量** —— 两种类型尺寸不一致时，自动轮播会让整页跟着上下跳。
- 字段条件显示/条件必填统一写成 `showWhen` / `requiredWhen`（如成员的「负责方向」按状态显示），
  新增这类二选一字段时不要再在页面里写 `if`。

## 6.7 前台路由（每个板块一个路径）

| 板块 | 路径 | 组件 |
|---|---|---|
| 首页 | `/` | `src/sections/HomeSection.tsx` |
| 新闻动态 | `/news` | `NewsSection.tsx` |
| 新闻详情 | `/news/:id` | 同上（`useParams` 取 id） |
| 项目介绍 | `/projects` | `ProjectsSection.tsx` |
| 团队成员 | `/members` | `MembersSection.tsx` |
| 加入我们 | `/join` | `JoinSection.tsx`（登录 → 上传报名表 → 有记录即展示进度；非招新期显示未到时间/已结束） |
| 邀请函确认 | `/invite/:token` | `InviteSection.tsx`（从邮件链接进入，凭 token 不要求登录） |
| 扫码签到 | `/checkin/:stage` | `CheckinSection.tsx`（`written` / `interview` / `defense`，填姓名 + 学号） |
| 后台 | `/admin/*` | `src/admin/AdminApp.tsx`（招新模块在 `/admin/recruit/*`，一个侧栏入口 + 内部页签） |
| 其它任意路径 | — | `App.tsx` 里的 `NotFound`（404 文案 + 回首页按钮） |

- **路径只声明一次**：`shared/types.ts` 的 `PAGE_PATHS`（`PageKey` → 路径）与 `PAGE_LABELS`。
  顶部导航、页脚快捷入口、首页按钮、轮播按钮全部引自它；轮播的 `ctaPage` 存的是 `PageKey`，靠这张表翻译成路径。
- **新增一个板块**改四处：`PageKey` 加一项 → `PAGE_LABELS` / `PAGE_PATHS` 各加一项 →
  `App.tsx` 的 `<Routes>` 加一条 → 在 `Header.tsx` 的 `NAV_ORDER` 里决定它排在导航第几位
  （`PAGE_KEYS` 的声明顺序是数据契约顺序，**不决定**导航顺序）。
- 深层路径可以直接访问与分享：`wrangler.toml` 的 `not_found_handling = "single-page-application"`
  会把未知路径回落到 `index.html`，再由前端路由渲染对应板块。
  `vite.config.ts` 的 `base` 必须是 `'/'`——用相对路径时 `/news/xxx` 这类深层路径会把静态资源解析错而 404。
- 板块切换会自动滚回顶部；标签页标题首页只用工作室名称，其它板块是「板块名 · 工作室名称」。
- 自检：`scripts/probe-local.ps1` 会逐个请求上面的路径，确认都返回同一个 SPA 外壳
  （200 + `id="root"` + 绝对资源路径）。

## 6.8 邮件通知（SMTP）

后台「系统设置 → 邮件通知」维护，存在 D1 `site_config['runtime'].mail`（与流量通道同一份 runtime，
改配置**不需要数据库迁移**）。

| 配置项 | 说明 |
|---|---|
| 启用开关 | 关闭时全站不发送任何邮件 |
| SMTP 服务器 / 登录用户名 | 用户名留空表示不认证；多数服务商等于发件邮箱 |
| 连接方式 | **只有 465（SSL/TLS）与 587（STARTTLS）两种**：Workers 出站被封锁 25 端口，且不允许连 localhost / 私有网段（本地开发除外） |
| 发件邮箱 / 显示名 / 回信地址 | 发件邮箱必须落在服务商允许的发信白名单里 |

- **密码就存在数据库里**：后台「SMTP 密码 / 授权码」直接填，落库前用 `SESSION_SECRET` 派生的密钥做
  AES-GCM 加密（存成 `enc$…` 密文）。**任何接口都不会回显它**，后台只显示「已配置 / 未配置、来自哪里」。
  表单是三态：**留空 = 不修改；填内容 = 更新；点「清除已保存的密码」再保存 = 删掉**。
  也支持 `npx wrangler secret put SMTP_PASSWORD`（本地写 `.dev.vars`）作为兜底 —— 数据库里有值就优先用数据库的。
- ⚠️ 加密密钥来自 `SESSION_SECRET`：**换掉它会让已保存的 SMTP 密码解不开**（此时自动回退到 `SMTP_PASSWORD`，
  并需要到后台重新填一次）。
- 实现分两层：`worker/lib/smtp.ts`（`cloudflare:sockets` 的 `connect()`，逐条校验 SMTP 响应码，STARTTLS 用 `startTls()` 升级后重建读写器）
  与 `worker/lib/mailer.ts`（MIME 组装：主题按 RFC 2047 编码、正文 Base64、纯文本 + HTML 走 `multipart/alternative`）。
- **STARTTLS 协商失败不会静默降级成明文**，会直接报 `TLS_FAILED`，提示改用 465。
- 自检：后台「邮件通知 → 发送测试邮件」，或 `POST /api/admin/mail/test`（需管理员；`to` 留空用站点联系邮箱）。
  失败错误码：`NOT_CONFIGURED`（配置没填齐，400）；`CONNECT_FAILED` / `TLS_FAILED` / `AUTH_FAILED` / `REJECTED` / `TIMEOUT`（502）。
- 已知边界：发信源 IP 不在 Cloudflare 公布的 IP 段内，个别服务商要求报备；能否进对方收件箱、退信处理都在对方侧，
  本站只能确认「对方服务器已 250 收下」。
- 本地想验证又不想真发信：起一个假服务器 `python -m smtpd -n -c DebuggingServer 127.0.0.1:2525`，
  后台填 `127.0.0.1` + `2525` + 不加密即可（**仅本地开发可行**）。
- **谁在用这套邮件**：招新报名的通知信件（见 §6.9）。邮件发送失败**不会**阻断状态流转，
  后台会在操作后弹出该封信的结果与错误码，修好配置后点「重发」即可。

## 6.9 招新系统（事件驱动：状态机 · 动作 · 邮件 · 签到）

> **三条总原则**
> ① 整届**没有任何时间字段**，「场次」概念也不存在；
> ② 阶段的每一次开与关，都是管理员在后台点了一下按钮；
> ③ 考试的时间与地点通过对应的 QQ 群通知，邮件与系统里都不出现。

### 〇、边界：什么进「设置」，什么留在「流程」

判据只有一句：**下一届还要不要重新填一次？**

| 要重新填 → 属于**本届** → 留在「流程」 | 跨届通用 → 进「设置」 |
|---|---|
| 本届名称、四个 QQ 群号（流程页「本届信息」面板 / 点时间线「备招」节点，**任何状态都能改**） | 八封邮件模板（写给所有届用的通用文案，靠变量逐人渲染） |
| 阶段推进、名单操作、成绩与评语、签到二维码 | 官网「招新与加入我们」文案（首页横幅 + 加入我们页） |

- 所以休眠大屏上的「设置」打开的是**通用设置**（模板 + 官网文案，休眠期就能先备好）；
  本届名称与群号属于流程，点「启动系统」之后再填 —— 休眠期还没有本届，也无从填起。
- 四个群号是「本届」的值，模板只是**引用**它们（`{writtenGroup}` 等）：改在流程页，设置在预览里只读。
- 后端只有两个写口：`PUT /api/admin/recruit`（名称 / 群号 / 模板，**不接受 `state`**）
  与 `POST /api/admin/recruit/actions`（推进状态）。边界是界面层的约定，两边共用这两个口。

### 一、状态是「阶段 + 结果」两个属性

不再用一列枚举描述报名状态，而是两个字段（**唯一事实源 `shared/recruit.ts`**）：

| 列 | 取值 |
|---|---|
| `stage` 阶段 | `apply` 报名 · `written` 笔试 · `interview` 面试 · `defense` 答辩(预备期) · `onboard` 转正 |
| `result` 该阶段结果 | `''` 待定 · `attended` 已参加 · `passed` 通过 · `failed` 未通过 · `absent` 未参加 · `declined` 婉拒 · `withdrawn` 退出 |

- **「是否已安排笔试/面试」不是个人状态**，而是**整届状态**（见下），所以 `written + ''` 就表示「在等笔试」。
- 中文标签由 `applicationLabel(stage, result)` 派生，**不入库**，后台筛选按钮与前台进度页共用同一份。
- 阶段只能**相邻推进或退回一步**（`canMoveStage`），避免「跳过面试直接答辩」这类脏数据。
- 成绩、评语、管理员备注属于内部数据，`toStudentView()` 会把它们抹掉再下发学生端。

### 二、整届状态机：11 个状态、11 个动作，全由人点

`RecruitCycleConfig` 现在只有四项：`name`、`state`、`groups`（四个 QQ 群号）、`startedAt`，
存 D1 `site_config['recruit']`（JSON，**新增字段不需要迁移**；读取时逐字段取值，库里遗留的旧键会被丢掉）。

| 状态 | 含义 |
|---|---|
| `dormant` | 休眠：没有进行中的周期（官网报名入口关闭） |
| `prepare` | 备招：周期已建，报名未开 |
| `apply` / `apply_review` | 报名进行中 / 报名已结束，待确认笔试名单 |
| `written` / `written_review` | 笔试进行中 / 笔试已结束，待录成绩、定面试名单 |
| `interview` / `interview_review` | 面试进行中 / 已结束，待评语与录取 |
| `defense` / `defense_review` | 答辩进行中 / 已结束，待成绩与最终名单 |
| `onboard` | 已发邀请函，等本人确认 |

`RECRUIT_ACTION_META` **一张表说清全部动作**：`from`（哪些状态能执行）、`to`（执行后到哪）、
`needsSelection`（是否必须勾选名单）、`label` 与 `description`（后台按钮文案）。
后端校验（`actionBlockedReason`）与后台按钮的可见性读的是同一份，**不可能出现「界面能点但后端拒绝」**。

- 报名通道 = `state === 'apply'`（`isApplyOpen`）；前台门禁分三态（`applyGate`）：
  `dormant` / `prepare` → 未开始，`apply` → 开放，其余 → 已截止。
- 首页横幅与顶部提示的显隐由 `/api/public/bootstrap` 顺带返回的 `recruit` 派生（`isRecruitVisible`）。
- `PUT /api/admin/recruit` **不接受 `state`** —— 否则「在设置页点一下保存」就能把流程跳到别的阶段。
- **全站没有 Cron**：既没有「到点自动开」也没有「到点自动关」（`wrangler.toml` 的 `[triggers]` 已删）。

### 三之二、材料审核（报名阶段逐个「通过 / 驳回」）

报名阶段管理员要在网页上判断每一份材料是否合格 —— 合格就通过，不合格就驳回并要求同学改。

- **通过**：之后才能把他勾进笔试名单。
- **驳回**：**必须写理由**，系统立刻发出「材料驳回通知」邮件（正文带 `{rejectReason}`），
  同学回官网「加入我们」按理由改好、重新上传。
- 三种状态：`待审核`（默认）/ `材料已通过` / `材料已驳回`
  （`applications.material_status` / `material_reason` / `material_reviewed_at`，见迁移 `0010`）。
- **同学重传材料后审核状态自动回到「待审核」** —— 否则「改好了却还是被驳回」，
  而理由指向的那一版材料早就不在了。后台替换材料（`POST .../:id/file`）同理。
- **只有 `apply` / `apply_review` 两个状态能审**：笔试都开考了再来改审核状态只会让人困惑，
  其余状态返回 409 `STAGE_NOT_APPLICABLE`。
- **未通过审核的人不能被勾选进笔试**：`confirm_written` 会整体拒绝并报出是哪几个人
  （`MATERIAL_NOT_APPROVED`）—— 没有这道闸，审核就只是装饰。
  这道闸**只作用于「报名 → 笔试」**：材料审核是报名阶段的事，过了笔试再拿它卡人没有意义
  （现场补录到笔试的人更不该因为「没有报名材料」被拦在面试之外）。

后台入口：**名单** 页（报名阶段）筛选条多一行「材料审核」；每行有「通过 / 驳回」；
批量条有「通过材料 / 驳回材料…」（驳回会逐人发信）；单人详情弹窗顶部有完整审核区
（含理由输入、已驳回理由回显、「退回待审核」）。报名页与「确认笔试名单」页顶部另有一条
「待审核 N / 已通过 N / 已驳回 N」的进度条。

接口：`PUT /api/admin/applications/:id`（`{ material, materialReason }`，空串 = 退回待审核）与
`POST /api/admin/applications/bulk`（`action = approve_material | reject_material`）。
邮件模板多了第 8 条「材料驳回通知」，可在「设置 → 邮件模板」里改文案或停用。

### 三、动作：动一批人 + 发一批信 + 换一个状态

| 动作 | 做什么 | 需要勾选 |
|---|---|---|
| `start_cycle` | 休眠 → 备招（创建新周期） | 否 |
| `open_apply` / `end_apply` | 开 / 关报名入口（关的时候不发信，名单仍可调整） | 否 |
| `reset_apply` | **强制结束报名并清空数据**：删记录 + 删报名表文件 + 退回备招（见第五之二节） | 否 |
| `confirm_written` | 勾选的人 → 笔试 + **笔试邀请函**；未勾选 → `failed`，**不发信** | **是** |
| `end_written` | 未签到的人自动标 `absent`（**不发信**），解锁成绩与面试名单 | 否 |
| `advance_written` | 勾选 → 面试 + **面试邀请函**；其余 → `failed` + **感谢信·笔试** | **是** |
| `end_interview` | 未签到自动标缺考 | 否 |
| `advance_interview` | 勾选 → 预备期 + **面试通过通知**；其余 → `failed` + **感谢信·面试** | **是** |
| `end_defense` | 未签到自动标缺考 | 否 |
| `advance_defense` | 勾选 → 转正 + **正式邀请函**（一次性确认链接）；其余 → `failed` + **感谢信·答辩** | **是** |
| `close_cycle` | 导出存档 → 清库 → 回休眠（见第五节） | 否 |

- 实现只有一处：`worker/lib/recruit-cycle.ts` 的 `runRecruitAction()`；接口 `POST /api/admin/recruit/actions`。
- **邮件不阻断流转**：发信失败照常推进，失败原因如实返回（`mail.summary`），可在名单里对单人重发。
- **缺考与未通过初筛一律不发信**：本人只会收到「你能进下一轮」或感谢信，不会收到「你没来」这类打扰。
- 批量勾选：后台提供「勾选不低于该分数的同学」，其余靠人工勾 —— 晋级规则不藏在配置里替人做决定。
- 每一步执行完，响应里带 `next`（接下来该点哪个按钮），后台直接提示。

### 四、没有定时任务

整届的开与关完全由人决定，所以 `worker/index.ts` 里**没有 `scheduled`**，
`wrangler.toml` 也没有 `[triggers] crons`。缺考在「结束笔试 / 面试 / 答辩」这个动作里一次性标完，
不需要定时扫；「关闭本届」也由管理员点，不存在到点自动关闭。

### 五、关闭本届 = 先归档，再清空，回到休眠

1. 仍未确认邀请的人记为 `absent`（让存档如实反映结局）；
2. 导出全部报名记录为 CSV（含联系方式、成绩、各阶段结果），存进对象存储的 `applications/archives/`；
3. **对象存储没接通（或写入失败）就拒绝关闭** —— 绝不把数据清了却拿不出存档；
4. 删除报名表文件、清空 `applications` 与 `application_mails`、清空签到凭证；
5. `state` 置回 `dormant`，页面拿到存档地址；**下载即收尾**，下完自动回到休眠大屏。

### 五之二、清空报名 = 丢掉这批表，回到备招重新收

**场景**：报名被刷屏，或本届配置搞错了（名称 / 群号写错、模板先发错了）——
已经收上来的那批表全是脏数据。与其在名单里一条条删、还要逐个去清孤儿文件，不如一键回到起点。

`reset_apply`（后台文案「**强制结束报名并清空数据**」，只在 `apply` / `apply_review` 两个状态可用）：

1. 删除本届**全部**报名记录，以及对象存储里这些人的**报名表文件**
   —— 先删文件再清库：库一清就再也找不回 `fileUrl`，桶里会留下无人认领的孤儿对象；
2. 连这些人的**发信日志**一起清掉（`clearRecruitData`）；
3. `state` 回到 **`prepare`（备招）**，本届的名称与群号保留，可以立刻重新「开启报名」收一批干净的表。

与「关闭本届」的三点区别（都是刻意的）：

| | 关闭本届 `close_cycle` | 清空报名 `reset_apply` |
|---|---|---|
| 存档 | **必须先导出 CSV**，存储没接通就拒绝关闭 | **不导出** —— 要丢的就是这批数据 |
| 存储不可用时 | 拒绝执行（怕清了库却拿不出存档） | 照常清库，把「几个文件没删掉」如实回报 |
| 结束状态 | 休眠 `dormant`（整届结束） | 备招 `prepare`（本届还在，可重开报名） |

后台的二次确认会把「将删除 N 条记录 + M 个文件」写在脸上；执行后的 toast 也如实报数
（含没删掉的文件数，并提示去「对象存储」页处理）。归档 CSV 在同一个 `applications/` 前缀下，
**不会被误删**（删文件时跳过 `RECRUIT_ARCHIVE_SCOPE`）。

> 周期里不再保存往届存档列表（`archives` 字段已删）：存档就是那份 CSV，要翻旧账去 `applications/archives/`。

### 六、扫码签到（只绑阶段 + 凭证）

- 笔试 / 面试 / 答辩**各一张码**：`/checkin/<token>`，token 只绑 `stage`，带自选有效期、可一键作废；
  **重新签发会让该阶段旧码立即作废**（同一阶段至多一张有效码 —— 二维码会被拍照转发）。
  二维码由前端 `qrcode.react` 渲染，可直接截图打印或投屏。
- 签到页**没有裸入口**：不进导航；token 无效 / 过期 / 被作废时后端不返回任何信息。
- 同学填「姓名 + 学号」，与报名记录一致即签到成功；签到会把人推进到该阶段、结果记为 `attended`。
  即使后台还没执行「确认笔试名单」，到场的人也能签到（`checkinEligibility` 的 `ahead` 分支）。
- 已经走到后面阶段的会拒绝（提示看自己的进度），流程已结束的也会拒绝。
- 后台可以勾选同学**批量补签**（补签会**撤销缺考**：人确实来过就不该被刷掉），也可以在单人详情里勾选 / 取消。
- 没报名但来考的人有两种补录：**报名阶段**（不要求报名表、联系方式可后补）与
  **笔试现场**（邮箱 / 手机 / QQ 必填，**报名表可后补**，录入即视为已参加，不会被缺考扫描误伤）。

### 六之二、「改全部资料」——补录的后半程

**为什么必须有**：现场补录时经常真拿不到全部信息（材料没带、QQ 回头发）。
如果录入那一刻拿不到就再也补不上，名单里那份材料会永远缺着 —— 所以补录只是前半程。

- 入口：**名单 → 某个人的「详情 · 改资料」**。
- 能改**全部**字段：姓名、学号、邮箱、手机、QQ（学号与别人重复时后端返回 409 `ALREADY_EXISTS`）。
- **报名表可后补 / 可替换**（`POST /api/admin/applications/:id/file`）：与官网报名**同一套校验**
  （大小 ≤20MB、后缀、文件头魔数），成功后**删掉旧文件**，下载名始终是「姓名+学号+报名表」；
  改了姓名 / 学号时下载名也会跟着重算。
- 联系方式只校验**格式**、不强制必填 —— 信息可以后补，这是刻意的（老版要求必填，才导致「拿不到就补不了」）。
- 官网自助报名的人同样能改（更正信息不该由发现渠道决定）。

### 七、邮件模板中心

5 类共 8 条模板，主题与正文都在后台「招新 → 设置 → 邮件模板」里改。
变量清单（页面左侧，写错的变量由后端算好并当场标出）**只有四个群号 + 姓名学号 + 邀请链接 + 工作室信息**：

`{name}` `{studentId}` `{cycleName}` `{writtenGroup}` `{interviewGroup}` `{probationGroup}` `{formalGroup}`
`{inviteLink}` `{studio}` `{contactEmail}` `{contactAddress}`

- **没有任何时间与地点变量** —— 安排一律让同学看对应的 QQ 群，正文里写的是「见 XX 通知群」。
- 本届名称与四个群号**没配置时不做替换**，原样保留 `{writtenGroup}`（`RECRUIT_CYCLE_VARIABLES`）：
  休眠期就能进「设置」先配好；真没配时，邀请函与预览都会如实显示「这里还没配」，
  而不是悄悄少掉最关键的那一行。
- 「设置」的**变量清单会显示每个变量此刻的值**：本届的（名称、四个群号）**只读**当前值 ——
  一旦进入招新周期、群号填上，这里就能看到值、预览也就正常渲染了；
  休眠期还没有本届，于是显示「还没配置」。要改这些值请去「流程 → 本届信息」。
- 其余变量（`{studio}` / `{contactEmail}` / `{inviteLink}` 等）没值才替换成空串 ——
  它们不是「没启用招新」，而是站点本来就没填。
- 每条模板可单独**停用**：停用后状态照常流转，只是不发这封信（日志里也不会出现）。

### 八、接口一览

| 谁 | 方法与路径 | 说明 |
|---|---|---|
| 公开 | `GET /api/public/recruit` | 整届状态与门禁（`state` / `gate` / `applyOpen` / 文案） |
| 学生 | `POST /api/applications` | multipart 上传报名表（PDF/DOCX ≤20MB，按文件头魔数校验），需教务网会话 |
| 学生 | `GET /api/applications/me` | 自己的进度 + 此刻该进的 QQ 群（不含时间地点） |
| 公开 | `GET/POST /api/applications/checkin/:token` | 签到页信息与提交（token 只绑阶段 + 带失效时间，无裸入口） |
| 管理员 | `GET/PUT /api/admin/recruit` | 整届设置（名称 / 四个群号 / 模板）；**不接受 state** |
| 管理员 | `POST /api/admin/recruit/actions` | **推进整届的全部动作**（状态机，见第三节） |
| 管理员 | `GET /api/admin/recruit/stats` | 顶部摘要：漏斗 + 状态细分 + 总人数 |
| 管理员 | `GET/POST /api/admin/recruit/checkin-codes` · `POST .../revoke` | 三个阶段各自的签到二维码：查看 / 签发（旧码自动作废）/ 作废 |
| 管理员 | `POST /api/admin/applications` | 补录（JSON 或 multipart；`stage=written` 即笔试现场补录，报名表可后补） |
| 管理员 | `POST /api/admin/applications/:id/file` | **后补 / 替换报名表**（同官网一套校验，成功后删旧文件） |
| 公开 | `GET/POST /api/applications/invite/:token` | 邀请函（凭证即密权，不要求登录） |
| 管理员 | `GET /api/admin/recruit/export` · `/mails` | 名单导出 CSV、发信日志 |
| 管理员 | `GET /api/admin/applications` | 列表（`stage=` / `result=` 多选、`q=` 搜姓名/学号/邮箱/手机/QQ） |
| 管理员 | `PUT /api/admin/applications/:id` | 单人改状态 / 记成绩 / 勾签到 / 补发某封信 |
| 管理员 | `POST /api/admin/applications/bulk` | 批量：补签、标记未参加、退出报名 |
| 管理员 | `POST /api/admin/applications/notify` | 群发一封自定义通知（勾选一批人） |
| 管理员 | `GET /api/admin/applications/:id/file` | 下载报名表（**唯一**能取到 `applications/` 内容的入口） |
| 管理员 | `DELETE /api/admin/applications/:id` | 删除记录并清理存储桶里的报名表 |

### 九、数据与文件

- 表：`applications` + `application_mails`（`migrations/0007_recruit_stages.sql`）。
  **一位同学一条记录**，`student_id` 唯一；发信日志与报名数据同生命周期，关闭时一起清空。
- 身份（学号 / 姓名）**取自教务网会话，不接受前端传入**，所以没人能替别人报名。
- 报名表与存档都落在对象存储的 `applications/` 前缀下（桶与密钥在后台「对象存储」页配置，
  两个业务目标 `site` / `applications` 可以指向不同的桶），
  `GET /api/files/*` 对该前缀一律 404 —— 匿名与学生本人都拿不到，
  只有 `GET /api/admin/applications/:id/file` 带管理员会话能下载（还带原始文件名）。

> 自检：`pwsh -File scripts/smoke-applications.ps1` 会完整走一遍
> 「配周期 → 报名 → 确认笔试名单 → 签到 → 缺考标记 → 成绩晋级 → 面试录取 → 答辩转正 →
> 邀请函确认 → 导出 → 关闭归档 → 强制清空报名 → 重新开启报名」，共 **109 项**断言，
> 并会在结束时复原原有的名称、群号与模板。

## 6.10 成员「方向 / 角色」字典

后台「**方向与身份**」页（`/admin/roles`）维护，决定两件事：成员卡片的角色标签、
邀请函转正时学生能选什么方向。它与招新周期无关 —— 招新一届一届地重来，方向是跨届通用的。

**存中文名，不存 id（这是刻意的）**。配套语义是：

> 改名单只影响之后新增的记录；已经写进 `members.title` 的历史值**原样保留、不回写**。

所以把「算法工程师」改成「算法与 AI」之后，老成员的卡片仍然显示「算法工程师」——
避免一次改名把历届记录的称谓都改掉（老照片、新闻稿里写的还是当年那个词）。
由此还顺带得到两个好处：删除 / 改名一个方向**永远安全**（历史数据自带显示文案，
不依赖字典里还有没有它），以及**不需要任何数据迁移**（`members.title` 自 `0001` 起就是 TEXT）。
代价是做不到「一键把历史上的旧叫法统一改成新叫法」，真需要时就是一条显式的
`UPDATE members SET title = ...` —— 属于有意为之的例外，不是默认行为。
完整设计原委写在 `shared/identity.ts` 的文件头注释里。

**边界（这个模块最初的起因）**：`kind !== 'student'` 的方向（指导老师、管理岗）
**不会被学生自助选择** —— 邀请函下发的只有 `selectableBySelf` 的学生方向
（`selfSelectableLabels()`），后端 `confirmInvite` 还会**独立再校验一次**，
即使有人绕过页面直接调接口，也不可能把自己写成「指导老师」。
后端还会把非学生方向的 `selectableBySelf` 强制纠正为 `false`（不变量，不是偏好）。

**存储**：KV（key `member_roles`）+ D1 `site_config['memberRoles']` 各一份。
读优先 KV；写入 D1 后**删掉 KV 缓存**（与 runtime 配置同一套失效策略，见
`worker/lib/identity-config.ts`）。没绑 `CONFIG_KV` 时自动走 D1，功能完全一致。
选 KV 是因为这份数据「读多写极少、后台一改要立刻生效」；留一份 D1 是因为
「KV 只是缓存层，删了也不该丢数据」。⚠️ KV 是最终一致的，改动最多约 60 秒全网可见。

**接口**：`GET|PUT /api/admin/member-roles`，**整份覆盖**保存 —— 存储形态是一个 JSON 数组，
逐条接口会引入「改到一半」的半写状态，换不来任何好处。`PUT` 移除「还有成员在用」的方向时，
会先返回 409 `ROLE_IN_USE` 要求确认（再带 `confirmRemoval: true` 重发才落库）；
**「停用」不算移除**，它留在字典里、随时能启用回来，所以不需要确认。
`GET` 会顺带返回每个方向的使用人数，界面上直接显示（这也是「为什么说不会影响历史数据」的凭据）。

**代码位置**：契约与纯函数 `shared/identity.ts`；存储 `worker/lib/identity-config.ts`；
接口 `worker/routes/admin-roles.ts`；后台页面 `src/admin/MemberRolesPage.tsx`。
内容管理里的「角色」下拉走 `shared/resources.ts` 的 `optionsSource: 'memberRoles'` ——
`resources.ts` 里的 `options` 只是**兜底**，真实的合法取值由调用方注入
（`validateEntity(def, input, ctx)` 的 `ctx.memberRoles`）。编辑已有记录时要把
**它原来的取值**一并并进白名单，否则方向改名后，管理员连电话都改不了。

---

## 7. 故障恢复

### 后台密码忘了
用 `RECOVERY_TOKEN` 重置（不会清空数据）：

```bash
curl -X POST https://<你的域名>/api/admin/bootstrap \
  -H 'content-type: application/json' \
  -d '{"token":"<RECOVERY_TOKEN>","username":"admin","password":"<新密码>"}'
```

### `RECOVERY_TOKEN` 也忘了
无法从外部重置（这是故意的安全设计）。需要：

1. 在 Cloudflare 控制台重新设置该密钥：`npx wrangler secret put RECOVERY_TOKEN`
2. 再执行上面的重置请求

### 想换管理员账号名
直接用 `bootstrap` 接口以新用户名 + 新密码调用一次即可新增账号（旧账号仍在，可在 D1 控制台删除）。

### 数据被误删
D1 支持时间点恢复（Time Travel）：

```bash
npx wrangler d1 time-travel info kingcola-db
npx wrangler d1 time-travel restore kingcola-db --timestamp=<时间戳>
```

> 建议招新期间每周手动导出一份：D1 控制台 → 选中数据库 → Export。

---

## 8. 教务网登录（单点登录）

### 现在的状态
已按 OAuth 2.0 授权码模式接通。**官网不接触教务网**，登录是一次跨站跳转，
回调时由 Worker 用授权码换回身份、验签后种下自己的报名会话：

```
GET  /api/auth/login     → 302 到授权服务器（同时种下 state Cookie）
GET  /api/auth/callback  → 校验 state → 授权码换身份 → 验签 → 种报名会话 → 回首页
GET  /api/auth/me        → 前端查询当前登录态
POST /api/auth/logout    → 退出登录
```

授权服务器部署在国内 EdgeOne，四个端点（`start` / `poll` / `approve` / `token`）
由另一个仓库维护，部署与密钥说明见其 `DEPLOY.md`。契约文件：`shared/sso.ts`
（**改动需前后端 + 授权服务器三方同步**）。

回调失败一律 302 回首页并带 `?login=<原因>`，前端翻译成人话提示；
不把错误码留在地址栏，也不甩 JSON 错误页给用户。

### 两套会话，互不影响

|  | 管理员 | 报名学生 |
|---|---|---|
| Cookie | `kc_admin` | `kc_student` |
| 签名密钥 | `SESSION_SECRET` | `STUDENT_SESSION_SECRET` |
| 有效期 | 12 小时 | 30 天（覆盖整个招新周期） |
| 读取 | `worker/lib/auth.ts` | `worker/lib/student-auth.ts` |
| 登出 | `POST /api/admin/logout` | `POST /api/auth/logout` |
| 失效条件 | 关联密码版本，改密码即踢 | 仅签名与有效期 |

两侧换密钥、登出、会话失效都只影响自己。报名会话不查库，因此授权服务器暂时不可用时，
已登录的同学依然能正常提交报名。

### 接入需要做的三件事
1. **后台「系统设置 → 流量通道 → 教务网登录」**：打开开关，填授权服务器地址、回调地址、客户端密钥，保存即生效。
   - 三项（**含客户端密钥**）都存在 D1 的 `site_config['runtime'].sso`，**不需要改环境变量、不需要重新部署**。
     客户端密钥落库前加密成 `enc$…`，所有下发接口都剥掉它 —— 后台也只看得到「有没有配、配在哪」。
   - 开关 + 地址缺一即视为「未接通」：官网不展示登录入口，「加入我们」页显示「暂未开放」。
   - 关闭开关只是收起入口，**已登录的同学保持登录态**。
   - 判定规则两端共用 `isSsoReady()`（`shared/runtime.ts`），避免后台与官网不一致。
   - `wrangler.toml` / `.dev.vars` 里的 `SSO_AUTHORIZE_BASE`、`SSO_REDIRECT_URI`、`SSO_CLIENT_SECRET`
     都只是可选的部署引导值（老部署平滑过渡），后台保存过即以后台为准。
2. `QR_SIGN_SECRET`（主站）必须与授权服务的 `APPLY_TOKEN_SECRET` 一致 —— **这个只在环境变量里**，
   仍用 `npx wrangler secret put` 写入，后台看不到也改不了。不一致的直接表现是「回调换身份失败」。
3. 把主站回调地址登记进授权服务器的客户端白名单 `SSO_CLIENTS`，
   必须**完整精确匹配**（含协议、域名、路径）；后台填的回调地址就是拿去做这件事的，
   留空时才按当前访问域名推导（线上建议显式固定，避免自定义域名与预览域名不一致）。

### 授权服务器访问教务网的链路
学校教务网（`https://kdjw.hnust.edu.cn`）的四步链路，**必须共用同一个 Cookie 会话**：

1. `GET /Logon.do?method=QrCodeCreate&uuid={U}` → 二维码图片 + `Set-Cookie(bzb_njw, SERVERID)`
2. `GET /Logon.do?method=checksfhd&sid={U}&_={ts}` → `no` 未扫 / 其他值表示已扫或已确认
3. `GET /Logon.do?method=logon_kd&type=wx&sid={U}` → **必须禁止自动跟跳**，手动逐跳取 Cookie
4. `GET /jsxsd/grsz/grsz_xggrxx.do` → 正则取 `name="account"`（学号）与 `name="realName"`（姓名）

参考实现见另一个仓库 `schedule-system-v2` 的 `backend/internal/service/qr_login.go`。

### 为什么必须放在国内 EdgeOne
教务网仅国内可达，Cloudflare 海外节点访问会被风控或直接超时。

### 已实测的平台能力
**EdgeOne 边缘函数能读到教务网响应的 `Set-Cookie`**，出网请求与二维码获取均成功。
注意 `fetch` 在 `redirect: 'follow'` 时不会记录中转的 `Set-Cookie`，
因此链路实现里用 `redirect: 'manual'` 手动跟跳。

### 合规提醒
该模块本质上是代理学生登录学校教务系统。上线前请确认已获得指导老师 / 教务部门许可，
并且**只提取学号与姓名**，绝不落库 Cookie 与密码。

---

## 9. 待办与已知限制

| 项 | 状态 |
|---|---|
| 招新系统（事件驱动状态机 / 动作 / 邮件 / 签到 / 名单 / 导出） | **已实现**，见 §6.9；自检 `scripts/smoke-applications.ps1` 109 项全绿 |
| 成员「方向 / 角色」字典 | **已实现**，见 §6.10：后台 `/admin/roles` 可增删改 / 停用；「指导老师」这类身份不对学生开放 |
| 报名表替换 / 手动补录 | **已实现**：确认笔试名单前可替换（先确认、成功后删旧文件、文件统一重命名「姓名+学号+报名表」）；报名阶段页可补录未报名考生 |
| 邮件通知（SMTP） | **已实现**并已接入业务：`worker/lib/smtp.ts` + `mailer.ts`，后台「系统设置 → 邮件通知」可配可测（§6.8）；招新的 8 条通知模板都走它（§6.9） |
| 扫码签到 | **已实现**：二维码 = 带凭证的签到链接（只绑阶段 + 失效时间 + 可作废，重发自动废旧码），前端 `qrcode.react` 渲染（§6.9 第六节） |
| 招新 Cron 定时任务 | **刻意没有**：整届开与关全靠管理员点按钮，缺考在「结束考试」动作里标完（§6.9 第四节） |
| 多届并存 / 历史届在线查阅 | 未实现：只有**当前届**在线，关闭时导出 CSV 存档（后台可下载），数据表清空 |
| 扫码真实实现（EdgeOne） | 待 POC 验证后部署 |
| 报名限流 / Turnstile 人机校验 | 未实现（报名提交目前只有教务网会话校验，没有频率限制与验证码） |
| 管理员多人协作 | 表结构已支持（`admin_users`），后台暂无「加人」界面 |
| 面试分时段排期 / 面试官分配 | 未实现：系统的立场是「安排一律在 QQ 群里说」，所以不存任何时间地点，也就不排期 |
| D1 自动备份（Cron） | 未实现（招新数据在关闭时会归档，其余数据靠 D1 Time Travel，见 §7） |
| 新闻配图 / 项目封面 | 未实现（字段与上传通道已具备，加一个 `image` 字段即可，见 `shared/resources.ts`） |
| 对象存储孤儿文件定期清理 | 未实现（替换/删除记录时会即时清理，异常中断时可能残留） |
