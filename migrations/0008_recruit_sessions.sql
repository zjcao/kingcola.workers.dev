-- ============================================================================
-- 0008 · 考试场次 + 签到二维码凭证
--
-- 背景：周期配置里原来只有单个 writtenAt / interviewAt（「笔试时间」就一个），
-- 无法表达「同一轮笔试分好几个场次，同学现场任选一场」。现在把场次拆成独立表：
--
--   recruit_sessions        一个阶段（笔试/面试/答辩）可以有多个场次，一场一条
--   recruit_checkin_tokens  签到二维码的凭证：绑场次 + 带过期 + 可作废、可多发
--
-- 为什么场次用表而不是塞进 site_config 的 JSON：
--   1. 签到凭证要引用场次（session_id），需要稳定的主键；
--   2. 后台按场次统计「这场来了多少人」要能走索引；
--   3. JSON 数组的增删改要整段覆盖，两个人同时编辑会互相冲掉。
--
-- 签到流程（开放参加制）：
--   后台在「笔试/面试/答辩」阶段页生成二维码（= 一个带 token 的签到链接，含失效时间），
--   打印张贴或投屏；同学扫码 → /checkin/<token> → 填姓名 + 学号 → 记到该 token 绑定的场次上。
--   同一场次可以重复生成二维码，旧的作废即可（revoked_at 非空 = 已作废）。
--
-- applications 新增三列记录「签的是哪一场」，以及 source 区分报名来源
-- （web = 同学自己在官网提交；manual = 未报名但现场来考，管理员手工补录）。
--
-- 应用方式（**有数据的库不要整体跑 migrate**，只执行本文件）：
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local \
--     --file=migrations/0008_recruit_sessions.sql
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 考试场次
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recruit_sessions (
  id          TEXT PRIMARY KEY,
  -- 属于哪个阶段：written | interview | defense（与 shared/recruit.ts 的 CheckinStage 一致）
  stage       TEXT NOT NULL DEFAULT '',
  -- 场次名，如「第一场」「上午场」；留空时前端按顺序显示「第 N 场」
  name        TEXT NOT NULL DEFAULT '',
  -- 起止时间，北京时间字符串 YYYY-MM-DDTHH:mm（与周期配置同一套约定）
  starts_at   TEXT NOT NULL DEFAULT '',
  ends_at     TEXT NOT NULL DEFAULT '',
  -- 地点 / 形式
  place       TEXT NOT NULL DEFAULT '',
  -- 备注（写进邀请函，如「请自带电脑」）
  note        TEXT NOT NULL DEFAULT '',
  -- 展示与邀请函里的排序
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT '',
  updated_at  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_recruit_sessions_stage ON recruit_sessions(stage, sort_order);

-- ---------------------------------------------------------------------------
-- 签到二维码凭证
--
-- token 即密权：拿到它就能给某个场次签到，所以只出现在后台生成二维码时，
-- 不进任何公开接口的返回值（学生端只用不查）。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS recruit_checkin_tokens (
  token       TEXT PRIMARY KEY,
  -- 签到落在哪个场次（recruit_sessions.id）；场次删除时对应的码一并失效
  session_id  TEXT NOT NULL DEFAULT '',
  -- 冗余阶段，签到页不必先查场次就能渲染「笔试签到」这类文案
  stage       TEXT NOT NULL DEFAULT '',
  -- 失效时间（ISO，带时区）：过期的码即使被拍照流出也不能再用
  expires_at  TEXT NOT NULL DEFAULT '',
  -- 作废时间（ISO）；非空即表示已作废（重新生成二维码时把旧的批量作废）
  revoked_at  TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_checkin_tokens_session ON recruit_checkin_tokens(session_id);
CREATE INDEX IF NOT EXISTS idx_checkin_tokens_stage   ON recruit_checkin_tokens(stage, created_at DESC);

-- ---------------------------------------------------------------------------
-- applications 增列
-- ---------------------------------------------------------------------------
-- 签到时记下「签的是哪一场」，便于按场次统计到场人数
ALTER TABLE applications ADD COLUMN written_session_id   TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN interview_session_id TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN defense_session_id   TEXT NOT NULL DEFAULT '';
-- 报名来源：web = 官网提交；manual = 未报名、现场来考，管理员手工补录
ALTER TABLE applications ADD COLUMN source               TEXT NOT NULL DEFAULT 'web';
