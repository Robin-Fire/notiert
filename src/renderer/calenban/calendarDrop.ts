import type { TaskPlacement } from '../../shared/contracts'
import { DEFAULT_DURATION } from '../../shared/calendarSchedule'

/** Uses ReUI's measured day/bounds attributes, including the live scroll position. */
export function resolveCalendarDrop(root: HTMLElement, x: number, y: number): TaskPlacement | null {
  const viewport = root.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]')
  if (!viewport) return null
  const visible = viewport.getBoundingClientRect()
  if (y < visible.top || y > visible.bottom || x < visible.left || x > visible.right) return null
  for (const column of root.querySelectorAll<HTMLElement>('[data-slot="event-calendar-day-column"]')) {
    const rect = column.getBoundingClientRect()
    if (x < rect.left || x >= rect.right || y < rect.top || y > rect.bottom) continue
    const start = Number(column.dataset.ecBoundsStart), end = Number(column.dataset.ecBoundsEnd)
    const minute = Math.max(start, Math.min(end - 15, Math.round((start + (y - rect.top) / rect.height * (end - start)) / 15) * 15))
    const startAt = Number(column.dataset.ecDay) + minute * 60_000
    return { kind: 'timed', startAt, endAt: startAt + Math.min(DEFAULT_DURATION, (end - minute) * 60_000) }
  }
  return null
}
