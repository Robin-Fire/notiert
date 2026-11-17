import { LinkedText } from '../components/LinkedText'
import { SettingsPanel } from '../settings/SettingsPanel'
import { useTaxonomy } from '../components/useTaxonomy'
import { horizonOf, horizonLabels } from '../../shared/taskHorizons'
import { TagFilter } from '../components/TagFilter'
import { ItemDetailDialog } from '../components/ItemDetailDialog'
import { AppSidebar, type ViewName } from '../components/AppSidebar'
import { TaxonomyNav } from '../components/TaxonomyNav'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Info,
  Search,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import type {
  ItemRecord,
  ItemFilter,
  ItemPage,
  Settings,
  SettingsUpdate
} from '../../shared/contracts'
import { localDateBounds, toLocalISODate } from '../../shared/plannerDates'
import { collectTags, TagEditor } from '../components/TagEditor'
import { ImageIndicator, ItemImages } from '../components/ItemImages'
import { resultValue } from '../apiResult'

const CalendarView = lazy(() =>
  import('../calenban/CalendarView').then((module) => ({ default: module.CalendarView }))
)
const TasksView = lazy(() => import('../tasks/TasksView').then((module) => ({ default: module.TasksView })))

type ItemDetail = ItemRecord & { meetingTitle: string | null }
const dateOptions = [
  { value: 'all', label: 'All time' },
  { value: 'today', label: 'Today' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'custom', label: 'Custom' }
]
const isTextEntry = (element: EventTarget | null) =>
  element instanceof HTMLElement &&
  (element.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName))
const todayISO = () => toLocalISODate(new Date())
const startOfLocalDay = (iso: string) => localDateBounds(iso).start
const endOfLocalDay = (iso: string) => localDateBounds(iso).end
const sixDaysAgo = () => {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - 6)
  return date.getTime()
}
const formatTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(value)
const formatDateTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)
function itemDateLabel(value: number) {
  const date = new Date(value),
    now = new Date()
  if (date.toDateString() === now.toDateString()) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(date)
}
function excerpt(body: string) {
  return body.replace(/\s+/g, ' ').trim() || 'Untitled task'
}

export function TaskApp({ initialView = 'tasks' }: { initialView?: ViewName } = {}) {
  const [view, setView] = useState<ViewName>(initialView)
  const [items, setNotes] = useState<ItemDetail[]>([])
  const [total, setTotal] = useState(0)
  const [cursor, setCursor] = useState<ItemPage['nextCursor']>(null)
  const [query, setQuery] = useState('')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskPage, setTaskPage] = useState<string | null>(null)

  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [dateRange, setDateRange] = useState('all')
  const [tagFilters, setTagFilters] = useState<string[]>([])
  const [showCompleted, setShowCompleted] = useState(false)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [excludedTags, setExcludedTags] = useState<string[]>([])
  const activeFilterCount =
    tagFilters.length + excludedTags.length + (dateRange === 'all' ? 0 : 1)
  const {
    tags: tagRecords,
    ready: taxonomyLoaded,
    error: taxonomyError,
    refresh: loadTags
  } = useTaxonomy()
  const taskTag = tagRecords.find((tag) => tag.id === taskPage)

  const availableTags = useMemo(() => tagRecords.map((tag) => tag.name), [tagRecords])
  const [selectedTagId, setSelectedTagId] = useState<string | null>(null)
  const [customFrom, setCustomFrom] = useState(todayISO())
  const [customTo, setCustomTo] = useState(todayISO())
  const [detailId, setDetailId] = useState<string | null>(null)
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [editItem, setEditItem] = useState<ItemDetail | null>(null)
  const [detail, setDetail] = useState<ItemDetail | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [selectionMode, setSelectionMode] = useState(false)
  useEffect(() => {
    setSelectionMode(false)
    setSelected([])
  }, [view, selectedTagId])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [displays, setDisplays] = useState<{ id: number; label: string; primary: boolean }[]>([])
  const requestLeaveRef = useRef<(action: () => void) => void>(() => {})
  const [loading, setLoading] = useState(true)
  const itemsRequest = useRef(0)
  const detailRequest = useRef(0)
  const activeDetailId = useRef(detailId)
  activeDetailId.current = detailId
  const [error, setError] = useState('')
  const [toast, setToast] = useState('')
  const [browserCaptureOpen, setBrowserCaptureOpen] = useState(false)
  const [browserCaptureText, setBrowserCaptureText] = useState('')
  const [browserCaptureTags, setBrowserCaptureTags] = useState<string[]>([])
  const [recordingShortcut, setRecordingShortcut] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<{ status: string; version?: string }>({ status: 'idle' })
  const [firstRun, setFirstRun] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const itemListRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 150)
    return () => clearTimeout(timer)
  }, [query])

  const loadSettings = useCallback(async () => {
    try {
      const [loaded, screens] = await Promise.all([
        window.captured.settings.get(),
        window.captured.settings.displays()
      ])
      const nextSettings = resultValue(loaded)
      setSettings(nextSettings)
      setDisplays(resultValue(screens))
      setFirstRun(!nextSettings.firstRunComplete)
      document.documentElement.dataset.theme = nextSettings.theme
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Settings are unavailable.')
    }
  }, [])

  const selectedTagName = tagRecords.find((tag) => tag.id === selectedTagId)?.name
  const filter = useMemo<ItemFilter>(() => {
    let dateFrom: number | undefined, dateTo: number | undefined
    if (dateRange === 'today') {
      const today = todayISO()
      dateFrom = startOfLocalDay(today)
      dateTo = endOfLocalDay(today)
    }
    if (dateRange === 'last7') {
      dateFrom = sixDaysAgo()
      dateTo = endOfLocalDay(todayISO())
    }
    if (dateRange === 'custom') {
      dateFrom = startOfLocalDay(customFrom)
      dateTo = endOfLocalDay(customTo)
    }
    const scope = view === 'trash' ? 'trash' : 'items'
    return {
      query: debouncedQuery,
      scope,
      dateFrom,
      dateTo,
      kinds: ['task'],
      excludedTags: excludedTags.length ? excludedTags : undefined,
      tags:
        view === 'tag' ? [selectedTagName ?? '__missing_tag__'] : tagFilters.length ? tagFilters : undefined,
      includeCompleted: scope === 'items' && showCompleted,
      limit: 50,
      sort: 'newest'
    }
  }, [
    dateRange,
    customFrom,
    customTo,
    debouncedQuery,
    tagFilters,
    excludedTags,
    selectedTagName,
    showCompleted,
    view
  ])
  const activeFilter = useRef(filter)
  activeFilter.current = filter

  const loadItems = useCallback(
    async (nextCursor?: ItemPage['nextCursor'], append = false) => {
      if (!['all', 'trash', 'tag'].includes(view)) return
      if (activeFilter.current !== filter) return
      const request = ++itemsRequest.current
      setLoading(true)
      setError('')
      try {
        const page = resultValue(
          await window.captured.items.list({ ...filter, cursor: nextCursor ?? undefined })
        )
        if (request !== itemsRequest.current || activeFilter.current !== filter) return
        setNotes((current) => (append ? [...current, ...page.items] : page.items))
        setTotal(page.total)
        setCursor(page.nextCursor)
      } catch (reason) {
        if (request === itemsRequest.current && activeFilter.current === filter)
          setError(reason instanceof Error ? reason.message : 'Tasks could not be loaded.')
      } finally {
        if (request === itemsRequest.current && activeFilter.current === filter) setLoading(false)
      }
    },
    [filter, view]
  )

  useEffect(() => {
    void loadItems()
    setSelected([])
    return () => {
      itemsRequest.current++
    }
  }, [loadItems])
  useEffect(
    () => () => {
      detailRequest.current++
    },
    []
  )
  useEffect(() => {
    void loadSettings()
  }, [loadSettings])
  useEffect(
    () =>
      window.captured.items.onChanged(() => {
        void loadItems()
      }),
    [loadItems]
  )
  useEffect(() => {
    if (settings?.showCalendar === false && view === 'calenban') setView('tasks')
  }, [settings?.showCalendar, view])
  useEffect(
    () =>
      window.captured.settings.onChanged(() => {
        void loadSettings()
      }),
    [loadSettings]
  )
  useEffect(() => {
    void window.captured.updates.getStatus().then((result) => {
      if (result.ok) setUpdateStatus(result.value)
    })
    return window.captured.updates.onChanged(setUpdateStatus)
  }, [])
  useEffect(() => {
    const unsubscribe = window.captured.windows.onView((next) =>
      requestLeaveRef.current(() => {
        setView(next === 'all' ? 'tasks' : next)
        setDetailId(null)
        setDetail(null)
        setSelected([])
        document.documentElement.dataset.windowReady = 'true'
      })
    )
    window.captured.windows.ready()
    return unsubscribe
  }, [])
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === 'f' &&
        (view === 'all' || view === 'trash' || view === 'tag') &&
        !(event.target instanceof HTMLElement && event.target.closest('[role="dialog"]'))
      ) {
        event.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (view !== 'all' && view !== 'trash' && view !== 'tag') return
      if (isTextEntry(event.target)) return
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button, a, [role="button"], [role="dialog"]') &&
        !((event.key === 'ArrowDown' || event.key === 'ArrowUp') && event.target.closest('.item-row-open'))
      )
        return
      if (event.key === 'Delete' && selected.length) {
        event.preventDefault()
        void trashSelected()
      }
      if (event.key === 'Escape' && detailId && window.innerWidth < 960) {
        setDetailId(null)
        setDetail(null)
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        const currentId = focusedId ?? detailId
        const index = items.findIndex((item) => item.id === currentId)
        const next =
          items[Math.max(0, Math.min(items.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        if (next) {
          event.preventDefault()
          setFocusedId(next.id)
          itemListRef.current
            ?.querySelector<HTMLButtonElement>(`[data-item-id="${next.id}"] .item-row-open`)
            ?.focus()
        }
      }
      if (event.key === 'Enter') {
        const selectedNote = items.find((item) => item.id === focusedId) ?? (!detailId ? items[0] : undefined)
        if (selectedNote) {
          event.preventDefault()
          requestLeaveRef.current(() => void openItem(selectedNote.id))
        }
      }
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  })

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(''), 2600)
    return () => clearTimeout(timer)
  }, [toast])
  useEffect(() => {
    const open = (event: Event) => {
      const context = (event as CustomEvent).detail as
        | { tags?: string[] }
        | undefined
      if (context && !browserCaptureText.trim()) {
        setBrowserCaptureTags(context.tags ?? [])
      }
      setBrowserCaptureOpen(true)
    }
    window.addEventListener('captured:browser-capture', open)
    return () => window.removeEventListener('captured:browser-capture', open)
  }, [browserCaptureText])

  async function submitBrowserCapture() {
    if (!browserCaptureText.trim()) return
    try {
      resultValue(
        await window.captured.capture.submit({
          requestId: crypto.randomUUID(),
          generation: 0,
          body: browserCaptureText,
          captureKind: 'task',
          tags: collectTags(browserCaptureTags)
        })
      )
      setBrowserCaptureText('')
      setBrowserCaptureTags([])
      setBrowserCaptureOpen(false)
      nav('inbox')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Capture could not be saved.')
    }
  }

  async function openItem(id: string) {
    const request = ++detailRequest.current
    activeDetailId.current = id
    const useModal = view === 'all' || view === 'tag'
    if (!useModal) setDetailId(id)
    setDetail(null)
    try {
      const record = resultValue(await window.captured.items.get(id))
      if (request !== detailRequest.current || (!useModal && activeDetailId.current !== id)) return
      if (useModal && record) {
        setEditItem(record)
        setDetailId(null)
        setDetail(null)
      } else setDetail(record)
    } catch (reason) {
      if (request === detailRequest.current && (useModal || activeDetailId.current === id))
        setError(reason instanceof Error ? reason.message : 'This task could not be opened.')
    }
  }
  function clearFilters() {
    setQuery('')
    setDateRange('all')
    setTagFilters([])
    setExcludedTags([])
  }
  function nav(next: ViewName) {
    requestLeaveRef.current(() => {
      setSelectedTagId(null)
      setView(next)
      setShowCompleted(false)
      setDetailId(null)
      setFocusedId(null)
      setDetail(null)
      setSelected([])
      clearFilters()
    })
  }
  const selectedTag = tagRecords.find((tag) => tag.id === selectedTagId) ?? null
  async function setTaskCompleted(id: string, completed: boolean): Promise<boolean> {
    try {
      resultValue(await window.captured.planner.setTaskCompleted({ id, completed }))
      setError('')
      setToast(completed ? 'To-do marked done' : 'Task reopened')
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'To-do status could not be changed.')
      return false
    }
  }
  async function toggleDetailCompletion() {
    if (detail && (await setTaskCompleted(detail.id, detail.completedAt == null))) {
      setDetailId(null)
      setDetail(null)
    }
  }
  async function trashSelected() {
    if (!selected.length) return
    try {
      resultValue(await window.captured.items.trash(selected))
      setSelected([])
      setDetailId(null)
      setDetail(null)
      setToast(`${selected.length} ${selected.length === 1 ? 'item moved' : 'items moved'} to Trash`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Notes could not be moved to Trash.')
    }
  }
  async function copyIds(ids: string[]) {
    try {
      const text = resultValue(await window.captured.items.copy(ids))
      setToast(text ? 'Copied to clipboard' : 'Nothing to copy')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not copy tasks.')
    }
  }

  const toggleSelected = (id: string) => {
    if (!selected.includes(id) && selected.length >= 500) {
      setToast('Select up to 500 tasks at a time')
      return
    }
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    )
  }
  async function restoreOne(id: string) {
    try {
      resultValue(await window.captured.items.restore([id]))
      setToast('ItemRecord restored')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not restore item.')
    }
  }
  async function deleteOne(id: string) {
    try {
      resultValue(await window.captured.items.deletePermanently([id]))
      setToast('ItemRecord deleted permanently')
      setDetailId(null)
      setDetail(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not delete item.')
    }
  }
  async function emptyTrash() {
    try {
      resultValue(await window.captured.items.emptyTrash())
      setToast('Trash emptied')
      setDetailId(null)
      setDetail(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not empty Trash.')
    }
  }

  const saveSettings = async (update: SettingsUpdate) => {
    try {
      const saved = resultValue(await window.captured.settings.update(update))
      setSettings(saved)
      document.documentElement.dataset.theme = saved.theme
      return true
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Setting could not be saved.')
      return false
    }
  }
  const finishFirstRun = async (shortcut: string, launchAtLogin: boolean) => {
    const done = await saveSettings({
      shortcut,
      shortcutEnabled: true,
      launchAtLogin,
      firstRunComplete: true
    })
    if (done) {
      setFirstRun(false)
      setToast('Setup complete')
      window.captured.windows.openCapture()
    }
  }
  const continueTrayOnly = async (launchAtLogin: boolean) => {
    const done = await saveSettings({ shortcutEnabled: false, launchAtLogin, firstRunComplete: true })
    if (done) setFirstRun(false)
  }

  const renderRows = () => {
    const hasFilters = !!(
      excludedTags.length ||
      debouncedQuery ||
      (view !== 'tag' && tagFilters.length) ||
      dateRange !== 'all'
    )
    if (!items.length && !loading && !error)
      return (
        <div className="empty-state">
          <div className="empty-mark">
            <FileText size={20} />
          </div>
          <h2>
            {view === 'tag' && !hasFilters
              ? 'No items with this tag yet.'
                : hasFilters
                  ? 'No matching items.'
                  : view === 'trash'
                    ? 'Trash is empty.'
                    : 'Your next thought goes here.'}
          </h2>
          <p>
            {hasFilters
              ? 'Try another phrase or clear the filters.'
              : view === 'tag'
                ? 'Items using this tag will appear here.'
                  : view === 'trash'
                    ? 'Deleted items stay here until you remove them permanently.'
                    : `Press ${settings?.shortcut.replace('Control', 'Ctrl') ?? 'Ctrl+N'} from any app to capture an item.`}
          </p>
          {hasFilters ? (
            <button className="button secondary" onClick={() => requestEditorLeave(clearFilters)}>
              Clear filters
            </button>
          ) : (
            view === 'tag' ? (
              <button className="button secondary" onClick={() => nav('tasks')}>
                Go to tasks <ArrowRight size={15} />
              </button>
            ) : view === 'all' && (
              <button className="button primary" onClick={() => window.captured.windows.openCapture()}>
                Capture a thought <ArrowRight size={15} />
              </button>
            )
          )}
        </div>
      )
    const renderRow = (item: ItemDetail) => (
      <article
        key={item.id}
        data-item-id={item.id}
        className={`item-row ${item.completedAt != null ? 'is-completed' : ''} ${detailId === item.id || focusedId === item.id ? 'is-active' : ''} ${selected.includes(item.id) ? 'is-selected' : ''}`}
      >
        {selectionMode ? (
          <input
            className="row-select"
            type="checkbox"
            aria-label="Select item"
            checked={selected.includes(item.id)}
            onChange={() => toggleSelected(item.id)}
          />
        ) : (
          item.kind === 'task' && (
            <input
              className="item-completion-toggle"
              type="checkbox"
              aria-label={`${item.completedAt != null ? 'Reopen' : 'Mark as done'} task: ${item.body.trim() ? excerpt(item.body).slice(0, 80) : 'without a title'}`}
              checked={item.completedAt != null}
              onChange={(event) => void setTaskCompleted(item.id, event.target.checked)}
            />
          )
        )}
        <button
          className="item-row-open"
          aria-label={`Open task ${item.body.trim() ? excerpt(item.body).slice(0, 80) : item.images.length ? 'Image capture' : 'Untitled task'}`}
          onClick={() => requestEditorLeave(() => void openItem(item.id))}
          onFocus={() => setFocusedId(item.id)}
        >
          <span className="item-preview">
            {item.body.trim() ? excerpt(item.body) : item.images.length ? 'Image capture' : 'Untitled task'}
          </span>
          <span className="item-meta">
            <time>{formatTime(view === 'trash' ? (item.deletedAt ?? item.createdAt) : item.createdAt)}</time>
            {item.completedAt != null && <span className="item-completed-chip">Done</span>}
            {item.kind === 'task' && item.intention && (
              <span className="item-completed-chip">
                {horizonLabels[horizonOf(item.intention, toLocalISODate(new Date()))]}
              </span>
            )}
            <ImageIndicator count={item.images.length} />
            {item.tags.map((tag) => (
              <span
                className="item-tag-chip"
                key={tag}
                style={{
                  color: tagRecords.find(
                    (record) => record.name.toLocaleLowerCase() === tag.toLocaleLowerCase()
                  )?.color
                }}
              >
                {tag}
              </span>
            ))}
          </span>
        </button>
      </article>
    )

    const groups = new Map<string, ItemDetail[]>()
    for (const item of items) {
      const label = itemDateLabel(view === 'trash' ? (item.deletedAt ?? item.createdAt) : item.createdAt)
      groups.set(label, [...(groups.get(label) ?? []), item])
    }
    const rows = view === 'tag' ? items.map((item) => renderRow(item)) : [...groups.entries()].map(([label, items]) => (
      <section className="date-group" key={label}>
        <div className="date-label">{label}</div>
        {items.map((item) => renderRow(item))}
      </section>
    ))
    return (
      <>
        {rows}
        {cursor && (
          <button className="load-more" onClick={() => void loadItems(cursor, true)} disabled={loading}>
            Load more <ChevronDown size={14} />
          </button>
        )}
      </>
    )
  }

  useEffect(() => {
    if (!taxonomyLoaded) return
    if (view === 'tag' && selectedTagId && !tagRecords.some((item) => item.id === selectedTagId)) {
      setView('tasks')
      setSelectedTagId(null)
    }

  }, [taxonomyLoaded, tagRecords, view, selectedTagId])

  const requestEditorLeave = (action: () => void) => {
    if (!editItem) action()
  }
  requestLeaveRef.current = requestEditorLeave
  const onShortcutKey = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!recordingShortcut) return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecordingShortcut(false)
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return
    const parts: string[] = []
    if (event.ctrlKey) parts.push('Control')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')
    const key =
      event.key.length === 1
        ? event.key.toUpperCase()
        : ((
            {
              ' ': 'Space',
              ArrowUp: 'Up',
              ArrowDown: 'Down',
              ArrowLeft: 'Left',
              ArrowRight: 'Right'
            } as Record<string, string>
          )[event.key] ?? event.key)
    const accelerator = [...parts, key].join('+')
    if (parts.length) {
      setRecordingShortcut(false)
      void saveSettings({ shortcut: accelerator })
    }
  }

  return (
    <div className="items-window workspace-window">
      <AppSidebar
        view={view}
        nav={(next) => {
          if (next === 'tasks' && !editItem) {
            setTaskPage(null)
            setTaskQuery('')
          }
          nav(next)
        }}
        showCalendar={settings?.showCalendar !== false}
        captureProtection={settings?.captureProtection}
        onCaptureProtectionChange={(captureProtection) => saveSettings({ captureProtection })}
      >
        <TaxonomyNav
          tags={tagRecords}
          activeTagId={view === 'tasks' ? taskTag?.id : undefined}
          onTag={(id) => {
            if (editItem) return
            setTaskPage(view === 'tasks' && taskTag?.id === id ? null : id)
            setTaskQuery('')
            if (view !== 'tasks') nav('tasks')
          }}
          onChanged={loadTags}
        />
      </AppSidebar>
      <main className="main-area">
        {taxonomyError && (
          <div className="inline-error" role="alert">
            {taxonomyError}
            <button type="button" onClick={() => void loadTags()}>
              Retry tags
            </button>
          </div>
        )}
        {view === 'settings' ? (
          <SettingsPanel
            settings={settings}
            displays={displays}
            saveSettings={saveSettings}
            onBackup={async () => {
              try {
                resultValue(await window.captured.data.backup())
                setToast('Backup created')
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Backup failed.')
              }
            }}
            onRestore={async () => {
              try {
                resultValue(await window.captured.data.restore())
                setToast('Backup restored')
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : 'Restore failed.')
              }
            }}
            firstRun={firstRun}
            onFinish={finishFirstRun}
            onTrayOnly={continueTrayOnly}
            recordingShortcut={recordingShortcut}
            setRecordingShortcut={setRecordingShortcut}
            onShortcutKey={onShortcutKey}
          />
        ) : ['tasks', 'inbox', 'backlog', 'ready', 'later'].includes(view) ? (
          <Suspense
            fallback={
              <div className="backlog-page" role="status">
                Loading tasks…
              </div>
            }
          >
            <TasksView
              key="tasks"
              tags={tagRecords}
              taxonomyReady={taxonomyLoaded}
              title={taskTag?.name ?? 'Tasks'}
              selectedTag={taskTag?.name}
              query={taskQuery}
              setQuery={setTaskQuery}
              searchRef={searchRef}
            />
          </Suspense>
        ) : view === 'calenban' ? (
          <Suspense
            fallback={
              <div className="calenban-page" role="status">
                Loading calendar…
              </div>
            }
          >
            <CalendarView settings={settings} />
          </Suspense>
        ) : (
          <>
            <header className="main-header">
              <div className="title-stack">
                {view !== 'tag' && (
                  <div className="eyebrow">{view === 'trash' ? 'ARCHIVE' : 'YOUR TASKS'}</div>
                )}
                <h1>
                  {view === 'trash'
                    ? 'Trash'
                    : view === 'tag'
                      ? (selectedTag?.name ?? 'Tag')
                        : 'All tasks'}{' '}
                  <span className="title-count">{total.toLocaleString()}</span>
                </h1>
              </div>
              <div className="header-actions">
                {updateStatus.status === 'available' && (
                  <button className="update-pill" onClick={() => void window.captured.updates.check()}>
                    Downloading update{updateStatus.version ? ` · v${updateStatus.version}` : ''}
                  </button>
                )}
                {updateStatus.status === 'downloaded' && (
                  <button
                    className="update-pill is-ready"
                    onClick={() => void window.captured.updates.install()}
                  >
                    Restart to update{updateStatus.version ? ` · v${updateStatus.version}` : ''}
                  </button>
                )}
                {view === 'trash' && total > 0 && (
                  <button className="button secondary" onClick={() => void emptyTrash()}>
                    <Trash2 size={14} /> Empty trash
                  </button>
                )}
              </div>
            </header>
            <div className="toolbar">
              <label className="search-box workspace-item-search">
                <Search size={15} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => requestEditorLeave(() => setQuery(event.target.value))}
                  placeholder={view === 'trash' ? 'Search Trash…' : 'Search tasks…'}
                  aria-label={view === 'trash' ? 'Search Trash' : 'Search tasks'}
                />
                {query && <button type="button" aria-label="Clear search" onClick={() => requestEditorLeave(() => setQuery(''))}><X size={13} /></button>}
              </label>
              {dateRange === 'custom' && (
                <div className="date-inputs">
                  <input
                    type="date"
                    aria-label="From date"
                    value={customFrom}
                    onChange={(event) => requestEditorLeave(() => setCustomFrom(event.target.value))}
                  />
                  <span>to</span>
                  <input
                    type="date"
                    aria-label="To date"
                    value={customTo}
                    onChange={(event) => requestEditorLeave(() => setCustomTo(event.target.value))}
                  />
                </div>
              )}
              {view !== 'trash' && (
                <button
                  type="button"
                  className={`button secondary small completed-toggle ${showCompleted ? 'is-active' : ''}`}
                  aria-pressed={showCompleted}
                  onClick={() => requestEditorLeave(() => setShowCompleted((current) => !current))}
                >
                  <CheckCircle2 size={14} /> Show completed
                </button>
              )}
              <button
                className="button secondary small filter-toggle"
                aria-expanded={filtersOpen}
                aria-controls="item-filters"
                onClick={() => setFiltersOpen(!filtersOpen)}
              >
                Filters{activeFilterCount > 0 && <span className="filter-count">{activeFilterCount}</span>}
                <ChevronDown size={13} />
              </button>
              <button
                type="button"
                className="button secondary small"
                aria-pressed={selectionMode}
                onClick={() => {
                  setSelectionMode(!selectionMode)
                  setSelected([])
                }}
              >
                {selectionMode ? 'Done selecting' : 'Select items'}
              </button>
                <span className="result-count">
                  {total.toLocaleString()} {total === 1 ? 'item' : 'items'}
                </span>
            </div>
            {filtersOpen && (
              <div id="item-filters" className="filter-panel" aria-label="Filters">
                {view !== 'tag' && (
                  <div className="filter-row">
                    <span className="filter-heading">TAGS</span>
                    <TagFilter
                      category="items"
                      tags={tagRecords}
                      value={{ included: tagFilters, excluded: excludedTags }}
                      onChange={(next) =>
                        requestEditorLeave(() => {
                          setTagFilters(next.included)
                          setExcludedTags(next.excluded)
                        })
                      }
                    />
                  </div>
                )}
                <div className="filter-row">
                  <span className="filter-heading">DATE</span>
                  <div className="filter-pills" aria-label="Date filters">
                    {dateOptions.map(({ value, label }) => (
                      <button
                        key={value}
                        className={`filter-pill ${dateRange === value ? 'is-selected' : ''}`}
                        aria-pressed={dateRange === value}
                        onClick={() => requestEditorLeave(() => setDateRange(value))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className="filter-clear"
                    onClick={() => requestEditorLeave(clearFilters)}
                    disabled={
                      !excludedTags.length &&
                      !query &&
                      !tagFilters.length &&
                      dateRange === 'all'
                    }
                  >
                    Clear all
                  </button>
                </div>
              </div>
            )}
            {selected.length > 0 && (
              <div className="selection-toolbar">
                <span>{selected.length} selected</span>
                <button className="text-action" onClick={() => void copyIds(selected)}>
                  <Copy size={14} /> Copy
                </button>

                {view === 'trash' ? (
                  <>
                    <button
                      className="text-action"
                      onClick={async () => {
                        try {
                          resultValue(await window.captured.items.restore(selected))
                          setSelected([])
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : 'Could not restore items.')
                        }
                      }}
                    >
                      <Undo2 size={14} /> Restore
                    </button>
                    <button
                      className="text-action danger-action"
                      onClick={async () => {
                        try {
                          resultValue(await window.captured.items.deletePermanently(selected))
                          setSelected([])
                        } catch (reason) {
                          setError(reason instanceof Error ? reason.message : 'Could not delete items.')
                        }
                      }}
                    >
                      <Trash2 size={14} /> Delete permanently
                    </button>
                  </>
                ) : (
                  <button className="text-action danger-action" onClick={() => void trashSelected()}>
                    <Trash2 size={14} /> Move to Trash
                  </button>
                )}
              </div>
            )}
            <div className={`content-grid ${detailId && view === 'trash' ? 'has-detail' : ''}`}>
              <div
                className={`list-column ${detailId && view === 'trash' && window.innerWidth < 960 ? 'mobile-hidden' : ''}`}
                ref={itemListRef}
              >
                {error && (
                  <div className="inline-error" role="alert">
                    <Info size={15} />
                    <span>{error}</span>
                    <button
                      onClick={() => {
                        setError('')
                        void loadItems()
                      }}
                    >
                      Retry
                    </button>
                  </div>
                )}
                {loading && !items.length ? (
                  <div className="loading-state">
                    <span className="spinner" /> Loading tasks…
                  </div>
                ) : (
                  renderRows()
                )}
              </div>
              {detailId && view === 'trash' && (
                <section className="detail-panel" aria-label="Task details">
                  <div className="detail-top">
                    <button
                      className="back-button"
                      onClick={() =>
                        requestEditorLeave(() => {
                          setDetailId(null)
                          setDetail(null)
                        })
                      }
                    >
                      <ArrowLeft size={15} /> <span>Back</span>
                    </button>
                    <div className="detail-actions">
                      <button
                        className="icon-button"
                        title="Copy task"
                        aria-label="Copy task"
                        onClick={() => void copyIds([detailId])}
                      >
                        <Copy size={15} />
                      </button>
                      {view === 'trash' ? (
                        <>
                          <button
                            className="icon-button"
                            title="Restore task"
                            aria-label="Restore task"
                            onClick={() => void restoreOne(detailId)}
                          >
                            <Undo2 size={15} />
                          </button>
                          <button
                            className="icon-button danger-icon"
                            title="Delete permanently"
                            aria-label="Delete permanently"
                            onClick={() => void deleteOne(detailId)}
                          >
                            <Trash2 size={15} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="icon-button danger-icon"
                          title="Move to Trash"
                          aria-label="Move to Trash"
                          onClick={() =>
                            void trashSelectedFromDetail(
                              detailId,
                              window.captured,
                              setToast,
                              setError,
                              setDetailId,
                              setDetail
                            )
                          }
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  </div>
                  {!detail ? (
                    <div className="detail-loading">
                      <span className="spinner" />
                    </div>
                  ) : (
                    <>
                      <div className="detail-meta">
                        <span>{formatDateTime(detail.createdAt)}</span>
                        {detail.updatedAt !== detail.createdAt && (
                          <span>Edited {formatDateTime(detail.updatedAt)}</span>
                        )}
                        {detail.completedAt != null && (
                          <span className="detail-completed-at">
                            Done {formatDateTime(detail.completedAt)}
                          </span>
                        )}
                        {detail.kind === 'task' && view !== 'trash' && (
                          <button
                            type="button"
                            className="detail-completion-action"
                            onClick={() => void toggleDetailCompletion()}
                          >
                            <CheckCircle2 size={13} />{' '}
                            {detail.completedAt != null ? 'Reopen task' : 'Mark as done'}
                          </button>
                        )}
                      </div>
                      <div className="detail-item-text">
                        {detail.body ? <LinkedText text={detail.body} /> :
                          (detail.images.length ? null : <span className="muted">Untitled task</span>)}
                      </div>
                      <ItemImages key={detail.id} images={detail.images} expanded={!detail.body.trim()} />

                      <>
                        <div className="detail-tags">
                          <span className="tags-field-label">Tags</span>
                          <span className="detail-tag-list">
                            {detail.tags.length
                              ? detail.tags.map((tag) => (
                                  <span
                                    className="item-tag-chip"
                                    key={tag}
                                    style={{
                                      color: tagRecords.find(
                                        (record) =>
                                          record.name.toLocaleLowerCase() === tag.toLocaleLowerCase()
                                      )?.color
                                    }}
                                  >
                                    {tag}
                                  </span>
                                ))
                              : 'No tags'}
                          </span>
                        </div>
                        {view !== 'trash' && (
                          <button
                            className="button secondary edit-button"
                            onClick={() => setEditItem(detail)}
                          >
                            Edit task <ArrowRight size={14} />
                          </button>
                        )}
                      </>
                    </>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={15} />
          {toast}
        </div>
      )}
      {browserCaptureOpen && (
        <div className="modal-backdrop">
          <form
            className="dialog-card browser-capture-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="browser-capture-title"
            onKeyDown={(event) => {
              if (event.defaultPrevented) return
              if (event.key === 'Escape') { event.preventDefault(); setBrowserCaptureOpen(false) }
              if (event.key !== 'Tab') return
              const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled)')]
              const first = controls[0], last = controls.at(-1)
              if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
              else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
            }}
            onSubmit={(event) => {
              event.preventDefault()
              void submitBrowserCapture()
            }}
          >
            <div className="event-dialog-kicker">QUICK CAPTURE</div>
            <h2 id="browser-capture-title">Capture a thought</h2>
            <textarea
              autoFocus
              aria-label="Capture text"
              placeholder="What's on your mind?"
              value={browserCaptureText}
              onChange={(event) => setBrowserCaptureText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setBrowserCaptureOpen(false)
              }}
            />
            <TagEditor
              tags={browserCaptureTags}
              onTagsChange={setBrowserCaptureTags}
              suggestions={availableTags}
            />
            <div className="dialog-actions">
              <button type="button" className="button secondary" onClick={() => setBrowserCaptureOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={!browserCaptureText.trim()}>
                Save task
              </button>
            </div>
          </form>
        </div>
      )}
      {editItem && (
        <ItemDetailDialog
          key={editItem.id}
          task={editItem}
          suggestions={availableTags}
          onClose={() => setEditItem(null)}
          onChanged={() => {
            setEditItem(null)
            setToast('Changes saved')
            void loadItems()
            if (detailId) void openItem(detailId)
          }}
        />
      )}
    </div>
  )
}

async function trashSelectedFromDetail(
  id: string,
  api: Window['captured'],
  setToast: (value: string) => void,
  setError: (value: string) => void,
  setDetailId: (value: string | null) => void,
  setDetail: (value: ItemDetail | null) => void
) {
  try {
    const result = await api.items.trash([id])
    if (result.ok) {
      setDetailId(null)
      setDetail(null)
      setToast('Item moved to Trash')
    } else setError(result.message)
  } catch (reason) {
    setError(reason instanceof Error ? reason.message : 'Could not move item to Trash.')
  }
}
