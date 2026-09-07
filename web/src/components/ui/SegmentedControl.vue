<script setup lang="ts" generic="T extends string | number">
/**
 * A row of mutually exclusive choices.
 *
 * Preferred over a native select for short option lists: everything is
 * visible and one tap away, where a select costs a tap plus a platform
 * dropdown that is awkward on a kiosk.
 */
defineProps<{
  modelValue: T
  options: Array<{ value: T; label: string }>
  disabled?: boolean
  /** Fill the available width instead of hugging the labels. */
  block?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()
</script>

<template>
  <div
    class="inline-flex gap-1 rounded-card border border-line bg-surface-2 p-1"
    :class="block ? 'flex w-full' : ''"
    role="radiogroup"
  >
    <button
      v-for="option in options"
      :key="String(option.value)"
      type="button"
      role="radio"
      :aria-checked="option.value === modelValue"
      :disabled="disabled"
      class="min-h-11 rounded-[0.625rem] px-3.5 text-sm font-medium transition-colors duration-150 disabled:opacity-50"
      :class="[
        block ? 'flex-1' : '',
        option.value === modelValue ? 'bg-accent text-accent-ink' : 'text-muted hover:bg-surface-3 hover:text-ink'
      ]"
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>
