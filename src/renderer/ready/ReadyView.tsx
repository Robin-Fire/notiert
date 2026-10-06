import { useMemo, useRef, useState } from 'react'
import { CheckCircle2, FolderKanban, GripVertical } from 'lucide-react'
import type { Category, PlannerTask, Subcategory } from '../../shared/contracts'
import { toLocalISODate } from '../../shared/plannerDates'
import { resultValue } from '../apiResult'
import { TaskDetailDialog } from '../calenban/TaskDetailDialog'
import { usePlannerData } from '../calenban/usePlannerData'
import { ImageIndicator } from '../components/ItemImages'
import { Badge } from '../components/reui/badge'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '../components/reui/frame'
import { Kanban, KanbanBoard, KanbanColumn, KanbanColumnContent, KanbanItem, KanbanItemHandle, KanbanOverlay, type KanbanMoveEvent } from '../components/reui/kanban'
import { readyColumns, readyMove } from './readyBoard'

export function ReadyView({ categories, subcategories, taxonomyReady }: { categories: Category[]; subcategories: Subcategory[]; taxonomyReady: boolean }) {
  const today = toLocalISODate(new Date())
  const { tasks, tags, loading, error, refresh } = usePlannerData(today, today)
  const [detailTask, setDetailTask] = useState<PlannerTask | null>(null)
  const [saveError, setSaveError] = useState('')
  const [saving, setSaving] = useState(false)
  const savePending = useRef(false)
  const columns = useMemo(() => readyColumns(categories, tasks), [categories, tasks])
  const value = useMemo(() => Object.fromEntries(columns.map((column) => [column.id, column.tasks])), [columns])
  const total = columns.reduce((count, column) => count + column.tasks.length, 0)

  async function move({ activeContainer, overContainer, activeIndex, overIndex }: KanbanMoveEvent) {
    if (savePending.current || activeContainer !== overContainer) return
    const placement = readyMove(value[activeContainer] ?? [], activeIndex, overIndex)
    if (!placement) return
    savePending.current = true
    setSaving(true)
    setSaveError('')
    try {
      resultValue(await window.captured.planner.move(placement))
    } catch (reason) {
      setSaveError(reason instanceof Error ? reason.message : 'Task order could not be saved.')
    } finally {
      await refresh()
      savePending.current = false
      setSaving(false)
    }
  }

  function card(task: PlannerTask, overlay = false) {
    const subcategory = subcategories.find((item) => item.id === task.subcategoryId)
    return <KanbanItem key={task.id} value={task.id} disabled={saving && !overlay} className="ready-card">
      <Frame variant="ghost" spacing="sm" className="p-0">
        <FramePanel className="ready-card-panel">
          <div className="ready-card-heading">
            <KanbanItemHandle render={<button type="button" />} className="ready-card-handle" aria-label={`Reorder ${task.body.split('\n')[0] || 'task'}`}><GripVertical size={15} /></KanbanItemHandle>
            <button type="button" className="ready-card-text" onClick={() => setDetailTask(task)}>{task.body.trim() ? task.body : task.images.length ? 'Image to-do' : 'Untitled task'}</button>
          </div>
          {(subcategory || task.tags.length > 0 || task.images.length > 0) && <div className="ready-card-meta">
            {subcategory && <span className="subcategory-label" style={{ color: subcategory.color }}>{subcategory.name}</span>}
            <ImageIndicator count={task.images.length} />
            {task.tags.map((tag) => <Badge key={tag} variant="outline" size="sm">#{tag}</Badge>)}
          </div>}
        </FramePanel>
      </Frame>
    </KanbanItem>
  }

  return <section className="backlog-page ready-page" aria-label="Ready board" aria-busy={saving}>
    <header className="backlog-header"><span className="eyebrow">READY TO PLAN</span><h1>Ready <span className="title-count">{total}</span></h1><p>Ready tasks by category. Drag a card’s handle to change its order within the column.</p></header>
    {(saveError || error) && <div className="inline-error" role="alert">{saveError || error}<button type="button" onClick={() => void refresh()}>Retry</button></div>}
    {saving && <span className="ready-saving" role="status">Saving order…</span>}
    {!taxonomyReady || loading && !tasks.length ? <div className="loading-state"><span className="spinner" /> Loading Ready…</div> : !columns.length ? <div className="empty-state"><div className="empty-mark"><CheckCircle2 size={22} /></div><h2>No Ready tasks yet.</h2><p>Use “Add to Ready” in the backlog to bring tasks here.</p></div> : <div className="ready-board-scroll">
      <Kanban value={value} onValueChange={() => { /* Column order is controlled by category order. */ }} getItemValue={(task) => task.id} onMove={(event) => void move(event)}>
        <KanbanBoard className="ready-board">
          {columns.map((column) => <KanbanColumn key={column.id} value={column.id} className="ready-column">
            <Frame spacing="sm" className="ready-column-frame">
              <FrameHeader className="ready-column-header"><FolderKanban size={15} /><FrameTitle>{column.name}</FrameTitle><Badge variant="outline" size="sm">{column.tasks.length}</Badge></FrameHeader>
              <KanbanColumnContent value={column.id} className="ready-column-content">{column.tasks.map((task) => card(task))}</KanbanColumnContent>
            </Frame>
          </KanbanColumn>)}
        </KanbanBoard>
        <KanbanOverlay>{({ value: id }) => { const task = tasks.find((item) => item.id === id); return task ? card(task, true) : null }}</KanbanOverlay>
      </Kanban>
    </div>}
    {detailTask && <TaskDetailDialog task={detailTask} suggestions={tags} onClose={() => setDetailTask(null)} onChanged={() => { setDetailTask(null); void refresh() }} />}
  </section>
}
