<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from '@/components/ui/Icon.vue'
import type { KeyboardLayout } from '@/composables/useOnScreenKeyboard'
import type { KeyAction } from '@/utils/keyboardInput'

/**
 * The keys themselves.
 *
 * Docked along the bottom, above modals but below the screensaver. Sized in
 * viewport units so the same layout works on a 16" panel in either
 * orientation without a set of breakpoints.
 *
 * Every key acts on `pointerdown` and prevents the default, which is what
 * keeps the field focused: without it the first tap would blur the input and
 * there would be nothing left to type into.
 */
const props = defineProps<{ layout: KeyboardLayout }>()

const emit = defineEmits<{ press: [action: KeyAction]; submit: []; dismiss: [] }>()

/** Letters, and the symbols behind the `?123` key. */
const LETTER_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm'] as const

const SYMBOL_ROWS = ['1234567890', '-/:;()&@"', ".,?!'"] as const

/** Extra symbols, for the second symbol row. */
const MORE_SYMBOLS = ['+', '=', '#', '%', '*', '_', '£', '$', '~'] as const

const NUMERIC_ROWS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  ['.', '0', '-']
] as const

type Page = 'letters' | 'symbols'

const page = ref<Page>('letters')

/**
 * Shift applies to the next letter only.
 *
 * One-shot rather than a latch, because what it is nearly always for is the
 * first letter of a name. A latch would need a second press to release and
 * would silently capitalise a whole word.
 */
const shifted = ref(false)

// A fresh field starts unshifted and on the letters page, so the keyboard
// does not open still showing symbols from whatever was typed last.
watch(
  () => props.layout,
  () => {
    page.value = 'letters'
    shifted.value = false
  }
)

const rows = computed(() => (page.value === 'letters' ? LETTER_ROWS : SYMBOL_ROWS))

/**
 * Publishes how much of the screen the keyboard is covering.
 *
 * Anything anchored to the bottom needs to move out of the way, a modal
 * most of all, since in portrait it slides up from the bottom edge and would
 * otherwise be completely hidden behind this. Measured rather than assumed,
 * because the panel is a different height on the symbol page and in the
 * numeric layout.
 */
const INSET_PROPERTY = '--fd-keyboard-inset'

const panel = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

function publishHeight(): void {
  const height = panel.value?.offsetHeight ?? 0
  document.documentElement.style.setProperty(INSET_PROPERTY, `${height}px`)
}

onMounted(() => {
  publishHeight()

  if (typeof ResizeObserver !== 'undefined' && panel.value) {
    observer = new ResizeObserver(publishHeight)
    observer.observe(panel.value)
  }
})

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  document.documentElement.style.removeProperty(INSET_PROPERTY)
})

function label(key: string): string {
  return page.value === 'letters' && shifted.value ? key.toUpperCase() : key
}

function tap(key: string): void {
  emit('press', { kind: 'insert', text: label(key) })
  shifted.value = false
}

function tapText(text: string): void {
  emit('press', { kind: 'insert', text })
}

function backspace(): void {
  emit('press', { kind: 'backspace' })
}
</script>

<template>
  <!-- pointerdown.prevent on the whole panel, so a tap on the gaps between
       keys does not blur the field either. -->
  <div
    ref="panel"
    class="fixed inset-x-0 bottom-0 z-[55] select-none border-t border-line bg-surface-2/98 px-2 pt-2 pb-3 shadow-[0_-8px_24px_rgba(0,0,0,0.25)] backdrop-blur"
    role="group"
    aria-label="On-screen keyboard"
    @pointerdown.prevent
  >
    <!-- Numbers get a keypad. Nobody needs a QWERTY to type "30". -->
    <div v-if="layout === 'numeric'" class="mx-auto flex max-w-md flex-col gap-1.5">
      <div v-for="(row, index) in NUMERIC_ROWS" :key="index" class="flex gap-1.5">
        <button
          v-for="key in row"
          :key="key"
          type="button"
          class="min-h-14 flex-1 rounded-card bg-surface text-xl font-medium text-ink transition-colors active:bg-accent active:text-accent-ink"
          @pointerdown.prevent="tapText(key)"
        >
          {{ key }}
        </button>
      </div>

      <div class="flex gap-1.5">
        <button
          type="button"
          class="grid min-h-14 flex-1 place-items-center rounded-card bg-surface text-muted transition-colors active:bg-surface-3"
          aria-label="Backspace"
          @pointerdown.prevent="backspace"
        >
          <Icon name="close" :size="20" />
        </button>
        <button
          type="button"
          class="min-h-14 flex-[2] rounded-card bg-accent text-base font-semibold text-accent-ink"
          @pointerdown.prevent="emit('submit')"
        >
          Done
        </button>
      </div>
    </div>

    <!-- Letters and symbols. -->
    <div v-else class="mx-auto flex max-w-4xl flex-col gap-1.5">
      <div v-for="(row, index) in rows" :key="`${page}-${index}`" class="flex justify-center gap-1.5">
        <!-- Shift and backspace flank the bottom row, as on a phone. -->
        <button
          v-if="index === 2"
          type="button"
          class="min-h-touch min-w-[4.5rem] rounded-card text-sm font-semibold transition-colors"
          :class="
            page === 'symbols'
              ? 'bg-surface text-muted'
              : shifted
                ? 'bg-accent text-accent-ink'
                : 'bg-surface text-muted active:bg-surface-3'
          "
          :aria-pressed="page === 'letters' ? shifted : undefined"
          :aria-label="page === 'letters' ? 'Shift' : 'More symbols'"
          @pointerdown.prevent="page === 'letters' ? (shifted = !shifted) : undefined"
        >
          <template v-if="page === 'letters'">⇧</template>
          <template v-else>+=#</template>
        </button>

        <button
          v-for="key in row"
          :key="key"
          type="button"
          class="min-h-touch flex-1 rounded-card bg-surface text-lg font-medium text-ink transition-colors active:bg-accent active:text-accent-ink"
          @pointerdown.prevent="tap(key)"
        >
          {{ label(key) }}
        </button>

        <button
          v-if="index === 2"
          type="button"
          class="grid min-h-touch min-w-[4.5rem] place-items-center rounded-card bg-surface text-muted transition-colors active:bg-surface-3"
          aria-label="Backspace"
          @pointerdown.prevent="backspace"
        >
          <Icon name="close" :size="18" />
        </button>
      </div>

      <!-- The extra symbols sit on their own row rather than behind a third
           page: two taps to reach a '%' is enough. -->
      <div v-if="page === 'symbols'" class="flex justify-center gap-1.5">
        <button
          v-for="key in MORE_SYMBOLS"
          :key="key"
          type="button"
          class="min-h-touch flex-1 rounded-card bg-surface text-lg font-medium text-ink transition-colors active:bg-accent active:text-accent-ink"
          @pointerdown.prevent="tapText(key)"
        >
          {{ key }}
        </button>
      </div>

      <div class="flex gap-1.5">
        <button
          type="button"
          class="min-h-14 min-w-[4.5rem] rounded-card bg-surface text-sm font-semibold text-muted transition-colors active:bg-surface-3"
          :aria-label="page === 'letters' ? 'Numbers and symbols' : 'Letters'"
          @pointerdown.prevent="page = page === 'letters' ? 'symbols' : 'letters'"
        >
          {{ page === 'letters' ? '?123' : 'ABC' }}
        </button>

        <button
          type="button"
          class="min-h-14 flex-1 rounded-card bg-surface text-sm text-faint transition-colors active:bg-accent active:text-accent-ink"
          aria-label="Space"
          @pointerdown.prevent="tapText(' ')"
        >
          space
        </button>

        <button
          type="button"
          class="min-h-14 min-w-[4.5rem] rounded-card bg-surface text-sm font-semibold text-muted transition-colors active:bg-surface-3"
          aria-label="Hide the keyboard"
          @pointerdown.prevent="emit('dismiss')"
        >
          Hide
        </button>

        <button
          type="button"
          class="min-h-14 min-w-[6rem] rounded-card bg-accent text-base font-semibold text-accent-ink"
          @pointerdown.prevent="emit('submit')"
        >
          Done
        </button>
      </div>
    </div>
  </div>
</template>
