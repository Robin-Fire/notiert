# captured

captured is a Windows desktop app for capturing a thought quickly and keeping it on the same device. It works offline and has no account, analytics, AI provider, or backend.

## Requirements

- Windows 11 x64 for supported builds
- Node.js 22 or newer and npm
- Visual Studio Build Tools are not required for the standard install; `better-sqlite3` installs its Electron compatible native binary through electron-builder

## Development

```powershell
npm install
npm run dev
```

Useful configured commands:

```powershell
npm run typecheck
npm run build
npm test
npm run smoke:calendar
npm run smoke:tasks
npm run smoke:capture
npm run smoke:taxonomy
npm run dist:win
```

`npm run dist:win` creates a per-user NSIS installer in `release/`. The installer preserves the app data folder on upgrade and uninstall. Code signing is not configured; unsigned builds can show Windows trust warnings.

## Architecture

- Electron main process owns windows, tray, global shortcut, settings, clipboard actions, backup/export dialogs, and SQLite.
- Separate capture and notes preload scripts expose typed, narrow IPC APIs. Renderers have no Node integration or direct filesystem or SQL access.
- React and TypeScript render the two local windows. SN Pro and Geist Mono fonts, CSS, icons, and app code are bundled with the app; production does not load remote code.
- SQLite is authoritative. `better-sqlite3` uses WAL mode, foreign keys, full synchronous writes, migrations, and an FTS5 index for body and legacy meeting-title search.

## Data and recovery

The database and settings live under Electron's per-user `userData` directory. On Windows this is normally `%APPDATA%\captured\`. Installations upgraded from notiert or notable continue using their existing profile directory and database to preserve notes, settings, and backups. Use **Settings → Data → Open folder** to see the actual location.

captured creates local SQLite backups after the first successful write each day, before migrations, and before restore. It keeps seven daily automatic backups and the pre-operation recovery backups. Automatic backups are on the same disk and do not protect against disk loss. Create a backup somewhere else or export notes for an independent copy.

V1 exports notes as plain text or Markdown. Restore accepts a captured SQLite backup and replaces current data after an integrity check and a fresh safety backup. JSON export and JSON restore are outside V1. Text and Markdown exports are portable but are not full-fidelity restore files.

**Backlog** is the separate category-grouped page for captures and undecided tasks. Use Today, Tomorrow, or Next week on each item to plan it; captures become tasks in the same action. **Tasks** shows planned work in By time, By category, or Table layouts. The Table layout groups rows into Today, Tomorrow, Next week, and Later, with Upcoming when other future dates are present. All layouts share task intentions, filters, editing, completion, and drag-and-drop. Choose **Task** or **Note** while capturing to classify immediately; new tasks start in Backlog. Category assignment alone does not turn a capture into a task.

Drag task handles between horizons or category sections, or use **Move to…**. Changing categories clears an incompatible subcategory. Each category retains its existing priority order in category/tag pages; Tasks has its own shared order across its two layouts. Use the card checkbox to complete a task and **Completed** to review or reopen work. Sorting and moving offer Undo; an intervening edit can make Undo unavailable. Search, category/subcategory filters and independent include/exclude tag filters apply before pagination. The layout and collapse preferences are remembered. On narrower windows, Unplanned and Later fold into count rails to keep the near-term horizons visible; expand them with their headings or the overview controls.

Task plans use local dates or Monday week anchors. Tomorrow becomes Today naturally; unfinished past days and weeks stay in Today with a carried-over label. A week intention does not assign a weekday or an hour. **Calendar remains the existing scheduling workspace**, with Day, 3 days, and Monday–Friday Workweek views, its Ready panel, meeting creation/recurrence, drag/resize controls, and configurable visible hours. Task intentions and calendar placements are independent: moving a task to Later or Next week does not remove or reschedule its time block, and calendar actions do not rewrite its task plan. Open task details for exact scheduling. Calendar's unscheduled Ready list remains separate for now.

Scheduled meetings are entered locally. Repeat supports daily, weekly, or monthly meetings through an inclusive end date, up to 366 occurrences; monthly repeats skip missing days. Outlook sync is not configured. Items have one optional category and one optional subcategory within it, plus multiple independent tags.

Schema 14 adds task intentions and persistent capture types. Upgrading preserves existing content and calendar placements: old Ready tasks start in Today, Backlog tasks in Unplanned, Later tasks in Later, and scheduled tasks receive an initial day intention. The app creates a pre-migration SQLite backup. Older versions cannot open schema 14; reverting the executable requires restoring the pre-migration backup and does not include subsequent edits.

Paste screenshots or other PNG, JPEG, WebP, or GIF images into the capture bar. A capture can contain text, images, or both (up to five images, 5 MB each, 20 MB total). Existing notes and tasks also accept Ctrl+V screenshots while editing; image changes save together with text and are discarded when edits are cancelled. Lists and Calendar show a small image count; details have an expandable Images section with thumbnails and a larger preview. Pasted images remain in the local draft until saved or removed, and stay attached when the Inbox item is filed as a note or to-do. SQLite backups include the images; text and Markdown exports embed them as data URLs, which can make exports large.

**All items** includes Inbox captures, reference notes, and to-dos. Its type and tag pills allow multiple selections; selected values within a group match any, and the type and tag groups combine. Category pages include direct items under **No subcategory** and items in their subcategories. Tasks offers category/subcategory filters and a separate tag filter to show or hide matching labels. Capture opened from a subcategory or tag page preselects that context when the draft is empty.

Upgrading an older profile creates subcategories from category-linked tags, while preserving every existing tag and item-tag association as independent labels. A subcategory is assigned only when exactly one legacy label matches the item's existing category. Ambiguous or mismatched items appear in **Review subcategories**; normal use remains available, and items in Trash can be included in review. A pre-migration SQLite snapshot is created before upgrading to schema 12. Older supported backups follow the same migration when restored. Older app versions cannot open schema 12; recovering with an older executable requires the pre-migration snapshot and does not include edits made after the upgrade.

Notes are ordinary local files and are not encrypted by captured. Offline operation and capture exclusion do not mean encryption at rest. Protect the Windows account and disk. Do not sync the live SQLite database through a shared folder.

## Privacy and screen sharing

captured requests Windows capture exclusion for its windows before showing them. Capture exclusion is best effort: Windows, meeting apps, browser sharing modes, and recording tools can behave differently. It does not guarantee that notes are invisible. Test from another participant or device after changing the app, capture mode, or Windows build. File pickers are native Windows windows and may be visible.

The application stores note text and pasted images in SQLite and the active capture renderer. It does not put note contents in logs, notifications, or tray menus. Redacted diagnostics include app and OS versions, shortcut status, and database availability.

## Keyboard behavior

- `Ctrl+N` opens capture by default; `Ctrl+Alt+N` is offered on first run. The shortcut can be changed or disabled in Settings.
- `Enter` saves in capture; `Shift+Enter` inserts a newline; `Esc` saves the draft and closes capture.
- `Ctrl+F` focuses note search; `Ctrl+S` saves edits; arrow keys navigate note rows; `Delete` moves selected notes to Trash outside text inputs.

The global shortcut can be unavailable if another application owns it. captured reports that state and retains tray capture. It does not silently select a different shortcut.

## Release checks still requiring a real Windows session

Before distributing a release, record the Windows build and test shortcut registration, focus return, mixed DPI and monitor removal, elevated/full-screen foreground apps, IME and German keyboard layouts, the packaged installer and upgrade, and capture exclusion in Teams desktop, Teams browser where relevant, Zoom, and a recording path. Confirm screen-share output using a second participant/device. A successful build alone does not verify those Windows behaviors.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [resources/licenses](resources/licenses/) for font and dependency license references.

Tasks scrolls as one page. Planned tasks move by dragging their grip; Backlog also has quick planning buttons. The columns have no individual scrollbars. The removed This week bucket is deferred to Later during schema 15 migration, without changing calendar placements.
