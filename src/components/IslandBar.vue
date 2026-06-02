<template>
  <div
    class="island"
    :class="{ expanded: expandedStore }"
    @mouseenter="store.onMouseEnter()"
    @mouseleave="store.onMouseLeave()"
  >
    <!-- 折叠态：显示第一个 session -->
    <div v-if="!expandedStore" class="collapsed">
      <template v-if="store.sessions.length">
        <span class="mini-dot" :style="{ background: color }"></span>
        <span class="name">{{ name }}</span>
        <span class="state-badge" :style="{ color: color }">{{ label }}</span>
        <span v-if="store.sessions.length > 1" class="more">+{{ store.sessions.length - 1 }}</span>
      </template>
      <span v-else class="empty">No sessions</span>
    </div>

    <!-- 展开态 -->
    <div v-else class="expanded-list">
      <div class="header">CC Monitor</div>
      <SessionRow
        v-for="s in store.sessions"
        :key="s.sessionId"
        :session="s"
      />
      <div v-if="store.sessions.length === 0" class="empty-row">No active sessions</div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSessionsStore, useStateColor, useStateLabel } from '../stores/sessions'
import SessionRow from './SessionRow.vue'

const store = useSessionsStore()
const expandedStore = computed(() => store.expanded)

const first = computed(() => store.sessions[0])
const color = computed(() => first.value ? useStateColor(first.value.state) : '#94a3b8')
const label = computed(() => first.value ? useStateLabel(first.value.state) : '')
const name = computed(() => first.value ? (first.value.projectName || first.value.slug || '?') : '')
</script>

<style scoped>
.island {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(15, 23, 42, 0.85);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 16px;
  overflow: hidden;
  transition: width 0.35s ease, height 0.35s ease, border-radius 0.35s ease;
}

/* 折叠态 */
.collapsed {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 14px;
  white-space: nowrap;
}
.mini-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 6px currentColor;
}
.name {
  font-size: 13px;
  color: #e2e8f0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
.state-badge {
  font-size: 12px;
  flex-shrink: 0;
}
.more {
  font-size: 11px;
  color: #64748b;
  flex-shrink: 0;
  background: rgba(255,255,255,0.06);
  padding: 1px 6px;
  border-radius: 8px;
}
.empty {
  font-size: 12px;
  color: #64748b;
}

/* 展开态 */
.expanded {
  width: 400px;
  border-radius: 18px;
}
.header {
  font-size: 11px;
  color: #64748b;
  padding: 10px 14px 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.06);
  margin: 0 14px;
}
.list-body {
  padding: 4px 0 8px;
}
.empty-row {
  padding: 20px 14px;
  font-size: 12px;
  color: #64748b;
  text-align: center;
}
</style>
