-- ============================================================================
-- 0003 · 拆开「负责方向」与「毕业去向」
--
-- 历史上只有 direction 一个字段，靠 status 切换标签与占位符来兼任两种含义，
-- 后台编辑时容易填错。这里新增独立的 destination 列并迁移历史数据。
--
-- 应用方式：
--   本地：npm run db:migrate:local
--   线上：npm run db:migrate:remote
-- ============================================================================

ALTER TABLE members ADD COLUMN destination TEXT NOT NULL DEFAULT '';

-- 已毕业成员的 direction 历史上存的是毕业去向，迁移过去并去掉遗留前缀
UPDATE members
   SET destination = TRIM(REPLACE(direction, '毕业去向：', '')),
       direction   = ''
 WHERE status = 'alumni'
   AND direction <> '';
