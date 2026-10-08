# Tasks workspace implementation plan

Date: 2026-10-08. Status: implementation plan; application changes have not started.

## 1. Baseline and objective

The current working tree was clean. The annotated Git tag `checkpoint/tasks-redesign-2026-10-08` preserves commit `246aa8c88d110cf7b4fb5333e79d2254181e3785` (Release 0.1.11: Ready board and consistent item editing). This is the application baseline before the redesign; the plan is committed separately.

Replace the separate Inbox, Backlog, Ready, and Later navigation destinations with one **Tasks** workspace. The user should be able to see near-term work and sort captures without repeatedly changing pages. Preserve the useful category-board layout through a second layout of the same tasks.

**Calendar stays as it is for this iteration.** Preserve its view modes, Ready panel, scheduling, drag/resize behavior, creation dialogs, meetings, recurrence, settings, and existing reconciliation behavior. Task intentions must not create, reschedule, or remove calendar placements.

## 2. Agreed direction and implementation defaults

Agreed direction:

- One Tasks destination includes the work previously spread across four pages.
- Time layout shows Unplanned, Today, Tomorrow, This week, Next week, and Later together; these are columns, not tabs.
- Category layout retains category columns, grouping cards by horizon inside each column.
- Cards can move directly between horizons. Category and subcategory remain independent metadata; tags remain independent labels.
- Captures can be sorted in the workspace. Choosing a category alone does not imply that a capture is a task.
- Later remains distinct from Unplanned: deliberate deferral versus an undecided intention.

Defaults below make the plan implementable. They are proposed product decisions, not additional requests already made by the user:

- Default to time layout; remember the last selected layout locally.
- Use Monday-start calendar weeks, consistent with the existing Workweek calendar.
- Use dates and week anchors internally, rather than permanently storing labels such as “Tomorrow”.
- Move existing unscheduled Ready tasks to Today during migration. Backlog becomes Unplanned; existing Later becomes Later.
- Preserve future plans beyond next week in an additional **Upcoming** section, displayed only when populated. They must never vanish from the workspace.
- Keep reference notes in existing All items/category/tag pages after filing.

## 3. Workspace and visual structure

### Time layout

Toolbar: title and open-task count; search; category/subcategory and tag filters; By time / By category layout control; Add task.

Board columns: **Unplanned | Today | Tomorrow | This week | Next week | Later**. Each column has a count and quick-add action. Each task appears once. Show category name/color, optional subcategory, tags and image count on the card, using the existing visual language.

Unplanned includes two visibly separated groups: **New captures** and **Tasks without a plan**. Captures use a distinct treatment and have actions to file as Note or Task. Dragging a capture into a planning column classifies it as a task and assigns its intention in one transaction. A capture can also become an unplanned task in one click.

Later can collapse to a narrow labeled count rail. Unplanned's capture group can collapse independently, with a visible count of items waiting to be sorted. Collapsing never filters tasks out of counts.

Use compact cards and flexible column widths. At desktop widths prioritize Today, Tomorrow, This week and Next week, with the peripheral columns collapsible. On narrow windows keep a single horizontally scrollable board and a persistent horizon summary with counts and scroll-to-column controls. Do not replace the board with single-horizon tabs. Confirm the actual minimum supported window width in visual QA before fixing widths.

### Category layout

Keep the current Ready board's category order, familiar card treatment, column scrolling and Unassigned fallback. Within every category show sections in the same horizon order. Empty sections remain available as compact drop targets when dragging; otherwise hide them. Show a separate New captures panel so unresolved captures do not masquerade as tasks.

Allow horizon movement within a category and across category columns. Dropping into another category changes category and horizon atomically; clear a subcategory that does not belong to the destination. Make the destination explicit in drag feedback. In time layout, moving columns never changes category.

Both layouts are projections of the same query and mutation model. Switching layout preserves search and filters; it must not change planning state or task order.

### Card interactions

- Completion checkbox; open/edit body; optional metadata; Move to menu.
- Move to offers Unplanned, Today, Tomorrow, This week, Next week, Later, and Choose date/week for less common future plans.
- Quick-add in a horizon preselects that intention; quick-add in a category section preselects category and intention.
- Pointer drag and keyboard/menu alternatives provide equivalent operations.
- Show an immediate Undo after classification or horizon movement. Undo restores item type and metadata/order when appropriate, but uses revision checks to avoid overwriting intervening edits.
- Failed mutations restore the visible state and show a useful error; stale revisions reload the affected data.
- Done items leave the active board. Offer an optional completed-items section for review and reopening, without another navigation page.

## 4. Horizon semantics and rollover

Model a task intention as one of:

1. **Unplanned**: no selected day or week.
2. **Day**: a local ISO date; Today and Tomorrow resolve to absolute dates when selected.
3. **Week**: the local ISO date of that week's Monday; do not invent a specific weekday or time.
4. **Later**: deliberate deferral without a date.

Derive visible buckets using one local-date helper shared by queries and previews:

| Stored intention | Visible location |
| --- | --- |
| No intention | Unplanned |
| Day before today | Today, labeled Carried over with original date |
| Day equals today | Today |
| Day equals tomorrow | Tomorrow, even when tomorrow starts another week |
| Remaining day in current week | This week |
| Remaining day in next week | Next week |
| Current-week anchor | This week |
| Next-week anchor | Next week |
| Past-week anchor | Today, labeled Carried over from its original week |
| Later day/week | Upcoming, grouped by date/week |
| Explicit Later | Later |

Exact-day checks take precedence over week checks, so a task is never duplicated. Current-week intentions remain in This week through Sunday; they do not silently become Friday commitments. Use local calendar arithmetic, not addition of 24-hour millisecond intervals, across daylight-saving transitions.

Refresh classification at local midnight, app resume/focus, and timezone changes. Recompute views without rewriting stored intentions or incrementing item revisions. Counts, filters, and drag destinations must all use the same reference date for a request.

Completion retains the intention for review; reopening returns to the derived bucket, including carried-over treatment. Existing calendar completion/reopening behavior may reset legacy calendar fields as it does today; it must not erase the new task intention.

## 5. Data model and migration

Current storage uses schema 13 and combines legacy placement through `task_ready`, `is_later`, `planned_date`, timed start/end, `task_position` and `backlog_position`. These cannot safely represent the new horizons: `reconcileReadyTasks()` clears old/date-only calendar placements, and calendar scheduling also rewrites legacy Ready/Later state.

Add an independent one-to-one `task_intentions` table in migration 14, keyed by note ID with a foreign key and cascade deletion. Suggested fields: `kind` (unplanned/day/week/later), nullable `target_date`, and an independent integer `position`. Enforce day/week payload invariants and valid local dates in the validated write layer, with SQL checks where practical. Require week anchors to be Mondays. Note revision remains the concurrency token; intention mutations bump it transactionally.

Index kind/date/order for horizon queries. Maintain one Tasks order per stored intention destination, shared by both layouts; category filtering presents a subsequence of that order. Keep `backlog_position` and `task_position` intact for legacy category priority and calendar operations. The new board must not call the old Ready/calendar reorder endpoint.

Migration is transactional and backed by the existing pre-migration SQLite snapshot mechanism:

- Preserve all note IDs, content, images, tags, categories/subcategories, task status and calendar fields.
- Existing Later tasks become Later intentions.
- Existing dated/timed tasks receive an initial day intention from their stored date or local start day. This copies an initial intention; it does not alter the schedule.
- Existing undated Ready tasks receive migration-day intentions, preserving their relative Ready order.
- Remaining tasks receive Unplanned intentions, ordered using category order and existing backlog priority with a stable ID tie-breaker.
- Retain legacy completed tasks and assign suitable intentions without adding them to the active board. Include trashed tasks so restoring them does not lose planning metadata.
- Existing Inbox items remain captures, including those with categories; existing notes remain notes.

Capture migration's local reference date once. Update maximum schema/version validation, backup restore validation, migration tests, export metadata and restore integrity checks for version 14. Restoring older supported backups runs the migration. An older executable cannot open schema 14; recovering the old application requires the pre-migration backup, not merely checking out the Git tag.

New legacy calendar-created tasks also need an intention row, initialized without changing their calendar behavior. Intention writes must invalidate the new summary/query caches and broadcast changes. Permanent deletion cascades intentions; soft deletion hides them; category deletion moves cards to Unassigned as before.

## 6. Calendar compatibility boundary

- Do not change `CalendarView.tsx`, `useCalendarMutations.ts`, `useReadyDrag.ts`, meeting behavior or calendar settings for this redesign.
- New horizon movement writes only intention/type/order and the ordinary item revision/updated time. It never writes calendar placement fields or clears a timed schedule.
- Calendar actions continue writing their current legacy fields. They do not continuously move Tasks intentions. Migration and initial task creation are the only automatic initialization points.
- Existing tasks in Calendar's Ready panel remain there according to the existing rules, even after receiving a Tasks intention. Choosing Today does not automatically add a task to that panel.
- Show existing calendar schedule metadata on Tasks cards/details where useful. A task planned for Tomorrow but scheduled today can display both; the intention expresses work planning, the schedule remains authoritative for calendar placement.
- Keep the existing scheduling editor available from task details. Preserve legacy Ready controls there with explicit “Calendar Ready” wording where clarification is needed; do not add another Ready destination in navigation.
- `reconcileReadyTasks()` must neither read nor mutate intentions. Opening Calendar must not move cards between task horizons.

This intentionally leaves Calendar's existing Ready concept alongside the new workspace temporarily. Unifying those concepts is a later product change, outside this plan.

## 7. Capture and classification

Add a compact capture type choice: **Capture** (default), **Task**, **Note**. Keep Enter/Escape and existing image handling. Persist the selected type with the capture draft and clear it after successful submit; do not change type merely because category/tag context was preselected.

- Capture: enters New captures inside Tasks, preserving category/subcategory/tags/images.
- Task: goes directly to its category as Unplanned by default. An optional compact intention selector can choose Today/Tomorrow/etc.; keep it out of the default capture path.
- Note: files directly as a reference note, available through existing item/category/tag views.

Make classification plus intention assignment one database transaction. Avoid sequential classify-then-move calls: a failure must not leave a capture half processed. Preserve existing local Inbox tag drafts where possible when presenting captures in the new workspace; remove drafts only after a successful sort and retain committed tags/images through Undo.

Capture request IDs, draft generation/revision checks, retry idempotency and image limits remain intact. Mirror this behavior in the browser preview capture dialog.

## 8. Contracts, queries and renderer wiring

### Shared/storage/API

- `src/shared/contracts.ts`: add intention/card/query/summary schemas; validated intention move, reorder and classify-with-intention inputs with expected revisions; additive capture type/intention fields with backward-compatible defaults.
- New `src/shared/taskHorizons.ts`: pure local-date classification and destination resolution helpers, with an injectable reference date.
- `src/main/storage/database.ts`: migration 14, board query/counts, transactional movement/reordering/classification and capture writes; preserve old calendar methods.
- `src/main/index.ts`, `src/preload/index.ts`, `src/preload/capture.ts`: typed, role-limited IPC endpoints and change broadcasts.
- `src/renderer/browserPreview.ts`: equivalent in-memory queries, validation, move semantics and clock behavior.

Queries filter in storage before pagination. Summary counts use the same predicates as cards. Paginate per stored destination/group, with stable position/ID cursors; carry a reference date and detect stale board pagination after midnight or mutations. Do not filter a first page client-side and claim that it represents all matches.

Filtered drag inserts relative to a validated visible target in the full destination order, preserving hidden items' relative order. An explicit end drop appends to the full destination, including unloaded items. Validate source revision and target membership inside the transaction; reject stale targets. Category edits use the existing subcategory validation.

### Renderer

- New `src/renderer/tasks/TasksView.tsx`: toolbar, shared data hook, layout preference and detail dialogs.
- New task board helpers/components: time board, category board, task card, capture card/panel, destination menu and pure order helpers.
- Reuse the existing ReUI Kanban components and `dnd-kit` where their semantics fit; inspect nested category-section droppable support before choosing the implementation. Avoid competing drag contexts on the same surface.
- Reuse CategoryPicker, TagFilter, TagEditor, ItemImages and existing item/task detail editors; add the intention controls and keep body/image save/cancel guards.
- `src/renderer/notes/NotesApp.tsx`: replace four sidebar entries with Tasks; retain Calendar and the other existing destinations. Route old Inbox navigation from main/tray/preloads to Tasks with New captures expanded. Preserve legacy route handling for existing callers.
- `src/renderer/capture/Capture.tsx`: compact type selection and persistent draft fields.
- `src/renderer/styles.css`: board layout, horizon sections, metadata, drag feedback, collapse rails and focus states using current fonts/colors/components.

In category/tag/All items views, add intention labels where useful instead of treating legacy `later` as the new planning source of truth. Keep unrelated sorting and filtering semantics intact.

## 9. Delivery sequence

1. **Domain and compatibility tests:** implement pure horizon rules and lock in current calendar behavior; verify date/week boundaries before UI work.
2. **Storage and migration:** add schema 14, metadata backfill, transactional writes, ordering and query/counts. Verify upgrade and restore against temporary databases.
3. **Typed API and preview:** expose the new endpoints and mirror behavior in browser preview. Keep old views functional during this stage.
4. **Time board:** deliver all visible horizons, integrated captures, filters, quick-add, completion, menus, movement and Undo. Validate width/scrolling with realistic data.
5. **Category board:** preserve the familiar layout, add horizon sections and category/horizon moves. Use the same query and ordering model.
6. **Capture and navigation:** add capture type persistence, replace sidebar destinations, redirect old Inbox requests, and update detail/category/tag labels.
7. **Cleanup and documentation:** remove obsolete standalone view components only after callers are migrated; retain legacy APIs needed by Calendar. Update README and add a short explanation of intentions versus calendar scheduling.
8. **Release verification:** run applicable checks, visually inspect both layouts and Calendar, and package only after the acceptance criteria pass.

Use focused commits for domain/storage, APIs, each layout, capture/navigation and verification. Do not ship an intermediate schema/UI mismatch.

## 10. Verification and acceptance

Meaningful automated coverage:

- Horizon classification around Monday/Sunday, month/year boundaries, leap days, daylight-saving changes, local timezone changes, stale dates/weeks, and future plans beyond next week.
- No duplicate bucket membership; Tomorrow precedence at a week boundary; consistent query totals and pagination.
- Schema 13 to 14 migration with Inbox, categorized captures, Ready, Backlog, Later, scheduled, completed and trashed tasks; no lost metadata; backup/restore of old and new schemas.
- Atomic classify/move and Undo; idempotent capture submit; stale revisions/targets; reorder with search/tag/category filters and unloaded destination cards; rollback on failure.
- Both layouts contain identical matching task IDs and share horizon/order changes. Completion/reopening and category deletion behave consistently.
- Calendar operations leave intentions intact, and task intention operations leave all calendar placement fields intact. Existing calendar regression suites continue to pass.
- Capture type/draft persistence, retry and image transfer; old Inbox navigation opens the new sorting area.

Run `npm run typecheck`, `npm test`, and `npm run build`. Run `npm run smoke:capture`, `npm run smoke:taxonomy`, and `npm run smoke:calendar` for the affected Electron paths. Extend existing integration tests and add focused task-horizon/workspace tests. Retire old Ready-layout-only tests when that view is removed, retaining any coverage still required for Calendar.

Visual/manual acceptance:

- Today, Tomorrow, This week and Next week can be inspected together at a normal desktop width; narrow-window scrolling is clear, with counts always discoverable.
- Sorting a capture into a horizon takes one action. Capturing an explicitly typed task with a category skips sorting.
- Category layout remains recognizable to a frequent user of today's Ready board.
- Pointer and keyboard/menu movement work across horizons, empty groups and categories. Error recovery never leaves a disappeared card.
- Images, long text, many tags, empty categories, large task counts and dark/light themes render cleanly.
- Layout/collapse preferences persist. Search/filter state survives layout switches.
- App left open overnight or resumed after several days shows carried-over work correctly.
- Calendar looks and behaves as before, including Ready tasks, meetings, resizing, settings and old-task reconciliation.

The implementation is complete when Inbox/Backlog/Ready/Later are consolidated into Tasks, both overview layouts work against persistent data, capture sorting and horizon movement avoid page changes, migrations preserve existing items, and Calendar regression checks pass unchanged.
