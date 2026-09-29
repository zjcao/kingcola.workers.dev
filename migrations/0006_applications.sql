-- ============================================================================
-- 0006 · 招新报名（applications）
--
-- 一次招新里每位同学只有一条记录（student_id 唯一），状态由状态机推进：
--   submitted → written_* → interview_* → probation → invited → member
--   各阶段未通过落在 *_failed / rejected / declined / withdrawn
-- 状态的中文名与允许的流转在 shared/recruit.ts，SQL 里只存取值本身。
--
-- 报名表文件存 R2（key 前缀 applications/），本表只存相对地址
-- /api/files/applications/xxx.pdf —— 该前缀在 GET /api/files/* 里被拦住，
-- 只有 GET /api/admin/applications/:id/file 带管理员会话才下载得到。
--
-- 时间列统一存 ISO 字符串（与其它表一致，便于直接比较与展示）。
-- 应用方式：
--   本地：npm run db:migrate:local
--   线上：npm run db:migrate:remote
-- ============================================================================

CREATE TABLE IF NOT EXISTS applications (
  id                  TEXT PRIMARY KEY,
  -- 身份（来自教务网会话，不可由学生修改）
  student_id          TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL DEFAULT '',
  -- 联系方式
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  qq                  TEXT NOT NULL DEFAULT '',
  -- 报名表（R2）
  file_url            TEXT NOT NULL DEFAULT '',
  file_name           TEXT NOT NULL DEFAULT '',
  file_size           INTEGER NOT NULL DEFAULT 0,
  -- 状态机
  status              TEXT NOT NULL DEFAULT 'submitted',
  -- 笔试
  written_at          TEXT NOT NULL DEFAULT '',
  written_score       TEXT NOT NULL DEFAULT '',
  written_note        TEXT NOT NULL DEFAULT '',
  -- 面试
  interview_at        TEXT NOT NULL DEFAULT '',
  interview_note      TEXT NOT NULL DEFAULT '',
  -- 预备期
  probation_note      TEXT NOT NULL DEFAULT '',
  -- 邀请函与转正
  invite_token        TEXT NOT NULL DEFAULT '',
  invite_expires_at   TEXT NOT NULL DEFAULT '',
  invited_at          TEXT NOT NULL DEFAULT '',
  confirmed_at        TEXT NOT NULL DEFAULT '',
  member_id           TEXT NOT NULL DEFAULT '',
  -- 管理员备注
  note                TEXT NOT NULL DEFAULT '',
  created_at          TEXT NOT NULL DEFAULT '',
  updated_at          TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_applications_status  ON applications(status);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_token   ON applications(invite_token);
