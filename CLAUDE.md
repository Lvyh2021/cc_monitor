# CC Monitor — Claude Code Session 监测器

## 概述

Windows 桌面悬浮应用（灵动岛风格），实时监测本机 Claude Code Session 的工作状态。
不依赖外部服务，纯本地数据。

## 技术栈

- Electron 28（透明窗口、frameless、always-on-top）
- Vue 3 + Composition API + Pinia（UI + 动画）
- electron-builder（打包 .exe）

## 核心功能

### 状态判定

每个 session 对应一个 `.jsonl` 文件，位于 `C:\Users\user\.claude\projects\{name}\{uuid}.jsonl`。

持续读取每个文件最后一行 JSON，解析字段：

| 状态 | 颜色 | 判定条件 |
|------|------|---------|
| **工作中** | 🟢 `#22c55e` | 最后 `type=assistant` 且 `stop_reason="tool_use"`（正在调用工具） |
| **工作中** | 🟢 `#22c55e` | 最后 `type=user` 且 timestamp 在 5s 内（用户刚发言） |
| **待确认** | 🟡 `#eab308` | 最后 `type=assistant` 且 `stop_reason="end_turn"` 且进程存活 |
| **空闲** | ⚪ `#94a3b8` | 最后 `type=user` 且超过 30s 无更新 + 进程存活 |
| **已完成** | ✅ `#3b82f6` | 进程已退出，保留显示 5 分钟后移除 |
| **错误** | 🔴 `#ef4444` | 进程异常退出 |

字段路径：`message.stop_reason`、`type`、`timestamp`、`cwd`、`sessionId`、`slug`

### Session 发现与过滤

- 扫描 `C:\Users\user\.claude\projects\*\*.jsonl`
- 只显示：有对应 claude 进程存活的 session + 最近 5 分钟内退出的
- 每 3 秒扫描新 session，每 2 秒更新状态
- 进程存活通过 `tasklist /v /fo csv` 检测

### UI 行为

- 折叠态：一行状态点 + session 数量，宽 ~300px，高 32px
- 展开态：鼠标悬停 1.5s，每行一个 session，宽 ~420px
- 移开 0.5s 折叠
- 按最新活动时间排序，FLIP 动画重排
- 始终置顶，不抢焦点
- 固定主显示器顶部居中，距顶 12px

### 不需要的功能

- 不需要点击跳转到终端窗口
- 不需要任务栏图标（纯悬浮）

## 项目结构

```
cc_monitor/
├── package.json
├── electron-builder.yml
├── main.js              # Electron 主进程
├── preload.js           # IPC 桥接（安全暴露 API）
├── src/
│   ├── main.js          # Vue 入口
│   ├── App.vue          # 根组件
│   ├── components/
│   │   ├── IslandBar.vue    # 灵动岛主容器
│   │   └── SessionRow.vue   # 单行 session
│   └── stores/
│       └── sessions.js      # Pinia store：轮询 + 状态管理
├── dist/                # 构建产物
```

## 实现顺序

1. `npm init` + Electron + Vue3 脚手架，透明窗口跑通
2. `src/stores/sessions.js` — .jsonl 扫描 + 状态解析
3. `main.js` — 进程检测 + IPC
4. `IslandBar.vue` — 折叠/展开布局
5. `SessionRow.vue` — 单行 + 状态颜色
6. 动画（展开/折叠 + FLIP 排序）
7. `electron-builder.yml` — 打包 .exe
