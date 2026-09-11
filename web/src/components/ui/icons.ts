/**
 * Inline icon paths.
 *
 * Hand-carried rather than pulled from an icon package: there are a dozen of
 * them, they never change, and a dependency would ship hundreds of unused
 * glyphs to a Raspberry Pi.
 *
 * All are 24x24, stroke-based, and inherit `currentColor`.
 */
export const icons = {
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  calendar:
    'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5zM4 10h16M9 3v4M15 3v4',
  tasks: 'M9 5h11M9 12h11M9 19h11M4 5l1.5 1.5L8 4M4 12l1.5 1.5L8 11M4 19l1.5 1.5L8 18',
  notes: 'M5 4h9l5 5v11H5zM14 4v5h5M8 13h7M8 16.5h5',
  meals: 'M6 3v8a3 3 0 0 0 6 0V3M9 11v10M17 3c-1.5 2-2 3.5-2 5.5S16 12 17 13v8',
  photos:
    'M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5zM4 15l4-4 4 4M13 13l2-2 5 5M15.5 9.5h.01',
  weather: 'M8 17a4 4 0 0 1-.4-7.98A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1 0 6.5zM12 4V2M5.6 6.6 4.2 5.2M18.4 6.6l1.4-1.4',
  news: 'M4 5.5A1.5 1.5 0 0 1 5.5 4h11A1.5 1.5 0 0 1 18 5.5V18a2 2 0 0 0 2-2V8h-2M4 5.5V18a2 2 0 0 0 2 2h12M7 8h8M7 11.5h8M7 15h5',
  draw: 'M4 20l1-4.5L15.5 5a2.1 2.1 0 0 1 3 3L8 18.5zM14 6.5 17 9.5',
  settings:
    'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-2.9 1.2v.17a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-2.9-1.2l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 3.5 15H3.4a2 2 0 1 1 0-4h.17a1.7 1.7 0 0 0 1.2-2.9l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 10.5 4.5V4.4a2 2 0 1 1 4 0v.17a1.7 1.7 0 0 0 2.9 1.2l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0 1.2 2.9h.17a2 2 0 1 1 0 4h-.17a1.7 1.7 0 0 0-1.23 1.4z',

  people:
    'M15.5 19.8v-1.6a3.9 3.9 0 0 0-3.9-3.9H6.4a3.9 3.9 0 0 0-3.9 3.9v1.6M9 11.2a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8M21.5 19.8v-1.6a3.9 3.9 0 0 0-2.9-3.8M15.6 4.6a3.9 3.9 0 0 1 0 7.1',
  // A wheelie bin with its lid lifted off, which is both the job and a shape
  // that cannot be confused with `trash` on a delete button.
  bins: 'M3.5 7.5h17M8 7.5l.6-2.2A1.5 1.5 0 0 1 10 4.2h4a1.5 1.5 0 0 1 1.4 1.1l.6 2.2M6.4 10.5h11.2l-.8 8.9a2 2 0 0 1-2 1.8H9.2a2 2 0 0 1-2-1.8zM10.5 13.5v4.5M13.5 13.5v4.5',

  // general purpose
  plus: 'M12 5v14M5 12h14',
  check: 'M5 13l4 4L19 7',
  close: 'M6 6l12 12M18 6 6 18',
  chevronLeft: 'M15 5l-7 7 7 7',
  chevronRight: 'M9 5l7 7-7 7',
  chevronDown: 'M6 9l6 6 6-6',
  refresh: 'M20 12a8 8 0 1 1-2.34-5.66M20 4v4h-4',
  repeat: 'M17 2.5l3.5 3.5-3.5 3.5M3.5 11.5V10a4 4 0 0 1 4-4h13M7 21.5L3.5 18 7 14.5M20.5 12.5V14a4 4 0 0 1-4 4h-13',
  warning: 'M12 4l9 16H3zM12 10v4M12 17.5h.01',
  offline:
    'M3 3l18 18M8.5 16.5a4 4 0 0 1 5.4-5.83M5.5 12.5A5.5 5.5 0 0 1 11 8M2.5 9.5a9.5 9.5 0 0 1 5-3.9M16.5 9.2A5.5 5.5 0 0 1 18 10.5a3.5 3.5 0 0 1 .8 6.9H10',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5V12l3 2',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6',
  edit: 'M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17zM14 7.5l2.5 2.5',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  play: 'M8 5l11 7-11 7z',
  pause: 'M9 5v14M15 5v14',
  star: 'M12 4l2.4 5.1 5.6.7-4.1 3.9 1 5.6L12 16.6 7.1 19.3l1-5.6L4 9.8l5.6-.7z',
  upload: 'M12 16V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15',
  expand: 'M4 9V4h5M20 15v5h-5M15 4h5v5M9 20H4v-5'
} as const

export type IconName = keyof typeof icons
