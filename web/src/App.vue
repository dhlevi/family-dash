<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppNav from '@/components/ui/AppNav.vue'
import OnScreenKeyboard from '@/components/ui/OnScreenKeyboard.vue'
import Screensaver from '@/components/ui/Screensaver.vue'
import StartupGate from '@/components/ui/StartupGate.vue'
import { useIdle } from '@/composables/useIdle'
import { useOnScreenKeyboard } from '@/composables/useOnScreenKeyboard'
import { useSolarTheme } from '@/composables/useSolarTheme'
import { useSettingsStore } from '@/stores/settings'
import { useSystemStore } from '@/stores/system'

/**
 * The application shell.
 *
 * Orientation is handled entirely in CSS: `flex-row` with the nav first puts
 * the rail down the left edge in landscape, and `flex-col-reverse` puts the
 * same markup along the bottom in portrait. The nav stays first in the DOM
 * either way, so tab order and screen-reader order match reading order
 * rather than following the visual flip.
 */
const system = useSystemStore()
const settings = useSettingsStore()

// Keeps the automatic theme following the sun. Does nothing unless the theme
// is set to auto.
useSolarTheme()

const { idle, wake } = useIdle(computed(() => settings.screensaverMinutes))

// Watches for a text field being focused anywhere in the app. Does nothing
// on a device with a mouse unless the setting says otherwise.
const keyboard = useOnScreenKeyboard()

onMounted(() => system.startPolling())
onBeforeUnmount(() => system.stopPolling())

/**
 * Settings are loaded here rather than per-page so the theme and accent are
 * applied before the first paint of whichever tab the kiosk opens on - but
 * not until the API is actually answering. Loading them on mount meant that
 * on a cold boot the one request that decides what the whole display looks
 * like was also the one most likely to be made too early, leaving the Pi on
 * default colours until someone reloaded the page.
 */
watch(
  [() => system.everConnected, () => system.generation],
  ([connected]) => {
    if (connected) void settings.load()
  },
  { immediate: true }
)
</script>

<template>
  <div class="flex h-full w-full overflow-hidden bg-bg landscape:flex-row portrait:flex-col-reverse">
    <AppNav />

    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <AppHeader />

      <!-- Nothing below here can load anything until the API answers, so
           until it has answered once, wait rather than mounting a page that
           can only fail. -->
      <StartupGate v-if="!system.everConnected" />

      <RouterView v-else v-slot="{ Component }">
        <!-- Views are lazy; without a fallback the pane flashes empty on the
             first visit to each tab. -->
        <Suspense>
          <!-- Keyed on the connection generation, so an API restart remounts
               the page and reloads every widget on it. Widgets load once on
               mount; without this they keep whatever error they were left
               holding until somebody switches tabs. -->
          <component :is="Component" :key="system.generation" />
        </Suspense>
      </RouterView>
    </main>

    <!-- Above modals, since that is where most typing happens, and below the
         screensaver. -->
    <OnScreenKeyboard
      v-if="keyboard.visible.value"
      :layout="keyboard.layout.value"
      @press="keyboard.press"
      @submit="keyboard.submit"
      @dismiss="keyboard.dismiss"
    />

    <!-- Over everything, the nav rail included: an idle wall display should
         be showing photographs, not a dimmed copy of the dashboard. -->
    <Screensaver v-if="idle" @wake="wake" />
  </div>
</template>
