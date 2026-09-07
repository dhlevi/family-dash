<script setup lang="ts">
import { computed } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import { useOrientation } from '@/composables/useOrientation'
import { addDays, isToday, toDateInput } from '@/utils/datetime'
import { MEAL_SLOT_LABELS, type MealPlanEntry, type MealSlot } from '@/api/types'

/**
 * The seven-day grid.
 *
 * Days run across the screen in landscape and down it in portrait. That is
 * two layouts rather than one clever responsive grid, but a 7×3 matrix
 * rotated into a tall narrow panel is unreadable, and the alternative —
 * horizontal scrolling on a wall display — is worse.
 */
const props = defineProps<{
  weekStart: Date
  slots: MealSlot[]
  entries: MealPlanEntry[]
}>()

const emit = defineEmits<{ select: [payload: { planDate: string; slot: MealSlot }] }>()

const { isPortrait } = useOrientation()

const days = computed(() => Array.from({ length: 7 }, (_unused, index) => addDays(props.weekStart, index)))

/** Keyed lookup, so the grid is not a nested find over every cell. */
const byKey = computed(() => {
  const map = new Map<string, MealPlanEntry>()
  for (const entry of props.entries) map.set(`${entry.planDate}|${entry.slot}`, entry)
  return map
})

function entryFor(day: Date, slot: MealSlot): MealPlanEntry | undefined {
  return byKey.value.get(`${toDateInput(day)}|${slot}`)
}

function describe(entry: MealPlanEntry | undefined): string | null {
  if (!entry) return null
  return entry.recipeTitle ?? entry.customText
}

const dayName = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
const dayNameLong = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
</script>

<template>
  <!-- Landscape: days across, meals down -->
  <div v-if="!isPortrait" class="fd-scroll min-h-0 flex-1">
    <div class="grid" :style="{ gridTemplateColumns: `7rem repeat(7, minmax(0, 1fr))` }">
      <div class="border-b border-line bg-bg" />
      <div
        v-for="day in days"
        :key="`head-${day.toISOString()}`"
        class="flex flex-col items-center gap-0.5 border-b border-l border-line py-2"
        :class="isToday(day) ? 'bg-accent-soft' : 'bg-bg'"
      >
        <span class="text-xs font-semibold tracking-wider text-faint uppercase">{{ dayName.format(day) }}</span>
        <span
          class="grid size-7 place-items-center rounded-full text-sm font-semibold"
          :class="isToday(day) ? 'bg-accent text-accent-ink' : 'text-ink'"
        >
          {{ day.getDate() }}
        </span>
      </div>

      <template v-for="slot in slots" :key="slot">
        <div class="flex items-center border-b border-line px-3 py-2">
          <span class="text-xs font-semibold tracking-wider text-muted uppercase">
            {{ MEAL_SLOT_LABELS[slot] }}
          </span>
        </div>

        <button
          v-for="day in days"
          :key="`${slot}-${day.toISOString()}`"
          type="button"
          class="group flex min-h-[4.5rem] flex-col items-start gap-1 border-b border-l border-line p-2 text-left transition-colors hover:bg-surface-2 active:bg-surface-3"
          :class="isToday(day) ? 'bg-accent-soft/40' : ''"
          @click="emit('select', { planDate: toDateInput(day), slot })"
        >
          <span v-if="describe(entryFor(day, slot))" class="line-clamp-3 text-sm font-medium break-words text-ink">
            {{ describe(entryFor(day, slot)) }}
          </span>
          <Icon v-else name="plus" :size="18" class="text-transparent transition-colors group-hover:text-faint" />

          <span v-if="entryFor(day, slot)?.notes" class="line-clamp-2 text-[0.6875rem] text-faint">
            {{ entryFor(day, slot)?.notes }}
          </span>
        </button>
      </template>
    </div>
  </div>

  <!-- Portrait: days down, meals across -->
  <div v-else class="fd-scroll min-h-0 flex-1">
    <section v-for="day in days" :key="day.toISOString()" class="border-b border-line">
      <h3 class="flex items-baseline gap-2 px-4 py-2" :class="isToday(day) ? 'bg-accent-soft' : 'bg-bg'">
        <span class="text-sm font-semibold" :class="isToday(day) ? 'text-accent' : 'text-ink'">
          {{ dayNameLong.format(day) }}
        </span>
        <span class="text-xs text-faint">{{ day.getDate() }}</span>
      </h3>

      <div class="grid" :style="{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }">
        <button
          v-for="slot in slots"
          :key="`${day.toISOString()}-${slot}`"
          type="button"
          class="flex min-h-[4.5rem] flex-col gap-1 border-t border-l border-line p-2 text-left transition-colors first:border-l-0 hover:bg-surface-2 active:bg-surface-3"
          @click="emit('select', { planDate: toDateInput(day), slot })"
        >
          <span class="text-[0.6875rem] font-semibold tracking-wider text-faint uppercase">
            {{ MEAL_SLOT_LABELS[slot] }}
          </span>
          <span v-if="describe(entryFor(day, slot))" class="line-clamp-3 text-sm font-medium break-words text-ink">
            {{ describe(entryFor(day, slot)) }}
          </span>
          <span v-else class="text-sm text-faint">—</span>
        </button>
      </div>
    </section>
  </div>
</template>
