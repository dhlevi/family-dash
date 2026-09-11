<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { householdApi } from '@/api/household'
import EmptyState from '@/components/ui/EmptyState.vue'
import WidgetShell from './WidgetShell.vue'
import { BIN_COLOURS, BIN_LABELS, isUrgent, parseCollectionDate, urgencyLabel } from '@/utils/bins'
import { formatDate, formatRelativeDay } from '@/utils/datetime'
import type { BinOutlook } from '@/api/types'

/**
 * When the bins go out.
 *
 * The job this does is not "show the collection schedule" — a calendar
 * already does that, and it is precisely where a collection goes unnoticed
 * among twenty other events. It is to make the evening before impossible to
 * miss, which is why the only loud state is the one that asks for something
 * to be done now.
 */
const outlook = ref<BinOutlook | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    outlook.value = await householdApi.bins()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not work out bin day'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const next = computed(() => outlook.value?.next ?? null)
const following = computed(() => outlook.value?.following ?? null)
const urgent = computed(() => (next.value ? isUrgent(next.value) : false))

/** The calendar's own wording, when it says more than the classification did. */
const detail = computed(() => next.value?.titles.join(' · ') ?? '')
</script>

<template>
  <WidgetShell title="Bin day" icon="bins" to="/calendar" :loading="loading" :error="error">
    <EmptyState
      v-if="!loading && !next"
      icon="bins"
      title="No collections found"
      description="Subscribe to your council's collection calendar in Settings → Calendars, then choose it under Bin day."
    />

    <div v-else-if="next" class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div>
        <p
          class="text-[clamp(1.25rem,3.2vh,1.75rem)] leading-tight font-semibold"
          :class="urgent ? 'text-accent' : 'text-ink'"
        >
          {{ urgencyLabel(next) }}
        </p>
        <p class="mt-0.5 text-xs text-faint">{{ formatDate(parseCollectionDate(next.date)) }} · {{ detail }}</p>
      </div>

      <!-- The colours are the point: somebody glancing across a kitchen is
           matching a swatch to a bin in the garage, not reading a legend. -->
      <ul class="flex flex-wrap gap-2">
        <li
          v-for="kind in next.kinds"
          :key="kind"
          class="flex items-center gap-2 rounded-full border border-line bg-surface-2 py-1.5 pr-3 pl-2 text-sm font-medium text-ink"
        >
          <span class="size-3.5 shrink-0 rounded-full" :style="{ background: BIN_COLOURS[kind] }" />
          {{ BIN_LABELS[kind] }}
        </li>
      </ul>

      <p v-if="following" class="mt-auto text-xs text-faint">
        Then {{ formatRelativeDay(parseCollectionDate(following.date)) }} —
        {{ following.kinds.map(kind => BIN_LABELS[kind]).join(', ') || following.titles.join(', ') }}
      </p>
    </div>
  </WidgetShell>
</template>
