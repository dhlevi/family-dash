<script setup lang="ts">
/**
 * Single-line or multi-line text entry.
 *
 * Deliberately tall (min 48px) and 16px+ text: anything smaller is both hard
 * to hit and, on a mobile browser, triggers a zoom on focus.
 *
 * The input is keyed on `type` so that switching type `datetime-local` to
 * `date`, when an event is marked all-day replaces the element.
 */
withDefaults(
  defineProps<{
    modelValue: string
    id?: string
    type?: 'text' | 'url' | 'search' | 'datetime-local' | 'date' | 'time'
    placeholder?: string
    multiline?: boolean
    rows?: number
    invalid?: boolean
    disabled?: boolean
    autofocus?: boolean
  }>(),
  {
    id: undefined,
    type: 'text',
    placeholder: undefined,
    multiline: false,
    rows: 3,
    invalid: false,
    disabled: false,
    autofocus: false
  }
)

const emit = defineEmits<{ 'update:modelValue': [value: string]; enter: [] }>()

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement | HTMLTextAreaElement).value)
}
</script>

<template>
  <textarea
    v-if="multiline"
    :id="id"
    :value="modelValue"
    :rows="rows"
    :placeholder="placeholder"
    :disabled="disabled"
    class="w-full resize-y rounded-card border bg-surface-2 px-3.5 py-3 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
    :class="invalid ? 'border-danger' : 'border-line'"
    @input="onInput"
  />
  <input
    v-else
    :key="type"
    :id="id"
    :value="modelValue"
    :type="type"
    :placeholder="placeholder"
    :disabled="disabled"
    :autofocus="autofocus"
    class="min-h-touch w-full rounded-card border bg-surface-2 px-3.5 text-base text-ink placeholder:text-faint focus:border-accent focus:outline-none disabled:opacity-50"
    :class="invalid ? 'border-danger' : 'border-line'"
    @input="onInput"
    @keyup.enter="emit('enter')"
  />
</template>
