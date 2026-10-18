import { addLocalDays, fromLocalISODate, mondayISO } from './plannerDates'
import { validLocalDate } from './calendarSchedule'

export const horizons = ['unplanned', 'now', 'next', 'soon', 'later'] as const
export type Horizon = typeof horizons[number]
export const horizonLabels: Record<Horizon, string> = { unplanned: 'Unsorted', now: 'Now', next: 'Next', soon: 'Soon', later: 'Later' }
// Date intentions remain readable for older backups and are converted once at upgrade.
export type TaskIntention = { kind: Horizon | 'day' | 'week'; targetDate: string | null; position: number }
export function validIntention(value: TaskIntention): boolean {
  return Number.isInteger(value.position) && value.position >= 0 && (horizons.includes(value.kind as Horizon) ? value.targetDate === null : (value.kind === 'day' || value.kind === 'week') && !!value.targetDate && validLocalDate(value.targetDate) && (value.kind !== 'week' || mondayISO(fromLocalISODate(value.targetDate)) === value.targetDate))
}
export function legacyHorizonOf(intention: TaskIntention, today: string): 'unplanned' | 'today' | 'tomorrow' | 'next-week' | 'later' | 'upcoming' {
  if (intention.kind !== 'day' && intention.kind !== 'week') return intention.kind === 'now' ? 'today' : intention.kind === 'next' ? 'tomorrow' : intention.kind === 'soon' ? 'next-week' : intention.kind
  const date = intention.targetDate!
  const monday = mondayISO(fromLocalISODate(today))
  if (intention.kind === 'week') return date <= monday ? 'today' : date === addLocalDays(monday, 7) ? 'next-week' : 'upcoming'
  if (date <= today) return 'today'
  if (date === addLocalDays(today, 1)) return 'tomorrow'
  if (date < addLocalDays(monday, 7)) return 'upcoming'
  if (date < addLocalDays(monday, 14)) return 'next-week'
  return 'upcoming'
}
export function horizonOf(intention: TaskIntention, today: string): Horizon {
  if (horizons.includes(intention.kind as Horizon)) return intention.kind as Horizon
  const legacy = legacyHorizonOf(intention, today)
  return legacy === 'today' ? 'now' : legacy === 'tomorrow' ? 'next' : legacy === 'unplanned' || legacy === 'later' ? legacy : 'soon'
}
export function intentionFor(horizon: Horizon, _today?: string): TaskIntention {
  return { kind: horizon, targetDate: null, position: 0 }
}
export function isCarriedOver(_intention: TaskIntention, _today: string) { return false }
