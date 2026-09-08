<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { RouterView } from 'vue-router'
import AppHeader from '@/components/ui/AppHeader.vue'
import AppNav from '@/components/ui/AppNav.vue'
import Screensaver from '@/components/ui/Screensaver.vue'
import { useIdle } from '@/composables/useIdle'
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

onMounted(() => {
  system.startPolling()
  // Loaded here rather than per-page so the theme and accent are applied
  // before the first paint of whichever tab the kiosk opens on.
  void settings.load()
})
onBeforeUnmount(() => system.stopPolling())
</script>

<template>
  <div class="flex h-full w-full overflow-hidden bg-bg landscape:flex-row portrait:flex-col-reverse">
    <AppNav />

    <main class="flex min-h-0 min-w-0 flex-1 flex-col">
      <AppHeader />

      <RouterView v-slot="{ Component }">
        <!-- Views are lazy; without a fallback the pane flashes empty on the
             first visit to each tab. -->
        <Suspense>
          <component :is="Component" />
        </Suspense>
      </RouterView>
    </main>

    <!-- Over everything, the nav rail included: an idle wall display should
         be showing photographs, not a dimmed copy of the dashboard. -->
    <Screensaver v-if="idle" @wake="wake" />
  </div>
</template>
