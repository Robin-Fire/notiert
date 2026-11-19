import { useState, type ReactNode } from 'react'
import { CalendarDays, FolderKanban, PanelLeftClose, PanelLeftOpen, Settings, Spotlight, Trash2 } from 'lucide-react'

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

export function AppSidebar({ view, activeTagId, nav, showCalendar, captureProtection, onCaptureProtectionChange, children }: {
  view: ViewName
  activeTagId?: string
  nav: (view: ViewName) => void
  showCalendar: boolean
  captureProtection?: boolean
  onCaptureProtectionChange: (enabled: boolean) => Promise<boolean>
  children: ReactNode
}) {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('captured-workspace-sidebar-collapsed') === 'true' }
    catch { return false }
  })
  const [savingCaptureProtection, setSavingCaptureProtection] = useState(false)
  const [captureProtectionError, setCaptureProtectionError] = useState(false)
  const shareVisible = captureProtection === false
  const toggleLabel = collapsed ? 'Show sidebar' : 'Hide sidebar'

  function toggleSidebar() {
    setCollapsed(!collapsed)
    try { localStorage.setItem('captured-workspace-sidebar-collapsed', String(!collapsed)) }
    catch { /* The toggle still works for the current session. */ }
  }

  const tasksActive = activeTagId === undefined && ['tasks', 'ready', 'later', 'backlog', 'inbox'].includes(view)

  return (
    <aside className={collapsed ? 'sidebar is-collapsed' : 'sidebar'} aria-label="Workspace sidebar">
      <div className="sidebar-content" id="workspace-sidebar-content" hidden={collapsed}>
        <button type="button" className="brand" aria-label="captured home" onClick={() => nav('tasks')}>
          <span className="brand-glyph" aria-hidden="true">c</span>
          <span>captured</span>
        </button>
        <nav className="side-nav" aria-label="Main navigation">
          <button type="button" aria-current={tasksActive ? 'page' : undefined} onClick={() => nav('tasks')}>
            <FolderKanban size={17} /><span>All Tasks</span>
          </button>
          {showCalendar && (
            <button type="button" aria-current={view === 'calenban' ? 'page' : undefined} onClick={() => nav('calenban')}>
              <CalendarDays size={17} /><span>Calendar</span>
            </button>
          )}
        </nav>
        <div className="sidebar-taxonomy-scroll">{children}</div>
      </div>
      {!collapsed && captureProtectionError && (
        <p className="inline-error" role="alert">Could not change capture exclusion.</p>
      )}
      <div className="sidebar-actions">
        {!collapsed && (
          <button
            type="button"
            className="sidebar-spotlight"
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
            <Spotlight size={17} aria-hidden="true" />
          </button>
        )}
        <button type="button" className="sidebar-toggle" aria-label={toggleLabel} title={toggleLabel}
          aria-expanded={!collapsed} aria-controls="workspace-sidebar-content workspace-sidebar-utilities" onClick={toggleSidebar}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
        </button>
      </div>
      <nav className="side-nav sidebar-utilities" id="workspace-sidebar-utilities" aria-label="Utilities" hidden={collapsed}>
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
