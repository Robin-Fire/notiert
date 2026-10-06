import { ImageIndicator } from '../components/ItemImages'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, CalendarDays, CheckCircle2, GripVertical, PanelLeftClose, PanelLeftOpen, Plus, RotateCcw } from 'lucide-react'
import type { DeletedPlannerEvent, PlannerEvent, PlannerEventInput, PlannerTask, PlannerTaskCreate, Settings } from '../../shared/contracts'
import { addLocalDays, eventOverlapsLocalDay, fromLocalISODate, localDateBounds, mondayISO, toLocalISODate } from '../../shared/plannerDates'
import { DEFAULT_DURATION, minuteLabel, taskDay } from '../../shared/calendarSchedule'
import { EventCalendar, useEventCalendar, type EventCalendarRenderEventProps } from '../components/reui/event-calendar/event-calendar'
import { EventCalendarContent } from '../components/reui/event-calendar/event-calendar-content'
import { TooltipProvider } from '../components/ui/tooltip'
import type { CalendarView as ReuiView, EventCalendarOccurrence } from '../components/reui/event-calendar/event-calendar-types'
import { calendarItems, type CalendarItemData } from './calendarAdapter'
import { useReadyDrag } from './useReadyDrag'
import { CalendarCreateDialog, type CalendarDraft } from './CalendarCreateDialog'
import { EventDialog } from './EventDialog'
import { TaskDetailDialog } from './TaskDetailDialog'
import { usePlannerData } from './usePlannerData'
import { useCalendarMutations } from './useCalendarMutations'
import { resultValue } from '../apiResult'

type Mode = 'day' | 'three' | 'workweek'
const views: ReuiView[] = ['day', 'days', 'week']
const viewSettings = { weekends: false, nowIndicator: true }
const i18n = { labels: { allDay: 'All day' }, formats: { timeGutter: 'HH:mm', timeGutterMinute: 'HH:mm' } }
const noEventsChange = () => {}
const weekday = (date: string) => ![0, 6].includes(fromLocalISODate(date).getDay())
function workday(date: string, direction = 1) { while (!weekday(date)) date = addLocalDays(date, direction); return date }
const dateLabel = (date: string) => fromLocalISODate(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

function itemContent({ occurrence, segment }: EventCalendarRenderEventProps<CalendarItemData>) {
  const task = occurrence.event.data?.kind === 'task' ? occurrence.event.data.record : null
  return <span className={`calendar-item-content ${task?.completedAt !== null && task ? 'is-complete' : ''}`}>
    <span className="calendar-item-title">{task ? task.completedAt !== null ? <CheckCircle2 size={12} /> : <span className="calendar-task-mark" /> : <CalendarDays size={12} />}<b>{occurrence.event.title}</b>{task && <ImageIndicator count={task.images.length} />}</span>
    {!occurrence.allDay && <span className="calendar-item-time">{occurrence.start.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}–{occurrence.end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}</span>}
    {(segment.continuesBefore || segment.continuesAfter) && <span className="calendar-continuation">{segment.continuesBefore ? '← ' : ''}{segment.continuesAfter ? ' →' : ''}</span>}
  </span>
}

/** ReUI captures the pointer on the chip; coordinates identify a release over Ready. */
function ReadyDropBridge({ onDrop }: { onDrop: (task: PlannerTask) => void }) {
  const calendar = useEventCalendar<CalendarItemData>()
  useEffect(() => {
    function release(event: PointerEvent) {
      const drag = calendar.getState().drag
      if (drag?.kind !== 'move' || drag.occurrence.event.data?.kind !== 'task') return
      const ready = calendar.internals.getRootEl()?.querySelector<HTMLElement>('[data-calendar-ready]')
      const rect = ready?.getBoundingClientRect()
      if (!rect || event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) return
      calendar.internals.setDrag(null)
      onDrop(drag.occurrence.event.data.record)
    }
    window.addEventListener('pointerup', release, true)
    return () => window.removeEventListener('pointerup', release, true)
  }, [calendar, onDrop])
  return null
}

export function CalendarView({ settings }: { settings: Settings | null }) {
  const [mode, setMode] = useState<Mode>('three')
  const [anchor, setAnchor] = useState(() => toLocalISODate(new Date()))
  const [creatingMeeting, setCreatingMeeting] = useState(false)
  const meetingLock = useRef(false)
  const [showReady, setShowReady] = useState(true)
  const [showPast, setShowPast] = useState(false)
  const [showHidden, setShowHidden] = useState(false)
  const [fullDay, setFullDay] = useState(false)
  const [draft, setDraft] = useState<CalendarDraft | null>(null)
  const [meeting, setMeeting] = useState<PlannerEvent | null>(null)
  const [detail, setDetail] = useState<PlannerTask | null>(null)
  const [deleted, setDeleted] = useState<DeletedPlannerEvent | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const today = toLocalISODate(new Date())
  const start = mode === 'workweek' ? mondayISO(fromLocalISODate(anchor)) : mode === 'day' ? anchor : workday(anchor)
  const count = mode === 'day' ? 1 : mode === 'three' ? 3 : 5
  let end = start
  let dayCount = 1
  for (let index = 1; index < count; index++) {
    do { end = addLocalDays(end, 1); dayCount++ } while (!weekday(end))
  }
  // Keep hidden weekend items accessible from the outside-visible-days list.
  const queryEnd = mode === 'workweek' ? addLocalDays(start, 6) : end
  const calendarDate = useMemo(() => fromLocalISODate(start), [start])
  const { tasks, events, tags, loading, error: loadError, refresh } = usePlannerData(start, queryEnd)
  const { overrides, error, setError, schedule, propose, pending } = useCalendarMutations(refresh)
  const readyDrag = useReadyDrag(root, schedule)
  const allItems = useMemo(() => {
    const map = new Map(calendarItems(tasks, events).map((item) => [item.id, item]))
    for (const [id, value] of Object.entries(overrides)) { if (value) map.set(id, value); else map.delete(id) }
    return [...map.values()]
  }, [tasks, events, overrides])
  const ready = tasks.filter((task) => task.completedAt === null && !task.plannedDate && task.ready).sort((a, b) => a.position - b.position)
  const past = tasks.filter((task) => task.completedAt === null && (task.plannedEndAt !== null ? task.plannedEndAt <= localDateBounds(start).start : task.plannedDate !== null && task.plannedDate < start))
  const startMinute = fullDay ? 0 : settings?.calendarStartMinute ?? 480
  const endMinute = fullDay ? 1440 : settings?.calendarEndMinute ?? 1080
  const days = useMemo(() => Array.from({ length: dayCount }, (_, index) => addLocalDays(start, index)).filter((date) => mode === 'day' || weekday(date)), [start, dayCount, mode])
  const hidden = allItems.filter((item) => {
    const overlapping = days.filter((day) => eventOverlapsLocalDay(item.start.getTime(), item.end.getTime(), day))
    if (!overlapping.length) return item.end.getTime() > localDateBounds(start).start && item.start.getTime() < localDateBounds(queryEnd).end
    if (item.allDay) return false
    return overlapping.some((day) => {
      const bounds = localDateBounds(day)
      return Math.max(item.start.getTime(), bounds.start) < bounds.start + startMinute * 60_000 || Math.min(item.end.getTime(), bounds.end) > bounds.start + endMinute * 60_000
    })
  })
  useEffect(() => { if (!deleted) return; const timer = setTimeout(() => setDeleted(null), 10_000); return () => clearTimeout(timer) }, [deleted])

  function navigate(direction: -1 | 1) {
    if (mode === 'workweek') { setAnchor(addLocalDays(start, direction * 7)); return }
    let date = start
    for (let index = 0; index < count; index++) date = workday(addLocalDays(date, direction), direction)
    setAnchor(date)
  }
  function addTask() {
    const time = fromLocalISODate(start)
    setDraft({ start: time, end: time, allDay: false, kind: 'task', ready: true })
  }
  async function addMeeting(day: Date) {
    if (meetingLock.current) return
    meetingLock.current = true; setCreatingMeeting(true)
    const time = fromLocalISODate(toLocalISODate(day)); time.setHours(Math.floor(startMinute / 60), startMinute % 60)
    try {
      resultValue(await window.captured.planner.createEvent({ title: 'New meeting', startAt: time.getTime(), endAt: time.getTime() + Math.min(DEFAULT_DURATION, (endMinute - startMinute) * 60_000), allDay: false }))
      setError(''); await refresh()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The meeting could not be created.') }
    finally { meetingLock.current = false; setCreatingMeeting(false) }
  }
  async function saveMeeting(input: PlannerEventInput) {
    try {
      resultValue(input.id ? await window.captured.planner.updateEvent({ ...input, id: input.id }) : await window.captured.planner.createEvent(input))
      setMeeting(null); setDraft(null); setError(''); await refresh(); return null
    } catch (reason) { return reason instanceof Error ? reason.message : 'The meeting could not be saved.' }
  }
  async function saveTask(input: PlannerTaskCreate) {
    try { resultValue(await window.captured.planner.createTask(input)); setDraft(null); setError(''); await refresh(); return null }
    catch (reason) { return reason instanceof Error ? reason.message : 'The task could not be saved.' }
  }
  const openItem = useCallback((occurrence: EventCalendarOccurrence<CalendarItemData>) => {
    const data = occurrence.event.data
    if (!data || pending.includes(occurrence.event.id)) return
    if (data.kind === 'task') setDetail(data.record)
    else setMeeting(data.record)
  }, [pending])
  const dropToReady = useCallback((task: PlannerTask) => { void schedule(task, { kind: 'ready' }) }, [schedule])

  function taskList(list: PlannerTask[]) {
    return list.map((task) => <div key={task.id} className="calendar-ready-task" onPointerDown={(event) => { if (!pending.includes(`task:${task.id}`)) readyDrag.begin(event, task) }}>
      <GripVertical size={13} aria-hidden="true" /><button type="button" disabled={pending.includes(`task:${task.id}`)} onClick={() => { if (!readyDrag.wasDragged()) setDetail(task) }}><b>{task.body.split('\n')[0] || 'Untitled task'}</b><ImageIndicator count={task.images.length} />{taskDay(task) && <small>{taskDay(task)}</small>}{task.tags.length > 0 && <small>{task.tags.map((tag) => `#${tag}`).join(' ')}</small>}</button>
    </div>)
  }

  return <section className="calenban-page calendar-page">
    <header className="calenban-toolbar"><div className="planner-heading"><div className="eyebrow">MAKE TIME</div><h1>Calendar</h1></div><div className="calenban-controls">
      <div className="planner-view-switch">{(['day', 'three', 'workweek'] as const).map((view) => <button key={view} type="button" aria-pressed={mode === view} onClick={() => setMode(view)}>{view === 'day' ? 'Day' : view === 'three' ? '3 days' : 'Workweek'}</button>)}</div>
      <div className="planner-range-controls"><button className="icon-button bordered" aria-label="Previous calendar period" onClick={() => navigate(-1)}><ArrowLeft size={15} /></button><button className="button secondary small" onClick={() => setAnchor(today)}>Today</button><button className="icon-button bordered" aria-label="Next calendar period" onClick={() => navigate(1)}><ArrowRight size={15} /></button></div>
      <button className="icon-button bordered" aria-label={showReady ? 'Hide Ready tasks' : 'Show Ready tasks'} onClick={() => setShowReady((value) => !value)}>{showReady ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}</button>
    </div></header>
    <div className="planner-range-bar"><span className="week-caption">{dateLabel(start)}{count > 1 ? ` – ${dateLabel(end)}` : ''}</span><div className="calendar-hours-caption"><span>{minuteLabel(startMinute)}–{minuteLabel(endMinute)}</span><button type="button" onClick={() => setFullDay((value) => !value)}>{fullDay ? 'Use settings hours' : 'Show full day'}</button></div></div>
    {(error || loadError) && <div className="inline-error" role="alert">{error || loadError}<button className="button secondary small" onClick={() => void refresh()}>Reload</button></div>}
    {hidden.length > 0 && <div className="calendar-hidden"><button type="button" aria-expanded={showHidden} onClick={() => setShowHidden((value) => !value)}>{hidden.length} {hidden.length === 1 ? 'item' : 'items'} outside visible hours or days · {showHidden ? 'Hide' : 'Show'}</button>{showHidden && <div className="calendar-hidden-list">{hidden.map((item) => <div key={item.id}><button onClick={() => { if (item.data?.kind === 'task') setDetail(item.data.record); else if (item.data?.kind === 'meeting') setMeeting(item.data.record) }}>{item.title}<small>{item.start.toLocaleString()}–{item.end.toLocaleString()}</small></button><button onClick={() => { setAnchor(toLocalISODate(item.start)); setMode('day'); setFullDay(true) }}>Show day</button></div>)}</div>}</div>}
    {deleted && <div className="calendar-notice">Meeting deleted.<button onClick={async () => { try { resultValue(await window.captured.planner.undoDeleteEvent(deleted)); setDeleted(null); await refresh() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore meeting.') } }}><RotateCcw size={13} /> Undo</button></div>}
    <div ref={root} className="calendar-host">
      <TooltipProvider><EventCalendar<CalendarItemData> className={`captured-calendar ${showReady ? 'with-ready' : ''}`} events={allItems} onEventsChange={noEventsChange} view={mode === 'day' ? 'day' : mode === 'three' ? 'days' : 'week'} date={calendarDate} dayCount={dayCount} views={views} weekStartsOn={1} viewSettings={viewSettings} dayStartHour={startMinute / 60} dayEndHour={endMinute / 60} slotDuration={Math.min(30, endMinute - startMinute)} snapDuration={15} interval={30} scrollToHour={startMinute / 60} scrollbars="native" renderDayHeader={({ day }) => <div className="calendar-day-heading"><span>{day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}</span><button type="button" className="icon-button calendar-day-add" aria-label={`Add meeting on ${dateLabel(toLocalISODate(day))}`} title="Add meeting" disabled={creatingMeeting} onClick={(event) => { event.stopPropagation(); void addMeeting(day) }}><Plus size={14} /></button></div>} renderEvent={itemContent} onEventUpdate={propose} onEventClick={(occurrence, event) => { event.preventDefault(); openItem(occurrence) }} onSlotClick={(slot) => setDraft({ start: slot.date, end: slot.end ?? fromLocalISODate(addLocalDays(toLocalISODate(slot.date), 1)), allDay: slot.allDay })} onSelectSlot={(slot) => setDraft(slot)} i18n={i18n}>
        <ReadyDropBridge onDrop={dropToReady} />
        {showReady && <aside className="calendar-ready" data-calendar-ready><header><b>READY</b><div className="calendar-ready-actions"><span>{ready.length}</span><button type="button" className="icon-button calendar-ready-add" aria-label="Add task to Ready" title="Add task to Ready" onClick={addTask}><Plus size={14} /></button></div></header><p className="calendar-ready-help">Drag a task to a time slot, or open it to set its schedule.</p>{taskList(ready)}{ready.length === 0 && <p className="drop-hint">Add a task here, choose from Backlog, or drag a scheduled task here.</p>}{past.length > 0 && <><button className="calendar-past-toggle" aria-expanded={showPast} onClick={() => setShowPast((value) => !value)}>Past plan · {past.length} · {showPast ? 'Hide' : 'Show'}</button>{showPast && taskList(past)}</>}</aside>}
        <div className="calendar-grid-pane" aria-busy={loading}><EventCalendarContent /></div>
      </EventCalendar></TooltipProvider>
      {readyDrag.ghost && <div className="calendar-drop-hint" style={{ left: readyDrag.ghost.x + 12, top: readyDrag.ghost.y + 12 }}>{readyDrag.ghost.task.body.split('\n')[0]}<br />{readyDrag.ghost.placement?.kind === 'timed' ? `${new Date(readyDrag.ghost.placement.startAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })} · Drop to schedule` : 'Drag onto a time slot'}</div>}
    </div>
    {draft && <CalendarCreateDialog draft={draft} onClose={() => setDraft(null)} onMeeting={saveMeeting} onTask={saveTask} />}
    {meeting && <EventDialog key={meeting.id} event={meeting} initialDate={toLocalISODate(new Date(meeting.startAt))} onClose={() => setMeeting(null)} onSave={saveMeeting} onDelete={async () => { setDeleted(resultValue(await window.captured.planner.deleteEvent(meeting.id))); setMeeting(null); await refresh() }} />}
    {detail && <TaskDetailDialog key={detail.id} task={detail} suggestions={tags} onClose={() => setDetail(null)} onChanged={() => void refresh()} />}
  </section>
}
