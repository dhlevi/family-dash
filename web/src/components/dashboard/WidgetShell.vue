<script setup lang="ts">
import { RouterLink } from 'vue-router'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import type { IconName } from '@/components/ui/icons'

/**
 * Frame for a dashboard widget: a title row that links through to the full
 * page, and a body that scrolls independently.
 *
 * Each widget owns its own loading and error state rather than the dashboard
 * gating on all of them.
 */
defineProps<{
  title: string
  icon: IconName
  /** Route the title row links to. */
  to: string
  loading?: boolean
  error?: string | null
  /** Short status shown next to the title, e.g. a count or "cached". */
  badge?: string | null
}>()
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface"
    :aria-label="title"
  >
    <RouterLink
      :to="to"
      class="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3 transition-colors hover:bg-surface-2 active:bg-surface-3"
    >
      <Icon :name="icon" :size="20" class="text-accent" />
      <h2 class="min-w-0 flex-1 truncate text-sm font-semibold tracking-wide text-ink uppercase">{{ title }}</h2>

      <Spinner v-if="loading" :size="16" />
      <span v-else-if="badge" class="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
        {{ badge }}
      </span>
      <Icon name="chevronRight" :size="18" class="text-faint" />
    </RouterLink>

    <div class="fd-scroll flex min-h-0 flex-1 flex-col">
      <div v-if="error" class="flex flex-1 items-center gap-2 px-4 py-6 text-sm text-danger">
        <Icon name="warning" :size="18" />
        <span class="min-w-0">{{ error }}</span>
      </div>
      <slot v-else />
    </div>
  </section>
</template>
