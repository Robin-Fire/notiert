import { fromLocalISODate, toLocalISODate } from './plannerDates'
import type { PlannerTask, TaskPlacement } from './contracts'

export const DEFAULT_DURATION = 30 * 60_000
export function validLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && toLocalISODate(fromLocalISODate(value)) === value
}
export function placementFields(placement: TaskPlacement) {
  if (placement.kind === 'timed') return { plannedDate: toLocalISODate(new Date(placement.startAt)), plannedStartAt: placement.startAt, plannedEndAt: placement.endAt, beforeEventId: null, ready: true }
  return { plannedDate: null, plannedStartAt: null, plannedEndAt: null, beforeEventId: null, ready: placement.kind === 'ready' }
}
export function taskDay(task: PlannerTask): string | null {
  return task.plannedStartAt !== null ? toLocalISODate(new Date(task.plannedStartAt)) : task.plannedDate
}
export function localDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  return `${toLocalISODate(date)}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}
export function minuteLabel(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}
