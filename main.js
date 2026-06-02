const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

// ── 透明灵动岛窗口 ──────────────────────────────────────────────────────────
let mainWindow = null

function createWindow() {
  const { width: screenW } = require('electron').screen.getPrimaryDisplay().workAreaSize

  mainWindow = new BrowserWindow({
    width: 440,
    height: 300,
    x: Math.round((screenW - 440) / 2),
    y: 12,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    hasShadow: false,
    type: 'toolbar',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  // 开发环境加载 Vite dev server，生产环境加载打包文件
  if (process.env.NODE_ENV === 'development' || process.argv.includes('--dev')) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  // 暂不启用鼠标穿透，先确保 UI 交互正常
  // mainWindow.setIgnoreMouseEvents(true, { forward: true })
}

// ── Session 数据获取 ────────────────────────────────────────────────────────

const PROJECTS_DIR = path.join(app.getPath('home'), '.claude', 'projects')
// 缓存：filePath → { mtimeMs, data }，只在文件变化时重新读取
const sessionCache = new Map()

function getProjectName(cwd) {
  if (!cwd) return 'unknown'
  const parts = cwd.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || cwd
}

function readSessionLastLine(filePath) {
  try {
    const stat = fs.statSync(filePath)
    const statTime = stat.mtimeMs
    const cached = sessionCache.get(filePath)
    // 文件未变，返回缓存
    if (cached && cached.mtimeMs === statTime) return { ...cached.data, cached: true }

    const content = fs.readFileSync(filePath, 'utf-8')
    const lines = content.trim().split('\n')
    if (lines.length === 0) return null

    // 只解析最后 3 行（最新消息 + 可能的前一条 assistant）
    const last3 = lines.slice(-3).map(l => {
      try { return JSON.parse(l) } catch { return null }
    }).filter(Boolean)

    const lastMsg = last3[last3.length - 1]
    if (!lastMsg) return null

    // 从最后 3 条中找最近的 assistant
    const lastAssistant = last3.reverse().find(m => m.type === 'assistant')

    // 从 assistant 的 content 中提取类型列表（用于精准判定 tool_use）
    const assistantContentTypes = lastAssistant?.message?.content
      ?.map(c => c?.type).filter(Boolean) || []

    const data = {
      slug: lastMsg.slug || '',
      cwd: lastMsg.cwd || '',
      lastType: lastMsg.type,
      lastTimestamp: lastMsg.timestamp || '',
      stopReason: lastAssistant?.message?.stop_reason || null,
      assistantContentTypes,
      lastAssistantTimestamp: lastAssistant?.timestamp || '',
      sessionId: lastMsg.sessionId || '',
      fileMtimeMs: statTime,  // 文件最后修改时间，用于中断检测
    }

    sessionCache.set(filePath, { mtimeMs: statTime, data })
    return { ...data, cached: false }
  } catch {
    return null
  }
}

function checkClaudeProcesses() {
  // 用 tasklist 快速检测，比 PowerShell 快得多
  try {
    const result = require('child_process').execSync(
      'tasklist /fi "imagename eq claude.exe" /fo csv /nh 2>nul',
      { timeout: 2000, encoding: 'utf-8' }
    )
    // 额外也查 node 进程中包含 claude 的
    return result.trim().length > 0
  } catch {
    return false
  }
}

// ── IPC ─────────────────────────────────────────────────────────────────────

ipcMain.handle('get-sessions', () => {
  const sessions = []
  if (!fs.existsSync(PROJECTS_DIR)) return sessions

  const now = Date.now()
  const ACTIVE_WINDOW_MS = 20 * 60 * 1000  // 20 分钟内有过活动才显示
  const DONE_WINDOW_MS = 5 * 60 * 1000      // 5 分钟内的 end_turn 算"已完成"

  const dirs = fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue
    const projectPath = path.join(PROJECTS_DIR, dir.name)
    const files = fs.readdirSync(projectPath)
    const jsonlFiles = files.filter(f => f.endsWith('.jsonl'))
    for (const file of jsonlFiles) {
      const filePath = path.join(projectPath, file)
      // 10 分钟内未修改的文件跳过
      try {
        const stat = fs.statSync(filePath)
        if (now - stat.mtimeMs > ACTIVE_WINDOW_MS) continue
      } catch { continue }
      const data = readSessionLastLine(filePath)
      if (!data || !data.lastTimestamp) continue
      const sessionId = file.replace('.jsonl', '')
      sessions.push({ sessionId, filePath, projectName: getProjectName(data.cwd), ...data })
    }
  }

  const isAlive = checkClaudeProcesses()

  return sessions.map(s => {
    const sr = s.stopReason
    const age = now - new Date(s.lastTimestamp).getTime()

    // assistant 是否在 user 之后有回复（比较时间戳）
    const assistantAfterUser = s.lastAssistantTimestamp && s.lastTimestamp
      ? new Date(s.lastAssistantTimestamp) > new Date(s.lastTimestamp)
      : true  // 无数据时保守按"有回复"处理

    // 状态判定
    let state = 'idle'

    if (!isAlive) {
      state = 'completed'
    } else if (!sr) {
      // 没有 stop_reason → assistant 正在流式输出 → 工作中
      state = 'working'
    } else if (s.lastType === 'user' && age < 10000) {
      // 用户刚发言 10s 内 → 用 mtime 判断是否有后续活动
      const mtimeAge = now - (s.fileMtimeMs || 0)
      state = mtimeAge < 3000 ? 'working' : 'idle'
    } else if (s.lastType === 'user' && !assistantAfterUser && age >= 10000) {
      // user 发言后 10s+ 无 assistant 回复 → 可能已中断，判空闲
      state = 'idle'
    } else if (sr === 'tool_use' && s.assistantContentTypes?.includes('tool_use')) {
      // assistant content 中有 tool_use 块且尚无 tool_result → 真待确认
      state = 'awaiting'
    } else if (sr === 'end_turn') {
      // 任务结束 → 按时间区分"已完成"和"空闲"
      state = age < DONE_WINDOW_MS ? 'completed' : 'idle'
    } else {
      state = 'idle'
    }

    // 清理缓存：移除不存在的 session
    sessionCache.forEach((_, key) => {
      if (!fs.existsSync(key)) sessionCache.delete(key)
    })

    return { ...s, state, isAlive }
  }).sort((a, b) => new Date(b.lastTimestamp) - new Date(a.lastTimestamp))
})

// ── 启动 ────────────────────────────────────────────────────────────────────

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
