<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { householdApi } from '@/api/household'
import ColourPicker from '@/components/ui/ColourPicker.vue'
import Field from '@/components/ui/Field.vue'
import { useSettingsStore } from '@/stores/settings'
import type { CalendarSource, PersonDay, PersonProfile } from '@/api/types'

/**
 * Per-person settings for the dashboard strip.
 *
 * Two things only: what colour somebody is, and which calendars are theirs.
 * The second is the one that matters — events carry no assignee of their own,
 * so a calendar is the only honest way to say whose day an appointment
 * belongs to. Somebody with no calendar linked still gets a column, showing
 * their tasks.
 *
 * Names are not edited here. They come from the household list above, so
 * there is one place to add a person rather than two that can disagree.
 */
const props = defineProps<{ sources: CalendarSource[] }>()

const settings = useSettingsStore()

/** The colours actually in use, so a swatch shows what is on the wall now. */
const resolved = ref<PersonDay[]>([])

onMounted(async () => {
  try {
    resolved.value = await householdApi.peopleToday()
  } catch {
    // Only decoration — the controls below work without it.
  }
})

const names = computed(() => settings.get('tasks.assignees', []))
const profiles = computed(() => settings.get('people.profiles', {}))

function profileFor(name: string): PersonProfile {
  return profiles.value[name] ?? {}
}

function colourOf(name: string): string {
  return profileFor(name).colour ?? resolved.value.find(person => person.name === name)?.colour ?? '#4f8ef7'
}

async function write(name: string, changes: PersonProfile): Promise<void> {
  const next = { ...profiles.value, [name]: { ...profileFor(name), ...changes } }

  // An entry that says nothing is removed rather than stored as an empty
  // object, so renaming somebody does not leave a tombstone behind for ever.
  const entry = next[name]!
  if (!entry.colour && (entry.calendarSourceIds ?? []).length === 0) delete next[name]

  await settings.set('people.profiles', next)
  resolved.value = await householdApi.peopleToday().catch(() => resolved.value)
}

function toggleSource(name: string, sourceId: string): void {
  const current = profileFor(name).calendarSourceIds ?? []
  const next = current.includes(sourceId) ? current.filter(id => id !== sourceId) : [...current, sourceId]

  void write(name, { calendarSourceIds: next })
}

function linked(name: string, sourceId: string): boolean {
  return (profileFor(name).calendarSourceIds ?? []).includes(sourceId)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <p v-if="names.length === 0" class="text-sm text-muted">
      Add the people in your household above and each of them gets a column on the dashboard.
    </p>

    <div v-for="name in names" :key="name" class="flex flex-col gap-3 rounded-card border border-line p-3">
      <div class="flex items-center gap-2">
        <span class="size-3 shrink-0 rounded-full" :style="{ background: colourOf(name) }" />
        <h3 class="text-sm font-semibold text-ink">{{ name }}</h3>
      </div>

      <Field label="Colour">
        <ColourPicker :model-value="colourOf(name)" @update:model-value="colour => write(name, { colour })" />
      </Field>

      <Field
        v-if="props.sources.length > 0"
        label="Their calendars"
        hint="Events from these show in this person's column. Leave all off to show only their tasks."
      >
        <div class="flex flex-wrap gap-2">
          <button
            v-for="source in props.sources"
            :key="source.id"
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
            :class="
              linked(name, source.id)
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2'
            "
            :aria-pressed="linked(name, source.id)"
            @click="toggleSource(name, source.id)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: source.colour }" />
            {{ source.name }}
          </button>
        </div>
      </Field>
    </div>
  </div>
</template>
