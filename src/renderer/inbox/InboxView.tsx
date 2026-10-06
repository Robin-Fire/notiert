import { ItemDetailDialog } from '../components/ItemDetailDialog'
import { CategoryPicker } from '../components/CategoryPicker'
import { ImageIndicator } from '../components/ItemImages'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Archive, FileText, Info, ListTodo, Tag, X } from 'lucide-react'
import type { Category, InboxPage, Note, Subcategory, TagRecord } from '../../shared/contracts'
import { collectTags, TagEditor } from '../components/TagEditor'
import { resultValue as valueOf } from '../apiResult'

function dateLabel(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}

export function InboxView() {
  const [editTags, setEditTags] = useState<string[]>([])
  const [editItem, setEditItem] = useState<Note | null>(null)
  const [items, setItems] = useState<Note[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<InboxPage['nextCursor']>(null)
  const [taxonomyReady,setTaxonomyReady]=useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [subcategories,setSubcategories]=useState<Subcategory[]>([])
  const [tagRecords, setTagRecords] = useState<TagRecord[]>([])
  const filingRef = useRef(false)
  const filingBroadcastSeen = useRef(false)
  const skipNextBroadcast = useRef(false)
  const requestNumber = useRef(0)

  const load = useCallback(async (cursor?: InboxPage['nextCursor'], append = false) => {
    const request = ++requestNumber.current
    setLoading(true)
    try {
      const page = valueOf(await window.captured.planner.inbox({ cursor: cursor ?? undefined, limit: 50 }))
      if (request !== requestNumber.current) return
      setItems((current) => append ? [...current, ...page.items] : page.items)
      setNextCursor(page.nextCursor); setTotal(page.total); setError('')
    }
    catch (reason) { if (request === requestNumber.current) setError(reason instanceof Error ? reason.message : 'Inbox could not be loaded.') }
    finally { if (request === requestNumber.current) setLoading(false) }
  }, [])

  useEffect(() => { void load(); const unsubscribe = window.captured.planner.onChanged(() => {
    if (filingRef.current) { filingBroadcastSeen.current = true; return }
    if (skipNextBroadcast.current) { skipNextBroadcast.current = false; return }
    void load()
  }); return () => { requestNumber.current++; unsubscribe() } }, [load])
  useEffect(() => { void window.captured.notes.taxonomy().then((result) => { if (result.ok) { setCategories(result.value.categories);setSubcategories(result.value.subcategories??[]); setTagRecords(result.value.tags); setSuggestions(result.value.tags.map((tag) => tag.name));setTaxonomyReady(true) }else{setError(result.message);setTaxonomyReady(true)} }).catch(()=>{setError('Categories could not be loaded.');setTaxonomyReady(true)}) }, [])

  async function file(item: Note, kind: 'note' | 'task', tags: string[], categoryId: string | null, subcategoryId: string | null) {
    if (pendingId) return
    requestNumber.current++
    setLoading(false)
    filingRef.current = true
    filingBroadcastSeen.current = false
    setPendingId(item.id)
    try {
      valueOf(await window.captured.planner.classify({ id: item.id, kind, tags, categoryId, subcategoryId }))
      try { localStorage.removeItem(`inbox-tags:${item.id}`) } catch { /* Filing still succeeded. */ }
      setItems((current) => current.filter((candidate) => candidate.id !== item.id))
      setTotal((count) => Math.max(0, count - 1))
      if (!filingBroadcastSeen.current) skipNextBroadcast.current = true
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'The item could not be filed.') }
    finally { filingRef.current = false; setPendingId(null) }
  }

  async function setCategory(id: string, categoryId: string | null, subcategoryId: string | null) {
    try { valueOf(await window.captured.notes.setCategory({ id, categoryId, subcategoryId })); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Category could not be changed.'); return false }
  }

  return <section className="inbox-page">
    {editItem && <ItemDetailDialog key={editItem.id} task={editItem} initialTags={editTags} suggestions={suggestions} onClose={() => setEditItem(null)} onChanged={() => { try { localStorage.removeItem(`inbox-tags:${editItem.id}`) } catch {} setEditItem(null); void load() }} />}
    <header className="planner-page-heading"><div><span className="eyebrow">CAPTURE FIRST · SORT WHEN READY</span><h1>Inbox <span className="title-count">{total}</span></h1><p>Every thought lands here. Add tags, then file it as a note or a task.</p></div></header>
    {error && <div className="inline-error" role="alert"><Info size={15} /><span>{error}</span><button onClick={() => void load()}>Retry</button></div>}
    {(!taxonomyReady||loading && !items.length) ? <div className="loading-state"><span className="spinner" /> Loading inbox…</div> : !items.length ? <div className="inbox-empty"><div className="empty-mark"><Archive size={19} /></div><h2>Nothing waiting.</h2><p>New captures appear here, ready for a quick sort.</p></div> : <><div className="inbox-list">{items.map((item) => <InboxCard key={`${item.id}:${item.revision}`} item={item} onFile={file} onCategoryChange={setCategory} onOpen={(id, tags) => { setEditTags(tags); setEditItem(items.find(item => item.id === id) ?? null) }} busy={pendingId !== null} suggestions={suggestions} categories={categories} subcategories={subcategories} tagRecords={tagRecords} />)}</div>{nextCursor && <button className="load-more" onClick={() => void load(nextCursor, true)} disabled={loading}>Load older Inbox items</button>}</>}
  </section>
}

function readTagDraft(item: Note): { tags: string[]; draft: string; categoryId: string | null; subcategoryId?: string | null } {
  try {
    const stored = localStorage.getItem(`inbox-tags:${item.id}`)
    if (stored) {
      const value: unknown = JSON.parse(stored)
      if (value && typeof value === 'object' && 'tags' in value && 'draft' in value && Array.isArray(value.tags) && value.tags.every((tag) => typeof tag === 'string') && typeof value.draft === 'string') return { tags: collectTags(value.tags), draft: value.draft, categoryId: 'categoryId' in value && (typeof value.categoryId === 'string' || value.categoryId === null) ? value.categoryId : item.categoryId, subcategoryId:'subcategoryId' in value && (typeof value.subcategoryId==='string'||value.subcategoryId===null)?value.subcategoryId:null }
    }
  } catch { /* Use the stored item tags when local drafts are unavailable. */ }
  return { tags: item.tags, draft: '', categoryId: item.categoryId, subcategoryId:item.subcategoryId??null }
}

function InboxCard({ item, onFile, onCategoryChange, onOpen, busy, suggestions, categories, subcategories }: { item: Note; onFile: (item: Note, kind: 'note' | 'task', tags: string[], categoryId: string | null, subcategoryId: string | null) => void; onCategoryChange: (id: string, categoryId: string | null, subcategoryId: string | null) => Promise<boolean>; onOpen: (id: string, tags: string[]) => void; busy: boolean; suggestions: string[]; categories: Category[]; subcategories: Subcategory[]; tagRecords: TagRecord[] }) {
  const stateRef = useRef<{ tags: string[]; draft: string; categoryId: string | null; subcategoryId?: string | null } | null>(null)
  if (!stateRef.current) {
    const stored=readTagDraft(item)
    const category=categories.some(category=>category.id===stored.categoryId)?stored.categoryId:null
    const subcategory=subcategories.some(sub=>sub.id===stored.subcategoryId&&sub.categoryId===category)?stored.subcategoryId:null
    stateRef.current={...stored,categoryId:category,subcategoryId:subcategory}
  }
  const [tags, setTags] = useState(stateRef.current.tags)
  const [draft, setDraft] = useState(stateRef.current.draft)
  const [categoryId, setCategoryId] = useState<string | null>(stateRef.current.categoryId)
  const [subcategoryId,setSubcategoryId]=useState<string|null>(stateRef.current.subcategoryId??null)
  const [tagsOpen, setTagsOpen] = useState(false)
  const tagPickerRef = useRef<HTMLDivElement>(null)
  const tagButtonRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!tagsOpen) return
    tagPickerRef.current?.querySelector('input')?.focus()
    const dismiss = (event: PointerEvent) => {
      if (!tagPickerRef.current?.contains(event.target as Node)) setTagsOpen(false)
    }
    document.addEventListener('pointerdown', dismiss)
    return () => document.removeEventListener('pointerdown', dismiss)
  }, [tagsOpen])
  function persist(value: { tags: string[]; draft: string; categoryId: string | null; subcategoryId?: string | null }) {
    try { localStorage.setItem(`inbox-tags:${item.id}`, JSON.stringify({...value,version:2})) } catch { /* Classification still uses the in-memory value. */ }
  }
  const changeTags = (next: string[]) => { stateRef.current = { ...stateRef.current!, tags: next }; setTags(next); persist(stateRef.current) }
  const changeDraft = (next: string) => { stateRef.current = { ...stateRef.current!, draft: next }; setDraft(next); persist(stateRef.current) }
  return <article className="inbox-card">
    <button className="inbox-card-body" disabled={busy} onClick={() => onOpen(item.id, collectTags(tags, draft))} aria-label="Open and edit this captured item">
      <span className="inbox-card-text">{item.body.trim() || (item.images.length ? 'Image capture' : 'Empty capture')}</span>
      <span className="inbox-card-time">{dateLabel(item.createdAt)} <ImageIndicator count={item.images.length} /></span>
    </button>
    <div className="inbox-card-actions">
      <div className="inbox-tag-picker" ref={tagPickerRef} onKeyDown={(event) => {
        if (event.key === 'Escape') { event.stopPropagation(); setTagsOpen(false); tagButtonRef.current?.focus() }
      }} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setTagsOpen(false) }}>
        <button ref={tagButtonRef} className="inbox-tag-trigger" disabled={busy} aria-label="Edit tags" aria-expanded={tagsOpen} onClick={() => setTagsOpen(!tagsOpen)}>
          <Tag size={13} /><span>{tags.length ? `${tags.length} tag${tags.length === 1 ? '' : 's'}` : draft.trim() ? 'Tag draft' : 'Add tags'}</span>
        </button>
        {tagsOpen && <div className="inbox-tag-popover" role="group" aria-label="Tags">
          <div className="inbox-tag-heading"><strong>Tags</strong><button aria-label="Close tags" onClick={() => { setTagsOpen(false); tagButtonRef.current?.focus() }}><X size={14} /></button></div>
          <TagEditor tags={tags} draft={draft} onTagsChange={changeTags} onDraftChange={changeDraft} suggestions={suggestions} disabled={busy} hint="Enter to add · drafts saved automatically" />
        </div>}
      </div>
      <CategoryPicker compact categories={categories} subcategories={subcategories} categoryId={categoryId} subcategoryId={subcategoryId} disabled={busy} onChange={(category,subcategory)=>{
        const previous={categoryId,subcategoryId};setCategoryId(category);setSubcategoryId(subcategory)
        stateRef.current={...stateRef.current!,categoryId:category,subcategoryId:subcategory};persist(stateRef.current)
        void onCategoryChange(item.id,category,subcategory).then(saved=>{if(!saved&&stateRef.current?.categoryId===category&&stateRef.current?.subcategoryId===subcategory){setCategoryId(previous.categoryId);setSubcategoryId(previous.subcategoryId);stateRef.current={...stateRef.current!,...previous};persist(stateRef.current)}})
      }}/>

      <div className="inbox-file-actions"><span className="inbox-file-hint">File as</span><button disabled={busy} className="button secondary small" onClick={() => onFile(item, 'note', collectTags(tags, draft), categoryId, subcategoryId)}><FileText size={14} /> Note</button><button disabled={busy} className="button primary small" onClick={() => onFile(item, 'task', collectTags(tags, draft), categoryId, subcategoryId)}><ListTodo size={14} /> To-do</button></div>
    </div>
    {tags.length > 0 && <div className="inbox-tag-summary">{tags.map((tag) => <span key={tag} className="inbox-tag-label"><Tag size={10} />{tag}</span>)}</div>}
  </article>
}
