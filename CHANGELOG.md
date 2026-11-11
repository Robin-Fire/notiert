# Release notes

## 0.1.23 - 2026-11-11

- Make sidebar headings easier to scan and use a background highlight for selected pages, categories, and tags.
- Filter Tasks from the sidebar and reorder tags in place by dragging their handles.
- Match Table drag previews to the original row and keep tag labels on a single line.
- Keep task groups and Kanban columns stable during drag by using their existing surfaces as drop targets.
- Place tasks at the top when moving them to a different priority bucket without specifying a row.

## 0.1.22 - 2026-11-06

- Replace the task Undo banner with a floating toast that dismisses automatically after ten seconds, pausing on hover or keyboard focus.
- Restore the By priority kanban board with side-by-side columns and wrapping task cards.
- Keep links as plain text on the Tasks page and clickable in individual task details.

## 0.1.21 - 2026-11-06

- Refine task views with compact single-line rows, quieter metadata, and aligned Done and Tags actions.
- Move search to the sidebar, simplify category and tag pages, and keep exports in Settings.
- Use a clearer shared task editor from Tasks, category pages, and tag pages.
- Improve sidebar spacing, selection states, narrow layouts, and category/tag editing controls.
- Add clickable task links and improve capture accessibility, export feedback, and shortcut status.

## 0.1.20 - 2026-11-03

- Prevent Quick Capture flicker when opening category and tag pickers.
- Keep Quick Capture open while selecting metadata and remove unused space below its footer.
- Simplify task cards, table rows, and drag previews with colored subcategory labels.

## 0.1.19 - 2026-11-03

- Fix copying attached task images through the native clipboard, including JPEG images.
- Open Quick Capture category and tag pickers upward, with space beyond the capture card.
- Make the Quick Capture tags button match the compact category picker.
- Align modal fields and actions, improve scrolling and narrow layouts, and use neutral focus indicators.
- Improve keyboard focus containment in capture and first-run dialogs.

## 0.1.18 - 2026-11-02

- Show assigned tag colors in Tasks table rows, search results, and drag previews.
- Remove Review subcategories from the sidebar.
- Use the shared tag picker in quick capture and expand the window for open pickers.
- Update application dependencies and the service coverage register.

## 0.1.17 - 2026-10-22

- Include the pending task interface improvements omitted from 0.1.16.
- Show priority and tag actions on hover in task cards and table rows.
- Use a shared tag popover in task and calendar forms, with inline hash tags.
- Add tags to quick capture and combine category and subcategory into one picker.
- Add copying attached images to the clipboard.
- Improve drag scrolling and ordering, hide empty Unsorted columns, and simplify task controls.
- Include the standalone service coverage register and its documentation.

## 0.1.16 - 2026-10-22

- Count only open tasks in sidebar tag and subcategory counters.
- Refresh sidebar counters when completing or reopening tasks.
- Remember expanded and collapsed sidebar sections and categories across restarts.

## 0.1.15 - 2026-10-18

- Combine Backlog and Tasks into one Tasks page with Unsorted, Now, Next, Soon, and Later priority buckets.
- Keep priorities fixed until moved, independently of calendar dates and scheduled time blocks.
- Migrate existing plans to priorities while preserving task order, content, and calendar schedules.
- Support shared search, filters, bulk priority changes, drag-and-drop ordering, and Undo in board and table layouts.
- Preserve former notes as completed tasks and captures as Unsorted tasks, with a simpler app structure and automated checks.

## 0.1.14 - 2026-10-08

- Focus the app on tasks, hide existing notes without deleting them, and remove note creation actions.
- Remove All tasks navigation and the By category layout; Tasks search includes planned work, Backlog tasks, and captures.
- Add persistent category colors and show colored tags at the bottom right of Kanban cards.
- Rename unassigned Backlog groups to Inbox and improve task section dividers.
- Simplify category navigation and group direct tasks before collapsible subcategory panels.
- Add Settings → Calendar → Show Calendar to hide the page from the sidebar and tray while preserving calendar data.

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
