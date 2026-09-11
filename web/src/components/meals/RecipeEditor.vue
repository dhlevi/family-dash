<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import PhotoPicker from '@/components/photos/PhotoPicker.vue'
import NumberStepper from '@/components/ui/NumberStepper.vue'
import TextInput from '@/components/ui/TextInput.vue'
import Toggle from '@/components/ui/Toggle.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import type { Ingredient, NewRecipe, Recipe } from '@/api/types'

/**
 * Create or edit a recipe.
 *
 * Ingredients are three separate fields rather than one line of text,
 * because the shopping list has to add them up: "2 cup flour" and "1 cup
 * flour" only become "3 cup flour" if the quantity and unit are known
 * separately. Quantities stay free text so "a pinch" and "1 1/2" are both
 * allowed. The merge treats anything non-numeric as unmergeable rather
 * than rejecting it.
 */
const props = defineProps<{
  open: boolean
  /** Null when creating. */
  recipe: Recipe | null
  saving?: boolean
  error?: string | null
}>()

const emit = defineEmits<{
  close: []
  save: [recipe: NewRecipe]
  remove: [recipe: Recipe]
}>()

interface EditableIngredient extends Ingredient {
  key: number
}

let nextKey = 0
const row = (ingredient?: Ingredient): EditableIngredient => ({
  key: nextKey++,
  quantity: ingredient?.quantity ?? '',
  unit: ingredient?.unit ?? '',
  item: ingredient?.item ?? ''
})

const title = ref('')
const description = ref('')
const servings = ref(4)
const prepMinutes = ref(0)
const cookMinutes = ref(0)
const ingredients = ref<EditableIngredient[]>([])
const steps = ref<Array<{ key: number; text: string }>>([])
const tagInput = ref('')
const tags = ref<string[]>([])
const photoId = ref<string | null>(null)
const sourceUrl = ref('')
const favourite = ref(false)

const isEdit = computed(() => props.recipe !== null)

watch(
  () => [props.open, props.recipe] as const,
  ([open, recipe]) => {
    if (!open) return

    title.value = recipe?.title ?? ''
    description.value = recipe?.description ?? ''
    servings.value = recipe?.servings ?? 4
    prepMinutes.value = recipe?.prepMinutes ?? 0
    cookMinutes.value = recipe?.cookMinutes ?? 0
    tags.value = [...(recipe?.tags ?? [])]
    photoId.value = recipe?.photoId ?? null
    sourceUrl.value = recipe?.sourceUrl ?? ''
    favourite.value = recipe?.favourite ?? false
    tagInput.value = ''

    // Always leave one blank row so there is somewhere to type without
    // having to press "add" first.
    ingredients.value = [...(recipe?.ingredients ?? []).map(row), row()]
    steps.value = [...(recipe?.steps ?? []).map(text => ({ key: nextKey++, text })), { key: nextKey++, text: '' }]
  },
  { immediate: true }
)

/** Keep exactly one trailing blank row as the list is filled in. */
function ensureTrailingIngredient(): void {
  const last = ingredients.value.at(-1)
  if (last && (last.item.trim() || last.quantity?.trim() || last.unit?.trim())) {
    ingredients.value = [...ingredients.value, row()]
  }
}

function ensureTrailingStep(): void {
  const last = steps.value.at(-1)
  if (last && last.text.trim()) steps.value = [...steps.value, { key: nextKey++, text: '' }]
}

function removeIngredient(key: number): void {
  ingredients.value = ingredients.value.filter(item => item.key !== key)
  if (ingredients.value.length === 0) ingredients.value = [row()]
}

function removeStep(key: number): void {
  steps.value = steps.value.filter(step => step.key !== key)
  if (steps.value.length === 0) steps.value = [{ key: nextKey++, text: '' }]
}

function addTag(): void {
  const tag = tagInput.value.trim()
  if (tag.length === 0 || tags.value.includes(tag)) return

  tags.value = [...tags.value, tag]
  tagInput.value = ''
}

const canSave = computed(() => title.value.trim().length > 0 && !props.saving)

function submit(): void {
  if (!canSave.value) return

  emit('save', {
    title: title.value.trim(),
    description: description.value.trim() || null,
    servings: servings.value > 0 ? servings.value : null,
    prepMinutes: prepMinutes.value > 0 ? prepMinutes.value : null,
    cookMinutes: cookMinutes.value > 0 ? cookMinutes.value : null,
    ingredients: ingredients.value
      .filter(item => item.item.trim().length > 0)
      .map(item => ({
        quantity: item.quantity?.trim() || null,
        unit: item.unit?.trim() || null,
        item: item.item.trim()
      })),
    steps: steps.value.map(step => step.text.trim()).filter(text => text.length > 0),
    tags: tags.value,
    photoId: photoId.value,
    sourceUrl: sourceUrl.value.trim() || null,
    favourite: favourite.value
  })
}
</script>

<template>
  <Modal :open="open" :title="isEdit ? 'Edit recipe' : 'New recipe'" :busy="saving" @close="emit('close')">
    <div class="flex flex-col gap-4">
      <p v-if="error" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">{{ error }}</p>

      <Field label="Title" for="recipe-title">
        <TextInput id="recipe-title" v-model="title" placeholder="Spaghetti bolognese" :disabled="saving" />
      </Field>

      <Field label="Description" for="recipe-description">
        <TextInput id="recipe-description" v-model="description" multiline :rows="2" :disabled="saving" />
      </Field>

      <div class="grid grid-cols-3 gap-3">
        <Field label="Serves">
          <NumberStepper v-model="servings" :min="0" :max="50" :disabled="saving" />
        </Field>
        <Field label="Prep">
          <NumberStepper v-model="prepMinutes" :min="0" :max="600" :step="5" suffix="min" :disabled="saving" />
        </Field>
        <Field label="Cook">
          <NumberStepper v-model="cookMinutes" :min="0" :max="600" :step="5" suffix="min" :disabled="saving" />
        </Field>
      </div>

      <!-- Ingredients -->
      <Field label="Ingredients" hint="Quantity and unit are kept apart so the shopping list can add them up">
        <ul class="flex flex-col gap-2">
          <li v-for="ingredient in ingredients" :key="ingredient.key" class="flex items-center gap-2">
            <input
              v-model="ingredient.quantity"
              placeholder="2"
              :disabled="saving"
              class="min-h-touch w-16 shrink-0 rounded-card border border-line bg-surface-2 px-2 text-center text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              @input="ensureTrailingIngredient"
            />
            <input
              v-model="ingredient.unit"
              placeholder="cup"
              :disabled="saving"
              class="min-h-touch w-20 shrink-0 rounded-card border border-line bg-surface-2 px-2 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              @input="ensureTrailingIngredient"
            />
            <input
              v-model="ingredient.item"
              placeholder="plain flour"
              :disabled="saving"
              class="min-h-touch min-w-0 flex-1 rounded-card border border-line bg-surface-2 px-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              @input="ensureTrailingIngredient"
            />
            <button
              type="button"
              class="grid size-10 shrink-0 place-items-center rounded-card text-faint transition-colors hover:bg-danger/15 hover:text-danger"
              aria-label="Remove ingredient"
              :disabled="saving"
              @click="removeIngredient(ingredient.key)"
            >
              <Icon name="close" :size="16" />
            </button>
          </li>
        </ul>
      </Field>

      <!-- Steps -->
      <Field label="Method">
        <ul class="flex flex-col gap-2">
          <li v-for="(step, index) in steps" :key="step.key" class="flex items-start gap-2">
            <span
              class="mt-1 grid size-7 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold text-muted"
            >
              {{ index + 1 }}
            </span>
            <textarea
              v-model="step.text"
              rows="2"
              placeholder="Soften the onion and garlic"
              :disabled="saving"
              class="min-w-0 flex-1 resize-y rounded-card border border-line bg-surface-2 px-3 py-2 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none"
              @input="ensureTrailingStep"
            />
            <button
              type="button"
              class="mt-1 grid size-10 shrink-0 place-items-center rounded-card text-faint transition-colors hover:bg-danger/15 hover:text-danger"
              aria-label="Remove step"
              :disabled="saving"
              @click="removeStep(step.key)"
            >
              <Icon name="close" :size="16" />
            </button>
          </li>
        </ul>
      </Field>

      <!-- Tags -->
      <Field label="Tags" hint="Pasta, quick, vegetarian…">
        <div class="flex gap-2">
          <TextInput v-model="tagInput" placeholder="Add a tag" :disabled="saving" @enter="addTag" />
          <ToolButton
            icon="plus"
            label="Add tag"
            icon-only
            :disabled="tagInput.trim().length === 0 || saving"
            @click="addTag"
          />
        </div>
        <div v-if="tags.length > 0" class="mt-2 flex flex-wrap gap-2">
          <span
            v-for="tag in tags"
            :key="tag"
            class="flex items-center gap-1 rounded-full bg-accent-soft py-1 pr-1 pl-3 text-sm text-accent"
          >
            {{ tag }}
            <button
              type="button"
              class="grid size-7 place-items-center rounded-full hover:bg-accent/20"
              :aria-label="`Remove ${tag}`"
              @click="tags = tags.filter(candidate => candidate !== tag)"
            >
              <Icon name="close" :size="14" />
            </button>
          </span>
        </div>
      </Field>

      <Field label="Picture" hint="A photo from the library, or upload one. It is filed under Recipes">
        <PhotoPicker v-model="photoId" :disabled="saving" />
      </Field>

      <Field label="Source" for="recipe-source" hint="Optional link to where it came from">
        <TextInput id="recipe-source" v-model="sourceUrl" type="url" placeholder="https://…" :disabled="saving" />
      </Field>

      <Toggle v-model="favourite" label="Favourite" hint="Favourites sort to the top" :disabled="saving" />
    </div>

    <template #actions>
      <ToolButton
        v-if="recipe"
        icon="trash"
        label="Delete"
        variant="danger"
        :disabled="saving"
        @click="emit('remove', recipe)"
      />
      <span class="flex-1" />
      <ToolButton label="Cancel" :disabled="saving" @click="emit('close')" />
      <ToolButton
        icon="check"
        :label="saving ? 'Saving…' : isEdit ? 'Save' : 'Add recipe'"
        variant="primary"
        :disabled="!canSave"
        @click="submit"
      />
    </template>
  </Modal>
</template>
