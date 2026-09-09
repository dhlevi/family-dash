<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import Icon from './Icon.vue'

/**
 * A centred dialog for editing.
 *
 * On a touchscreen this is a full-height sheet on narrow (portrait) screens
 * and a centred card on wide ones, because a dialog that floats in the
 * middle of a tall portrait panel is awkward to reach with a thumb.
 */
const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    /** Disables the close affordances while a save is in flight. */
    busy?: boolean
  }>(),
  { busy: false }
)

const emit = defineEmits<{ close: [] }>()

const panel = ref<HTMLElement | null>(null)

function requestClose(): void {
  if (!props.busy) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') requestClose()
}

// Focus the panel when it opens so Escape works without a click first, and
// so a screen reader lands inside the dialog rather than behind it.
watch(
  () => props.open,
  async isOpen => {
    if (!isOpen) return
    await Promise.resolve()
    panel.value?.focus()
  }
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-opacity duration-150"
      leave-active-class="transition-opacity duration-150"
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
    >
      <!-- The bottom inset keeps the panel clear of the on-screen keyboard,
           which is set while one is up and zero otherwise. It matters most in
           portrait, where this dialog is anchored to the bottom edge and
           would otherwise be entirely behind the keys. -->
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex bg-black/60 landscape:items-center landscape:justify-center landscape:p-6 portrait:items-end portrait:justify-stretch"
        style="padding-bottom: var(--fd-keyboard-inset, 0px)"
        role="presentation"
        @click.self="requestClose"
      >
        <div
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          class="flex max-h-full min-h-0 flex-col overflow-hidden border border-line bg-surface shadow-2xl outline-none landscape:w-full landscape:max-w-lg landscape:rounded-card portrait:w-full portrait:rounded-t-card portrait:pb-[env(safe-area-inset-bottom)]"
        >
          <header class="flex shrink-0 items-center gap-3 border-b border-line px-5 py-4">
            <h2 class="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{{ title }}</h2>
            <button
              type="button"
              class="grid size-11 place-items-center rounded-card text-muted transition-colors hover:bg-surface-2 active:bg-surface-3 disabled:opacity-40"
              aria-label="Close"
              :disabled="busy"
              @click="requestClose"
            >
              <Icon name="close" :size="22" />
            </button>
          </header>

          <div class="fd-scroll min-h-0 flex-1 px-5 py-4">
            <slot />
          </div>

          <footer v-if="$slots.actions" class="flex shrink-0 flex-wrap gap-2 border-t border-line px-5 py-4">
            <slot name="actions" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
