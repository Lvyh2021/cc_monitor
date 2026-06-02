# CC Monitor

Windows 桌面悬浮监测器（灵动岛风格），实时显示本机所有 Claude Code Session 的运行状态。纯本地，不依赖外部服务。

## 功能

- 自动扫描本机 Claude Code 会话，实时显示工作状态
- 折叠/展开灵动岛设计，鼠标悬停即可查看所有会话详情
- 毛玻璃半透明背景，始终置顶，不干扰正常操作
- 支持检测工作中、待确认、空闲、已完成等多种状态

## 技术栈

Electron 28 + Vue 3 + Pinia + Vite 5

## 安装与运行

```bash
# 克隆仓库
git clone git@github.com:Lvyh2021/cc_monitor.git
cd cc_monitor

# 安装依赖
npm install

# 开发运行
npm run dev:electron

# 打包为 .exe
npm run dist
```
