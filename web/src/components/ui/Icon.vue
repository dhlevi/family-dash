<script setup lang="ts">
import { computed } from 'vue'
import { icons, type IconName } from './icons'

const props = withDefaults(
  defineProps<{
    name: IconName
    /** Pixel size; the icon is always square. */
    size?: number | string
    strokeWidth?: number
    /**
     * Fill colour. These are stroke-based outlines by default; filling one
     * with `currentColor` gives the solid form, which is how a toggle like
     * a favourite star shows that it is set.
     */
    fill?: string
  }>(),
  { size: 24, strokeWidth: 1.75, fill: 'none' }
)

const path = computed(() => icons[props.name])
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="fill"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
    class="shrink-0"
  >
    <path :d="path" />
  </svg>
</template>
