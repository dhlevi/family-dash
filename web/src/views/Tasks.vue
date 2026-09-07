<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Tasks and chores page. Lands in the next pass.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="tasks"
      title="Tasks and chores are coming next"
      description="Quick-add, due dates, recurring chores and a board view, with today's items surfaced on the dashboard."
    />
  </PageShell>
</template>
