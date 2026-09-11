<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { notificationsApi } from '@/api/notifications'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import QrCode from '@/components/ui/QrCode.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Toggle from '@/components/ui/Toggle.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import type { CalendarSource, NotificationStatus } from '@/api/types'

/**
 * Notification settings.
 *
 * The subscribe codes are the point of this panel. A topic is a long random
 * string that nobody is going to type into a phone from across a kitchen, and
 * it is also the only thing protecting the message, so each person gets a QR
 * code to point a phone at, and nothing has to be typed or shared in a chat.
 */
const props = defineProps<{ sources: CalendarSource[] }>()

const settings = useSettingsStore()

const status = ref<NotificationStatus | null>(null)
const loading = ref(true)
const busy = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const showing = ref<string | null>(null)

const enabled = ref(false)
const taskLead = ref(30)
const taskOverdueMinutes = ref(120)
const eventLead = ref(30)
const allDayHour = ref(8)
const allDayDaysBefore = ref(0)
const quietFrom = ref(21)
const quietTo = ref(7)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    status.value = await notificationsApi.status()
    enabled.value = settings.get('notify.enabled', false)
    taskLead.value = settings.get('notify.taskLeadMinutes', 30)
    taskOverdueMinutes.value = settings.get('notify.taskOverdueMinutes', 120)
    eventLead.value = settings.get('notify.eventLeadMinutes', 30)
    allDayHour.value = settings.get('notify.allDayHour', 8)
    allDayDaysBefore.value = settings.get('notify.allDayDaysBefore', 0)
    quietFrom.value = settings.get('notify.quietFrom', 21)
    quietTo.value = settings.get('notify.quietTo', 7)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the notification settings'
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** A topic nobody has generated yet cannot be subscribed to or sent to. */
const ready = computed(() => (status.value?.householdTopic.length ?? 0) > 0)

/** Without a reachable address the QR codes have nothing to point at. */
const serverUrl = computed(() => status.value?.serverUrl ?? '')

const people = computed(() => Object.entries(status.value?.people ?? {}))

const chosenCalendars = computed(() => settings.get('notify.calendarSourceIds', []))

function subscribeUrl(topic: string): string {
  return `${serverUrl.value.replace(/\/+$/, '')}/${topic}`
}

async function generate(): Promise<void> {
  busy.value = true
  error.value = null

  try {
    status.value = await notificationsApi.setup()
    notice.value = 'Topics generated. Scan a code below on each phone.'
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not generate the topics'
  } finally {
    busy.value = false
  }
}

async function test(topic: string): Promise<void> {
  busy.value = true
  error.value = null
  notice.value = null

  try {
    await notificationsApi.test(topic)
    notice.value = 'Sent. It should arrive on any phone subscribed to that topic.'
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not send the test'
  } finally {
    busy.value = false
  }
}

async function toggleCalendar(sourceId: string): Promise<void> {
  const next = chosenCalendars.value.includes(sourceId)
    ? chosenCalendars.value.filter(id => id !== sourceId)
    : [...chosenCalendars.value, sourceId]

  await settings.set('notify.calendarSourceIds', next)
}
</script>

<template>
  <div class="flex flex-col gap-4">
    <div v-if="loading" class="flex justify-center py-6"><Spinner /></div>

    <template v-else>
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>
      <p v-if="notice" class="text-sm text-muted">{{ notice }}</p>

      <Toggle
        v-model="enabled"
        label="Send notifications"
        hint="Nothing is sent until topics have been generated below."
        :disabled="busy || !ready"
        @update:model-value="settings.set('notify.enabled', enabled)"
      />

      <!-- Generating is a separate, explicit step: a topic is a password, and
           regenerating one silently would unsubscribe a phone without saying so. -->
      <Field
        v-if="!ready"
        label="Topics"
        hint="Each person gets their own, generated rather than chosen - on ntfy the topic is the password."
      >
        <ToolButton
          icon="refresh"
          :label="busy ? 'Generating…' : 'Generate topics'"
          variant="primary"
          :disabled="busy"
          @click="generate"
        />
      </Field>

      <p
        v-if="ready && serverUrl.length === 0"
        class="flex items-start gap-2 rounded-card bg-surface-2 px-3 py-2.5 text-sm text-muted"
      >
        <Icon name="warning" :size="18" class="mt-0.5 shrink-0 text-warning" />
        <span>
          Notifications will send, but there is no address for phones to subscribe to yet. Set
          <code class="font-mono text-xs">NTFY_PUBLIC_URL</code> in <code class="font-mono text-xs">.env</code> to this
          machine's address on your network, <code class="font-mono text-xs">http://192.168.1.50:2586</code>, and
          restart, and the subscribe codes will appear here.
        </span>
      </p>

      <!-- One code per person. Scanning it is the whole of setting a phone up. -->
      <Field
        v-if="ready && serverUrl.length > 0"
        label="Subscribe"
        hint="Install the ntfy app, then scan your own code."
      >
        <div class="flex flex-col gap-2">
          <div
            v-for="[name, topic] in [['Everyone', status!.householdTopic] as const, ...people]"
            :key="topic"
            class="rounded-card border border-line p-3"
          >
            <div class="flex items-center gap-2">
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-ink">{{ name }}</span>
              <ToolButton
                :label="showing === topic ? 'Hide' : 'Show code'"
                :disabled="busy"
                @click="showing = showing === topic ? null : topic"
              />
              <ToolButton label="Test" :disabled="busy" @click="test(topic)" />
            </div>

            <div v-if="showing === topic" class="mt-3 flex flex-col items-center gap-2">
              <div class="rounded-card bg-white p-3">
                <QrCode :value="subscribeUrl(topic)" :size="180" />
              </div>
              <p class="fd-selectable text-center font-mono text-xs break-all text-faint">{{ subscribeUrl(topic) }}</p>
            </div>
          </div>
        </div>
      </Field>

      <Field label="Tell me about a task" hint="Minutes before it is due.">
        <NumberStepper
          v-model="taskLead"
          :min="0"
          :max="1440"
          :step="15"
          suffix="min"
          @update:model-value="settings.set('notify.taskLeadMinutes', taskLead)"
        />
      </Field>

      <Field label="And again if it is still not done" hint="Minutes after it was due. One follow-up only.">
        <NumberStepper
          v-model="taskOverdueMinutes"
          :min="5"
          :max="1440"
          :step="15"
          suffix="min"
          @update:model-value="settings.set('notify.taskOverdueMinutes', taskOverdueMinutes)"
        />
      </Field>

      <Field label="Tell me about an event" hint="Minutes before it starts.">
        <NumberStepper
          v-model="eventLead"
          :min="0"
          :max="1440"
          :step="15"
          suffix="min"
          @update:model-value="settings.set('notify.eventLeadMinutes', eventLead)"
        />
      </Field>

      <Field
        label="All-day events at"
        hint="'Thirty minutes before' means nothing for something starting at midnight, so these get a time of day."
      >
        <div class="flex flex-wrap items-center gap-2">
          <NumberStepper
            v-model="allDayDaysBefore"
            :min="0"
            :max="7"
            suffix="days before"
            @update:model-value="settings.set('notify.allDayDaysBefore', allDayDaysBefore)"
          />
          <NumberStepper
            v-model="allDayHour"
            :min="0"
            :max="23"
            suffix=":00"
            @update:model-value="settings.set('notify.allDayHour', allDayHour)"
          />
        </div>
      </Field>

      <Field
        label="Quiet from"
        hint="Anything due inside this window waits until it closes. Set both the same to allow any hour."
      >
        <div class="flex flex-wrap items-center gap-2">
          <NumberStepper
            v-model="quietFrom"
            :min="0"
            :max="23"
            suffix=":00"
            @update:model-value="settings.set('notify.quietFrom', quietFrom)"
          />
          <span class="text-sm text-muted">until</span>
          <NumberStepper
            v-model="quietTo"
            :min="0"
            :max="23"
            suffix=":00"
            @update:model-value="settings.set('notify.quietTo', quietTo)"
          />
        </div>
      </Field>

      <Field
        label="Which calendars"
        hint="Nothing ticked means the family calendar only. A Google or iCloud event is already being announced by the phone it came from. Tick a feed nothing else is watching, such as a collection schedule."
      >
        <div class="flex flex-wrap gap-2">
          <button
            v-for="source in props.sources"
            :key="source.id"
            type="button"
            class="flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors"
            :class="
              chosenCalendars.includes(source.id)
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-line bg-surface text-muted hover:bg-surface-2'
            "
            :aria-pressed="chosenCalendars.includes(source.id)"
            @click="toggleCalendar(source.id)"
          >
            <span class="size-2.5 shrink-0 rounded-full" :style="{ background: source.colour }" />
            {{ source.name }}
          </button>
        </div>
      </Field>

      <!-- Recent history, because the most common question about a notification
           system is "did it send that, or did my phone eat it?" -->
      <Field v-if="status && status.recent.length > 0" label="Recently">
        <ul class="flex flex-col gap-1 text-xs">
          <li v-for="entry in status.recent.slice(0, 8)" :key="entry.key" class="flex items-baseline gap-2">
            <span
              class="shrink-0 font-medium"
              :class="entry.sentAt ? 'text-success' : 'text-faint'"
              :title="entry.suppressed ?? 'sent'"
            >
              {{ entry.sentAt ? 'sent' : (entry.suppressed ?? 'held') }}
            </span>
            <span class="min-w-0 truncate text-muted">{{ entry.title }} - {{ entry.body }}</span>
          </li>
        </ul>
      </Field>
    </template>
  </div>
</template>
