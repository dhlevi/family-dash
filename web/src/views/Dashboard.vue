<script setup lang="ts">
import { computed, onMounted } from 'vue'
import CalendarWidget from '@/components/dashboard/CalendarWidget.vue'
import MealWidget from '@/components/dashboard/MealWidget.vue'
import NewsWidget from '@/components/dashboard/NewsWidget.vue'
import WeatherWidget from '@/components/dashboard/WeatherWidget.vue'
import NotesWidget from '@/components/dashboard/NotesWidget.vue'
import TasksWidget from '@/components/dashboard/TasksWidget.vue'
import WidgetShell from '@/components/dashboard/WidgetShell.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
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

/** Widgets still waiting on their feature, with what they are waiting for. */
const placeholders: Array<{
  widget: DashboardWidget
  title: string
  icon: 'photos'
  to: string
  empty: string
  description: string
}> = [
  {
    widget: 'photos',
    title: 'Photos',
    icon: 'photos',
    to: '/photos',
    empty: 'No photos yet',
    description: 'Upload photos, or point the app at a folder on the Pi.'
  }
]

const visiblePlaceholders = computed(() => placeholders.filter(item => shows(item.widget)))
</script>

<template>
  <div class="fd-scroll min-h-0 flex-1 p-4">
    <div class="grid auto-rows-[minmax(16rem,1fr)] grid-cols-[repeat(auto-fit,minmax(23rem,1fr))] gap-4">
      <CalendarWidget v-if="shows('calendar')" />
      <TasksWidget v-if="shows('tasks')" />
      <NotesWidget v-if="shows('notes')" />
      <MealWidget v-if="shows('meal')" />
      <WeatherWidget v-if="shows('weather')" />
      <NewsWidget v-if="shows('news')" />

      <WidgetShell
        v-for="item in visiblePlaceholders"
        :key="item.widget"
        :title="item.title"
        :icon="item.icon"
        :to="item.to"
      >
        <EmptyState :icon="item.icon" :title="item.empty" :description="item.description" />
      </WidgetShell>
    </div>

    <p v-if="visible.length === 0" class="py-16 text-center text-sm text-faint">
      Every dashboard widget is switched off. Turn some back on in Settings.
    </p>
  </div>
</template>
