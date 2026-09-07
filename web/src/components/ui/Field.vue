<script setup lang="ts">
/**
 * Label, optional hint and validation message around a control. Keeps
 * spacing and the hint/error hierarchy identical across every form.
 */
defineProps<{
  label: string
  hint?: string
  error?: string | null
  /** Links the label to the control; pass the same id to the input. */
  for?: string
}>()
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label :for="$props.for" class="text-sm font-medium text-muted">{{ label }}</label>
    <slot />
    <p v-if="error" class="text-xs text-danger">{{ error }}</p>
    <p v-else-if="hint" class="text-xs text-faint">{{ hint }}</p>
  </div>
</template>
