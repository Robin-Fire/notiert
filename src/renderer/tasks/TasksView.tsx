import { AppSelect } from '../components/AppSelect'
import { TaskTagPicker } from '../components/TaskTagPicker'
import { TaskDescriptionField, type TaskDescription } from '../components/TaskDescriptionField'
import { useImagePaste } from '../components/useImagePaste'
import './tasks.css'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  closestCenter,
  pointerWithin,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
  type CollisionDetection,
  type Modifier
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  CalendarDays,
  Check,
  Columns3,
  GripVertical,
  Plus,
  Search,
  Spotlight,
  Table2,
  Undo2,
  X
} from 'lucide-react'
import type {
  Category,
  Subcategory,
  TagRecord,
  TasksPage,
  TasksQuery,
  TaskWorkspaceItem,
  TaskWorkspaceUndo,
  TaskCompletionUndo,
  TaskWorkspaceCreate
} from '../../shared/contracts'
import {
  horizons,
  horizonLabels,
  horizonOf,
  intentionFor,
  type Horizon,
  type TaskIntention
} from '../../shared/taskHorizons'
import { toLocalISODate } from '../../shared/plannerDates'
import { resultValue } from '../apiResult'
import { ItemDetailDialog } from '../components/ItemDetailDialog'
import { ImageIndicator } from '../components/ItemImages'
import { collectTags, TagEditor } from '../components/TagEditor'
import { CategoryPicker } from '../components/CategoryPicker'

const taskCollision: CollisionDetection = (args) => {
  const hits = pointerWithin(args)
  if (!hits.length) return args.pointerCoordinates ? [] : closestCenter(args)
  const cards = hits.filter(
    (hit) => !String(hit.id).startsWith('section:') && !String(hit.id).startsWith('column:')
  )
  return cards.length
    ? cards
    : hits.filter((hit) => String(hit.id).startsWith('section:')).length
      ? hits.filter((hit) => String(hit.id).startsWith('section:'))
      : hits
}

const alignRowPreview: Modifier = ({ transform }) => ({ ...transform, x: 0 })

type Layout = 'time' | 'table'
type TaskCreationDestination = { horizon: Horizon; categoryId?: string | null }
type Destination = TaskCreationDestination & { beforeId?: string | null }
const emptyCounts = Object.fromEntries(horizons.map((h) => [h, 0])) as TasksPage['counts']
const emptyPages: Partial<Record<Horizon, TasksPage>> = {}
function preference<T>(key: string, fallback: T): T {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback
  } catch {
    return fallback
  }
}
function remember(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* Preferences are optional. */
  }
}

export function TasksView({
  categories,
  subcategories,
  tags,
  taxonomyReady,
  title,
  category,
  subcategory,
  selectedTag,
  captureProtection,
  onCaptureProtectionChange,
  query,
  setQuery,
  searchRef,
}: {
  categories: Category[]
  subcategories: Subcategory[]
  tags: TagRecord[]
  title: string
  category?: string
  subcategory?: string
  selectedTag?: string
  captureProtection?: boolean
  onCaptureProtectionChange: (enabled: boolean) => Promise<boolean>
  query: string
  setQuery: (query: string) => void
  searchRef: React.RefObject<HTMLInputElement | null>
  taxonomyReady: boolean
}) {
  const [create, setCreate] = useState<TaskCreationDestination | null>(null)
  const [savingCaptureProtection, setSavingCaptureProtection] = useState(false)
  const [captureProtectionError, setCaptureProtectionError] = useState(false)
  const shareVisible = captureProtection === false
  const [layout, setLayout] = useState<Layout>(() =>
    (['time', 'table'] as Layout[]).includes(preference<Layout>('tasks-layout-v1', 'time'))
      ? preference<Layout>('tasks-layout-v1', 'time')
      : 'time'
  )
  const [collapsed, setCollapsed] = useState<string[]>(() => preference('tasks-collapsed-v2', []))
  const [compact, setCompact] = useState(() => window.innerWidth < 1320)
  const [expandedCompact, setExpandedCompact] = useState<string[]>([])
  const [today, setToday] = useState(() => toLocalISODate(new Date()))
  const [debouncedSearch, setSearch] = useState('')
  const hasSearch = !!query.trim()
  const search = hasSearch ? debouncedSearch : ''
  const [completed, setCompleted] = useState(false)
  const pageKey = JSON.stringify([category, subcategory, selectedTag])
  const [loaded, setLoaded] = useState({ pageKey, pages: emptyPages })
  const pageChanged = loaded.pageKey !== pageKey
  const pages = pageChanged ? emptyPages : loaded.pages
  const [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [detail, setDetail] = useState<TaskWorkspaceItem | null>(null)
  const [undo, setUndo] = useState<TaskWorkspaceUndo | null>(null)
  const [completionUndo, setCompletionUndo] = useState<TaskCompletionUndo | null>(null)
  const [notice, setNotice] = useState('')
  const [noticeHovered, setNoticeHovered] = useState(false)
  const [noticeFocused, setNoticeFocused] = useState(false)
  useEffect(() => {
    if (!notice || noticeHovered || noticeFocused || busy) return
    const timer = setTimeout(() => {
      setNotice('')
      setUndo(null)
      setCompletionUndo(null)
    }, 10_000)
    return () => clearTimeout(timer)
  }, [notice, undo, completionUndo, noticeHovered, noticeFocused, busy])
  const [dragPreview, setDragPreview] = useState<HTMLElement | null>(null)
  const showTaggedList = selectedTag !== undefined
  const showFlatList = !!search || showTaggedList
  const lock = useRef(false),
    request = useRef(0)
  const filters = useMemo<TasksQuery>(
    () => ({
      today,
      scope: 'all',
      query: search,
      ...(category ? { categoryId: category } : {}),
      ...(subcategory ? { subcategoryId: subcategory } : {}),
      tags: selectedTag === undefined ? [] : [selectedTag],
      excludedTags: [],
      completed,
      limit: 50
    }),
    [today, search, category, subcategory, selectedTag, completed]
  )
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 150)
    return () => clearTimeout(timer)
  }, [query])
  const refresh = useCallback(
    async (clearError = true, retainTaggedRows = 0) => {
      const current = ++request.current
      setLoading(true)
      try {
        const results = showTaggedList
          ? { unplanned: resultValue(await window.captured.taskWorkspace.list(filters)) }
          : resultValue(await window.captured.taskWorkspace.overview(filters))
        const first = results.unplanned
        if (showTaggedList && first && first.items.length < retainTaggedRows) {
          const loaded = [...first.items]
          let nextCursor = first.nextCursor
          while (nextCursor && loaded.length < retainTaggedRows && current === request.current) {
            const page = resultValue(await window.captured.taskWorkspace.list({ ...filters, cursor: nextCursor }))
            loaded.push(...page.items)
            nextCursor = page.nextCursor
          }
          results.unplanned = { ...first, items: loaded, nextCursor }
        }
        if (current !== request.current) return
        setLoaded({ pageKey, pages: results })
        if (clearError) setError('')
      } catch (reason) {
        if (current === request.current) {
          setLoaded(previous => previous.pageKey === pageKey ? previous : { pageKey, pages: emptyPages })
          setError(reason instanceof Error ? reason.message : 'Tasks could not be loaded.')
        }
      } finally {
        if (current === request.current) setLoading(false)
      }
    },
    [filters, pageKey, showTaggedList]
  )
  const latestRefresh = useRef(refresh)
  latestRefresh.current = refresh
  useEffect(() => {
    void refresh()
    const unsubscribe = window.captured.planner.onChanged(() => {
      if (!lock.current) void refresh()
    })
    return () => {
      request.current++
      unsubscribe()
    }
  }, [refresh])
  useEffect(() => {
    const wake = () => {
      const day = toLocalISODate(new Date())
      setToday(day)
      if (day === today) void refresh()
    }
    const midnight = new Date()
    midnight.setHours(24, 0, 0, 10)
    const timer = setTimeout(wake, Math.max(10, midnight.getTime() - Date.now()))
    window.addEventListener('focus', wake)
    const visible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    document.addEventListener('visibilitychange', visible)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('focus', wake)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [today, refresh])
  useEffect(() => {
    const resize = () => setCompact(window.innerWidth < 1320)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        !event.defaultPrevented &&
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        !document.querySelector('[role="dialog"]')
      ) {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', keydown)
    return () => window.removeEventListener('keydown', keydown)
  }, [])
  const counts = (pages.unplanned ?? Object.values(pages)[0])?.counts ?? emptyCounts
  const items = useMemo(() => horizons.flatMap((h) => pages[h]?.items ?? []), [pages])
  const taskItems = items
  const total = Object.values(counts).reduce((a, b) => a + b, 0)
  const visibleHorizons = horizons.filter(horizon => horizon !== 'unplanned' || counts.unplanned > 0)
  const tagColors = useMemo(
    () => new Map(tags.map((tag) => [tag.name.toLocaleLowerCase(), tag.color])),
    [tags]
  )
  const subcategoryMap = useMemo(() => new Map(subcategories.map((item) => [item.id, item])), [subcategories])
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  async function mutate(action: () => Promise<void>, retainTaggedRows = 0) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    setUndo(null)
    setCompletionUndo(null)
    try {
      await action()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The change could not be saved.')
      setNotice('')
    } finally {
      lock.current = false
      setBusy(false)
      await latestRefresh.current(false, retainTaggedRows)
    }
  }
  function move(
    item: TaskWorkspaceItem,
    destination: Destination,
    classify?: 'task',
    specific?: TaskIntention
  ) {
    void mutate(async () => {
      const intention =
        specific ??
        (item.kind === 'task' && destination.horizon === item.horizon
          ? item.intention
          : intentionFor(destination.horizon, today))
      const snapshot = resultValue(
        await window.captured.taskWorkspace.move({
          id: item.id,
          expectedRevision: item.revision,
          intention,
          beforeId: destination.beforeId,
          categoryId: destination.categoryId,
          today,
          classify,
          tags: item.tags
        })
      )
      setUndo(snapshot)
      setNotice(
        `Moved to ${horizonLabels[horizonOf(intention, today)]}.`
      )
    })
  }
  async function loadMore(horizon: Horizon) {
    const cursor = pages[horizon]?.nextCursor
    if (!cursor || busy || loading) return
    const current = request.current
    setLoading(true)
    try {
      const page = resultValue(
        await window.captured.taskWorkspace.list({
          ...filters,
          horizon: showFlatList ? undefined : horizon,
          cursor
        })
      )
      if (current === request.current)
        setLoaded((previous) => ({
          ...previous,
          pages: {
            ...previous.pages,
            [horizon]: { ...page, items: [...(previous.pages[horizon]?.items ?? []), ...page.items] }
          }
        }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'More tasks could not be loaded.')
      void refresh()
    } finally {
      if (current === request.current) setLoading(false)
    }
  }
  function drop(event: DragEndEvent) {
    setDragPreview(null)
    if (!event.over || event.active.id === event.over.id) return
    const item = items.find((item) => item.id === event.active.id)
    if (!item) return
    if (selectedTag !== undefined) {
      const targetIndex = items.findIndex((item) => item.id === event.over?.id)
      if (targetIndex < 0 || loading) return
      const targetId = items[targetIndex].id
      const after = items.indexOf(item) < targetIndex
      void mutate(async () => {
        resultValue(await window.captured.taskWorkspace.reorderTagged({
          tags: [selectedTag], id: item.id, targetId, after
        }))
        setNotice('')
      }, items.length)
      return
    }
    const target = event.over.data.current as (Destination & { item?: TaskWorkspaceItem }) | undefined
    if (!target) return
    let beforeId: string | null | undefined
    if (target.item?.kind === 'task') {
      beforeId = target.item.id
      const group = items.filter(
        (card) =>
          card.horizon === target.horizon &&
          (target.categoryId === undefined || card.categoryId === target.categoryId)
      )
      if (
        group.some((card) => card.id === item.id) &&
        group.findIndex((card) => card.id === item.id) <
          group.findIndex((card) => card.id === target.item!.id) &&
        item.horizon === target.horizon
      )
        beforeId = group[group.findIndex((card) => card.id === target.item!.id) + 1]?.id ?? null
    }
    move(
      item,
      { ...target, beforeId },
      undefined,
      undefined
    )
  }
  function isCollapsed(key: string) {
    if (key === 'unplanned' && search) return false
    return (
      collapsed.includes(key) ||
      (compact && ['unplanned', 'later'].includes(key) && !expandedCompact.includes(key))
    )
  }
  function toggleCollapse(key: string) {
    if (compact && ['unplanned', 'later'].includes(key) && !collapsed.includes(key)) {
      setExpandedCompact((current) =>
        current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      )
      return
    }
    setCollapsed((current) => {
      const next = current.includes(key) ? current.filter((item) => item !== key) : [...current, key]
      remember('tasks-collapsed-v2', next)
      return next
    })
  }
  function tagPickerFor(item: TaskWorkspaceItem) {
    return (
      <TaskTagPicker
        tags={item.tags}
        suggestions={tags.map((tag) => tag.name)}
        label={item.body.split('\n')[0] || 'task'}
        disabled={busy}
        onSave={async (selectedTags) => {
          let saved = false
          await mutate(async () => {
            resultValue(await window.captured.items.setTags({ id: item.id, tags: selectedTags }))
            saved = true
          })
          return saved
        }}
      />
    )
  }
  function quickActionsFor(item: TaskWorkspaceItem, compact = false) {
    return <TaskQuickActions item={item} busy={busy} compact={compact} onComplete={() => complete(item)} onPlan={horizon => move(item, { horizon })} tagPicker={tagPickerFor(item)} />
  }
  function card(item: TaskWorkspaceItem, categoryId?: string | null) {
    return (
      <TaskCard
        key={item.id}
        item={item}
        categoryId={categoryId}
        tagColors={tagColors}
        subcategory={subcategoryMap.get(item.subcategoryId ?? '')}
        busy={busy}
        onPlan={(horizon) => move(item, { horizon })}
        tagPicker={tagPickerFor(item)}
        onOpen={() => setDetail(item)}
        onComplete={() => complete(item)}
      />
    )
  }
  function complete(item: TaskWorkspaceItem) {
    void mutate(async () => {
      setCompletionUndo(
        resultValue(
          await window.captured.taskWorkspace.complete({
            id: item.id,
            expectedRevision: item.revision,
            completed: item.completedAt === null
          })
        )
      )
      setNotice(item.completedAt === null ? 'Task completed.' : 'Task reopened.')
    })
  }
  function clearSearch() {
    setQuery('')
    setSearch('')
  }
  function section(horizon: Horizon, group: TaskWorkspaceItem[]) {
    return (
      <section className="tasks-section" aria-label={`${horizonLabels[horizon]} tasks`}>
        <SortableContext items={group.map((item) => item.id)} strategy={verticalListSortingStrategy}>
          {group.map((item) => card(item))}
        </SortableContext>
        {group.length === 0 && !dragPreview && <p className="tasks-section-empty">No tasks here</p>}
      </section>
    )
  }

  return (
    <section
      className={`tasks-page ${layout === 'table' ? 'tasks-table-page' : ''}`}
      aria-label="Tasks workspace"
      aria-busy={busy}
    >
      <header className="tasks-heading">
        <div>
          <h1>
            {title} <span className="title-count">{total}</span>
          </h1>
        </div>
        <div className="tasks-heading-actions">
          <button
            type="button"
            className="tasks-spotlight"
            aria-label="Show app in screen shares"
            aria-pressed={shareVisible}
            title={shareVisible ? 'Hide app from screen shares' : 'Show app in screen shares'}
            disabled={captureProtection === undefined || savingCaptureProtection}
            onClick={async () => {
              setSavingCaptureProtection(true)
              setCaptureProtectionError(false)
              try {
                const saved = await onCaptureProtectionChange(shareVisible)
                setCaptureProtectionError(!saved)
              } finally {
                setSavingCaptureProtection(false)
              }
            }}
          >
            <Spotlight size={20} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="tasks-add-task"
            disabled={busy || !taxonomyReady}
            onClick={() => setCreate({ horizon: 'unplanned' })}
          >
            <Plus size={16} /> Add task
          </button>
        </div>
      </header>
      {captureProtectionError && <p className="inline-error" role="alert">Could not change capture exclusion.</p>}
      <div className="tasks-toolbar">
        {!showTaggedList && (
          <div className="planner-view-switch tasks-layout-switch" aria-label="Task layout">
            <button
              type="button"
              aria-pressed={layout === 'time'}
              onClick={() => {
                setLayout('time')
                remember('tasks-layout-v1', 'time')
              }}
            >
              <Columns3 size={13} /> By priority
            </button>
            <button
              type="button"
              aria-pressed={layout === 'table'}
              onClick={() => {
                setLayout('table')
                remember('tasks-layout-v1', 'table')
              }}
            >
              <Table2 size={13} /> Table
            </button>
          </div>
        )}
        {hasSearch && (
          <button type="button" className="filter-clear" onClick={clearSearch}>Clear filters</button>
        )}
        <div className="tasks-toolbar-search">
          <label className="search-box tasks-search">
            <Search size={15} />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks…"
              aria-label="Search tasks"
              maxLength={500}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && query) {
                  event.stopPropagation()
                  setQuery('')
                  setSearch('')
                }
              }}
            />
            {query ? (
              <button type="button" aria-label="Clear search" onClick={() => { setQuery(''); setSearch(''); searchRef.current?.focus() }}>
                <X size={13} />
              </button>
            ) : <kbd>Ctrl F</kbd>}
          </label>
          <button
            type="button"
            className="tasks-done-filter"
            aria-pressed={completed}
            onClick={() => setCompleted((value) => !value)}
          >
            {completed ? 'Hide completed' : 'Show completed'}
          </button>
        </div>
      </div>
      {hasSearch && (
        <div className="tasks-active-filters" aria-label="Active task filters">
          <button type="button" onClick={clearSearch}>
            Search: {query.trim()} <X size={12} />
          </button>
        </div>
      )}
      {!pageChanged && !loading && !error && total === 0 && (
        <div className="tasks-empty-state" role="status">
          <CalendarDays size={24} strokeWidth={1.5} />
          <h2>
            {hasSearch
              ? 'No tasks match these filters'
              : completed
                ? 'No completed tasks yet'
                : 'No tasks yet'}
          </h2>
          <p>
            {hasSearch
              ? 'Try a different search or clear your filters.'
              : completed
                ? 'Completed tasks will appear here when you finish them.'
                : 'Capture a thought, then choose its priority.'}
          </p>
          {hasSearch ? (
            <button type="button" className="button secondary small" onClick={clearSearch}>
              Reset task filters
            </button>
          ) : completed ? (
            <button type="button" className="button secondary small" onClick={() => setCompleted(false)}>
              Show open tasks
            </button>
          ) : (
            <button
              type="button"
              className="button secondary small"
              onClick={() => setCreate({ horizon: 'unplanned' })}
            >
              Add your first task
            </button>
          )}
        </div>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
          <button type="button" onClick={() => void refresh()}>
            Refresh
          </button>
        </div>
      )}
      {notice && (
        <div
          className="tasks-notice"
          role="status"
          onMouseEnter={() => setNoticeHovered(true)}
          onMouseLeave={() => setNoticeHovered(false)}
          onFocus={() => setNoticeFocused(true)}
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setNoticeFocused(false)
          }}
        >
          <span>{notice}</span>
          {(undo || completionUndo) && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  if (completionUndo)
                    resultValue(await window.captured.taskWorkspace.undoCompletion(completionUndo))
                  else if (undo) resultValue(await window.captured.taskWorkspace.undo(undo))
                  setUndo(null)
                  setCompletionUndo(null)
                  setNotice('Change undone.')
                })
              }
            >
              <Undo2 size={13} /> Undo
            </button>
          )}
          <button type="button" aria-label="Dismiss task notice" onClick={() => {
            setNotice('')
            setUndo(null)
            setCompletionUndo(null)
            setNoticeHovered(false)
            setNoticeFocused(false)
          }}>
            <X size={13} />
          </button>
        </div>
      )}
      {!taxonomyReady || pageChanged || (loading && !items.length && !Object.keys(pages).length) ? (
        <div className="loading-state">
          <span className="spinner" /> Loading tasks…
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          // Only the task page should move; scrolling the document can displace the app shell.
          autoScroll={{ canScroll: (element) => element.classList.contains('tasks-page') }}
          collisionDetection={taskCollision}
          onDragStart={(event) => setDragPreview(copyDragSource(event))}
          onDragCancel={() => setDragPreview(null)}
          onDragEnd={drop}
        >
          {showFlatList ? (
            <section className="tasks-search-results" aria-label={search ? 'Task search results' : 'Tagged tasks'}>
              {search && (
                <p>
                  {total} {total === 1 ? 'result' : 'results'} ·{' '}
                  {completed ? 'Completed tasks' : 'Open tasks'}
                </p>
              )}
              <table className={`tasks-group-table${showTaggedList ? ' tasks-tagged-table' : ''}`} aria-label={search ? 'Search results' : 'Tagged tasks list'}>
                {showTaggedList && <colgroup><col /><col /><col /></colgroup>}
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Category and tags</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  <SortableContext items={items.map((item) => item.id)} strategy={verticalListSortingStrategy}>
                    {items.map((item) => (
                      <TaskTableRow
                        tagColors={tagColors}
                        actions={quickActionsFor(item, showTaggedList)}
                        key={item.id}
                        item={item}
                        flatList
                        tagged={showTaggedList}
                        subcategory={subcategoryMap.get(item.subcategoryId ?? '')}
                        busy={busy}
                        reorderDisabled={loading}
                        onOpen={() => setDetail(item)}
                      />
                    ))}
                  </SortableContext>
                </tbody>
              </table>
              {pages.unplanned?.nextCursor && (
                <button
                  type="button"
                  className="load-more"
                  disabled={loading || busy}
                  onClick={() => void loadMore('unplanned')}
                >
                  {search ? 'Load more results' : 'Load more tasks'}
                </button>
              )}
            </section>
          ) : layout === 'table' ? (
            <div className="tasks-table tasks-table-groups">
              {visibleHorizons.map((horizon) => (
                <TaskTableGroup
                  key={horizon}
                  dragging={!!dragPreview}
                  horizon={horizon}
                  count={counts[horizon]}
                  ids={taskItems.filter((item) => item.horizon === horizon).map((item) => item.id)}
                  onAdd={() => setCreate({ horizon })}
                >
                  {taskItems
                    .filter((item) => item.horizon === horizon)
                    .map((item) => (
                      <TaskTableRow
                        tagColors={tagColors}
                        actions={quickActionsFor(item)}
                        key={item.id}
                        item={item}
                        subcategory={subcategoryMap.get(item.subcategoryId ?? '')}
                        busy={busy}
                        onOpen={() => setDetail(item)}
                        />
                    ))}
                  {pages[horizon]?.nextCursor && (
                    <tr>
                      <td colSpan={3}>
                        <button
                          type="button"
                          className="load-more"
                          disabled={loading || busy}
                          onClick={() => void loadMore(horizon)}
                        >
                          Load more
                        </button>
                      </td>
                    </tr>
                  )}
                </TaskTableGroup>
              ))}
            </div>
          ) : (
            <>
              <div className={`tasks-board tasks-board-${layout} ${dragPreview ? 'is-dragging' : ''}`}>
                {visibleHorizons.map((horizon) => (
                  <HorizonColumn key={horizon} horizon={horizon} collapsed={isCollapsed(horizon)}>
                    <header className="tasks-column-heading">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(horizon)}
                        aria-expanded={!isCollapsed(horizon)}
                      >
                        <b>{horizonLabels[horizon]}</b>
                        <span>{counts[horizon]}</span>
                      </button>
                      {!(horizon === 'unplanned' && !!search ? false : isCollapsed(horizon)) &&
                        (
                          <button
                            type="button"
                            aria-label={`Add task to ${horizonLabels[horizon]}`}
                            onClick={() => setCreate({ horizon })}
                          >
                            <Plus size={14} />
                          </button>
                        )}
                    </header>
                    {!isCollapsed(horizon) && (
                      <div className="tasks-column-content">
                        {section(
                          horizon,
                          taskItems.filter((item) => item.horizon === horizon)
                        )}
                        {pages[horizon]?.nextCursor && (
                          <button
                            type="button"
                            className="load-more"
                            disabled={loading || busy}
                            onClick={() => void loadMore(horizon)}
                          >
                            Load more · {counts[horizon] - (pages[horizon]?.items.length ?? 0)} remaining
                          </button>
                        )}
                      </div>
                    )}
                  </HorizonColumn>
                ))}
              </div>
            </>
          )}
          <DragOverlay dropAnimation={null} modifiers={layout === 'table' || showTaggedList ? [alignRowPreview] : undefined}>
            {dragPreview && (
              <div
                className={`tasks-drag-preview ${layout === 'table' || showTaggedList ? 'tasks-drag-table' : 'tasks-board tasks-drag-board'}`}
                aria-hidden="true"
                inert
                ref={(node) => node?.replaceChildren(dragPreview)}
              />
            )}
          </DragOverlay>
        </DndContext>
      )}
      {detail && (
        <ItemDetailDialog
          key={detail.id}
          task={detail}
          showPlanning
          initialTags={detail.tags}
          suggestions={tags.map((tag) => tag.name)}
          onClose={() => setDetail(null)}
          onChanged={() => {
            setDetail(null)
            void refresh()
          }}
        />
      )}
      {create && (
        <CreateTaskDialog
          error={error}
          categories={categories}
          subcategories={subcategories}
          tags={tags}
          destination={{
            ...create,
            categoryId:
              create.categoryId === undefined
                ? category ?? null
                : create.categoryId
          }}
          today={today}
          initialSubcategoryId={create.categoryId === undefined || create.categoryId === category ? subcategory || null : null}
          onClose={() => setCreate(null)}
          onSave={async (input) => {
            await mutate(async () => {
              resultValue(
                await window.captured.taskWorkspace.create(input)
              )
              setCreate(null)
              setUndo(null)
              setNotice('Task added.')
            })
          }}
        />
      )}
    </section>
  )
}

function copyDragSource({ activatorEvent }: DragStartEvent): HTMLElement | null {
  const handle = activatorEvent.target
  const source = handle instanceof Element ? handle.closest<HTMLElement>('[data-task-id]') : null
  if (!source) return null

  // Copy the rendered row or card so the preview uses its exact typography and controls.
  const copy = source.cloneNode(true) as HTMLElement
  copy.removeAttribute('data-task-id')
  copy.removeAttribute('style')
  copy.classList.remove('is-dragging', 'drop-before', 'drop-after')
  copy.querySelectorAll('[id]').forEach((element) => element.removeAttribute('id'))

  if (!(source instanceof HTMLTableRowElement)) {
    copy.style.minHeight = `${source.offsetHeight}px`
    return copy
  }

  const table = document.createElement('table')
  table.className = source.closest('table')?.className ?? 'tasks-group-table'
  table.style.width = `${source.getBoundingClientRect().width}px`
  const columns = table.appendChild(document.createElement('colgroup'))
  for (const cell of source.cells) {
    const column = columns.appendChild(document.createElement('col'))
    column.style.width = `${cell.getBoundingClientRect().width}px`
  }
  table.createTBody().appendChild(copy)
  return table
}

function TaskTableGroup({
  horizon,
  dragging,
  count,
  ids,
  children,
  onAdd
}: {
  horizon: Horizon
  dragging: boolean
  count: number
  ids: string[]
  children: React.ReactNode
  onAdd: () => void
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `section:table:${horizon}`,
    data: { horizon },
    disabled: false
  })
  return (
    <section
      ref={setNodeRef}
      data-priority={horizon}
      className={`backlog-group tasks-table-panel ${dragging ? 'is-dropzone' : ''} ${isOver ? 'is-over' : ''}`}
      aria-label={`${horizonLabels[horizon]} tasks`}
    >
      <header className="backlog-group-heading">
        <CalendarDays size={16} />
        <b>{horizonLabels[horizon]}</b>
        <span>{count}</span>
        {(
          <button
            type="button"
            className="backlog-category-add"
            aria-label={`Add task to ${horizonLabels[horizon]}`}
            onClick={onAdd}
          >
            <Plus size={15} />
          </button>
        )}
      </header>
      <table className="tasks-group-table" aria-label={`${horizonLabels[horizon]} task table`}>
        <colgroup>
          <col />
          <col />
          <col />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Category and tags</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody data-horizon={horizon}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            {children}
          </SortableContext>
          {!count && (
            <tr className="tasks-table-empty">
              <td colSpan={3}>
                <span className="tasks-section-empty">No tasks here</span>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function TaskTableRow({
  tagColors,
  actions,
  flatList = false,
  tagged = false,
  reorderDisabled = false,
  item,
  subcategory,
  busy,
  onOpen
}: {
  tagColors: Map<string, string>
  flatList?: boolean
  tagged?: boolean
  reorderDisabled?: boolean
  actions?: React.ReactNode
  backlog?: boolean
  item: TaskWorkspaceItem
  subcategory?: Subcategory
  busy: boolean
  onOpen: () => void
}) {
  const canReorder = tagged || (!flatList && item.completedAt === null)
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging, isOver, activeIndex, index } =
    useSortable({
      id: item.id,
      data: { horizon: item.horizon, item },
      disabled: !canReorder || busy || reorderDisabled
    })
  return (
    <tr
      ref={setNodeRef}
      data-task-id={item.id}
      className={`${item.completedAt !== null ? 'is-completed' : ''} ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? (activeIndex >= 0 && activeIndex < index ? 'drop-after' : 'drop-before') : ''}`}
      style={{ transform: isDragging ? undefined : CSS.Transform.toString(transform), transition }}
    >
      <td>
        <div className="tasks-table-task">
          {(tagged || !flatList) && (
            <button
              type="button"
              className="tasks-drag-handle backlog-drag-handle"
              ref={setActivatorNodeRef}
              aria-label={`${tagged ? 'Reorder' : 'Move'} ${item.body.split('\n')[0] || 'task'}`}
              disabled={!canReorder || busy || reorderDisabled}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={15} />
            </button>
          )}
          <div role="button" tabIndex={busy ? -1 : 0} className="backlog-task-title" title={item.body.trim() || 'Image capture'} aria-disabled={busy} onClick={() => { if (!busy) onOpen() }} onKeyDown={(event) => { if (!busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen() } }}>
            {item.body.trim() || 'Image capture'}
          </div>
          <ImageIndicator count={item.images.length} />
          <ScheduledIndicator item={item} />
        </div>
        {flatList && !tagged && (
          <span className={`task-search-status ${item.completedAt !== null ? 'is-completed' : ''}`}>
            {item.completedAt !== null ? 'Completed' : 'Open'}
          </span>
        )}
      </td>
      <td>
        <div className="tasks-table-metadata">
          {subcategory && (
            <span className="tasks-subcategory-label" title={subcategory.name} style={{ color: subcategory.color }}>
              {subcategory.name}
            </span>
          )}
          {item.tags.length > 0 && (
            <span className="tasks-category-tags" title={item.tags.map(tag => `#${tag}`).join(' ')}>
              {item.tags.map(tag => (
                <span className="tasks-table-tag" key={tag} style={{ color: tagColors.get(tag.toLocaleLowerCase()) }}>
                  #{tag.replace(/^#+/, '')}
                </span>
              ))}
            </span>
          )}
        </div>
      </td>
      <td className="tasks-table-tags">{actions}</td>
    </tr>
  )
}

function HorizonColumn({
  horizon,
  collapsed,
  children
}: {
  horizon: Horizon
  collapsed: boolean
  children: React.ReactNode
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `column:${horizon}`, data: { horizon } })
  return (
    <div
      ref={setNodeRef}
      data-horizon={horizon}
      className={`tasks-column ${horizon === 'now' ? 'is-today' : ''} ${collapsed ? 'is-collapsed' : ''} ${isOver ? 'is-over' : ''}`}
    >
      {children}
    </div>
  )
}

function TaskCard({
  tagColors,
  item,
  subcategory,
  busy,
  categoryId,
  onPlan,
  tagPicker,
  onOpen,
  onComplete
}: {
  tagColors: Map<string, string>
  item: TaskWorkspaceItem
  subcategory?: Subcategory
  busy: boolean
  categoryId?: string | null
  tagPicker?: React.ReactNode
  onPlan?: (horizon: Horizon) => void
  onOpen: () => void
  onComplete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging, isOver, activeIndex, index } =
    useSortable({
      id: item.id,
      data: { horizon: item.horizon, categoryId, item },
      disabled: busy || item.completedAt !== null
    })
  return (
    <article
      ref={setNodeRef}
      data-task-id={item.id}
      style={{ transform: isDragging ? undefined : CSS.Transform.toString(transform), transition }}
      className={`tasks-card ${isDragging ? 'is-dragging' : ''} ${isOver && !isDragging ? (activeIndex >= 0 && activeIndex < index ? 'drop-after' : 'drop-before') : ''}`}
    >
      <div className="tasks-card-heading">
        <button
          type="button"
          className="tasks-drag-handle"
          aria-label={`Move ${item.body.split('\n')[0] || 'capture'}`}
          disabled={busy || item.completedAt !== null}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={13} />
        </button>
        <div role="button" tabIndex={busy ? -1 : 0} className="tasks-card-body" title={item.body.trim() || 'Untitled task'} aria-disabled={busy} onClick={() => { if (!busy) onOpen() }} onKeyDown={(event) => { if (!busy && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen() } }}>
          {item.body.trim() || (item.images.length ? 'Image capture' : 'Untitled task')}
        </div>
        <ScheduledIndicator item={item} />
      </div>
      <div className="tasks-inline-meta">
        <div className="tasks-card-meta">
          {subcategory && <span className="tasks-subcategory-label" title={subcategory.name} style={{ color: subcategory.color }}>{subcategory.name}</span>}
          <ImageIndicator count={item.images.length} />
          {!!item.tags.length && (
            <div className="tasks-card-tags" title={item.tags.map(tag => `#${tag}`).join(' ')}>
              {item.tags.map(tag => <span key={tag} style={{ color: tagColors.get(tag.toLocaleLowerCase()) }}>#{tag.replace(/^#+/, '')}</span>)}
            </div>
          )}
        </div>
        {onPlan && <TaskQuickActions item={item} busy={busy} onPlan={onPlan} onComplete={onComplete} tagPicker={tagPicker} />}
      </div>

    </article>
  )
}

function TaskQuickActions({ item, busy, compact = false, onPlan, onComplete, tagPicker }: {
  item: TaskWorkspaceItem
  busy: boolean
  compact?: boolean
  onComplete: () => void
  onPlan: (horizon: Horizon) => void
  tagPicker?: React.ReactNode
}) {
  const label = item.body.split('\n')[0] || 'task'
  const destinations = item.completedAt === null ? horizons.filter(horizon => horizon !== 'unplanned' && horizon !== item.horizon) : []
  return (
    <div className="tasks-quick-actions">
      <div className="tasks-quick-buttons" role="group" aria-label={`Quick actions for ${label}`}>
        {compact ? destinations.length > 0 && (
          <AppSelect aria-label={`Plan ${label}`} value="" disabled={busy} onChange={event => onPlan(event.target.value as Horizon)}>
            <option value="" disabled>Plan</option>
            {destinations.map(horizon => <option key={horizon} value={horizon}>{horizonLabels[horizon]}</option>)}
          </AppSelect>
        ) : <div className="tasks-priority-buttons">
        {destinations.map(horizon => (
          <button key={horizon} type="button" disabled={busy} title={`Move to ${horizonLabels[horizon]}`} aria-label={`Move ${label} to ${horizonLabels[horizon]}`} onClick={() => onPlan(horizon)}>{horizonLabels[horizon]}</button>
        ))}
        </div>}
        <button
          type="button"
          className="tasks-done-action"
          disabled={busy}
          aria-label={`${item.completedAt !== null ? 'Reopen' : 'Complete'} ${label}`}
          onClick={onComplete}
        >
          <Check size={12} /> {item.completedAt !== null ? 'Reopen' : 'Done'}
        </button>
        {tagPicker}
      </div>
    </div>
  )
}

function ScheduledIndicator({ item }: { item: TaskWorkspaceItem }) {
  if (item.plannedStartAt == null) return null
  const label = `Scheduled ${new Date(item.plannedStartAt).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  })}`
  return <span className="tasks-schedule-indicator" title={label} aria-label={label}><CalendarDays size={13} /></span>
}

function Modal({
  title,
  children,
  onClose
}: {
  title: string
  children: React.ReactNode
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null),
    previous = useRef(document.activeElement)
  useEffect(() => {
    const background: { element: HTMLElement; inert: boolean }[] = []
    let layer = ref.current?.parentElement
    while (layer && layer !== document.body) {
      for (const sibling of Array.from(layer.parentElement?.children ?? [])) {
        if (sibling instanceof HTMLElement && sibling !== layer) {
          background.push({ element: sibling, inert: sibling.inert })
          sibling.inert = true
        }
      }
      layer = layer.parentElement
    }
    return () => {
      background.forEach(({ element, inert }) => {
        element.inert = inert
      })
      if (previous.current instanceof HTMLElement) previous.current.focus()
    }
  }, [])
  return (
    <div className="modal-backdrop">
      <div
        ref={ref}
        className="dialog-card tasks-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            onClose()
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(ref.current?.querySelectorAll<HTMLElement>(
                '[contenteditable="true"],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled)'
              ) ?? [])
            ]
            if (event.shiftKey && document.activeElement === controls[0]) {
              event.preventDefault()
              controls.at(-1)?.focus()
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
              event.preventDefault()
              controls[0]?.focus()
            }
          }
        }}
      >
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  )
}
function CreateTaskDialog({
  error,
  categories,
  subcategories,
  tags,
  destination,
  today,
  initialSubcategoryId,
  onClose,
  onSave
}: {
  error: string
  categories: Category[]
  subcategories: Subcategory[]
  tags: TagRecord[]
  destination: TaskCreationDestination
  today: string
  initialSubcategoryId: string | null
  onClose: () => void
  onSave: (input: TaskWorkspaceCreate) => Promise<void>
}) {
  const [description, setDescription] = useState<TaskDescription>({ body: '' }),
    [category, setCategory] = useState(destination.categoryId ?? '')
  const [subcategoryId, setSubcategoryId] = useState(initialSubcategoryId),
    [labels, setLabels] = useState<string[]>([])
  const [horizon, setHorizon] = useState<Horizon>(
    destination.horizon
  )
  const [busy, setBusy] = useState(false)
  const [descriptionError, setDescriptionError] = useState('')
  const imageEdit = useImagePaste(setDescriptionError)
  const hasContent = Boolean(description.body.trim() || imageEdit.images.length)
  return (
    <Modal
      title="Add task"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (busy || imageEdit.isPending() || !hasContent) return
          if (description.body.length > 50_000 || (description.bodyHtml?.length ?? 0) > 600_000) {
            setDescriptionError('Shorten the task description before saving.')
            return
          }
          setBusy(true)
          setDescriptionError('')
          void onSave({
            ...description,
            categoryId: category || null,
            intention: intentionFor(horizon, today),
            subcategoryId,
            tags: collectTags(labels),
            images: imageEdit.images
          }).finally(() => setBusy(false))
        }}
      >
        <TaskDescriptionField label="Task" accessibleName="Task text" value={description} onChange={setDescription} images={imageEdit} disabled={busy} />
        <CategoryPicker
          categories={categories}
          subcategories={subcategories}
          categoryId={category || null}
          subcategoryId={subcategoryId}
          disabled={busy}
          onChange={(selected, sub) => {
            setCategory(selected ?? '')
            setSubcategoryId(sub)
          }}
        />
        <TagEditor
          tags={labels}
          onTagsChange={setLabels}
          suggestions={tags.map((tag) => tag.name)}
          disabled={busy}
        />
        <label>
          Priority
          <AppSelect
            aria-label="Task priority"
            value={horizon}
            disabled={busy}
            onChange={(event) => setHorizon(event.target.value as Horizon)}
          >
            {horizons
              .map((h) => (
                <option key={h} value={h}>
                  {horizonLabels[h]}
                </option>
              ))}
          </AppSelect>
        </label>
        {(descriptionError || error) && (
          <div className="inline-error" role="alert">
            {descriptionError || error}
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="button primary" disabled={!hasContent || busy || imageEdit.pending}>
            {busy ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
