import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import type { IconName } from '@/components/ui/icons'

/**
 * The tab set. `meta` drives the nav rail, so adding a page means adding a
 * route here and nothing else.
 *
 * Views are lazy-loaded: the Pi's browser then parses only the page being
 * looked at, which noticeably shortens the first paint after a reboot.
 */
declare module 'vue-router' {
  interface RouteMeta {
    title: string
    icon: IconName
    /** Hide from the nav rail (not used yet; reserved for sub-pages). */
    hidden?: boolean
  }
}

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { title: 'Dashboard', icon: 'dashboard' }
  },
  {
    path: '/calendar',
    name: 'calendar',
    component: () => import('@/views/Calendar.vue'),
    meta: { title: 'Calendar', icon: 'calendar' }
  },
  {
    path: '/tasks',
    name: 'tasks',
    component: () => import('@/views/Tasks.vue'),
    meta: { title: 'Tasks', icon: 'tasks' }
  },
  {
    path: '/notes',
    name: 'notes',
    component: () => import('@/views/Notes.vue'),
    meta: { title: 'Notes', icon: 'notes' }
  },
  {
    path: '/meals',
    name: 'meals',
    component: () => import('@/views/Meals.vue'),
    meta: { title: 'Meals', icon: 'meals' }
  },
  {
    path: '/photos',
    name: 'photos',
    component: () => import('@/views/Photos.vue'),
    meta: { title: 'Photos', icon: 'photos' }
  },
  {
    path: '/weather',
    name: 'weather',
    component: () => import('@/views/Weather.vue'),
    meta: { title: 'Weather', icon: 'weather' }
  },
  {
    path: '/news',
    name: 'news',
    component: () => import('@/views/News.vue'),
    meta: { title: 'News', icon: 'news' }
  },
  {
    path: '/draw',
    name: 'draw',
    component: () => import('@/views/Draw.vue'),
    meta: { title: 'Draw', icon: 'draw' }
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/views/Settings.vue'),
    meta: { title: 'Settings', icon: 'settings' }
  },
  {
    // A stale bookmark or a typo on the kiosk should land somewhere useful.
    path: '/:pathMatch(.*)*',
    redirect: '/'
  }
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
  scrollBehavior: () => ({ top: 0 })
})

router.afterEach(to => {
  const title = to.meta?.title
  document.title = title && title !== 'Dashboard' ? `${title} · Family Dashboard` : 'Family Dashboard'
})
