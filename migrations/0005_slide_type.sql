-- ============================================================================
-- 0005 · 首页轮播支持两种形态
--
--   1) type      'text' | 'image'，历史数据一律按文字版处理
--   2) image_url 图片版轮播的图片地址（/api/files/slides/xxx.jpg），文字版为空
--
-- 文字版的字段（kicker / title / subtitle）原样保留，图片版可以只用其中的
-- 标题与按钮作图上叠加文案，也可以全部留空、只展示图片。
--
-- 应用方式：
--   本地：npm run db:migrate:local
--   线上：npm run db:migrate:remote
-- ============================================================================

ALTER TABLE slides ADD COLUMN type      TEXT NOT NULL DEFAULT 'text';
ALTER TABLE slides ADD COLUMN image_url TEXT NOT NULL DEFAULT '';

-- 双保险：即使哪天用别的工具建表漏了默认值，也把空值补成文字版
UPDATE slides SET type = 'text' WHERE type IS NULL OR type = '';
