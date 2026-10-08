import { AppSelect } from '../components/AppSelect'
import { BacklogTagPicker } from '../components/BacklogTagPicker'
import './tasks.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, pointerWithin, DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent, type CollisionDetection } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { CalendarDays, ChevronDown, Columns3, FileText, FolderKanban, GripVertical, Plus, Search, Table2, Undo2, X } from 'lucide-react'
import type { Category, Subcategory, TagRecord, TasksPage, TasksQuery, TaskWorkspaceItem, TaskWorkspaceUndo } from '../../shared/contracts'
import { horizons, horizonLabels, horizonOf, intentionFor, type Horizon, type TaskIntention } from '../../shared/taskHorizons'
import { toLocalISODate } from '../../shared/plannerDates'
import { resultValue } from '../apiResult'
import { ItemDetailDialog } from '../components/ItemDetailDialog'
import { ImageIndicator } from '../components/ItemImages'
import { collectTags, TagEditor } from '../components/TagEditor'
import { CategoryPicker } from '../components/CategoryPicker'
import { TagFilter, type TagFilterValue } from '../components/TagFilter'

const taskCollision: CollisionDetection = args => {
  const hits = pointerWithin(args)
  if (!hits.length) return args.pointerCoordinates ? [] : closestCenter(args)
  const cards = hits.filter(hit => !String(hit.id).startsWith('section:') && !String(hit.id).startsWith('column:'))
  return cards.length ? cards : hits.filter(hit => String(hit.id).startsWith('section:')).length ? hits.filter(hit => String(hit.id).startsWith('section:')) : hits
}

type Layout = 'time' | 'category' | 'table'
type Destination = { horizon: Horizon; categoryId?: string | null; beforeId?: string | null }
const emptyCounts = Object.fromEntries(horizons.map(h => [h, 0])) as TasksPage['counts']
function preference<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback } catch { return fallback } }
function remember(key: string, value: unknown) { try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* Preferences are optional. */ } }
function captureTags(item: TaskWorkspaceItem) {
  if (item.kind !== 'inbox') return item.tags
  const draft = preference<{ tags?: string[]; draft?: string }>(`inbox-tags:${item.id}`, {})
  return Array.isArray(draft.tags) && draft.tags.every(tag => typeof tag === 'string') ? collectTags(draft.tags, typeof draft.draft === 'string' ? draft.draft : '') : item.tags
}

export function TasksView({ categories, subcategories, tags, taxonomyReady, backlog = false }: { categories: Category[]; subcategories: Subcategory[]; tags: TagRecord[]; taxonomyReady: boolean; backlog?: boolean }) {
  const [layout, setLayout] = useState<Layout>(() => (['time', 'category', 'table'] as Layout[]).includes(preference<Layout>('tasks-layout-v1', 'time')) ? preference<Layout>('tasks-layout-v1', 'time') : 'time')
  const [collapsed, setCollapsed] = useState<string[]>(() => preference('tasks-collapsed-v1', []))
  const [compact, setCompact] = useState(() => window.innerWidth < 1250)
  const [expandedCompact, setExpandedCompact] = useState<string[]>([])
  const [today, setToday] = useState(() => toLocalISODate(new Date()))
  const [query, setQuery] = useState(''), [search, setSearch] = useState('')
  const [category, setCategory] = useState('all'), [subcategory, setSubcategory] = useState('')
  const [tagFilter, setTagFilter] = useState<TagFilterValue>({ included: [], excluded: [] })
  const [completed, setCompleted] = useState(false)
  const [pages, setPages] = useState<Partial<Record<Horizon, TasksPage>>>({})
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [detail, setDetail] = useState<TaskWorkspaceItem | null>(null)
  const [undo, setUndo] = useState<TaskWorkspaceUndo | null>(null)
  const [notice, setNotice] = useState('')
  const [active, setActive] = useState<TaskWorkspaceItem | null>(null)
  const [create, setCreate] = useState<Destination | null>(null)
  const [chooseDate, setChooseDate] = useState<TaskWorkspaceItem | null>(null)
  const lock = useRef(false), request = useRef(0)
  const filters = useMemo<TasksQuery>(() => ({ today, scope: backlog ? 'backlog' : 'planned', query: search, ...(category === 'all' ? {} : { categoryId: category === 'unassigned' ? null : category }), ...(subcategory ? { subcategoryId: subcategory } : {}), tags: tagFilter.included, excludedTags: tagFilter.excluded, completed, limit: 50 }), [today, search, category, subcategory, tagFilter, completed, backlog])
  useEffect(() => { const timer = setTimeout(() => setSearch(query.trim()), 150); return () => clearTimeout(timer) }, [query])
  const refresh = useCallback(async (clearError = true) => {
    const current = ++request.current
    setLoading(true)
    try {
      const results = await Promise.all((backlog ? ['unplanned'] as Horizon[] : horizons).map(async horizon => [horizon, resultValue(await window.captured.taskWorkspace.list({ ...filters, horizon }))] as const))
      if (current !== request.current) return
      setPages(Object.fromEntries(results)); if (clearError) setError('')
    } catch (reason) { if (current === request.current) setError(reason instanceof Error ? reason.message : 'Tasks could not be loaded.') }
    finally { if (current === request.current) setLoading(false) }
  }, [filters, backlog])
  const latestRefresh = useRef(refresh)
  latestRefresh.current = refresh
  useEffect(() => { void refresh(); const unsubscribe = window.captured.planner.onChanged(() => { if (!lock.current) void refresh() }); return () => { request.current++; unsubscribe() } }, [refresh])
  useEffect(() => {
    const wake = () => { const day = toLocalISODate(new Date()); setToday(day); if (day === today) void refresh() }
    const midnight = new Date(); midnight.setHours(24, 0, 0, 10)
    const timer = setTimeout(wake, Math.max(10, midnight.getTime() - Date.now()))
    window.addEventListener('focus', wake)
    const visible = () => { if (document.visibilityState === 'visible') wake() }
    document.addEventListener('visibilitychange', visible)
    return () => { clearTimeout(timer); window.removeEventListener('focus', wake); document.removeEventListener('visibilitychange', visible) }
  }, [today, refresh])
  useEffect(() => { const resize = () => setCompact(window.innerWidth < 1250); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize) }, [])
  const counts = pages.unplanned?.counts ?? emptyCounts
  const items = useMemo(() => horizons.flatMap(h => pages[h]?.items ?? []), [pages])
  const taskItems = items.filter(item => item.kind === 'task')
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const visibleHorizons = horizons.filter(h => h !== 'unplanned' && (h !== 'upcoming' || counts.upcoming > 0))
  const categoryMap = useMemo(() => new Map(categories.map(item => [item.id, item.name])), [categories])
  const subcategoryMap = useMemo(() => new Map(subcategories.map(item => [item.id, item])), [subcategories])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  async function mutate(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true; setBusy(true); setError('')
    try { await action() } catch (reason) { setError(reason instanceof Error ? reason.message : 'The change could not be saved.'); setNotice('') }
    finally { lock.current = false; setBusy(false); await latestRefresh.current(false) }
  }
  function move(item: TaskWorkspaceItem, destination: Destination, classify?: 'task' | 'note', specific?: TaskIntention) {
    if (destination.horizon === 'upcoming' && !specific) { setChooseDate(item); return }
    void mutate(async () => {
      const intention = specific ?? (item.kind === 'task' && destination.horizon === item.horizon ? item.intention : intentionFor(destination.horizon as Exclude<Horizon, 'upcoming'>, today))
      const snapshot = resultValue(await window.captured.taskWorkspace.move({ id: item.id, expectedRevision: item.revision, intention, beforeId: destination.beforeId ?? null, categoryId: destination.categoryId, today, classify, tags: captureTags(item) }))
      setUndo(snapshot); setNotice(classify === 'note' ? 'Filed as a note.' : `Moved to ${horizonLabels[horizonOf(intention, today)]}.`)
      if (item.kind === 'inbox') { try { localStorage.removeItem(`inbox-tags:${item.id}`) } catch { /* Saved successfully. */ } }
    })
  }
  async function loadMore(horizon: Horizon) {
    const cursor = pages[horizon]?.nextCursor
    if (!cursor || busy || loading) return
    const current = request.current
    setLoading(true)
    try {
      const page = resultValue(await window.captured.taskWorkspace.list({ ...filters, horizon, cursor }))
      if (current === request.current) setPages(previous => ({ ...previous, [horizon]: { ...page, items: [...(previous[horizon]?.items ?? []), ...page.items] } }))
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'More tasks could not be loaded.'); void refresh() }
    finally { if (current === request.current) setLoading(false) }
  }
  function drop(event: DragEndEvent) {
    setActive(null)
    if (!event.over || event.active.id === event.over.id) return
    const item = items.find(item => item.id === event.active.id)
    if (!item) return
    const target = event.over.data.current as Destination & { item?: TaskWorkspaceItem } | undefined
    if (!target) return
    let beforeId = target.item?.kind === 'task' ? target.item.id : null
    if (target.item?.kind === 'task') {
      const group = items.filter(card => card.horizon === target.horizon && (target.categoryId === undefined || card.categoryId === target.categoryId))
      if (group.some(card => card.id === item.id) && group.findIndex(card => card.id === item.id) < group.findIndex(card => card.id === target.item!.id) && item.horizon === target.horizon) beforeId = group[group.findIndex(card => card.id === target.item!.id) + 1]?.id ?? null
    }
    if (backlog && item.kind === 'inbox') {
      const categoryId = target.categoryId === undefined ? item.categoryId : target.categoryId
      if (categoryId === item.categoryId) return
      void mutate(async () => {
        const updated = resultValue(await window.captured.notes.updateItem({ id: item.id, expectedRevision: item.revision, body: item.body, tags: captureTags(item), categoryId }))
        setUndo({ id: item.id, expectedRevision: updated.revision, kind: 'inbox', categoryId: item.categoryId, subcategoryId: item.subcategoryId, tags: captureTags(item), intention: null })
        setNotice(`Moved to ${categoryMap.get(categoryId ?? '') ?? 'Unassigned'}.`)
      })
      return
    }
    move(item, { ...target, beforeId }, undefined, target.horizon === 'upcoming' ? target.item?.intention : undefined)
  }
  function isCollapsed(key: string) { return collapsed.includes(key) || compact && ['unplanned', 'later'].includes(key) && !expandedCompact.includes(key) }
  function toggleCollapse(key: string) { if (compact && ['unplanned', 'later'].includes(key) && !collapsed.includes(key)) { setExpandedCompact(current => current.includes(key) ? current.filter(item => item !== key) : [...current, key]); return } setCollapsed(current => { const next = current.includes(key) ? current.filter(item => item !== key) : [...current, key]; remember('tasks-collapsed-v1', next); return next }) }
  function card(item: TaskWorkspaceItem, categoryId?: string | null) {
    return <TaskCard backlog={backlog} key={item.id} item={item} categoryName={categoryMap.get(item.categoryId ?? '') ?? 'Unassigned'} subcategory={subcategoryMap.get(item.subcategoryId ?? '')} busy={busy} categoryId={categoryId} onPlan={backlog ? horizon => move(item, { horizon }) : undefined} tagPicker={backlog ? <BacklogTagPicker tags={captureTags(item)} suggestions={tags.map(tag => tag.name)} label={item.body.split('\n')[0] || 'capture'} disabled={busy} onSave={async selected => { let saved = false; await mutate(async () => { resultValue(await window.captured.notes.setTags({ id: item.id, tags: selected })); if (item.kind === 'inbox') { try { localStorage.removeItem(`inbox-tags:${item.id}`) } catch { /* Saved in storage. */ } } setUndo(null); saved = true }); return saved }} /> : undefined} onOpen={() => setDetail(item)} onNote={() => move(item, { horizon: 'unplanned' }, 'note')} onComplete={() => void mutate(async () => { resultValue(await window.captured.planner.setTaskCompleted({ id: item.id, completed: !completed })); setUndo(null); setNotice(completed ? 'Task reopened.' : 'Task completed.') })} />
  }
  function section(horizon: Horizon, group: TaskWorkspaceItem[], categoryId?: string | null) {
    return <TaskSection key={horizon} horizon={horizon} categoryId={categoryId} dragging={!!active} count={group.length} onAdd={() => setCreate({ horizon, categoryId })}><SortableContext items={group.map(item => item.id)} strategy={verticalListSortingStrategy}>{group.map(item => card(item, categoryId))}</SortableContext></TaskSection>
  }

  return <section className={`tasks-page ${backlog ? 'tasks-backlog-page' : layout === 'table' ? 'tasks-table-page' : ''}`} aria-label={backlog ? 'Backlog workspace' : 'Tasks workspace'} aria-busy={busy}>
    <header className="tasks-heading"><div><h1>{backlog ? 'Backlog' : 'Tasks'} <span className="title-count">{total}</span></h1></div><button type="button" className="button primary small" disabled={busy || !taxonomyReady} onClick={() => setCreate({ horizon: backlog ? 'unplanned' : 'today' })}><Plus size={14} /> Add task</button></header>
    <div className="tasks-toolbar"><label className="search-box"><Search size={14} /><input aria-label="Search tasks" placeholder="Search tasks or tags…" value={query} onChange={event => setQuery(event.target.value)} />{query && <button aria-label="Clear task search" onClick={() => setQuery('')}><X size={13} /></button>}</label><AppSelect aria-label="Filter tasks by category" value={category} onChange={event => { setCategory(event.target.value); setSubcategory('') }}><option value="all">All categories</option><option value="unassigned">Unassigned</option>{categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</AppSelect>{category !== 'all' && category !== 'unassigned' && <AppSelect aria-label="Filter tasks by subcategory" value={subcategory} onChange={event => setSubcategory(event.target.value)}><option value="">All subcategories</option>{subcategories.filter(sub => sub.categoryId === category).map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}</AppSelect>}<TagFilter category="Tasks" tags={tags} value={tagFilter} onChange={setTagFilter} />{!backlog && <div className="planner-view-switch tasks-layout-switch" aria-label="Task layout"><button type="button" aria-pressed={layout === 'time'} onClick={() => { setLayout('time'); remember('tasks-layout-v1', 'time') }}><Columns3 size={13} /> By time</button><button type="button" aria-pressed={layout === 'category'} onClick={() => { setLayout('category'); remember('tasks-layout-v1', 'category') }}><FolderKanban size={13} /> By category</button><button type="button" aria-pressed={layout === 'table'} onClick={() => { setLayout('table'); remember('tasks-layout-v1', 'table') }}><Table2 size={13} /> Table</button></div>}<button type="button" className="tasks-done-filter" aria-pressed={completed} onClick={() => setCompleted(value => !value)}>{completed ? 'Show open tasks' : 'Completed'}</button></div>
    {error && <div className="inline-error" role="alert">{error}<button type="button" onClick={() => void refresh()}>Refresh</button></div>}
    {notice && <div className="tasks-notice" role="status"><span>{notice}</span>{undo && <button type="button" disabled={busy} onClick={() => void mutate(async () => { resultValue(await window.captured.taskWorkspace.undo(undo)); setUndo(null); setNotice('Change undone.') })}><Undo2 size={13} /> Undo</button>}<button type="button" aria-label="Dismiss task notice" onClick={() => setNotice('')}><X size={13} /></button></div>}
    {!taxonomyReady || loading && !items.length && !Object.keys(pages).length ? <div className="loading-state"><span className="spinner" /> Loading tasks…</div> : <DndContext sensors={sensors} collisionDetection={taskCollision} onDragStart={event => setActive(items.find(item => item.id === event.active.id) ?? null)} onDragCancel={() => setActive(null)} onDragEnd={drop}>
      {backlog ? <div className="tasks-backlog-groups">{[{ id: 'unassigned', name: 'Unassigned' }, ...categories].filter(group => category === 'all' || category === group.id).map(group => {
        const groupItems = items.filter(item => (item.categoryId ?? 'unassigned') === group.id)
        if (!groupItems.length && !active) return null
        const categoryId = group.id === 'unassigned' ? null : group.id
        return <BacklogGroup key={group.id} categoryId={categoryId} dragging={!!active} name={group.name} count={pages.unplanned?.categoryCounts?.[group.id] ?? groupItems.length} onAdd={() => setCreate({ horizon: 'unplanned', categoryId })}><SortableContext items={groupItems.map(item => item.id)} strategy={verticalListSortingStrategy}>{groupItems.map(item => card(item, categoryId))}</SortableContext></BacklogGroup>
      })}{pages.unplanned?.nextCursor && <button type="button" className="load-more" disabled={loading || busy} onClick={() => void loadMore('unplanned')}>Load more</button>}</div> : layout === 'table' ? <div className="tasks-table tasks-table-groups">{visibleHorizons.map(horizon => <TaskTableGroup key={horizon} dragging={!!active} horizon={horizon} count={counts[horizon]} ids={taskItems.filter(item => item.horizon === horizon).map(item => item.id)} onAdd={() => setCreate({ horizon })}>{taskItems.filter(item => item.horizon === horizon).map(item => <TaskTableRow key={item.id} item={item} categoryName={categoryMap.get(item.categoryId ?? '') ?? 'Unassigned'} subcategory={subcategoryMap.get(item.subcategoryId ?? '')} busy={busy} onOpen={() => setDetail(item)} onComplete={() => void mutate(async () => { resultValue(await window.captured.planner.setTaskCompleted({ id: item.id, completed: !completed })); setUndo(null); setNotice(completed ? 'Task reopened.' : 'Task completed.') })} />)}{pages[horizon]?.nextCursor && <tr><td colSpan={3}><button type="button" className="load-more" disabled={loading || busy} onClick={() => void loadMore(horizon)}>Load more</button></td></tr>}</TaskTableGroup>)}</div> : <>
      <div className={`tasks-board tasks-board-${layout} ${active ? 'is-dragging' : ''}`}>
        {layout === 'time' ? visibleHorizons.map(horizon => <HorizonColumn key={horizon} horizon={horizon} collapsed={isCollapsed(horizon)}><header className="tasks-column-heading"><button type="button" onClick={() => toggleCollapse(horizon)} aria-expanded={!isCollapsed(horizon)}><b>{horizonLabels[horizon]}</b><span>{counts[horizon]}</span></button>{!isCollapsed(horizon) && horizon !== 'upcoming' && <button type="button" aria-label={`Add task to ${horizonLabels[horizon]}`} onClick={() => setCreate({ horizon })}><Plus size={14} /></button>}</header>{!isCollapsed(horizon) && <div className="tasks-column-content">{section(horizon, taskItems.filter(item => item.horizon === horizon))}{pages[horizon]?.nextCursor && <button type="button" className="load-more" disabled={loading || busy} onClick={() => void loadMore(horizon)}>Load more · {counts[horizon] - (pages[horizon]?.items.length ?? 0)} remaining</button>}</div>}</HorizonColumn>) : [...categories, { id: 'unassigned', name: 'Unassigned' }].filter(group => (category === 'all' || category === group.id) && (!!active || category === group.id || (pages.unplanned?.categoryCounts?.[group.id] ?? taskItems.filter(item => (item.categoryId ?? 'unassigned') === group.id).length) > 0)).map(group => {
          const categoryId = group.id === 'unassigned' ? null : group.id
          return <div key={group.id} className="tasks-column tasks-category-column"><header className="tasks-column-heading"><FolderKanban size={14} /><b>{group.name}</b><span>{pages.unplanned?.categoryCounts?.[group.id] ?? taskItems.filter(item => item.categoryId === categoryId).length}</span><button type="button" aria-label={`Add task to ${group.name}`} onClick={() => setCreate({ horizon: 'today', categoryId })}><Plus size={14} /></button></header><div className="tasks-column-content">{visibleHorizons.map(horizon => section(horizon, taskItems.filter(item => item.categoryId === categoryId && item.horizon === horizon), categoryId))}</div></div>
        })}
      </div>
      {layout === 'category' && horizons.some(h => pages[h]?.nextCursor) && <div className="tasks-more">{horizons.filter(h => pages[h]?.nextCursor).map(h => <button type="button" className="load-more" disabled={loading || busy} key={h} onClick={() => void loadMore(h)}>Load more {horizonLabels[h]} · {counts[h] - (pages[h]?.items.length ?? 0)} remaining</button>)}</div>}
      </>}
      <DragOverlay dropAnimation={null}>{active && <TaskDragPreview item={active} categoryName={categoryMap.get(active.categoryId ?? '') ?? 'Unassigned'} subcategory={subcategoryMap.get(active.subcategoryId ?? '')} backlog={backlog} row={backlog || layout === 'table'} />}</DragOverlay>
    </DndContext>}
    {detail && <ItemDetailDialog key={detail.id} task={detail} showPlanning={detail.kind === 'task'} initialTags={captureTags(detail)} suggestions={tags.map(tag => tag.name)} onClose={() => setDetail(null)} onChanged={() => { if (detail.kind === 'inbox') { try { localStorage.removeItem(`inbox-tags:${detail.id}`) } catch { /* Already saved. */ } } setDetail(null); void refresh() }} />}
    {create && <CreateTaskDialog error={error} categories={categories} subcategories={subcategories} tags={tags} destination={{ ...create, categoryId: create.categoryId === undefined ? category === 'all' || category === 'unassigned' ? null : category : create.categoryId }} today={today} onClose={() => setCreate(null)} onSave={async (body, categoryId, intention, subcategoryId, tags) => { await mutate(async () => { resultValue(await window.captured.taskWorkspace.create({ body, categoryId, intention, subcategoryId, tags })); setCreate(null); setUndo(null); setNotice('Task added.') }) }} />}
    {chooseDate && <DateDialog item={chooseDate} today={today} onClose={() => setChooseDate(null)} onSave={intention => { const item = chooseDate; setChooseDate(null); move(item, { horizon: 'upcoming' }, undefined, intention) }} />}
  </section>
}

function TaskDragPreview({ item, categoryName, subcategory, backlog, row }: { item: TaskWorkspaceItem; categoryName: string; subcategory?: Subcategory; backlog: boolean; row: boolean }) {
  if (!row) return <div className="tasks-drag-preview"><b>{item.body.split('\n')[0] || 'Image capture'}</b><span>{categoryName}</span></div>
  const labels = backlog ? captureTags(item) : item.tags
  return <div aria-hidden="true" className={`tasks-drag-preview tasks-drag-row ${backlog ? 'tasks-drag-backlog' : 'tasks-drag-table'}`}>
    <div className="tasks-drag-row-main">{item.kind === 'task' && <input type="checkbox" checked={item.completedAt !== null} readOnly tabIndex={-1} />}<GripVertical size={15} /><div className="backlog-task-main"><span className="backlog-task-title">{item.body.trim() || 'Image capture'}</span>{backlog && subcategory && <small>{subcategory.name}</small>}<ImageIndicator count={item.images.length} /></div></div>
    {!backlog && <div><span className="tasks-category-label">{categoryName}</span>{subcategory && <small className="tasks-table-subcategory">{subcategory.name}</small>}</div>}
    <div className="tasks-table-tags">{labels.map(tag => <span className="tasks-table-tag" key={tag}>{tag}</span>)}</div>
    {backlog && item.completedAt === null && <div className="backlog-plan-actions">{(['today', 'tomorrow', 'next-week', 'later'] as const).map(horizon => <button type="button" tabIndex={-1} className="button secondary small" key={horizon}>{horizonLabels[horizon]}</button>)}{item.kind === 'inbox' && <button type="button" tabIndex={-1} className="button secondary small"><FileText size={12} /> Note</button>}</div>}
  </div>
}

function TaskDropTarget({ horizon, categoryId, label, table = false }: { horizon: Horizon; categoryId?: string | null; label: string; table?: boolean }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:append:${table ? 'table' : categoryId === undefined ? 'all' : categoryId ?? 'unassigned'}:${horizon}`, data: { horizon, categoryId } })
  const className = `tasks-drop-target ${isOver ? 'is-over' : ''}`
  return table ? <tr ref={setNodeRef} className={className}><td colSpan={3}>{label}</td></tr> : <div ref={setNodeRef} className={className}>{label}</div>
}

function BacklogGroup({ name, categoryId, dragging, count, children, onAdd }: { name: string; categoryId: string | null; dragging: boolean; count: number; children: React.ReactNode; onAdd: () => void }) {
  const [collapsed, setCollapsed] = useState(false)
  const { setNodeRef, isOver } = useDroppable({ id: `section:backlog:${categoryId ?? 'unassigned'}`, data: { horizon: 'unplanned', categoryId } })
  return <section ref={setNodeRef} data-category-id={categoryId ?? 'unassigned'} className={`backlog-group ${dragging ? 'is-dropzone' : ''} ${isOver ? 'is-over' : ''}`} aria-label={`${name} backlog`}><div className="backlog-group-heading"><button type="button" className="backlog-group-toggle" aria-expanded={!collapsed || dragging} onClick={() => setCollapsed(value => !value)}><FolderKanban size={16} /><b>{name}</b><span>{count}</span><ChevronDown size={15} className={collapsed && !dragging ? 'is-closed' : ''} /></button><button type="button" className="backlog-category-add" aria-label={`Add task to ${name}`} onClick={onAdd}><Plus size={15} /></button></div>{(!collapsed || dragging) && <div className="backlog-task-list">{children}{dragging && <TaskDropTarget horizon="unplanned" categoryId={categoryId} label={`Drop in ${name}`} />}</div>}</section>
}

function TaskTableGroup({ horizon, dragging, count, ids, children, onAdd }: { horizon: Horizon; dragging: boolean; count: number; ids: string[]; children: React.ReactNode; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:table:${horizon}`, data: { horizon }, disabled: horizon === 'upcoming' && count === 0 })
  return <section className={`backlog-group tasks-table-panel ${dragging ? 'is-dropzone' : ''} ${isOver ? 'is-over' : ''}`} aria-label={`${horizonLabels[horizon]} tasks`}><header className="backlog-group-heading"><CalendarDays size={16} /><b>{horizonLabels[horizon]}</b><span>{count}</span>{horizon !== 'upcoming' && <button type="button" className="backlog-category-add" aria-label={`Add task to ${horizonLabels[horizon]}`} onClick={onAdd}><Plus size={15} /></button>}</header><table className="tasks-group-table" aria-label={`${horizonLabels[horizon]} task table`}><colgroup><col /><col /><col /></colgroup><thead><tr><th scope="col">Task</th><th scope="col">Category</th><th scope="col">Tags</th></tr></thead><tbody ref={setNodeRef} data-horizon={horizon}><SortableContext items={ids} strategy={verticalListSortingStrategy}>{children}</SortableContext>{dragging ? <TaskDropTarget horizon={horizon} table label={`Drop in ${horizonLabels[horizon]}`} /> : !count && <tr className="tasks-table-empty"><td colSpan={3} /></tr>}</tbody></table></section>
}

function TaskTableRow({ item, categoryName, subcategory, busy, onOpen, onComplete }: { backlog?: boolean; item: TaskWorkspaceItem; categoryName: string; subcategory?: Subcategory; busy: boolean; onOpen: () => void; onComplete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, activeIndex, index } = useSortable({ id: item.id, data: { horizon: item.horizon, item }, disabled: busy || item.completedAt !== null })
  return <tr ref={setNodeRef} data-task-id={item.id} className={`${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? activeIndex >= 0 && activeIndex < index ? 'drop-after' : 'drop-before' : ''}`} style={{ transform: CSS.Transform.toString(transform), transition }}><td><div className="tasks-table-task"><input className="backlog-completion-toggle" type="checkbox" aria-label={`${item.completedAt ? 'Reopen' : 'Complete'} ${item.body.split('\n')[0] || 'task'}`} checked={item.completedAt !== null} disabled={busy} onChange={onComplete} /><button type="button" className="tasks-drag-handle backlog-drag-handle" aria-label={`Move ${item.body.split('\n')[0] || 'task'}`} disabled={busy || item.completedAt !== null} {...attributes} {...listeners}><GripVertical size={15} /></button><button type="button" className="backlog-task-title" disabled={busy} onClick={onOpen}>{item.body.trim() || 'Image capture'}</button><ImageIndicator count={item.images.length} /></div></td><td><span className="tasks-category-label">{categoryName}</span>{subcategory && <span className="tasks-table-subcategory">{subcategory.name}</span>}</td><td className="tasks-table-tags">{item.tags.map(tag => <span className="tasks-table-tag" key={tag}>{tag}</span>)}</td></tr>
}

function HorizonColumn({ horizon, collapsed, children }: { horizon: Horizon; collapsed: boolean; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${horizon}`, data: { horizon } })
  return <div ref={setNodeRef} data-horizon={horizon} className={`tasks-column ${horizon === 'today' ? 'is-today' : ''} ${collapsed ? 'is-collapsed' : ''} ${isOver ? 'is-over' : ''}`}>{children}</div>
}

function TaskSection({ horizon, categoryId, count, children, dragging, onAdd }: { horizon: Horizon; categoryId?: string | null; count: number; children: React.ReactNode; dragging: boolean; onAdd: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `section:${categoryId === undefined ? 'all' : categoryId ?? 'unassigned'}:${horizon}`, data: { horizon, categoryId }, disabled: horizon === 'upcoming' && count === 0 })
  return <section ref={setNodeRef} data-horizon={horizon} className={`tasks-section ${isOver ? 'is-over' : ''} ${!count ? 'is-empty' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label={`${horizonLabels[horizon]} tasks`}><div className="tasks-section-heading"><span>{horizonLabels[horizon]}</span><span>{count}</span>{horizon !== 'upcoming' && <button type="button" aria-label={`Add ${horizonLabels[horizon]} task`} onClick={onAdd}><Plus size={12} /></button>}</div>{children}{dragging && <TaskDropTarget horizon={horizon} categoryId={categoryId} label={`Drop in ${horizonLabels[horizon]}`} />}</section>
}

function TaskCard({ backlog = false, item, categoryName, subcategory, busy, categoryId, onPlan, tagPicker, onOpen, onNote, onComplete }: { backlog?: boolean; item: TaskWorkspaceItem; categoryName: string; subcategory?: Subcategory; busy: boolean; categoryId?: string | null; tagPicker?: React.ReactNode; onPlan?: (horizon: 'today' | 'tomorrow' | 'next-week' | 'later') => void; onOpen: () => void; onNote: () => void; onComplete: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, activeIndex, index } = useSortable({ id: item.id, data: { horizon: item.horizon, categoryId, item }, disabled: busy || item.completedAt !== null })
  const capture = item.kind === 'inbox'
  if (backlog) return <article ref={setNodeRef} data-task-id={item.id} data-backlog-task={item.id} style={{ transform: CSS.Transform.toString(transform), transition }} className={`backlog-task ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? activeIndex >= 0 && activeIndex < index ? 'drop-after' : 'drop-before' : ''}`}>
    {!capture && <input type="checkbox" className="backlog-completion-toggle" aria-label={`${item.completedAt ? 'Reopen' : 'Complete'} ${item.body.split('\n')[0] || 'task'}`} checked={item.completedAt !== null} disabled={busy} onChange={onComplete} />}
    <button type="button" className="backlog-drag-handle" aria-label={`Move ${item.body.split('\n')[0] || 'capture'}`} disabled={busy || item.completedAt !== null} {...attributes} {...listeners}><GripVertical size={15} /></button>
    <div className="backlog-task-main"><button type="button" className="backlog-task-title" disabled={busy} onClick={onOpen}>{item.body.trim() || 'Image capture'}</button>{subcategory && <span className="subcategory-label">{subcategory.name}</span>}<ImageIndicator count={item.images.length} /></div>{tagPicker}
    {item.completedAt === null && <div className="backlog-plan-actions">{onPlan && (['today', 'tomorrow', 'next-week', 'later'] as const).map(horizon => <button key={horizon} type="button" className="button secondary small" disabled={busy} onClick={() => onPlan(horizon)}>{horizonLabels[horizon]}</button>)}{capture && <button type="button" className="button secondary small" disabled={busy} onClick={onNote}><FileText size={12} /> Note</button>}</div>}
  </article>
  return <article ref={setNodeRef} data-task-id={item.id} style={{ transform: CSS.Transform.toString(transform), transition }} className={`tasks-card ${capture ? 'is-capture' : ''} ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? activeIndex >= 0 && activeIndex < index ? 'drop-after' : 'drop-before' : ''}`}>
    <div className="tasks-card-heading"><button type="button" className="tasks-drag-handle" aria-label={`Move ${item.body.split('\n')[0] || 'capture'}`} disabled={busy || item.completedAt !== null} {...attributes} {...listeners}><GripVertical size={13} /></button>{!capture && <input type="checkbox" aria-label={`${item.completedAt ? 'Reopen' : 'Complete'} ${item.body.split('\n')[0] || 'task'}`} checked={item.completedAt !== null} disabled={busy} onChange={onComplete} />}<button type="button" className="tasks-card-body" disabled={busy} onClick={onOpen}>{item.body.trim() || (item.images.length ? 'Image capture' : 'Untitled task')}</button></div>
    <div className="tasks-card-meta"><span className="tasks-category-label">{categoryName}</span>{subcategory && <span style={{ color: subcategory.color }}>{subcategory.name}</span>}<ImageIndicator count={item.images.length} /></div>
    {tagPicker ?? (!!item.tags.length && <div className="tasks-card-tags">{item.tags.map(tag => <span key={tag}>#{tag}</span>)}</div>)}
    {item.plannedStartAt !== null && <small className="tasks-scheduled"><CalendarDays size={11} /> Scheduled {new Date(item.plannedStartAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small>}
    {(capture || onPlan) && item.completedAt === null && <div className="tasks-card-actions">{onPlan && <>{(['today', 'tomorrow', 'next-week', 'later'] as const).map(horizon => <button key={horizon} type="button" disabled={busy} onClick={() => onPlan(horizon)}>{horizonLabels[horizon]}</button>)}</>}{capture && <><button type="button" disabled={busy} onClick={onNote}><FileText size={12} /> Note</button></>}</div>}
  </article>
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null), previous = useRef(document.activeElement)
  useEffect(() => {
    const background: { element: HTMLElement; inert: boolean }[] = []
    let layer = ref.current?.parentElement
    while (layer && layer !== document.body) { for (const sibling of Array.from(layer.parentElement?.children ?? [])) { if (sibling instanceof HTMLElement && sibling !== layer) { background.push({ element: sibling, inert: sibling.inert }); sibling.inert = true } } layer = layer.parentElement }
    ref.current?.querySelector<HTMLElement>('textarea,input,select,button')?.focus()
    return () => { background.forEach(({ element, inert }) => { element.inert = inert }); if (previous.current instanceof HTMLElement) previous.current.focus() }
  }, [])
  return <div className="modal-backdrop"><div ref={ref} className="dialog-card tasks-dialog" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose() } if (event.key === 'Tab') { const controls = [...(ref.current?.querySelectorAll<HTMLElement>('input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)') ?? [])]; if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() } } }}><h2>{title}</h2>{children}</div></div>
}
function CreateTaskDialog({ error, categories, subcategories, tags, destination, today, onClose, onSave }: { error: string; categories: Category[]; subcategories: Subcategory[]; tags: TagRecord[]; destination: Destination; today: string; onClose: () => void; onSave: (body: string, categoryId: string | null, intention: TaskIntention, subcategoryId: string | null, tags: string[]) => Promise<void> }) {
  const [body, setBody] = useState(''), [category, setCategory] = useState(destination.categoryId ?? '')
  const [subcategoryId, setSubcategoryId] = useState<string | null>(null), [labels, setLabels] = useState<string[]>([]), [tagDraft, setTagDraft] = useState('')
  const [horizon, setHorizon] = useState<Horizon>(destination.horizon === 'upcoming' ? 'unplanned' : destination.horizon)
  const [busy, setBusy] = useState(false)
  return <Modal title="Add task" onClose={() => { if (!busy) onClose() }}><form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); void onSave(body, category || null, intentionFor(horizon as Exclude<Horizon, 'upcoming'>, today), subcategoryId, collectTags(labels, tagDraft)).finally(() => setBusy(false)) }}><label>Task<textarea required aria-label="Task text" maxLength={50000} value={body} disabled={busy} onChange={event => setBody(event.target.value)} /></label><CategoryPicker categories={categories} subcategories={subcategories} categoryId={category || null} subcategoryId={subcategoryId} disabled={busy} onChange={(selected, sub) => { setCategory(selected ?? ''); setSubcategoryId(sub) }} /><TagEditor tags={labels} draft={tagDraft} onTagsChange={setLabels} onDraftChange={setTagDraft} suggestions={tags.map(tag => tag.name)} disabled={busy} /><label>When<AppSelect aria-label="Task horizon" value={horizon} disabled={busy} onChange={event => setHorizon(event.target.value as Horizon)}>{horizons.filter(h => h !== 'upcoming').map(h => <option key={h} value={h}>{horizonLabels[h]}</option>)}</AppSelect></label><div>{error && <div className="inline-error" role="alert">{error}</div>}</div><div className="dialog-actions"><button type="button" className="button secondary" disabled={busy} onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={!body.trim() || busy}>{busy ? 'Adding…' : 'Add task'}</button></div></form></Modal>
}
function DateDialog({ item, today, onClose, onSave }: { item: TaskWorkspaceItem; today: string; onClose: () => void; onSave: (intention: TaskIntention) => void }) {
  const [kind, setKind] = useState<'day' | 'week'>(item.intention.kind === 'week' ? 'week' : 'day'), [date, setDate] = useState(item.intention.targetDate ?? today)
  return <Modal title="Choose when" onClose={onClose}><form onSubmit={event => { event.preventDefault(); const selected = kind === 'week' ? intentionFor('week', date).targetDate : date; onSave({ kind, targetDate: selected, position: 0 }) }}><label>Plan for<AppSelect aria-label="Plan precision" value={kind} onChange={event => setKind(event.target.value as 'day' | 'week')}><option value="day">A day</option><option value="week">A week</option></AppSelect></label><label>{kind === 'week' ? 'Any day in the chosen week' : 'Date'}<input required aria-label="Planning date" type="date" value={date} onChange={event => setDate(event.target.value)} /></label><p>This changes your task plan. Calendar scheduling stays separate.</p><div className="dialog-actions"><button type="button" className="button secondary" onClick={onClose}>Cancel</button><button type="submit" className="button primary" disabled={!date}>Save plan</button></div></form></Modal>
}
