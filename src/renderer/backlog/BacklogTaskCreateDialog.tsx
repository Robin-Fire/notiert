import { CategoryPicker } from '../components/CategoryPicker'
import { useTaxonomy } from '../components/useTaxonomy'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Check, X } from 'lucide-react'
import type { Category, PlannerTask, TagRecord } from '../../shared/contracts'
import { collectTags, TagEditor } from '../components/TagEditor'

export function BacklogTaskCreateDialog({ categories, tags, initialCategoryId, onClose, onCreated, onError }: {
  categories: Category[]; tags: TagRecord[]; initialCategoryId: string | null
  onClose: () => void; onCreated: (task: PlannerTask) => void; onError: (message: string) => void
}) {
  const [body, setBody] = useState('')
  const taxonomy=useTaxonomy()
  const [categoryId,setCategoryId]=useState(initialCategoryId)
  const [subcategoryId,setSubcategoryId]=useState<string|null>(null)
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const dialog = useRef<HTMLFormElement>(null)
  const previousFocus = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  useEffect(() => { dialog.current?.querySelector('textarea')?.focus(); return () => previousFocus.current?.focus() }, [])

  function containFocus(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') { event.preventDefault(); if (!busy) onClose(); return }
    if (event.key !== 'Tab') return
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? [])]
    if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
    else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const result = await window.captured.planner.createTask({ body, categoryId, subcategoryId, tags: collectTags(selectedTags, tagDraft), placement: { kind: 'backlog-top' } })
      if (!result.ok) throw new Error(result.message)
      onCreated(result.value)
    } catch (reason) {
      onError(reason instanceof Error ? reason.message : 'The task could not be added to Backlog.')
      setBusy(false)
    }
  }

  return <div className="modal-backdrop"><form ref={dialog} className="dialog-card event-dialog backlog-create-dialog" role="dialog" aria-modal="true" aria-labelledby="backlog-create-title" onKeyDown={containFocus} onSubmit={(event) => void submit(event)}>
    <div className="event-dialog-kicker">BACKLOG TASK</div><h2 id="backlog-create-title">Add a to-do</h2>
    <label>Task<textarea className="text-field" value={body} disabled={busy} required maxLength={50000} onChange={(event) => setBody(event.target.value)} /></label>
    <CategoryPicker categories={categories} subcategories={taxonomy.subcategories} categoryId={categoryId} subcategoryId={subcategoryId} onChange={(category,subcategory)=>{setCategoryId(category);setSubcategoryId(subcategory)}} disabled={busy}/>
    <div className="task-detail-tags"><span>Tags</span><TagEditor tags={selectedTags} draft={tagDraft} onTagsChange={setSelectedTags} onDraftChange={setTagDraft} suggestions={tags.map((tag) => tag.name)} disabled={busy} /></div>
    <div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}><X size={14} /> Cancel</button><button className="button primary" disabled={busy || !body.trim()}>{busy ? 'Adding…' : <><Check size={14} /> Add to Backlog</>}</button></div>
  </form></div>
}
