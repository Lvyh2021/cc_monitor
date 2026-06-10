const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

// ── 透明灵动岛窗口 ──────────────────────────────────────────────────────────
let mainWindow = null
let tray = null
let isQuitting = false

function createWindow() {
  const { width: screenW } = require('electron').screen.getPrimaryDisplay().workAreaSize

  // 初始用折叠态尺寸（300x36），展开时通过 IPC 动态调整为 420x300
  const W = 300, H = 36

  mainWindow = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round((screenW - W) / 2),
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

function createSettingsWindow() {
  const cfg = loadConfig()
  const curApiKey = (cfg.apiKey || '').replace(/"/g, '&quot;')
  const curHeaders = cfg.platformToken
    ? `{"authorization": "Bearer ${cfg.platformToken}"}`
    : ''
  const curCookies = cfg.platformCookies
    ? '{' + cfg.platformCookies.split('; ').map(p => { const i = p.indexOf('='); return i > 0 ? `"${p.slice(0,i)}": "${p.slice(i+1)}"` : '' }).filter(Boolean).join(', ') + '}'
    : ''

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1e293b;color:#e2e8f0;padding:20px}
h2{font-size:16px;margin-bottom:4px}
.desc{font-size:11px;color:#64748b;margin-bottom:16px}
.row{margin-bottom:12px}
.row label{display:block;font-size:12px;color:#94a3b8;margin-bottom:4px}
.row input,.row textarea{width:100%;background:#0f172a;border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:8px 10px;color:#e2e8f0;font-size:12px;font-family:monospace;outline:none}
.row textarea{resize:vertical;min-height:80px}
.row input:focus,.row textarea:focus{border-color:#4ade80}
.btn{font-size:12px;padding:6px 16px;border-radius:8px;cursor:pointer;border:none}
.btn-parse{background:#334155;color:#e2e8f0;margin-top:8px}
.btn-parse:hover{background:#475569}
.preview{background:#0f172a;border-radius:8px;padding:10px;font-size:11px;font-family:monospace;color:#94a3b8;margin:12px 0;max-height:100px;overflow-y:auto;white-space:pre-wrap;word-break:break-all}
.actions{display:flex;gap:8px;justify-content:flex-end;margin-top:16px}
.btn-cancel{background:rgba(255,255,255,.06);color:#94a3b8}
.btn-save{background:#16a34a;color:#fff}
.btn-save:hover{background:#15803d}
.success{color:#4ade80;font-size:12px;margin-left:12px}
</style></head><body>
<h2>DeepSeek API 配置</h2>
<p class="desc">粘贴 headers 和 cookies 字典，自动提取所需信息</p>
<div class="row">
  <label>余额 API Key</label>
  <input id="apiKey" type="password" placeholder="sk-..." value="${curApiKey}">
</div>
<div class="row">
  <label>Headers（粘贴 headers 字典）</label>
  <textarea id="rawHeaders" placeholder='{"authorization": "Bearer xxx", "user-agent": "..."}'>${curHeaders}</textarea>
</div>
<div class="row">
  <label>Cookies（粘贴 cookies 字典）</label>
  <textarea id="rawCookies" placeholder='{"intercom-device-id-guh50jw4": "xxx", "cf_clearance": "yyy"}'>${curCookies}</textarea>
</div>
<button class="btn btn-parse" onclick="parse()">自动解析</button>
<div class="preview" id="preview" style="display:none"></div>
<div class="actions">
  <button class="btn btn-cancel" onclick="close()">取消</button>
  <button class="btn btn-save" onclick="save()">保存</button>
  <span class="success" id="msg"></span>
</div>
<script>
const {ipcRenderer} = require('electron')
function tryParseJSON(text) {
  // 先尝试标准 JSON
  try { return JSON.parse(text) } catch(e) {}
  // 去掉尾部逗号再试（JSON5/Python 风格）
  const fixed = text.replace(/,(\\s*[}\\]])/g, '$1')
  try { return JSON.parse(fixed) } catch(e) {}
  // 单引号 → 双引号，再试
  const fixed2 = fixed.replace(/'/g, '"')
  try { return JSON.parse(fixed2) } catch(e) {}
  return null
}
function parse() {
  const hdrRaw = document.getElementById('rawHeaders').value.trim()
  const ckRaw = document.getElementById('rawCookies').value.trim()
  let auth = ''
  let cookieStr = ''
  // 解析 headers：找 authorization 或 Authorization
  const hdrObj = tryParseJSON(hdrRaw) || {}
  for (const [k, v] of Object.entries(hdrObj)) {
    if (k.toLowerCase() === 'authorization') {
      auth = v.replace(/^Bearer\\s*/i, '')
      break
    }
  }
  // 解析 cookies
  const ckObj = tryParseJSON(ckRaw) || {}
  cookieStr = Object.entries(ckObj).map(([k, v]) => k + '=' + v).join('; ')
  const prev = document.getElementById('preview')
  prev.style.display = 'block'
  prev.textContent = 'Authorization Bearer: ' + (auth ? auth.slice(0,20) + '...' : '(未解析到)') + '\\nCookies: ' + (cookieStr ? cookieStr.slice(0,100) + (cookieStr.length>100?'...':'') : '(未解析到)')
  window._parsed = { auth, cookies: cookieStr }
}
function save() {
  const data = {
    apiKey: document.getElementById('apiKey').value.trim(),
    platformToken: window._parsed ? window._parsed.auth : '',
    platformCookies: window._parsed ? window._parsed.cookies : '',
  }
  ipcRenderer.invoke('save-config', data).then(() => {
    document.getElementById('msg').textContent = '已保存'
  })
}
function close() { window.close() }
window.onload = () => { if (document.getElementById('rawHeaders').value) parse() }
</script></body></html>`

  const win = new BrowserWindow({
    width: 560, height: 580,
    resizable: false,
    title: 'CC Monitor — DeepSeek 设置',
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  })
  win.setMenuBarVisibility(false)
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
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
    {
      label: 'DeepSeek 设置',
      click: () => { createSettingsWindow() },
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

ipcMain.handle('resize-window', (_, { width, height }) => {
  if (!mainWindow || mainWindow.isDestroyed()) return

  const screen = require('electron').screen
  const screenW = screen.getPrimaryDisplay().workAreaSize.width
  const newX = Math.round((screenW - width) / 2)

  mainWindow.setBounds({ x: newX, y: 12, width, height })
})

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

// ── 配置文件 ─────────────────────────────────────────────────────────────────
const CONFIG_PATH = path.join(app.getPath('userData'), 'config.json')

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'))
    }
  } catch (e) { console.error('[config] load error:', e.message) }
  return {}
}

function saveConfig(data) {
  try { fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2), 'utf-8') }
  catch (e) { console.error('[config] save error:', e.message) }
}

// ── DeepSeek 余额 & 消费 ────────────────────────────────────────────────────
async function fetchDeepSeekStatus(apiKey, cookies, authToken) {
  const https = require('https')

  if (!apiKey) {
    return { balance: null, cost: null, error: 'DEEPSEEK_API_KEY not set' }
  }

  console.log('[deepseek] fetching with key:', apiKey.slice(0, 8) + '...')

  const get = (url, headers) => new Promise((resolve, reject) => {
    https.get(url, { headers }, res => {
      let body = ''
      res.on('data', d => body += d)
      res.on('end', () => {
        try { resolve(JSON.parse(body)) }
        catch { reject(new Error(body)) }
      })
    }).on('error', reject)
  })

  let balance = null, cost = null

  // 1. 余额
  try {
    balance = await get('https://api.deepseek.com/user/balance', {
      'Accept': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    })
    console.log('[deepseek] balance fetched:', JSON.stringify(balance).slice(0, 150))
  } catch (e) { balance = { error: e.message }; console.error('[deepseek] balance error:', e.message) }

  // 2. 本月消费（需 cookies + authToken）
  if (cookies && authToken) {
    const now = new Date()
    try {
      const data = await get(
        `https://platform.deepseek.com/api/v0/usage/cost?month=${now.getMonth() + 1}&year=${now.getFullYear()}`,
        {
          'Accept': 'application/json',
          'Authorization': `Bearer ${authToken}`,
          'Cookie': cookies,
          'User-Agent': 'Mozilla/5.0',
        }
      )
      if (data.code === 0 && data.data?.biz_data?.[0]) {
        const biz = data.data.biz_data[0]
        // 月度总计
        let monthTotal = 0
        for (const m of biz.total) {
          for (const u of m.usage) monthTotal += parseFloat(u.amount)
        }
        // 今日
        const today = now.toISOString().slice(0, 10)
        const todayEntry = biz.days?.find(d => d.date === today)
        let todayTotal = 0
        if (todayEntry) {
          for (const m of todayEntry.data) {
            for (const u of m.usage) todayTotal += parseFloat(u.amount)
          }
        }
        cost = { month: +monthTotal.toFixed(2), today: +todayTotal.toFixed(2) }
      }
      console.log('[deepseek] cost fetched:', cost)
  } catch (e) { cost = { error: e.message }; console.error('[deepseek] cost error:', e.message) }
  }

  const result = { balance, cost }
  console.log('[deepseek] result:', JSON.stringify(result).slice(0, 200))
  return result
}

ipcMain.handle('get-deepseek-status', async () => {
  const cfg = loadConfig()
  return await fetchDeepSeekStatus(cfg.apiKey, cfg.platformCookies, cfg.platformToken)
})

ipcMain.handle('get-config', () => {
  return loadConfig()
})

ipcMain.handle('save-config', (_, data) => {
  saveConfig(data)
  return { ok: true }
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
