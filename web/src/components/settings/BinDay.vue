<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { householdApi } from '@/api/household'
import Field from '@/components/ui/Field.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import { BIN_LABELS, parseCollectionDate, urgencyLabel } from '@/utils/bins'
import { formatDate } from '@/utils/datetime'
import { useSettingsStore } from '@/stores/settings'
import type { BinOutlook, CalendarSource } from '@/api/types'

/**
 * Which calendars carry the collection schedule, and when to start asking.
 *
 * The preview underneath is the important part of this panel. Collection
 * calendars word things very differently: "Blue Box", "Refuse", "Food Scraps
 * & Yard Waste", eetc. The only way to know whether this install reads yours
 * correctly is to show what it currently thinks.
 */
const props = defineProps<{ sources: CalendarSource[] }>()

const settings = useSettingsStore()

const outlook = ref<BinOutlook | null>(null)
const eveningHour = ref(16)

async function refresh(): Promise<void> {
  outlook.value = await householdApi.bins().catch(() => null)
}

onMounted(async () => {
  eveningHour.value = settings.get('bins.eveningHour', 16)
  await refresh()
})

const chosen = computed(() => settings.get('bins.sourceIds', []))

async function toggle(sourceId: string): Promise<void> {
  const next = chosen.value.includes(sourceId)
    ? chosen.value.filter(id => id !== sourceId)
    : [...chosen.value, sourceId]

  await settings.set('bins.sourceIds', next)
  await refresh()
}

async function saveHour(): Promise<void> {
  await settings.set('bins.eveningHour', eveningHour.value)
  await refresh()
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <Field
      label="Collection calendars"
      hint="Leave all off to search every calendar for events that read like collections."
    >
      <p v-if="props.sources.length === 0" class="text-sm text-muted">
        No calendars yet. Subscribe to your council's collection feed under Calendars above.
      </p>

      <div v-else class="flex flex-wrap gap-2">
        <button
          v-for="source in props.sources"
          :key="source.id"
          type="button"
          class="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
          :class="
            chosen.includes(source.id)
              ? 'border-accent bg-accent-soft text-ink'
              : 'border-line bg-surface text-muted hover:bg-surface-2'
          "
          :aria-pressed="chosen.includes(source.id)"
          @click="toggle(source.id)"
        >
          <span class="size-2.5 shrink-0 rounded-full" :style="{ background: source.colour }" />
          {{ source.name }}
        </button>
      </div>
    </Field>

    <Field label="Start asking at" hint="Tomorrow's collection becomes 'put them out tonight' after this hour.">
      <NumberStepper v-model="eveningHour" :min="0" :max="23" suffix=":00" @update:model-value="saveHour" />
    </Field>

    <!-- What the app currently believes, which is the only way to tell
         whether it reads your council's wording. -->
    <Field label="Next collection">
      <p v-if="!outlook?.next" class="text-sm text-muted">
        Nothing found in the next four weeks. Check the calendar is subscribed and syncing.
      </p>
      <div v-else class="text-sm">
        <p class="font-medium text-ink">
          {{ urgencyLabel(outlook.next) }} -
          {{ outlook.next.kinds.map(kind => BIN_LABELS[kind]).join(', ') || 'unrecognised' }}
        </p>
        <p class="mt-1 text-xs text-faint">
          {{ formatDate(parseCollectionDate(outlook.next.date)) }} · from &ldquo;{{
            outlook.next.titles.join('&rdquo;, &ldquo;')
          }}&rdquo;
        </p>
      </div>
    </Field>
  </div>
</template>
