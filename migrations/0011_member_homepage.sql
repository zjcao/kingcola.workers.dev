-- ============================================================================
-- 0011 · 成员「个人主页」链接
--
-- 背景：成员卡片上除了邮箱，还想放一个个人主页（博客 / GitHub / 作品集）。
-- 与 0002（avatar_url）、0003（destination）同一路数：直接 ADD COLUMN，
-- NOT NULL + DEFAULT '' 保证老数据读出来是空串而不是 NULL。
--
-- 谁写它：① 后台「团队成员」新增 / 编辑；② 正式邀请函（/invite/<token>）里本人自己填。
--
-- 应用方式（**有数据的库不要整体跑 migrate**，只执行本文件）：
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local \
--     --file=migrations/0011_member_homepage.sql
--   （线上把 --local 换成 --remote）
-- ============================================================================

ALTER TABLE members ADD COLUMN homepage_url TEXT NOT NULL DEFAULT '';
