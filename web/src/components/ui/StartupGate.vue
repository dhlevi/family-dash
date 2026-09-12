<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'

/**
 * Shown instead of the dashboard until the API answers for the first time.
 *
 * The kiosk browser is started by the desktop session, which on a Pi is up
 * long before the API: that waits on Postgres passing its healthcheck and
 * then runs migrations. Without this, every widget mounts into a stack that
 * is not listening yet, fails, and stays failed - a wall of red that only
 * clears if somebody walks over and changes tabs.
 *
 * Waiting is the honest thing to show, because nothing is wrong yet. Only
 * after long enough that it probably is do we say where to look.
 */
/** How long a cold boot is allowed to take before we stop calling it normal. */
const PATIENCE_MS = 45000

const waitedTooLong = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

onMounted(() => {
  timer = setTimeout(() => (waitedTooLong.value = true), PATIENCE_MS)
})
onBeforeUnmount(() => clearTimeout(timer))

const message = computed(() =>
  waitedTooLong.value ? 'The dashboard service is taking longer than it should' : 'Starting the dashboard'
)
</script>

<template>
  <div class="flex h-full w-full flex-col items-center justify-center gap-6 bg-bg p-8 text-center">
    <Icon
      :name="waitedTooLong ? 'warning' : 'dashboard'"
      :size="48"
      :class="waitedTooLong ? 'text-warn' : 'text-accent'"
    />

    <div class="flex flex-col items-center gap-2">
      <p class="text-lg font-medium text-ink">{{ message }}</p>
      <p class="max-w-md text-sm text-muted">
        <template v-if="waitedTooLong">
          It will keep trying. If this does not clear, check the API container with
          <code class="rounded bg-surface-2 px-1.5 py-0.5 text-xs">docker compose logs api</code>.
        </template>
        <template v-else> Waiting for the service to finish starting. This clears itself. </template>
      </p>
    </div>

    <Spinner :size="20" label="Waiting for the dashboard service" />
  </div>
</template>
