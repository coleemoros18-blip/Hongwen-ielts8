import { createApp } from 'vue'
import { createPinia } from 'pinia'
import router from './router'
import App from './App.vue'
import './style.css'
import { ensureSeed } from './services/db'
import { startupBackup } from './services/desktopBackup'

ensureSeed().then(() => {
  createApp(App).use(createPinia()).use(router).mount('#app')
  void startupBackup()
}).catch((error: unknown) => {
  console.error('应用启动失败：初始化本地词库时出错。', error)
  const root = document.querySelector<HTMLElement>('#app')
  if (!root) return
  const panel = document.createElement('main')
  panel.style.cssText = 'max-width:760px;margin:12vh auto;padding:32px;color:#302718;font:16px/1.7 system-ui,sans-serif;background:#f5efdf;border:1px solid #ddd2b9;border-radius:16px'
  const title = document.createElement('h1')
  title.textContent = '弘文雅思8分暂时无法启动'
  const details = document.createElement('p')
  details.textContent = `本地词库初始化失败。请重新打开软件；如果问题持续，请反馈此错误信息：${error instanceof Error ? error.message : String(error)}`
  panel.append(title, details)
  root.replaceChildren(panel)
})
