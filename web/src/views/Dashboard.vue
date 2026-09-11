<script setup lang="ts">
import { computed, onMounted } from 'vue'
import BinsWidget from '@/components/dashboard/BinsWidget.vue'
import CalendarWidget from '@/components/dashboard/CalendarWidget.vue'
import MealWidget from '@/components/dashboard/MealWidget.vue'
import NewsWidget from '@/components/dashboard/NewsWidget.vue'
import WeatherWidget from '@/components/dashboard/WeatherWidget.vue'
import NotesWidget from '@/components/dashboard/NotesWidget.vue'
import PeopleWidget from '@/components/dashboard/PeopleWidget.vue'
import PhotosWidget from '@/components/dashboard/PhotosWidget.vue'
import TasksWidget from '@/components/dashboard/TasksWidget.vue'
import { useSettingsStore } from '@/stores/settings'
import type { DashboardWidget } from '@/api/types'

/**
 * The at-a-glance view.
 *
 * The grid is auto-fitting rather than a fixed column count, so the same
 * markup gives around four columns on the 16" panel in landscape and two or
 * three in portrait, with no orientation-specific breakpoints. Each widget
 * is a fixed-height tile that scrolls internally, so the page itself never
 * scrolls and the layout is stable as data arrives.
 *
 * Which widgets appear comes from Settings. Each one loads its own data, so
 * a slow feed cannot hold up the calendar and the task list.
 */
const settings = useSettingsStore()

onMounted(() => {
  if (!settings.loaded) void settings.load()
})

const visible = computed<DashboardWidget[]>(() => (settings.loaded ? settings.dashboardWidgets : ['calendar', 'tasks']))

function shows(widget: DashboardWidget): boolean {
  return visible.value.includes(widget)
}
</script>

<template>
  <div class="fd-scroll min-h-0 flex-1 p-4">
    <div class="grid auto-rows-[minmax(16rem,0.5fr)] grid-cols-[repeat(auto-fit,minmax(23rem,1fr))] gap-4">
      <!-- The strip spans the grid: it is a row of people, not a tile, and
           at tile width three columns would already be scrolling. -->
      <PeopleWidget v-if="shows('people')" />
      <CalendarWidget v-if="shows('calendar')" />
      <TasksWidget v-if="shows('tasks')" />
      <BinsWidget v-if="shows('bins')" />
      <NotesWidget v-if="shows('notes')" />
      <MealWidget v-if="shows('meal')" />
      <WeatherWidget v-if="shows('weather')" />
      <NewsWidget v-if="shows('news')" />
      <PhotosWidget v-if="shows('photos')" />
    </div>

    <p v-if="visible.length === 0" class="py-16 text-center text-sm text-faint">
      Every dashboard widget is switched off. Turn some back on in Settings.
    </p>
  </div>
</template>
