import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Check, Clock3 } from 'lucide-react'
import type { PlannerEvent, PlannerEventInput } from '../../shared/contracts'
import { addLocalDays } from '../../shared/plannerDates'
import type { MeetingRecurrence } from '../../shared/meetingRecurrence'
const localInput = (timestamp: number) => new Date(timestamp - new Date(timestamp).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
const dateInput = (isoDate: string) => `${isoDate}T09:00`

export function EventDialog({ event, initialDate, initialInterval, extraContent, onDelete, onClose, onSave }: {
  event: PlannerEvent | 'new'
  initialDate: string
  initialInterval?: { start: Date; end: Date; allDay: boolean }
  extraContent?: ReactNode
  onDelete?: (scope: 'instance' | 'series') => Promise<void>
  onClose: () => void
  onSave: (input: PlannerEventInput) => Promise<string | null>
}) {
  const [title, setTitle] = useState(event === 'new' ? '' : event.title)
  const [start, setStart] = useState(event === 'new' ? initialInterval ? localInput(initialInterval.start.getTime()) : dateInput(initialDate) : localInput(event.startAt))
  const [end, setEnd] = useState(event === 'new' ? initialInterval ? localInput(initialInterval.end.getTime()) : `${initialDate}T09:30` : localInput(event.endAt))
  const [allDay, setAllDay] = useState(event === 'new' ? initialInterval?.allDay ?? false : event.allDay)
  const [lastDate, setLastDate] = useState(() => {
    const exclusive = event === 'new' ? initialInterval?.end : new Date(event.endAt)
    return exclusive && (event === 'new' ? initialInterval?.allDay : event.allDay) ? localInput(exclusive.getTime() - 1).slice(0, 10) : start.slice(0, 10)
  })
  const [deleteScope, setDeleteScope] = useState<'instance' | 'series'>('instance')
  const [error, setError] = useState('')
  const [frequency, setFrequency] = useState<MeetingRecurrence['frequency'] | 'none'>('none')
  const [until, setUntil] = useState(() => addLocalDays(start.slice(0, 10), 90))
  const [saving, setSaving] = useState(false)
  const savingLock = useRef(false)
  const dialogRef = useRef<HTMLFormElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)

  useEffect(() => {
    titleRef.current?.focus()
    return () => previousFocus.current?.focus()
  }, [])

  function containFocus(keyEvent: KeyboardEvent<HTMLFormElement>) {
    if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); if (!savingLock.current) onClose(); return }
    if (keyEvent.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('input:not(:disabled), select:not(:disabled), button:not(:disabled)')]
    const first = focusable[0], last = focusable.at(-1)
    if (keyEvent.shiftKey && document.activeElement === first) { keyEvent.preventDefault(); last?.focus() }
    else if (!keyEvent.shiftKey && document.activeElement === last) { keyEvent.preventDefault(); first?.focus() }
  }

  async function submit(formEvent: FormEvent) {
    formEvent.preventDefault()
    if (savingLock.current) return
    setError('')
    const startDate = new Date(start)
    if (!Number.isFinite(startDate.getTime())) { setError('Choose a valid meeting start.'); return }
    let startAt = startDate.getTime()
    let endAt = new Date(end).getTime()
    if (allDay) {
      startDate.setHours(0, 0, 0, 0)
      startAt = startDate.getTime()
      const next = new Date(`${lastDate}T00:00`)
      next.setDate(next.getDate() + 1)
      endAt = next.getTime()
    }
    if (!Number.isFinite(endAt) || endAt <= startAt) { setError('End time must be after start time.'); return }
    if (frequency !== 'none' && until < start.slice(0, 10)) { setError('Choose a repeat end date on or after the meeting date.'); return }
    savingLock.current = true
    setSaving(true)
    try {
      const saveError = await onSave({ ...(event === 'new' ? {} : { id: event.id }), title, startAt, endAt, allDay, ...(frequency === 'none' ? {} : { recurrence: { frequency, until } }) })
      if (saveError) setError(saveError)
    } catch { setError('The meeting could not be saved. Try again.') }
    finally { savingLock.current = false; setSaving(false) }
  }

  return <div className="modal-backdrop"><form ref={dialogRef} className="dialog-card event-dialog" role="dialog" aria-modal="true" aria-labelledby="event-dialog-title" onSubmit={(formEvent) => void submit(formEvent)} onKeyDown={containFocus}>
    {extraContent}
    <div className="event-dialog-kicker"><Clock3 size={15} /> SCHEDULED MEETING</div>
    <h2 id="event-dialog-title">{event === 'new' ? 'Add a meeting' : 'Edit meeting'}</h2>
    <label>Title<input ref={titleRef} disabled={saving} className="text-field" maxLength={120} value={title} onChange={(change) => setTitle(change.target.value)} required aria-describedby={error ? 'event-error' : undefined} /></label>
    {!allDay && <div className="event-form-times"><label>Starts<input disabled={saving} className="text-field" type="datetime-local" value={start} onChange={(change) => setStart(change.target.value)} required aria-invalid={Boolean(error)} aria-describedby={error ? 'event-error' : undefined} /></label><label>Ends<input disabled={saving} className="text-field" type="datetime-local" value={end} onChange={(change) => setEnd(change.target.value)} required aria-invalid={Boolean(error)} aria-describedby={error ? 'event-error' : undefined} /></label></div>}
    {allDay && <div className="event-form-times"><label>First day<input disabled={saving} className="text-field" type="date" value={start.slice(0, 10)} onChange={(change) => { setStart(`${change.target.value}T00:00`); if (change.target.value > lastDate) setLastDate(change.target.value) }} required /></label><label>Last day<input disabled={saving} className="text-field" type="date" min={start.slice(0, 10)} value={lastDate} onChange={(change) => setLastDate(change.target.value)} required /></label></div>}
    <label className="all-day-choice"><input type="checkbox" disabled={saving} checked={allDay} onChange={(change) => { setAllDay(change.target.checked); if (lastDate < start.slice(0, 10)) setLastDate(start.slice(0, 10)) }} /> All day</label>
    <div className="event-form-times"><label>Repeat<select className="text-field" value={frequency} disabled={saving} onChange={(change) => setFrequency(change.target.value as typeof frequency)}><option value="none">Does not repeat</option><option value="daily">Every day</option><option value="weekly">Every week</option><option value="monthly">Every month</option></select></label>{frequency !== 'none' && <label>Until<input disabled={saving} className="text-field" type="date" value={until} min={start.slice(0, 10)} onChange={(change) => setUntil(change.target.value)} required /></label>}</div>
    {frequency !== 'none' && <p>Each occurrence can be edited or removed individually.{frequency === 'monthly' && ' Months without this day of the month are skipped.'}</p>}
    {error && <div id="event-error" className="inline-error" role="alert">{error}</div>}
    {onDelete && event !== 'new' && event.seriesId && <label>Delete<select className="text-field" disabled={saving} value={deleteScope} onChange={(change) => setDeleteScope(change.target.value as 'instance' | 'series')}><option value="instance">Only this meeting</option><option value="series">All meetings in this series</option></select></label>}
    <div className="dialog-actions">{onDelete && <button type="button" disabled={saving} className="button secondary danger-action" onClick={async () => { if (savingLock.current) return; savingLock.current = true; setSaving(true); setError(''); try { await onDelete(deleteScope) } catch (reason) { setError(reason instanceof Error ? reason.message : 'The meeting could not be removed.') } finally { savingLock.current = false; setSaving(false) } }}>{deleteScope === 'series' ? 'Delete all meetings' : 'Delete'}</button>}<button type="button" disabled={saving} className="button secondary" onClick={onClose}>Cancel</button><button disabled={saving} className="button primary"><Check size={14} /> {saving ? 'Saving…' : 'Save meeting'}</button></div>
  </form></div>
}
