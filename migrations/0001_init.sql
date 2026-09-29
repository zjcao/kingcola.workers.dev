-- ============================================================================
-- 0001_init · 拾光工作室官网 D1 初始化
--
-- 应用方式：
--   本地：npx wrangler d1 execute kingcola-db --local  --file=./migrations/0001_init.sql
--   线上：npx wrangler d1 execute kingcola-db --remote --file=./migrations/0001_init.sql
-- ============================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 内容表（由 shared/resources.ts 驱动，字段名与 column 一一对应）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS members (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  name_en     TEXT    NOT NULL DEFAULT '',
  title       TEXT    NOT NULL DEFAULT '',
  direction   TEXT    NOT NULL DEFAULT '',
  email       TEXT    NOT NULL DEFAULT '',
  join_year   TEXT    NOT NULL DEFAULT '',
  status      TEXT    NOT NULL DEFAULT 'current', -- current | alumni
  is_pi       INTEGER NOT NULL DEFAULT 0,
  bio         TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_members_order ON members (is_pi DESC, join_year DESC, sort_order, name);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT    NOT NULL,
  tagline     TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '[]',  -- JSON 数组
  status      TEXT    NOT NULL DEFAULT '进行中',
  year        TEXT    NOT NULL DEFAULT '',
  link        TEXT    NOT NULL DEFAULT '',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects (sort_order, year DESC, name);

CREATE TABLE IF NOT EXISTS news (
  id          TEXT PRIMARY KEY,
  title       TEXT    NOT NULL,
  category    TEXT    NOT NULL DEFAULT '通知公告',
  date        TEXT    NOT NULL DEFAULT '',
  summary     TEXT    NOT NULL DEFAULT '',
  content     TEXT    NOT NULL DEFAULT '',
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_news_order ON news (pinned DESC, date DESC, sort_order);

CREATE TABLE IF NOT EXISTS slides (
  id          TEXT PRIMARY KEY,
  kicker      TEXT    NOT NULL DEFAULT '',
  title       TEXT    NOT NULL,
  subtitle    TEXT    NOT NULL DEFAULT '',
  cta_text    TEXT    NOT NULL DEFAULT '',
  cta_page    TEXT    NOT NULL DEFAULT 'home',
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_slides_order ON slides (sort_order, id);

-- ---------------------------------------------------------------------------
-- 站点配置（键值，值班人员可在后台修改，无需重新部署）
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS site_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 管理员（本轮设计为单用户，但表结构支持后续扩展为多人/换届交接）
-- 密码格式：pbkdf2$<iterations>$<saltBase64>$<hashBase64>
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admin_users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name  TEXT NOT NULL DEFAULT '',
  is_owner      INTEGER NOT NULL DEFAULT 0,  -- 拥有者不可自我删除，保证永远有人能登录
  last_login_at TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- 审计日志：所有后台写操作都落一条，换届时可回溯
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS audit_logs (
  id         TEXT PRIMARY KEY,
  actor      TEXT NOT NULL,
  action     TEXT NOT NULL,           -- create | update | delete | login | logout | login_failed | bootstrap
  resource   TEXT NOT NULL DEFAULT '',
  target_id  TEXT NOT NULL DEFAULT '',
  detail     TEXT NOT NULL DEFAULT '',
  ip         TEXT NOT NULL DEFAULT '',
  ua         TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs (created_at DESC);
