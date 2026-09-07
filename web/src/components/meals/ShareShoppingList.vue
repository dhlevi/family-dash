<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { shoppingApi } from '@/api/meals'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import QrCode from '@/components/ui/QrCode.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'

/**
 * Getting the shopping list onto a phone.
 *
 * The app already serves over the home network, so any phone on the same
 * wifi can open the list directly — the only thing missing is a way to hand
 * over the address without reciting an IP. Scanning a QR does that, and
 * because the phone then loads the live list rather than a copy, ticking
 * items off there shows up on the wall display too.
 *
 * Copy and Share are the fallbacks for anyone not on the network, at the
 * cost of being a snapshot.
 */
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

const settings = useSettingsStore()

const text = ref('')
const loading = ref(false)
const error = ref<string | null>(null)
const copied = ref(false)

const lanAddress = ref('')
const savingAddress = ref(false)
const addressError = ref<string | null>(null)

const origin = computed(() => (typeof window === 'undefined' ? '' : window.location.origin))

/**
 * Whether this page is being viewed *on* the machine that serves it.
 *
 * This is the normal case on the Pi: the kiosk browser is pointed at
 * localhost, so the address bar holds something no other device can reach.
 * Encoding that into a QR gives a code that scans perfectly and then fails
 * to load — the worst kind of broken, because it looks like it worked.
 */
const isLocalOrigin = computed(() => /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(origin.value))

/** A LAN address recorded in Settings, used when the origin is not shareable. */
const configuredAddress = computed(() => settings.get('network.lanAddress', '').trim())

const needsAddress = computed(() => isLocalOrigin.value && configuredAddress.value.length === 0)

const shareUrl = computed(() => {
  const base = configuredAddress.value || origin.value
  return base.length === 0 ? '' : `${base.replace(/\/+$/, '')}/shopping`
})

/** Only offered where the browser actually has a share sheet. */
const canShare = computed(() => typeof navigator !== 'undefined' && typeof navigator.share === 'function')

watch(
  () => props.open,
  async isOpen => {
    if (!isOpen) return

    copied.value = false
    loading.value = true
    error.value = null
    addressError.value = null

    if (!settings.loaded) await settings.load()
    lanAddress.value = configuredAddress.value

    try {
      text.value = (await shoppingApi.text()).text
    } catch (caught) {
      error.value = caught instanceof ApiRequestError ? caught.message : 'Could not build the list'
    } finally {
      loading.value = false
    }
  }
)

async function saveAddress(): Promise<void> {
  const value = lanAddress.value.trim().replace(/\/+$/, '')
  if (value.length === 0) return

  savingAddress.value = true
  addressError.value = null

  try {
    if (!(await settings.set('network.lanAddress', value))) {
      addressError.value = settings.error ?? 'That address was not accepted'
    }
  } finally {
    savingAddress.value = false
  }
}

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(text.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    error.value = 'The browser would not allow copying. Select the text below instead.'
  }
}

async function share(): Promise<void> {
  try {
    await navigator.share({ title: 'Shopping list', text: text.value })
  } catch {
    // A cancelled share sheet is not an error worth reporting.
  }
}
</script>

<template>
  <Modal :open="open" title="Take the list with you" @close="emit('close')">
    <div class="flex flex-col gap-5">
      <!--
        The kiosk browses to localhost, which no phone can reach. Say so
        plainly and take the address once, rather than showing a QR that
        scans and then fails.
      -->
      <div v-if="needsAddress" class="flex flex-col gap-3 rounded-card bg-warn/10 p-3">
        <p class="flex items-start gap-2 text-sm text-ink">
          <Icon name="warning" :size="18" class="mt-0.5 shrink-0 text-warn" />
          <span>
            This screen is showing <code class="font-mono text-xs">{{ origin }}</code
            >, which only works on this machine. Enter the address other devices use to reach the dashboard and the QR
            code will point there.
          </span>
        </p>

        <Field label="Address on your network" for="lan-address" :error="addressError">
          <div class="flex gap-2">
            <TextInput
              id="lan-address"
              v-model="lanAddress"
              type="url"
              placeholder="http://192.168.1.50:8080"
              :disabled="savingAddress"
              @enter="saveAddress"
            />
            <ToolButton
              icon="check"
              label="Save"
              variant="primary"
              :disabled="lanAddress.trim().length === 0 || savingAddress"
              @click="saveAddress"
            />
          </div>
        </Field>

        <p class="text-xs text-muted">
          Find it with <code class="font-mono">hostname -I</code> on the Pi, or use its hostname —
          <code class="font-mono">http://raspberrypi.local:8080</code>. Saved in Settings, so this is a one-off.
        </p>
      </div>

      <div v-else class="flex flex-col items-center gap-3">
        <div class="rounded-card bg-white p-3">
          <QrCode v-if="shareUrl" :value="shareUrl" :size="200" />
        </div>

        <p class="max-w-sm text-center text-sm text-muted">
          Scan this with a phone on the same wifi to open the live list. Ticking things off there shows up here too.
        </p>

        <code class="fd-selectable rounded bg-surface-2 px-2 py-1 font-mono text-xs text-faint">
          {{ shareUrl }}
        </code>

        <button
          v-if="configuredAddress"
          type="button"
          class="text-xs font-medium text-accent hover:underline"
          @click="settings.set('network.lanAddress', '')"
        >
          Not the right address?
        </button>
      </div>

      <div class="flex items-center gap-3">
        <span class="h-px flex-1 bg-line" />
        <span class="text-xs font-medium tracking-wider text-faint uppercase">or send a copy</span>
        <span class="h-px flex-1 bg-line" />
      </div>

      <div class="flex flex-wrap gap-2">
        <ToolButton
          :icon="copied ? 'check' : 'notes'"
          :label="copied ? 'Copied' : 'Copy as text'"
          :disabled="loading || text.length === 0"
          @click="copy"
        />
        <ToolButton
          v-if="canShare"
          icon="chevronRight"
          label="Share…"
          :disabled="loading || text.length === 0"
          @click="share"
        />
      </div>

      <p v-if="error" class="flex items-start gap-2 text-sm text-danger">
        <Icon name="warning" :size="16" class="mt-0.5 shrink-0" />
        {{ error }}
      </p>

      <pre
        v-if="text"
        class="fd-selectable fd-scroll max-h-48 rounded-card bg-surface-2 p-3 font-mono text-xs whitespace-pre-wrap text-muted"
        >{{ text }}</pre>

      <p class="text-xs text-faint">
        A copy is a snapshot — it will not update as things are ticked off. The QR link will.
      </p>
    </div>

    <template #actions>
      <span class="flex-1" />
      <ToolButton label="Done" variant="primary" @click="emit('close')" />
    </template>
  </Modal>
</template>
