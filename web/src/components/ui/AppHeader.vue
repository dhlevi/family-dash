<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useClock } from '@/composables/useClock'
import { useSettingsStore } from '@/stores/settings'
import { useSystemStore } from '@/stores/system'
import { formatTime } from '@/utils/datetime'
import Icon from './Icon.vue'

/**
 * Title, clock and connection state.
 *
 * The clock is the thing a family dashboard gets glanced at for most often,
 * so it is the largest element in the header. The connection indicator only
 * appears when something is wrong — a permanent green dot teaches people to
 * stop seeing it.
 */
const route = useRoute()
const now = useClock()
const system = useSystemStore()
const settings = useSettingsStore()

const title = computed(() => route.meta?.title ?? 'Family Dashboard')

const dateFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

const time = computed(() => formatTime(now.value, settings.clock24Hour))
const date = computed(() => dateFormat.format(now.value))
</script>

<template>
  <header
    class="flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-5 py-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
  >
    <div class="min-w-0">
      <h1 class="truncate text-xl font-semibold text-ink">{{ title }}</h1>
      <p class="truncate text-sm text-muted">{{ date }}</p>
    </div>

    <div class="flex items-center gap-4">
      <button
        v-if="system.status !== 'ok'"
        type="button"
        class="flex items-center gap-2 rounded-card px-3 py-2 text-sm font-medium"
        :class="system.status === 'offline' ? 'bg-danger/15 text-danger' : 'bg-warn/15 text-warn'"
        :title="system.statusMessage"
        @click="system.refresh()"
      >
        <Icon :name="system.status === 'offline' ? 'offline' : 'warning'" :size="18" />
        <span class="hidden sm:inline">{{ system.statusLabel }}</span>
      </button>

      <time class="font-mono text-3xl leading-none font-semibold tabular-nums text-ink" :datetime="now.toISOString()">
        {{ time }}
      </time>
    </div>
  </header>
</template>
