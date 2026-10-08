import { addLocalDays, fromLocalISODate, mondayISO } from './plannerDates'
import { validLocalDate } from './calendarSchedule'

export const horizons = ['unplanned', 'today', 'tomorrow', 'next-week', 'later', 'upcoming'] as const
export type Horizon = typeof horizons[number]
export const horizonLabels: Record<Horizon, string> = { unplanned: 'Backlog', today: 'Today', tomorrow: 'Tomorrow', 'next-week': 'Next week', later: 'Later', upcoming: 'Upcoming' }
export type TaskIntention = { kind: 'unplanned' | 'day' | 'week' | 'later'; targetDate: string | null; position: number }
export function validIntention(value: TaskIntention): boolean {
  return Number.isInteger(value.position) && value.position >= 0 && ((value.kind === 'unplanned' || value.kind === 'later') ? value.targetDate === null : !!value.targetDate && validLocalDate(value.targetDate) && (value.kind !== 'week' || mondayISO(fromLocalISODate(value.targetDate)) === value.targetDate))
}
export function horizonOf(intention: TaskIntention, today: string): Horizon {
  if (intention.kind === 'unplanned' || intention.kind === 'later') return intention.kind
  const date = intention.targetDate!
  const monday = mondayISO(fromLocalISODate(today))
  if (intention.kind === 'week') return date <= monday ? 'today' : date === addLocalDays(monday, 7) ? 'next-week' : 'upcoming'
  if (date <= today) return 'today'
  if (date === addLocalDays(today, 1)) return 'tomorrow'
  if (date < addLocalDays(monday, 7)) return 'upcoming'
  if (date < addLocalDays(monday, 14)) return 'next-week'
  return 'upcoming'
}
export function intentionFor(horizon: Exclude<Horizon, 'upcoming'> | 'week', today: string): TaskIntention {
  const monday = mondayISO(fromLocalISODate(today))
  return { kind: horizon === 'unplanned' || horizon === 'later' ? horizon : horizon === 'today' || horizon === 'tomorrow' ? 'day' : 'week', targetDate: horizon === 'today' ? today : horizon === 'tomorrow' ? addLocalDays(today, 1) : horizon === 'week' ? monday : horizon === 'next-week' ? addLocalDays(monday, 7) : null, position: 0 }
}
export function isCarriedOver(intention: TaskIntention, today: string) {
  return !!intention.targetDate && intention.targetDate < (intention.kind === 'week' ? mondayISO(fromLocalISODate(today)) : today)
}
