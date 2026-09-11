<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiRequestError } from '@/api/client'
import { calendarApi } from '@/api/calendar'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import type { GoogleCalendarStatus, GoogleCalendarSummary } from '@/api/types'

/**
 * Connecting a Google account, and choosing which of its calendars to show.
 *
 * Google is one provider among several rather than the foundation, and this
 * page says why: an OAuth app left on the "Testing" consent screen expires
 * its refresh tokens after seven days, which on a wall display means the
 * calendar works for a week and then quietly stops. An ICS subscription
 * never expires, so that stays the recommendation and this is for households
 * that want to add events back to a shared Google calendar.
 */
const emit = defineEmits<{ changed: [] }>()

const route = useRoute()
const router = useRouter()

const status = ref<GoogleCalendarStatus | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)

/** Calendars offered per source, once fetched. */
const calendars = ref<Record<string, GoogleCalendarSummary[]>>({})

/** The outcome the OAuth callback redirected back with. */
const outcome = ref<{ ok: boolean; message: string } | null>(null)

/**
 * The address to register in the Google Cloud console.
 *
 * Shown rather than described because it has to match exactly, and it
 * depends on how this dashboard is reached, which the browser knows and a
 * README cannot.
 */
const redirectUri = computed(() => `${window.location.origin}/api/calendar/google/callback`)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    status.value = await calendarApi.googleStatus()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not read the Google connection status'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  // The callback redirects here with its result in the query string.
  const result = route.query.google
  if (typeof result === 'string') {
    outcome.value = { ok: result === 'connected', message: String(route.query.message ?? '') }
    // Cleared from the URL so a refresh does not show a stale banner.
    void router.replace({ path: route.path })
  }

  await load()
})

async function connect(sourceId: string): Promise<void> {
  busy.value = sourceId
  error.value = null

  try {
    const { url } = await calendarApi.googleAuthUrl(sourceId)
    // Same tab: a kiosk browser has no tab strip, and Google refuses to run
    // its consent screen inside a frame.
    window.location.href = url
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not start the Google connection'
    busy.value = null
  }
}

async function disconnect(sourceId: string): Promise<void> {
  busy.value = sourceId
  error.value = null

  try {
    await calendarApi.googleDisconnect(sourceId)
    delete calendars.value[sourceId]
    await load()
    emit('changed')
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not disconnect'
  } finally {
    busy.value = null
  }
}

async function loadCalendars(sourceId: string): Promise<void> {
  busy.value = sourceId
  error.value = null

  try {
    calendars.value = { ...calendars.value, [sourceId]: await calendarApi.googleCalendars(sourceId) }
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not list the Google calendars'
  } finally {
    busy.value = null
  }
}

async function chooseCalendar(sourceId: string, calendarId: string): Promise<void> {
  busy.value = sourceId
  error.value = null

  try {
    await calendarApi.updateSource(sourceId, { config: { calendarId } })
    // Fill it now rather than waiting for the next scheduled sync.
    await calendarApi.syncSource(sourceId)
    await load()
    emit('changed')
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not switch calendar'
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <p
      v-if="outcome"
      class="flex items-start gap-2 rounded-card px-3 py-2 text-sm"
      :class="outcome.ok ? 'bg-accent-soft text-ink' : 'bg-danger/15 text-danger'"
    >
      <Icon :name="outcome.ok ? 'check' : 'warning'" :size="16" class="mt-0.5" />
      <span class="min-w-0 flex-1">{{ outcome.message }}</span>
      <button type="button" class="font-medium underline" @click="outcome = null">Dismiss</button>
    </p>

    <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

    <div v-if="loading" class="flex justify-center py-6"><Spinner :size="22" /></div>

    <!-- No OAuth client: nothing here can work until the server has one. -->
    <div v-else-if="status && !status.configured" class="flex flex-col gap-2 rounded-card bg-surface-2 px-3 py-3">
      <p class="text-sm font-medium text-ink">Google Calendar is not set up</p>
      <p class="text-xs text-muted">
        It needs an OAuth client of your own. Create a
        <strong>Web application</strong> client in the Google Cloud console, put its id and secret in
        <code class="rounded bg-surface px-1">.env</code> as
        <code class="rounded bg-surface px-1">GOOGLE_CLIENT_ID</code> and
        <code class="rounded bg-surface px-1">GOOGLE_CLIENT_SECRET</code>, and restart the stack.
      </p>
      <p class="text-xs text-muted">Register this as an authorised redirect URI, exactly:</p>
      <code class="overflow-x-auto rounded-card bg-surface px-2.5 py-2 text-xs text-ink">{{ redirectUri }}</code>
      <p class="text-xs text-warn">
        Set the consent screen to <strong>In production</strong> rather than leaving it in Testing. Testing-mode refresh
        tokens expire after seven days, and the calendar would stop updating a week later with nothing on screen to say
        why.
      </p>
    </div>

    <template v-else-if="status">
      <div
        v-for="source in status.sources"
        :key="source.id"
        class="flex flex-col gap-2 rounded-card bg-surface-2 px-3 py-2.5"
      >
        <div class="flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-ink">{{ source.name }}</p>
            <p class="truncate text-xs" :class="source.lastError ? 'text-danger' : 'text-faint'">
              {{
                source.lastError ??
                (source.connected
                  ? source.calendarId
                    ? `Connected · ${source.calendarId}`
                    : 'Connected - choose a calendar'
                  : 'Not connected')
              }}
            </p>
          </div>

          <Spinner v-if="busy === source.id" :size="18" />

          <template v-else-if="source.connected">
            <ToolButton icon="refresh" label="Change calendar" @click="loadCalendars(source.id)" />
            <ToolButton icon="close" label="Disconnect" icon-only variant="danger" @click="disconnect(source.id)" />
          </template>

          <ToolButton v-else icon="plus" label="Connect" variant="primary" @click="connect(source.id)" />
        </div>

        <!-- Calendar picker, once the list has been fetched. -->
        <div v-if="calendars[source.id]" class="flex flex-col gap-1.5 border-t border-line pt-2">
          <p class="text-xs font-medium text-muted">Which calendar?</p>
          <button
            v-for="calendar in calendars[source.id]"
            :key="calendar.id"
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-card px-2.5 text-left text-sm transition-colors"
            :class="calendar.id === source.calendarId ? 'bg-accent text-accent-ink' : 'text-ink hover:bg-surface-3'"
            @click="chooseCalendar(source.id, calendar.id)"
          >
            <Icon v-if="calendar.id === source.calendarId" name="check" :size="15" />
            <span class="min-w-0 flex-1 truncate">{{ calendar.name }}</span>
            <span v-if="calendar.primary" class="shrink-0 text-xs opacity-70">yours</span>
            <span v-else-if="!calendar.writable" class="shrink-0 text-xs opacity-70">read-only</span>
          </button>
        </div>
      </div>

      <p v-if="status.sources.length === 0" class="text-sm text-faint">
        No Google calendars yet. Add one above with “Add a calendar”, then connect it here.
      </p>
    </template>
  </div>
</template>
