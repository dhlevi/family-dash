<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Freehand drawing page.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="draw"
      title="The drawing page is coming"
      description="A full-bleed canvas driven by pointer events, so a stylus gets pressure and tilt. Saved sketches stay editable."
    />
  </PageShell>
</template>
