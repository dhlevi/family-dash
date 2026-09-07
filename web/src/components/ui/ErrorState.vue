<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * Shown when a panel's data could not be loaded. Always offers a retry —
 * most failures on a Pi are a momentary network blip.
 */
defineProps<{ message: string; retrying?: boolean }>()
defineEmits<{ retry: [] }>()
</script>

<template>
  <div class="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
    <span class="rounded-full bg-danger/15 p-3 text-danger">
      <Icon name="warning" :size="28" />
    </span>
    <p class="max-w-sm text-sm text-muted">{{ message }}</p>
    <button
      type="button"
      class="mt-1 flex min-h-touch items-center gap-2 rounded-card border border-line px-4 font-medium text-ink transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
      :disabled="retrying"
      @click="$emit('retry')"
    >
      <Icon name="refresh" :size="18" />
      {{ retrying ? 'Retrying…' : 'Try again' }}
    </button>
  </div>
</template>
