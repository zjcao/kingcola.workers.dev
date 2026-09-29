-- 0009: 去掉「场次」，签到凭证改为只绑阶段。
--
-- 为什么：整届的考试安排一律通过对应的 QQ 群通知，系统里不再需要知道「哪天几点在哪考」。
-- 于是签到二维码只需要绑阶段（笔试 / 面试 / 答辩），配合自选有效期与一键作废即可 ——
-- 同学扫哪张码就记哪个阶段，不再需要「任选一场」与按场次统计。
--
-- 注意：SQLite 的 ALTER TABLE ... DROP COLUMN 需要 3.35+，D1 支持。
-- 这里只删三列、不重建 applications —— 重建会牵动索引与既有数据映射，得不偿失。

DROP TABLE IF EXISTS recruit_sessions;

DROP TABLE IF EXISTS recruit_checkin_tokens;
CREATE TABLE recruit_checkin_tokens (
  token TEXT PRIMARY KEY,
  -- written | interview | defense
  stage TEXT NOT NULL,
  -- ISO 时间；过期即失效
  expires_at TEXT NOT NULL,
  -- 非空 = 已被管理员作废
  revoked_at TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

-- 同一阶段至多一张有效码，按阶段找当前码是最常见的查询
CREATE INDEX idx_recruit_checkin_tokens_stage ON recruit_checkin_tokens (stage, revoked_at);

ALTER TABLE applications DROP COLUMN written_session_id;
ALTER TABLE applications DROP COLUMN interview_session_id;
ALTER TABLE applications DROP COLUMN defense_session_id;
