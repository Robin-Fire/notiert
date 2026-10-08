# Release notes

## 0.1.13 - 2026-10-08

- Refine Tasks table and Backlog rows, inline tag picking, quick planning, and wide-screen Kanban columns.
- Remove repeated table column headers and the Today column's blue top border.
- Match drag previews to rows, show drop areas and insertion indicators, and reveal empty Backlog categories while dragging.
- Preserve captures when dragging between Backlog categories, fix cross-category insertion, and cancel drops outside valid targets.

## 0.1.12 - 2026-10-08

- Organize planned tasks in Today, Tomorrow, Next week, and Later, with category and grouped table views.
- Restore a separate Backlog page with quick planning buttons and a searchable tag picker that can create tags.
- Scroll the whole Tasks page, simplify task cards, and fix the drag overlay returning to its previous column.
- Replace browser-default dropdowns throughout the app with shared ReUI selects.
- Preserve calendar placements; migrate the removed This week bucket to Later.

## 0.1.8 � 2026-10-02

- Use the same edit modal for Inbox, All Items, category, tag, backlog, and calendar items.
- Show attached image previews automatically in the editor and keep Inbox tag drafts when editing.
- Improve category and tag dialogs, collapse indicators, and visibility of empty backlog groups and subcategory filters.
- Refine the capture bar layout and measure its height from its content.

## 0.1.1 — 2026-09-25

- Removed keyboard hints and the shadow from the capture bar.
- Fixed capture sizing so typing on the same line does not repeatedly resize the window, while wrapped and multiline notes can still expand its height.

## 0.1.0 — 2026-09-25

- Added a Windows capture bar with a global shortcut, draft recovery, and local SQLite saves.
- Added searchable notes, editing, copy, date filters, Trash, and multi-select actions.
- Added optional manual meeting sessions. Captures inherit the active meeting; existing notes cannot be assigned to a meeting in V1.
- Added local backups, SQLite restore, and TXT/Markdown exports. JSON archive export and restore are not included in V1.
- Added bundled Geist fonts, light/dark/system themes, tray controls, and a per-user Windows installer.

This unsigned personal build has not completed the real-device Windows focus, multi-monitor, installer-upgrade, IME, or meeting-app screen-share acceptance checks listed in the README.
