<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'

/**
 * A fixed palette rather than a colour wheel.
 *
 * Calendar and note colours only need to be distinguishable at a glance
 * across a room, and these are chosen to stay legible on both themes. A
 * free colour picker on a kiosk mostly produces unreadable pastels.
 *
 * Callers can supply their own set — sticky notes use paper-like pastels
 * rather than these saturated calendar colours.
 */
const DEFAULT_PALETTE = [
  '#4f8ef7', // blue
  '#48b884', // green
  '#eda145', // amber
  '#e5484d', // red
  '#a855f7', // purple
  '#ec4899', // pink
  '#14b8a6', // teal
  '#8b7355' // brown
] as const

const props = withDefaults(defineProps<{ modelValue: string; palette?: readonly string[]; disabled?: boolean }>(), {
  palette: undefined,
  disabled: false
})

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const swatches = computed(() => props.palette ?? DEFAULT_PALETTE)
</script>

<template>
  <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
    <button
      v-for="colour in swatches"
      :key="colour"
      type="button"
      role="radio"
      :aria-checked="colour.toLowerCase() === modelValue.toLowerCase()"
      :aria-label="colour"
      :disabled="disabled"
      class="grid size-11 place-items-center rounded-full transition-transform duration-150 active:scale-95 disabled:opacity-50"
      :style="{ backgroundColor: colour }"
      @click="emit('update:modelValue', colour)"
    >
      <Icon
        v-if="colour.toLowerCase() === modelValue.toLowerCase()"
        name="check"
        :size="20"
        :stroke-width="3"
        class="text-white drop-shadow"
      />
    </button>
  </div>
</template>
