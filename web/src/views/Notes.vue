<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Sticky notes page. Lands in the next pass.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="notes"
      title="Sticky notes are coming next"
      description="A draggable corkboard. Note positions are stored as fractions of the board so they survive a screen rotation."
    />
  </PageShell>
</template>
