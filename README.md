# CC Monitor

Windows 桌面悬浮监测器（灵动岛风格），实时显示本机所有 Claude Code Session 的运行状态。纯本地，不依赖外部服务。

![状态一览](https://img.shields.io/badge/platform-Windows-blue) ![Electron](https://img.shields.io/badge/electron-28-47848f) ![Vue](https://img.shields.io/badge/vue-3.4-4fc08d)

## 效果

屏幕顶部居中悬浮条，毛玻璃半透明背景，始终置顶不抢焦点。

| 折叠态 | 展开态 |
|--------|--------|
| 单行：状态点 + 项目名 + 状态标签 + 剩余数量 | 鼠标悬停展开：每行一个 session 详情 |

## 状态判定

| 状态 | 颜色 | 条件 |
|------|------|------|
| 工作中 | 🟢 `#22c55e` | assistant 流式输出中 / 用户刚发言 |
| 待确认 | 🟡 `#eab308` | assistant 调用了工具，等待用户确认 |
| 空闲 | ⚪ `#94a3b8` | 进程存活但无活动 / 已中断 |
| 已完成 | 🔵 `#3b82f6` | 进程已退出，保留 5 分钟后自动移除 |
| 错误 | 🔴 `#ef4444` | 进程异常退出 |

### 判定细节

- **工作中**：assistant 无 `stop_reason`（流式输出中）或 `.jsonl` mtime 在 3s 内有更新
- **待确认**：`stop_reason = "tool_use"` 且 `message.content` 含 `tool_use` 块，双重校验避免误判
- **中断检测**：`.jsonl` 文件 3s 无写入即判空闲（mtime 检测），配合时间戳比较 10s 兜底

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 28（透明窗口、无边框、置顶） |
| UI | Vue 3 + Composition API + Pinia |
| 构建 | Vite 5 + electron-builder |

## 目录结构

```
cc_monitor/
├── main.js              # Electron 主进程：透明窗口 + .jsonl 扫描 + IPC
├── preload.js           # IPC 桥接，安全暴露 API
├── index.html           # 入口 HTML
├── package.json
├── vite.config.js
└── src/
    ├── main.js          # Vue 入口，挂载 Pinia
    ├── App.vue          # 根组件
    ├── components/
    │   ├── IslandBar.vue    # 灵动岛主容器（折叠/展开）
    │   └── SessionRow.vue   # 单行 session
    └── stores/
        └── sessions.js      # Pinia store：轮询 + 状态管理
```

## 快速开始

```bash
# 安装依赖
npm install

# 开发（Vite + Electron 同时启动）
npm run dev:electron

# 仅启动 Vite（调试 UI）
npm run dev

# 打包 .exe
npm run dist
```

## 工作原理

1. 每 2s 轮询一次，扫描 `C:\Users\...\.claude\projects\*\*.jsonl`
2. 读取每个文件最后 3 行，解析最后一条 `assistant` 和最新消息
3. 通过 `tasklist` 检测 `claude.exe` 进程是否存活
4. 综合判定状态，按最近活动时间排序显示
5. 鼠标悬停 0.6s 展开列表，移开 0.5s 折叠

## 窗口行为

- 固定主显示器顶部居中，距顶 12px
- 始终置顶（`alwaysOnTop`），不抢焦点（`focusable: false`）
- 不在任务栏显示（`skipTaskbar: true`）
- 折叠态约 300×32px，展开态约 400px 宽
