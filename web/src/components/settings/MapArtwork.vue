<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { cityArtApi } from '@/api/cityArt'
import Field from '@/components/ui/Field.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import type { CityArt, CityArtOrientation, CityRegionInfo, MapThemeInfo } from '@/api/types'

/**
 * Settings for the screensaver's generated map artwork.
 *
 * The lists of themes and regions come from the API rather than being
 * repeated here, so adding a style is a change in one file and this page
 * picks it up. Empty selections mean "all of them", which keeps a fresh
 * install working without anybody having to tick two dozen boxes.
 */
const settings = useSettingsStore()

const themes = ref<MapThemeInfo[]>([])
const regions = ref<CityRegionInfo[]>([])
const artwork = ref<CityArt[]>([])
const loading = ref(true)
const drawing = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const chosenRegions = computed(() => settings.get('cityart.regions', []))
const chosenThemes = computed(() => settings.get('cityart.themes', []))
const poolSize = ref(12)
const orientation = ref<CityArtOrientation>('landscape')

const totalCities = computed(() =>
  regions.value
    .filter(region => chosenRegions.value.length === 0 || chosenRegions.value.includes(region.region))
    .reduce((total, region) => total + region.count, 0)
)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [themeList, regionList, pool] = await Promise.all([
      cityArtApi.themes(),
      cityArtApi.regions(),
      cityArtApi.pool(24)
    ])

    themes.value = themeList
    regions.value = regionList
    artwork.value = pool
    poolSize.value = settings.get('cityart.poolSize', 12)
    orientation.value = settings.get('cityart.orientation', 'landscape')
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the map artwork settings'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** Toggling the last one off would mean "all", which is never what was meant. */
function toggle(list: string[], value: string): string[] {
  return list.includes(value) ? list.filter(entry => entry !== value) : [...list, value]
}

async function toggleRegion(region: string): Promise<void> {
  await settings.set('cityart.regions', toggle([...chosenRegions.value], region))
}

async function toggleTheme(theme: string): Promise<void> {
  await settings.set('cityart.themes', toggle([...chosenThemes.value], theme))
}

/**
 * Draws one now.
 *
 * Worth having because the schedule is every few hours: without it, choosing
 * a style would mean waiting until tomorrow to find out whether you like it.
 */
async function drawOne(): Promise<void> {
  drawing.value = true
  error.value = null
  notice.value = null

  try {
    const outcome = await cityArtApi.generate()

    if (outcome.created) {
      notice.value = `Drew ${outcome.created.cityName} in ${outcome.created.themeName}`
      artwork.value = await cityArtApi.pool(24)
    } else {
      notice.value = outcome.reason ?? 'Nothing was drawn'
    }
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not draw a map'
  } finally {
    drawing.value = false
  }
}

async function remove(art: CityArt): Promise<void> {
  await cityArtApi.remove(art.id)
  artwork.value = artwork.value.filter(entry => entry.id !== art.id)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="flex justify-center py-6"><Spinner /></div>

    <template v-else>
      <p v-if="error" class="text-sm text-danger">{{ error }}</p>

      <Field
        label="Places"
        :hint="`Drawn from ${totalCities} ${totalCities === 1 ? 'place' : 'places'}. Nothing selected means everywhere.`"
      >
        <div class="flex flex-wrap gap-2">
          <button
            v-for="region in regions"
            :key="region.region"
            type="button"
            class="min-h-12 rounded-lg border px-3 text-sm transition-colors"
            :class="
              chosenRegions.includes(region.region)
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2'
            "
            :aria-pressed="chosenRegions.includes(region.region)"
            @click="toggleRegion(region.region)"
          >
            {{ region.label }}
            <span class="ml-1 text-faint">{{ region.count }}</span>
          </button>
        </div>
      </Field>

      <Field label="Styles" hint="Nothing selected means all of them.">
        <div class="flex flex-wrap gap-2">
          <button
            v-for="theme in themes"
            :key="theme.id"
            type="button"
            class="flex min-h-12 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
            :class="
              chosenThemes.includes(theme.id)
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2'
            "
            :aria-pressed="chosenThemes.includes(theme.id)"
            :title="theme.description"
            @click="toggleTheme(theme.id)"
          >
            <span class="size-4 shrink-0 rounded-full border border-line" :style="{ background: theme.background }" />
            {{ theme.name }}
          </button>
        </div>
      </Field>

      <Field label="Shape" hint="Match this to how the display is mounted, or the picture gets cropped to fit.">
        <SegmentedControl
          v-model="orientation"
          :options="[
            { value: 'landscape', label: 'Landscape' },
            { value: 'portrait', label: 'Portrait' }
          ]"
          block
          @update:model-value="settings.set('cityart.orientation', orientation)"
        />
      </Field>

      <Field label="Keep" hint="Older pictures are deleted as new ones are drawn.">
        <NumberStepper
          v-model="poolSize"
          :min="4"
          :max="60"
          :step="2"
          suffix="maps"
          @update:model-value="settings.set('cityart.poolSize', poolSize)"
        />
      </Field>

      <div class="flex items-center gap-3">
        <ToolButton
          icon="refresh"
          :label="drawing ? 'Drawing…' : 'Draw one now'"
          variant="primary"
          :disabled="drawing"
          @click="drawOne"
        />
        <p v-if="notice" class="text-sm text-muted">{{ notice }}</p>
      </div>

      <div v-if="artwork.length > 0" class="flex flex-col gap-2">
        <p class="text-sm font-medium text-muted">In rotation</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <figure
            v-for="art in artwork"
            :key="art.id"
            class="group relative overflow-hidden rounded-lg border border-line"
          >
            <img
              :src="art.thumbUrl"
              :alt="`${art.cityName}, drawn in the ${art.themeName} style`"
              loading="lazy"
              class="aspect-[8/5] w-full object-cover"
              :style="{ background: art.background }"
            />
            <figcaption class="flex items-center justify-between gap-2 px-2 py-1.5">
              <span class="min-w-0 truncate text-xs text-muted">{{ art.cityName }}</span>
              <ToolButton icon="trash" label="Delete" icon-only variant="danger" @click="remove(art)" />
            </figcaption>
          </figure>
        </div>
      </div>
    </template>
  </div>
</template>
