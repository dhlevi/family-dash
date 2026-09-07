<script setup lang="ts">
import Icon from './Icon.vue'

/**
 * Numeric entry with large plus/minus targets.
 *
 * A native number input's spinners are a few pixels tall and effectively
 * unusable with a finger, so the buttons do the work and the field stays
 * readable.
 */
const props = withDefaults(
  defineProps<{
    modelValue: number
    min?: number
    max?: number
    step?: number
    suffix?: string
    disabled?: boolean
  }>(),
  { min: 0, max: 999, step: 1, suffix: undefined, disabled: false }
)

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()

function clamp(value: number): number {
  return Math.min(Math.max(value, props.min), props.max)
}

function nudge(direction: 1 | -1): void {
  emit('update:modelValue', clamp(props.modelValue + direction * props.step))
}

function onInput(event: Event): void {
  const parsed = Number((event.target as HTMLInputElement).value)
  if (!Number.isNaN(parsed)) emit('update:modelValue', clamp(parsed))
}
</script>

<template>
  <div class="inline-flex items-stretch overflow-hidden rounded-card border border-line bg-surface-2">
    <button
      type="button"
      class="grid w-12 place-items-center text-muted transition-colors hover:bg-surface-3 active:bg-surface-3 disabled:opacity-40"
      aria-label="Decrease"
      :disabled="disabled || modelValue <= min"
      @click="nudge(-1)"
    >
      <Icon name="close" :size="16" class="rotate-45" />
    </button>

    <div class="flex min-h-touch items-center gap-1 px-2">
      <input
        :value="modelValue"
        type="text"
        inputmode="numeric"
        :disabled="disabled"
        class="w-14 bg-transparent text-center text-base font-medium tabular-nums text-ink focus:outline-none"
        @input="onInput"
      />
      <span v-if="suffix" class="text-sm text-faint">{{ suffix }}</span>
    </div>

    <button
      type="button"
      class="grid w-12 place-items-center text-muted transition-colors hover:bg-surface-3 active:bg-surface-3 disabled:opacity-40"
      aria-label="Increase"
      :disabled="disabled || modelValue >= max"
      @click="nudge(1)"
    >
      <Icon name="plus" :size="16" />
    </button>
  </div>
</template>
