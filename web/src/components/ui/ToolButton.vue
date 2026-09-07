<script setup lang="ts">
import Icon from './Icon.vue'
import type { IconName } from './icons'

/**
 * The standard toolbar/action button. Always at least 48px tall so it can be
 * hit reliably with a thumb.
 */
withDefaults(
  defineProps<{
    icon?: IconName
    label?: string
    variant?: 'default' | 'primary' | 'danger'
    disabled?: boolean
    /** Render icon only; `label` becomes the accessible name. */
    iconOnly?: boolean
  }>(),
  { icon: undefined, label: undefined, variant: 'default', disabled: false, iconOnly: false }
)

const variants = {
  default: 'border border-line bg-surface text-ink hover:bg-surface-2 active:bg-surface-3',
  primary: 'bg-accent text-accent-ink hover:brightness-110 active:brightness-95',
  danger: 'bg-danger/15 text-danger hover:bg-danger/25 active:bg-danger/30'
} as const
</script>

<template>
  <button
    type="button"
    class="inline-flex min-h-touch items-center justify-center gap-2 rounded-card font-medium transition-all duration-150 disabled:cursor-not-allowed disabled:opacity-45"
    :class="[variants[variant], iconOnly ? 'aspect-square px-0' : 'px-4']"
    :disabled="disabled"
    :aria-label="iconOnly ? label : undefined"
    :title="iconOnly ? label : undefined"
  >
    <Icon v-if="icon" :name="icon" :size="20" />
    <span v-if="label && !iconOnly">{{ label }}</span>
  </button>
</template>
