import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

const POLL_INTERVAL = 2000 // 2 秒轮询
const DEEPSEEK_INTERVAL = 30000 // 30 秒轮询

export const useStateColor = (state) => {
  const map = {
    working:   '#22c55e',
    awaiting:  '#eab308',
    idle:      '#94a3b8',
    completed: '#3b82f6',
    error:     '#ef4444',
  }
  return map[state] || '#94a3b8'
}

export const useStateLabel = (state) => {
  const map = {
    working:   '工作中',
    awaiting:  '待确认',
    idle:      '空闲',
    completed: '已完成',
    error:     '错误',
  }
  return map[state] || state
}

export const useSessionsStore = defineStore('sessions', () => {
  const sessions = ref([])
  const expanded = ref(false)
  const hoverTimer = ref(null)
  const deepseekStatus = ref({ balance: null, cost: null })
  const config = ref({ apiKey: '', platformToken: '', platformCookies: '' })

  let pollTimer = null
  let deepseekTimer = null

  async function loadSettings() {
    if (!window.ccMonitor) return
    try {
      const cfg = await window.ccMonitor.getConfig()
      if (cfg) {
        config.value.apiKey = cfg.apiKey || ''
        config.value.platformToken = cfg.platformToken || ''
        config.value.platformCookies = cfg.platformCookies || ''
      }
    } catch (e) { console.error('loadConfig error:', e) }
  }

  async function saveSettings() {
    if (!window.ccMonitor) return
    try {
      await window.ccMonitor.saveConfig({
        apiKey: config.value.apiKey,
        platformToken: config.value.platformToken,
        platformCookies: config.value.platformCookies,
      })
      // 保存后立即刷新余额
      pollDeepseek()
    } catch (e) { console.error('saveConfig error:', e) }
  }

  async function refresh() {
    if (!window.ccMonitor) return
    try {
      const data = await window.ccMonitor.getSessions()
      const now = Date.now()
      sessions.value = data.filter(s => {
        if (s.state === 'completed') {
          return (now - new Date(s.lastTimestamp).getTime()) < 5 * 60 * 1000
        }
        return true
      })
    } catch (e) {
      console.error('getSessions error:', e)
    }
  }

  function startPolling() {
    refresh()
    loadSettings().then(() => pollDeepseek())
    pollTimer = setInterval(refresh, POLL_INTERVAL)
    deepseekTimer = setInterval(pollDeepseek, DEEPSEEK_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
    }
    if (deepseekTimer) {
      clearInterval(deepseekTimer)
      deepseekTimer = null
    }
  }

  async function pollDeepseek() {
    if (!window.ccMonitor) return
    try {
      deepseekStatus.value = await window.ccMonitor.getDeepseekStatus()
    } catch (e) {
      console.error('getDeepseekStatus error:', e)
    }
  }

  function onMouseEnter() {
    clearTimeout(hoverTimer.value)
    hoverTimer.value = setTimeout(() => { expanded.value = true }, 600)
  }

  function onMouseLeave() {
    clearTimeout(hoverTimer.value)
    hoverTimer.value = setTimeout(() => { expanded.value = false }, 500)
  }

  // 折叠/展开时动态调整窗口大小，避免折叠态透明区域阻挡点击
  watch(expanded, (val) => {
    if (val) {
      window.ccMonitor?.resizeWindow(420, 300)
    } else {
      window.ccMonitor?.resizeWindow(300, 36)
    }
  }, { flush: 'post' })

  return {
    sessions,
    expanded,
    deepseekStatus,
    config,
    loadSettings,
    saveSettings,
    refresh,
    startPolling,
    stopPolling,
    onMouseEnter,
    onMouseLeave,
  }
})
