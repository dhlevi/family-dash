<script setup lang="ts">
import { computed } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import Icon from './Icon.vue'

/**
 * The persistent tab bar.
 *
 * A vertical rail down the left edge in landscape, a horizontal bar across
 * the bottom in portrait. In both cases along the edge a hand reaches
 * first. Targets are at least 48px in the direction of travel, and labels
 * stay visible: on a shared family display, an icon-only rail means somebody
 * always has to guess.
 */
const route = useRoute()
const router = useRouter()

const tabs = computed(() =>
  router.getRoutes().filter(candidate => candidate.meta?.title && !candidate.meta.hidden && candidate.name)
)

const isActive = (path: string) => (path === '/' ? route.path === '/' : route.path.startsWith(path))
</script>

<template>
  <nav
    aria-label="Sections"
    class="flex shrink-0 gap-1 border-line bg-surface landscape:w-[5.5rem] landscape:flex-col landscape:border-r landscape:py-3 landscape:pl-[env(safe-area-inset-left)] portrait:h-[4.75rem] portrait:flex-row portrait:border-t portrait:px-2 portrait:pb-[env(safe-area-inset-bottom)] fd-scroll-x portrait:overflow-x-auto landscape:overflow-y-auto landscape:overflow-x-hidden"
  >
    <RouterLink
      v-for="tab in tabs"
      :key="String(tab.name)"
      :to="tab.path"
      class="group flex flex-col items-center justify-center gap-1 rounded-card text-faint transition-colors duration-150 active:bg-surface-3 landscape:min-h-touch landscape:w-full landscape:shrink-0 landscape:py-2 portrait:h-full portrait:min-w-[4.5rem] portrait:flex-1 portrait:px-1"
      :class="isActive(tab.path) ? 'bg-accent-soft text-accent' : 'hover:bg-surface-2 hover:text-muted'"
      :aria-current="isActive(tab.path) ? 'page' : undefined"
    >
      <Icon :name="tab.meta.icon" :size="24" :stroke-width="isActive(tab.path) ? 2 : 1.75" />
      <span class="text-[0.6875rem] leading-none font-medium tracking-tight">{{ tab.meta.title }}</span>
    </RouterLink>
  </nav>
</template>
