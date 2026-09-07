<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Calendar page. Lands in the next pass together with the calendar provider seam (local events and ICS feed subscriptions).
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="calendar"
      title="Calendar is coming next"
      description="Month, week and agenda views over every configured source, with tap-to-create local events."
    />
  </PageShell>
</template>
