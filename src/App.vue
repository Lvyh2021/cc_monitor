<template>
  <IslandBar />
</template>

<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useSessionsStore } from './stores/sessions'
import IslandBar from './components/IslandBar.vue'

const store = useSessionsStore()

onMounted(() => {
  store.startPolling()
})

onUnmounted(() => {
  store.stopPolling()
})
</script>
