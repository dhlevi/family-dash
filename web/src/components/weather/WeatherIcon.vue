<script setup lang="ts">
import { computed, useId } from 'vue'
import { conditionFor } from '@/utils/weather'

/**
 * The picture of the sky.
 *
 * Composed from a few parts — a disc for sun or moon, a cloud, and
 * precipitation marks — rather than a separate drawing per condition. That
 * keeps twelve conditions to three shapes, and means a night-time variant is
 * a swap of one element rather than a second icon set.
 *
 * Colour comes from the condition, not the theme: a yellow sun and a grey
 * cloud read correctly on both, and the whole point of the icon is to be
 * identifiable from across a room.
 */
const props = withDefaults(
  defineProps<{
    code: number
    isDay?: boolean
    size?: number | string
  }>(),
  { isDay: true, size: 48 }
)

/**
 * A unique id per instance, because the night moon is cut with an SVG mask
 * and several icons share a page — a reused id would make every moon take
 * the first one's shape.
 */
const maskId = useId()

const kind = computed(() => conditionFor(props.code).kind)
const label = computed(() => conditionFor(props.code).label)

/** Whether a sun or moon shows at all, and whether a cloud partly covers it. */
const disc = computed(() => kind.value === 'clear' || kind.value === 'partly-cloudy')
const cloud = computed(() => kind.value !== 'clear')
const offsetDisc = computed(() => kind.value === 'partly-cloudy')

const precipitation = computed<'none' | 'drizzle' | 'rain' | 'snow' | 'showers' | 'sleet'>(() => {
  switch (kind.value) {
    case 'drizzle':
      return 'drizzle'
    case 'rain':
      return 'rain'
    case 'showers':
      return 'showers'
    case 'snow':
      return 'snow'
    case 'freezing':
      return 'sleet'
    default:
      return 'none'
  }
})

const SUN = '#f5b428'
const MOON = '#cfd8ec'
const CLOUD = '#9aa7bd'
const CLOUD_DARK = '#7d8ba3'
const RAIN = '#5aa9e6'
const SNOW = '#cfe8f5'
const BOLT = '#f5c518'
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 64 64" fill="none" role="img" :aria-label="label">
    <!-- Sun or moon. Shifted up-left when a cloud overlaps it. -->
    <g v-if="disc" :transform="offsetDisc ? 'translate(-6 -5)' : ''">
      <template v-if="isDay">
        <circle cx="32" cy="26" r="10" :fill="SUN" />
        <g :stroke="SUN" stroke-width="3" stroke-linecap="round">
          <path
            d="M32 8v4M32 40v4M14 26h4M46 26h4M19.5 13.5l2.8 2.8M41.7 35.7l2.8 2.8M44.5 13.5l-2.8 2.8M22.3 35.7l-2.8 2.8"
          />
        </g>
      </template>
      <!--
        A crescent, cut by masking an offset disc out of a full one. Drawn
        with a mask rather than a hand-written path so it sits centred and at
        the same visual weight as the sun — an off-centre sliver reads as a
        smudge rather than a moon.
      -->
      <template v-else>
        <mask :id="maskId">
          <rect x="0" y="0" width="64" height="64" fill="white" />
          <circle cx="44" cy="16" r="15" fill="black" />
        </mask>
        <!--
          Larger than the sun's disc on purpose: the sun carries rays out to
          the edge of the box, so a moon of the same radius reads as much
          lighter beside it.
        -->
        <circle cx="32" cy="27" r="14" :fill="MOON" :mask="`url(#${maskId})`" />
      </template>
    </g>

    <!-- Cloud -->
    <path
      v-if="cloud"
      d="M20 44a9 9 0 0 1-.8-17.9 13 13 0 0 1 24.9 3.2A8.5 8.5 0 0 1 44 44z"
      :fill="kind === 'thunderstorm' || kind === 'cloudy' ? CLOUD_DARK : CLOUD"
    />

    <!-- Fog: bars under the cloud instead of falling precipitation. -->
    <g v-if="kind === 'fog'" :stroke="CLOUD_DARK" stroke-width="3" stroke-linecap="round">
      <path d="M16 51h32M20 58h24" />
    </g>

    <!-- Rain and drizzle: short strokes, longer and denser for heavier rain. -->
    <g
      v-else-if="precipitation === 'drizzle' || precipitation === 'rain' || precipitation === 'showers'"
      :stroke="RAIN"
      :stroke-width="precipitation === 'drizzle' ? 2.5 : 3"
      stroke-linecap="round"
    >
      <path v-if="precipitation === 'drizzle'" d="M24 49l-2 5M32 49l-2 5M40 49l-2 5" />
      <path v-else-if="precipitation === 'rain'" d="M22 48l-3 9M31 48l-3 9M40 48l-3 9" />
      <path v-else d="M24 48l-3 9M36 48l-3 9" />
    </g>

    <!-- Snow: six-pointed marks rather than strokes. -->
    <g v-else-if="precipitation === 'snow'" :stroke="SNOW" stroke-width="2.5" stroke-linecap="round">
      <path d="M23 52v6M20 53.5l6 3M26 53.5l-6 3" />
      <path d="M41 52v6M38 53.5l6 3M44 53.5l-6 3" />
    </g>

    <!-- Sleet and freezing rain: a stroke and a mark, mixed. -->
    <g v-else-if="precipitation === 'sleet'" stroke-linecap="round">
      <path d="M23 48l-3 9" :stroke="RAIN" stroke-width="3" />
      <path d="M40 52v6M37 53.5l6 3M43 53.5l-6 3" :stroke="SNOW" stroke-width="2.5" />
    </g>

    <!-- Thunderstorm: a bolt, plus rain behind it. -->
    <template v-if="kind === 'thunderstorm'">
      <path d="M24 47l-3 8h4l-3 8" :stroke="RAIN" stroke-width="3" stroke-linecap="round" />
      <path d="M36 46l-6 10h5l-3 8 9-12h-5l3-6z" :fill="BOLT" />
    </template>
  </svg>
</template>
