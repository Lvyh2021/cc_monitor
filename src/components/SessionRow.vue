<template>
  <div class="session-row" :style="{ '--dot-color': color }">
    <span class="dot" :style="{ background: color }"></span>
    <span class="name">{{ displayName }}</span>
    <span class="state" :style="{ color }">{{ label }}</span>
    <span class="time">{{ timeStr }}</span>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useStateColor, useStateLabel } from '../stores/sessions'

const props = defineProps({
  session: Object,
})

const color = computed(() => useStateColor(props.session.state))
const label = computed(() => useStateLabel(props.session.state))

const displayName = computed(() => {
  return props.session.projectName || props.session.slug || '?'
})

const timeStr = computed(() => {
  try {
    const d = new Date(props.session.lastTimestamp)
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
})
</script>

<style scoped>
.session-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  transition: transform 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94),
              background 0.2s ease;
  cursor: default;
}
.session-row:hover {
  background: rgba(255, 255, 255, 0.06);
}
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  transition: background 0.3s ease;
  box-shadow: 0 0 6px var(--dot-color);
}
.name {
  flex: 1;
  font-size: 13px;
  color: #e2e8f0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state {
  font-size: 11px;
  flex-shrink: 0;
  transition: color 0.3s ease;
}
.time {
  font-size: 11px;
  color: #64748b;
  flex-shrink: 0;
}
</style>
