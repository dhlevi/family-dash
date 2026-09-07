<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { mealPlanApi, shoppingApi } from '@/api/meals'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import WidgetShell from './WidgetShell.vue'
import { toDateInput } from '@/utils/datetime'
import { MEAL_SLOT_LABELS, type MealPlanEntry } from '@/api/types'

/**
 * What is planned for today, with the shopping list's outstanding count.
 *
 * "What's for dinner" is the question this widget exists to answer, so the
 * main meal is given the most room and the rest are listed under it.
 */
const meals = ref<MealPlanEntry[]>([])
const remaining = ref(0)
const loading = ref(true)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null

  try {
    const [today, list] = await Promise.all([mealPlanApi.today(toDateInput(new Date())), shoppingApi.list()])

    meals.value = today
    remaining.value = list.remaining
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the meal plan'
  } finally {
    loading.value = false
  }
}

onMounted(load)

const dinner = computed(() => meals.value.find(meal => meal.slot === 'dinner') ?? null)
const others = computed(() => meals.value.filter(meal => meal.slot !== 'dinner'))

function describe(meal: MealPlanEntry): string {
  return meal.recipeTitle ?? meal.customText ?? '—'
}

const badge = computed(() => (remaining.value > 0 ? `${remaining.value} to buy` : null))
</script>

<template>
  <WidgetShell title="Tonight's meal" icon="meals" to="/meals" :loading="loading" :error="error" :badge="badge">
    <EmptyState
      v-if="!loading && meals.length === 0"
      icon="meals"
      title="Nothing planned today"
      description="Plan the week on the Meals page — the shopping list builds itself from it."
    />

    <div v-else class="flex min-h-0 flex-1 flex-col gap-3 p-4">
      <div v-if="dinner" class="min-w-0">
        <p class="text-xs font-semibold tracking-wider text-faint uppercase">Dinner</p>
        <p class="mt-0.5 text-lg leading-snug font-semibold break-words text-ink">{{ describe(dinner) }}</p>
        <p v-if="dinner.notes" class="mt-0.5 text-xs text-muted">{{ dinner.notes }}</p>
      </div>

      <ul v-if="others.length > 0" class="flex flex-col gap-1.5">
        <li v-for="meal in others" :key="meal.id" class="flex items-baseline gap-2 text-sm">
          <span class="w-16 shrink-0 text-xs text-faint">{{ MEAL_SLOT_LABELS[meal.slot] }}</span>
          <span class="min-w-0 flex-1 truncate text-ink">{{ describe(meal) }}</span>
        </li>
      </ul>

      <RouterLink
        v-if="remaining > 0"
        to="/meals?tab=shopping"
        class="mt-auto flex items-center gap-2 rounded-card bg-surface-2 px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-3"
      >
        <Icon name="meals" :size="16" class="text-accent" />
        <span class="min-w-0 flex-1">{{ remaining }} still to buy</span>
        <Icon name="chevronRight" :size="16" class="text-faint" />
      </RouterLink>
    </div>
  </WidgetShell>
</template>
