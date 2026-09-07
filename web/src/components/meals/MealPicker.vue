<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { ApiRequestError } from '@/api/client'
import { recipesApi } from '@/api/meals'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { formatDate } from '@/utils/datetime'
import { MEAL_SLOT_LABELS, type MealPlanEntry, type MealSlot, type Recipe } from '@/api/types'

/**
 * Choosing what goes in one slot of the week.
 *
 * Offers the recipe library *and* a free-text box, because half of what a
 * household eats is "leftovers" or "fish and chips" — things that will never
 * be recipes, and forcing them to be would make the planner unusable.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    planDate: string | null
    /**
     * Named `mealSlot`, not `slot`: `slot` is a reserved attribute in Vue
     * templates and binding a prop to it is deprecated.
     */
    mealSlot: MealSlot | null
    /** The entry already in this slot, when there is one. */
    existing: MealPlanEntry | null
    /**
     * Opened from a recipe's "Plan it" button: start with that recipe
     * chosen, so the only thing left to pick is the day.
     */
    preselectRecipeId?: string | null
    saving?: boolean
    error?: string | null
  }>(),
  { preselectRecipeId: null, saving: false, error: null }
)

const emit = defineEmits<{
  close: []
  save: [entry: { recipeId?: string | null; customText?: string | null; notes?: string | null }]
  clear: []
}>()

const recipes = ref<Recipe[]>([])
const loadingRecipes = ref(false)
const recipeError = ref<string | null>(null)

const search = ref('')
const customText = ref('')
const notes = ref('')
const selectedRecipeId = ref<string | null>(null)

const heading = computed(() => {
  if (!props.planDate || !props.mealSlot) return 'Plan a meal'

  // Parsed as local so the heading names the day that was tapped.
  const [year, month, day] = props.planDate.split('-').map(Number)
  const date = new Date(year!, (month ?? 1) - 1, day ?? 1)

  return `${MEAL_SLOT_LABELS[props.mealSlot]} · ${formatDate(date)}`
})

watch(
  () => [props.open, props.planDate, props.mealSlot, props.preselectRecipeId] as const,
  async ([isOpen]) => {
    if (!isOpen) return

    search.value = ''
    customText.value = props.existing?.customText ?? ''
    notes.value = props.existing?.notes ?? ''
    selectedRecipeId.value = props.preselectRecipeId ?? props.existing?.recipeId ?? null

    if (recipes.value.length === 0) await loadRecipes()
  },
  { immediate: true }
)

async function loadRecipes(): Promise<void> {
  loadingRecipes.value = true
  recipeError.value = null

  try {
    recipes.value = await recipesApi.list({ limit: 300 })
  } catch (caught) {
    recipeError.value = caught instanceof ApiRequestError ? caught.message : 'Could not load recipes'
  } finally {
    loadingRecipes.value = false
  }
}

const matches = computed(() => {
  const term = search.value.trim().toLowerCase()
  if (term.length === 0) return recipes.value

  return recipes.value.filter(
    recipe => recipe.title.toLowerCase().includes(term) || recipe.tags.some(tag => tag.toLowerCase().includes(term))
  )
})

function choose(recipe: Recipe): void {
  selectedRecipeId.value = recipe.id
  // A recipe and free text are mutually exclusive — the slot has to mean
  // one thing.
  customText.value = ''
}

const canSave = computed(() => (selectedRecipeId.value !== null || customText.value.trim().length > 0) && !props.saving)

function submit(): void {
  if (!canSave.value) return

  emit('save', {
    recipeId: selectedRecipeId.value,
    customText: selectedRecipeId.value ? null : customText.value.trim(),
    notes: notes.value.trim() || null
  })
}
</script>

<template>
  <Modal :open="open" :title="heading" :busy="saving" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <!-- Free text first: it is the quicker of the two most of the time. -->
      <Field label="Something simple" for="meal-custom" hint="Leftovers, takeaway, out — anything without a recipe">
        <TextInput
          id="meal-custom"
          v-model="customText"
          placeholder="Leftovers"
          :disabled="saving"
          @update:model-value="selectedRecipeId = null"
          @enter="submit"
        />
      </Field>

      <div class="flex items-center gap-3">
        <span class="h-px flex-1 bg-line" />
        <span class="text-xs font-medium tracking-wider text-faint uppercase">or a recipe</span>
        <span class="h-px flex-1 bg-line" />
      </div>

      <TextInput v-model="search" type="search" placeholder="Search recipes" :disabled="saving" />

      <div v-if="loadingRecipes" class="flex justify-center py-6">
        <Spinner :size="24">Loading recipes…</Spinner>
      </div>

      <p v-else-if="recipeError" class="text-sm text-danger">{{ recipeError }}</p>

      <p v-else-if="recipes.length === 0" class="rounded-card bg-surface-2 px-3 py-2.5 text-sm text-muted">
        No recipes saved yet. Add one on the Recipes tab and it can go on any day of any week.
      </p>

      <p v-else-if="matches.length === 0" class="text-sm text-faint">Nothing matches “{{ search }}”.</p>

      <ul v-else class="fd-scroll flex max-h-64 flex-col gap-1">
        <li v-for="recipe in matches" :key="recipe.id">
          <button
            type="button"
            class="flex min-h-touch w-full items-center gap-3 rounded-card border px-3 text-left transition-colors"
            :class="
              recipe.id === selectedRecipeId ? 'border-accent bg-accent-soft' : 'border-transparent hover:bg-surface-2'
            "
            :disabled="saving"
            @click="choose(recipe)"
          >
            <Icon
              :name="recipe.id === selectedRecipeId ? 'check' : 'meals'"
              :size="18"
              :class="recipe.id === selectedRecipeId ? 'text-accent' : 'text-faint'"
            />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium text-ink">{{ recipe.title }}</span>
              <span v-if="recipe.tags.length > 0" class="block truncate text-xs text-faint">
                {{ recipe.tags.join(' · ') }}
              </span>
            </span>
            <Icon v-if="recipe.favourite" name="check" :size="14" class="shrink-0 text-warn" />
          </button>
        </li>
      </ul>

      <Field label="Note" for="meal-notes" hint="Optional — 'defrost the mince', 'Sam is out'">
        <TextInput id="meal-notes" v-model="notes" placeholder="Optional" :disabled="saving" />
      </Field>
    </div>

    <template #actions>
      <ToolButton
        v-if="existing"
        icon="trash"
        label="Clear"
        variant="danger"
        :disabled="saving"
        @click="emit('clear')"
      />
      <span class="flex-1" />
      <ToolButton label="Cancel" :disabled="saving" @click="emit('close')" />
      <ToolButton
        icon="check"
        :label="saving ? 'Saving…' : 'Save'"
        variant="primary"
        :disabled="!canSave"
        @click="submit"
      />
    </template>
  </Modal>
</template>
