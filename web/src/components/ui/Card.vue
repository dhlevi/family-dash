<script setup lang="ts">
/**
 * The surface every panel and dashboard widget sits on.
 *
 * `interactive` adds a press state, used where the whole card is a tap
 * target (a dashboard widget that navigates to its page).
 */
withDefaults(
  defineProps<{
    interactive?: boolean
    padded?: boolean
  }>(),
  { interactive: false, padded: true }
)
</script>

<template>
  <div
    class="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-card border border-line bg-surface"
    :class="[
      padded ? 'p-4' : '',
      interactive ? 'cursor-pointer transition-colors duration-150 hover:border-line-strong active:bg-surface-2' : ''
    ]"
  >
    <slot />
  </div>
</template>
