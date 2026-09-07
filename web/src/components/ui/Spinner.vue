<script setup lang="ts">
withDefaults(defineProps<{ size?: number; label?: string }>(), { size: 24, label: 'Loading' })
</script>

<template>
  <span class="inline-flex items-center gap-2 text-muted" role="status" :aria-label="label">
    <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" class="animate-spin" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" class="opacity-20" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
    <slot />
  </span>
</template>
