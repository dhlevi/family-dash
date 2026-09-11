<script setup lang="ts">
/**
 * Standard page frame: a fixed toolbar row and one scrolling body.
 * Every page uses this so scrolling behaves identically everywhere
 */
withDefaults(defineProps<{ padded?: boolean }>(), { padded: true })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="$slots.toolbar" class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <slot name="toolbar" />
    </div>

    <div class="fd-scroll min-h-0 flex-1" :class="padded ? 'p-4' : ''">
      <slot />
    </div>
  </div>
</template>
