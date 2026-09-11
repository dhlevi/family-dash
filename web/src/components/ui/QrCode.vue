<script setup lang="ts">
import { computed } from 'vue'
import qrcode from 'qrcode-generator'

/**
 * A QR code, drawn as SVG.
 *
 * The point of this on a wall display is that the app is *already* reachable
 * from every phone on the home wifi, there is just no obvious way to get
 * the address onto one. A QR turns "what's the Pi's IP again?" into pointing
 * a camera at the screen.
 *
 * Rendered as a single SVG path rather than a grid of rects: a few hundred
 * rects is a lot of DOM for a Raspberry Pi to lay out, and one path scales
 * just as crisply.
 */
const props = withDefaults(
  defineProps<{
    value: string
    /** Rendered size in pixels. */
    size?: number
    /** Quiet zone in modules. The spec asks for 4; less can fail to scan. */
    margin?: number
  }>(),
  { size: 200, margin: 4 }
)

const code = computed(() => {
  // Type 0 lets the library pick the smallest version that fits. Error
  // correction M survives a bit of glare on a wall-mounted screen.
  const qr = qrcode(0, 'M')
  qr.addData(props.value)
  qr.make()
  return qr
})

const moduleCount = computed(() => code.value.getModuleCount())
const viewBoxSize = computed(() => moduleCount.value + props.margin * 2)

const path = computed(() => {
  const parts: string[] = []

  for (let row = 0; row < moduleCount.value; row++) {
    for (let column = 0; column < moduleCount.value; column++) {
      if (!code.value.isDark(row, column)) continue
      parts.push(`M${column + props.margin} ${row + props.margin}h1v1h-1z`)
    }
  }

  return parts.join('')
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    :viewBox="`0 0 ${viewBoxSize} ${viewBoxSize}`"
    shape-rendering="crispEdges"
    role="img"
    :aria-label="`QR code for ${value}`"
  >
    <!-- Always black on white, whatever the theme: a scanner needs the
         contrast, and inverted codes are unreliable on some cameras. -->
    <rect :width="viewBoxSize" :height="viewBoxSize" fill="#ffffff" />
    <path :d="path" fill="#000000" />
  </svg>
</template>
