<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { calendarApi } from '@/api/calendar'
import { systemApi } from '@/api/system'
import CalendarSources from '@/components/settings/CalendarSources.vue'
import Card from '@/components/ui/Card.vue'
import ColourPicker from '@/components/ui/ColourPicker.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import PageShell from '@/components/ui/PageShell.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Toggle from '@/components/ui/Toggle.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { useSystemStore } from '@/stores/system'
import type { CalendarSource, DashboardWidget, SystemInfo } from '@/api/types'

/**
 * Settings.
 *
 * Preferences save as you change them rather than behind a Save button: on a
 * shared wall display, an unsaved form is a trap — somebody walks away
 * mid-edit and the change is silently lost. Each control writes immediately
 * and the API is the source of truth for what stuck.
 */
const settings = useSettingsStore()
const system = useSystemStore()

const info = ref<SystemInfo | null>(null)
const sources = ref<CalendarSource[]>([])
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [systemInfo, calendarSources] = await Promise.all([
      systemApi.info(),
      calendarApi.sources(),
      settings.load(),
      system.refresh()
    ])

    info.value = systemInfo
    sources.value = calendarSources
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load settings'
  } finally {
    loading.value = false
  }
}

async function reloadSources(): Promise<void> {
  sources.value = await calendarApi.sources()
}

onMounted(load)

// --- appearance -------------------------------------------------------------

const theme = ref<'dark' | 'light'>('dark')
const accent = ref('#4f8ef7')
const clock24Hour = ref(true)

// --- calendar ---------------------------------------------------------------

const defaultView = ref<'month' | 'week' | 'agenda'>('month')
const weekStartsOn = ref<0 | 1>(0)
const dashboardDays = ref(7)

// --- tasks ------------------------------------------------------------------

const showCompleted = ref(false)
const assigneeInput = ref('')
const assignees = ref<string[]>([])

// --- weather ----------------------------------------------------------------

const units = ref<'metric' | 'imperial'>('metric')
const locationName = ref('')
const latitude = ref(0)
const longitude = ref(0)

// --- dashboard --------------------------------------------------------------

const widgets = ref<DashboardWidget[]>([])

const ALL_WIDGETS: Array<{ value: DashboardWidget; label: string }> = [
  { value: 'calendar', label: 'Up next' },
  { value: 'tasks', label: "Today's tasks" },
  { value: 'weather', label: 'Weather' },
  { value: 'meal', label: "Tonight's meal" },
  { value: 'notes', label: 'Notes' },
  { value: 'news', label: 'Headlines' },
  { value: 'photos', label: 'Photos' }
]

/** Mirror the store into local refs once it has loaded. */
watch(
  () => settings.values,
  values => {
    if (!values) return

    theme.value = values['appearance.theme']
    accent.value = values['appearance.accent']
    clock24Hour.value = values['appearance.clock24Hour']
    defaultView.value = values['calendar.defaultView']
    weekStartsOn.value = values['calendar.weekStartsOn']
    dashboardDays.value = values['calendar.dashboardDays']
    showCompleted.value = values['tasks.showCompleted']
    assignees.value = [...values['tasks.assignees']]
    units.value = values['weather.units']
    locationName.value = values['weather.locationName']
    latitude.value = values['weather.latitude']
    longitude.value = values['weather.longitude']
    widgets.value = [...values['dashboard.widgets']]
  },
  { immediate: true, deep: true }
)

const savedAt = ref<Date | null>(null)

async function persist(changes: Parameters<typeof settings.save>[0]): Promise<void> {
  if (await settings.save(changes)) savedAt.value = new Date()
}

function toggleWidget(widget: DashboardWidget, enabled: boolean): void {
  // Preserve the canonical order rather than append, so the dashboard layout
  // stays predictable however the toggles are used.
  widgets.value = enabled
    ? ALL_WIDGETS.filter(item => item.value === widget || widgets.value.includes(item.value)).map(item => item.value)
    : widgets.value.filter(item => item !== widget)

  void persist({ 'dashboard.widgets': widgets.value })
}

function addAssignee(): void {
  const name = assigneeInput.value.trim()
  if (name.length === 0 || assignees.value.includes(name)) return

  assignees.value = [...assignees.value, name]
  assigneeInput.value = ''
  void persist({ 'tasks.assignees': assignees.value })
}

function removeAssignee(name: string): void {
  assignees.value = assignees.value.filter(candidate => candidate !== name)
  void persist({ 'tasks.assignees': assignees.value })
}

function saveLocation(): void {
  void persist({
    'weather.locationName': locationName.value.trim() || 'Home',
    'weather.latitude': latitude.value,
    'weather.longitude': longitude.value
  })
}

// --- diagnostics ------------------------------------------------------------

const checks = computed(() => system.report?.checks ?? [])
const tasks = computed(() => system.report?.tasks ?? [])

const uptime = computed(() => {
  const seconds = info.value?.uptimeSeconds ?? 0
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
})

const statusTone = computed(() => {
  switch (system.status) {
    case 'ok':
      return 'text-success'
    case 'degraded':
      return 'text-warn'
    default:
      return 'text-danger'
  }
})

function formatWhen(value: string | null): string {
  if (!value) return 'never'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

async function runTask(name: string): Promise<void> {
  await systemApi.runTask(name)
  await Promise.all([system.refresh(), reloadSources()])
}
</script>

<template>
  <PageShell>
    <template #toolbar>
      <ToolButton icon="refresh" label="Refresh" :disabled="loading" @click="load" />

      <span v-if="settings.saving" class="flex items-center gap-2 text-sm text-muted">
        <Spinner :size="16" />
        Saving…
      </span>
      <span v-else-if="settings.error" class="flex items-center gap-2 text-sm text-danger">
        <Icon name="warning" :size="16" />
        {{ settings.error }}
      </span>
      <span v-else-if="savedAt" class="flex items-center gap-1.5 text-sm text-success">
        <Icon name="check" :size="16" />
        Saved
      </span>

      <span class="ml-auto text-sm text-faint">Changes save as you make them</span>
    </template>

    <ErrorState v-if="error" :message="error" :retrying="loading" @retry="load" />

    <div v-else-if="loading && !settings.loaded" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading settings…</Spinner>
    </div>

    <div v-else class="grid grid-cols-[repeat(auto-fit,minmax(22rem,1fr))] items-start gap-4">
      <!-- Appearance -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Appearance</h2>

        <div class="flex flex-col gap-4">
          <Field label="Theme">
            <SegmentedControl
              v-model="theme"
              :options="[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' }
              ]"
              block
              @update:model-value="persist({ 'appearance.theme': theme })"
            />
          </Field>

          <Field label="Accent colour">
            <ColourPicker v-model="accent" @update:model-value="persist({ 'appearance.accent': accent })" />
          </Field>

          <Toggle
            v-model="clock24Hour"
            label="24-hour clock"
            hint="Off shows am/pm"
            @update:model-value="persist({ 'appearance.clock24Hour': clock24Hour })"
          />
        </div>
      </Card>

      <!-- Calendar -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Calendar</h2>

        <div class="flex flex-col gap-4">
          <Field label="Opens on">
            <SegmentedControl
              v-model="defaultView"
              :options="[
                { value: 'month', label: 'Month' },
                { value: 'week', label: 'Week' },
                { value: 'agenda', label: 'Agenda' }
              ]"
              block
              @update:model-value="persist({ 'calendar.defaultView': defaultView })"
            />
          </Field>

          <Field label="Week starts on">
            <SegmentedControl
              v-model="weekStartsOn"
              :options="[
                { value: 0, label: 'Sunday' },
                { value: 1, label: 'Monday' }
              ]"
              block
              @update:model-value="persist({ 'calendar.weekStartsOn': weekStartsOn })"
            />
          </Field>

          <Field label="Dashboard looks ahead" hint="Days of events in the 'Up next' widget">
            <NumberStepper
              v-model="dashboardDays"
              :min="1"
              :max="31"
              suffix="days"
              @update:model-value="persist({ 'calendar.dashboardDays': dashboardDays })"
            />
          </Field>
        </div>
      </Card>

      <!-- Calendar sources -->
      <Card>
        <h2 class="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">Calendars</h2>
        <p class="mb-3 text-xs text-faint">
          Subscribe to a calendar's feed address to show it here. Subscriptions are read-only and never need
          re-authorising.
        </p>

        <CalendarSources :sources="sources" @changed="reloadSources" />
      </Card>

      <!-- Tasks -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Tasks</h2>

        <div class="flex flex-col gap-4">
          <Toggle
            v-model="showCompleted"
            label="Show completed tasks"
            hint="Completed items stay in the list"
            @update:model-value="persist({ 'tasks.showCompleted': showCompleted })"
          />

          <Field label="Who's in the household" hint="Shortcuts when assigning a task. Names stay free text.">
            <div class="flex gap-2">
              <TextInput v-model="assigneeInput" placeholder="Add a name" @enter="addAssignee" />
              <ToolButton
                icon="plus"
                label="Add"
                icon-only
                :disabled="assigneeInput.trim().length === 0"
                @click="addAssignee"
              />
            </div>

            <div v-if="assignees.length > 0" class="mt-2 flex flex-wrap gap-2">
              <span
                v-for="name in assignees"
                :key="name"
                class="flex items-center gap-1 rounded-full bg-accent-soft py-1 pr-1 pl-3 text-sm text-accent"
              >
                {{ name }}
                <button
                  type="button"
                  class="grid size-7 place-items-center rounded-full hover:bg-accent/20"
                  :aria-label="`Remove ${name}`"
                  @click="removeAssignee(name)"
                >
                  <Icon name="close" :size="14" />
                </button>
              </span>
            </div>
          </Field>
        </div>
      </Card>

      <!-- Dashboard -->
      <Card>
        <h2 class="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">Dashboard</h2>
        <p class="mb-3 text-xs text-faint">Which widgets appear, in this order.</p>

        <div class="flex flex-col">
          <Toggle
            v-for="widget in ALL_WIDGETS"
            :key="widget.value"
            :model-value="widgets.includes(widget.value)"
            :label="widget.label"
            @update:model-value="toggleWidget(widget.value, $event)"
          />
        </div>
      </Card>

      <!-- Location -->
      <Card>
        <h2 class="mb-1 text-sm font-semibold tracking-wide text-muted uppercase">Location and units</h2>
        <p class="mb-3 text-xs text-faint">Used by the weather forecast.</p>

        <div class="flex flex-col gap-4">
          <Field label="Units">
            <SegmentedControl
              v-model="units"
              :options="[
                { value: 'metric', label: 'Metric' },
                { value: 'imperial', label: 'Imperial' }
              ]"
              block
              @update:model-value="persist({ 'weather.units': units })"
            />
          </Field>

          <Field label="Place name" for="location-name">
            <TextInput id="location-name" v-model="locationName" @enter="saveLocation" />
          </Field>

          <div class="grid grid-cols-2 gap-3">
            <Field label="Latitude" for="location-lat">
              <TextInput
                id="location-lat"
                :model-value="String(latitude)"
                @update:model-value="latitude = Number($event)"
              />
            </Field>
            <Field label="Longitude" for="location-lon">
              <TextInput
                id="location-lon"
                :model-value="String(longitude)"
                @update:model-value="longitude = Number($event)"
              />
            </Field>
          </div>

          <ToolButton icon="check" label="Save location" @click="saveLocation" />
        </div>
      </Card>

      <!-- Service -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Service</h2>

        <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt class="text-faint">Status</dt>
          <dd class="font-medium" :class="statusTone">{{ system.statusLabel }}</dd>

          <dt class="text-faint">Version</dt>
          <dd class="fd-selectable text-ink">{{ info?.version }}</dd>

          <dt class="text-faint">Platform</dt>
          <dd class="fd-selectable text-ink">{{ info?.platform }}</dd>

          <dt class="text-faint">Timezone</dt>
          <dd class="text-ink">{{ info?.timezone }}</dd>

          <dt class="text-faint">Uptime</dt>
          <dd class="text-ink">{{ uptime }}</dd>

          <dt class="text-faint">Routes</dt>
          <dd class="text-ink">{{ info?.routes }}</dd>
        </dl>

        <a
          href="/openapi"
          target="_blank"
          rel="noopener"
          class="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
        >
          Browse the API documentation
          <Icon name="chevronRight" :size="16" />
        </a>
      </Card>

      <!-- Health -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Health checks</h2>

        <ul class="flex flex-col gap-2">
          <li
            v-for="check in checks"
            :key="check.name"
            class="flex items-start gap-3 rounded-card bg-surface-2 px-3 py-2.5"
          >
            <span
              class="mt-1.5 size-2.5 shrink-0 rounded-full"
              :class="check.healthy ? 'bg-success' : check.critical ? 'bg-danger' : 'bg-warn'"
            />
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-ink">
                {{ check.name }}
                <span v-if="!check.critical" class="text-xs font-normal text-faint">(non-critical)</span>
              </p>
              <p v-if="check.message" class="text-xs text-warn">{{ check.message }}</p>
              <p v-else class="text-xs text-faint">Responded in {{ check.durationMs }}ms</p>
            </div>
          </li>
        </ul>
      </Card>

      <!-- Background refresh -->
      <Card>
        <h2 class="mb-3 text-sm font-semibold tracking-wide text-muted uppercase">Background refresh</h2>

        <p v-if="tasks.length === 0" class="text-sm text-faint">No background tasks are registered.</p>

        <ul v-else class="flex flex-col gap-2">
          <li v-for="task in tasks" :key="task.name" class="rounded-card bg-surface-2 px-3 py-2.5">
            <div class="flex items-center gap-2">
              <p class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ task.name }}</p>
              <code class="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-xs text-muted">{{ task.cron }}</code>
              <ToolButton
                icon="refresh"
                :label="`Run ${task.name} now`"
                icon-only
                :disabled="task.running"
                @click="runTask(task.name)"
              />
            </div>
            <p class="mt-1 text-xs" :class="task.lastError ? 'text-danger' : 'text-faint'">
              {{ task.lastError ?? `Last run ${formatWhen(task.lastRunAt)}` }}
            </p>
          </li>
        </ul>
      </Card>
    </div>
  </PageShell>
</template>
