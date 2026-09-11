<script setup lang="ts">
import { computed, ref } from 'vue'
import { ApiRequestError } from '@/api/client'
import { newsApi } from '@/api/news'
import Field from '@/components/ui/Field.vue'
import Icon from '@/components/ui/Icon.vue'
import Modal from '@/components/ui/Modal.vue'
import Spinner from '@/components/ui/Spinner.vue'
import TextInput from '@/components/ui/TextInput.vue'
import ToolButton from '@/components/ui/ToolButton.vue'
import { formatRelativeDay, formatTime } from '@/utils/datetime'
import type { NewsFeed } from '@/api/types'

/**
 * Managing news feeds.
 *
 * Adding a feed validates it against the publisher first. A wrong address
 * is caught where it was typed rather than failing quietly on the next
 * scheduled fetch, and the feed's own title is offered as its name, so
 * subscribing is usually just pasting a URL.
 */
const props = defineProps<{ feeds: NewsFeed[] }>()
const emit = defineEmits<{ changed: [] }>()

const editorOpen = ref(false)
const editing = ref<NewsFeed | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)
const busy = ref<string | null>(null)

const url = ref('')
const name = ref('')
const category = ref('')

const confirmingRemoval = ref<NewsFeed | null>(null)

const sorted = computed(() =>
  [...props.feeds].sort((a, b) => (a.category ?? '').localeCompare(b.category ?? '') || a.name.localeCompare(b.name))
)

function openAdd(): void {
  editing.value = null
  url.value = ''
  name.value = ''
  category.value = ''
  formError.value = null
  editorOpen.value = true
}

function openEdit(feed: NewsFeed): void {
  editing.value = feed
  url.value = feed.url
  name.value = feed.name
  category.value = feed.category ?? ''
  formError.value = null
  editorOpen.value = true
}

const canSave = computed(() => url.value.trim().length > 0 && !saving.value)

async function save(): Promise<void> {
  if (!canSave.value) return

  saving.value = true
  formError.value = null

  try {
    if (editing.value) {
      await newsApi.updateFeed(editing.value.id, {
        name: name.value.trim() || undefined,
        url: url.value.trim(),
        category: category.value.trim() || null
      })
    } else {
      await newsApi.addFeed({
        url: url.value.trim(),
        // Left blank, the API uses the feed's own title.
        name: name.value.trim() || undefined,
        category: category.value.trim() || null
      })
    }

    editorOpen.value = false
    emit('changed')
  } catch (caught) {
    formError.value = caught instanceof ApiRequestError ? caught.message : 'Could not save the feed'
  } finally {
    saving.value = false
  }
}

async function toggleEnabled(feed: NewsFeed): Promise<void> {
  busy.value = feed.id
  try {
    await newsApi.updateFeed(feed.id, { enabled: !feed.enabled })
    emit('changed')
  } finally {
    busy.value = null
  }
}

async function refresh(feed: NewsFeed): Promise<void> {
  busy.value = feed.id
  try {
    await newsApi.refreshFeed(feed.id)
    emit('changed')
  } finally {
    busy.value = null
  }
}

async function remove(feed: NewsFeed): Promise<void> {
  busy.value = feed.id
  try {
    await newsApi.removeFeed(feed.id)
    confirmingRemoval.value = null
    emit('changed')
  } catch (caught) {
    formError.value = caught instanceof ApiRequestError ? caught.message : 'Could not remove the feed'
  } finally {
    busy.value = null
  }
}

function fetchLabel(feed: NewsFeed): string {
  if (!feed.lastFetchAt) return 'Never fetched'

  const at = new Date(feed.lastFetchAt)
  const count = feed.articleCount ?? 0

  return `${count} article${count === 1 ? '' : 's'} · ${formatRelativeDay(at).toLowerCase()} at ${formatTime(at)}`
}
</script>

<template>
  <div class="flex flex-col gap-3">
    <div v-for="feed in sorted" :key="feed.id" class="flex flex-col gap-2 rounded-card bg-surface-2 px-3 py-2.5">
      <div class="flex items-center gap-3">
        <span
          class="size-2.5 shrink-0 rounded-full"
          :class="feed.lastError ? 'bg-danger' : feed.enabled ? 'bg-success' : 'bg-line-strong'"
        />

        <div class="min-w-0 flex-1">
          <p class="flex items-baseline gap-2">
            <span class="truncate text-sm font-medium" :class="feed.enabled ? 'text-ink' : 'text-faint'">
              {{ feed.name }}
            </span>
            <span v-if="feed.category" class="shrink-0 text-xs text-faint capitalize">
              {{ feed.category }}
            </span>
          </p>
          <p class="truncate text-xs" :class="feed.lastError ? 'text-danger' : 'text-faint'">
            {{ feed.lastError ?? fetchLabel(feed) }}
          </p>
        </div>

        <Spinner v-if="busy === feed.id" :size="16" />
        <template v-else>
          <ToolButton
            :icon="feed.enabled ? 'check' : 'close'"
            :label="feed.enabled ? 'Disable' : 'Enable'"
            icon-only
            @click="toggleEnabled(feed)"
          />
          <ToolButton icon="refresh" label="Fetch now" icon-only :disabled="!feed.enabled" @click="refresh(feed)" />
          <ToolButton icon="edit" label="Edit" icon-only @click="openEdit(feed)" />
          <ToolButton icon="trash" label="Remove" icon-only variant="danger" @click="confirmingRemoval = feed" />
        </template>
      </div>
    </div>

    <p v-if="feeds.length === 0" class="text-sm text-faint">
      No feeds yet. Almost every news site publishes one. Look for an RSS link, or try adding
      <code class="font-mono text-xs">/rss</code> to its address.
    </p>

    <ToolButton icon="plus" label="Add a feed" @click="openAdd" />

    <!-- Add / edit -->
    <Modal :open="editorOpen" :title="editing ? 'Edit feed' : 'Add a feed'" :busy="saving" @close="editorOpen = false">
      <div class="flex flex-col gap-4">
        <p v-if="formError" class="rounded-card bg-danger/15 px-3 py-2 text-sm text-danger">
          {{ formError }}
        </p>

        <Field label="Feed address" for="feed-url">
          <TextInput
            id="feed-url"
            v-model="url"
            type="url"
            placeholder="https://feeds.bbci.co.uk/news/world/rss.xml"
            :disabled="saving"
            @enter="save"
          />
        </Field>

        <Field label="Name" for="feed-name" hint="Leave blank to use the feed's own title">
          <TextInput id="feed-name" v-model="name" placeholder="Optional" :disabled="saving" />
        </Field>

        <Field label="Category" for="feed-category" hint="Groups the filter buttons on the News page">
          <TextInput id="feed-category" v-model="category" placeholder="world, local, sport…" :disabled="saving" />
        </Field>

        <p v-if="saving" class="flex items-center gap-2 text-sm text-muted">
          <Spinner :size="16" />
          Checking the feed…
        </p>

        <details class="rounded-card bg-surface-2 px-3 py-2.5 text-sm">
          <summary class="cursor-pointer font-medium text-ink">Where do I find a feed address?</summary>
          <div class="mt-2 flex flex-col gap-2 text-muted">
            <p>
              Most news sites have one linked in the footer, often as "RSS". Failing that, try adding
              <code class="font-mono text-xs">/rss</code> or <code class="font-mono text-xs">/feed</code> to a section's
              address.
            </p>
            <p class="flex items-start gap-2 pt-1 text-xs text-faint">
              <Icon name="warning" :size="14" class="mt-0.5 shrink-0" />
              <span>
                The address is checked before it is saved, so a typo is caught here rather than showing up as a feed
                that quietly never updates.
              </span>
            </p>
          </div>
        </details>
      </div>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" :disabled="saving" @click="editorOpen = false" />
        <ToolButton
          icon="check"
          :label="saving ? 'Checking…' : editing ? 'Save' : 'Add'"
          variant="primary"
          :disabled="!canSave"
          @click="save"
        />
      </template>
    </Modal>

    <Modal
      :open="confirmingRemoval !== null"
      title="Remove this feed?"
      :busy="busy !== null"
      @close="confirmingRemoval = null"
    >
      <p class="text-sm text-muted">
        <strong class="font-medium text-ink">{{ confirmingRemoval?.name }}</strong> and its cached headlines will be
        removed. You can add the address again later.
      </p>

      <template #actions>
        <span class="flex-1" />
        <ToolButton label="Cancel" @click="confirmingRemoval = null" />
        <ToolButton
          icon="trash"
          label="Remove"
          variant="danger"
          :disabled="busy !== null"
          @click="confirmingRemoval && remove(confirmingRemoval)"
        />
      </template>
    </Modal>
  </div>
</template>
