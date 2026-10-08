const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { after, test } = require('node:test')
const { JSDOM } = require('jsdom')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const generated = path.join(__dirname, '.generated', 'notes')
fs.mkdirSync(generated, { recursive: true })
buildSync({ absWorkingDir: root, entryPoints: ['src/renderer/notes/NotesApp.tsx'], outfile: path.join(generated, 'NotesApp.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' } })
buildSync({ absWorkingDir: root, entryPoints: ['src/renderer/browserPreview.ts'], outfile: path.join(generated, 'browserPreview.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
buildSync({ absWorkingDir: root, entryPoints: ['src/renderer/calenban/useCalendarMutations.ts'], outfile: path.join(generated, 'mutations.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
buildSync({ absWorkingDir: root, entryPoints: ['src/renderer/calenban/usePlannerData.ts'], outfile: path.join(generated, 'plannerData.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true })
global.window = dom.window
Object.defineProperty(dom.window, 'innerWidth', { configurable: true, writable: true, value: 1400 })
global.document = dom.window.document
global.HTMLElement = dom.window.HTMLElement
global.Element = dom.window.Element
global.Node = dom.window.Node
global.NodeFilter = dom.window.NodeFilter
global.getComputedStyle = dom.window.getComputedStyle
global.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window)
global.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window)
global.Event = dom.window.Event
global.KeyboardEvent = dom.window.KeyboardEvent
global.MouseEvent = dom.window.MouseEvent
global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
dom.window.HTMLElement.prototype.scrollTo = function () {}
dom.window.HTMLElement.prototype.scrollIntoView = function () {}
dom.window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
global.localStorage = dom.window.localStorage
global.IS_REACT_ACT_ENVIRONMENT = true
Object.defineProperty(global, 'navigator', { configurable: true, value: dom.window.navigator })
const { configure, render, renderHook, screen, within, fireEvent, waitFor, act } = require('@testing-library/react')
configure({ asyncUtilTimeout: 10000 })
async function selectOption(control, value) {
  fireEvent.click(control)
  const option = await waitFor(() => { const option = [...document.querySelectorAll('[data-slot="select-item"]')].find(item => item.dataset.value === String(value) && item.closest('[data-slot="select-content"]')?.hasAttribute('data-open')); assert.ok(option, `Select option ${value}`); return option })
  fireEvent.pointerDown(option, { pointerType: 'mouse', button: 0 })
  fireEvent.click(option, { detail: 1 })
}
const React = require('react')
const { NotesApp } = require(path.join(generated, 'NotesApp.cjs'))
const { useCalendarMutations } = require(path.join(generated, 'mutations.cjs'))
const { usePlannerData } = require(path.join(generated, 'plannerData.cjs'))

const noteId = '11111111-1111-4111-8111-111111111111'
const captureId = '22222222-2222-4222-8222-222222222222'
const makeNote = (id, body, kind, categoryId = null) => ({ id, body, meetingId: null, createdAt: 1_800_000_000_000, updatedAt: 1_800_000_000_000, deletedAt: null, revision: 1, meetingTitle: null, kind, processedAt: null, categoryId, subcategoryId:null, tags: [], images: [] })

function setup({ taxonomy, calendarHours = {}, notesApi = {} } = {}) {
  localStorage.clear()
  let viewListener = () => {}
  let notesListener = () => {}
  let taxonomyListener = () => {}
  let plannerListener = () => {}
  const get = async (id) => ({ ok: true, value: id === captureId ? makeNote(captureId, 'Captured thought', 'inbox') : makeNote(noteId, 'Existing note', 'note') })
  const api = {
    taskWorkspace: {
      list: async input => { const captures = (input.scope === 'planned' ? [] : (await api.planner.inbox()).value.items).map(item => ({ ...item, completedAt: null, plannedDate: null, plannedStartAt: null, plannedEndAt: null, position: 0, priorityPosition: 0, beforeEventId: null, ready: false, intention: { kind: 'unplanned', targetDate: null, position: 0 }, horizon: 'unplanned' })); const counts = { unplanned: captures.length, today: 0, tomorrow: 0, week: 0, 'next-week': 0, later: 0, upcoming: 0 }; return { ok: true, value: { items: input.horizon === 'unplanned' ? captures : [], counts, total: input.horizon === 'unplanned' ? captures.length : 0, nextCursor: null } } },
      move: async () => ({ ok: true, value: {} }), undo: async () => ({ ok: true, value: undefined }), create: async () => ({ ok: true, value: undefined }),
    },
    updates: { getStatus: async () => ({ ok: true, value: { status: 'idle' } }), check: async () => ({ ok: true, value: undefined }), install: async () => ({ ok: true, value: undefined }), onChanged: () => () => {} },
    notes: {
      list: async () => ({ ok: true, value: { items: [makeNote(noteId, 'Existing note', 'note')], nextCursor: null, total: 1 } }),
      tags: async () => ({ ok: true, value: ['Work', 'Personal'] }), taxonomy: taxonomy ?? (async () => ({ ok: true, value: { categories: [], tags: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Work', categoryId: null, color: '#85858e', count: 1 }, { id: '44444444-4444-4444-8444-444444444444', name: 'Personal', categoryId: null, color: '#85858e', count: 1 }] } })), image: async () => ({ ok: false, message: 'Missing image' }),
      get, update: async (input) => ({ ok: true, value: { ...makeNote(noteId, input.body, 'note'), revision: 2 } }),
      updateItem: async () => ({ ok: true, value: makeNote(noteId, 'Existing note', 'note') }), setCategory: async () => ({ ok: true, value: undefined }), setTags: async () => ({ ok: true, value: undefined }),
      trash: async () => ({ ok: true, value: undefined }), restore: async () => ({ ok: true, value: undefined }),
      deletePermanently: async () => ({ ok: true, value: undefined }), emptyTrash: async () => ({ ok: true, value: undefined }),
      copy: async () => ({ ok: true, value: 'copied' }),
      onChanged: callback => { notesListener = callback; return () => {} },
      onTaxonomyChanged: callback => { taxonomyListener = callback; return () => {} },
    },
    planner: {
      inbox: async () => ({ ok: true, value: { items: [makeNote(captureId, 'Captured thought', 'inbox')], nextCursor: null, total: 1 } }),
      inboxCount: async () => ({ ok: true, value: 1 }), unfile: async () => ({ ok: true, value: undefined }),
      backlogSummary: async () => ({ ok: true, value: {} }),
      classify: async () => ({ ok: true, value: undefined }), backlog: async () => ({ ok: true, value: { items: [], nextCursor: null, total: 0 } }), reorderBacklog: async () => ({ ok: true, value: undefined }), setReady: async () => ({ ok: true, value: undefined }), tasks: async () => ({ ok: true, value: { tasks: [], events: [], tags: [] } }),
      move: async () => ({ ok: true, value: undefined }),
      createEvent: async () => ({ ok: true, value: undefined }), updateEvent: async () => ({ ok: true, value: undefined }), deleteEvent: async () => ({ ok: true, value: undefined }), undoDeleteEvent: async () => ({ ok: true, value: undefined }), onChanged: callback => { plannerListener = callback; return () => {} },
    },
    settings: {
      get: async () => ({ ok: true, value: { shortcut: 'Control+N', shortcutEnabled: true, shortcutRegistered: true, launchAtLogin: false, theme: 'light', monitor: 'active', captureProtection: false, protectionTestApp: '', protectionTestDate: '', protectionTestOS: '', lastBackupAt: null, backupWarning: false, firstRunComplete: true, closeToTray: true, calendarStartMinute: 480, calendarEndMinute: 1080, ...calendarHours } }),
      displays: async () => ({ ok: true, value: [] }), update: async () => ({ ok: true, value: {} }), onChanged: () => () => {}, openFolder: async () => ({ ok: true, value: undefined }),
    },
    data: { export: async () => ({ ok: true, value: undefined }), backup: async () => ({ ok: true, value: undefined }), restore: async () => ({ ok: true, value: undefined }), diagnostics: async () => ({ ok: true, value: undefined }) },
    windows: { openCapture() {}, openNotes() {}, openSettings() {}, quit() {}, ready() {}, onView(callback) { viewListener = callback; return () => {} } },
  }
  Object.assign(api.notes, notesApi)
  window.captured = api
  const view = render(React.createElement(NotesApp))
  return { ...view, api, notifyNotes: () => act(() => notesListener(1)), notifyTaxonomy: () => act(() => taxonomyListener()), notifyPlanner: () => act(() => plannerListener(1)), changeView: (next) => act(() => viewListener(next)) }
}

after(() => {
  dom.window.close()
  fs.rmSync(generated, { recursive: true, force: true })
})

test('browser preview capture enters Inbox and a filed task moves through Backlog and Ready', async () => {
  localStorage.clear()
  require(path.join(generated, 'browserPreview.cjs'))
  let opened = false
  const onOpen = () => { opened = true }
  window.addEventListener('captured:browser-capture', onOpen)
  window.captured.windows.openCapture()
  assert.equal(opened, true)
  window.removeEventListener('captured:browser-capture', onOpen)
  const id = '66666666-6666-4666-8666-666666666666'
  await window.captured.capture.submit({ requestId: id, generation: 0, body: 'New browser task' })
  const inbox = await window.captured.planner.inbox()
  const created = inbox.value.items.find((item) => item.body === 'New browser task')
  assert.ok(created)
  await window.captured.planner.classify({ id: created.id, kind: 'task', tags: ['Planning'] })
  const backlog = await window.captured.planner.backlog({})
  assert.ok(backlog.value.items.some((task) => task.id === created.id))
  const tasks = await window.captured.planner.tasks('2026-09-26', '2026-09-28')
  assert.ok(!tasks.value.tasks.some((task) => task.id === created.id))
  await window.captured.planner.setReady({ id: created.id })
  const ready = await window.captured.planner.tasks('2026-09-26', '2026-09-28')
  assert.ok(ready.value.tasks.some((task) => task.id === created.id && task.plannedDate === null))
  const app = render(React.createElement(NotesApp))
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Calendar' }))
    await screen.findByRole('heading', { name: 'Calendar' })
    await waitFor(() => assert.ok(document.querySelector('.calendar-ready')?.textContent.includes('New browser task')))
    await act(async () => { await window.captured.planner.move({ id: created.id, plannedDate: '2026-09-27', beforeEventId: null, beforeId: null }) })
    assert.ok(screen.getByRole('heading', { name: 'Calendar' }))
  } finally { app.unmount() }
})

test('older note list responses cannot overwrite newer search results', async () => {
  const requests = []
  const app = setup({ notesApi: { list: (filter) => new Promise((resolve) => requests.push({ filter, resolve })) } })
  try {
    await waitFor(() => assert.equal(requests.length, 1))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search items' }), { target: { value: 'current' } })
    await waitFor(() => assert.equal(requests.length, 2))
    await act(async () => requests[1].resolve({ ok: true, value: { items: [makeNote(noteId, 'Current result', 'note')], nextCursor: null, total: 1 } }))
    await screen.findByRole('button', { name: 'Open note Current result' })
    await act(async () => requests[0].resolve({ ok: true, value: { items: [makeNote(noteId, 'Old result', 'note')], nextCursor: null, total: 1 } }))
    assert.ok(screen.getByRole('button', { name: 'Open note Current result' }))
    assert.equal(screen.queryByRole('button', { name: 'Open note Old result' }), null)
  } finally { app.unmount() }
})

test('opening notes quickly keeps the selected detail and ignores results after navigation', async () => {
  const first = makeNote(noteId, 'First note', 'note'), second = makeNote(captureId, 'Second note', 'note')
  const requests = []
  const app = setup({ notesApi: {
    list: async () => ({ ok: true, value: { items: [first, second], nextCursor: null, total: 2 } }),
    get: (id) => new Promise((resolve) => requests.push({ id, resolve })),
  } })
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Open note First note' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note Second note' }))
    await act(async () => requests[1].resolve({ ok: true, value: second }))
    await act(async () => requests[0].resolve({ ok: true, value: first }))
    assert.equal(screen.getByRole('textbox', { name: 'Edit item' }).value, second.body)
    assert.equal(document.querySelector('.detail-panel'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'Open note First note' }))
    app.changeView('inbox')
    await act(async () => requests[2].resolve({ ok: false, code: 'NOT_FOUND', message: 'Old detail error' }))
    assert.equal(screen.queryByText('Old detail error'), null)
  } finally { app.unmount() }
})

test('taxonomy refresh ignores old responses and does not trigger another notes query', async () => {
  const requests = []
  let changed, listCalls = 0
  const app = setup({ taxonomy: () => new Promise((resolve) => requests.push(resolve)), notesApi: {
    onTaxonomyChanged: (listener) => { changed = listener; return () => {} },
    list: async () => { listCalls++; return { ok: true, value: { items: [], nextCursor: null, total: 0 } } },
  } })
  try {
    await act(async () => changed())
    assert.equal(requests.length, 2)
    await act(async () => requests[1]({ ok: true, value: { categories: [{ id: noteId, name: 'Current category' }], tags: [] } }))
    await act(async () => requests[0]({ ok: true, value: { categories: [{ id: noteId, name: 'Old category' }], tags: [] } }))
    assert.ok(screen.getByRole('button', { name: 'Current category', exact: true }))
    assert.equal(screen.queryByRole('button', { name: 'Old category', exact: true }), null)
    assert.equal(listCalls, 1)
  } finally { app.unmount() }
})

test('sidebar Capture opens the browser preview editor and saves to Inbox', async () => {
  const app = setup()
  let submitted
  app.api.capture = { submit: async (input) => { submitted = input; return { ok: true, value: { id: captureId } } } }
  app.api.windows.openCapture = () => window.dispatchEvent(new window.Event('captured:browser-capture'))
  try {
    fireEvent.click(within(document.querySelector('.sidebar')).getByRole('button', { name: /Capture/ }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Capture text' }), { target: { value: 'New thought' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save capture' }))
    await waitFor(() => assert.equal(submitted.body, 'New thought'))
    await screen.findByRole('heading', { name: /Backlog/ })
  } finally { app.unmount() }
})

test('browser capture saves the chosen category to Inbox', async () => {
  localStorage.clear()
  delete require.cache[require.resolve(path.join(generated, 'browserPreview.cjs'))]
  require(path.join(generated, 'browserPreview.cjs'))
  const app = render(React.createElement(NotesApp))
  try {
    act(() => window.captured.windows.openCapture())
    const category = await screen.findByRole('combobox', { name: 'Capture category' })
    await selectOption(category, '11111111-1111-4111-8111-111111111111')
    fireEvent.change(screen.getByRole('textbox', { name: 'Capture text' }), { target: { value: 'Categorized browser capture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save capture' }))
    await screen.findByRole('heading', { name: /Backlog/ })
    const inbox = await window.captured.planner.inbox()
    assert.equal(inbox.value.items.find((item) => item.body === 'Categorized browser capture').categoryId, '11111111-1111-4111-8111-111111111111')
  } finally { app.unmount() }
})

test('category view includes direct items under No subcategory', async () => {
  const categoryId = '77777777-7777-4777-8777-777777777777'
  const app = setup({ taxonomy: async () => ({ ok: true, value: { categories: [{ id: categoryId, name: 'Client A' }], tags: [] } }) })
  app.api.notes.list = async (filter) => ({ ok: true, value: { items: filter.categoryId === categoryId ? [makeNote(noteId, 'Untagged reference', 'note', categoryId)] : [], nextCursor: null, total: filter.categoryId === categoryId ? 1 : 0 } })
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Client A' }))
    await screen.findByRole('button', { name: 'Open note Untagged reference' })
    assert.ok(screen.getByText('No subcategory',{selector:'div'}))
    assert.ok(screen.getByRole('heading', { name: /Client A/ }))
  } finally { app.unmount() }
})

test('sidebar category and tag deletion requires confirmation and returns to a valid view', async () => {
  const categoryId = '77777777-7777-4777-8777-777777777777'
  const tagId = '88888888-8888-4888-8888-888888888888'
  let taxonomy = { categories: [{ id: categoryId, name: 'Client A' }], tags: [{ id: tagId, name: 'Planning', categoryId, color: '#85858e', count: 1 }] }
  let deletedCategory, deletedTag, approve = false
  const confirmations = []
  const originalConfirm = window.confirm
  window.confirm = (message) => { confirmations.push(message); return approve }
  const app = setup({ taxonomy: async () => ({ ok: true, value: taxonomy }) })
  app.api.notes.deleteCategory = async (id) => { deletedCategory = id; taxonomy = { categories: [], tags: taxonomy.tags.map((tag) => ({ ...tag, categoryId: null })) }; return { ok: true, value: undefined } }
  app.api.notes.deleteTag = async (id) => { deletedTag = id; taxonomy = { ...taxonomy, tags: taxonomy.tags.filter((tag) => tag.id !== id) }; return { ok: true, value: undefined } }
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Client A' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete category Client A' }))
    assert.equal(deletedCategory, undefined)
    assert.match(confirmations.at(-1), /Items become unassigned.*tags and images are preserved/i)

    approve = true
    fireEvent.click(screen.getByRole('button', { name: 'Delete category Client A' }))
    await waitFor(() => assert.equal(deletedCategory, categoryId))
    await screen.findByRole('heading', { name: /All items/ })

    fireEvent.click(await screen.findByRole('button', { name: 'Delete tag Planning' }))
    await waitFor(() => assert.equal(deletedTag, tagId))
    assert.match(confirmations.at(-1), /from all items/i)
  } finally { window.confirm = originalConfirm; app.unmount() }
})

test('opening an Inbox capture opens the shared editor without leaving Inbox', async () => {
  const app = setup()
  try {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Backlog/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Captured thought' }))
    await screen.findByRole('dialog', { name: 'Edit inbox item' })
    assert.equal(screen.getByRole('textbox', { name: 'Edit item' }).value, 'Captured thought')
    assert.ok(screen.getByRole('dialog', { name: 'Edit inbox item' }))
    assert.ok(screen.getByRole('heading', { name: /Backlog/ }))
  } finally { app.unmount() }
})

test('shared modal protects dirty edits on Close and Escape before navigation', async () => {
  const app = setup()
  const originalConfirm = window.confirm
  try {
    fireEvent.click(await screen.findByRole('button', { name: /Open note Existing note/ }))
    const editor = await screen.findByRole('textbox', { name: 'Edit item' })
    fireEvent.change(editor, { target: { value: 'Unsaved wording' } })
    window.confirm = () => false
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    assert.equal(editor.value, 'Unsaved wording')
    fireEvent.keyDown(editor, { key: 'Escape' })
    assert.ok(screen.getByRole('dialog', { name: 'Edit note' }))
    window.confirm = () => true
    fireEvent.keyDown(editor, { key: 'Escape' })
    assert.equal(screen.queryByRole('dialog'), null)
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Tasks/ }))
    await screen.findByRole('heading', { name: /Tasks/ })
  } finally { window.confirm = originalConfirm; app.unmount() }
})

test('global note shortcuts do not intercept Enter in Inbox or Calenban controls', async () => {
  const app = setup()
  const getCalls = []
  const originalGet = app.api.notes.get
  app.api.notes.get = async (id) => { getCalls.push(id); return originalGet(id) }
  try {
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Backlog/ }))
    const fileButton = await screen.findByRole('button', { name: 'Move Captured thought' })
    fireEvent.keyDown(fileButton, { key: 'Enter' })
    assert.deepEqual(getCalls, [])

    app.changeView('calenban')
    const addMeeting = (await screen.findAllByRole('button', { name: /^Add meeting on / }))[0]
    fireEvent.keyDown(addMeeting, { key: 'Enter' })
    assert.deepEqual(getCalls, [])
  } finally { app.unmount() }
})

test('Calendar switches between Day, 3 days, and Monday–Friday Workweek', async () => {
  const app = setup()
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    await screen.findByRole('button', { name: 'Workweek' })
    assert.equal(document.querySelectorAll('[data-slot="event-calendar-day-column"]').length, 3)
    fireEvent.click(screen.getByRole('button', { name: 'Workweek' }))
    await waitFor(() => assert.equal(document.querySelectorAll('[data-slot="event-calendar-day-column"]').length, 5))
    fireEvent.click(screen.getByRole('button', { name: 'Day', exact: true }))
    await waitFor(() => assert.equal(document.querySelectorAll('[data-slot="event-calendar-day-column"]').length, 1))
  } finally { app.unmount() }
})

test('Workweek advances seven days and quarter-hour display settings reach the grid', async () => {
  const app = setup({ calendarHours: { calendarStartMinute: 495, calendarEndMinute: 1005 } })
  try {
    app.changeView('calenban')
    fireEvent.click(await screen.findByRole('button', { name: 'Workweek' }))
    const column = document.querySelector('[data-slot="event-calendar-day-column"]')
    const day = Number(column.dataset.ecDay)
    assert.equal(new Date(day).getDay(), 1)
    await waitFor(() => assert.equal(column.dataset.ecBoundsStart, '495'))
    assert.equal(column.dataset.ecBoundsEnd, '1005')
    fireEvent.click(screen.getByRole('button', { name: 'Next calendar period' }))
    await waitFor(() => { const next = new Date(Number(document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecDay)); const expected = new Date(day); expected.setDate(expected.getDate() + 7); assert.equal(next.getTime(), expected.getTime()) })
    fireEvent.click(screen.getByRole('button', { name: 'Show full day' }))
    assert.equal(document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecBoundsStart, '0')
    assert.equal(document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecBoundsEnd, '1440')
  } finally { app.unmount() }
})

test('creating a task from the calendar submits a real timed task', async () => {
  const app = setup()
  let created
  app.api.planner.createTask = async (input) => { created = input; return { ok: true, value: { ...makeNote(noteId, input.body, 'task'), ...input } } }
  try {
    app.changeView('calenban')
    const dayColumn = await waitFor(() => {
      const column = document.querySelector('[data-slot="event-calendar-day-column"]')
      assert.ok(column)
      return column
    })
    dayColumn.getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 200, width: 200, height: 600, x: 0, y: 0, toJSON() {} })
    fireEvent.click(dayColumn, { clientY: 150 })
    const meetingDialog = await screen.findByRole('dialog', { name: 'Add a meeting' })
    fireEvent.click(within(meetingDialog).getByRole('button', { name: 'Task', exact: true }))
    const dialog = within(screen.getByRole('dialog', { name: 'Add a task' }))
    fireEvent.change(dialog.getByLabelText('Task'), { target: { value: 'Time for focused work' } })
    fireEvent.change(dialog.getByLabelText('Starts'), { target: { value: '2026-10-01T10:15' } })
    fireEvent.change(dialog.getByLabelText('Ends'), { target: { value: '2026-10-01T11:00' } })
    fireEvent.click(dialog.getByRole('button', { name: 'Add task' }))
    await waitFor(() => assert.equal(created.body, 'Time for focused work'))
    assert.equal(created.placement.kind, 'timed')
    assert.equal(created.placement.endAt - created.placement.startAt, 45 * 60_000)
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Add a task' }), null))
  } finally { app.unmount() }
})

test('calendar mutations keep pending changes until refresh and revert rejected writes without duplicate saves', async () => {
  const task = { ...makeNote(noteId, 'Review', 'task'), completedAt: null, plannedDate: null, plannedStartAt: null, plannedEndAt: null, ready: true, beforeEventId: null, position: 0, priorityPosition: 0 }
  let finish, refreshFinish, calls = 0
  window.captured = { planner: { scheduleTask: () => { calls++; return new Promise((resolve) => { finish = resolve }) } } }
  const hook = renderHook(() => useCalendarMutations(() => new Promise((resolve) => { refreshFinish = resolve })))
  const placement = { kind: 'timed', startAt: new Date('2026-10-01T10:00').getTime(), endAt: new Date('2026-10-01T10:30').getTime() }
  let work
  try {
    act(() => { work = hook.result.current.schedule(task, placement) })
    assert.equal(hook.result.current.overrides[`task:${noteId}`].start.getTime(), placement.startAt)
    await act(async () => { assert.equal(await hook.result.current.schedule(task, placement), false) })
    assert.equal(calls, 1)
    await act(async () => { finish({ ok: false, message: 'Rejected stale task' }); await Promise.resolve() })
    assert.match(hook.result.current.error, /Rejected/)
    assert.equal(hook.result.current.pending.length, 1)
    await act(async () => { refreshFinish(); assert.equal(await work, false) })
    assert.deepEqual(hook.result.current.overrides, {})
  } finally { hook.unmount() }
})

test('late planner refresh cannot replace the currently selected date range', async () => {
  const requests = []
  window.captured = { planner: { tasks: (from, to) => { const request = { from, to }; requests.push(request); return new Promise((resolve) => { request.resolve = resolve }) }, onChanged: () => () => {} } }
  const hook = renderHook(({ from, to }) => usePlannerData(from, to), { initialProps: { from: '2026-10-01', to: '2026-10-03' } })
  const oldRefresh = hook.result.current.refresh
  try {
    hook.rerender({ from: '2026-10-05', to: '2026-10-09' })
    assert.equal(requests.length, 2)
    await act(async () => { requests[1].resolve({ ok: true, value: { tasks: [], events: [], tags: ['current'] } }); await Promise.resolve() })
    await act(async () => { requests[0].resolve({ ok: true, value: { tasks: [], events: [], tags: ['old'] } }); await oldRefresh() })
    assert.deepEqual(hook.result.current.tags, ['current'])
    assert.equal(requests.length, 2)
  } finally { hook.unmount() }
})

test('Calendar settings validate the pair and save precise visible hours', async () => {
  localStorage.clear()
  delete require.cache[require.resolve(path.join(generated, 'browserPreview.cjs'))]
  require(path.join(generated, 'browserPreview.cjs'))
  const app = render(React.createElement(NotesApp))
  try {
    fireEvent.click(within(document.querySelector('.sidebar')).getByRole('button', { name: 'Settings' }))
    fireEvent.click(within(document.querySelector('.settings-nav')).getByRole('button', { name: 'Calendar' }))
    const start = screen.getByRole('combobox', { name: 'Calendar start time' })
    const end = screen.getByRole('combobox', { name: 'Calendar end time' })
    await waitFor(() => assert.equal(screen.getByRole('button', { name: 'Save calendar hours' }).disabled, false))
    await selectOption(start, end.value)
    assert.equal(screen.getByRole('button', { name: 'Save calendar hours' }).disabled, true)
    await selectOption(start, '495')
    await selectOption(end, '1440')
    fireEvent.click(screen.getByRole('button', { name: 'Save calendar hours' }))
    await screen.findByText('Calendar hours saved.')
    const saved = await window.captured.settings.get()
    assert.equal(saved.value.calendarStartMinute, 495); assert.equal(saved.value.calendarEndMinute, 1440)
  } finally { app.unmount() }
})

test('note editing saves tags and multi-select filters combine selected types and tags', async () => {
  const app = setup()
  let saved
  const filters = []
  app.api.notes.updateItem = async (input) => { saved = input; return { ok: true, value: { ...makeNote(noteId, input.body, 'note'), tags: input.tags, revision: 2 } } }
  app.api.notes.list = async (filter) => { filters.push(filter); return { ok: true, value: { items: [makeNote(noteId, 'Existing note', 'note')], nextCursor: null, total: 1 } } }
  try {
    fireEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    fireEvent.click(screen.getByRole('button', { name: 'Tag filter for items: All tags' }))
    const popup = within(document.querySelector('.tag-filter-popover'))
    const work = await popup.findByRole('button', { name: 'Work', pressed: false })
    fireEvent.click(work)
    fireEvent.click(popup.getByRole('button', { name: 'Personal', pressed: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Notes', exact: true }))
    fireEvent.click(screen.getByRole('button', { name: 'To-dos', exact: true }))
    await waitFor(() => assert.ok(filters.some((filter) => filter.tags?.includes('Work') && filter.tags?.includes('Personal') && filter.kinds?.includes('note') && filter.kinds?.includes('task'))))
    assert.equal(work.getAttribute('aria-pressed'), 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    await waitFor(() => assert.ok(filters.some((filter) => !filter.tags && !filter.kinds)))
    fireEvent.click(screen.getByRole('button', { name: 'Tag filter for items: All tags' }))
    const cleared = within(await screen.findByRole('dialog'))
    assert.equal(cleared.getByRole('button', { name: 'Work' }).getAttribute('aria-pressed'), 'false')
    fireEvent.click(screen.getByRole('button', { name: 'Tag filter for items: All tags' }))
    fireEvent.click(await screen.findByRole('button', { name: /Open note Existing note/ }))
    const tagInput = await screen.findByRole('combobox', { name: 'Add a tag' })
    fireEvent.change(tagInput, { target: { value: 'Work' } })
    fireEvent.keyDown(tagInput, { key: 'Enter' })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => assert.deepEqual(saved.tags, ['Work']))
  } finally { app.unmount() }
})

test('deleting a meeting offers Undo and restores the saved snapshot', async () => {
  const app = setup()
  const start = new Date(); start.setHours(10, 0, 0, 0)
  const event = { id: '33333333-3333-4333-8333-333333333333', title: 'Review', startAt: start.getTime(), endAt: start.getTime() + 30 * 60_000, allDay: false }
  const snapshot = { event, anchors: [] }
  let restored
  app.api.planner.tasks = async () => ({ ok: true, value: { tasks: [], events: [event], tags: [] } })
  app.api.planner.deleteEvent = async () => ({ ok: true, value: snapshot })
  app.api.planner.undoDeleteEvent = async (value) => { restored = value; return { ok: true, value: undefined } }
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Review,/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete', exact: true }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => assert.deepEqual(restored, snapshot))
  } finally { app.unmount() }
})


test('recurring meeting deletion defaults to one occurrence and allows deleting the series', async () => {
  const app = setup()
  const start = new Date(); start.setHours(10, 0, 0, 0)
  const event = { id: '33333333-3333-4333-8333-333333333333', title: 'Review', startAt: start.getTime(), endAt: start.getTime() + 30 * 60_000, allDay: false, seriesId: '44444444-4444-4444-8444-444444444444' }
  const snapshot = { event, anchors: [] }
  let restored
  let deletion
  app.api.planner.tasks = async () => ({ ok: true, value: { tasks: [], events: [event], tags: [] } })
  app.api.planner.deleteEvent = async (id, scope) => { deletion = { id, scope }; return { ok: true, value: snapshot } }
  app.api.planner.undoDeleteEvent = async (value) => { restored = value; return { ok: true, value: undefined } }
  try {
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    fireEvent.click(await screen.findByRole('button', { name: /^Review,/ }))
    assert.equal(screen.getByRole('combobox', { name: 'Delete' }).value, 'instance')
    await selectOption(screen.getByRole('combobox', { name: 'Delete' }), 'series')
    fireEvent.click(screen.getByRole('button', { name: 'Delete all meetings' }))
    await waitFor(() => assert.deepEqual(deletion, { id: event.id, scope: 'series' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    await waitFor(() => assert.deepEqual(restored, snapshot))
  } finally { app.unmount() }
})


test('meeting editor submits weekly recurrence and removed sidebar and calendar copy stays absent', async () => {
  const app = setup()
  let created, saved, events = []
  app.api.planner.tasks = async () => ({ ok: true, value: { tasks: [], events, tags: [] } })
  app.api.planner.createEvent = async (input) => { created = input; const event = { id: noteId, ...input }; events = [event]; return { ok: true, value: event } }
  app.api.planner.updateEvent = async (input) => { saved = input; events = [{ id: noteId, ...input }]; return { ok: true, value: events[0] } }
  try {
    assert.equal(screen.queryByText('Local by design'), null)
    fireEvent.click(screen.getByRole('button', { name: 'Calendar' }))
    await screen.findByRole('heading', { name: 'Calendar' })
    assert.equal(screen.queryByText(/Your calendar is clear/), null)
    assert.equal(screen.queryByText(/Outlook connection is not configured/), null)
    fireEvent.click((await screen.findAllByRole('button', { name: /^Add meeting on / }))[0])
    assert.equal(created.title, 'New meeting')
    fireEvent.click(await screen.findByRole('button', { name: /^New meeting,/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit meeting' })
    fireEvent.change(within(dialog).getByLabelText('Title'), { target: { value: 'Weekly review' } })
    fireEvent.change(within(dialog).getByLabelText('Starts'), { target: { value: '2026-10-05T09:00' } })
    fireEvent.change(within(dialog).getByLabelText('Ends'), { target: { value: '2026-10-05T10:00' } })
    await selectOption(within(dialog).getByLabelText('Repeat'), 'weekly')
    fireEvent.change(within(dialog).getByLabelText('Until'), { target: { value: '2026-10-19' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save meeting' }))
    await waitFor(() => assert.deepEqual(saved.recurrence, { frequency: 'weekly', until: '2026-10-19' }))
    assert.equal(saved.title, 'Weekly review')
    await waitFor(() => assert.equal(screen.queryByRole('dialog', { name: 'Add a meeting' }), null))
  } finally { app.unmount() }
})


test('screenshots paste into note edits, discard safely, and save with text', async () => {
  const originalConfirm = window.confirm
  global.FileReader = dom.window.FileReader
  const app = setup()
  let saved
  app.api.notes.updateItem = async input => { saved = input; return { ok: true, value: { ...makeNote(noteId, input.body, 'note'), images: input.images, revision: 2 } } }
  const file = new dom.window.File([new Uint8Array([137,80,78,71])], 'snip.png', { type: 'image/png' })
  const paste = () => fireEvent.paste(screen.getByRole('textbox', { name: 'Edit item' }), { clipboardData: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => file }] } })
  try {
    fireEvent.click(await screen.findByRole('button', { name: /Open note Existing note/ }))
    await screen.findByRole('textbox', { name: 'Edit item' })
    paste()
    await screen.findByRole('button', { name: 'Remove image 1' })
    assert.equal(screen.getByRole('button', { name: /Images/ }).getAttribute('aria-expanded'), 'true')
    window.confirm = () => true
    fireEvent.click(screen.getByRole('button', { name: 'Close', exact: true }))
    assert.equal(saved, undefined)
    assert.equal(screen.queryByRole('button', { name: /Images/ }), null)
    fireEvent.click(screen.getByRole('button', { name: /Open note Existing note/ }))
    await screen.findByRole('textbox', { name: 'Edit item' })
    paste()
    await screen.findByRole('button', { name: 'Remove image 1' })
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit item' }), { target: { value: 'Screenshot context' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save', exact: true }))
    await waitFor(() => assert.equal(saved?.images.length, 1))
    assert.equal(saved.body, 'Screenshot context')
    assert.ok(saved.images[0].dataUrl.startsWith('data:image/png;base64,'))
  } finally { window.confirm = originalConfirm; app.unmount(); delete global.FileReader }
})


test('subcategory navigation filters by ID and editor category changes preserve independent tags', async () => {
  const categoryId='77777777-7777-4777-8777-777777777777',otherCategory='66666666-6666-4666-8666-666666666666',subcategoryId='88888888-8888-4888-8888-888888888888'
  const item={...makeNote(noteId,'Organized note','note',categoryId),subcategoryId,tags:['Waiting','Follow-up']}
  const filters=[];let saved
  const app=setup({taxonomy:async()=>({ok:true,value:{categories:[{id:categoryId,name:'Work'},{id:otherCategory,name:'Personal'}],subcategories:[{id:subcategoryId,name:'Project Alpha',categoryId,color:'#85858e',count:1}],tags:[]}}),notesApi:{get:async()=>({ok:true,value:item}),list:async filter=>{filters.push(filter);return {ok:true,value:{items:[item],nextCursor:null,total:1}}},updateItem:async input=>{saved=input;return {ok:true,value:{...item,...input,revision:2}}}}})
  try {
    fireEvent.click(await screen.findByRole('button',{name:/^Project Alpha/}))
    await waitFor(()=>assert.ok(filters.some(filter=>filter.subcategoryId===subcategoryId&&filter.categoryId===categoryId)))
    fireEvent.click(await screen.findByRole('button',{name:/Open note Organized note/}))
    fireEvent.click(await screen.findByRole('button',{name:'Edit item'}))
    await waitFor(() => assert.equal(screen.getByRole('combobox',{name:'Item subcategory'}).value,subcategoryId))
    await selectOption(screen.getByRole('combobox',{name:'Item category'}), otherCategory)
    assert.equal(screen.getByRole('combobox',{name:'Item subcategory'}).value,'')
    fireEvent.click(screen.getByRole('button',{name:'Save',exact:true}))
    await waitFor(()=>assert.equal(saved?.subcategoryId,null))
    assert.equal(saved.categoryId,otherCategory)
    assert.deepEqual(saved.tags,['Waiting','Follow-up'])
  }finally{app.unmount()}
})

test('migration review supports explicit empty assignment and keeps Trash separate', async () => {
  const categoryId='77777777-7777-4777-8777-777777777777',subcategoryId='88888888-8888-4888-8888-888888888888'
  let resolved
  const app=setup({taxonomy:async()=>({ok:true,value:{categories:[{id:categoryId,name:'Work'}],subcategories:[{id:subcategoryId,name:'Project',categoryId,color:'#85858e',count:1}],tags:[]}}),notesApi:{migrationReview:async()=>({ok:true,value:[{noteId,reason:'multiple-matching-subcategories',candidates:[subcategoryId]},{noteId:captureId,reason:'foreign-category-labels',candidates:[subcategoryId]}]}),get:async id=>({ok:true,value:{...makeNote(id,id===noteId?'Ambiguous note':'Deleted note','note',categoryId),deletedAt:id===captureId?1:null}}),resolveMigrationReview:async input=>{resolved=input;return {ok:true,value:undefined}}}})
  try {
    fireEvent.click(await screen.findByRole('button',{name:/Review subcategories/}))
    await screen.findByRole('button',{name:'Ambiguous note'})
    assert.equal(screen.queryByRole('button',{name:/Deleted note/}),null)
    fireEvent.click(screen.getByRole('checkbox',{name:'Include Trash'}))
    await screen.findByRole('button',{name:/Deleted note/})
    fireEvent.click(screen.getByRole('button',{name:'Keep without subcategory'}))
    await waitFor(()=>assert.equal(resolved?.subcategoryId,null))
    assert.equal(resolved.id,noteId)
    assert.equal(resolved.expectedRevision,1)
    await waitFor(()=>assert.equal(screen.queryByRole('button',{name:'Ambiguous note'}),null))
  }finally{app.unmount()}
})

test('browser preview upgrades category-linked tags without losing ambiguous labels', async () => {
  localStorage.clear()
  const categoryId='77777777-7777-4777-8777-777777777777'
  const item={...makeNote(noteId,'Old browser note','note',categoryId),tags:['Alpha','Beta']}
  delete item.subcategoryId
  localStorage.setItem('notiert-browser-preview',JSON.stringify({items:[item],categories:[{id:categoryId,name:'Work'}],tags:[{id:captureId,name:'Alpha',categoryId,color:'#123456',count:1},{id:'88888888-8888-4888-8888-888888888888',name:'Beta',categoryId,color:'#85858e',count:1}]}))
  delete require.cache[require.resolve(path.join(generated,'browserPreview.cjs'))]
  require(path.join(generated,'browserPreview.cjs'))
  const taxonomy=(await window.captured.notes.taxonomy()).value
  assert.equal(taxonomy.subcategories.length,2)
  assert.ok(taxonomy.tags.every(tag=>tag.categoryId===null))
  const migrated=(await window.captured.notes.get(noteId)).value
  assert.equal(migrated.subcategoryId,null)
  assert.deepEqual(migrated.tags,['Alpha','Beta'])
  assert.equal((await window.captured.notes.migrationReview()).value.length,1)
  await window.captured.notes.resolveMigrationReview({id:noteId,expectedRevision:1,categoryId,subcategoryId:taxonomy.subcategories[0].id})
  assert.equal((await window.captured.notes.migrationReview()).value.length,0)
  delete require.cache[require.resolve(path.join(generated,'browserPreview.cjs'))]
  require(path.join(generated,'browserPreview.cjs'))
  assert.equal((await window.captured.notes.taxonomy()).value.subcategories.length,2)
  assert.equal((await window.captured.notes.get(noteId)).value.subcategoryId,taxonomy.subcategories[0].id)
})


test('capture from a subcategory or tag page preselects that context in browser preview', async () => {
  localStorage.clear();delete require.cache[require.resolve(path.join(generated,'browserPreview.cjs'))];require(path.join(generated,'browserPreview.cjs'))
  const category=(await window.captured.notes.createCategory('Client context')).value
  const sub=(await window.captured.notes.createSubcategory({name:'Project context',categoryId:category.id})).value
  const tag=(await window.captured.notes.createTag({name:'context-tag'})).value
  const app=render(React.createElement(NotesApp))
  try {
    fireEvent.click(await screen.findByRole('button',{name:/^Project context/}))
    fireEvent.click(document.querySelector('.capture-button'))
    assert.equal((await screen.findByRole('combobox',{name:'Capture category'})).value,category.id)
    assert.equal(screen.getByRole('combobox',{name:'Capture subcategory'}).value,sub.id)
    fireEvent.change(screen.getByRole('textbox',{name:'Capture text'}),{target:{value:'Context note'}})
    fireEvent.click(screen.getByRole('button',{name:'Save capture'}))
    await waitFor(()=>assert.ok(!screen.queryByRole('textbox',{name:'Capture text'})))
    const inbox=(await window.captured.planner.inbox({})).value.items.find(item=>item.body==='Context note')
    assert.equal(inbox.subcategoryId,sub.id)
    fireEvent.click(await screen.findByRole('button',{name:new RegExp('^'+tag.name)}))
    fireEvent.click(document.querySelector('.capture-button'))
    assert.equal((await screen.findByRole('combobox',{name:'Capture category'})).value,'')
    assert.ok(screen.getByRole('button',{name:'Remove tag context-tag'}))
  }finally{app.unmount()}
})

test('All items has one checkbox per task and bulk selection never completes it', async () => {
  localStorage.clear();delete require.cache[require.resolve(path.join(generated,'browserPreview.cjs'))];require(path.join(generated,'browserPreview.cjs'))
  const task=(await window.captured.planner.createTask({body:'Select without completing',placement:{kind:'backlog'}})).value
  const app=render(React.createElement(NotesApp))
  try {
    await screen.findByRole('button',{name:'Open to-do Select without completing'})
    const row=within(document.querySelector(`[data-note-id="${task.id}"]`))
    assert.equal(row.getAllByRole('checkbox').length,1)
    assert.ok(row.getByRole('checkbox',{name:'Mark as done to-do: Select without completing'}))
    fireEvent.click(screen.getByRole('button',{name:'Select items'}))
    assert.equal(row.getAllByRole('checkbox').length,1)
    fireEvent.click(row.getByRole('checkbox',{name:'Select item'}))
    assert.ok(screen.getByText('1 selected'))
    assert.equal((await window.captured.notes.get(task.id)).value.completedAt,null)
    fireEvent.click(screen.getByRole('button',{name:'Done selecting'}))
    assert.ok(!screen.queryByText('1 selected'))
    assert.ok(row.getByRole('checkbox',{name:'Mark as done to-do: Select without completing'}))
  }finally{app.unmount()}
})

test('routine item changes refresh notes without reloading taxonomy or migration data', async () => {
  let taxonomyReads = 0, migrationReads = 0, noteReads = 0
  const app = setup({ notesApi: {
    taxonomy: async () => { taxonomyReads++; return { ok: true, value: { categories: [], subcategories: [], tags: [] } } },
    migrationStatus: async () => { migrationReads++; return { ok: true, value: { upgraded: false, acknowledged: true } } },
    migrationReview: async () => { migrationReads++; return { ok: true, value: [] } },
    list: async () => { noteReads++; return { ok: true, value: { items: [], total: 0, nextCursor: null } } },
  } })
  try {
    await waitFor(() => assert.equal(taxonomyReads, 1))
    const previous = { taxonomyReads, migrationReads, noteReads }
    app.notifyNotes(); app.notifyPlanner()
    await waitFor(() => assert.ok(noteReads > previous.noteReads))
    assert.equal(taxonomyReads, previous.taxonomyReads)
    assert.equal(migrationReads, previous.migrationReads)
    app.notifyTaxonomy()
    await waitFor(() => assert.equal(taxonomyReads, previous.taxonomyReads + 1))
    assert.equal(migrationReads, previous.migrationReads + 2)
  } finally { app.unmount() }
})

function browserWorkspace() {
  localStorage.clear()
  delete require.cache[require.resolve(path.join(generated, 'browserPreview.cjs'))]
  require(path.join(generated, 'browserPreview.cjs'))
}
const workspaceToday = () => new Date().toLocaleDateString('sv-SE')
const planFor = (kind, targetDate = null) => ({ kind, targetDate, position: 0 })
const backlogNav = () => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Backlog/ }))
const tasksNav = () => fireEvent.click(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Tasks/ }))

test('Tasks shows horizons together with drag handles and category layout has the same cards', async () => {
  browserWorkspace()
  const work = (await window.captured.notes.taxonomy()).value.categories[0]
  for (const [body, intention] of [['Plan today', planFor('day', workspaceToday())], ['Plan later', planFor('later')], ['Plan undecided', planFor('unplanned')]]) await window.captured.taskWorkspace.create({ body, categoryId: work.id, intention })
  const app = render(React.createElement(NotesApp))
  try {
    tasksNav()
    await screen.findByRole('button', { name: 'Plan today' })
    assert.ok(screen.getByRole('button', { name: 'Plan later' }))
    assert.equal(screen.queryByRole('button', { name: 'Plan undecided' }), null)
    assert.equal(document.querySelector('.tasks-card select'), null)
    assert.equal(document.querySelector('[data-horizon="week"]'), null)
    const original = [...document.querySelectorAll('.tasks-card')].map(card => card.dataset.taskId).sort()
    fireEvent.click(screen.getByRole('button', { name: 'By category' }))
    assert.deepEqual([...document.querySelectorAll('.tasks-card')].map(card => card.dataset.taskId).sort(), original)
    assert.equal(document.querySelector('.tasks-category-column .tasks-column-heading b').textContent, work.name)
    assert.ok(within(screen.getByRole('navigation', { name: 'Main navigation' })).getByRole('button', { name: /^Backlog/ }))
    assert.equal(screen.queryByRole('button', { name: 'Ready', exact: true }), null)
  } finally { app.unmount() }
})

test('integrated captures file as reference notes, retain draft tags/images, and support Undo', async () => {
  browserWorkspace()
  const saved = await window.captured.capture.submit({ requestId: crypto.randomUUID(), generation: 0, body: 'Sort this capture', tags: ['waiting'] })
  localStorage.setItem(`inbox-tags:${saved.value.id}`, JSON.stringify({ tags: ['waiting'], draft: 'Draft label' }))
  const app = render(React.createElement(NotesApp))
  try {
    backlogNav()
    await screen.findByRole('button', { name: 'Sort this capture' })
    let item
    const card = screen.getByRole('button', { name: 'Sort this capture' }).closest('article')
    fireEvent.click(within(card).getByRole('button', { name: 'Note', exact: true }))
    await screen.findByText('Filed as a note.')
    item = (await window.captured.notes.get(saved.value.id)).value
    assert.deepEqual(item.tags, ['waiting', 'Draft label'])
    assert.equal(item.kind, 'note'); assert.equal(screen.queryByRole('button', { name: 'Sort this capture' }), null)
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await screen.findByRole('button', { name: 'Sort this capture' })
    fireEvent.click(screen.getByRole('button', { name: 'Sort this capture' }))
    await screen.findByRole('dialog', { name: 'Edit inbox item' })
    assert.ok(screen.getByRole('heading', { name: /^Backlog/ }))
  } finally { app.unmount() }
})

test('typed capture bypasses sorting and category/subcategory survive direct Task creation', async () => {
  browserWorkspace()
  const work = (await window.captured.notes.taxonomy()).value.categories[0]
  const sub = (await window.captured.notes.createSubcategory({ name: 'Sub context', categoryId: work.id })).value
  const app = render(React.createElement(NotesApp))
  try {
    fireEvent.click(within(document.querySelector('.sidebar')).getByRole('button', { name: 'Capture', exact: true }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Capture a thought' }))
    fireEvent.change(dialog.getByRole('textbox', { name: 'Capture text' }), { target: { value: 'Directly captured task' } })
    await selectOption(dialog.getByRole('combobox', { name: 'Capture type' }), 'task')
    await selectOption(dialog.getByRole('combobox', { name: 'Capture category' }), work.id)
    await selectOption(dialog.getByRole('combobox', { name: 'Capture subcategory' }), sub.id)
    fireEvent.click(dialog.getByRole('button', { name: 'Save task' }))
    await screen.findByRole('button', { name: 'Directly captured task' })
    const item = (await window.captured.taskWorkspace.list({ today: workspaceToday(), query: 'Directly captured task' })).value.items[0]
    assert.equal(item.kind, 'task'); assert.equal(item.categoryId, work.id); assert.equal(item.subcategoryId, sub.id)
    assert.equal(item.horizon, 'unplanned')
  } finally { app.unmount() }
})

test('Tasks completion and reopening retain the plan, and rejected moves leave the card and error visible', async () => {
  browserWorkspace()
  await window.captured.taskWorkspace.create({ body: 'Finish planned work', categoryId: null, intention: planFor('day', workspaceToday()) })
  const app = render(React.createElement(NotesApp))
  try {
    tasksNav()
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Complete Finish planned work' }))
    await waitFor(() => assert.ok(screen.queryByRole('button', { name: 'Finish planned work' }) === null))
    fireEvent.click(screen.getByRole('button', { name: 'Completed', exact: true }))
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Reopen Finish planned work' }))
    fireEvent.click(screen.getByRole('button', { name: 'Show open tasks' }))
    await screen.findByRole('button', { name: 'Finish planned work' })
    const originalMove = window.captured.taskWorkspace.move
    window.captured.taskWorkspace.move = async () => ({ ok: false, code: 'STALE_REVISION', message: 'Changed elsewhere; refresh before moving.' })
    await screen.findByRole('checkbox', { name: 'Complete Finish planned work' })
    fireEvent.click(screen.getByRole('button', { name: 'Finish planned work' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Edit to-do' }))
    await selectOption(dialog.getByRole('combobox', { name: 'Task plan' }), 'later')
    fireEvent.click(dialog.getByRole('button', { name: 'Save plan' }))
    await screen.findByText('Changed elsewhere; refresh before moving.')
    assert.ok(screen.getByRole('button', { name: 'Finish planned work' }))
    window.captured.taskWorkspace.move = originalMove
    assert.ok((await window.captured.taskWorkspace.list({ today: workspaceToday(), horizon: 'today' })).value.items.some(item => item.body === 'Finish planned work'))
  } finally { app.unmount() }
})

test('Tasks filters all pages in storage, loads remaining cards, and keeps filters when changing layout', async () => {
  browserWorkspace()
  for (let index = 0; index < 54; index++) await window.captured.taskWorkspace.create({ body: `Paged task ${index}`, categoryId: null, tags: ['waiting'], intention: planFor('later') })
  const app = render(React.createElement(NotesApp))
  try {
    tasksNav()
    await screen.findByRole('button', { name: 'Paged task 0', exact: true })
    assert.equal(document.querySelector('[data-horizon="later"] .tasks-column-heading span').textContent, '54')
    fireEvent.click(screen.getByRole('button', { name: /Load more · 4 remaining/ }))
    await screen.findByRole('button', { name: 'Paged task 53', exact: true })
    fireEvent.change(screen.getByRole('textbox', { name: 'Search tasks' }), { target: { value: 'Paged task 53' } })
    await waitFor(() => assert.equal(document.querySelectorAll('.tasks-card').length, 1))
    fireEvent.click(screen.getByRole('button', { name: 'By category' }))
    assert.equal(screen.getByRole('textbox', { name: 'Search tasks' }).value, 'Paged task 53')
    assert.equal(document.querySelectorAll('.tasks-card').length, 1)
    assert.ok(screen.getByRole('button', { name: 'Paged task 53' }))
  } finally { app.unmount() }
})




test('Backlog keeps captures and undecided tasks separate from Tasks; planning buttons and grouped table share data', async () => {
  browserWorkspace()
  await window.captured.taskWorkspace.create({ body: 'Backlog candidate', categoryId: null, intention: planFor('unplanned') })
  await window.captured.taskWorkspace.create({ body: 'Table later', categoryId: null, intention: planFor('later') })
  const app = render(React.createElement(NotesApp))
  try {
    tasksNav()
    await screen.findByRole('button', { name: 'Table later' })
    assert.ok(screen.queryByRole('button', { name: 'Backlog candidate' }) === null)
    backlogNav()
    const card = (await screen.findByRole('button', { name: 'Backlog candidate' })).closest('article')
    for (const label of ['Today', 'Tomorrow', 'Next week']) assert.ok(within(card).getByRole('button', { name: label, exact: true }))
    fireEvent.click(within(card).getByRole('button', { name: 'Tomorrow', exact: true }))
    await screen.findByText('Moved to Tomorrow.')
    await waitFor(() => assert.ok(screen.queryByRole('button', { name: 'Backlog candidate' }) === null))
    fireEvent.click(screen.getByRole('button', { name: 'Undo', exact: true }))
    await screen.findByRole('button', { name: 'Backlog candidate' })
    fireEvent.click(within(screen.getByRole('button', { name: 'Backlog candidate' }).closest('article')).getByRole('button', { name: 'Today', exact: true }))
    await screen.findByText('Moved to Today.')
    tasksNav()
    await screen.findByRole('button', { name: 'Backlog candidate' })
    const ids = [...document.querySelectorAll('[data-task-id]')].map(row => row.dataset.taskId).sort()
    fireEvent.click(screen.getByRole('button', { name: 'Table', exact: true }))
    assert.equal(screen.getAllByRole('table').length, 4)
    assert.ok(screen.getByRole('table', { name: 'Today task table' }).closest('.backlog-group'))
    assert.deepEqual([...document.querySelectorAll('[data-task-id]')].map(row => row.dataset.taskId).sort(), ids)
    for (const horizon of ['today', 'tomorrow', 'next-week', 'later']) assert.ok(document.querySelector(`tbody[data-horizon="${horizon}"]`))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Complete Backlog candidate' }))
    await waitFor(() => assert.ok(screen.queryByRole('button', { name: 'Backlog candidate' }) === null))
    fireEvent.click(screen.getByRole('button', { name: 'By time', exact: true }))
    assert.equal(document.querySelector('.tasks-table'), null)
  } finally { app.unmount() }
})


test('Backlog ReUI tag picker selects, creates and removes tags without classifying a capture', async () => {
  browserWorkspace()
  const saved = await window.captured.capture.submit({ requestId: crypto.randomUUID(), generation: 0, body: 'Pick capture tags' })
  const app = render(React.createElement(NotesApp))
  try {
    backlogNav()
    let input = await screen.findByRole('combobox', { name: 'Tags for Pick capture tags' })
    const group = input.closest('.backlog-group')
    assert.ok(group, 'Backlog uses the original category panel')
    assert.equal(input.closest('.backlog-tag-picker').parentElement, input.closest('.backlog-task'), 'Picker sits inline beside the task title')
    const toggle = group.querySelector('.backlog-group-toggle')
    fireEvent.click(toggle)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(group.querySelector('.backlog-task-list'), null)
    fireEvent.click(toggle)
    assert.equal(toggle.getAttribute('aria-expanded'), 'true')
    input = await screen.findByRole('combobox', { name: 'Tags for Pick capture tags' })
    act(() => input.focus())
    fireEvent.change(input, { target: { value: 'Planning' } })
    fireEvent.keyDown(input, { key: 'ArrowDown', code: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'Planning', exact: true }))
    await waitFor(async () => assert.deepEqual((await window.captured.notes.get(saved.value.id)).value.tags, ['Planning']))
    fireEvent.change(input, { target: { value: 'Fresh backlog tag' } })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(async () => assert.deepEqual((await window.captured.notes.get(saved.value.id)).value.tags, ['Planning', 'Fresh backlog tag']))
    assert.equal((await window.captured.notes.get(saved.value.id)).value.kind, 'inbox')
    assert.ok((await window.captured.notes.taxonomy()).value.tags.some(tag => tag.name === 'Fresh backlog tag'))
    const chip = [...document.querySelectorAll('[data-slot="combobox-chip"]')].find(chip => chip.textContent === 'Planning')
    fireEvent.click(chip.querySelector('[data-slot="combobox-chip-remove"]'))
    await waitFor(async () => assert.deepEqual((await window.captured.notes.get(saved.value.id)).value.tags, ['Fresh backlog tag']))
  } finally { app.unmount() }
})
