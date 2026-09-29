-- ============================================================================
-- 0012 · 成员「毕业去向填写」凭证
--
-- 背景：毕业去向改为**由本人填**（像邀请函转正那样）：批量毕业时发一封信，
-- 里面带一条专属链接 `/graduate/<token>`，同学点开填一句话就写回 members.destination。
--
-- 为什么凭证放在 members 上、且**不进 shared/resources.ts 的字段表**：
--   公开的 `/api/public/bootstrap` 是按字段表逐列回传的，token 一旦进了字段表就会下发出去。
--   所以它只存在于 worker/lib/member-destination.ts 的裸 SQL 里
--   —— 与 `applications.invite_token` 完全同一路数。
--
-- 生命周期：签发时覆盖旧值（旧链接立即失效）；提交后立刻清空（一条链接只能用一次）。
-- 刻意**没有过期时间**：毕业去向可能过几个月才回填，到点失效只会让人填不了。
--
-- 应用方式（**有数据的库不要整体跑 migrate**，只执行本文件）：
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local \
--     --file=migrations/0012_member_destination_token.sql
--   （线上把 --local 换成 --remote）
-- ============================================================================

ALTER TABLE members ADD COLUMN destination_token TEXT NOT NULL DEFAULT '';

-- 按 token 找人是最常见的查询（每次打开/提交填写页都要走一次）
CREATE INDEX IF NOT EXISTS idx_members_destination_token ON members (destination_token);
