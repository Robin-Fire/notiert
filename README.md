# captured

captured is an offline Windows desktop app for capturing thoughts and planning tasks. It has no account, analytics, AI provider, or backend.

## Development

Supported builds target Windows 11 x64. Install Node.js 22 or newer, then run:

```powershell
npm install
npm run dev
```

Useful checks and release commands:

```powershell
npm run typecheck
npm test
npm run build
npm run smoke:tasks
npm run smoke:calendar
npm run smoke:capture
npm run smoke:taxonomy
npm run dist:win
```

`better-sqlite3` installs its Electron-compatible binary through electron-builder; the standard install does not require Visual Studio Build Tools. `dist:win` creates a per-user NSIS installer in `release/`. App data survives upgrades and uninstall. Builds are currently unsigned. Pull requests and pushes to main/master run typechecking, tests, and a build; release tags also build the installer.

## Using the app

**Capture** opens a small window with the global shortcut. Every saved capture is a task in **Unsorted**. Assign a category, subcategory, and independent tags while capturing. There is no separate note type or classification step.

**Tasks** opens by default and combines all captured and prioritized work in one page. By priority and Table layouts share five buckets: Unsorted for new captures, Now for current focus, Next for high priority, Soon for medium priority, and Later for very low priority. Buckets stay fixed until you move a task; they never become overdue. Drag grips to move or reorder tasks, or use the priority actions. Moving and completing offer Undo, which refuses to overwrite later edits. Bulk selection moves up to 100 loaded tasks together.

Search, category/subcategory filters, and include/exclude tags apply before pagination. Active filter chips can be removed individually or cleared together. Unsorted and Later can collapse into count rails on narrow windows.

**Task details** saves text, images, tags, category, priority, and schedule with one **Save** action or Ctrl+S. All changes commit together. Closing with unsaved changes asks whether to discard them.

**Calendar** has Day, 3 days, and Monday–Friday Workweek views, configurable visible hours, a Ready panel, and drag/resize controls. Calendar placements are independent of priority. Changing a task's priority does not reschedule its time block. Scheduled times appear on task cards and Table rows. Meetings are entered locally; daily, weekly, and monthly recurrence supports an inclusive end date and up to 366 occurrences. Monthly recurrence skips missing days. Outlook sync is not configured.

**Search** includes open and completed tasks across all priority buckets. Results show an Open or Completed label and can be opened and edited without reopening the task. Full text and tags are searchable; category/subcategory and tag filters apply before pagination. The Completed toggle explicitly limits results to completed tasks when selected. **Review subcategories** resolves ambiguous assignments retained from older taxonomy migrations.

Paste PNG, JPEG, WebP, or GIF images with Ctrl+V in capture or item editing. Each item supports up to five images, 5 MB each and 20 MB total. Images save with text and are discarded when edits are cancelled. Details provide thumbnails and a larger preview.

## Keyboard behavior

- Ctrl+N opens capture by default; first-run setup also offers Ctrl+Alt+N. Change or disable it in Settings.
- Enter saves capture; Shift+Enter adds a newline; Esc retains the draft and closes capture.
- Ctrl+F focuses search in Tasks, category/tag lists, and Trash.
- Ctrl+S saves all changes in item details. Esc asks to discard unsaved edits before closing.
- Arrow keys navigate item list rows; Delete moves selected items to Trash outside text inputs. Task dragging supports the keyboard through its grip.

If another app owns the global shortcut, captured reports that state and retains tray capture without silently choosing another shortcut.

## Architecture

- Electron main owns windows, tray, shortcuts, settings, clipboard, dialogs, and SQLite. Typed preload APIs keep renderers away from Node, SQL, and the filesystem.
- React renders capture and the main workspace. Sidebar navigation and Settings are separate components. Categories and tags share one subscription and ignore stale responses.
- SQLite is authoritative, with WAL, foreign keys, full synchronous writes, migrations, and FTS5 search. Upgrades live in `src/main/storage/migrations.ts`; live operations live in `database.ts`.
- Workspace loading returns first pages and shared counts in one IPC request and one read transaction. Later pages retain independent cursors.
- Browser preview uses local sample data and mirrors task operations for UI development. The packaged app uses SQLite.
- Fonts, CSS, icons, and code are bundled; production loads no remote code.

## Data and recovery

The database and settings normally live in `%APPDATA%\captured\`. Profiles upgraded from notiert or notable retain their existing directory. **Settings → Data → Open folder** shows the actual location.

captured makes SQLite backups after the first successful write each day, before migrations, and before restore. It keeps seven daily automatic backups and pre-operation recovery backups. These are on the same disk; create a backup elsewhere for protection against disk loss. Full backups include tasks and their images.

Restore accepts a captured SQLite backup, checks integrity, makes a safety backup, and replaces current data. Text and Markdown exports are portable, but are not full-fidelity restore files. Images are embedded as data URLs and can make exports large. JSON export/restore is unavailable. Do not sync the live SQLite database through a shared folder.

The current schema is 18. Older backups migrate on restore. Schema 12 separated subcategories from independent tags; ambiguous labels remain available for review. Schema 14 introduced task plans and capture types. Schema 15 deferred the removed This week bucket to Later without changing calendar placements. Schema 16 added category colors. Schema 17 converts former notes into completed tasks and old captures into open Backlog tasks, preserving text, tags, categories, images, and Trash. Schema 18 converts Today to Now, Tomorrow to Next, and other future plans to Soon, preserving task order and calendar placements. Priorities stay fixed after this one-time migration. Upgrades and restored older backups use the same conversion. Older executables may require their pre-migration backup, which excludes subsequent edits.

## Privacy and release checks

Tasks and images are local files and are not encrypted by captured. Protect the Windows account and disk. Task contents are excluded from logs, notifications, tray menus, and diagnostics.

Windows capture exclusion is requested before showing windows, but is best effort. Windows versions, meeting apps, sharing modes, and recording tools behave differently; test from a second participant/device after changes. Native file pickers may be visible.

Before distribution, test shortcut registration, focus return, mixed DPI, monitor removal, elevated/full-screen apps, IME and German keyboard layouts, installer/upgrade behavior, and capture exclusion in Teams, Zoom, and a recording path. Automated builds cannot verify these Windows behaviors.

See [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) and [resources/licenses](resources/licenses/) for dependency and font notices.
