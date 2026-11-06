import type { ComponentProps } from 'react'
import {
  CalendarDays,
  FolderKanban,
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
  taxonomy,
  search
}: {
  view: ViewName
  nav: (view: ViewName) => void
  settings: Settings | null
  search: React.ReactNode
  taxonomy: ComponentProps<typeof TaxonomyNav>
}) {
  return (
    <aside className="sidebar">
      <button className="brand" onClick={() => nav('tasks')}>
        <span className="brand-glyph">c</span>
        <span>captured</span>
      </button>
      {search}
      <div className="side-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">
        <button
          className={['tasks', 'ready', 'later', 'backlog', 'inbox'].includes(view) ? 'active' : ''}
          title="Tasks"
          aria-current={['tasks', 'ready', 'later', 'backlog', 'inbox'].includes(view) ? 'page' : undefined}
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
      <div className="sidebar-taxonomy-scroll"><TaxonomyNav {...taxonomy} /></div>
      <nav className="side-nav" aria-label="Trash">
        <button title="Trash" aria-current={view === 'trash' ? 'page' : undefined} className={view === 'trash' ? 'active' : ''} onClick={() => nav('trash')}>
          <Trash2 size={16} />
          <span>Trash</span>
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom">
        <button title="Settings" aria-current={view === 'settings' ? 'page' : undefined} className={view === 'settings' ? 'active' : ''} onClick={() => nav('settings')}>
          <SettingsIcon size={16} />
          <span>Settings</span>
        </button>
      </div>
    </aside>
  )
}
