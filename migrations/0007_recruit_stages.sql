-- ============================================================================
-- 0007 · 招新报名改用「阶段 + 结果」两列描述状态，并新增发信日志
--
-- 背景：原来用一列 14 态枚举（submitted / written_scheduled / …）描述报名状态，
-- 无法表达「笔试已安排但还没参加」这类组合，也不便于按阶段做统计与批量操作。
-- 现改为两个属性：
--
--   stage   当前阶段：apply | written | interview | defense | onboard
--   result  该阶段结果：''（尚无结论）| attended | passed | failed | absent | declined | withdrawn
--
-- 是否「已安排笔试 / 面试」不再是个人状态，而是全局周期配置（见 shared/recruit.ts 的
-- RecruitCycleConfig，存在 site_config['runtime'].recruit），因此旧表的个人时间列
-- written_at / interview_at / probation_note 不再需要（内容尽量搬进对应的 note）。
--
-- SQLite 改不动主键与列集合，沿用 0004 的做法：建新表 → 搬数据（CASE 映射旧枚举）
-- → 删旧表 → 改名。
--
-- 应用方式（**有数据的库不要整体跑 migrate**，只执行本文件）：
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local \
--     --file=migrations/0007_recruit_stages.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS applications_new (
  id                  TEXT PRIMARY KEY,
  -- 身份（来自教务网会话，不可由学生修改）
  student_id          TEXT NOT NULL UNIQUE,
  name                TEXT NOT NULL DEFAULT '',
  -- 联系方式
  email               TEXT NOT NULL DEFAULT '',
  phone               TEXT NOT NULL DEFAULT '',
  qq                  TEXT NOT NULL DEFAULT '',
  -- 报名表（对象存储 applications/ 前缀，私有）
  file_url            TEXT NOT NULL DEFAULT '',
  file_name           TEXT NOT NULL DEFAULT '',
  file_size           INTEGER NOT NULL DEFAULT 0,
  -- 状态：阶段 + 该阶段结果
  stage               TEXT NOT NULL DEFAULT 'apply',
  result              TEXT NOT NULL DEFAULT '',
  stage_changed_at    TEXT NOT NULL DEFAULT '',
  -- 各阶段签到（扫码签到 / 后台补勾）
  written_checkin_at   TEXT NOT NULL DEFAULT '',
  interview_checkin_at TEXT NOT NULL DEFAULT '',
  defense_checkin_at   TEXT NOT NULL DEFAULT '',
  -- 成绩与评语
  written_score       TEXT NOT NULL DEFAULT '',
  interview_score     TEXT NOT NULL DEFAULT '',
  defense_score       TEXT NOT NULL DEFAULT '',
  written_note        TEXT NOT NULL DEFAULT '',
  interview_note      TEXT NOT NULL DEFAULT '',
  defense_note        TEXT NOT NULL DEFAULT '',
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

INSERT INTO applications_new (
  id, student_id, name, email, phone, qq, file_url, file_name, file_size,
  stage, result, stage_changed_at,
  written_score, written_note, interview_note, defense_note,
  invite_token, invite_expires_at, invited_at, confirmed_at, member_id,
  note, created_at, updated_at
)
SELECT
  id, student_id, name, email, phone, qq, file_url, file_name, file_size,
  CASE status
    WHEN 'submitted'           THEN 'apply'
    WHEN 'rejected'            THEN 'apply'
    WHEN 'written_scheduled'   THEN 'written'
    WHEN 'written_passed'      THEN 'written'
    WHEN 'written_failed'      THEN 'written'
    WHEN 'interview_scheduled' THEN 'interview'
    WHEN 'interview_passed'    THEN 'interview'
    WHEN 'interview_failed'    THEN 'interview'
    WHEN 'probation'           THEN 'defense'
    WHEN 'probation_failed'    THEN 'defense'
    WHEN 'invited'             THEN 'onboard'
    WHEN 'member'              THEN 'onboard'
    WHEN 'declined'            THEN 'onboard'
    WHEN 'withdrawn'           THEN 'apply'
    ELSE 'apply'
  END,
  CASE status
    WHEN 'rejected'          THEN 'failed'
    WHEN 'written_passed'    THEN 'passed'
    WHEN 'written_failed'    THEN 'failed'
    WHEN 'interview_passed'  THEN 'passed'
    WHEN 'interview_failed'  THEN 'failed'
    WHEN 'probation_failed'  THEN 'failed'
    WHEN 'member'            THEN 'passed'
    WHEN 'declined'          THEN 'declined'
    WHEN 'withdrawn'         THEN 'withdrawn'
    ELSE ''
  END,
  COALESCE(updated_at, ''),
  COALESCE(written_score, ''),
  COALESCE(written_note, ''),
  COALESCE(interview_note, ''),
  COALESCE(probation_note, ''),
  COALESCE(invite_token, ''),
  COALESCE(invite_expires_at, ''),
  COALESCE(invited_at, ''),
  COALESCE(confirmed_at, ''),
  COALESCE(member_id, ''),
  COALESCE(note, ''),
  COALESCE(created_at, ''),
  COALESCE(updated_at, '')
FROM applications;

DROP TABLE applications;
ALTER TABLE applications_new RENAME TO applications;

CREATE INDEX IF NOT EXISTS idx_applications_stage   ON applications(stage, result);
CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_applications_token   ON applications(invite_token);

-- ============================================================================
-- 发信日志：每次给报名同学发通知都记一行，便于回答「他到底收到没有」
-- 与报名数据同生命周期（关闭本届时会一并清空）
-- ============================================================================

CREATE TABLE IF NOT EXISTS application_mails (
  id             TEXT PRIMARY KEY,
  application_id TEXT NOT NULL DEFAULT '',
  kind           TEXT NOT NULL DEFAULT '',
  recipient      TEXT NOT NULL DEFAULT '',
  subject        TEXT NOT NULL DEFAULT '',
  ok             INTEGER NOT NULL DEFAULT 0,
  code           TEXT NOT NULL DEFAULT '',
  message        TEXT NOT NULL DEFAULT '',
  actor          TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_application_mails_app     ON application_mails(application_id);
CREATE INDEX IF NOT EXISTS idx_application_mails_created ON application_mails(created_at DESC);
