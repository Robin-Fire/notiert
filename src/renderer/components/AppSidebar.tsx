import type { ReactNode } from 'react'
import { CalendarDays, FolderKanban, Plus, Settings, Trash2 } from 'lucide-react'

export type ViewName =
  | 'tasks'
  | 'all'
  | 'inbox'
  | 'calenban'
  | 'ready'
  | 'backlog'
  | 'later'
  | 'trash'
  | 'settings'
  | 'tag'
  | 'category'
  | 'review'

export function AppSidebar({ view, nav, showCalendar, onAddTask, addTaskDisabled, children }: {
  view: ViewName
  nav: (view: ViewName) => void
  showCalendar: boolean
  onAddTask: () => void
  addTaskDisabled: boolean
  children: ReactNode
}) {
  const tasksActive = ['tasks', 'ready', 'later', 'backlog', 'inbox'].includes(view)

  return (
    <aside className="sidebar" aria-label="Workspace sidebar">
      <button type="button" className="brand" aria-label="captured home" onClick={() => nav('tasks')}>
        <span className="brand-glyph" aria-hidden="true">c</span>
        <span>captured</span>
      </button>
      <button type="button" className="sidebar-add-task" aria-label="Add task" disabled={addTaskDisabled} onClick={onAddTask}>
        <Plus size={16} /><span>Add task</span>
      </button>
      <nav className="side-nav" aria-label="Main navigation">
        <button type="button" aria-current={tasksActive ? 'page' : undefined} onClick={() => nav('tasks')}>
          <FolderKanban size={17} /><span>Tasks</span>
        </button>
        {showCalendar && (
          <button type="button" aria-current={view === 'calenban' ? 'page' : undefined} onClick={() => nav('calenban')}>
            <CalendarDays size={17} /><span>Calendar</span>
          </button>
        )}
      </nav>
      <div className="sidebar-taxonomy-scroll">{children}</div>
      <nav className="side-nav sidebar-utilities" aria-label="Utilities">
        <button type="button" aria-current={view === 'trash' ? 'page' : undefined} onClick={() => nav('trash')}>
          <Trash2 size={17} /><span>Trash</span>
        </button>
        <button type="button" aria-current={view === 'settings' ? 'page' : undefined} onClick={() => nav('settings')}>
          <Settings size={17} /><span>Settings</span>
        </button>
      </nav>
    </aside>
  )
}
