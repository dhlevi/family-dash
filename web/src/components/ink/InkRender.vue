<script setup lang="ts">
import { computed } from 'vue'
import { fittedViewBox, toSmoothPath } from '@/utils/ink'
import type { InkStroke } from '@/api/types'

/**
 * Draws handwriting as SVG.
 *
 * Strokes are stored in the coordinate space they were captured in, so a
 * viewBox of that size reproduces the writing at whatever size the note is
 * being shown at with no distortion and no rasterising.
 */
const props = withDefaults(
  defineProps<{
    strokes: InkStroke[]
    /** The surface the strokes were captured on. */
    surfaceWidth: number
    surfaceHeight: number
    /**
     * 'surface' shows the whole sheet, keeping the writing where it was put.
     * 'content' zooms to the writing itself, for small previews where the
     * empty paper would leave nothing legible.
     */
    fit?: 'surface' | 'content'
  }>(),
  { fit: 'surface' }
)

const viewBox = computed(() =>
  props.fit === 'content'
    ? fittedViewBox(props.strokes, props.surfaceWidth, props.surfaceHeight)
    : `0 0 ${props.surfaceWidth} ${props.surfaceHeight}`
)

const paths = computed(() =>
  props.strokes
    .map(stroke => ({ d: toSmoothPath(stroke.points), colour: stroke.colour, width: stroke.width }))
    .filter(path => path.d.length > 0)
)
</script>

<template>
  <svg :viewBox="viewBox" preserveAspectRatio="xMidYMid meet" class="size-full" aria-hidden="true" focusable="false">
    <path
      v-for="(path, index) in paths"
      :key="index"
      :d="path.d"
      :stroke="path.colour"
      :stroke-width="path.width"
      fill="none"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>
