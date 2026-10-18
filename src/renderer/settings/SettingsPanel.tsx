import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import {
  Archive,
  ArrowRight,
  CalendarDays,
  Check,
  CircleHelp,
  FolderOpen,
  Info,
  Monitor,
  Settings as SettingsIcon,
  Shield,
  Sun
} from 'lucide-react'
import type { Settings, SettingsUpdate } from '../../shared/contracts'
import { CalendarSettings } from '../calenban/CalendarSettings'
import { AppSelect } from '../components/AppSelect'
import { toLocalISODate } from '../../shared/plannerDates'
const todayISO = () => toLocalISODate(new Date())
const formatDateTime = (value: number) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(value)

export function SettingsPanel({
  settings,
  displays,
  saveSettings,
  onBackup,
  onRestore,
  firstRun,
  onFinish,
  onTrayOnly,
  recordingShortcut,
  setRecordingShortcut,
  onShortcutKey
}: {
  settings: Settings | null
  displays: { id: number; label: string; primary: boolean }[]
  saveSettings: (update: SettingsUpdate) => Promise<boolean>
  onBackup: () => void
  onRestore: () => void
  firstRun: boolean
  onFinish: (shortcut: string, login: boolean) => void
  onTrayOnly: (login: boolean) => void
  recordingShortcut: boolean
  setRecordingShortcut: (value: boolean) => void
  onShortcutKey: (event: ReactKeyboardEvent<HTMLButtonElement>) => void
}) {
  const [activeSection, setActiveSection] = useState('general')
  const [testApp, setTestApp] = useState(settings?.protectionTestApp ?? '')
  const [onboardingShortcut, setOnboardingShortcut] = useState('Control+N')
  const [onboardingLogin, setOnboardingLogin] = useState(false)
  useEffect(() => {
    if (settings) setTestApp(settings.protectionTestApp)
  }, [settings])
  const shortcutDisplay = (settings?.shortcut ?? 'Control+N')
    .replace('Control', 'Ctrl')
    .replaceAll('+', ' + ')
  const sectionItems = [
    { id: 'general', label: 'General', icon: SettingsIcon },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays },
    { id: 'appearance', label: 'Appearance', icon: Sun },
    { id: 'sharing', label: 'Screen sharing', icon: Monitor },
    { id: 'data', label: 'Data', icon: Archive },
    { id: 'about', label: 'About', icon: Info }
  ]
  return (
    <div className="settings-layout">
      <aside className="settings-nav">
        <div className="settings-title">
          <div className="eyebrow">PREFERENCES</div>
          <h1>Settings</h1>
        </div>
        {sectionItems.map(({ id, label, icon: Icon }) => (
          <button
            className={activeSection === id ? 'active' : ''}
            aria-label={label}
            title={label}
            aria-current={activeSection === id ? 'page' : undefined}
            key={id}
            onClick={() => setActiveSection(id)}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </aside>
      <section className="settings-content">
        {activeSection === 'general' && (
          <>
            <div className="settings-heading">
              <h2>General</h2>
              <p>Choose how captured behaves on this device.</p>
            </div>
            <div className="setting-row">
              <div>
                <b>Capture shortcut</b>
                <span>
                  Opens the capture bar from any app. While captured runs, Ctrl+N replaces the usual New
                  shortcut.
                </span>
              </div>
              <div className="shortcut-control">
                <button
                  className={`button secondary ${recordingShortcut ? 'recording' : ''}`}
                  onClick={() => setRecordingShortcut(true)}
                  onKeyDown={onShortcutKey}
                >
                  {recordingShortcut ? 'Press a shortcut…' : shortcutDisplay}
                </button>
                <span className={`status-dot ${settings?.shortcutRegistered ? 'good' : 'bad'}`} />
                {!settings?.shortcutRegistered && <small>Unavailable</small>}
              </div>
            </div>
            <div className="setting-row">
              <div>
                <b>Global shortcut</b>
                <span>Turn off keyboard capture and use the tray menu instead.</span>
              </div>
              <Toggle
                checked={settings?.shortcutEnabled ?? true}
                onChange={(value) => void saveSettings({ shortcutEnabled: value })}
                label="Global capture shortcut"
              />
            </div>
            <div className="setting-row">
              <div>
                <b>Launch at login</b>
                <span>Start captured quietly when you sign in to Windows.</span>
              </div>
              <Toggle
                checked={settings?.launchAtLogin ?? false}
                onChange={(value) => void saveSettings({ launchAtLogin: value })}
                label="Launch at login"
              />
            </div>
            <div className="setting-row">
              <div>
                <b>Close to tray</b>
                <span>
                  Closing the app window keeps capture ready in the system tray. Use Quit in the tray menu to
                  exit.
                </span>
              </div>
              <Toggle
                checked={settings?.closeToTray ?? true}
                onChange={(value) => void saveSettings({ closeToTray: value })}
                label="Close to tray"
              />
            </div>
            <div className="setting-row">
              <div>
                <b>Capture display</b>
                <span>
                  Choose where the capture bar appears. Missing displays fall back to the pointer's display.
                </span>
              </div>
              <AppSelect
                aria-label="Capture display"
                className="filter-select setting-select"
                value={settings?.monitor ?? 'active'}
                onChange={(event) => void saveSettings({ monitor: event.target.value })}
              >
                <option value="active">Active window / pointer</option>
                <option value="pointer">Mouse pointer</option>
                <option value="primary">Primary display</option>
                {displays.map((display) => (
                  <option key={display.id} value={`display:${display.id}`}>
                    {display.label}
                  </option>
                ))}
              </AppSelect>
            </div>
            <div className="setting-row">
              <div>
                <b>Shortcut registration</b>
                <span>
                  {settings?.shortcutRegistered
                    ? 'Ready. The global shortcut is registered.'
                    : 'The selected shortcut could not be registered. Tray capture remains available.'}
                </span>
              </div>
              <span className={`status-label ${settings?.shortcutRegistered ? 'success' : 'warning'}`}>
                {settings?.shortcutRegistered ? 'Ready' : 'Tray only'}
              </span>
            </div>
          </>
        )}
        {activeSection === 'calendar' && (
          <>
            <div className="setting-row">
              <div>
                <b>Show Calendar</b>
                <span>Show the Calendar page in the sidebar and system tray.</span>
              </div>
              <Toggle
                checked={settings?.showCalendar ?? true}
                onChange={(value) => void saveSettings({ showCalendar: value })}
                label="Show Calendar"
              />
            </div>
            <CalendarSettings settings={settings} save={saveSettings} />
          </>
        )}
        {activeSection === 'appearance' && (
          <>
            <div className="settings-heading">
              <h2>Appearance</h2>
              <p>Keep the interface comfortable in any room.</p>
            </div>
            <div className="theme-choices">
              {(['system', 'light', 'dark'] as const).map((theme) => (
                <button
                  className={`theme-card ${settings?.theme === theme ? 'selected' : ''}`}
                  key={theme}
                  onClick={() => void saveSettings({ theme })}
                >
                  <div className={`theme-swatch ${theme}`}>
                    <span />
                    <i />
                    <i />
                    <i />
                  </div>
                  <div>
                    <b>{theme === 'system' ? 'System' : theme[0]!.toUpperCase() + theme.slice(1)}</b>
                    <span>{theme === 'system' ? 'Follow Windows' : `Use ${theme} appearance`}</span>
                  </div>
                  {settings?.theme === theme && <Check size={15} />}
                </button>
              ))}
            </div>
            <div className="setting-note">
              <CircleHelp size={15} /> SN Pro and Geist Mono are bundled for offline use.
            </div>
          </>
        )}
        {activeSection === 'sharing' && (
          <>
            <div className="settings-heading">
              <h2>Screen sharing</h2>
              <p>Ask Windows to exclude captured windows from supported captures.</p>
            </div>
            <div className="protection-card">
              <div className="protection-icon">
                <Shield size={17} />
              </div>
              <div>
                <b>Request capture exclusion</b>
                <span>
                  Best effort. Whether app windows are excluded depends on Windows and the meeting or
                  recording app.
                </span>
              </div>
              <Toggle
                checked={settings?.captureProtection ?? true}
                onChange={async (value) => {
                  if (
                    !value &&
                    !window.confirm(
                      'Tasks may appear in screen shares and recordings when exclusion is off. Turn it off?'
                    )
                  )
                    return
                  await saveSettings({ captureProtection: value })
                }}
                label="Capture exclusion"
              />
            </div>
            <div className="privacy-copy">
              <b>Test from another participant's view</b>
              <p>
                Start a test meeting, share your screen, open captured, and ask someone on another device
                whether the capture bar and app window appear. Repeat after changing the meeting app or
                Windows version.
              </p>
              <p>
                File pickers are native Windows windows and may still be visible. Open export and restore
                dialogs outside a presentation.
              </p>
            </div>
            <div className="setting-row">
              <div>
                <b>Last manual test</b>
                <span>
                  {settings?.protectionTestDate
                    ? settings.protectionTestOS
                      ? `Recorded ${settings.protectionTestDate} · Windows ${settings.protectionTestOS}. Retest after changing the meeting app or Windows build.`
                      : 'The Windows build changed since this test. Retest this setup.'
                    : 'Record what you tested. This is a reminder, not technical verification.'}
                </span>
              </div>
              <div className="test-fields">
                <input
                  className="text-field"
                  value={testApp}
                  maxLength={80}
                  placeholder="App / version / mode"
                  onChange={(event) => setTestApp(event.target.value)}
                />
                <button
                  className="button secondary small"
                  onClick={() => {
                    const date = todayISO()
                    void saveSettings({ protectionTestApp: testApp, protectionTestDate: date })
                  }}
                >
                  Record today’s test
                </button>
              </div>
            </div>
            <div className="setting-note warning-note">
              <Info size={15} /> Exclusion does not protect against remote control, malicious capture tools,
              or cameras. File pickers may be visible; open them outside a presentation.
            </div>
          </>
        )}
        {activeSection === 'data' && (
          <>
            <div className="settings-heading">
              <h2>Data</h2>
              <p>Your tasks are stored locally and are not encrypted by captured.</p>
            </div>
            <div className="data-location">
              <div className="data-folder-icon">
                <FolderOpen size={18} />
              </div>
              <div>
                <b>Local storage</b>
                <span>SQLite database · app data folder</span>
              </div>
              <button
                className="button secondary small"
                onClick={() => void window.captured.settings.openFolder()}
              >
                Open folder
              </button>
            </div>
            <div className="data-actions">
              <div>
                <b>Export items</b>
                <span>Save plain text or Markdown to a folder you choose.</span>
              </div>
              <div>
                <button
                  className="button secondary small"
                  onClick={() => void window.captured.data.export({ scope: 'all', format: 'txt' })}
                >
                  Export TXT
                </button>
                <button
                  className="button secondary small"
                  onClick={() => void window.captured.data.export({ scope: 'all', format: 'md' })}
                >
                  Export Markdown
                </button>
              </div>
            </div>
            <div className="data-actions">
              <div>
                <b>SQLite backup</b>
                <span>
                  {settings?.backupWarning
                    ? 'The last backup failed. Tasks can still save; try creating a backup again.'
                    : settings?.lastBackupAt
                      ? `Last backup ${formatDateTime(settings.lastBackupAt)}.`
                      : 'No backup has been created yet.'}{' '}
                  A full recovery snapshot of tasks, tags, scheduled meetings, and Trash.
                </span>
              </div>
              <div>
                <button className="button secondary small" onClick={() => void onBackup()}>
                  Create backup
                </button>
                <button className="button secondary small" onClick={() => void onRestore()}>
                  Restore backup
                </button>
              </div>
            </div>
            <div className="setting-note">
              <Info size={15} /> Restoring replaces current data. captured creates a safety backup first.
              Independent backups can retain tasks removed from Trash. Do not sync the live SQLite database
              through a shared folder.
            </div>
          </>
        )}
        {activeSection === 'about' && (
          <>
            <div className="settings-heading">
              <h2>About captured</h2>
              <p>A quiet, local desktop utility for capturing a thought during a meeting.</p>
            </div>
            <div className="about-card">
              <div className="about-logo">n</div>
              <div>
                <b>captured</b>
                <span>Version 0.1.0 · Windows 11 x64</span>
              </div>
            </div>
            <div className="setting-row">
              <div>
                <b>Local diagnostics</b>
                <span>
                  Exports app version, Windows build, shortcut status, and database availability. No task or
                  meeting content.
                </span>
              </div>
              <button
                className="button secondary small"
                onClick={async () => {
                  const result = await window.captured.data.diagnostics()
                  if (!result.ok) window.alert(result.message)
                }}
              >
                Export diagnostics
              </button>
            </div>
            <div className="license-box">
              <b>Third-party licenses</b>
              <p>
                Electron · Chromium · React · ReUI · dnd-kit · SN Pro · Geist Mono · Lucide icons · SQLite ·
                other bundled dependencies.
              </p>
              <p>See the licenses folder in the installed app for full notices.</p>
            </div>
          </>
        )}
      </section>
      {firstRun && (
        <div className="modal-backdrop setup-backdrop">
          <div className="setup-dialog">
            <div className="setup-brand">
              <span className="brand-glyph">c</span>
              <span>captured</span>
              <small>FIRST RUN</small>
            </div>
            <h2>
              Catch a thought.
              <br />
              Keep your place.
            </h2>
            <p>
              Press a shortcut, type a task, and return to what you were doing. Tasks stay on this device.
            </p>
            <div className="setup-shortcuts">
              <button
                className={onboardingShortcut === 'Control+N' ? 'selected' : ''}
                onClick={() => setOnboardingShortcut('Control+N')}
              >
                <kbd>Ctrl</kbd>
                <b>+</b>
                <kbd>N</kbd>
                <span>Recommended</span>
              </button>
              <button
                className={onboardingShortcut === 'Control+Alt+N' ? 'selected' : ''}
                onClick={() => setOnboardingShortcut('Control+Alt+N')}
              >
                <kbd>Ctrl</kbd>
                <b>+</b>
                <kbd>Alt</kbd>
                <b>+</b>
                <kbd>N</kbd>
              </button>
            </div>
            <div className="setup-notice">
              <Shield size={16} />
              <span>
                captured asks Windows to hide its windows from supported captures. Meeting apps may still show
                them; test from another participant's device.
              </span>
            </div>
            <label className="setup-login">
              <input
                type="checkbox"
                checked={onboardingLogin}
                onChange={(event) => setOnboardingLogin(event.target.checked)}
              />{' '}
              Launch quietly when I sign in
            </label>
            <div className="dialog-actions">
              <button className="button secondary" onClick={() => onTrayOnly(onboardingLogin)}>
                Use tray only
              </button>
              <button
                className="button primary"
                onClick={() => onFinish(onboardingShortcut, onboardingLogin)}
              >
                Save and continue <ArrowRight size={15} />
              </button>
            </div>
            <small className="setup-foot">
              Ctrl+N replaces the usual New shortcut while captured is running.
            </small>
          </div>
        </div>
      )}
    </div>
  )
}

function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}) {
  return (
    <button
      type="button"
      className={`toggle ${checked ? 'checked' : ''}`}
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  )
}
