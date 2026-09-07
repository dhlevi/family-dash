<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Weather page.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="weather"
      title="Weather is coming"
      description="Current conditions, an hourly strip and a seven-day outlook from Open-Meteo, which needs no API key."
    />
  </PageShell>
</template>
