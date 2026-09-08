<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { recipesApi } from '@/api/meals'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import type { Recipe } from '@/api/types'

/**
 * Reading a recipe, with a serving-count stepper.
 *
 * Scaling is done by the API rather than in the browser so the arithmetic —
 * and the fraction formatting that keeps "2/3 cup" from becoming
 * "0.6666666666666666 cup" — lives in one place, next to the same code the
 * shopping list uses.
 */
const props = defineProps<{ open: boolean; recipe: Recipe | null }>()

const emit = defineEmits<{ close: []; edit: [recipe: Recipe]; plan: [recipe: Recipe] }>()

const servings = ref(1)
const scaled = ref<Recipe | null>(null)
const scaling = ref(false)
const scaleError = ref<string | null>(null)

watch(
  () => [props.open, props.recipe] as const,
  ([open, recipe]) => {
    if (!open || !recipe) return

    servings.value = recipe.servings ?? 0
    scaled.value = null
    scaleError.value = null
  },
  { immediate: true }
)

/** The recipe as currently shown: the original, or the scaled version. */
const shown = computed(() => scaled.value ?? props.recipe)

const canScale = computed(() => Boolean(props.recipe?.servings && props.recipe.servings > 0))

async function rescale(next: number): Promise<void> {
  servings.value = next

  if (!props.recipe || !canScale.value) return

  if (next === props.recipe.servings) {
    scaled.value = null
    return
  }

  scaling.value = true
  scaleError.value = null

  try {
    scaled.value = await recipesApi.scaled(props.recipe.id, next)
  } catch (caught) {
    scaleError.value = caught instanceof ApiRequestError ? caught.message : 'Could not scale the recipe'
  } finally {
    scaling.value = false
  }
}

const totalMinutes = computed(() => {
  const prep = props.recipe?.prepMinutes ?? 0
  const cook = props.recipe?.cookMinutes ?? 0
  return prep + cook
})

function describe(ingredient: { quantity: string | null; unit: string | null; item: string }): string {
  return [ingredient.quantity, ingredient.unit, ingredient.item]
    .filter(part => part && part.trim().length > 0)
    .join(' ')
}
</script>

<template>
  <Modal :open="open" :title="recipe?.title ?? 'Recipe'" @close="emit('close')">
    <div v-if="recipe" class="flex flex-col gap-4">
      <img
        v-if="recipe.photoUrl"
        :src="recipe.photoUrl"
        :alt="recipe.title"
        class="max-h-64 w-full rounded-card object-cover"
      />

      <p v-if="recipe.description" class="text-sm text-muted">{{ recipe.description }}</p>

      <div class="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-muted">
        <span v-if="totalMinutes > 0" class="flex items-center gap-1.5">
          <Icon name="clock" :size="16" />
          {{ totalMinutes }} min
          <span v-if="recipe.prepMinutes && recipe.cookMinutes" class="text-faint">
            ({{ recipe.prepMinutes }} prep + {{ recipe.cookMinutes }} cook)
          </span>
        </span>

        <span v-if="recipe.tags.length > 0" class="flex flex-wrap gap-1.5">
          <span
            v-for="tag in recipe.tags"
            :key="tag"
            class="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted"
          >
            {{ tag }}
          </span>
        </span>
      </div>

      <!-- Scaling -->
      <div v-if="canScale" class="flex flex-wrap items-center gap-3 rounded-card bg-surface-2 px-3 py-2.5">
        <span class="text-sm font-medium text-ink">Serves</span>
        <NumberStepper :model-value="servings" :min="1" :max="50" @update:model-value="rescale" />
        <span v-if="scaling" class="text-xs text-faint">Scaling…</span>
        <span v-else-if="scaled" class="text-xs text-accent"> Scaled from {{ recipe.servings }} </span>
        <span v-if="scaleError" class="text-xs text-danger">{{ scaleError }}</span>
      </div>

      <!-- Ingredients -->
      <section v-if="shown && shown.ingredients.length > 0">
        <h3 class="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Ingredients</h3>
        <ul class="flex flex-col gap-1">
          <li v-for="(ingredient, index) in shown.ingredients" :key="index" class="flex gap-2 text-sm text-ink">
            <span class="text-faint">·</span>
            <span>{{ describe(ingredient) }}</span>
          </li>
        </ul>
      </section>

      <!-- Method -->
      <section v-if="recipe.steps.length > 0">
        <h3 class="mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Method</h3>
        <ol class="flex flex-col gap-2.5">
          <li v-for="(step, index) in recipe.steps" :key="index" class="flex gap-3 text-sm text-ink">
            <span
              class="grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted"
            >
              {{ index + 1 }}
            </span>
            <span class="fd-selectable">{{ step }}</span>
          </li>
        </ol>
      </section>

      <a
        v-if="recipe.sourceUrl"
        :href="recipe.sourceUrl"
        target="_blank"
        rel="noopener"
        class="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline"
      >
        Original recipe
        <Icon name="chevronRight" :size="14" />
      </a>
    </div>

    <template #actions>
      <ToolButton v-if="recipe" icon="edit" label="Edit" @click="emit('edit', recipe)" />
      <span class="flex-1" />
      <ToolButton label="Close" @click="emit('close')" />
      <ToolButton v-if="recipe" icon="calendar" label="Plan it" variant="primary" @click="emit('plan', recipe)" />
    </template>
  </Modal>
</template>
