import { useCallback, useRef, useState } from 'react'
import type { PlannerTask, TaskPlacement } from '../../shared/contracts'
import { placementFields } from '../../shared/calendarSchedule'
import type { EventCalendarProposedUpdate } from '../components/reui/event-calendar/event-calendar-types'
import { meetingItem, taskItem, type CalendarItem, type CalendarItemData } from './calendarAdapter'
import { resultValue } from '../apiResult'

export function useCalendarMutations(refresh: () => Promise<void>) {
  const locks = useRef(new Set<string>())
  const [overrides, setOverrides] = useState<Record<string, CalendarItem | null>>({})
  const [error, setError] = useState('')

  const run = useCallback(async (id: string, optimistic: CalendarItem | null, save: () => Promise<CalendarItem | null>) => {
    if (locks.current.has(id)) return false
    locks.current.add(id)
    setOverrides((current) => ({ ...current, [id]: optimistic && { ...optimistic, readOnly: true } }))
    setError('')
    try {
      const saved = await save()
      setOverrides((current) => ({ ...current, [id]: saved && { ...saved, readOnly: true } }))
      await refresh()
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The schedule could not be saved.')
      await refresh()
      return false
    } finally {
      setOverrides((current) => { const next = { ...current }; delete next[id]; return next })
      locks.current.delete(id)
    }
  }, [refresh])

  const schedule = useCallback((task: PlannerTask, placement: TaskPlacement) => {
    const next = { ...task, ...placementFields(placement) }
    return run(`task:${task.id}`, taskItem(next), async () => taskItem(resultValue(await window.captured.planner.scheduleTask({ id: task.id, expectedRevision: task.revision, placement }))))
  }, [run])

  const propose = useCallback((update: EventCalendarProposedUpdate<CalendarItemData>) => {
    const data = update.event.data
    if (!data || locks.current.has(update.event.id) || update.end <= update.start) return false
    if (data.kind === 'task') {
      if (data.record.completedAt !== null || update.allDay) return false
      void schedule(data.record, { kind: 'timed', startAt: update.start.getTime(), endAt: update.end.getTime() })
    } else {
      const record = data.record
      const next = { ...record, startAt: update.start.getTime(), endAt: update.end.getTime(), allDay: update.allDay }
      void run(update.event.id, meetingItem(next), async () => meetingItem(resultValue(await window.captured.planner.updateEventTiming({ id: record.id, startAt: next.startAt, endAt: next.endAt, allDay: next.allDay, expectedStartAt: record.startAt, expectedEndAt: record.endAt, expectedAllDay: record.allDay }))))
    }
    return true
  }, [run, schedule])

  return { overrides, error, setError, schedule, propose, pending: Object.keys(overrides) }
}
