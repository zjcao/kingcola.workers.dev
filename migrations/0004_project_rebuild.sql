-- ============================================================================
-- 0004 · 项目表改造
--
--   1) 主键改为自增 INTEGER（原来的 'p-1' 文本 id 不再使用）
--   2) 删除「状态 status」与「排序权重 sort_order」
--   3) 新增「所获荣誉 honor」与「是否精选 featured」
--
-- SQLite 不能修改主键类型，只能重建表再搬数据。
--
-- 应用方式：
--   本地：npm run db:migrate:local
--   线上：npm run db:migrate:remote
-- ============================================================================

PRAGMA foreign_keys = OFF;

DROP INDEX IF EXISTS idx_projects_order;

CREATE TABLE projects_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT    NOT NULL,
  tagline     TEXT    NOT NULL DEFAULT '',
  description TEXT    NOT NULL DEFAULT '',
  tags        TEXT    NOT NULL DEFAULT '[]',
  year        TEXT    NOT NULL DEFAULT '',
  link        TEXT    NOT NULL DEFAULT '',
  honor       TEXT    NOT NULL DEFAULT '',
  featured    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

-- 按年份倒序搬入，让自增 id 的顺序与原来的展示顺序一致
INSERT INTO projects_new (name, tagline, description, tags, year, link, honor, featured, created_at, updated_at)
SELECT name, tagline, description, tags, year, link, '', 0, created_at, updated_at
  FROM projects
 ORDER BY year DESC, name ASC;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

-- ---------------------------------------------------------------------------
-- 以下是给演示数据补的默认值，正式内容可自行在后台修改
-- ---------------------------------------------------------------------------

-- 保持首页「精选项目」不为空：把最近年份的 3 个标为精选
UPDATE projects
   SET featured = 1
 WHERE id IN (SELECT id FROM projects ORDER BY year DESC, id ASC LIMIT 3);

-- 顺带给两个有代表性的项目填上荣誉，方便查看新字段的展示效果
UPDATE projects SET honor = '2026 年大学生计算机设计大赛 省级一等奖' WHERE name = '智能问答知识库';
UPDATE projects SET honor = '校图书馆优秀合作项目' WHERE name = '图书馆座位预约系统';

PRAGMA foreign_keys = ON;
