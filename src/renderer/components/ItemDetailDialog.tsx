import { CategoryPicker } from '../components/CategoryPicker'
import { useTaxonomy } from '../components/useTaxonomy'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { Archive, Copy, Save, Trash2 } from 'lucide-react'
import type { Note, PlannerTask } from '../../shared/contracts'
import { collectTags, TagEditor } from '../components/TagEditor'
import { useImagePaste } from '../components/useImagePaste'
import { ItemImages } from '../components/ItemImages'
import { DEFAULT_DURATION, localDateTime } from '../../shared/calendarSchedule'
import { toLocalISODate } from '../../shared/plannerDates'
import type { TaskPlacement } from '../../shared/contracts'
import { resultValue } from '../apiResult'

export function ItemDetailDialog({ task, initialTags, suggestions, onClose, onChanged }: { task: Note & Partial<PlannerTask>; initialTags?: string[]; suggestions: string[]; onClose: () => void; onChanged: () => void }) {
  const isTask = task.kind === 'task'
  const label = isTask ? 'to-do' : task.kind === 'inbox' ? 'inbox item' : 'note'
  const taxonomy=useTaxonomy()
  const [categoryId,setCategoryId]=useState(task.categoryId)
  const [subcategoryId,setSubcategoryId]=useState(task.subcategoryId??null)
  const [savedCategory,setSavedCategory]=useState(task.categoryId)
  const [savedSubcategory,setSavedSubcategory]=useState(task.subcategoryId??null)
  const [body, setBody] = useState(task.body)
  const [tags, setTags] = useState(initialTags ?? task.tags)
  const [tagDraft, setTagDraft] = useState('')
  const [savedBody, setSavedBody] = useState(task.body)
  const [savedTags, setSavedTags] = useState(task.tags)
  const [revision, setRevision] = useState(task.revision)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const imageEdit = useImagePaste(setError)
  const [savedImages, setSavedImages] = useState(task.images)
  const [busy, setBusy] = useState(false)
  const [placementKind, setPlacementKind] = useState<'timed' | 'ready' | 'backlog' | 'later'>(task.later ? 'later' : task.plannedStartAt != null ? 'timed' : task.plannedDate ? 'ready' : task.ready ? 'ready' : 'backlog')
  const initialStart = task.plannedStartAt ?? new Date(`${task.plannedDate ?? toLocalISODate(new Date())}T09:00`).getTime()
  const [start, setStart] = useState(localDateTime(initialStart))
  const [end, setEnd] = useState(localDateTime(task.plannedEndAt ?? initialStart + DEFAULT_DURATION))
  const dialogRef = useRef<HTMLDivElement>(null)
  const previousFocus = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  const changed = categoryId!==savedCategory || subcategoryId!==savedSubcategory || imageEdit.pending || imageEdit.images.map(image => image.id).join() !== savedImages.map(image => image.id).join() || body !== savedBody || collectTags(tags, tagDraft).join('\u0000') !== savedTags.join('\u0000')

  useEffect(() => {
    const background: { element: HTMLElement; inert: boolean }[] = []
    let layer = dialogRef.current?.parentElement
    while (layer && layer !== document.body) {
      for (const sibling of Array.from(layer.parentElement?.children ?? [])) {
        if (sibling instanceof HTMLElement && sibling !== layer) {
          background.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      layer = layer.parentElement
    }
    imageEdit.reset(task.images)
    dialogRef.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
    return () => {
      background.forEach(({ element, inert }) => { element.inert = inert })
      previousFocus.current?.focus()
    }
  }, [])

  function containFocus(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault()
      if (!busy && changed) void save()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      if (busy) return
      if (changed && !window.confirm('Discard unsaved item changes?')) return
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('textarea:not(:disabled), input:not(:disabled), select:not(:disabled), button:not(:disabled)')]
    const first = focusable[0], last = focusable.at(-1)
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
  }

  async function save() {
    if (busy || imageEdit.isPending()) return
    setBusy(true); setError('')
    try {
      const result = resultValue(await window.captured.notes.updateItem({ id: task.id, expectedRevision: revision, body, categoryId, subcategoryId, tags: collectTags(tags, tagDraft), images: imageEdit.images }))
      setSavedCategory(result.categoryId);setSavedSubcategory(result.subcategoryId);imageEdit.reset(result.images); setSavedImages(result.images); setRevision(result.revision); setSavedBody(result.body); setSavedTags(result.tags); setTags(result.tags); setTagDraft(''); onChanged(); onClose()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The item could not be saved.') }
    finally { setBusy(false) }
  }

  async function copy() {
    try { const text = resultValue(await window.captured.notes.copy([task.id])); setNotice(text ? 'Copied to clipboard.' : 'Nothing to copy.') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The item could not be copied.') }
  }

  async function trash() {
    if (changed && !window.confirm('Discard unsaved changes and move this item to Trash?')) return
    setBusy(true)
    try { resultValue(await window.captured.notes.trash([task.id])); onChanged(); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The item could not be moved to Trash.') }
    finally { setBusy(false) }
  }

  async function returnToInbox() {
    if (changed && !window.confirm('Discard unsaved changes and return this item to Inbox?')) return
    setBusy(true)
    try { resultValue(await window.captured.planner.unfile(task.id)); onChanged(); onClose() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'The item could not be returned to Inbox.') }
    finally { setBusy(false) }
  }

  async function savePlacement() {
    if (busy) return
    const startAt = new Date(start).getTime(), endAt = new Date(end).getTime()
    if ((placementKind === 'timed') && !Number.isFinite(startAt)) { setError('Choose a valid date.'); return }
    if (placementKind === 'timed' && (!Number.isFinite(endAt) || endAt <= startAt)) { setError('End time must be after start time.'); return }
    const placement: TaskPlacement = placementKind === 'timed' ? { kind: 'timed', startAt, endAt } : { kind: placementKind }
    setBusy(true); setError('')
    try {
      const saved = resultValue(await window.captured.planner.scheduleTask({ id: task.id, expectedRevision: revision, placement }))
      setRevision(saved.revision); setNotice('Schedule saved.'); onChanged()
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The schedule could not be saved.') }
    finally { setBusy(false) }
  }

  return <div className="modal-backdrop"><div ref={dialogRef} className="dialog-card task-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="task-detail-title" onKeyDown={containFocus}>
    <div className="event-dialog-kicker">{isTask ? 'TO-DO DETAILS' : task.kind === 'inbox' ? 'INBOX ITEM' : 'NOTE DETAILS'}</div><h2 id="task-detail-title">Edit {label}</h2>
    <label className="task-detail-body-label">Full text<textarea className="note-editor task-detail-editor" value={body} disabled={busy} onPaste={imageEdit.onPaste} maxLength={50_000} onChange={(event) => setBody(event.target.value)} aria-label={isTask ? 'Full task text' : 'Edit item'} /></label>
    <ItemImages images={imageEdit.images} expanded onRemove={imageEdit.remove} disabled={busy || imageEdit.pending} />
    <span className="image-paste-hint">{imageEdit.pending ? 'Reading image…' : 'Paste a screenshot with Ctrl+V · up to 5 images'}</span>
    <CategoryPicker categories={taxonomy.categories} subcategories={taxonomy.subcategories} categoryId={categoryId} subcategoryId={subcategoryId} onChange={(category,subcategory)=>{setCategoryId(category);setSubcategoryId(subcategory)}} disabled={busy}/>
    <div className="task-detail-tags"><span>Tags</span><TagEditor tags={tags} draft={tagDraft} onTagsChange={setTags} onDraftChange={setTagDraft} suggestions={taxonomy.tags.length?taxonomy.tags.map(tag=>tag.name):suggestions} disabled={busy} /></div>
    {isTask && task.completedAt === null && <fieldset className="task-schedule-fields" disabled={busy}><legend>Schedule</legend><label>Placement<select className="text-field" value={placementKind} onChange={(event) => setPlacementKind(event.target.value as typeof placementKind)}><option value="timed">Time block</option><option value="ready">Ready · unscheduled</option><option value="backlog">Backlog</option><option value="later">Later</option></select></label>{(placementKind === 'timed') && <div className="event-form-times"><label>Starts<input className="text-field" type="datetime-local" value={start} onChange={(event) => setStart(event.target.value)} /></label>{placementKind === 'timed' && <label>Ends<input className="text-field" type="datetime-local" value={end} onChange={(event) => setEnd(event.target.value)} /></label>}</div>}<button type="button" className="button secondary small" onClick={() => void savePlacement()} disabled={changed} title={changed ? 'Save item changes before changing its schedule' : undefined}>Save schedule</button></fieldset>}
    {error && <div className="inline-error" role="alert">{error}</div>}
    {notice && <div role="status" className="task-detail-notice">{notice}</div>}
    <div className="task-detail-actions">
      <button className="button secondary small" onClick={() => void copy()} disabled={busy}><Copy size={14} /> Copy</button>
      {isTask && <button className="button secondary small" disabled={busy} onClick={async () => { if (changed && !window.confirm('Discard unsaved item changes?')) return; setBusy(true); try { resultValue(await window.captured.planner.setTaskCompleted({ id: task.id, completed: task.completedAt === null })); onChanged(); onClose() } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not change task status.'); setBusy(false) } }}>{task.completedAt === null ? 'Complete' : 'Reopen'}</button>}
      {isTask && <button className="button secondary small" onClick={() => void returnToInbox()} disabled={busy}><Archive size={14} /> Return to Inbox</button>}
      <button className="button secondary small danger-action" onClick={() => void trash()} disabled={busy}><Trash2 size={14} /> Trash</button>
      <span />
      <button className="button secondary small" onClick={() => { if (!changed || window.confirm('Discard unsaved item changes?')) onClose() }} disabled={busy}>Close</button>
      <button className="button primary small" onClick={() => void save()} disabled={busy || imageEdit.pending || !changed}><Save size={14} /> Save</button>
    </div>
  </div></div>
}
