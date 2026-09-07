import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { createRouter, createWebHistory } from 'vue-router'
import AppNav from './AppNav.vue'

/**
 * The nav rail is generated from the route table, so a page added to the
 * router should appear without touching this component. That is the property
 * worth testing.
 */
const stub = { template: '<div />' }

function makeRouter() {
  return createRouter({
    history: createWebHistory(),
    routes: [
      { path: '/', name: 'dashboard', component: stub, meta: { title: 'Dashboard', icon: 'dashboard' } },
      { path: '/calendar', name: 'calendar', component: stub, meta: { title: 'Calendar', icon: 'calendar' } },
      { path: '/settings', name: 'settings', component: stub, meta: { title: 'Settings', icon: 'settings' } },
      { path: '/hidden', name: 'hidden', component: stub, meta: { title: 'Hidden', icon: 'close', hidden: true } },
      { path: '/:pathMatch(.*)*', redirect: '/' }
    ]
  })
}

async function mountNav(path: string) {
  const router = makeRouter()
  await router.push(path)
  await router.isReady()

  return mount(AppNav, { global: { plugins: [router] } })
}

describe('AppNav', () => {
  it('renders a tab for every route with a title', async () => {
    const wrapper = await mountNav('/')

    const labels = wrapper.findAll('a span').map(node => node.text())
    expect(labels).toEqual(['Dashboard', 'Calendar', 'Settings'])
  })

  it('omits routes marked hidden and the catch-all redirect', async () => {
    const wrapper = await mountNav('/')

    expect(wrapper.text()).not.toContain('Hidden')
    expect(wrapper.findAll('a')).toHaveLength(3)
  })

  it('marks the current tab as the active page', async () => {
    const wrapper = await mountNav('/calendar')

    const current = wrapper.findAll('a').filter(link => link.attributes('aria-current') === 'page')
    expect(current).toHaveLength(1)
    expect(current[0]?.text()).toContain('Calendar')
  })

  it('does not treat every route as a prefix match of the dashboard', async () => {
    const wrapper = await mountNav('/settings')

    const dashboard = wrapper.findAll('a')[0]
    expect(dashboard?.attributes('aria-current')).toBeUndefined()
  })
})
