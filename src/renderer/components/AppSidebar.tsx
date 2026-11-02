import type { ComponentProps } from 'react'
import {
  CalendarDays,
  FolderKanban,
  Plus,
  Settings as SettingsIcon,
  Trash2
} from 'lucide-react'
import type { Settings } from '../../shared/contracts'
import { TaxonomyNav } from './TaxonomyNav'

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

export function AppSidebar({
  view,
  nav,
  settings,
  taxonomy
}: {
  view: ViewName
  nav: (view: ViewName) => void
  settings: Settings | null
  taxonomy: ComponentProps<typeof TaxonomyNav>
}) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => nav('tasks')}>
        <span className="brand-glyph">c</span>
        <span>captured</span>
      </button>
      <button
        type="button"
        className="sidebar-capture"
        aria-label="Capture"
        title="Capture a thought"
        onClick={() => window.captured.windows.openCapture()}
      >
        <Plus size={16} />
        <span>Capture</span>
        <kbd>{settings?.shortcut.replace('Control', 'Ctrl') ?? 'Ctrl+N'}</kbd>
      </button>
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button
          className={['tasks', 'ready', 'later', 'backlog', 'inbox'].includes(view) ? 'active' : ''}
          onClick={() => nav('tasks')}
        >
          <FolderKanban size={16} />
          <span>Tasks</span>
        </button>
        {settings?.showCalendar !== false && (
          <button className={view === 'calenban' ? 'active' : ''} onClick={() => nav('calenban')}>
            <CalendarDays size={16} />
            <span>Calendar</span>
          </button>
        )}
      </nav>
      <TaxonomyNav {...taxonomy} />
      <nav className="side-nav" aria-label="Trash">
        <button className={view === 'trash' ? 'active' : ''} onClick={() => nav('trash')}>
          <Trash2 size={16} />
          <span>Trash</span>
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <button className={view === 'settings' ? 'active' : ''} onClick={() => nav('settings')}>
          <SettingsIcon size={16} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
