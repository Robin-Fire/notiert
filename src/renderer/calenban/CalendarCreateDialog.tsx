import { CategoryPicker } from '../components/CategoryPicker'
import { useTaxonomy } from '../components/useTaxonomy'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { EventDialog } from './EventDialog'
import { collectTags, TagEditor } from '../components/TagEditor'
import type { Category, TagRecord, PlannerEventInput, PlannerTaskCreate } from '../../shared/contracts'
import { localDateTime } from '../../shared/calendarSchedule'
import { toLocalISODate } from '../../shared/plannerDates'

export type CalendarDraft = { start: Date; end: Date; allDay: boolean; kind?: 'meeting' | 'task'; ready?: boolean }
export function CalendarCreateDialog({ draft, onClose, onMeeting, onTask }: { draft: CalendarDraft; onClose: () => void; onMeeting: (input: PlannerEventInput) => Promise<string | null>; onTask: (input: PlannerTaskCreate) => Promise<string | null> }) {
  const [kind, setKind] = useState<'meeting' | 'task'>(draft.kind ?? 'meeting')
  const [body, setBody] = useState('')
  const taxonomy=useTaxonomy()
  const [subcategoryId,setSubcategoryId]=useState<string|null>(null)
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [tagOptions, setTagOptions] = useState<TagRecord[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [taxonomyLoading, setTaxonomyLoading] = useState(true)
  const [start, setStart] = useState(localDateTime(draft.start.getTime()))
  const [end, setEnd] = useState(localDateTime(draft.end.getTime()))

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const form = useRef<HTMLFormElement>(null)
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { if (kind === 'task') form.current?.querySelector('textarea')?.focus(); return () => previousFocus.current?.focus() }, [kind])
  useEffect(() => {
    if (kind !== 'task') return
    let active = true
    setTaxonomyLoading(true)
    void window.captured.notes.taxonomy().then((result) => {
      if (!active) return
      if (!result.ok) { setError(result.message); return }
      setCategories(result.value.categories); setTagOptions(result.value.tags)
    }).catch(() => { if (active) setError('Categories and tags could not be loaded.') })
      .finally(() => { if (active) setTaxonomyLoading(false) })
    return () => { active = false }
  }, [kind])
  const switcher = <div className="calendar-create-switch planner-view-switch" aria-label="Create item type"><button type="button" aria-pressed={kind === 'meeting'} onClick={() => setKind('meeting')} disabled={busy}>Meeting</button><button type="button" aria-pressed={kind === 'task'} onClick={() => setKind('task')} disabled={busy || draft.allDay}>Task</button></div>
  function keys(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose() }
    if (event.key !== 'Tab') return
    const controls = [...(form.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])]
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
  }
  if (kind === 'meeting') return <EventDialog event="new" initialDate={toLocalISODate(draft.start)} initialInterval={draft} extraContent={switcher} onClose={onClose} onSave={onMeeting} />
  return <div className="modal-backdrop"><form ref={form} className="dialog-card event-dialog" role="dialog" aria-modal="true" aria-labelledby="create-task-title" onKeyDown={keys} onSubmit={async (event) => {
    event.preventDefault(); if (busy) return
    const startAt = new Date(start).getTime(), endAt = new Date(end).getTime()
    if (!draft.ready && (!Number.isFinite(startAt) || (!Number.isFinite(endAt) || endAt <= startAt))) { setError('Choose valid start and end times.'); return }
    setBusy(true); setError('')
    try { const message = await onTask({ body, categoryId, subcategoryId, tags: collectTags(tags, tagDraft), placement: draft.ready ? { kind: 'ready' } : { kind: 'timed', startAt, endAt } }); if (message) setError(message) } finally { setBusy(false) }
  }}>
    {!draft.ready && switcher}<div className="event-dialog-kicker">{draft.ready ? 'READY TASK' : 'SCHEDULED TASK'}</div><h2 id="create-task-title">Add a task</h2>
    <label>Task<textarea className="text-field" value={body} disabled={busy} required maxLength={50000} onChange={(event) => setBody(event.target.value)} /></label>
    <CategoryPicker categories={categories} subcategories={taxonomy.subcategories} categoryId={categoryId} subcategoryId={subcategoryId} onChange={(category,subcategory)=>{setCategoryId(category);setSubcategoryId(subcategory)}} disabled={busy||taxonomyLoading}/>
    <div className="task-detail-tags"><span>Tags</span><TagEditor tags={tags} draft={tagDraft} onTagsChange={setTags} onDraftChange={setTagDraft} suggestions={tagOptions.map((tag) => tag.name)} disabled={busy} /></div>
    {!draft.ready && <><div className="event-form-times"><label>Starts<input className="text-field" type="datetime-local" value={start} disabled={busy} required onChange={(event) => setStart(event.target.value)} /></label>{<label>Ends<input className="text-field" type="datetime-local" value={end} disabled={busy} required onChange={(event) => setEnd(event.target.value)} /></label>}</div>
</>}
    {error && <p className="inline-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || !body.trim()}>{busy ? 'Saving…' : 'Add task'}</button></div>
  </form></div>
}
