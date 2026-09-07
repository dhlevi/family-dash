<script setup lang="ts">
import Icon from './Icon.vue'
import type { IconName } from './icons'

/**
 * The "nothing here yet" panel.
 *
 * Deliberately says what to do next rather than only that something is
 * absent: on a shared display, whoever is looking at it is often not the
 * person who set it up.
 */
defineProps<{
  icon: IconName
  title: string
  description?: string
}>()
</script>

<template>
  <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
    <span class="rounded-full bg-surface-2 p-3 text-faint">
      <Icon :name="icon" :size="28" />
    </span>
    <p class="text-base font-medium text-muted">{{ title }}</p>
    <p v-if="description" class="max-w-sm text-sm text-faint">{{ description }}</p>
    <div class="mt-1">
      <slot />
    </div>
  </div>
</template>
