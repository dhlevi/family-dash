<script setup lang="ts">
/**
 * On/off switch. The whole row is the target, so it can be hit without
 * aiming at the switch itself.
 */
const props = defineProps<{
  modelValue: boolean
  label: string
  hint?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="modelValue"
    :disabled="disabled"
    class="flex min-h-touch w-full items-center gap-4 rounded-card px-1 text-left transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
    @click="emit('update:modelValue', !props.modelValue)"
  >
    <span class="min-w-0 flex-1">
      <span class="block text-sm font-medium text-ink">{{ label }}</span>
      <span v-if="hint" class="block text-xs text-faint">{{ hint }}</span>
    </span>

    <span
      class="relative h-7 w-12 shrink-0 rounded-full transition-colors duration-150"
      :class="modelValue ? 'bg-accent' : 'bg-surface-3'"
    >
      <span
        class="absolute top-1 size-5 rounded-full bg-white shadow transition-all duration-150"
        :class="modelValue ? 'left-6' : 'left-1'"
      />
    </span>
  </button>
</template>
