<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import WidgetShell from '@/components/dashboard/WidgetShell.vue'

/**
 * The at-a-glance view.
 *
 * The grid is auto-fitting rather than a fixed column count, so the same
 * markup gives roughly three columns on the 16" panel in landscape and one
 * or two in portrait without a breakpoint per orientation. Each widget is a
 * fixed-height tile that scrolls internally, so the page itself never
 * scrolls and the layout is stable as data arrives.
 *
 * The widget bodies are placeholders until their features land; the frames,
 * the grid behaviour and the navigation are real.
 */
</script>

<template>
  <div class="fd-scroll min-h-0 flex-1 p-4">
    <div class="grid auto-rows-[minmax(16rem,1fr)] grid-cols-[repeat(auto-fit,minmax(23rem,1fr))] gap-4">
      <WidgetShell title="Up next" icon="calendar" to="/calendar">
        <EmptyState
          icon="calendar"
          title="No calendar sources yet"
          description="Add a calendar in Settings, or create an event on the Calendar page."
        />
      </WidgetShell>

      <WidgetShell title="Today's tasks" icon="tasks" to="/tasks">
        <EmptyState icon="tasks" title="Nothing due today" description="Add tasks and chores from the Tasks page." />
      </WidgetShell>

      <WidgetShell title="Weather" icon="weather" to="/weather">
        <EmptyState icon="weather" title="Weather not loaded yet" description="Set your location in Settings." />
      </WidgetShell>

      <WidgetShell title="Tonight's meal" icon="meals" to="/meals">
        <EmptyState icon="meals" title="No meal planned" description="Plan the week on the Meals page." />
      </WidgetShell>

      <WidgetShell title="Notes" icon="notes" to="/notes">
        <EmptyState icon="notes" title="No pinned notes" description="Pin a sticky note to show it here." />
      </WidgetShell>

      <WidgetShell title="Headlines" icon="news" to="/news">
        <EmptyState
          icon="news"
          title="No headlines yet"
          description="Feeds refresh in the background once configured."
        />
      </WidgetShell>

      <WidgetShell title="Photos" icon="photos" to="/photos">
        <EmptyState icon="photos" title="No photos yet" description="Upload photos or point the app at a folder." />
      </WidgetShell>
    </div>
  </div>
</template>
