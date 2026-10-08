import { AppSelect } from '../components/AppSelect'
import { horizonOf, horizonLabels } from '../../shared/taskHorizons'
import { ColorPalette } from '../components/ColorPalette'
import { TagFilter } from '../components/TagFilter'
import { ItemDetailDialog } from '../components/ItemDetailDialog'
import { TaxonomyNav } from '../components/TaxonomyNav'
import { MigrationReviewPanel } from '../components/MigrationReviewPanel'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Archive, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, Copy, Download, FileText, FolderKanban, FolderOpen, GripVertical, Hash, Info, Monitor, MoreHorizontal, Palette, Plus, Search, Settings as SettingsIcon, Shield, Sun, Trash2, Undo2, X, CalendarDays } from 'lucide-react'
import type { Category, Note, NoteFilter, NotePage, Settings, SettingsUpdate, Subcategory, TagRecord } from '../../shared/contracts'
import { localDateBounds, toLocalISODate } from '../../shared/plannerDates'
import { CalendarSettings } from '../calenban/CalendarSettings'
import { collectTags, TagEditor } from '../components/TagEditor'
import { ImageIndicator, ItemImages } from '../components/ItemImages'
import { resultValue } from '../apiResult'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

const CalendarView = lazy(() => import('../calenban/CalendarView').then((module) => ({ default: module.CalendarView })))
const TasksView = lazy(() => import('../tasks/TasksView').then(module => ({ default: module.TasksView })))

type NoteDetail = Note & { meetingTitle: string | null }
type ViewName = 'tasks' | 'all' | 'inbox' | 'calenban' | 'ready' | 'backlog' | 'later' | 'trash' | 'settings' | 'tag' | 'category' | 'review'
type ItemKind = Note['kind']
const itemKinds: { value: ItemKind; label: string }[] = [{ value: 'inbox', label: 'Inbox' }, { value: 'note', label: 'Notes' }, { value: 'task', label: 'To-dos' }]
const dateOptions = [{ value: 'all', label: 'All time' }, { value: 'today', label: 'Today' }, { value: 'last7', label: 'Last 7 days' }, { value: 'custom', label: 'Custom' }]
const kindLabel = (kind: ItemKind) => itemKinds.find((item) => item.value === kind)?.label ?? kind
const isTextEntry = (element: EventTarget | null) => element instanceof HTMLElement && (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
const todayISO = () => toLocalISODate(new Date())
const startOfLocalDay = (iso: string) => localDateBounds(iso).start
const endOfLocalDay = (iso: string) => localDateBounds(iso).end
const sixDaysAgo = () => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - 6); return date.getTime() }
const formatTime = (value: number) => new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
const formatDateTime = (value: number) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
function noteDateLabel(value: number) {
  const date = new Date(value), now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)
}
function excerpt(body: string) { return body.replace(/\s+/g, ' ').trim() || 'Empty note' }

export function NotesApp() {
  const [view, setView] = useState<ViewName>('all')
  const [notes, setNotes] = useState<NoteDetail[]>([])
  const [total, setTotal] = useState(0)
  const [inboxCount, setInboxCount] = useState(0)
  const [cursor, setCursor] = useState<NotePage['nextCursor']>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [dateRange, setDateRange] = useState('all')
  const [kindFilters, setKindFilters] = useState<ItemKind[]>([])
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [excludedTags, setExcludedTags] = useState<string[]>([])
  const [subcategoryFilter,setSubcategoryFilter]=useState('')
  const activeFilterCount = kindFilters.length + tagFilters.length + excludedTags.length + (subcategoryFilter?1:0) + (dateRange === 'all' ? 0 : 1)
  const [categories, setCategories] = useState<Category[]>([])
  const [subcategories,setSubcategories]=useState<Subcategory[]>([])
  const [selectedSubcategoryId,setSelectedSubcategoryId]=useState<string|null>(null)
  const [noSubcategory,setNoSubcategory]=useState(false)
  const [taxonomyLoaded,setTaxonomyLoaded]=useState(false)
  const [upgradeNotice,setUpgradeNotice]=useState(false)
  const [reviewCount,setReviewCount]=useState(0)
  const [tagRecords, setTagRecords] = useState<TagRecord[]>([])
  const availableTags = useMemo(() => tagRecords.map((tag) => tag.name), [tagRecords])
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<NoteDetail | null>(null)
  const [detail, setDetail] = useState<NoteDetail | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  useEffect(() => { setSelectionMode(false); setSelected([]) }, [view, selectedCategoryId, selectedTagId, selectedSubcategoryId])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [displays, setDisplays] = useState<{ id: number; label: string; primary: boolean }[]>([])
  const requestLeaveRef = useRef<(action: () => void) => void>(() => {})
  const [loading, setLoading] = useState(true)
  const notesRequest = useRef(0)
  const taxonomyRequest = useRef(0)
  const detailRequest = useRef(0)
  const activeDetailId = useRef(detailId)
  activeDetailId.current = detailId
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [browserCaptureKind, setBrowserCaptureKind] = useState<'inbox' | 'task' | 'note'>('inbox')
  const [browserCaptureOpen, setBrowserCaptureOpen] = useState(false)
  const [browserCaptureText, setBrowserCaptureText] = useState('')
  const [browserCaptureTags,setBrowserCaptureTags]=useState<string[]>([])
  const [browserCaptureTagDraft,setBrowserCaptureTagDraft]=useState('')
  const [browserCaptureSubcategoryId,setBrowserCaptureSubcategoryId]=useState<string|null>(null)
  const [browserCaptureCategoryId, setBrowserCaptureCategoryId] = useState<string | null>(null)
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<{ status: string; version?: string }>({ status: 'idle' })
  const [firstRun, setFirstRun] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const noteListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const loadSettings = useCallback(async () => {
    try {
      const [loaded, screens] = await Promise.all([window.captured.settings.get(), window.captured.settings.displays()])
      const nextSettings = resultValue(loaded)
      setSettings(nextSettings)
      setDisplays(resultValue(screens))
      setFirstRun(!nextSettings.firstRunComplete)
      document.documentElement.dataset.theme = nextSettings.theme
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Settings are unavailable.') }
  }, [])

  const loadInboxCount = useCallback(async () => {
    try { setInboxCount(resultValue(await window.captured.planner.inboxCount())) } catch { /* the Inbox view reports its own load error */ }
  }, [])
  const loadMigration = useCallback(() => {
    if(window.captured.notes.migrationStatus)void window.captured.notes.migrationStatus().then(result=>{if(result.ok)setUpgradeNotice(result.value.upgraded&&!result.value.acknowledged)}).catch(()=>{})
    if(window.captured.notes.migrationReview) void window.captured.notes.migrationReview().then(result=>{if(result.ok)setReviewCount(result.value.length)}).catch(()=>{})
  }, [])
  const loadTags = useCallback(async () => {
    const request = ++taxonomyRequest.current
    try {
      const data = resultValue(await window.captured.notes.taxonomy())
      if (request !== taxonomyRequest.current) return
      setTaxonomyLoaded(true);setCategories(data.categories);setSubcategories(data.subcategories??[]); setTagRecords(data.tags)
    } catch (reason) {
      if (request === taxonomyRequest.current) setError(reason instanceof Error ? reason.message : 'Categories and tags could not be loaded.')
    }
  }, [])

  const selectedTagName = tagRecords.find((tag) => tag.id === selectedTagId)?.name
  const filter = useMemo<NoteFilter>(() => {
    let dateFrom: number | undefined, dateTo: number | undefined
    if (dateRange === 'today') { const today = todayISO(); dateFrom = startOfLocalDay(today); dateTo = endOfLocalDay(today) }
    if (dateRange === 'last7') { dateFrom = sixDaysAgo(); dateTo = endOfLocalDay(todayISO()) }
    if (dateRange === 'custom') { dateFrom = startOfLocalDay(customFrom); dateTo = endOfLocalDay(customTo) }
    const scope = view === 'trash' ? 'trash' : 'notes'
    return { subcategoryId:subcategoryFilter&&subcategoryFilter!=='none'?subcategoryFilter:view==='category'?selectedSubcategoryId??undefined:undefined,noSubcategory:subcategoryFilter==='none'||view==='category'&&noSubcategory, query: debouncedQuery, scope, dateFrom, dateTo, categoryId: view === 'category' ? selectedCategoryId ?? undefined : undefined, kinds: kindFilters.length ? kindFilters : undefined, excludedTags: excludedTags.length ? excludedTags : undefined, tags: view === 'tag' ? [selectedTagName ?? '__missing_tag__'] : tagFilters.length ? tagFilters : undefined, includeCompleted: scope === 'notes' && showCompleted, limit: 50, sort: view === 'tag' || view === 'category' ? 'priority' : 'newest' }
  }, [subcategoryFilter,selectedSubcategoryId,noSubcategory,dateRange, customFrom, customTo, debouncedQuery, kindFilters, tagFilters, excludedTags, selectedTagName, selectedCategoryId, showCompleted, view])
  const activeFilter = useRef(filter)
  activeFilter.current = filter

  const loadNotes = useCallback(async (nextCursor?: NotePage['nextCursor'], append = false) => {
    if (!['all', 'trash', 'tag', 'category'].includes(view)) return
    if (activeFilter.current !== filter) return
    const request = ++notesRequest.current
    setLoading(true); setError('')
    try {
      const page = resultValue(await window.captured.notes.list({ ...filter, cursor: nextCursor ?? undefined }))
      if (request !== notesRequest.current || activeFilter.current !== filter) return
      setNotes((current) => append ? [...current, ...page.items] : page.items)
      setTotal(page.total); setCursor(page.nextCursor)
    } catch (reason) { if (request === notesRequest.current && activeFilter.current === filter) setError(reason instanceof Error ? reason.message : 'Notes could not be loaded.') }
    finally { if (request === notesRequest.current && activeFilter.current === filter) setLoading(false) }
  }, [filter, view])

  useEffect(() => { void loadNotes(); setSelected([]); return () => { notesRequest.current++ } }, [loadNotes])
  useEffect(() => () => { taxonomyRequest.current++; detailRequest.current++ }, [])
  useEffect(() => { void loadSettings(); void loadInboxCount(); void loadTags(); loadMigration() }, [loadSettings, loadInboxCount, loadTags, loadMigration])
  useEffect(() => window.captured.notes.onChanged(() => { void loadNotes() }), [loadNotes])
  useEffect(() => window.captured.notes.onTaxonomyChanged(() => { void loadTags(); loadMigration() }), [loadTags, loadMigration])
  useEffect(() => window.captured.planner.onChanged(() => { void loadInboxCount() }), [loadInboxCount])
  useEffect(() => window.captured.settings.onChanged(() => { void loadSettings() }), [loadSettings])
  useEffect(() => {
    void window.captured.updates.getStatus().then((result) => { if (result.ok) setUpdateStatus(result.value) })
    return window.captured.updates.onChanged(setUpdateStatus)
  }, [])
  useEffect(() => { const unsubscribe = window.captured.windows.onView((next) => requestLeaveRef.current(() => { setView(next); setDetailId(null); setDetail(null); setSelected([]); document.documentElement.dataset.windowReady = 'true' })); window.captured.windows.ready(); return unsubscribe }, [])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f' && (view === 'all' || view === 'trash' || view === 'tag' || view === 'category') && !(event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))) { event.preventDefault(); searchRef.current?.focus(); return }
      if (view !== 'all' && view !== 'trash' && view !== 'tag' && view !== 'category') return
      if (isTextEntry(event.target)) return
      if (event.target instanceof HTMLElement && event.target.closest('button, a, [role="button"], [role="dialog"]') && !((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.closest('.note-row-open'))) return
      if (event.key === 'Delete' && selected.length) { event.preventDefault(); void trashSelected() }
      if (event.key === 'Escape' && detailId && window.innerWidth < 960) { setDetailId(null); setDetail(null) }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const currentId = focusedId ?? detailId
        const index = notes.findIndex((note) => note.id === currentId)
        const next = notes[Math.max(0, Math.min(notes.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        if (next) { event.preventDefault(); setFocusedId(next.id); noteListRef.current?.querySelector<HTMLButtonElement>(`[data-note-id="${next.id}"] .note-row-open`)?.focus() }
      }
      if (event.key === 'Enter') {
        const selectedNote = notes.find((note) => note.id === focusedId) ?? (!detailId ? notes[0] : undefined)
        if (selectedNote) { event.preventDefault(); requestLeaveRef.current(() => void openNote(selectedNote.id)) }
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })

  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(''), 2600); return () => clearTimeout(timer) }, [toast])
  useEffect(() => { const open = (event:Event) => {const context=(event as CustomEvent).detail as {categoryId:string|null;subcategoryId?:string|null;tags?:string[]}|undefined;if(context&&!browserCaptureText.trim()){setBrowserCaptureCategoryId(context.categoryId);setBrowserCaptureSubcategoryId(context.subcategoryId??null);setBrowserCaptureTags(context.tags??[])}setBrowserCaptureOpen(true)}; window.addEventListener('captured:browser-capture', open); return () => window.removeEventListener('captured:browser-capture', open) }, [browserCaptureText])

  async function submitBrowserCapture() {
    if (!browserCaptureText.trim()) return
    try { resultValue(await window.captured.capture.submit({ requestId: crypto.randomUUID(), generation: 0, body: browserCaptureText, captureKind: browserCaptureKind, categoryId: browserCaptureCategoryId,subcategoryId:browserCaptureSubcategoryId,tags:collectTags(browserCaptureTags,browserCaptureTagDraft) })); setBrowserCaptureText(''); setBrowserCaptureTags([]);setBrowserCaptureTagDraft(''); setBrowserCaptureKind('inbox'); setBrowserCaptureOpen(false); nav('inbox') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Capture could not be saved.') }
  }

  async function openNote(id: string) {
    const request = ++detailRequest.current
    activeDetailId.current = id
    setDetailId(id); setDetail(null)
    try {
      const record = resultValue(await window.captured.notes.get(id))
      if (request !== detailRequest.current || activeDetailId.current !== id) return
      if (view === 'all' && record) {
        setEditItem(record)
        setDetailId(null)
        setDetail(null)
      } else setDetail(record)
    } catch (reason) { if (request === detailRequest.current && activeDetailId.current === id) setError(reason instanceof Error ? reason.message : 'This note could not be opened.') }
  }
  function clearFilters() { setQuery(''); setDateRange('all'); setKindFilters([]); setTagFilters([]);setExcludedTags([]);setSubcategoryFilter('') }
  function nav(next: ViewName) { requestLeaveRef.current(() => { setSelectedSubcategoryId(null);setNoSubcategory(false); setSelectedTagId(null); setSelectedCategoryId(null); setView(next); setShowCompleted(false); setDetailId(null); setFocusedId(null); setDetail(null); setSelected([]); clearFilters() }) }
  function openTag(tag: TagRecord) { requestLeaveRef.current(() => { setSelectedSubcategoryId(null);setNoSubcategory(false); setSelectedTagId(tag.id); setSelectedCategoryId(null); setView('tag'); setShowCompleted(false); setDetailId(null); setDetail(null); setSelected([]); clearFilters() }) }
  function openCategory(category: Category,subcategoryId:string|null=null,directOnly=false) { requestLeaveRef.current(() => { setSelectedSubcategoryId(subcategoryId);setNoSubcategory(directOnly); setSelectedCategoryId(category.id); setSelectedTagId(null); setView('category'); setShowCompleted(false); setDetailId(null); setFocusedId(null); setDetail(null); setSelected([]); clearFilters() }) }
  async function changeTag(input: { categoryId: string | null; color: string }) {
    if (!selectedTagId) return
    try { resultValue(await window.captured.notes.updateTag({ id: selectedTagId, ...input })); void loadTags() }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Tag could not be updated.') }
  }
  const selectedTag = tagRecords.find((tag) => tag.id === selectedTagId) ?? null
  const selectedCategory = categories.find((category) => category.id === selectedCategoryId) ?? null
  function toggleKind(kind: ItemKind) { requestEditorLeave(() => setKindFilters((current) => current.includes(kind) ? current.filter((value) => value !== kind) : [...current, kind])) }
  async function reorderTask(id: string, categoryId: string | null, requestedBeforeId: string | null) {
    try {
      let beforeId = requestedBeforeId
      if (beforeId === null && cursor) {
        let nextCursor: typeof cursor | null = cursor
        while (nextCursor && beforeId === null) {
          const nextPage: NotePage = resultValue(await window.captured.notes.list({ ...filter, cursor: nextCursor }))
          beforeId = nextPage.items.find((item) => item.kind === 'task' && item.completedAt == null && item.categoryId === categoryId)?.id ?? null
          nextCursor = nextPage.nextCursor
        }
      }
      resultValue(await window.captured.planner.reorderBacklog({ id, categoryId, beforeId })); await loadNotes()
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'To-do priority could not be saved.') }
  }
  async function setTaskCompleted(id: string, completed: boolean): Promise<boolean> {
    try { resultValue(await window.captured.planner.setTaskCompleted({ id, completed })); setError(''); setToast(completed ? 'To-do marked done' : 'To-do moved back to Backlog'); return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'To-do status could not be changed.'); return false }
  }
  async function toggleDetailCompletion() {
    if (detail && await setTaskCompleted(detail.id, detail.completedAt == null)) { setDetailId(null); setDetail(null) }
  }
  async function trashSelected() {
    if (!selected.length) return
    try { resultValue(await window.captured.notes.trash(selected)); setSelected([]); setDetailId(null); setDetail(null); setToast(`${selected.length} ${selected.length === 1 ? 'note moved' : 'notes moved'} to Trash`) }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Notes could not be moved to Trash.') }
  }
  async function copyIds(ids: string[]) {
    try { const text = resultValue(await window.captured.notes.copy(ids)); setToast(text ? 'Copied to clipboard' : 'Nothing to copy') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not copy notes.') }
  }
  async function exportData(scope: 'selected' | 'all' | 'full', ids?: string[]) {
    if (scope === 'selected' && !ids?.length) return
    try { resultValue(await window.captured.data.export({ scope, format: 'md', ids })); setToast('Export ready') }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed.') }
  }
  const toggleSelected = (id: string) => {
    if (!selected.includes(id) && selected.length >= 500) { setToast('Select up to 500 notes at a time'); return }
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }
  async function restoreOne(id: string) { try { resultValue(await window.captured.notes.restore([id])); setToast('Note restored') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore note.') } }
  async function deleteOne(id: string) { try { resultValue(await window.captured.notes.deletePermanently([id])); setToast('Note deleted permanently'); setDetailId(null); setDetail(null) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete note.') } }
  async function emptyTrash() { try { resultValue(await window.captured.notes.emptyTrash()); setToast('Trash emptied'); setDetailId(null); setDetail(null) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not empty Trash.') } }

  const saveSettings = async (update: SettingsUpdate) => {
    try { const saved = resultValue(await window.captured.settings.update(update)); setSettings(saved); document.documentElement.dataset.theme = saved.theme; return true }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Setting could not be saved.'); return false }
  }
  const finishFirstRun = async (shortcut: string, launchAtLogin: boolean) => {
    const done = await saveSettings({ shortcut, shortcutEnabled: true, launchAtLogin, firstRunComplete: true })
    if (done) { setFirstRun(false); setToast('Setup complete'); window.captured.windows.openCapture() }
  }
  const continueTrayOnly = async (launchAtLogin: boolean) => {
    const done = await saveSettings({ shortcutEnabled: false, launchAtLogin, firstRunComplete: true })
    if (done) setFirstRun(false)
  }

  const renderRows = () => {
    const hasFilters = !!(excludedTags.length || subcategoryFilter || debouncedQuery || kindFilters.length || ((view !== 'tag') && tagFilters.length) || dateRange !== 'all')
    if (!notes.length && !loading && !error) return <div className="empty-state">
      <div className="empty-mark"><FileText size={20} /></div><h2>{view === 'tag' && !hasFilters ? 'No items with this tag yet.' : view === 'category' && !hasFilters ? 'No items in this category yet.' : hasFilters ? 'No matching items.' : view === 'trash' ? 'Trash is empty.' : 'Your next thought goes here.'}</h2>
      <p>{hasFilters ? 'Try another phrase or clear the filters.' : view === 'tag' ? 'Items using this tag will appear here.' : view === 'category' ? 'Items assigned to this category will appear here, including items with no tag.' : view === 'trash' ? 'Deleted items stay here until you remove them permanently.' : `Press ${settings?.shortcut.replace('Control', 'Ctrl') ?? 'Ctrl+N'} from any app to capture an item.`}</p>
      {hasFilters ? <button className="button secondary" onClick={() => requestEditorLeave(clearFilters)}>Clear filters</button> : view === 'all' && <button className="button primary" onClick={() => window.captured.windows.openCapture()}>Capture a thought <ArrowRight size={15} /></button>}
    </div>
    const renderRow = (note: NoteDetail, sortable?: SortableRowProps) => <article ref={sortable?.ref} style={sortable?.style} key={note.id} data-note-id={note.id} className={`note-row ${sortable ? 'priority-note-row' : ''} ${note.completedAt != null ? 'is-completed' : ''} ${detailId === note.id || focusedId === note.id ? 'is-active' : ''} ${selected.includes(note.id) ? 'is-selected' : ''}`}>
      {sortable && <button type="button" className="note-drag-handle" aria-label={`Reorder to-do ${note.body.trim() ? excerpt(note.body).slice(0, 80) : 'without a title'}`} title="Drag to change priority" {...sortable.attributes} {...sortable.listeners}><GripVertical size={14} /></button>}
      {selectionMode ? <input className="row-select" type="checkbox" aria-label="Select item" checked={selected.includes(note.id)} onChange={() => toggleSelected(note.id)} /> : note.kind === 'task' && <input className="note-completion-toggle" type="checkbox" aria-label={`${note.completedAt != null ? 'Reopen' : 'Mark as done'} to-do: ${note.body.trim() ? excerpt(note.body).slice(0, 80) : 'without a title'}`} checked={note.completedAt != null} onChange={(event) => void setTaskCompleted(note.id, event.target.checked)} />}
      <button className="note-row-open" aria-label={`Open ${note.kind === 'note' ? 'note' : note.kind === 'task' ? 'to-do' : 'inbox item'} ${note.body.trim() ? excerpt(note.body).slice(0, 80) : note.images.length ? 'Image capture' : 'Empty item'}`} onClick={() => requestEditorLeave(() => void openNote(note.id))} onFocus={() => setFocusedId(note.id)}>
        <span className="note-preview">{note.body.trim() ? excerpt(note.body) : note.images.length ? 'Image capture' : 'Empty item'}</span>
        <span className="note-meta"><time>{formatTime(view === 'trash' ? note.deletedAt ?? note.createdAt : note.createdAt)}</time><span className="note-kind-chip">{kindLabel(note.kind)}</span>{note.completedAt != null && <span className="note-completed-chip">Done</span>}{note.kind === 'task' && note.intention && <span className="note-completed-chip">{horizonLabels[horizonOf(note.intention, toLocalISODate(new Date()))]}</span>}{note.subcategoryId&&<span className="subcategory-label">{(view==='category'?'':(categories.find(item=>item.id===note.categoryId)?.name??'')+' / ')+subcategories.find(item=>item.id===note.subcategoryId)?.name}</span>}<ImageIndicator count={note.images.length} />{note.tags.map((tag) => <span className="note-tag-chip" key={tag} style={{ color: tagRecords.find((record) => record.name.toLocaleLowerCase() === tag.toLocaleLowerCase())?.color }}>{tag}</span>)}</span>
      </button>
    </article>

    if (view === 'category' || view === 'tag') {
      const taskGroups = new Map<string, NoteDetail[]>()
      notes.filter((note) => note.kind === 'task' && note.completedAt == null).forEach((task) => {
        const key = task.categoryId ?? 'unassigned'
        taskGroups.set(key, [...(taskGroups.get(key) ?? []), task])
      })
      const priorityGroups = [...taskGroups.entries()].map(([categoryId, tasks]) => <PriorityTaskGroup key={categoryId} categoryId={categoryId === 'unassigned' ? null : categoryId} title={view === 'category' ? 'To-dos' : (categories.find((category) => category.id === categoryId)?.name ?? 'Unassigned')} tasks={tasks} renderRow={renderRow} onReorder={reorderTask} />)
      const completedTasks = notes.filter((note) => note.kind === 'task' && note.completedAt != null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
      const otherItems = notes.filter((note) => note.kind !== 'task')
      const noTagItems = view === 'category' ? otherItems.filter((note) => !note.subcategoryId) : []
      const taggedItems = view === 'category' ? otherItems.filter((note) => !!note.subcategoryId) : otherItems
      const groupedItems = new Map<string, NoteDetail[]>()
      for (const note of taggedItems) { const label = noteDateLabel(note.createdAt); groupedItems.set(label, [...(groupedItems.get(label) ?? []), note]) }
      return <>{priorityGroups}{completedTasks.length > 0 && <section className="completed-task-group"><div className="date-label">Completed to-dos</div>{completedTasks.map((note) => renderRow(note))}</section>}{view === 'category' && noTagItems.length > 0 && <section className="category-item-section"><div className="date-label">No subcategory</div>{noTagItems.map((note) => renderRow(note))}</section>}{view === 'category' && taggedItems.length > 0 && <div className="date-label category-tagged-heading">Items in subcategories</div>}{[...groupedItems.entries()].map(([label, items]) => <section className="date-group" key={label}><div className="date-label">{label}</div>{items.map((note) => renderRow(note))}</section>)}{cursor && <button className="load-more" onClick={() => void loadNotes(cursor, true)} disabled={loading}>Load more <ChevronDown size={14} /></button>}</>
    }

    const groups = new Map<string, NoteDetail[]>()
    for (const note of notes) { const label = noteDateLabel(view === 'trash' ? note.deletedAt ?? note.createdAt : note.createdAt); groups.set(label, [...(groups.get(label) ?? []), note]) }
    const rows = [...groups.entries()].map(([label, items]) => <section className="date-group" key={label}>
      <div className="date-label">{label}</div>
      {items.map((note) => renderRow(note))}
    </section>)
    return <>{rows}{cursor && <button className="load-more" onClick={() => void loadNotes(cursor, true)} disabled={loading}>Load more <ChevronDown size={14} /></button>}</>
  }

  useEffect(()=> {
    if(!taxonomyLoaded)return
    if(view==='category'&&selectedCategoryId&&!categories.some(item=>item.id===selectedCategoryId)){setView('all');setSelectedCategoryId(null);setSelectedSubcategoryId(null);setNoSubcategory(false)}
    if(view==='tag'&&selectedTagId&&!tagRecords.some(item=>item.id===selectedTagId)){setView('all');setSelectedTagId(null)}
    if(selectedSubcategoryId&&!subcategories.some(item=>item.id===selectedSubcategoryId))setSelectedSubcategoryId(null)
  },[taxonomyLoaded,categories,subcategories,tagRecords,view,selectedCategoryId,selectedSubcategoryId,selectedTagId])

  const requestEditorLeave = (action: () => void) => { if (!editItem) action() }
  requestLeaveRef.current = requestEditorLeave
  const onShortcutKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recordingShortcut) return
    event.preventDefault(); event.stopPropagation()
    if (event.key === 'Escape') { setRecordingShortcut(false); return }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
    const parts: string[] = []
    if (event.ctrlKey) parts.push('Control')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    const key = event.key.length === 1 ? event.key.toUpperCase() : ({ ' ': 'Space', 'ArrowUp': 'Up', 'ArrowDown': 'Down', 'ArrowLeft': 'Left', 'ArrowRight': 'Right' } as Record<string, string>)[event.key] ?? event.key
    const accelerator = [...parts, key].join('+')
    if (parts.length) { setRecordingShortcut(false); void saveSettings({ shortcut: accelerator }) }
  }

  return <div className="notes-window">
    <aside className="sidebar">
      <button className="brand" onClick={() => nav('all')}><span className="brand-glyph">c</span><span>captured</span></button>
      <button type="button" className="sidebar-capture" aria-label="Capture" title="Capture a thought" onClick={() => window.captured.windows.openCapture()}><Plus size={16} /><span>Capture</span><kbd>{settings?.shortcut.replace('Control', 'Ctrl') ?? 'Ctrl+N'}</kbd></button>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button className={['tasks','ready','later'].includes(view) ? 'active' : ''} onClick={() => nav('tasks')}><FolderKanban size={16} /><span>Tasks</span></button>
        <button className={['backlog','inbox'].includes(view) ? 'active' : ''} onClick={() => nav('backlog')}><Archive size={16} /><span>Backlog</span><span className="side-count" title="New captures">{inboxCount || ''}</span></button>
        <button className={view === 'calenban' ? 'active' : ''} onClick={() => nav('calenban')}><CalendarDays size={16} /><span>Calendar</span></button>
        <button className={view === 'all' ? 'active' : ''} onClick={() => nav('all')}><FileText size={16} /><span>All items</span><span className="side-count">{view === 'all' ? total : ''}</span></button>
      </nav>
      <TaxonomyNav categories={categories} subcategories={subcategories} tags={tagRecords} activeCategory={view==='category'?selectedCategoryId:null} activeSubcategory={view==='category'?selectedSubcategoryId:null} activeTag={view==='tag'?selectedTagId:null} onChanged={()=>{void loadTags();void loadNotes()}} onError={setError}
        onCategory={category=>openCategory(category)}
        onSubcategory={subcategory=>openCategory(categories.find(category=>category.id===subcategory.categoryId)!,subcategory.id)}
        onNoSubcategory={category=>openCategory(category,null,true)}
        onTag={openTag}/>
      <nav className="side-nav"><button className={view==='review'?'active':''} onClick={()=>nav('review')}><Info size={15}/><span>Review subcategories</span><span className="side-count">{reviewCount||''}</span></button></nav>
      <nav className="side-nav" aria-label="Trash"><button className={view === 'trash' ? 'active' : ''} onClick={() => nav('trash')}><Trash2 size={16} /><span>Trash</span></button></nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <button className={view === 'settings' ? 'active' : ''} onClick={() => nav('settings')}><SettingsIcon size={16} /><span>Settings</span></button>
      </div>
    </aside>
    <main className="main-area">
      {upgradeNotice&&view!=='review'&&<div className="taxonomy-upgrade-notice">Your existing tags were preserved. {reviewCount} items need a subcategory review. <button onClick={()=>nav('review')}>Review assignments</button><button aria-label="Dismiss taxonomy upgrade notice" onClick={()=>{void window.captured.notes.acknowledgeMigration().then(result=>{if(result.ok)setUpgradeNotice(false)})}}>Dismiss</button></div>}
      {view === 'settings' ? <SettingsPanel settings={settings} displays={displays} saveSettings={saveSettings} onBackup={async () => { try { resultValue(await window.captured.data.backup()); setToast('Backup created') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Backup failed.') } }} onRestore={async () => { try { resultValue(await window.captured.data.restore()); setToast('Backup restored') } catch (reason) { setError(reason instanceof Error ? reason.message : 'Restore failed.') } }} firstRun={firstRun} onFinish={finishFirstRun} onTrayOnly={continueTrayOnly} recordingShortcut={recordingShortcut} setRecordingShortcut={setRecordingShortcut} onShortcutKey={onShortcutKey} />
      : view === 'review' ? <MigrationReviewPanel categories={categories} subcategories={subcategories} onChanged={()=>{void loadTags();void loadNotes()}} onOpen={(id,deleted)=>requestEditorLeave(()=>{setView(deleted?'trash':'all');clearFilters();void openNote(id)})}/>
      : ['tasks','inbox','backlog','ready','later'].includes(view) ? <Suspense fallback={<div className="backlog-page" role="status">Loading tasks…</div>}><TasksView key={['backlog','inbox'].includes(view) ? 'backlog' : 'tasks'} backlog={['backlog','inbox'].includes(view)} categories={categories} subcategories={subcategories} tags={tagRecords} taxonomyReady={taxonomyLoaded} /></Suspense>
      : view === 'calenban' ? <Suspense fallback={<div className="calenban-page" role="status">Loading calendar…</div>}><CalendarView settings={settings} /></Suspense>
      : <>
        <header className="main-header">
          <div className="title-stack"><div className="eyebrow">{view === 'trash' ? 'ARCHIVE' : view === 'tag' || view === 'category' ? 'CATEGORY / TAG' : 'YOUR NOTES & TO-DOS'}</div><h1>{view === 'trash' ? 'Trash' : view === 'tag' ? selectedTag?.name ?? 'Tag' : view === 'category' ? `${selectedCategory?.name??'Category'}${selectedSubcategoryId?' / '+(subcategories.find(item=>item.id===selectedSubcategoryId)?.name??'Subcategory'):noSubcategory?' / No subcategory':''}` : 'All items'} <span className="title-count">{total.toLocaleString()}</span></h1></div>
          <div className="header-actions">
            {updateStatus.status === 'available' && <button className="update-pill" onClick={() => void window.captured.updates.check()}>Downloading update{updateStatus.version ? ` · v${updateStatus.version}` : ''}</button>}
            {updateStatus.status === 'downloaded' && <button className="update-pill is-ready" onClick={() => void window.captured.updates.install()}>Restart to update{updateStatus.version ? ` · v${updateStatus.version}` : ''}</button>}
            {view === 'trash' && total > 0 && <button className="button secondary" onClick={() => void emptyTrash()}><Trash2 size={14} /> Empty trash</button>}
            <button className="button secondary capture-button" onClick={() => window.captured.windows.openCapture(view==='category'?{categoryId:selectedCategoryId,subcategoryId:selectedSubcategoryId}:view==='tag'&&selectedTag?{categoryId:null,tags:[selectedTag.name]}:undefined)}><Plus size={15} /> Capture</button>
            <div className="menu-wrap"><button className="icon-button bordered" aria-label="More actions" title="More actions" onClick={(event) => { const menu = event.currentTarget.nextElementSibling; menu?.classList.toggle('is-open') }}><MoreHorizontal size={17} /></button><div className="pop-menu"><button onClick={() => void exportData('all')}><Download size={14} /> Export notes</button><button onClick={() => void exportData('full')}><Archive size={14} /> Export full archive</button><button onClick={() => void window.captured.settings.openFolder()}><FolderOpen size={14} /> Open data folder</button></div></div>
          </div>
        </header>
        {view === 'tag' && selectedTag && <div className="tag-page-settings"><span className="tag-page-icon" style={{ color: selectedTag.color }}><Hash size={18} /></span><div className="tag-page-description"><b>{selectedTag.name}</b><small>{total} {total === 1 ? 'item' : 'items'} with this tag</small></div><div className="tag-color-field"><span><Palette size={14} /> Color</span><ColorPalette value={selectedTag.color} onChange={color => void changeTag({ categoryId: selectedTag.categoryId, color })} /></div></div>}
        {view === 'category' && selectedCategory && <div className="tag-page-settings category-page-settings"><span className="tag-page-icon"><FolderKanban size={18} /></span><div className="tag-page-description"><b>{selectedCategory.name}</b><small>{total} {total === 1 ? 'item' : 'items'} assigned directly to this category</small></div></div>}
        <div className="toolbar">
          <label className="search-box"><Search size={15} /><input ref={searchRef} value={query} onChange={(event) => requestEditorLeave(() => setQuery(event.target.value))} placeholder="Search items…" aria-label="Search items" /><kbd>Ctrl F</kbd>{query && <button title="Clear search" onClick={() => requestEditorLeave(() => setQuery(''))}><X size={13} /></button>}</label>
          {dateRange === 'custom' && <div className="date-inputs"><input type="date" aria-label="From date" value={customFrom} onChange={(event) => requestEditorLeave(() => setCustomFrom(event.target.value))} /><span>to</span><input type="date" aria-label="To date" value={customTo} onChange={(event) => requestEditorLeave(() => setCustomTo(event.target.value))} /></div>}
          {view !== 'trash' && <button type="button" className={`button secondary small completed-toggle ${showCompleted ? 'is-active' : ''}`} aria-pressed={showCompleted} onClick={() => requestEditorLeave(() => setShowCompleted((current) => !current))}><CheckCircle2 size={14} /> Show completed</button>}
          <button className="button secondary small filter-toggle" aria-expanded={filtersOpen} aria-controls="note-filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}<ChevronDown size={13} /></button>
          <button type="button" className="button secondary small" aria-pressed={selectionMode} onClick={() => { setSelectionMode(!selectionMode); setSelected([]) }}>{selectionMode ? 'Done selecting' : 'Select items'}</button>
          <span className="result-count">{total.toLocaleString()} {total === 1 ? 'item' : 'items'}</span>
        </div>
        {filtersOpen && <div id="note-filters" className="filter-panel" aria-label="Filters">
          <div className="filter-row"><span className="filter-heading">SUBCATEGORY</span><AppSelect aria-label="Subcategory filter" value={subcategoryFilter} onChange={event=>requestEditorLeave(()=>setSubcategoryFilter(event.target.value))}><option value="">All subcategories</option><option value="none">No subcategory</option>{subcategories.filter(item=>view!=='category'||item.categoryId===selectedCategoryId).map(item=><option key={item.id} value={item.id}>{categories.find(category=>category.id===item.categoryId)?.name} / {item.name}</option>)}</AppSelect></div>
          <div className="filter-row"><span className="filter-heading">TYPE</span><div className="filter-pills" aria-label="Type filters">{itemKinds.map(({ value, label }) => <button key={value} className={`filter-pill ${kindFilters.includes(value) ? 'is-selected' : ''}`} aria-pressed={kindFilters.includes(value)} onClick={() => toggleKind(value)}>{label}</button>)}</div></div>
          {view !== 'tag' && <div className="filter-row"><span className="filter-heading">TAGS</span><TagFilter category="items" tags={tagRecords} value={{ included: tagFilters, excluded: excludedTags }} onChange={next => requestEditorLeave(() => { setTagFilters(next.included); setExcludedTags(next.excluded) })} /></div>}
          <div className="filter-row"><span className="filter-heading">DATE</span><div className="filter-pills" aria-label="Date filters">{dateOptions.map(({ value, label }) => <button key={value} className={`filter-pill ${dateRange === value ? 'is-selected' : ''}`} aria-pressed={dateRange === value} onClick={() => requestEditorLeave(() => setDateRange(value))}>{label}</button>)}</div><button className="filter-clear" onClick={() => requestEditorLeave(clearFilters)} disabled={!subcategoryFilter && !excludedTags.length && !query && !kindFilters.length && !tagFilters.length && dateRange === 'all'}>Clear all</button></div>
        </div>}
        {selected.length > 0 && <div className="selection-toolbar"><span>{selected.length} selected</span><button className="text-action" onClick={() => void copyIds(selected)}><Copy size={14} /> Copy</button><button className="text-action" onClick={() => void exportData('selected', selected)}><Download size={14} /> Export</button>{view === 'trash' ? <><button className="text-action" onClick={async () => { try { resultValue(await window.captured.notes.restore(selected)); setSelected([]) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not restore notes.') } }}><Undo2 size={14} /> Restore</button><button className="text-action danger-action" onClick={async () => { try { resultValue(await window.captured.notes.deletePermanently(selected)); setSelected([]) } catch (reason) { setError(reason instanceof Error ? reason.message : 'Could not delete notes.') } }}><Trash2 size={14} /> Delete permanently</button></> : <button className="text-action danger-action" onClick={() => void trashSelected()}><Trash2 size={14} /> Move to Trash</button>}</div>}
        <div className={`content-grid ${detailId && view !== 'all' ? 'has-detail' : ''}`}>
          <div className={`list-column ${detailId && view !== 'all' && window.innerWidth < 960 ? 'mobile-hidden' : ''}`} ref={noteListRef}>
            {error && <div className="inline-error" role="alert"><Info size={15} /><span>{error}</span><button onClick={() => { setError(''); void loadNotes() }}>Retry</button></div>}
            {loading && !notes.length ? <div className="loading-state"><span className="spinner" /> Loading notes…</div> : renderRows()}
          </div>
          {detailId && view !== 'all' && <section className="detail-panel" aria-label="Note details">
            <div className="detail-top"><button className="back-button" onClick={() => requestEditorLeave(() => { setDetailId(null); setDetail(null) })}><ArrowLeft size={15} /> <span>Back</span></button><div className="detail-actions"><button className="icon-button" title="Copy note" aria-label="Copy note" onClick={() => void copyIds([detailId])}><Copy size={15} /></button>{view === 'trash' ? <><button className="icon-button" title="Restore note" aria-label="Restore note" onClick={() => void restoreOne(detailId)}><Undo2 size={15} /></button><button className="icon-button danger-icon" title="Delete permanently" aria-label="Delete permanently" onClick={() => void deleteOne(detailId)}><Trash2 size={15} /></button></> : <button className="icon-button danger-icon" title="Move to Trash" aria-label="Move to Trash" onClick={() => void trashSelectedFromDetail(detailId, window.captured, setToast, setError, setDetailId, setDetail)}><Trash2 size={15} /></button>}</div></div>
            {!detail ? <div className="detail-loading"><span className="spinner" /></div> : <>
              <div className="detail-meta"><span>{formatDateTime(detail.createdAt)}</span>{detail.updatedAt !== detail.createdAt && <span>Edited {formatDateTime(detail.updatedAt)}</span>}{detail.completedAt != null && <span className="detail-completed-at">Done {formatDateTime(detail.completedAt)}</span>}{detail.kind === 'task' && view !== 'trash' && <button type="button" className="detail-completion-action" onClick={() => void toggleDetailCompletion()}><CheckCircle2 size={13} /> {detail.completedAt != null ? 'Reopen to Backlog' : 'Mark as done'}</button>}</div>
              <div className="detail-note-text">{detail.body || (detail.images.length ? null : <span className="muted">Empty item</span>)}</div>
              <ItemImages key={detail.id} images={detail.images} expanded={!detail.body.trim()} />

              <><div className="detail-tags"><span className="tags-field-label">Category</span><span className="detail-tag-list">{(categories.find((category) => category.id === detail.categoryId)?.name ?? 'Unassigned')+(detail.subcategoryId?' / '+(subcategories.find(item=>item.id===detail.subcategoryId)?.name??''): '')}</span></div><div className="detail-tags"><span className="tags-field-label">Tags</span><span className="detail-tag-list">{detail.tags.length ? detail.tags.map((tag) => <span className="note-tag-chip" key={tag} style={{ color: tagRecords.find((record) => record.name.toLocaleLowerCase() === tag.toLocaleLowerCase())?.color }}>{tag}</span>) : 'No tags'}</span></div>{view !== 'trash' && <button className="button secondary edit-button" onClick={() => setEditItem(detail)}>Edit item <ArrowRight size={14} /></button>}</>
            </>}
          </section>}
        </div>
      </>}
    </main>
    {toast && <div className="toast" role="status"><Check size={15} />{toast}</div>}
    {browserCaptureOpen && <div className="modal-backdrop"><form className="dialog-card browser-capture-dialog" role="dialog" aria-modal="true" aria-labelledby="browser-capture-title" onSubmit={(event) => { event.preventDefault(); void submitBrowserCapture() }}><div className="event-dialog-kicker">QUICK CAPTURE</div><h2 id="browser-capture-title">Capture a thought</h2><textarea autoFocus aria-label="Capture text" placeholder="What’s on your mind?" value={browserCaptureText} onChange={(event) => setBrowserCaptureText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setBrowserCaptureOpen(false) }} /><label>Save as<AppSelect aria-label="Capture type" value={browserCaptureKind} onChange={event=>setBrowserCaptureKind(event.target.value as typeof browserCaptureKind)}><option value="inbox">Capture · sort later</option><option value="task">Task</option><option value="note">Note</option></AppSelect></label><label className="browser-capture-category">Category <AppSelect aria-label="Capture category" value={browserCaptureCategoryId ?? ''} onChange={(event) => {setBrowserCaptureCategoryId(event.target.value || null);setBrowserCaptureSubcategoryId(null)}}><option value="">Unassigned</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</AppSelect></label><label>Subcategory<AppSelect aria-label="Capture subcategory" disabled={!browserCaptureCategoryId} value={browserCaptureSubcategoryId??''} onChange={event=>setBrowserCaptureSubcategoryId(event.target.value||null)}><option value="">No subcategory</option>{subcategories.filter(sub=>sub.categoryId===browserCaptureCategoryId).map(sub=><option key={sub.id} value={sub.id}>{sub.name}</option>)}</AppSelect></label><TagEditor tags={browserCaptureTags} draft={browserCaptureTagDraft} onTagsChange={setBrowserCaptureTags} onDraftChange={setBrowserCaptureTagDraft} suggestions={availableTags}/>
<div className="dialog-actions"><button type="button" className="button secondary" onClick={() => setBrowserCaptureOpen(false)}>Cancel</button><button type="submit" className="button primary" disabled={!browserCaptureText.trim()}>{browserCaptureKind === 'inbox' ? 'Save capture' : browserCaptureKind === 'task' ? 'Save task' : 'Save note'}</button></div></form></div>}
    {editItem && <ItemDetailDialog key={editItem.id} task={editItem} suggestions={availableTags} onClose={() => setEditItem(null)} onChanged={() => { setEditItem(null); setToast('Changes saved'); void loadNotes(); if (detailId) void openNote(detailId) }} />}
  </div>
}

async function trashSelectedFromDetail(id: string, api: Window['captured'], setToast: (value: string) => void, setError: (value: string) => void, setDetailId: (value: string | null) => void, setDetail: (value: NoteDetail | null) => void) {
  try { const result=await api.notes.trash([id]); if(result.ok){setDetailId(null);setDetail(null);setToast('Note moved to Trash')}else setError(result.message) }catch(reason){setError(reason instanceof Error?reason.message:'Could not move item to Trash.')}
}

type SortableRowProps = {
  ref: (node: HTMLElement | null) => void
  style: CSSProperties
  attributes: ReturnType<typeof useSortable>['attributes']
  listeners: ReturnType<typeof useSortable>['listeners']
}

function PriorityTaskGroup({ categoryId, title, tasks, renderRow, onReorder }: { categoryId: string | null; title: string; tasks: NoteDetail[]; renderRow: (note: NoteDetail, sortable?: SortableRowProps) => ReactNode; onReorder: (id: string, categoryId: string | null, beforeId: string | null) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  function handleDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id) return
    const oldIndex = tasks.findIndex((task) => task.id === event.active.id)
    const newIndex = tasks.findIndex((task) => task.id === event.over!.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(tasks, oldIndex, newIndex)
    onReorder(String(event.active.id), categoryId, reordered[newIndex + 1]?.id ?? null)
  }
  return <section className="priority-task-group"><div className="date-label">{title}</div><DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}><SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>{tasks.map((task) => <SortablePriorityNote key={task.id} note={task} renderRow={renderRow} />)}</SortableContext></DndContext></section>
}

function SortablePriorityNote({ note, renderRow }: { note: NoteDetail; renderRow: (note: NoteDetail, sortable?: SortableRowProps) => ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: note.id })
  return <>{renderRow(note, { ref: setNodeRef, style: { transform: CSS.Transform.toString(transform), transition }, attributes, listeners })}</>
}

function SettingsPanel({ settings, displays, saveSettings, onBackup, onRestore, firstRun, onFinish, onTrayOnly, recordingShortcut, setRecordingShortcut, onShortcutKey }: {
  settings: Settings | null; displays: { id: number; label: string; primary: boolean }[]; saveSettings: (update: SettingsUpdate) => Promise<boolean>; onBackup: () => void; onRestore: () => void; firstRun: boolean; onFinish: (shortcut: string, login: boolean) => void; onTrayOnly: (login: boolean) => void; recordingShortcut: boolean; setRecordingShortcut: (value: boolean) => void; onShortcutKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  const [activeSection, setActiveSection] = useState('general')
  const [testApp, setTestApp] = useState(settings?.protectionTestApp ?? '')
  const [onboardingShortcut, setOnboardingShortcut] = useState('Control+N')
  const [onboardingLogin, setOnboardingLogin] = useState(false)
  useEffect(() => { if (settings) setTestApp(settings.protectionTestApp) }, [settings])
  const shortcutDisplay = (settings?.shortcut ?? 'Control+N').replace('Control', 'Ctrl').replaceAll('+', ' + ')
  const sectionItems = [{ id: 'general', label: 'General', icon: SettingsIcon }, { id: 'calendar', label: 'Calendar', icon: CalendarDays }, { id: 'appearance', label: 'Appearance', icon: Sun }, { id: 'sharing', label: 'Screen sharing', icon: Monitor }, { id: 'data', label: 'Data', icon: Archive }, { id: 'about', label: 'About', icon: Info }]
  return <div className="settings-layout">
    <aside className="settings-nav"><div className="settings-title"><div className="eyebrow">PREFERENCES</div><h1>Settings</h1></div>{sectionItems.map(({ id, label, icon: Icon }) => <button className={activeSection === id ? 'active' : ''} aria-label={label} title={label} aria-current={activeSection === id ? 'page' : undefined} key={id} onClick={() => setActiveSection(id)}><Icon size={15} />{label}</button>)}</aside>
    <section className="settings-content">
      {activeSection === 'general' && <><div className="settings-heading"><h2>General</h2><p>Choose how captured behaves on this device.</p></div>
        <div className="setting-row"><div><b>Capture shortcut</b><span>Opens the capture bar from any app. While captured runs, Ctrl+N replaces the usual New shortcut.</span></div><div className="shortcut-control"><button className={`button secondary ${recordingShortcut ? 'recording' : ''}`} onClick={() => setRecordingShortcut(true)} onKeyDown={onShortcutKey}>{recordingShortcut ? 'Press a shortcut…' : shortcutDisplay}</button><span className={`status-dot ${settings?.shortcutRegistered ? 'good' : 'bad'}`} />{!settings?.shortcutRegistered && <small>Unavailable</small>}</div></div>
        <div className="setting-row"><div><b>Global shortcut</b><span>Turn off keyboard capture and use the tray menu instead.</span></div><Toggle checked={settings?.shortcutEnabled ?? true} onChange={(value) => void saveSettings({ shortcutEnabled: value })} label="Global capture shortcut" /></div>
        <div className="setting-row"><div><b>Launch at login</b><span>Start captured quietly when you sign in to Windows.</span></div><Toggle checked={settings?.launchAtLogin ?? false} onChange={(value) => void saveSettings({ launchAtLogin: value })} label="Launch at login" /></div>
        <div className="setting-row"><div><b>Close to tray</b><span>Closing the notes window keeps capture ready in the system tray. Use Quit in the tray menu to exit.</span></div><Toggle checked={settings?.closeToTray ?? true} onChange={(value) => void saveSettings({ closeToTray: value })} label="Close to tray" /></div>
        <div className="setting-row"><div><b>Capture display</b><span>Choose where the capture bar appears. Missing displays fall back to the pointer's display.</span></div><AppSelect aria-label="Capture display" className="filter-select setting-select" value={settings?.monitor ?? 'active'} onChange={(event) => void saveSettings({ monitor: event.target.value })}><option value="active">Active window / pointer</option><option value="pointer">Mouse pointer</option><option value="primary">Primary display</option>{displays.map((display) => <option key={display.id} value={`display:${display.id}`}>{display.label}</option>)}</AppSelect></div>
        <div className="setting-row"><div><b>Shortcut registration</b><span>{settings?.shortcutRegistered ? 'Ready. The global shortcut is registered.' : 'The selected shortcut could not be registered. Tray capture remains available.'}</span></div><span className={`status-label ${settings?.shortcutRegistered ? 'success' : 'warning'}`}>{settings?.shortcutRegistered ? 'Ready' : 'Tray only'}</span></div>
      </>}
      {activeSection === 'calendar' && <CalendarSettings settings={settings} save={saveSettings} />}
      {activeSection === 'appearance' && <><div className="settings-heading"><h2>Appearance</h2><p>Keep the interface comfortable in any room.</p></div><div className="theme-choices">{(['system', 'light', 'dark'] as const).map((theme) => <button className={`theme-card ${settings?.theme === theme ? 'selected' : ''}`} key={theme} onClick={() => void saveSettings({ theme })}><div className={`theme-swatch ${theme}`}><span /><i /><i /><i /></div><div><b>{theme === 'system' ? 'System' : theme[0]!.toUpperCase() + theme.slice(1)}</b><span>{theme === 'system' ? 'Follow Windows' : `Use ${theme} appearance`}</span></div>{settings?.theme === theme && <Check size={15} />}</button>)}</div><div className="setting-note"><CircleHelp size={15} /> SN Pro and Geist Mono are bundled for offline use.</div></>}
      {activeSection === 'sharing' && <><div className="settings-heading"><h2>Screen sharing</h2><p>Ask Windows to exclude captured windows from supported captures.</p></div><div className="protection-card"><div className="protection-icon"><Shield size={17} /></div><div><b>Request capture exclusion</b><span>Best effort. Whether notes are excluded depends on Windows and the meeting or recording app.</span></div><Toggle checked={settings?.captureProtection ?? true} onChange={async (value) => { if (!value && !window.confirm('Notes may appear in screen shares and recordings when exclusion is off. Turn it off?')) return; await saveSettings({ captureProtection: value }) }} label="Capture exclusion" /></div><div className="privacy-copy"><b>Test from another participant's view</b><p>Start a test meeting, share your screen, open captured, and ask someone on another device whether the capture bar and notes window appear. Repeat after changing the meeting app or Windows version.</p><p>File pickers are native Windows windows and may still be visible. Open export and restore dialogs outside a presentation.</p></div><div className="setting-row"><div><b>Last manual test</b><span>{settings?.protectionTestDate ? settings.protectionTestOS ? `Recorded ${settings.protectionTestDate} · Windows ${settings.protectionTestOS}. Retest after changing the meeting app or Windows build.` : 'The Windows build changed since this test. Retest this setup.' : 'Record what you tested. This is a reminder, not technical verification.'}</span></div><div className="test-fields"><input className="text-field" value={testApp} maxLength={80} placeholder="App / version / mode" onChange={(event) => setTestApp(event.target.value)} /><button className="button secondary small" onClick={() => { const date = todayISO(); void saveSettings({ protectionTestApp: testApp, protectionTestDate: date }) }}>Record today’s test</button></div></div><div className="setting-note warning-note"><Info size={15} /> Exclusion does not protect against remote control, malicious capture tools, or cameras. File pickers may be visible; open them outside a presentation.</div></>}
      {activeSection === 'data' && <><div className="settings-heading"><h2>Data</h2><p>Your notes are stored locally and are not encrypted by captured.</p></div><div className="data-location"><div className="data-folder-icon"><FolderOpen size={18} /></div><div><b>Local storage</b><span>SQLite database · app data folder</span></div><button className="button secondary small" onClick={() => void window.captured.settings.openFolder()}>Open folder</button></div><div className="data-actions"><div><b>Export notes</b><span>Save plain text or Markdown to a folder you choose.</span></div><div><button className="button secondary small" onClick={() => void window.captured.data.export({ scope: 'all', format: 'txt' })}>Export TXT</button><button className="button secondary small" onClick={() => void window.captured.data.export({ scope: 'all', format: 'md' })}>Export Markdown</button></div></div><div className="data-actions"><div><b>SQLite backup</b><span>{settings?.backupWarning ? 'The last backup failed. Notes can still save; try creating a backup again.' : settings?.lastBackupAt ? `Last backup ${formatDateTime(settings.lastBackupAt)}.` : 'No backup has been created yet.'} A full recovery snapshot of notes, tags, tasks, scheduled meetings, and Trash.</span></div><div><button className="button secondary small" onClick={() => void onBackup()}>Create backup</button><button className="button secondary small" onClick={() => void onRestore()}>Restore backup</button></div></div><div className="setting-note"><Info size={15} /> Restoring replaces current data. captured creates a safety backup first. Independent backups can retain notes removed from Trash. Do not sync the live SQLite database through a shared folder.</div></>}
      {activeSection === 'about' && <><div className="settings-heading"><h2>About captured</h2><p>A quiet, local desktop utility for capturing a thought during a meeting.</p></div><div className="about-card"><div className="about-logo">n</div><div><b>captured</b><span>Version 0.1.0 · Windows 11 x64</span></div></div><div className="setting-row"><div><b>Local diagnostics</b><span>Exports app version, Windows build, shortcut status, and database availability. No note or meeting content.</span></div><button className="button secondary small" onClick={async () => { const result = await window.captured.data.diagnostics(); if (!result.ok) window.alert(result.message) }}>Export diagnostics</button></div><div className="license-box"><b>Third-party licenses</b><p>Electron · Chromium · React · ReUI · dnd-kit · SN Pro · Geist Mono · Lucide icons · SQLite · other bundled dependencies.</p><p>See the licenses folder in the installed app for full notices.</p></div></>}
    </section>
    {firstRun && <div className="modal-backdrop setup-backdrop"><div className="setup-dialog"><div className="setup-brand"><span className="brand-glyph">c</span><span>captured</span><small>FIRST RUN</small></div><h2>Catch a thought.<br />Keep your place.</h2><p>Press a shortcut, type a note, and return to what you were doing. Notes stay on this device.</p><div className="setup-shortcuts"><button className={onboardingShortcut === 'Control+N' ? 'selected' : ''} onClick={() => setOnboardingShortcut('Control+N')}><kbd>Ctrl</kbd><b>+</b><kbd>N</kbd><span>Recommended</span></button><button className={onboardingShortcut === 'Control+Alt+N' ? 'selected' : ''} onClick={() => setOnboardingShortcut('Control+Alt+N')}><kbd>Ctrl</kbd><b>+</b><kbd>Alt</kbd><b>+</b><kbd>N</kbd></button></div><div className="setup-notice"><Shield size={16} /><span>captured asks Windows to hide its windows from supported captures. Meeting apps may still show them; test from another participant's device.</span></div><label className="setup-login"><input type="checkbox" checked={onboardingLogin} onChange={(event) => setOnboardingLogin(event.target.checked)} /> Launch quietly when I sign in</label><div className="dialog-actions"><button className="button secondary" onClick={() => onTrayOnly(onboardingLogin)}>Use tray only</button><button className="button primary" onClick={() => onFinish(onboardingShortcut, onboardingLogin)}>Save and continue <ArrowRight size={15} /></button></div><small className="setup-foot">Ctrl+N replaces the usual New shortcut while captured is running.</small></div></div>}
  </div>
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <button type="button" className={`toggle ${checked ? 'checked' : ''}`} role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}><span /></button>
}
