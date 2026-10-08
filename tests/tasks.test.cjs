const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test, after } = require('node:test')
const { buildSync } = require('esbuild')
const generated = path.join(__dirname, '.generated', 'tasks')
fs.mkdirSync(generated, { recursive: true })
for (const [name, file] of Object.entries({ database: 'src/main/storage/database.ts', horizons: 'src/shared/taskHorizons.ts', dates: 'src/shared/plannerDates.ts' })) buildSync({ entryPoints: [file], outfile: path.join(generated, name + '.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { Store } = require(path.join(generated, 'database.cjs'))
const { horizonOf, intentionFor, validIntention, isCarriedOver } = require(path.join(generated, 'horizons.cjs'))
const { toLocalISODate } = require(path.join(generated, 'dates.cjs'))
after(() => fs.rmSync(generated, { recursive: true, force: true }))
const today = '2026-10-08'
const day = date => ({ kind: 'day', targetDate: date, position: 0 })
const week = date => ({ kind: 'week', targetDate: date, position: 0 })
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-tasks-test-')), file = path.join(folder, 'notes.sqlite'), store = new Store(file)
  return { store, file, folder, close() { if (store.db.open) store.close(); fs.rmSync(folder, { recursive: true, force: true }) } }
}
const list = (store, extra = {}) => store.listWorkspace({ today, ...extra })
const make = (store, body, categoryId = null) => store.createPlannerTask({ body, categoryId, tags: [], placement: { kind: 'backlog' } })
function move(store, task, horizon, extra = {}) { return store.moveWorkspace({ id: task.id, expectedRevision: store.getNote(task.id).revision, intention: intentionFor(horizon, today), beforeId: null, today, ...extra }) }
const placement = task => [task.plannedDate, task.plannedStartAt, task.plannedEndAt, task.ready, task.later, task.position, task.priorityPosition, task.beforeEventId]

test('horizons handle week boundaries, past work, year boundaries and future plans without overlap', () => {
  assert.equal(horizonOf(day('2026-10-07'), today), 'today')
  assert.equal(isCarriedOver(day('2026-10-07'), today), true)
  assert.equal(horizonOf(day('2026-10-09'), today), 'tomorrow')
  assert.equal(horizonOf(day('2026-10-11'), today), 'upcoming')
  assert.equal(horizonOf(day('2026-10-12'), today), 'next-week')
  assert.equal(horizonOf(day('2026-10-19'), today), 'upcoming')
  assert.equal(horizonOf(day('2026-10-12'), '2026-10-11'), 'tomorrow')
  assert.equal(horizonOf(week('2026-10-05'), '2026-10-11'), 'today')
  assert.equal(horizonOf(week('2026-10-05'), '2026-10-12'), 'today')
  assert.deepEqual(intentionFor('tomorrow', '2026-12-31'), day('2027-01-01'))
  assert.equal(intentionFor('next-week', '2026-12-31').targetDate, '2027-01-04')
  assert.deepEqual(intentionFor('tomorrow', '2026-10-25'), day('2026-10-26'))
  assert.equal(validIntention(day('2028-02-29')), true)
  assert.equal(validIntention(day('2026-02-29')), false)
  assert.equal(validIntention(week('2026-10-06')), false)
})

test('moving intentions does not alter calendar placement and calendar reconciliation does not alter intentions', () => {
  const f = fixture()
  try {
    const task = f.store.createPlannerTask({ body: 'Timed task', tags: ['Planning'], placement: { kind: 'timed', startAt: new Date('2026-10-06T09:00').getTime(), endAt: new Date('2026-10-06T10:00').getTime() } })
    const original = placement(task)
    move(f.store, task, 'next-week')
    const moved = f.store.listPlanner('2026-10-06', '2026-10-06').tasks.find(item => item.id === task.id)
    assert.deepEqual(placement(moved), original)
    const intention = f.store.getNote(task.id).intention
    f.store.reconcileReadyTasks(today)
    assert.deepEqual(f.store.getNote(task.id).intention, intention)
    const current = f.store.getNote(task.id)
    f.store.schedulePlannerTask({ id: task.id, expectedRevision: current.revision, placement: { kind: 'later' } })
    assert.deepEqual(f.store.getNote(task.id).intention, intention)
    assert.equal(list(f.store, { horizon: 'next-week' }).items[0].id, task.id)
  } finally { f.close() }
})

test('capture classification and horizon assignment are atomic, retain images/tags, and undo restores captures', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    const image = f.store.addDraftImage(0, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')
    const id = f.store.submitCapture(crypto.randomUUID(), 0, 'Capture', category.id, null, ['waiting'])
    const capture = f.store.getNote(id)
    assert.throws(() => f.store.moveWorkspace({ id, expectedRevision: capture.revision, intention: intentionFor('today', today), today, beforeId: crypto.randomUUID() }), /destination changed/)
    assert.equal(f.store.getNote(id).kind, 'inbox')
    const undo = move(f.store, capture, 'today')
    const task = list(f.store, { horizon: 'today' }).items[0]
    assert.equal(task.categoryId, category.id); assert.equal(task.images[0].id, image.id); assert.deepEqual(task.tags, ['waiting'])
    f.store.undoWorkspace(undo)
    assert.equal(f.store.getNote(id).kind, 'inbox'); assert.equal(f.store.getNote(id).intention, undefined)
    assert.equal(list(f.store, { horizon: 'unplanned' }).total, 1)
    const noteUndo = move(f.store, f.store.getNote(id), 'unplanned', { classify: 'note' })
    assert.equal(list(f.store).total, 0)
    f.store.undoWorkspace(noteUndo)
    assert.equal(list(f.store).total, 1)
  } finally { f.close() }
})

test('filtered queries paginate complete counts, and reordering preserves hidden tasks', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    const tasks = Array.from({ length: 56 }, (_, index) => make(f.store, `Task ${String(index).padStart(2, '0')}`, category.id))
    f.store.setItemTags(tasks[1].id, ['waiting']); f.store.setItemTags(tasks[53].id, ['waiting'])
    const page = list(f.store, { horizon: 'unplanned', limit: 50 })
    assert.equal(page.total, 56); assert.equal(page.items.length, 50)
    const next = list(f.store, { horizon: 'unplanned', limit: 50, cursor: page.nextCursor })
    assert.equal(next.items.length, 6)
    const filtered = list(f.store, { tags: ['waiting'] })
    assert.equal(filtered.total, 2); assert.equal(filtered.counts.unplanned, 2)
    const hiddenOrder = list(f.store, { limit: 100 }).items.filter(item => !item.tags.includes('waiting')).map(item => item.id)
    move(f.store, tasks[53], 'unplanned', { beforeId: tasks[1].id })
    assert.deepEqual(list(f.store, { tags: ['waiting'] }).items.map(item => item.id), [tasks[53].id, tasks[1].id])
    assert.deepEqual(list(f.store, { limit: 100 }).items.filter(item => !item.tags.includes('waiting')).map(item => item.id), hiddenOrder)
    assert.throws(() => list(f.store, { horizon: 'unplanned', cursor: page.nextCursor }), /Tasks changed/)
    assert.throws(() => list(f.store, { today: '2026-10-09', cursor: next.nextCursor ?? page.nextCursor }), /Tasks changed/)
    assert.equal(list(f.store, { query: 'Task 53', excludedTags: ['waiting'] }).total, 0)
  } finally { f.close() }
})

test('category changes clear incompatible subcategories, completion/reopening retain plans, and undo rejects edited items', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work'), other = f.store.createCategory('Personal'), sub = f.store.createSubcategory('Planning', category.id)
    const task = f.store.createPlannerTask({ body: 'Review', categoryId: category.id, subcategoryId: sub.id, tags: [], placement: { kind: 'backlog' } })
    const undo = move(f.store, task, 'tomorrow', { categoryId: other.id })
    assert.equal(f.store.getNote(task.id).subcategoryId, null)
    f.store.undoWorkspace(undo)
    assert.equal(f.store.getNote(task.id).subcategoryId, sub.id)
    move(f.store, task, 'next-week')
    const intention = f.store.getNote(task.id).intention
    f.store.setTaskCompleted(task.id, true)
    assert.equal(list(f.store).total, 0); assert.equal(list(f.store, { completed: true }).total, 1)
    f.store.setTaskCompleted(task.id, false)
    assert.deepEqual(f.store.getNote(task.id).intention, intention)
    const stale = move(f.store, task, 'later')
    f.store.updateItem(task.id, f.store.getNote(task.id).revision, 'Edited', [], category.id)
    assert.throws(() => f.store.undoWorkspace(stale), /Undo is no longer available/)
    f.store.deleteCategory(category.id)
    assert.equal(list(f.store, { categoryId: null }).total, 1)
    f.store.trash([task.id]); assert.equal(list(f.store).total, 0)
    f.store.restore([task.id]); assert.equal(list(f.store).total, 1)
  } finally { f.close() }
})

test('reorder Undo returns a task between its original neighbors without duplicate ranks', () => {
  const f = fixture()
  try {
    const tasks = ['First', 'Second', 'Third'].map(body => make(f.store, body))
    const undo = move(f.store, tasks[2], 'unplanned', { beforeId: tasks[0].id })
    assert.deepEqual(list(f.store).items.map(item => item.body), ['Third', 'First', 'Second'])
    f.store.undoWorkspace(undo)
    assert.deepEqual(list(f.store).items.map(item => item.body), ['First', 'Second', 'Third'])
    assert.deepEqual(list(f.store).items.map(item => item.intention.position), [0, 1, 2])
  } finally { f.close() }
})

test('capture type persists with the draft, bypasses sorting, resets after submit and retries idempotently', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    f.store.updateDraft('Direct task', 0, 1, category.id, null, ['waiting'], 'task')
    assert.equal(f.store.getCaptureDraft().captureKind, 'task')
    const requestId = crypto.randomUUID(), id = f.store.submitCapture(requestId, 0, 'Direct task', category.id)
    assert.equal(f.store.getNote(id).kind, 'task'); assert.equal(f.store.getNote(id).intention.kind, 'unplanned')
    assert.equal(f.store.getCaptureDraft().captureKind, 'inbox')
    assert.equal(f.store.submitCapture(requestId, 0, '', category.id), id)
    const note = f.store.submitCapture(crypto.randomUUID(), 1, 'Reference', category.id, null, [], 'note')
    assert.equal(f.store.getNote(note).kind, 'note'); assert.equal(list(f.store).total, 1)
    assert.equal(f.store.taskExportMetadata([id]).get(id).intention.kind, 'unplanned')
  } finally { f.close() }
})

test('schema 13 upgrades without changing calendar fields and creates a restorable pre-migration backup', async () => {
  const f = fixture()
  let upgraded
  try {
    const backlog = make(f.store, 'Backlog'), ready = f.store.createPlannerTask({ body: 'Ready', tags: [], placement: { kind: 'ready' } }), later = f.store.createPlannerTask({ body: 'Later', tags: [], placement: { kind: 'later' } })
    const timed = f.store.createPlannerTask({ body: 'Scheduled', tags: [], placement: { kind: 'timed', startAt: new Date('2026-11-03T10:00').getTime(), endAt: new Date('2026-11-03T11:00').getTime() } })
    f.store.db.exec('DROP TRIGGER task_intention_insert; DROP TRIGGER task_intention_classify; DROP TRIGGER task_intention_unfile; DROP TABLE task_intentions; ALTER TABLE drafts DROP COLUMN capture_kind; DELETE FROM schema_migrations WHERE version>=14;')
    f.store.close(); upgraded = new Store(f.file)
    assert.equal(upgraded.getNote(backlog.id).intention.kind, 'unplanned')
    assert.equal(upgraded.getNote(ready.id).intention.targetDate, toLocalISODate(new Date()))
    assert.equal(upgraded.getNote(later.id).intention.kind, 'later')
    assert.equal(upgraded.getNote(timed.id).intention.targetDate, '2026-11-03')
    assert.deepEqual(placement(upgraded.listPlanner('2026-11-03', '2026-11-03').tasks.find(item => item.id === timed.id)), placement(timed))
    const pre = path.join(f.folder, 'backups', fs.readdirSync(path.join(f.folder, 'backups')).find(name => name.startsWith('pre-migration-')))
    assert.equal(upgraded.checkIntegrity(pre), undefined)
    const backup = path.join(f.folder, 'schema14.sqlite'); await upgraded.backupTo(backup); assert.equal(upgraded.checkIntegrity(backup), undefined)
    upgraded.replaceWith(pre); assert.equal(upgraded.getNote(later.id).intention.kind, 'later')
    assert.equal(upgraded.db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version, 15)
  } finally { upgraded?.close(); f.close() }
})

test('SQL horizon projection agrees with domain classification for every date and week around a year boundary', () => {
  const f = fixture()
  try {
    for (const target of ['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11', '2027-01-18']) {
      const task = make(f.store, target)
      f.store.db.prepare('UPDATE task_intentions SET kind=?,target_date=? WHERE note_id=?').run('week', target, task.id)
    }
    for (const target of ['2026-12-27', '2026-12-28', '2026-12-31', '2027-01-01', '2027-01-03', '2027-01-04', '2027-01-10', '2027-01-11', '2027-02-01']) {
      const task = make(f.store, target)
      f.store.db.prepare('UPDATE task_intentions SET kind=?,target_date=? WHERE note_id=?').run('day', target, task.id)
    }
    for (const reference of ['2026-12-27', '2026-12-31', '2027-01-03', '2027-01-04']) for (const task of list(f.store, { today: reference }).items) assert.equal(task.horizon, horizonOf(task.intention, reference))
  } finally { f.close() }
})


test('schema 14 defers the removed This week bucket to Later once and preserves calendar placements', () => {
  const f = fixture()
  let upgraded
  try {
    const localToday = toLocalISODate(new Date())
    const current = make(f.store, 'Old current week')
    const next = make(f.store, 'Keep next week')
    const currentPlan = intentionFor('week', localToday), nextPlan = intentionFor('next-week', localToday)
    f.store.db.prepare("UPDATE task_intentions SET kind='week',target_date=? WHERE note_id=?").run(currentPlan.targetDate, current.id)
    f.store.db.prepare("UPDATE task_intentions SET kind='week',target_date=? WHERE note_id=?").run(nextPlan.targetDate, next.id)
    const before = placement(f.store.getNote(current.id))
    f.store.db.prepare('DELETE FROM schema_migrations WHERE version=15').run()
    f.store.close()
    upgraded = new Store(f.file)
    assert.equal(upgraded.getNote(current.id).intention.kind, 'later')
    assert.equal(upgraded.getNote(current.id).intention.targetDate, null)
    assert.equal(upgraded.getNote(next.id).intention.targetDate, nextPlan.targetDate)
    assert.equal(upgraded.listWorkspace({ today: localToday, horizon: 'later' }).items[0].id, current.id)
    assert.deepEqual(placement(upgraded.getNote(current.id)), before)
    const revision = upgraded.getNote(current.id).revision
    upgraded.close(); upgraded = new Store(f.file)
    assert.equal(upgraded.getNote(current.id).revision, revision)
  } finally { upgraded?.close(); f.close() }
})


test('Backlog and planned scopes filter before counts and pagination', () => {
  const f = fixture()
  try {
    const backlog = make(f.store, 'Undecided')
    const capture = f.store.submitCapture(crypto.randomUUID(), 0, 'Capture')
    const planned = make(f.store, 'Planned')
    move(f.store, planned, 'tomorrow')
    const waiting = list(f.store, { scope: 'backlog', limit: 1 })
    assert.equal(waiting.total, 2)
    assert.equal(waiting.counts.unplanned, 2)
    assert.equal(waiting.categoryCounts.unassigned, 2)
    assert.equal(waiting.counts.tomorrow, 0)
    assert.ok(waiting.nextCursor)
    const next = list(f.store, { scope: 'backlog', limit: 1, cursor: waiting.nextCursor })
    assert.deepEqual(new Set([...waiting.items, ...next.items].map(item => item.id)), new Set([backlog.id, capture]))
    const active = list(f.store, { scope: 'planned' })
    assert.equal(active.total, 1)
    assert.equal(active.items[0].id, planned.id)
    assert.equal(active.captureTotal, 0)
    assert.equal(active.counts.unplanned, 0)
  } finally { f.close() }
})


test('Backlog tags can be created on a capture without classifying or planning it', () => {
  const f = fixture()
  try {
    const id = f.store.submitCapture(crypto.randomUUID(), 0, 'Tag this capture')
    const before = f.store.getNote(id)
    f.store.setItemTags(id, ['Planning', 'New tag', 'planning'])
    const tagged = f.store.getNote(id)
    assert.equal(tagged.kind, 'inbox')
    assert.equal(tagged.categoryId, before.categoryId)
    assert.equal(tagged.revision, before.revision + 1)
    assert.deepEqual(new Set(tagged.tags), new Set(['planning', 'New tag']))
    assert.equal(f.store.taxonomy().tags.filter(tag => tag.name.toLowerCase() === 'planning').length, 1)
    f.store.setItemTags(id, ['New tag'])
    assert.deepEqual(f.store.getNote(id).tags, ['New tag'])
  } finally { f.close() }
})
