import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { inspectAttr } from 'kimi-plugin-inspect-react'

// https://vite.dev/config/
export default defineConfig({
  // 必须是根路径：后台有 /admin/content/:resource 这类多级路由，
  // 用 './' 时在深层路径刷新页面会把资源解析成 /admin/content/assets/... 而 404。
  base: '/',
  plugins: [inspectAttr(), react()],
  server: {
    // 不要用 3000 / 5173：本机上这两个端口已被 IDE 的内部服务长期占用，
    // 撞车时 Vite 会自动换端口或访问到别的服务，表现为「拒绝访问 / 404」。
    port: 5175,
    strictPort: true,
    // 纯前端开发时把 /api 反代到 wrangler dev（npm run dev:api），
    // 这样本地就是「同源」，与线上 Workers + Static Assets 的行为一致。
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@shared": path.resolve(__dirname, "./shared"),
    },
  },
});
