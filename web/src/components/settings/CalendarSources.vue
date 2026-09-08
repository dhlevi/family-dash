<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { calendarApi } from '@/api/calendar'
import ColourPicker from '@/components/ui/ColourPicker.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import TextInput from '@/components/ui/TextInput.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import type { CalendarSource } from '@/api/types'

/**
 * Managing calendar subscriptions.
 *
 * The copy here does real work: a feed URL is the one piece of setup a
 * household has to go and find, and "Settings → Integrate calendar → Secret
 * address in iCal format" is not discoverable. Explaining where it lives is
 * the difference between this feature being used and not.
 */
const props = defineProps<{ sources: CalendarSource[] }>()
const emit = defineEmits<{ changed: [] }>()

const addOpen = ref(false)
const editing = ref<CalendarSource | null>(null)
const busy = ref<string | null>(null)
const formError = ref<string | null>(null)
const saving = ref(false)

/** What kind of calendar is being added. Only meaningful when creating. */
const kind = ref<'ics' | 'google'>('ics')
const name = ref('')
const url = ref('')
const colour = ref('#48b884')

const subscriptions = computed(() => props.sources.filter(source => source.type !== 'local'))
const localSources = computed(() => props.sources.filter(source => source.type === 'local'))

function openAdd(): void {
  editing.value = null
  kind.value = 'ics'
  name.value = ''
  url.value = ''
  colour.value = '#48b884'
  formError.value = null
  addOpen.value = true
}

function openEdit(source: CalendarSource): void {
  editing.value = source
  kind.value = source.type === 'google' ? 'google' : 'ics'
  name.value = source.name
  url.value = typeof source.config.url === 'string' ? source.config.url : ''
  colour.value = source.colour
  formError.value = null
  addOpen.value = true
}

const canSave = computed(() => {
  if (saving.value || name.value.trim().length === 0) return false
  // A Google calendar has no address to type: it is connected afterwards,
  // in the Google section below.
  if (kind.value === 'google') return true

  return editing.value !== null || url.value.trim().length > 0
})

async function save(): Promise<void> {
  if (!canSave.value) return

  saving.value = true
  formError.value = null

  try {
    if (editing.value) {
      await calendarApi.updateSource(editing.value.id, {
        name: name.value.trim(),
        colour: colour.value,
        config: url.value.trim().length > 0 ? { url: url.value.trim() } : undefined
      })
    } else if (kind.value === 'google') {
      await calendarApi.addSource({ type: 'google', name: name.value.trim(), colour: colour.value })
    } else {
      await calendarApi.addSource({
        type: 'ics',
        name: name.value.trim(),
        colour: colour.value,
        config: { url: url.value.trim() }
      })
    }

    addOpen.value = false
    emit('changed')
  } catch (caught) {
    formError.value = caught instanceof ApiRequestError ? caught.message : 'Could not save the calendar'
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(source: CalendarSource): Promise<void> {
  busy.value = source.id
  try {
    await calendarApi.updateSource(source.id, { enabled: !source.enabled })
    emit('changed')
  } finally {
    busy.value = null
  }
}

async function sync(source: CalendarSource): Promise<void> {
  busy.value = source.id
  try {
    await calendarApi.syncSource(source.id)
    emit('changed')
  } finally {
    busy.value = null
  }
}

const confirmingRemoval = ref<CalendarSource | null>(null)

async function remove(source: CalendarSource): Promise<void> {
  busy.value = source.id
  try {
    await calendarApi.deleteSource(source.id)
    confirmingRemoval.value = null
    emit('changed')
  } catch (caught) {
    formError.value = caught instanceof ApiRequestError ? caught.message : 'Could not remove the calendar'
  } finally {
    busy.value = null
  }
}

function syncLabel(source: CalendarSource): string {
  if (!source.lastSyncAt) return 'Never synced'

  const at = new Date(source.lastSyncAt)
  return `Synced ${formatRelativeDay(at).toLowerCase()} at ${formatTime(at)}`
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <!-- The local calendar: always present, cannot be removed. -->
    <div
      v-for="source in localSources"
      :key="source.id"
      class="flex items-center gap-3 rounded-card bg-surface-2 px-3 py-2.5"
    >
      <span class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: source.colour }" />
      <div class="min-w-0 flex-1">
        <p class="truncate text-sm font-medium text-ink">{{ source.name }}</p>
        <p class="text-xs text-faint">Events you add here live in this calendar</p>
      </div>
    </div>

    <!-- Subscriptions -->
    <div
      v-for="source in subscriptions"
      :key="source.id"
      class="flex flex-col gap-2 rounded-card bg-surface-2 px-3 py-2.5"
    >
      <div class="flex items-center gap-3">
        <span
          class="size-3 shrink-0 rounded-full"
          :class="source.enabled ? '' : 'opacity-30'"
          :style="{ backgroundColor: source.colour }"
        />
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium" :class="source.enabled ? 'text-ink' : 'text-faint'">
            {{ source.name }}
          </p>
          <p class="truncate text-xs" :class="source.lastError ? 'text-danger' : 'text-faint'">
            {{ source.lastError ?? syncLabel(source) }}
          </p>
        </div>

        <ToolButton
          :icon="source.enabled ? 'check' : 'close'"
          :label="source.enabled ? 'Disable' : 'Enable'"
          icon-only
          :disabled="busy === source.id"
          @click="toggleEnabled(source)"
        />
        <ToolButton
          icon="refresh"
          label="Sync now"
          icon-only
          :disabled="busy === source.id || !source.enabled"
          @click="sync(source)"
        />
        <ToolButton icon="edit" label="Edit" icon-only :disabled="busy === source.id" @click="openEdit(source)" />
        <ToolButton
          icon="trash"
          label="Remove"
          icon-only
          variant="danger"
          :disabled="busy === source.id"
          @click="confirmingRemoval = source"
        />
      </div>
    </div>

    <p v-if="subscriptions.length === 0" class="text-sm text-faint">
      No subscriptions yet. Add one to show a Google, iCloud or Outlook calendar here.
    </p>

    <ToolButton icon="plus" label="Add a calendar" @click="openAdd" />

    <!-- Add / edit -->
    <Modal
      :open="addOpen"
      :title="editing ? 'Edit calendar' : 'Add a calendar'"
      :busy="saving"
      @close="addOpen = false"
    >
      <div class="flex flex-col gap-4">
        <p v-if="formError" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ formError }}</p>

        <Field
          v-if="!editing"
          label="What kind?"
          hint="A feed subscription is read-only but never needs re-authorising. Google can be written to."
        >
          <SegmentedControl
            v-model="kind"
            :options="[
              { value: 'ics', label: 'Feed address' },
              { value: 'google', label: 'Google account' }
            ]"
            block
            :disabled="saving"
          />
        </Field>

        <Field label="Name" for="source-name">
          <TextInput id="source-name" v-model="name" placeholder="School, Work, Swimming…" :disabled="saving" />
        </Field>

        <p v-if="kind === 'google'" class="rounded-card bg-surface-2 px-3 py-2 text-xs text-muted">
          This creates the calendar; connecting it to your Google account happens in the Google Calendar section, just
          below this one.
        </p>

        <Field
          v-if="kind === 'ics'"
          label="Feed address"
          for="source-url"
          :hint="editing ? 'Leave unchanged to keep the current address' : undefined"
        >
          <TextInput
            id="source-url"
            v-model="url"
            type="url"
            placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
            :disabled="saving"
          />
        </Field>

        <Field label="Colour">
          <ColourPicker v-model="colour" :disabled="saving" />
        </Field>

        <!-- Where to find the URL. This is the actual hard part of setup. -->
        <details class="rounded-card bg-surface-2 px-3 py-2.5 text-sm">
          <summary class="cursor-pointer font-medium text-ink">Where do I find this address?</summary>
          <div class="mt-2 flex flex-col gap-2 text-muted">
            <p>
              <strong class="font-medium text-ink">Google Calendar</strong> — Settings, pick the calendar, then "Secret
              address in iCal format".
            </p>
            <p>
              <strong class="font-medium text-ink">iCloud</strong> — share the calendar, tick "Public Calendar", and
              copy the link. A <code class="font-mono text-xs">webcal://</code> link is fine.
            </p>
            <p>
              <strong class="font-medium text-ink">Outlook</strong> — Settings, Calendar, Shared calendars, publish,
              then copy the ICS link.
            </p>
            <p class="flex items-start gap-2 pt-1 text-xs text-faint">
              <Icon name="warning" :size="14" class="mt-0.5 shrink-0" />
              <span>
                Subscriptions are read-only and refresh in the background, so they keep working indefinitely — unlike a
                signed-in connection, whose access can lapse. Treat the address as a password: anyone with it can read
                the calendar.
              </span>
            </p>
          </div>
        </details>
      </div>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" :disabled="saving" @click="addOpen = false" />
        <ToolButton
          icon="check"
          :label="saving ? 'Saving…' : editing ? 'Save' : 'Add'"
          variant="primary"
          :disabled="!canSave"
          @click="save"
        />
      </template>
    </Modal>

    <!-- Removal confirmation: this discards cached events, so it is worth a tap. -->
    <Modal
      :open="confirmingRemoval !== null"
      title="Remove this calendar?"
      :busy="busy !== null"
      @close="confirmingRemoval = null"
    >
      <p class="text-sm text-muted">
        <strong class="font-medium text-ink">{{ confirmingRemoval?.name }}</strong> and its cached events will be
        removed from the dashboard. The calendar itself is not affected, and you can add the address again later.
      </p>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" @click="confirmingRemoval = null" />
        <ToolButton
          icon="trash"
          label="Remove"
          variant="danger"
          :disabled="busy !== null"
          @click="confirmingRemoval && remove(confirmingRemoval)"
        />
      </template>
    </Modal>
  </div>
</template>
