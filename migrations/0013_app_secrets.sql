-- 安装时自动生成的运行期密钥（安装页写、应用读）
--
-- 为什么放这里：运行时无法写自己的环境变量，所以「零手工安装」只能把生成的密钥存进 D1。
-- 读取方（会话签名 / 验签）走 worker/lib/secrets.ts 的模块级缓存：每个请求入口先 warm 一次，
-- 取不到就回退到同名环境变量（老部署、本地开发仍然照旧）。
CREATE TABLE IF NOT EXISTS app_secrets (
  name TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL
);
