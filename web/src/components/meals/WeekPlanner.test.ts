import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import WeekPlanner from './WeekPlanner.vue'
import type { MealPlanEntry, MealSlot } from '@/api/types'

/**
 * The grid maps a date-and-slot key onto a cell. Getting that wrong puts
 * Tuesday's dinner on Wednesday, which is exactly the kind of error nobody
 * reports because they assume they mis-tapped.
 */
const MONDAY = new Date(2026, 8, 14) // 14 September 2026 is a Monday

const entry = (planDate: string, slot: MealSlot, overrides: Partial<MealPlanEntry> = {}): MealPlanEntry => ({
  id: `${planDate}-${slot}`,
  planDate,
  slot,
  recipeId: null,
  recipeTitle: null,
  customText: null,
  notes: null,
  ...overrides
})

function mountPlanner(entries: MealPlanEntry[], slots: MealSlot[] = ['breakfast', 'dinner']) {
  return mount(WeekPlanner, { props: { weekStart: MONDAY, slots, entries } })
}

/** Cell buttons, in row-major order after the seven day headings. */
const cells = (wrapper: ReturnType<typeof mountPlanner>) => wrapper.findAll('button')

describe('WeekPlanner', () => {
  it('renders a cell for every day and slot', () => {
    const wrapper = mountPlanner([], ['breakfast', 'lunch', 'dinner'])

    // 7 days x 3 slots.
    expect(cells(wrapper)).toHaveLength(21)
  })

  it('puts a recipe in the cell for its date and slot', () => {
    const wrapper = mountPlanner([entry('2026-09-16', 'dinner', { recipeTitle: 'Tomato soup' })])

    // Wednesday is the third day; with breakfast first, dinner's row starts
    // at index 7.
    const wednesdayDinner = cells(wrapper)[7 + 2]
    expect(wednesdayDinner?.text()).toContain('Tomato soup')
  })

  it('does not leak a meal into a neighbouring day', () => {
    const wrapper = mountPlanner([entry('2026-09-16', 'dinner', { recipeTitle: 'Tomato soup' })])

    expect(cells(wrapper)[7 + 1]?.text()).not.toContain('Tomato soup')
    expect(cells(wrapper)[7 + 3]?.text()).not.toContain('Tomato soup')
  })

  it('does not leak a meal into another slot on the same day', () => {
    const wrapper = mountPlanner([entry('2026-09-16', 'dinner', { recipeTitle: 'Tomato soup' })])

    expect(cells(wrapper)[2]?.text()).not.toContain('Tomato soup')
  })

  it('shows free text when there is no recipe', () => {
    const wrapper = mountPlanner([entry('2026-09-17', 'dinner', { customText: 'Leftovers' })])

    expect(wrapper.text()).toContain('Leftovers')
  })

  it('prefers the recipe title over free text', () => {
    const wrapper = mountPlanner([
      entry('2026-09-14', 'dinner', { recipeTitle: 'Spaghetti bolognese', customText: 'ignored' })
    ])

    expect(wrapper.text()).toContain('Spaghetti bolognese')
    expect(wrapper.text()).not.toContain('ignored')
  })

  it('shows a note under the meal', () => {
    const wrapper = mountPlanner([
      entry('2026-09-18', 'dinner', { customText: 'Fish and chips', notes: 'Friday treat' })
    ])

    expect(wrapper.text()).toContain('Friday treat')
  })

  it('reports the date and slot that was tapped', async () => {
    const wrapper = mountPlanner([])

    // Thursday's breakfast: the fourth cell of the first slot row.
    await cells(wrapper)[3]?.trigger('click')

    expect(wrapper.emitted('select')?.[0]?.[0]).toEqual({ planDate: '2026-09-17', slot: 'breakfast' })
  })

  it('covers the whole week starting from the given day', async () => {
    const wrapper = mountPlanner([])

    await cells(wrapper)[0]?.trigger('click')
    await cells(wrapper)[6]?.trigger('click')

    const emitted = wrapper.emitted('select') ?? []
    expect((emitted[0]?.[0] as { planDate: string }).planDate).toBe('2026-09-14')
    expect((emitted[1]?.[0] as { planDate: string }).planDate).toBe('2026-09-20')
  })

  it('honours the configured slot list', () => {
    const wrapper = mountPlanner([], ['dinner'])

    expect(cells(wrapper)).toHaveLength(7)
    expect(wrapper.text()).toContain('Dinner')
    expect(wrapper.text()).not.toContain('Breakfast')
  })
})
