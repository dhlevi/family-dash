<script setup lang="ts">
import { ref } from 'vue'
import { RouterLink } from 'vue-router'
import ShoppingList from '@/components/meals/ShoppingList.vue'
import Icon from '@/components/ui/Icon.vue'

/**
 * The shopping list on its own.
 *
 * This is where the QR code lands, so it is the one page in the app most
 * likely to be opened on a phone in a supermarket rather than on the wall
 * display. It shows nothing but the list, polls so two people stay in step,
 * and keeps a way back to the rest of the app for anyone who arrives here by
 * accident.
 */
const remaining = ref(0)
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-4 py-2">
      <RouterLink
        to="/meals?tab=shopping"
        class="flex min-h-11 items-center gap-1.5 rounded-card px-2 text-sm font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
      >
        <Icon name="chevronLeft" :size="18" />
        Meals
      </RouterLink>

      <span class="ml-auto text-sm text-faint"> {{ remaining }} to get </span>
    </div>

    <ShoppingList @changed="remaining = $event" />
  </div>
</template>
