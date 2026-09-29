-- ============================================================================
-- 0010 · 报名材料审核（报名阶段后台逐个「通过 / 驳回」）
--
-- 背景：报名阶段管理员要在网页上判断每一份材料是否合格 ——
-- 合格就「通过」，不合格就「驳回」，并写清理由、**发信要求同学按理由改好再交**。
--
-- applications 新增三列：
--
--   material_status       审核状态：'' 待审核（默认）/ approved 通过 / rejected 驳回
--   material_reason       驳回理由（写给同学看，会进邮件；通过时为空）
--   material_reviewed_at  最后一次审核时间（ISO）
--
-- 两条配套规则（都在代码里，不在这条迁移里）：
--   1. **同学重新上传材料后，审核状态重置为待审核** —— 否则「改好了却还是被驳回」，
--      而理由指向的那一版材料早就不在了；
--   2. **未通过审核的人不能被勾选进下一阶段**（`shared/recruit.ts` 的 `isMaterialApproved`），
--      否则审核就成了纯装饰。
--
-- 应用方式（**有数据的库不要整体跑 migrate**，只执行本文件）：
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --local \
--     --file=migrations/0010_recruit_material_review.sql
--   node .\node_modules\wrangler\bin\wrangler.js d1 execute kingcola-db --remote \
--     --file=migrations/0010_recruit_material_review.sql
-- ============================================================================

ALTER TABLE applications ADD COLUMN material_status TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN material_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE applications ADD COLUMN material_reviewed_at TEXT NOT NULL DEFAULT '';

-- 报名阶段最常见的查询是「按审核状态筛人」（待审核 / 已驳回）
CREATE INDEX idx_applications_material_status ON applications (material_status);
