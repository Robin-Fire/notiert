# captured / Calenban review — 26 September 2026

## Outcome and scope

The original review found that the capture-to-Inbox data path worked in isolated storage checks, but the planning interactions needed corrections. The implementation follow-ups below record the subsequent functional and frontend changes; the detailed findings remain as the pre-fix review record.

Reviewed the renderer, shared contracts, preload bridge, main-process handlers, SQLite storage, styles, and implementation document. The findings below describe the pre-fix source and reproduction evidence; the implementation follow-up records what has since changed. The repository currently shows the application files as untracked, so findings describe the source rather than claiming a particular commit introduced them.

Evidence labels:

- **Runtime:** reproduced against the actual Store class and better-sqlite3 in a temporary database, using Node and an esbuild compilation of the storage module.
- **Source:** established from the implementation and control flow, without claiming a live UI reproduction.
- **Recommendation:** a product, accessibility, or maintenance improvement, with its rationale stated separately from confirmed defects.

At review time, the Electron executable was absent from the installed dependency directory. The original UI findings were source/CSS assessments. Later follow-ups restored Electron, checked rendered windows in an isolated profile, and exercised pointer drags. Keyboard drag and Windows screen-sharing behavior remain unverified. No user database was opened or modified.

## Implementation follow-up — 26 September 2026

All bug and maintainability findings below were addressed in the workspace. The first pass excluded the separate **Frontend improvements** table as requested; the frontend follow-up below now covers it.

| Finding | Current status |
| --- | --- |
| B01–B03 | Overdue tasks share the planner drag context. Opening an Inbox capture no longer loses detail selection. Dirty note edits guard navigation, opening another note, filters, and window-directed navigation with Stay / Discard / Save choices. |
| B04 | Task details expose full text, atomic body/tag editing, copy, Trash, and Return to Inbox. |
| B05, B12 | The planner shows seven days. Meetings are included on every overlapping local day, with continuation labels; anchors that no longer overlap fall back to the day-end lane. |
| B06 | Note keyboard commands run only in All notes / Trash, skip controls and dialogs, and keep arrow navigation on the note list. |
| B07–B10 | A pure drop resolver and ordered Unscheduled slot support before/after drops. Classification is one-shot and Inbox buttons become pending. Event plus anchor updates are transactional. Mutation errors are separate from refresh errors. |
| B11 | Event editing is a labelled modal with inline validation, field descriptions, Escape handling, focus containment, and focus restoration. |
| M01 | Change events are scoped to notes, planner, and settings. Capture/task mutations refresh the relevant view once; Inbox badges use a count query. Direct post-mutation duplicate note/planner reloads were removed. |
| M02–M03 | Planner fetching, day columns, cards, unscheduled tray, dialogs, and drop semantics are separate modules. Note row/tag projections and tag normalization are shared; unused `ItemTagSchema` was removed. Due-date storage stays in the existing migration but is explicitly deferred because there is no due-date UI or contract. |
| M04 | Renderer and storage share local date-bound/overlap utilities. Local-timezone and all-day rules, including behavior after a timezone change, are documented in `docs/calenban-domain-semantics.md`. |
| M05 | Inbox uses stable 50-item pages; completed unscheduled tasks load in batches of 100; planner data builds day/slot/event maps once. Active open unscheduled and overdue tasks remain visible. |
| M06 | Provenance is explicit in `docs/reui-kanban-adapter.md` and `THIRD-PARTY-NOTICES.md`: this is a local adapter using the documented ReUI composition as a reference, not copied upstream ReUI source. It uses dnd-kit directly and documents its narrower behavior. |
| M07 | Regression tests cover storage invariants, pagination, atomic event/task and body/tag writes, migration, DST bounds, drop resolution, Inbox navigation, dirty-edit prompts, keyboard scoping, tag editing, planner views, and meeting Undo. The Electron 44.4.5 runtime and SQLite native dependency were restored. Packaged startup and live pointer checks are recorded in the follow-up checks. Screen-sharing and keyboard drag remain unverified. |
| M08 | Capture and notes have separate HTML/React entry points. The capture entry no longer imports NotesApp, Calenban, or dnd-kit. Production renderer minification reduced the shared JavaScript runtime from 649.04 kB to 225.58 kB; the built capture entry is 6.15 kB and the Notes entry is 119.68 kB after the frontend additions. Capture imports only Latin Geist Sans 400; the Notes window imports only Latin subsets for the weights it uses. Capture still loads shared React/ReactDOM and the base stylesheet, so 225.58 kB is the common runtime, not the complete capture payload. |

**Functional follow-up checks:** `npm run typecheck`, `npm test` (13/13 at that point), `npm run build`, `npm run postinstall`, `npm run dist:win`, and `npm run smoke:packaged` passed. The packaged startup smoke test used a temporary profile, reported `startup_alive=True`, and removed the profile afterward. The expanded checks for the frontend follow-up are listed below. No user database was opened.

## Frontend follow-up — 26 September 2026

The frontend recommendations below are implemented in the workspace. The layout keeps compact meeting rows while making task text, time, tags, and meeting labels readable. A visible **Move** control offers Unscheduled and the gaps before, between, and after a day's meetings, so ordering does not require an exact task time.

| Area | Implemented behavior |
| --- | --- |
| Planner navigation | Day, three-day, and seven-day week modes; previous/next range controls; a day jump; a year in the date caption; an open-task count for each day. The three-day mode is the default. The Unscheduled tray and Past plan can be collapsed and start collapsed in narrow windows. A seven-day week scrolls horizontally instead of compressing text. |
| Tags | One shared chip editor with suggestions from existing tags appears in Inbox filing, note editing, and task details. Notes and Trash have a case-insensitive tag filter backed by storage. Inbox tag chips and in-progress text are kept as local drafts per capture when navigating away. |
| Drag feedback | The day-end drop target fills the visible lane. Pointer collision detection prioritizes a task card over its containing lane; source opacity and before/after insertion indicators are applied to the draggable wrapper. Past-plan tasks share the board drag context. |
| Meetings | Add meeting defaults to today when it is in the visible range, with an add action on each day. Deleting a meeting shows a ten-second Undo action, which restores the meeting and eligible task anchors/order. |

**Rendered checks:** An isolated, mocked Electron renderer (`scripts/visual-preview.cjs` and `scripts/visual-preload.cjs`) captured Calenban in light and dark themes at 100%, 125%, and 150% zoom, plus the seven-day mode, Inbox, note editor, and task detail. Screenshots and metrics are written to ignored `tests/.visual/` files. At 125% and 150%, the narrow layout left all three default day columns visible by collapsing the auxiliary trays. The seven-day mode kept readable column width with horizontal scrolling.

**Pointer checks:** Real Electron pointer input moved an Unscheduled task to blank day space, moved one directly before another task card, and moved a Past-plan task into a day. The intercepted planner requests contained the intended date and insertion anchor. Storage ordering and persistence have separate automated tests. These checks used mock data in a temporary profile; keyboard drag, Windows screen-sharing, and an installed-app end-to-end capture-to-restart flow have not been exercised.

**Frontend follow-up checks:** `npm run typecheck`, `npm test` (20/20), `npm run build`, `npm run dist:win`, and `npm run smoke:packaged` passed against the final source. The packaged startup check reported `startup_alive=True` with a temporary profile.

## Findings requiring fixes

### B01 · P1 · Past-plan tasks cannot use the advertised drag operation

**Evidence: Source.** `src/renderer/calenban/CalenbanView.tsx:119`; `src/renderer/components/reui/kanban.tsx:13`.

The overdue tray renders draggable `PlannerTaskCard` components before, and outside, `<Kanban>`. The dnd-kit context is created inside Kanban. Those cards therefore do not participate in the board’s drag context, although the copy explicitly tells the user to drag them onto a day. The day selector remains an alternative.

**Reproduction:** plan a task in a prior week, open the following week, and attempt to drag it from Past plan into a day.

**Fix:** place the tray and board under one DndContext and give the tray an appropriate sortable context. Verify pointer and keyboard moves from Past plan to a day and to Unscheduled, including persistence after reopening.

### B02 · P1 · Opening an Inbox item clears its detail selection

**Evidence: Source.** `src/renderer/notes/NotesApp.tsx:228`, `:96`, `:125`.

The Inbox open callback calls `nav('all')` and `openNote(id)` together. Changing view changes the memoized filter and `loadNotes` callback. Its effect clears `detailId` and `detail`, after `openNote` has set the selected ID. The asynchronous get response sets the detail object but does not restore `detailId`. The detail panel depends on that ID, so the item’s promised edit route is lost.

**Reproduction:** click the body of any captured Inbox item to open it for editing.

**Fix:** use an editor that can open independently of the reference-note list, or commit the destination view and selection through one navigation state. Verify opening Inbox items with zero and several filed notes, editing, saving, and returning to Inbox.

### B03 · P1 · Navigation silently discards unsaved note edits

**Evidence: Source.** `src/renderer/notes/NotesApp.tsx:130`, `:125`, `:96`, `:263`.

Sidebar navigation, opening another item, and filter changes can clear or replace the current detail without checking whether its text was edited. The existing discard dialog is reached through editor Cancel/Escape, not every navigation route.

**Reproduction:** edit a note without saving, then select Inbox/Calenban or another note and return. The unsaved body is gone.

**Fix:** centralize leaving the editor behind a dirty-state guard or persist editor drafts. Apply it to sidebar navigation, item changes, search/filter changes, and window-directed navigation. Verify Save, Discard, and Stay behavior for each route.

### B04 · P2 · Filed tasks have no full-content or editing route

**Evidence: Source.** `src/renderer/calenban/CalenbanView.tsx:153`; `src/renderer/styles.css:415`; `src/main/storage/database.ts:139`.

Task cards clamp both the title and continuation. They provide completion and movement controls but no open, edit, copy, trash, or classification-correction action. Filed tasks are excluded from All notes. A long captured task therefore cannot be read in full through the ordinary UI after filing, and mistakes cannot be corrected there. The stored body remains intact.

**Fix:** add a task detail panel with full text, editing, tags, copy, Trash, and an explicit conversion action. Opening details must not start a drag. Verify a multiline capture, a long task, and correcting an accidentally filed to-do.

### B05 · P2 · Weekend meetings can be saved but never revisited

**Evidence: Runtime + Source.** `src/renderer/calenban/CalenbanView.tsx:33`, `:143`; `src/main/storage/database.ts:220`.

The event form accepts Saturday/Sunday dates, but every view is Monday–Friday and navigation advances by whole weeks. A Saturday event was successfully stored and absent from both adjacent workweek queries. The user cannot find, edit, or delete it in Calenban.

**Fix:** offer a seven-day view or a visible weekend section/toggle. If workweek-only scheduling is intentional, reject unsupported dates with an explanation rather than silently hiding saved events. Verify Saturday, Sunday, and Today on a weekend.

### B06 · P2 · Global note shortcuts intercept other views’ controls

**Evidence: Source.** `src/renderer/notes/NotesApp.tsx:102`, `:114`, `:13`.

The global keyboard listener remains active in Inbox, Calenban, and dialogs. Its text-entry exclusion does not include buttons, and there is no active-view or `defaultPrevented` guard. With filed notes loaded, Enter on a button can call `openNote` and prevent the button’s normal activation. Arrow keys also continue manipulating the hidden note list.

**Fix:** scope list shortcuts to the focused note list and correct view; ignore interactive descendants and already handled events. Keep drag keyboard controls and modal controls independent. Verify Enter on File as To-do, Add meeting, Cancel, navigation, and task drag handles while reference notes exist.

### B07 · P2 · Dropping onto an unscheduled task is ignored

**Evidence: Runtime + Source.** `src/renderer/calenban/CalenbanView.tsx:69`; `src/main/storage/database.ts:238`.

The drop handler returns whenever the target task has no planned date. A dated task dropped directly onto an existing Unscheduled card therefore does nothing. Reordering unscheduled cards is also unsupported: storage constructs an empty destination list for a null date, rejects a non-null `beforeId`, and resets the moved task’s rank to zero. The tray nevertheless presents sortable cards and drag handles.

**Runtime result:** moving one unscheduled task before another raises “The task order changed. Reload and try again.”

**Fix:** treat Unscheduled as a real ordered slot in both drop resolution and storage. Verify descheduling onto a card, onto blank tray space, and reordering several unscheduled tasks after restart.

### B08 · P2 · Event updates can leave a partially changed schedule

**Evidence: Runtime.** `src/main/storage/database.ts:266`, `:271`, `:274`.

Saving an event performs the event upsert and subsequent anchored-task updates without an encompassing transaction. Injecting an SQLite failure during the anchor update left the event on Tuesday while its task still referenced that event on Monday. That task is not rendered in Monday’s end slot or Tuesday’s event slot. Event deletion already uses a transaction; event editing needs the same guarantee.

**Fix:** transact event write, anchor relocation, and rank normalization together. Verify rollback after an injected failure, and successful event moves with several anchored tasks.

### B09 · P2 · Repeated classification resets existing task state

**Evidence: Runtime.** `src/main/storage/database.ts:186`, `:192`; `src/renderer/inbox/InboxView.tsx:51`.

Classification checks existence/deletion but not that the item is still in Inbox. Repeating it for a filed task clears planned date, anchor, completion, and tags and sets it open again. The Inbox buttons also lack a pending state, allowing conflicting rapid filing requests.

**Runtime result:** a planned completed task became open and unscheduled with no tags after another `classifyItem(id, 'task', [])` call.

**Fix:** enforce `kind='inbox'` in the conditional write, return a useful already-filed result, and disable filing controls while a request is pending. Keep intentional note/task conversion separate so its retention rules are explicit.

### B10 · P2 · Failed moves erase their own error message

**Evidence: Source.** `src/renderer/calenban/CalenbanView.tsx:52`, `:40`.

The move failure handler sets an error and immediately reloads. A successful reload calls `setError('')`, erasing the failure explanation. The user sees the task snap back without a persistent reason.

**Fix:** separate mutation errors from load errors, refresh without clearing the failed-action message, and offer a retry or dismiss action. Verify a rejected stale target and a storage failure followed by a successful refresh.

### B11 · P2 · Event validation errors are behind the open modal

**Evidence: Source.** `src/renderer/calenban/CalenbanView.tsx:98`, `:117`, `:143`; `src/renderer/styles.css:270`.

Saving an event with end time before start time fails server validation and leaves the form open, but the error is rendered on the page behind the blurred modal overlay. The form has no inline failure state. It also lacks dialog semantics, focus containment, focus restoration, and an Escape close handler.

**Fix:** render validation and mutation errors inside an accessible dialog; relate field errors to their inputs, keep invalid fields visible, and manage keyboard focus. Verify invalid times, a failed save, Tab/Shift+Tab, and Escape.

### B12 · P2 · Overnight and multi-day meetings disappear on continuation days

**Evidence: Runtime + Source.** `src/main/storage/database.ts:227`; `src/renderer/calenban/CalenbanView.tsx:124`.

Storage correctly returns events overlapping the selected range. The renderer then includes an event only on its start date. A Sunday-night meeting continuing into Monday is returned by storage but appears in no displayed column. Tuesday continuation of a Monday–Tuesday meeting is likewise missing.

**Fix:** render day-overlap segments with “continues” labels and define which segment can anchor a task. Storage’s current anchor validation only accepts the event’s start day, so it must be updated alongside the renderer. Verify overnight, multi-day, and all-day boundaries.

## Frontend improvements

These recommendations describe the pre-fix source/CSS. The implementation and rendered checks are recorded in the frontend follow-up above.

| Priority | Observation and source | Proposed improvement |
| --- | --- | --- |
| P2 | Task titles are 10px, continuation/time text 9px, tags 8px, and overlap badges 7px (`styles.css:402`, `:415`, `:418`). | Keep compact 32–36px meeting rows, but use approximately 12–13px primary text and 11px secondary text. Check readability at 100%/125%/150% scaling and both themes. |
| P2 | The move selector is a blank 22px control until focused: `font-size:0` and `appearance:none` (`styles.css:425`). | Use an explicit Move icon/label with a stable size. Offer date and before/after-meeting placement in its menu so precise positioning is available without dragging. |
| P2 | The default window is 1040px wide, while five day columns require at least 1025px before the sidebar, tray, padding, and gaps (`main/index.ts:124`, `styles.css:384`, `:386`). | Deliberately support a one-day/three-day/workweek mode or a collapsible tray. Make offscreen days and horizontal navigation clear; avoid shrinking text to squeeze all days in. The below-620px layout is normally unreachable with the current 760px minimum window at 100% scaling. |
| P2 | Tags are editable only while filing. The renderer does not call the exposed `notes.setTags`; there is no tag filter in NoteFilter (`contracts.ts:20`, `notes/NotesApp.tsx:256`). | Add reusable tag chips with suggestions, editing in item details, and a tag filter. Preserve the agreed tags-only model rather than adding projects/categories. |
| P2 | Inbox tag input is local component state until filing (`inbox/InboxView.tsx:44`). | Persist tag drafts or clearly mark them as unsaved. Navigating away or opening an item should not silently lose entered tags. |
| P2 | Empty end-slot wrapper can grow while its actual droppable child retains a small minimum height; nested lane and item targets use closest-center detection (`styles.css:397`, `:399`; `components/reui/kanban.tsx:13`). | Fill the visible end slot with the drop target. Use an insertion marker and make target selection predictable over blank areas. Validate nested collisions with real pointer tests before choosing a collision strategy. |
| P3 | Dragging classes are placed on `.reui-kanban-item`, but opacity/z-index rules target `.planner-task-card.is-dragging` and `.planner-task-card.is-active` (`components/reui/kanban.tsx:30`; `styles.css:419`). | Match the selectors to the wrapper so drag-source dimming actually applies; keep overlay and insertion feedback consistent. |
| P3 | Meeting deletion is immediate with no recovery UI (`calenban/CalenbanView.tsx:101`). | Offer Undo after deletion. This preserves a fast compact interface while allowing recovery from an accidental click. |
| P3 | Add meeting always defaults to Monday at 09:00 (`calenban/CalenbanView.tsx:78`). | Default to today when viewing the current week and provide a per-day add action. |
| P3 | Week caption omits the year, and task/day counts emphasize completed work rather than the current load (`calenban/CalenbanView.tsx:18`, `:126`). | Include year around year boundaries and show open-task count per day; keep workload information secondary to task content. |

## Maintainability and reliability improvements

### M01 · Consolidate refresh ownership

`notes.onChanged` and `planner.onChanged` subscribe to the same `notes:changed` channel (`src/preload/index.ts:12`, `:19`). NotesApp registers both and fetches the whole Inbox twice for its count on each change. It also refreshes notes and settings/displays while Calenban is active. Calenban then reloads from both the broadcast and the mutation’s success path.

Use one change subscription with scoped invalidation, a lightweight count query, and one refresh owner per operation. Keep settings refresh separate from task movements. Acceptance: instrument IPC counts for one move, one classification, and one completion and eliminate redundant full-list reads.

### M02 · Extract explicit domain operations and readable components

`CalenbanView.tsx` combines fetching, date arithmetic, mutation handling, drop resolution, task markup, and a large modal expression. `NotesApp.tsx` combines navigation, keyboard handling, editing, and settings. Many long single-line JSX blocks make ownership errors such as B01 difficult to notice.

Extract `usePlannerData`, a pure drop resolver, `DayColumn`, `TaskCard`, `EventDialog`, and a shared item editor. Format JSX across lines. Remove pass-through `useMemo(() => items, [items])` in KanbanColumnContent. Prefer an explicit lane type over parsing colon-separated IDs throughout the UI.

### M03 · Centralize storage mapping and invariants

Tag normalization and insert logic are duplicated in classification and tag editing. Note selection SQL repeats the legacy join and tag aggregation. Row types mark migrated columns optional and the planner projection uses a cast, obscuring which invariants v3 guarantees.

Share tag normalization, row projection, and slot-order operations; use precise migrated row types. Add suitable kind/status constraints in a future migration. `ItemTagSchema` is unused and due-date storage has no UI or contract: explicitly document them as deferred or remove unused API surface without rewriting already-applied migrations. Keep historical-session compatibility contained rather than expanding it into new UI code.

### M04 · Define date, timezone, and anchor semantics together

Dates are formatted/parsing independently in renderer and storage. Events are instants grouped using the computer’s current timezone; tasks use fixed date strings. Changing timezone can move a meeting into a different rendered day while its task retains the old planned date and anchor, leaving no rendered slot for the task.

Before Outlook work, define a planning timezone and all-day date semantics, share date utilities, and add an orphan-anchor fallback. Cover DST boundaries, timezone changes, overnight events, and weekend display. Do not add provider synchronization on top of ambiguous anchoring rules.

### M05 · Index derived view data and bound large queries

Every event lane scans the open-task list; each task’s day options repeatedly scan events. Inbox retrieval and unscheduled completed-task retrieval are unbounded, and badge counts fetch full note bodies. This is a scalability concern, not a measured performance failure.

Build maps by task ID, day, and anchor once per loaded dataset. Return a count rather than full Inbox bodies for the badge. Paginate or bound completed/old tasks and large inboxes. Measure representative datasets before adding virtualization or a state library.

### M06 · Make ReUI provenance and adaptation explicit

The local Kanban module describes itself as an adapted ReUI API and the notices attribute ReUI, but the source includes no pinned upstream source revision, registry recipe, or documented behavioral differences. A component name and matching API shape alone do not establish parity with upstream ReUI.

Record the exact upstream component/source version and adaptations, or clearly describe the module as a custom adapter with an intentionally limited contract. Verify the user’s requested ReUI usage against that provenance before claiming full component reuse. This review did not compare the module with upstream source.

### M07 · Add focused regression coverage and finish runtime setup

`package.json` defines typecheck/build scripts but no automated test runner. The current dependency installation lacks the Electron executable, so successful bundling is not proof the desktop app starts or that the renderer interactions work.

Prioritize Store tests for migration/restore, atomic event edits, classification guards, and ordering; React integration tests for Inbox navigation and keyboard scoping; and one Electron smoke flow for capture → Inbox → task → drag → restart. Keep tests behavior-oriented. Restore the Electron runtime installation and verify packaged Windows behavior before release.

### M08 · Separate the lightweight capture bundle from the planner

`src/renderer/main.tsx` eagerly imports both Capture and NotesApp; NotesApp eagerly imports Calenban and its drag dependencies. The production build emits one renderer JavaScript bundle of 883.35 kB (uncompressed), which the capture window loads as well. This is not a measured startup regression, but it works against the capture window's lightweight purpose.

Split window entry points or lazy-load NotesApp/Calenban, and include only the font subsets actually required. Measure time to usable capture and planner loading before and after; keep a loading fallback that does not hide a capture draft.

## Verification performed

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed during this review. |
| `npm run build` | Passed during this review; main, preload, and renderer bundles generated. |
| Capture creates an Inbox item | Passed in the temporary SQLite database. |
| Filing a note and case-insensitive duplicate-tag removal | Passed. |
| Restart and SQLite integrity check | Passed. |
| Reclassify a planned completed task | Reproduced destructive reset (B09). |
| Move an unscheduled task before another | Reproduced rejected ordering (B07). |
| Move an event while a task-anchor update is forced to fail | Reproduced partial commit (B08). Failure was injected with an SQLite trigger; this demonstrates missing atomicity, not a claim that normal saves always fail. |
| Create a Saturday meeting and query adjacent workweeks | Confirmed the stored event is absent from both visible ranges (B05). |
| Query a Sunday-to-Monday event | Storage returned it correctly; renderer start-day filtering is the defect (B12). |
| Delete a meeting with anchored tasks | Tasks retained their date and entered the end slot. Existing rank values merge with that slot; define the desired merge order explicitly if appending after all existing tasks is intended. |
| V2 migration/restore, live Electron rendering, real drag/keyboard interactions, packaged startup | Not executed in this review. Source inspection alone does not validate these paths. |

## Suggested implementation order

1. **Restore basic usability:** B01–B04 and B06; shared item details, safe navigation, scoped shortcuts, and one DnD context.
2. **Make changes reliable:** B07–B11; ordered unscheduled slot, transactional event writes, classification guard, pending state, and visible errors.
3. **Complete date coverage:** B05/B12 and M04; weekends, spanning events, timezone/anchor behavior.
4. **Improve the compact UI:** readable type, labeled movement controls, day/tray modes, tag editing/filtering, and insertion feedback.
5. **Reduce maintenance cost:** M01–M03, M05–M08 and focused regression coverage. Revisit Outlook after these core behaviors are stable.
