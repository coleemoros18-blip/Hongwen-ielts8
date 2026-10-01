# 句子记忆训练

Vue 3 + Vite + TypeScript，使用 Dexie/IndexedDB 保存全部学习数据；PWA 与 Tauri Windows 桌面版共用同一前端。无账号、无音频、无游戏。支持多句库独立进度、批量 `句子||释义||出处` 导入、浏览复习、四种回忆练习、字符级默写对照、错句本、ECharts 统计、JSON 备份恢复、离线缓存。

## 启动

```sh
pnpm install
pnpm dev
```

构建：`pnpm build`。需使用 Node.js 20.19+ 或 22.12+。浏览器首次访问需联网下载依赖，生产部署应使用 HTTPS（localhost 开发可用）；PWA service worker 会缓存构建产物和页面，数据仍保存在本地 IndexedDB。

## Dexie schema

数据库 `sentence-memory`，版本 1：

```ts
banks:       id, kind, updatedAt
sentences:   id, bankId, [bankId+order], [bankId+createdAt]
cardStates:  id, bankId, sentenceId, [bankId+sentenceId], [bankId+dueAt], [bankId+mastery]
testRecords: id, bankId, endedAt, [bankId+endedAt], [mode+endedAt]
wrongEntries:id, bankId, sentenceId, [bankId+sentenceId], [bankId+updatedAt]
statsDaily:  id, bankId, date, [bankId+date]
meta:        key
```

`cardStates.id` 使用 `bankId:sentenceId`，保证每个句库独立调度。句子正文使用 `TextEncoder` 实时计算 UTF-8 字节数，上限 300。SQLite 不参与此 Web 应用。设置（每日目标、当前句库）放 localStorage；用户学习内容实时写入 Dexie。

## 路由与快捷键

| 路由 | 功能 |
| --- | --- |
| `/` | 今日到期任务和进度 |
| `/banks` | 示例/自定义句库、单句与批量导入 |
| `/banks/:bankId/browse` | 翻面、遮罩挖空、会背/模糊/不会、断点续背 |
| `/banks/:bankId/test` | 挖空、句段排序、整句默写、上下句选择与单局报告 |
| `/wrong` | 错句复习；连续答对 3 次自动移出 |
| `/stats` | 90 日热力图、14 日趋势、正确率和徽章 |
| `/settings` | 每日目标、JSON 导出/导入、快捷键说明 |

全局快捷键在文本输入区停用：浏览页 `Space` 翻面、`1/2/3` 会背/模糊/不会；测试页 `1–4` 选择、`Enter` 提交或下一题。复习队列优先：错句、已到期、模糊、新句。SM-2 风格间隔使用 1 日、3 日，再按 ease factor 增长；错答短间隔重见。

## Tauri 封装为 Windows exe

此仓库已经包含最小 Tauri 2 配置（`src-tauri/`）；前端无分叉，桌面端通过 Tauri FS 插件在启动时将 IndexedDB 导出至应用数据目录 `backups/`，按文件名保留最近 7 份。需要 Rust stable/MSVC、Microsoft C++ Build Tools 和 WebView2 Runtime。

Windows 初次配置：安装 Visual Studio Build Tools 的 **Desktop development with C++** 工作负载；安装 Rustup 并选择 `stable-x86_64-pc-windows-msvc`（或运行 `rustup default stable-msvc`）；确认 WebView2 Runtime 已安装。当前检查结果：本机已有 WebView2，但缺 Rust/Cargo 和 C++ Build Tools。

```sh
corepack enable
pnpm install
pnpm tauri dev
pnpm tauri build
```

若 `corepack` 不可用，可通过 `npm install --global pnpm` 安装 pnpm。若 MSI 构建报 `light.exe` 错误，检查 Windows 可选功能中的 VBScript 是否启用。

安装包输出在 `src-tauri/target/release/bundle/`（NSIS 安装器和 MSI）。调整应用名、发布者、图标和签名证书后再分发。PWA 图标由 `public/icon.svg` 提供；Tauri 窗口不依赖 PWA 安装能力。自动备份失败不会阻止学习，控制台会记录错误；重要数据仍可在设置页手动导出。

Tauri 配置按官方 v2 Vite 静态前端和插件 FS 权限方式设置；文件权限限定到 `$APPDATA/backups/`，不要扩大成整个用户目录。
