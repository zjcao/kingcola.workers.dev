import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { installConfigRefresh, refreshRuntimeConfig } from './api/client'

// 首次启动拉取运行时配置，并安装定时/可见性刷新，
// 这样即使页面已经在浏览器里停留很久，也能感知到后端的通道切换。
void refreshRuntimeConfig()
installConfigRefresh()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
