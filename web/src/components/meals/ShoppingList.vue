<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { shoppingApi } from '@/api/meals'
import EmptyState from '@/components/ui/EmptyState.vue'
import ErrorState from '@/components/ui/ErrorState.vue'
import Icon from '@/components/ui/Icon.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import type { ShoppingItem } from '@/api/types'

/**
 * The shopping list.
 *
 * Used both as a tab on the wall display and as a standalone page on a
 * phone, so the layout is a single column of large tick targets either way.
 * It polls while visible, which is what keeps two people looking at the same list.
 */
const props = withDefaults(
  defineProps<{
    /** Poll for changes made on another device. */
    live?: boolean
    pollMs?: number
  }>(),
  { live: true, pollMs: 15000 }
)

const emit = defineEmits<{ changed: [remaining: number] }>()

const items = ref<ShoppingItem[]>([])
const loading = ref(true)
const error = ref<string | null>(null)
const pending = ref<Set<string>>(new Set())

const newItem = ref('')
const adding = ref(false)

let poller: ReturnType<typeof setInterval> | undefined

async function load(quiet = false): Promise<void> {
  if (!quiet) loading.value = true
  error.value = null

  try {
    const list = await shoppingApi.list()
    items.value = list.items
    emit('changed', list.remaining)
  } catch (caught) {
    // A failed background poll should not replace a usable list with an
    // error; only a foreground load does that.
    if (!quiet) error.value = caught instanceof ApiRequestError ? caught.message : 'Could not load the list'
  } finally {
    loading.value = false
  }
}

onMounted(async () => {
  await load()

  if (props.live) poller = setInterval(() => void load(true), props.pollMs)
})

onBeforeUnmount(() => {
  if (poller) clearInterval(poller)
})

// --- grouping ---------------------------------------------------------------

interface Group {
  category: string
  items: ShoppingItem[]
}

/** Outstanding items, grouped by aisle; ticked items collect at the bottom. */
const groups = computed<Group[]>(() => {
  const byCategory = new Map<string, ShoppingItem[]>()

  for (const item of items.value) {
    if (item.checked) continue
    const key = item.category ?? 'Other'
    byCategory.set(key, [...(byCategory.get(key) ?? []), item])
  }

  return [...byCategory.entries()]
    .sort(([a], [b]) => (a === 'Other' ? 1 : b === 'Other' ? -1 : a.localeCompare(b)))
    .map(([category, group]) => ({ category, items: group }))
})

const checked = computed(() => items.value.filter(item => item.checked))
const remaining = computed(() => items.value.length - checked.value.length)

// --- actions ----------------------------------------------------------------

async function toggle(item: ShoppingItem): Promise<void> {
  pending.value = new Set(pending.value).add(item.id)

  // Optimistic: ticking things off in a shop should feel instant, not wait
  // on a round trip over patchy wifi.
  items.value = items.value.map(candidate =>
    candidate.id === item.id ? { ...candidate, checked: !candidate.checked } : candidate
  )

  try {
    const updated = await shoppingApi.update(item.id, { checked: !item.checked })
    items.value = items.value.map(candidate => (candidate.id === updated.id ? updated : candidate))
    emit('changed', items.value.filter(candidate => !candidate.checked).length)
  } catch (caught) {
    // Put it back the way it was, so the list never lies about what is in
    // the trolley.
    items.value = items.value.map(candidate =>
      candidate.id === item.id ? { ...candidate, checked: item.checked } : candidate
    )
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not update the item'
  } finally {
    const next = new Set(pending.value)
    next.delete(item.id)
    pending.value = next
  }
}

async function add(): Promise<void> {
  const name = newItem.value.trim()
  if (name.length === 0 || adding.value) return

  adding.value = true
  try {
    // The API guesses an aisle from the name, so a typed item files itself
    // alongside the ones the meal plan produced.
    items.value = [...items.value, await shoppingApi.add({ name })]
    newItem.value = ''
    emit('changed', items.value.filter(candidate => !candidate.checked).length)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not add the item'
  } finally {
    adding.value = false
  }
}

async function remove(item: ShoppingItem): Promise<void> {
  pending.value = new Set(pending.value).add(item.id)
  try {
    await shoppingApi.remove(item.id)
    items.value = items.value.filter(candidate => candidate.id !== item.id)
    emit('changed', items.value.filter(candidate => !candidate.checked).length)
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not remove the item'
  } finally {
    const next = new Set(pending.value)
    next.delete(item.id)
    pending.value = next
  }
}

async function clearChecked(): Promise<void> {
  try {
    await shoppingApi.clearChecked()
    await load()
  } catch (caught) {
    error.value = caught instanceof ApiRequestError ? caught.message : 'Could not clear the list'
  }
}

defineExpose({ reload: () => load() })
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center gap-2 border-b border-line bg-bg px-4 py-3">
      <TextInput v-model="newItem" placeholder="Add an item" :disabled="adding" @enter="add" />
      <ToolButton
        icon="plus"
        label="Add"
        variant="primary"
        :disabled="newItem.trim().length === 0 || adding"
        @click="add"
      />
    </div>

    <p
      v-if="error"
      class="flex shrink-0 items-center gap-2 border-b border-line bg-danger/10 px-4 py-2 text-sm text-danger"
    >
      <Icon name="warning" :size="16" />
      <span class="min-w-0 flex-1">{{ error }}</span>
      <button type="button" class="font-medium underline" @click="load()">Retry</button>
    </p>

    <ErrorState v-if="error && items.length === 0 && !loading" :message="error" @retry="load()" />

    <div v-else-if="loading && items.length === 0" class="flex flex-1 items-center justify-center py-16">
      <Spinner :size="28">Loading the list…</Spinner>
    </div>

    <EmptyState
      v-else-if="items.length === 0"
      icon="meals"
      title="Nothing on the list"
      description="Add items above, or build the list from the week's meal plan."
    />

    <div v-else class="fd-scroll min-h-0 flex-1">
      <section v-for="group in groups" :key="group.category" class="border-b border-line last:border-b-0">
        <h3
          class="sticky top-0 z-10 bg-bg/95 px-4 py-2 text-xs font-semibold tracking-wider text-faint uppercase backdrop-blur"
        >
          {{ group.category }}
        </h3>

        <ul>
          <li
            v-for="item in group.items"
            :key="item.id"
            class="flex items-stretch border-t border-line first:border-t-0"
          >
            <button
              type="button"
              class="flex min-h-touch flex-1 items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-50"
              :disabled="pending.has(item.id)"
              @click="toggle(item)"
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full border-2 border-line-strong text-transparent"
              >
                <Icon name="check" :size="16" :stroke-width="3" />
              </span>

              <span class="min-w-0 flex-1">
                <span class="block truncate text-base text-ink">
                  <span v-if="item.quantity" class="font-semibold tabular-nums">{{ item.quantity }} </span>
                  {{ item.name }}
                </span>
              </span>

              <span
                v-if="item.origin === 'meal_plan'"
                class="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[0.6875rem] text-faint"
                title="Added from the meal plan"
              >
                plan
              </span>
            </button>

            <button
              type="button"
              class="grid w-12 shrink-0 place-items-center text-faint transition-colors hover:bg-danger/15 hover:text-danger disabled:opacity-40"
              :aria-label="`Remove ${item.name}`"
              :disabled="pending.has(item.id)"
              @click="remove(item)"
            >
              <Icon name="close" :size="18" />
            </button>
          </li>
        </ul>
      </section>

      <!-- Already in the trolley -->
      <section v-if="checked.length > 0" class="border-t border-line">
        <div class="sticky top-0 z-10 flex items-center gap-2 bg-bg/95 px-4 py-2 backdrop-blur">
          <h3 class="flex-1 text-xs font-semibold tracking-wider text-faint uppercase">
            In the cart · {{ checked.length }}
          </h3>
          <button type="button" class="text-xs font-medium text-accent hover:underline" @click="clearChecked">
            Clear
          </button>
        </div>

        <ul>
          <li v-for="item in checked" :key="item.id" class="border-t border-line first:border-t-0">
            <button
              type="button"
              class="flex min-h-touch w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-2 disabled:opacity-50"
              :disabled="pending.has(item.id)"
              @click="toggle(item)"
            >
              <span
                class="grid size-7 shrink-0 place-items-center rounded-full border-2 border-success bg-success text-white"
              >
                <Icon name="check" :size="16" :stroke-width="3" />
              </span>
              <span class="min-w-0 flex-1 truncate text-base text-faint line-through">
                <span v-if="item.quantity">{{ item.quantity }} </span>{{ item.name }}
              </span>
            </button>
          </li>
        </ul>
      </section>

      <p class="px-4 py-3 text-center text-xs text-faint">{{ remaining }} still to get</p>
    </div>
  </div>
</template>
