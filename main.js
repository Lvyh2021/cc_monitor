const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// ── 透明灵动岛窗口 ──────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let isQuitting = false

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

function createTrayIcon() {
  const zlib = require('zlib')
  const W = 16, H = 16
  const cx = 7.5, cy = 7.5

  function smoothstep(edge0, edge1, x) {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)
  }

  // 药丸形外框距离场（仅边框线，~0.8px 宽）
  function pillEdgeDist(px, py) {
    const dx = Math.abs(px - cx)
    const dy = Math.abs(py - cy)
    const hw = 6.5, hh = 3.5, r = 3.5
    if (dx <= hw - r) return Math.abs(dy - hh)
    if (dy <= hh - r) return Math.abs(dx - hw)
    const cdx = dx - (hw - r)
    const cdy = dy - (hh - r)
    return Math.abs(Math.sqrt(Math.max(0, cdx * cdx + cdy * cdy)) - r)
  }

  // 药丸形填充距离场（负数=内部）
  function pillFillDist(px, py) {
    const dx = Math.abs(px - cx)
    const dy = Math.abs(py - cy)
    const hw = 6.5, hh = 3.5, r = 3.5
    if (dx <= hw - r) return Math.max(dy - hh, -(hh - r))
    if (dy <= hh - r) return Math.max(dx - hw, -(hw - r))
    const cdx = dx - (hw - r)
    const cdy = dy - (hh - r)
    return Math.sqrt(cdx * cdx + cdy * cdy) - r
  }

  function dotDist(px, py) {
    const dx = px - cx
    const dy = py - cy
    return Math.sqrt(dx * dx + dy * dy)
  }

  const raw = Buffer.alloc(H * (1 + W * 4))
  for (let y = 0; y < H; y++) {
    const rowBase = y * (1 + W * 4)
    raw[rowBase] = 0
    for (let x = 0; x < W; x++) {
      const o = rowBase + 1 + x * 4
      const px = x + 0.5, py = y + 0.5

      // 药丸填充 (暗色背景 #0f172a，半透明模拟毛玻璃)
      const fill = pillFillDist(px, py)
      const fillAlpha = 1.0 - smoothstep(-0.5, 0.5, fill)

      // 药丸边框 (浅色描边 #64748b，0.8px 宽)
      const edge = pillEdgeDist(px, py)
      const edgeAlpha = (1.0 - smoothstep(0, 0.8, edge)) * 0.35

      // 中心绿点 #22c55e，r≈1.8，含柔光
      const dd = dotDist(px, py)
      const core = 1.0 - smoothstep(0, 1.3, dd)
      const glow = (1.0 - smoothstep(1.0, 2.5, dd)) * 0.55

      if (fillAlpha > 0.01) {
        const bgR = 0x0f, bgG = 0x17, bgB = 0x2a
        const fgR = 0x22, fgG = 0xc5, fgB = 0x5e
        const erR = 0x64, erG = 0x74, erB = 0x8b

        // 底色 + 绿光叠加 + 边框
        const dotStrength = Math.max(core, glow)
        const finalR = Math.round(bgR + (fgR - bgR) * dotStrength + (erR - bgR) * edgeAlpha * (1 - dotStrength))
        const finalG = Math.round(bgG + (fgG - bgG) * dotStrength + (erG - bgG) * edgeAlpha * (1 - dotStrength))
        const finalB = Math.round(bgB + (fgB - bgB) * dotStrength + (erB - bgB) * edgeAlpha * (1 - dotStrength))
        const finalA = Math.round(Math.max(fillAlpha * 220, dotStrength * 255, edgeAlpha * 100))

        raw[o]     = Math.max(0, Math.min(255, finalR))
        raw[o + 1] = Math.max(0, Math.min(255, finalG))
        raw[o + 2] = Math.max(0, Math.min(255, finalB))
        raw[o + 3] = Math.max(0, Math.min(255, finalA))
      } else {
        raw[o] = raw[o + 1] = raw[o + 2] = raw[o + 3] = 0
      }
    }
  }

  const deflated = zlib.deflateSync(raw)

  function crc32(buf) {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) {
      c ^= buf[i]
      for (let j = 0; j < 8; j++) {
        c = (c & 1) ? ((c >>> 1) ^ 0xedb88320) : (c >>> 1)
      }
    }
    return (c ^ 0xffffffff) >>> 0
  }

  function makeChunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const typeB = Buffer.from(type, 'ascii')
    const crcData = Buffer.concat([typeB, data])
    const crcVal = Buffer.alloc(4)
    crcVal.writeUInt32BE(crc32(crcData), 0)
    return Buffer.concat([len, typeB, data, crcVal])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(W, 0)
  ihdr.writeUInt32BE(H, 4)
  ihdr[8] = 8  // bit depth
  ihdr[9] = 6  // color type: RGBA

  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), // PNG sig
    makeChunk('IHDR', ihdr),
    makeChunk('IDAT', deflated),
    makeChunk('IEND', Buffer.alloc(0)),
  ])

  return nativeImage.createFromBuffer(png, { width: W, height: H })
}

function createTray() {
  tray = new Tray(createTrayIcon())
  tray.setToolTip('CC Monitor')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏悬浮窗',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide()
        } else {
          mainWindow.show()
        }
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])

  tray.setContextMenu(contextMenu)
  tray.on('double-click', () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide()
    } else {
      mainWindow.show()
    }
  })
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

app.whenReady().then(() => {
  createWindow()
  createTray()
})

app.on('window-all-closed', () => {
  // 不退出，托盘保持运行
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
