<script setup lang="ts">
import { ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { weatherApi } from '@/api/weather'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import type { GeocodeResult } from '@/api/types'

/**
 * Setting the forecast location by searching for it.
 *
 * Typing latitude and longitude is a poor ask of anyone setting up a kitchen
 * display, and getting a digit wrong gives a plausible forecast for the
 * wrong place. Search is free and keyless through the same provider that
 * gives the forecast, so there is no reason to make somebody look their
 * coordinates up.
 *
 * The coordinates stay visible and editable underneath — for anywhere the
 * gazetteer does not know, and so it is clear what was actually saved.
 */
const props = defineProps<{
  name: string
  latitude: number
  longitude: number
  saving?: boolean
}>()

const emit = defineEmits<{
  select: [location: { name: string; latitude: number; longitude: number }]
}>()

const query = ref('')
const results = ref<GeocodeResult[]>([])
const searching = ref(false)
const searched = ref(false)
const error = ref<string | null>(null)

// Manual entry, mirrored from props so edits are local until saved.
const manualName = ref(props.name)
const manualLatitude = ref(String(props.latitude))
const manualLongitude = ref(String(props.longitude))
const showManual = ref(false)

async function search(): Promise<void> {
  const term = query.value.trim()
  if (term.length < 2) return

  searching.value = true
  error.value = null

  try {
    results.value = await weatherApi.search(term)
    searched.value = true
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not search for that place'
  } finally {
    searching.value = false
  }
}

function choose(result: GeocodeResult): void {
  emit('select', {
    name: result.name,
    latitude: result.latitude,
    longitude: result.longitude
  })

  query.value = ''
  results.value = []
  searched.value = false
}

function saveManual(): void {
  const latitude = Number(manualLatitude.value)
  const longitude = Number(manualLongitude.value)

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    error.value = 'Latitude and longitude must be numbers'
    return
  }

  error.value = null
  emit('select', { name: manualName.value.trim() || 'Home', latitude, longitude })
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <!-- What is set now -->
    <div class="flex items-center gap-3 rounded-card bg-surface-2 px-3 py-2.5">
      <Icon name="weather" :size="20" class="shrink-0 text-accent" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink">{{ name }}</p>
        <p class="font-mono text-xs text-faint tabular-nums">{{ latitude.toFixed(4) }}, {{ longitude.toFixed(4) }}</p>
      </div>
    </div>

    <Field label="Change location" for="location-search" hint="Search for a town or city">
      <div class="flex gap-2">
        <TextInput
          id="location-search"
          v-model="query"
          type="search"
          placeholder="Vancouver"
          :disabled="saving"
          @enter="search"
        />
        <ToolButton
          icon="chevronRight"
          label="Search"
          :disabled="query.trim().length < 2 || searching"
          @click="search"
        />
      </div>
    </Field>

    <p v-if="error" class="flex items-start gap-2 text-sm text-danger">
      <Icon name="warning" :size="16" class="mt-0.5 shrink-0" />
      {{ error }}
    </p>

    <div v-if="searching" class="flex justify-center py-3">
      <Spinner :size="20">Searching…</Spinner>
    </div>

    <p v-else-if="searched && results.length === 0" class="text-sm text-faint">
      Nothing found for “{{ query }}”. Try a nearby larger town, or enter coordinates below.
    </p>

    <ul v-else-if="results.length > 0" class="flex flex-col gap-1">
      <li v-for="result in results" :key="`${result.latitude},${result.longitude}`">
        <button
          type="button"
          class="flex min-h-touch w-full items-center gap-3 rounded-card px-3 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
          :disabled="saving"
          @click="choose(result)"
        >
          <Icon name="weather" :size="18" class="shrink-0 text-faint" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-ink">{{ result.name }}</span>
            <span class="block truncate text-xs text-faint">{{ result.region }}</span>
          </span>
          <Icon name="chevronRight" :size="16" class="shrink-0 text-faint" />
        </button>
      </li>
    </ul>

    <!-- Coordinates, for anywhere the gazetteer does not know -->
    <div>
      <button type="button" class="text-xs font-medium text-accent hover:underline" @click="showManual = !showManual">
        {{ showManual ? 'Hide coordinates' : 'Enter coordinates instead' }}
      </button>

      <div v-if="showManual" class="mt-3 flex flex-col gap-3">
        <Field label="Name" for="location-manual-name">
          <TextInput id="location-manual-name" v-model="manualName" :disabled="saving" />
        </Field>

        <div class="grid grid-cols-2 gap-3">
          <Field label="Latitude" for="location-manual-lat">
            <TextInput id="location-manual-lat" v-model="manualLatitude" :disabled="saving" />
          </Field>
          <Field label="Longitude" for="location-manual-lon">
            <TextInput id="location-manual-lon" v-model="manualLongitude" :disabled="saving" />
          </Field>
        </div>

        <ToolButton icon="check" label="Save coordinates" :disabled="saving" @click="saveManual" />
      </div>
    </div>
  </div>
</template>
