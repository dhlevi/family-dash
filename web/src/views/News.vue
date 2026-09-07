<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * News page. RSS-based, since Google News has no official public API.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="news"
      title="News is coming"
      description="Headlines aggregated from the RSS feeds configured in Settings, refreshed in the background."
    />
  </PageShell>
</template>
