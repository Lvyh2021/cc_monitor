import { defineStore } from 'pinia'
import { ref } from 'vue'

const POLL_INTERVAL = 2000 // 2 秒轮询

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

  let pollTimer = null

  async function refresh() {
    if (!window.ccMonitor) return
    try {
      const data = await window.ccMonitor.getSessions()
      // 过滤：隐藏 5 分钟前的已完成 session
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
    pollTimer = setInterval(refresh, POLL_INTERVAL)
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer)
      pollTimer = null
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

  return {
    sessions,
    expanded,
    refresh,
    startPolling,
    stopPolling,
    onMouseEnter,
    onMouseLeave,
  }
})
