<script setup lang="ts">
import EmptyState from '@/components/ui/EmptyState.vue'
import PageShell from '@/components/ui/PageShell.vue'

/**
 * Photo library page. Backed by the local media volume rather than Google Photos, whose Library API can no longer list a user's own library.
 */
</script>

<template>
  <PageShell>
    <EmptyState
      icon="photos"
      title="Photos are coming"
      description="Browse albums from the mounted media folder, upload new pictures, and run a full-screen slideshow."
    />
  </PageShell>
</template>
