import { ImageIndicator } from '../components/ItemImages'
import { TagFilter, type TagFilterValue } from '../components/TagFilter'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, type DragEndEvent, useSensor, useSensors } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ChevronDown, Clock3, FolderKanban, GripVertical, Plus, RotateCcw, Search, X } from 'lucide-react'
import type { Category, PlannerBacklogPage, PlannerBacklogSummary, PlannerTask, Subcategory, TagRecord } from '../../shared/contracts'
import { TaskDetailDialog } from '../calenban/TaskDetailDialog'
import { BacklogTaskCreateDialog } from './BacklogTaskCreateDialog'
import { resultValue as valueOf } from '../apiResult'

const pageSize = 50
const emptySummary = { total: 0, subcategoryCounts: {} as Record<string, number> }
type Group = { id: string; name: string; categoryId: string | null; tags: TagRecord[]; allTags: TagRecord[] }

export function BacklogView({ laterOnly = false, categories, subcategories, tags, taxonomyReady }: { laterOnly?: boolean; categories: Category[]; subcategories: Subcategory[]; tags: TagRecord[]; taxonomyReady: boolean }) {
  const [summary, setSummary] = useState<PlannerBacklogSummary | null>(null)
  const [query, setQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [detailTask, setDetailTask] = useState<PlannerTask | null>(null)
  const [createCategoryId, setCreateCategoryId] = useState<string | null | undefined>(undefined)
  const [highlightTaskId, setHighlightTaskId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const summaryRequest = useRef(0)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query.trim()), 150)
    return () => clearTimeout(timer)
  }, [query])

  const refreshSummary = useCallback(async () => {
    const request = ++summaryRequest.current
    try {
      const data = valueOf(await window.captured.planner.backlogSummary(laterOnly))
      if (request !== summaryRequest.current) return
      setSummary(data)
      setError('')
    } catch (reason) {
      if (request === summaryRequest.current) setError(reason instanceof Error ? reason.message : 'Backlog counts could not be loaded.')
    }
  }, [laterOnly])
  useEffect(() => {
    void refreshSummary()
    const unsubscribe = window.captured.planner.onChanged(() => { void refreshSummary() })
    return () => { summaryRequest.current++; unsubscribe() }
  }, [refreshSummary])

  const groups = useMemo<Group[]>(() => [
    ...categories.map((category) => ({ id: category.id, name: category.name, categoryId: category.id, tags: subcategories.filter((item)=>item.categoryId===category.id), allTags: tags })),
    { id: 'unassigned', name: 'Unassigned', categoryId: null, tags: [], allTags: tags },
  ], [categories, subcategories, tags])
  const total = groups.reduce((sum, group) => sum + (counts[group.id] ?? 0), 0)
  const setGroupCount = useCallback((id: string, count: number) => setCounts((current) => current[id] === count ? current : { ...current, [id]: count }), [])

  return <section className="backlog-page">
    <header className="backlog-header"><div><span className="eyebrow">{laterOnly ? 'OUT OF SIGHT, STILL SAVED' : 'TO-DOS BY CATEGORY'}</span><h1>{laterOnly ? 'Later' : 'Backlog'} <span className="title-count">{total}</span></h1><p>{laterOnly ? 'Tasks you have set aside. Return one to the top of its category when it is ready.' : 'Drag to set priority within each category. The order carries over to category and tag views.'}</p></div></header>
    <div className="backlog-toolbar"><label className="search-box"><Search size={15} /><input aria-label={`Search ${laterOnly ? 'later' : 'backlog'}`} placeholder="Search tasks or tags…" value={query} onChange={(event) => setQuery(event.target.value)} />{query && <button aria-label="Clear backlog search" onClick={() => setQuery('')}><X size={13} /></button>}</label>{!laterOnly && <button type="button" className="button secondary small" disabled={!taxonomyReady} onClick={() => { setQuery(''); setCreateCategoryId(null) }}><Plus size={14} /> Add a to-do</button>}<span>{total} {total === 1 ? 'to-do' : 'to-dos'}</span></div>
    {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => void refreshSummary()}>Retry</button></div>}
    <div className="backlog-groups">
      {!taxonomyReady || !summary ? <div className="loading-state"><span className="spinner" /> Loading backlog…</div> : groups.map((group) => <BacklogCategoryGroup key={group.id} summary={summary[group.id] ?? emptySummary} group={group} categories={categories} query={debouncedQuery} onCount={setGroupCount} onOpenTask={setDetailTask} onError={setError} laterOnly={laterOnly} onAddTask={(categoryId) => { setQuery(''); setCreateCategoryId(categoryId) }} highlightTaskId={highlightTaskId} onHighlightHandled={() => setHighlightTaskId(null)} />)}
    </div>
    {createCategoryId !== undefined && <BacklogTaskCreateDialog categories={categories} tags={tags} initialCategoryId={createCategoryId} onClose={() => setCreateCategoryId(undefined)} onError={setError} onCreated={(task) => { setCreateCategoryId(undefined); setQuery(''); setHighlightTaskId(task.id) }} />}
    {detailTask && <TaskDetailDialog task={detailTask} suggestions={tags.map((tag) => tag.name)} onClose={() => setDetailTask(null)} onChanged={() => setDetailTask(null)} />}
  </section>
}

function BacklogCategoryGroup({ summary, group, categories, query, onCount, onOpenTask, onError, laterOnly, onAddTask, highlightTaskId, onHighlightHandled }: { summary: PlannerBacklogSummary[string]; group: Group; categories: Category[]; query: string; onCount: (id: string, count: number) => void; onOpenTask: (task: PlannerTask) => void; onError: (message: string) => void; laterOnly: boolean; onAddTask: (categoryId: string | null) => void; highlightTaskId: string | null; onHighlightHandled: () => void }) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [includeUntagged, setIncludeUntagged] = useState(true)
  const [tagFilter,setTagFilter]=useState<TagFilterValue>({ included: [], excluded: [] })
  const subcategoryCounts = summary.subcategoryCounts
  const [collapsed, setCollapsed] = useState(false)
  const [tasks, setTasks] = useState<PlannerTask[]>([])
  const [cursor, setCursor] = useState<PlannerBacklogPage['nextCursor']>(null)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState('')
  const requestId = useRef(0)
  const tagOptions=group.tags
  const selectedTags=tagOptions.filter(item=>selected[item.id]!==false).map(item=>item.id)
  const everyTagSelected=tagOptions.every(item=>selected[item.id]!==false)&&includeUntagged
  const selectionFilter=useMemo(()=>({...(!everyTagSelected?{subcategoryIds:selectedTags,includeNoSubcategory:includeUntagged}:{}),...(tagFilter.included.length?{tagNames:tagFilter.included}:{}),...(tagFilter.excluded.length?{excludedTags:tagFilter.excluded}:{})}),[everyTagSelected,includeUntagged,selectedTags.join('|'),tagFilter])

  const refresh = useCallback(async () => {
    const request = ++requestId.current
    setLoading(true)
    setLoadingMore(false)
    try {
      const page = valueOf(await window.captured.planner.backlog({ categoryId: group.categoryId, query, ...selectionFilter, limit: pageSize, later: laterOnly, countsOnly: collapsed }))
      if (request !== requestId.current) return
      setTasks(page.items); setCursor(page.nextCursor); setTotal(page.total); onCount(group.id, page.total); setError(''); setLoaded(true)
    } catch (reason) {
      if (request === requestId.current) setError(reason instanceof Error ? reason.message : 'This category could not be loaded.')
    } finally { if (request === requestId.current) setLoading(false) }
  }, [group.categoryId, group.id, onCount, query, selectionFilter, laterOnly, collapsed])

  useEffect(() => {
    if (!summary.total || (collapsed && !query && !tagFilter.included.length && !tagFilter.excluded.length)) {
      const count = Object.entries(summary.subcategoryCounts).reduce((sum, [id, amount]) => sum + ((id ? selected[id] !== false : includeUntagged) ? amount : 0), 0)
      setTotal(count); onCount(group.id, count); setLoaded(true); setLoading(false)
      if (!summary.total) { setTasks([]); setCursor(null) }
    } else {
      void refresh()
    }
    return () => { requestId.current += 1 }
  }, [refresh, summary, collapsed, query, tagFilter, selected, includeUntagged, group.id, onCount])

  async function loadMore() {
    if (!cursor || loading || loadingMore) return
    const request = requestId.current
    setLoadingMore(true)
    try {
      const page = valueOf(await window.captured.planner.backlog({ categoryId: group.categoryId, query, ...selectionFilter, cursor, limit: pageSize, later: laterOnly }))
      if (request !== requestId.current) return
      setTasks((current) => [...current, ...page.items]); setCursor(page.nextCursor); setTotal(page.total); onCount(group.id, page.total); setError('')
    } catch (reason) { if (request === requestId.current) setError(reason instanceof Error ? reason.message : 'Older to-dos could not be loaded.') }
    finally { if (request === requestId.current) setLoadingMore(false) }
  }

  useEffect(() => { if (highlightTaskId && tasks.some((task) => task.id === highlightTaskId)) { document.querySelector<HTMLElement>(`[data-backlog-task=\"${highlightTaskId}\"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); const timer = setTimeout(onHighlightHandled, 1800); return () => clearTimeout(timer) } }, [highlightTaskId, tasks, onHighlightHandled])

  function toggleTag(name: string) { setSelected((current) => ({ ...current, [name]: !(current[name] ?? true) })) }
  function selectAll() { setSelected({}); setIncludeUntagged(true) }
  async function setCategory(id: string, categoryId: string | null) {
    try { valueOf(await window.captured.notes.setCategory({ id, categoryId })) }
    catch (reason) { onError(reason instanceof Error ? reason.message : 'Category could not be changed.') }
  }
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  async function onDragEnd(event: DragEndEvent) {
    if (!event.over || event.active.id === event.over.id || query) return
    const oldIndex = tasks.findIndex((task) => task.id === event.active.id)
    const newIndex = tasks.findIndex((task) => task.id === event.over!.id)
    if (oldIndex < 0 || newIndex < 0) return
    const reordered = arrayMove(tasks, oldIndex, newIndex)
    let beforeId = reordered[newIndex + 1]?.id ?? null
    try {
      if (beforeId === null && cursor) {
        const nextPage = valueOf(await window.captured.planner.backlog({ categoryId: group.categoryId, query, ...selectionFilter, cursor, limit: pageSize, later: laterOnly }))
        beforeId = nextPage.items[0]?.id ?? null
      }
      setTasks(reordered)
      valueOf(await window.captured.planner.reorderBacklog({ id: String(event.active.id), categoryId: group.categoryId, beforeId }))
    }
    catch (reason) { void refresh(); onError(reason instanceof Error ? reason.message : 'Priority could not be saved.') }
  }

  const canShowTasks = selectedTags.length > 0 || includeUntagged
  if (!summary.total) return null

  return <section className="backlog-group" aria-label={`${group.name} backlog`}>
    <div className="backlog-group-heading"><button type="button" className="backlog-group-toggle" aria-expanded={!collapsed} onClick={() => setCollapsed((current) => !current)}><FolderKanban size={16} /><b>{group.name}</b><span>{total}</span><ChevronDown size={15} className={collapsed ? 'is-closed' : ''} /></button>{!laterOnly && <button type="button" className="backlog-category-add" aria-label={`Add task to ${group.name}`} title={`Add task to ${group.name}`} onClick={() => { setSelected({}); setIncludeUntagged(true); setCollapsed(false); onAddTask(group.categoryId) }}><Plus size={15} /></button>}</div>
    {!collapsed && <>
      <div className="backlog-group-filters"><div className="backlog-category-filters" aria-label={`Filter ${group.name} by subcategory`}>
        {tagOptions.filter(tag => (subcategoryCounts[tag.id] ?? 0) > 0).map((tag) => <button key={tag.id} type="button" className={`filter-pill ${selected[tag.id] !== false ? 'is-selected' : ''}`} aria-pressed={selected[tag.id] !== false} onClick={() => toggleTag(tag.id)}><FolderKanban size={11} style={{ color: tag.color }} />{tag.name}</button>)}
        {(subcategoryCounts[''] ?? 0) > 0 && <button type="button" className={`filter-pill ${includeUntagged ? 'is-selected' : ''}`} aria-pressed={includeUntagged} onClick={() => setIncludeUntagged((value) => !value)}>No subcategory</button>}
        {!everyTagSelected && <button type="button" className="filter-clear" onClick={selectAll}>Select all</button>}
      </div>
      <TagFilter category={group.name} tags={group.allTags} value={tagFilter} onChange={setTagFilter} /></div>
      {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
      {loading && !loaded ? <div className="loading-state"><span className="spinner" /> Loading to-dos…</div> : !tasks.length ? <div className="backlog-empty">{canShowTasks ? (query ? 'No to-dos match this search.' : 'No to-dos in this category.') : 'Select a subcategory to show matching to-dos.'}</div> : <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(event) => void onDragEnd(event)}>
        <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
          <div className="backlog-task-list">{tasks.map((task) => <SortableBacklogTask key={task.id} task={task} categories={categories} subcategoryName={group.tags.find(sub=>sub.id===task.subcategoryId)?.name} laterOnly={laterOnly} highlighted={highlightTaskId === task.id} onOpen={() => onOpenTask(task)} onLater={async () => { try { valueOf(await window.captured.planner.scheduleTask({ id: task.id, expectedRevision: task.revision, placement: { kind: laterOnly ? 'backlog-top' : 'later' } })) } catch (reason) { onError(reason instanceof Error ? reason.message : 'Task placement could not be changed.') } }} onComplete={async (completed) => {
            try { valueOf(await window.captured.planner.setTaskCompleted({ id: task.id, completed })) }
            catch (reason) { onError(reason instanceof Error ? reason.message : 'To-do status could not be changed.') }
          }} onReady={async () => {
            try {
              valueOf(await window.captured.planner.setReady({ id: task.id }))
            }
            catch (reason) { onError(reason instanceof Error ? reason.message : 'To-do could not be added to Ready.') }
          }} onCategoryChange={(categoryId) => void setCategory(task.id, categoryId)} draggingDisabled={Boolean(query)} />)}</div>
        </SortableContext>
      </DndContext>}
      {cursor && <button type="button" className="load-more" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading…' : `Load ${Math.min(pageSize, total - tasks.length)} more to-dos`}</button>}
    </>}
  </section>
}

function SortableBacklogTask({ task, categories, subcategoryName, laterOnly, highlighted, onOpen, onLater, onComplete, onReady, onCategoryChange, draggingDisabled }: { task: PlannerTask; categories: Category[]; subcategoryName?:string; laterOnly: boolean; highlighted: boolean; onOpen: () => void; onLater: () => void; onComplete: (completed: boolean) => void; onReady: () => void; onCategoryChange: (categoryId: string | null) => void; draggingDisabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: task.id, disabled: draggingDisabled || laterOnly })
  return <article ref={setNodeRef} data-backlog-task={task.id} className={`backlog-task ${isDragging ? 'is-dragging' : ''} ${highlighted ? 'is-new-task' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}>
    <input type="checkbox" className="backlog-completion-toggle" aria-label={`Mark as done: ${task.body.split('\n')[0] || 'to-do'}`} checked={task.completedAt != null} onChange={(event) => onComplete(event.target.checked)} />
    <button type="button" className="backlog-drag-handle" aria-label={`Reorder ${task.body.split('\n')[0] || 'to-do'}`} title={draggingDisabled ? 'Clear search to reorder' : 'Drag to change priority'} {...attributes} {...listeners} disabled={draggingDisabled}><GripVertical size={15} /></button>
    <div className="backlog-task-main"><button type="button" className="backlog-task-title" onClick={onOpen}>{task.body.split('\n').find((line) => line.trim()) || (task.images.length ? 'Image to-do' : 'Untitled task')}</button>{subcategoryName&&<span className="subcategory-label">{subcategoryName}</span>}<ImageIndicator count={task.images.length} />{task.tags.length > 0 && <div className="backlog-task-tags">{task.tags.map((tag) => <span key={tag}>#{tag}</span>)}</div>}</div>
    <select aria-label={`Category for ${task.body.split('\n')[0] || 'to-do'}`} value={task.categoryId ?? ''} onChange={(event) => onCategoryChange(event.target.value || null)}><option value="">Unassigned</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>
    <button type="button" className="button secondary small" onClick={onLater}>{laterOnly ? <><RotateCcw size={13} /> Return to Backlog</> : <><Clock3 size={13} /> Later</>}</button>{!laterOnly && <button type="button" className="button secondary small" onClick={onReady}>Add to Ready</button>}
  </article>
}
