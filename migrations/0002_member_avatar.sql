-- ============================================================================
-- 0002 · 团队成员头像
--
-- 头像文件存 R2（key 形如 avatars/m-1-xxxx.jpg），数据库只存相对路径
-- `/api/files/<key>`，这样本地开发与线上同源可用，将来换 R2 自定义域名也只需改一处。
--
-- 应用方式：
--   本地：npx wrangler d1 execute kingcola-db --local  --file=./migrations/0002_member_avatar.sql
--   线上：npx wrangler d1 execute kingcola-db --remote --file=./migrations/0002_member_avatar.sql
-- ============================================================================

ALTER TABLE members ADD COLUMN avatar_url TEXT NOT NULL DEFAULT '';
