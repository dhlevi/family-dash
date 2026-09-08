<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ApiRequestError } from '@/api/client'
import { mealPlanApi, recipesApi, shoppingApi } from '@/api/meals'
import MealPicker from '@/components/meals/MealPicker.vue'
import RecipeDetail from '@/components/meals/RecipeDetail.vue'
import RecipeEditor from '@/components/meals/RecipeEditor.vue'
import ShareShoppingList from '@/components/meals/ShareShoppingList.vue'
import ShoppingList from '@/components/meals/ShoppingList.vue'
import WeekPlanner from '@/components/meals/WeekPlanner.vue'
import Card from '@/components/ui/Card.vue'
import EmptyState from '@/components/ui/EmptyState.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { useSettingsStore } from '@/stores/settings'
import { addDays, formatMonthYear, startOfWeek, toDateInput } from '@/utils/datetime'
import type { MealPlanEntry, MealSlot, NewRecipe, Recipe } from '@/api/types'

/**
 * Meals: the week's plan, the recipe library, and the shopping list the two
 * of them produce.
 *
 * One page with three tabs rather than three nav entries — they are the same
 * job seen from different angles, and a household moves between them
 * constantly while planning.
 */
type Tab = 'plan' | 'recipes' | 'shopping'

const settings = useSettingsStore()
const route = useRoute()
const router = useRouter()

const tab = ref<Tab>('plan')

// --- week plan --------------------------------------------------------------

const weekStart = ref(startOfWeek(new Date(), 1))
const entries = ref<MealPlanEntry[]>([])
const planLoading = ref(true)
const error = ref<string | null>(null)

const slots = computed<MealSlot[]>(() => settings.get('meals.slots', ['breakfast', 'lunch', 'dinner']))
const weekStartsOn = computed(() => settings.get('meals.weekStartsOn', 1))

const weekEnd = computed(() => addDays(weekStart.value, 6))
const rangeFrom = computed(() => toDateInput(weekStart.value))
const rangeTo = computed(() => toDateInput(weekEnd.value))

const weekLabel = computed(() => {
  const from = weekStart.value
  const to = weekEnd.value

  return from.getMonth() === to.getMonth()
    ? `${from.getDate()}–${to.getDate()} ${formatMonthYear(from)}`
    : `${from.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} – ` +
        `${to.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}`
})

async function loadPlan(): Promise<void> {
  planLoading.value = true
  error.value = null

  try {
    entries.value = await mealPlanApi.range(rangeFrom.value, rangeTo.value)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the meal plan'
  } finally {
    planLoading.value = false
  }
}

function stepWeek(direction: 1 | -1): void {
  weekStart.value = addDays(weekStart.value, direction * 7)
}

function thisWeek(): void {
  weekStart.value = startOfWeek(new Date(), weekStartsOn.value)
}

watch(weekStart, loadPlan)
watch(weekStartsOn, value => {
  weekStart.value = startOfWeek(weekStart.value, value)
})

// --- slot editing -----------------------------------------------------------

const pickerOpen = ref(false)
const pickerDate = ref<string | null>(null)
const pickerSlot = ref<MealSlot | null>(null)
const savingSlot = ref(false)
const pickerError = ref<string | null>(null)
const preselectRecipeId = ref<string | null>(null)

const pickerExisting = computed(
  () => entries.value.find(entry => entry.planDate === pickerDate.value && entry.slot === pickerSlot.value) ?? null
)

function openPicker(payload: { planDate: string; slot: MealSlot }): void {
  preselectRecipeId.value = null
  pickerDate.value = payload.planDate
  pickerSlot.value = payload.slot
  pickerError.value = null
  pickerOpen.value = true
}

async function saveSlot(entry: {
  recipeId?: string | null
  customText?: string | null
  notes?: string | null
}): Promise<void> {
  if (!pickerDate.value || !pickerSlot.value) return

  savingSlot.value = true
  pickerError.value = null

  try {
    const saved = await mealPlanApi.set({
      planDate: pickerDate.value,
      slot: pickerSlot.value,
      ...entry
    })

    entries.value = [
      ...entries.value.filter(candidate => !(candidate.planDate === saved.planDate && candidate.slot === saved.slot)),
      saved
    ]
    pickerOpen.value = false
  } catch (caught) {
    pickerError.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the meal'
  } finally {
    savingSlot.value = false
  }
}

async function clearSlot(): Promise<void> {
  if (!pickerDate.value || !pickerSlot.value) return

  savingSlot.value = true
  try {
    await mealPlanApi.clearSlot(pickerDate.value, pickerSlot.value)
    entries.value = entries.value.filter(
      candidate => !(candidate.planDate === pickerDate.value && candidate.slot === pickerSlot.value)
    )
    pickerOpen.value = false
  } catch (caught) {
    pickerError.value = caught instanceof ApiRequestError ? caught.message : 'Could not clear the meal'
  } finally {
    savingSlot.value = false
  }
}

// --- week actions -----------------------------------------------------------

const busy = ref(false)
const confirmClear = ref(false)
const notice = ref<string | null>(null)

function announce(message: string): void {
  notice.value = message
  setTimeout(() => (notice.value = null), 4000)
}

/** Copy this week's meals onto next week, then follow them there. */
async function copyToNextWeek(): Promise<void> {
  busy.value = true
  try {
    const { copied } = await mealPlanApi.copy(rangeFrom.value, rangeTo.value, 7)
    announce(`Copied ${copied} meal${copied === 1 ? '' : 's'} to next week`)
    stepWeek(1)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not copy the week'
  } finally {
    busy.value = false
  }
}

async function clearWeek(): Promise<void> {
  busy.value = true
  try {
    await mealPlanApi.clearRange(rangeFrom.value, rangeTo.value)
    entries.value = []
    confirmClear.value = false
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not clear the week'
  } finally {
    busy.value = false
  }
}

/** Rebuild the shopping list from this week, then show it. */
async function buildShoppingList(): Promise<void> {
  busy.value = true
  try {
    const list = await shoppingApi.fromPlan(rangeFrom.value, rangeTo.value)
    shoppingRemaining.value = list.remaining
    tab.value = 'shopping'
    announce(`Shopping list rebuilt from this week — ${list.remaining} to get`)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not build the shopping list'
  } finally {
    busy.value = false
  }
}

// --- recipes ----------------------------------------------------------------

const recipes = ref<Recipe[]>([])
const recipeTags = ref<string[]>([])
const recipesLoading = ref(false)
const recipeSearch = ref('')
const activeTag = ref('')

const editorOpen = ref(false)
const editingRecipe = ref<Recipe | null>(null)
const savingRecipe = ref(false)
const recipeError = ref<string | null>(null)

const detailOpen = ref(false)
const detailRecipe = ref<Recipe | null>(null)

async function loadRecipes(): Promise<void> {
  recipesLoading.value = true
  try {
    const [list, tags] = await Promise.all([
      recipesApi.list({ search: recipeSearch.value.trim() || undefined, tag: activeTag.value || undefined }),
      recipesApi.tags()
    ])
    recipes.value = list
    recipeTags.value = tags
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load recipes'
  } finally {
    recipesLoading.value = false
  }
}

/** Filtering by tag re-queries rather than filtering the loaded page. */
async function filterByTag(tag: string): Promise<void> {
  activeTag.value = tag
  await loadRecipes()
}

function openRecipeEditor(recipe: Recipe | null): void {
  editingRecipe.value = recipe
  recipeError.value = null
  detailOpen.value = false
  editorOpen.value = true
}

async function saveRecipe(changes: NewRecipe): Promise<void> {
  savingRecipe.value = true
  recipeError.value = null

  try {
    if (editingRecipe.value) {
      const updated = await recipesApi.update(editingRecipe.value.id, changes)
      recipes.value = recipes.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
    } else {
      recipes.value = [...recipes.value, await recipesApi.add(changes)]
    }

    editorOpen.value = false
    void loadRecipes()
  } catch (caught) {
    recipeError.value = caught instanceof ApiRequestError ? describeError(caught) : 'Could not save the recipe'
  } finally {
    savingRecipe.value = false
  }
}

async function removeRecipe(recipe: Recipe): Promise<void> {
  savingRecipe.value = true
  try {
    await recipesApi.remove(recipe.id)
    recipes.value = recipes.value.filter(candidate => candidate.id !== recipe.id)
    editorOpen.value = false
    // A planned meal keeps its slot when its recipe goes, so the week is
    // worth reloading to pick up the change.
    void loadPlan()
  } catch (caught) {
    recipeError.value = caught instanceof ApiRequestError ? caught.message : 'Could not delete the recipe'
  } finally {
    savingRecipe.value = false
  }
}

function openDetail(recipe: Recipe): void {
  detailRecipe.value = recipe
  detailOpen.value = true
}

/**
 * "Plan it" from a recipe: jump to the week with the recipe already chosen,
 * so all that is left is picking the day.
 */
function planRecipe(recipe: Recipe): void {
  detailOpen.value = false
  tab.value = 'plan'

  const mainSlot: MealSlot = slots.value.includes('dinner') ? 'dinner' : (slots.value[0] ?? 'dinner')

  preselectRecipeId.value = recipe.id
  pickerDate.value = toDateInput(new Date())
  pickerSlot.value = mainSlot
  pickerError.value = null
  pickerOpen.value = true
}

// --- shopping ---------------------------------------------------------------

const shoppingRemaining = ref(0)
const shareOpen = ref(false)

function describeError(caught: ApiRequestError): string {
  const details = caught.details
  if (Array.isArray(details)) {
    return details.map(issue => (issue as { message?: string }).message ?? String(issue)).join('; ')
  }
  return caught.message
}

// --- lifecycle --------------------------------------------------------------

onMounted(async () => {
  if (!settings.loaded) await settings.load()

  weekStart.value = startOfWeek(new Date(), weekStartsOn.value)

  // Deep links: /meals?tab=shopping is what the dashboard widget uses.
  const requested = route.query.tab
  if (requested === 'recipes' || requested === 'shopping') tab.value = requested

  await Promise.all([loadPlan(), loadRecipes()])
})

watch(tab, next => {
  // Keep the URL honest so a reload lands on the same tab.
  void router.replace({ query: next === 'plan' ? {} : { tab: next } })
  if (next === 'recipes' && recipes.value.length === 0) void loadRecipes()
})

const tabs = [
  { value: 'plan' as const, label: 'This week' },
  { value: 'recipes' as const, label: 'Recipes' },
  { value: 'shopping' as const, label: 'Shopping' }
]
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- Tabs -->
    <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <SegmentedControl v-model="tab" :options="tabs" />

      <template v-if="tab === 'plan'">
        <div class="ml-auto flex items-center gap-1">
          <ToolButton icon="chevronLeft" label="Previous week" icon-only @click="stepWeek(-1)" />
          <ToolButton label="This week" @click="thisWeek" />
          <ToolButton icon="chevronRight" label="Next week" icon-only @click="stepWeek(1)" />
        </div>
      </template>

      <template v-else-if="tab === 'recipes'">
        <div class="ml-auto flex items-center gap-2">
          <TextInput v-model="recipeSearch" type="search" placeholder="Search recipes" @enter="loadRecipes" />
          <ToolButton icon="plus" label="New recipe" variant="primary" @click="openRecipeEditor(null)" />
        </div>
      </template>

      <template v-else>
        <div class="ml-auto flex items-center gap-2">
          <ToolButton icon="refresh" label="Rebuild from this week" :disabled="busy" @click="buildShoppingList" />
          <ToolButton icon="chevronRight" label="Send to a phone" variant="primary" @click="shareOpen = true" />
        </div>
      </template>
    </div>

    <p
      v-if="notice"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-success/10 px-4 py-2 text-sm text-success"
    >
      <Icon name="check" :size="16" />
      {{ notice }}
    </p>

    <p
      v-if="error"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      <Icon name="warning" :size="16" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="font-medium underline" @click="error = null">Dismiss</button>
    </p>

    <!-- Plan -->
    <template v-if="tab === 'plan'">
      <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <h2 class="min-w-0 flex-1 truncate text-base font-semibold text-ink">{{ weekLabel }}</h2>
        <ToolButton icon="plus" label="Copy to next week" :disabled="busy" @click="copyToNextWeek" />
        <ToolButton icon="meals" label="Build shopping list" :disabled="busy" @click="buildShoppingList" />
        <ToolButton icon="trash" label="Clear week" icon-only :disabled="busy" @click="confirmClear = true" />
      </div>

      <div v-if="planLoading && entries.length === 0" class="flex flex-1 items-center justify-center">
        <Spinner :size="28">Loading the week…</Spinner>
      </div>

      <WeekPlanner v-else :week-start="weekStart" :slots="slots" :entries="entries" @select="openPicker" />
    </template>

    <!-- Recipes -->
    <template v-else-if="tab === 'recipes'">
      <div v-if="recipeTags.length > 0" class="flex shrink-0 flex-wrap gap-1.5 border-b border-line px-4 py-2">
        <button
          type="button"
          class="min-h-9 rounded-full px-3 text-sm font-medium transition-colors"
          :class="activeTag === '' ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="filterByTag('')"
        >
          All
        </button>
        <button
          v-for="tag in recipeTags"
          :key="tag"
          type="button"
          class="min-h-9 rounded-full px-3 text-sm font-medium transition-colors"
          :class="activeTag === tag ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-muted hover:text-ink'"
          @click="filterByTag(tag)"
        >
          {{ tag }}
        </button>
      </div>

      <div v-if="recipesLoading && recipes.length === 0" class="flex flex-1 items-center justify-center">
        <Spinner :size="28">Loading recipes…</Spinner>
      </div>

      <EmptyState
        v-else-if="recipes.length === 0"
        icon="meals"
        title="No recipes yet"
        description="Add a recipe once and it can go on any day of any week. Its ingredients feed the shopping list."
      />

      <div v-else class="fd-scroll min-h-0 flex-1 p-4">
        <div class="grid grid-cols-[repeat(auto-fill,minmax(16rem,1fr))] gap-3">
          <Card v-for="recipe in recipes" :key="recipe.id" interactive @click="openDetail(recipe)">
            <!-- Negative margins cancel the card's p-4 so the picture reaches
                 its edges; the card clips the corners itself. -->
            <img
              v-if="recipe.photoThumbUrl"
              :src="recipe.photoThumbUrl"
              :alt="recipe.title"
              loading="lazy"
              class="-mx-4 -mt-4 mb-3 h-32 w-[calc(100%+2rem)] object-cover"
            />

            <div class="flex items-start gap-2">
              <h3 class="min-w-0 flex-1 text-base font-semibold text-ink">{{ recipe.title }}</h3>
              <Icon v-if="recipe.favourite" name="check" :size="16" class="mt-1 shrink-0 text-warn" />
            </div>

            <p v-if="recipe.description" class="mt-1 line-clamp-2 text-sm text-muted">
              {{ recipe.description }}
            </p>

            <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
              <span v-if="recipe.servings">Serves {{ recipe.servings }}</span>
              <span v-if="(recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) > 0">
                {{ (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0) }} min
              </span>
              <span v-if="recipe.ingredients.length > 0">{{ recipe.ingredients.length }} ingredients</span>
            </div>

            <div v-if="recipe.tags.length > 0" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="tag in recipe.tags"
                :key="tag"
                class="rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] text-muted"
              >
                {{ tag }}
              </span>
            </div>
          </Card>
        </div>
      </div>
    </template>

    <!-- Shopping -->
    <ShoppingList v-else @changed="shoppingRemaining = $event" />

    <!-- Modals -->
    <MealPicker
      :open="pickerOpen"
      :plan-date="pickerDate"
      :meal-slot="pickerSlot"
      :existing="pickerExisting"
      :preselect-recipe-id="preselectRecipeId"
      :saving="savingSlot"
      :error="pickerError"
      @close="pickerOpen = false"
      @save="saveSlot"
      @clear="clearSlot"
    />

    <RecipeEditor
      :open="editorOpen"
      :recipe="editingRecipe"
      :saving="savingRecipe"
      :error="recipeError"
      @close="editorOpen = false"
      @save="saveRecipe"
      @remove="removeRecipe"
    />

    <RecipeDetail
      :open="detailOpen"
      :recipe="detailRecipe"
      @close="detailOpen = false"
      @edit="openRecipeEditor"
      @plan="planRecipe"
    />

    <ShareShoppingList :open="shareOpen" @close="shareOpen = false" />

    <Modal :open="confirmClear" title="Clear this week?" :busy="busy" @close="confirmClear = false">
      <p class="text-sm text-muted">
        Every meal planned for <strong class="font-medium text-ink">{{ weekLabel }}</strong> will be removed. Recipes
        are not affected, and the shopping list is left alone until you rebuild it.
      </p>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" @click="confirmClear = false" />
        <ToolButton icon="trash" label="Clear week" variant="danger" :disabled="busy" @click="clearWeek" />
      </template>
    </Modal>
  </div>
</template>
