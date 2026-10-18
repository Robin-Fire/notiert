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
  return { store, file, folder, close() { if (this.store.db.open) this.store.close(); fs.rmSync(folder, { recursive: true, force: true }) } }
}
const list = (store, extra = {}) => store.listWorkspace({ today, ...extra })
const make = (store, body, categoryId = null) => store.createPlannerTask({ body, categoryId, tags: [], placement: { kind: 'backlog' } })
function move(store, task, horizon, extra = {}) { return store.moveWorkspace({ id: task.id, expectedRevision: store.getItem(task.id).revision, intention: intentionFor(horizon, today), beforeId: null, today, ...extra }) }
const placement = task => [task.plannedDate, task.plannedStartAt, task.plannedEndAt, task.ready, task.later, task.position, task.priorityPosition, task.beforeEventId]

test('search includes open and completed tasks across horizons with counts and pagination before filtering', () => {
  const f = fixture()
  try {
    for (let index = 0; index < 56; index++) {
      const task = make(f.store, `Reference record ${String(index).padStart(2, '0')}\nDetailed saved information`, null)
      f.store.setItemTags(task.id, ['reference'])
      if (index % 3 === 0) move(f.store, task, 'now')
      if (index % 2 === 0) f.store.setTaskCompleted(task.id, true)
    }
    const removed = make(f.store, 'Reference record removed')
    f.store.trash([removed.id])
    const page = list(f.store, { scope: 'all', query: 'saved information', tags: ['reference'], limit: 50 })
    assert.equal(page.total, 56)
    assert.equal(page.items.length, 50)
    assert.ok(page.items.some(item => item.completedAt !== null))
    assert.ok(page.items.some(item => item.completedAt === null))
    const next = list(f.store, { scope: 'all', query: 'saved information', tags: ['reference'], limit: 50, cursor: page.nextCursor })
    assert.equal(next.items.length, 6)
    assert.equal(new Set([...page.items, ...next.items].map(item => item.id)).size, 56)
    assert.equal(list(f.store, { query: 'Reference record', completed: true }).total, 28)
    assert.equal(list(f.store, { scope: 'all' }).total, 28)
    const overview = f.store.workspaceOverview({ today, query: 'saved information', scope: 'all' })
    assert.deepEqual(Object.keys(overview), ['unplanned'])
    assert.equal(overview.unplanned.total, 56)
  } finally { f.close() }
})

test('schema 17 preserves former notes as completed tasks and captures as Backlog tasks', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Reference')
    const image = f.store.addDraftImage(0, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')
    const reference = f.store.submitCapture(crypto.randomUUID(), 0, 'Saved reference content', category.id, null, ['archive'], 'note')
    const capture = f.store.submitCapture(crypto.randomUUID(), 1, 'Unplanned old capture', null, null, [], 'inbox')
    const active = make(f.store, 'Existing task')
    const originalTask = f.store.getItem(active.id)
    const before = f.store.getItem(reference)
    f.store.db.prepare('DELETE FROM schema_migrations WHERE version>=17').run()
    f.store.close(); f.store = new Store(f.file)
    const migrated = f.store.getItem(reference)
    assert.equal(migrated.kind, 'task')
    assert.ok(migrated.completedAt !== null)
    assert.equal(migrated.body, before.body)
    assert.equal(migrated.categoryId, category.id)
    assert.deepEqual(migrated.tags, ['archive'])
    assert.equal(migrated.images[0].id, image.id)
    assert.equal(migrated.createdAt, before.createdAt)
    assert.equal(migrated.intention.kind, 'unplanned')
    assert.equal(list(f.store, { query: 'Saved reference content' }).items[0].id, reference)
    assert.equal(f.store.getItem(capture).kind, 'task')
    assert.equal(f.store.getItem(capture).completedAt, null)
    assert.deepEqual(f.store.getItem(active.id), { ...originalTask, revision: originalTask.revision + 1 })
    assert.equal(f.store.getCaptureDraft().captureKind, 'task')
    assert.ok(fs.readdirSync(path.join(f.folder, 'backups')).some(name => name.startsWith('pre-migration-')))
    const revision = migrated.revision
    f.store.close(); f.store = new Store(f.file)
    assert.equal(f.store.getItem(reference).revision, revision)
  } finally { if (f.store.db.open) f.store.close(); f.close() }
})

test('one save commits text, tags, plan and schedule together and rolls back failed planning', () => {
  const f = fixture()
  try {
    const task = make(f.store, 'Original task')
    const startAt = new Date('2026-10-09T10:00').getTime(), endAt = startAt + 3600000
    const sequence = f.store.changeSequence
    assert.throws(() => f.store.saveItem({ id: task.id, expectedRevision: task.revision, body: 'Must roll back', tags: ['temporary'], plan: { today: 'invalid', intention: day('2026-10-09') } }), /valid local date/)
    assert.equal(f.store.changeSequence, sequence)
    assert.equal(f.store.getItem(task.id).body, 'Original task')
    assert.deepEqual(f.store.getItem(task.id).tags, [])
    assert.equal(list(f.store, { query: 'Must roll back' }).total, 0)
    const updated = f.store.saveItem({ id: task.id, expectedRevision: task.revision, body: 'Updated task', tags: ['planned'], plan: { today, intention: day('2026-10-09') }, placement: { kind: 'timed', startAt, endAt } })
    assert.equal(f.store.changeSequence, sequence + 1)
    assert.equal(updated.body, 'Updated task')
    assert.deepEqual(updated.tags, ['planned'])
    const saved = list(f.store, { horizon: 'next' }).items[0]
    assert.equal(saved.plannedStartAt, startAt)
    assert.equal(saved.plannedEndAt, endAt)
    assert.throws(() => f.store.saveItem({ id: task.id, expectedRevision: task.revision, body: 'Stale edit', tags: [] }), /changed elsewhere/)
    assert.equal(f.store.getItem(task.id).body, 'Updated task')
  } finally { f.close() }
})

test('completion undo restores plan and calendar placement and refuses to overwrite later edits', () => {
  const f = fixture()
  try {
    for (const plan of [{ kind: 'ready' }, { kind: 'later' }, { kind: 'timed', startAt: new Date('2026-10-08T10:00').getTime(), endAt: new Date('2026-10-08T11:00').getTime() }]) {
      const task = f.store.createPlannerTask({ body: 'Complete me', tags: [], placement: plan })
      move(f.store, task, 'now')
      const before = list(f.store, { horizon: 'now' }).items.find(item => item.id === task.id)
      const undo = f.store.completeWorkspace({ id: task.id, expectedRevision: before.revision, completed: true })
      assert.ok(f.store.getItem(task.id).completedAt !== null)
      f.store.undoCompletion(undo)
      const restored = list(f.store, { horizon: 'now' }).items.find(item => item.id === task.id)
      assert.deepEqual(placement(restored), placement(before))
      assert.deepEqual(restored.intention, before.intention)
      const secondUndo = f.store.completeWorkspace({ id: task.id, expectedRevision: restored.revision, completed: true })
      const current = f.store.getItem(task.id)
      f.store.updateItem(task.id, current.revision, 'Edited later', [])
      assert.throws(() => f.store.undoCompletion(secondUndo), /Undo is no longer available/)
      assert.equal(f.store.getItem(task.id).body, 'Edited later')
      assert.ok(f.store.getItem(task.id).completedAt !== null)
    }
  } finally { f.close() }
})

test('workspace overview returns consistent counts and independent horizon pagination', () => {
  const f = fixture()
  try {
    for (let i = 0; i < 3; i++) move(f.store, make(f.store, `Today ${i}`), 'now')
    move(f.store, make(f.store, 'Tomorrow'), 'next')
    const pages = f.store.workspaceOverview({ today, scope: 'planned', limit: 2 })
    assert.equal(pages.now.items.length, 2)
    assert.equal(pages.now.total, 3)
    assert.deepEqual(pages.now.counts, pages.next.counts)
    assert.equal(pages.next.items.length, 1)
    assert.equal(list(f.store, { horizon: 'now', limit: 2, cursor: pages.now.nextCursor }).items.length, 1)
    assert.deepEqual(Object.keys(f.store.workspaceOverview({ today, scope: 'backlog' })), ['unplanned'])
  } finally { f.close() }
})

test('bulk planning classifies captures atomically and rolls back invalid destinations', () => {
  const f = fixture()
  try {
    const task = make(f.store, 'Bulk task')
    const id = f.store.submitCapture(crypto.randomUUID(), 0, 'Bulk capture', undefined, undefined, undefined, 'inbox')
    const capture = f.store.getItem(id)
    const inputs = [task, capture].map(item => ({ id: item.id, expectedRevision: item.revision, intention: day(today), today, beforeId: null }))
    const sequence = f.store.changeSequence
    assert.throws(() => f.store.moveWorkspaceMany([inputs[0], { ...inputs[1], beforeId: crypto.randomUUID() }]), /destination changed/)
    assert.equal(f.store.changeSequence, sequence)
    assert.equal(f.store.getItem(task.id).intention.kind, 'unplanned')
    assert.equal(f.store.getItem(id).kind, 'inbox')
    f.store.moveWorkspaceMany(inputs)
    assert.equal(f.store.changeSequence, sequence + 1)
    assert.equal(list(f.store, { horizon: 'now' }).items.length, 2)
    assert.equal(f.store.getItem(id).kind, 'task')
  } finally { f.close() }
})

test('priorities stay fixed across days, weeks, year boundaries and daylight saving changes', () => {
  for (const bucket of ['unplanned', 'now', 'next', 'soon', 'later']) {
    const intention = intentionFor(bucket, today)
    assert.equal(intention.kind, bucket)
    assert.equal(intention.targetDate, null)
    assert.equal(validIntention(intention), true)
    for (const date of ['2026-10-08', '2026-10-25', '2026-12-31', '2027-01-04']) {
      assert.equal(horizonOf(intention, date), bucket)
      assert.equal(isCarriedOver(intention, date), false)
    }
  }
  assert.equal(validIntention({ kind: 'now', targetDate: today, position: 0 }), false)
  assert.equal(validIntention({ kind: 'soon', targetDate: null, position: -1 }), false)
  assert.equal(validIntention(day('2028-02-29')), true)
  assert.equal(validIntention(day('2026-02-29')), false)
  assert.equal(validIntention(week('2026-10-06')), false)
})

test('moving intentions does not alter calendar placement and calendar reconciliation does not alter intentions', () => {
  const f = fixture()
  try {
    const task = f.store.createPlannerTask({ body: 'Timed task', tags: ['Planning'], placement: { kind: 'timed', startAt: new Date('2026-10-06T09:00').getTime(), endAt: new Date('2026-10-06T10:00').getTime() } })
    const original = placement(task)
    move(f.store, task, 'soon')
    const moved = f.store.listPlanner('2026-10-06', '2026-10-06').tasks.find(item => item.id === task.id)
    assert.deepEqual(placement(moved), original)
    const intention = f.store.getItem(task.id).intention
    f.store.reconcileReadyTasks(today)
    assert.deepEqual(f.store.getItem(task.id).intention, intention)
    const current = f.store.getItem(task.id)
    f.store.schedulePlannerTask({ id: task.id, expectedRevision: current.revision, placement: { kind: 'later' } })
    assert.deepEqual(f.store.getItem(task.id).intention, intention)
    assert.equal(list(f.store, { horizon: 'soon' }).items[0].id, task.id)
  } finally { f.close() }
})

test('capture classification and horizon assignment are atomic, retain images/tags, and undo restores captures', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    const image = f.store.addDraftImage(0, 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=')
    const id = f.store.submitCapture(crypto.randomUUID(), 0, 'Capture', category.id, null, ['waiting'], 'inbox')
    const capture = f.store.getItem(id)
    assert.throws(() => f.store.moveWorkspace({ id, expectedRevision: capture.revision, intention: intentionFor('now', today), today, beforeId: crypto.randomUUID() }), /destination changed/)
    assert.equal(f.store.getItem(id).kind, 'inbox')
    const undo = move(f.store, capture, 'now')
    const task = list(f.store, { horizon: 'now' }).items[0]
    assert.equal(task.categoryId, category.id); assert.equal(task.images[0].id, image.id); assert.deepEqual(task.tags, ['waiting'])
    f.store.undoWorkspace(undo)
    assert.equal(f.store.getItem(id).kind, 'inbox'); assert.equal(f.store.getItem(id).intention, undefined)
    assert.equal(list(f.store, { horizon: 'unplanned' }).total, 1)
    assert.throws(() => move(f.store, f.store.getItem(id), 'unplanned', { classify: 'note' }))
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
    const undo = move(f.store, task, 'next', { categoryId: other.id })
    assert.equal(f.store.getItem(task.id).subcategoryId, null)
    f.store.undoWorkspace(undo)
    assert.equal(f.store.getItem(task.id).subcategoryId, sub.id)
    move(f.store, task, 'soon')
    const intention = f.store.getItem(task.id).intention
    f.store.setTaskCompleted(task.id, true)
    assert.equal(list(f.store).total, 0); assert.equal(list(f.store, { completed: true }).total, 1)
    f.store.setTaskCompleted(task.id, false)
    assert.deepEqual(f.store.getItem(task.id).intention, intention)
    const stale = move(f.store, task, 'later')
    f.store.updateItem(task.id, f.store.getItem(task.id).revision, 'Edited', [], category.id)
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

test('capture always creates a task in Backlog and retries idempotently', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    f.store.updateDraft('Direct task', 0, 1, category.id, null, ['waiting'], 'task')
    const requestId = crypto.randomUUID(), id = f.store.submitCapture(requestId, 0, 'Direct task', category.id)
    assert.equal(f.store.getItem(id).kind, 'task')
    assert.equal(f.store.getItem(id).intention.kind, 'unplanned')
    assert.equal(f.store.getCaptureDraft().captureKind, 'task')
    assert.equal(f.store.submitCapture(requestId, 0, '', category.id), id)
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
    assert.equal(upgraded.getItem(backlog.id).intention.kind, 'unplanned')
    assert.equal(upgraded.getItem(ready.id).intention.kind, 'now')
    assert.equal(upgraded.getItem(later.id).intention.kind, 'later')
    assert.equal(upgraded.getItem(timed.id).intention.kind, horizonOf(day('2026-11-03'), toLocalISODate(new Date())))
    assert.deepEqual(placement(upgraded.listPlanner('2026-11-03', '2026-11-03').tasks.find(item => item.id === timed.id)), placement(timed))
    const pre = path.join(f.folder, 'backups', fs.readdirSync(path.join(f.folder, 'backups')).find(name => name.startsWith('pre-migration-')))
    assert.equal(upgraded.checkIntegrity(pre), undefined)
    const backup = path.join(f.folder, 'schema14.sqlite'); await upgraded.backupTo(backup); assert.equal(upgraded.checkIntegrity(backup), undefined)
    upgraded.replaceWith(pre); assert.equal(upgraded.getItem(later.id).intention.kind, 'later')
    assert.equal(upgraded.db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version, 18)
  } finally { upgraded?.close(); f.close() }
})

test('schema 18 converts date plans once, preserves ordering and calendar fields, and survives backup restore', async () => {
  const f = fixture()
  try {
    const { addLocalDays, mondayISO, fromLocalISODate } = require(path.join(generated, 'dates.cjs'))
    const localToday = toLocalISODate(new Date())
    const targets = [day(localToday), day(addLocalDays(localToday, 1)), week(addLocalDays(mondayISO(fromLocalISODate(localToday)), 7)), day(addLocalDays(localToday, 60)), intentionFor('unplanned'), intentionFor('later')]
    const expected = ['now', 'next', 'soon', 'soon', 'unplanned', 'later']
    const tasks = targets.map((plan, index) => {
      const task = index === 0 ? f.store.createPlannerTask({ body: `Priority migration ${index}`, categoryId: null, tags: [], placement: { kind: 'timed', startAt: new Date(`${localToday}T10:00`).getTime(), endAt: new Date(`${localToday}T11:00`).getTime() } }) : make(f.store, `Priority migration ${index}`)
      f.store.db.prepare('UPDATE task_intentions SET kind=?,target_date=?,position=? WHERE note_id=?').run(plan.kind, plan.targetDate, index, task.id)
      return task
    })
    const before = tasks.map(task => placement(f.store.getItem(task.id)))
    f.store.db.prepare('DELETE FROM schema_migrations WHERE version=18').run()
    f.store.close(); f.store = new Store(f.file)
    tasks.forEach((task, index) => {
      assert.equal(f.store.getItem(task.id).intention.kind, expected[index])
      assert.equal(f.store.getItem(task.id).intention.targetDate, null)
      assert.deepEqual(placement(f.store.getItem(task.id)), before[index])
    })
    assert.deepEqual(list(f.store, { horizon: 'soon' }).items.map(task => task.id), [tasks[2].id, tasks[3].id])
    const snapshot = tasks.map(task => f.store.getItem(task.id))
    f.store.close(); f.store = new Store(f.file)
    assert.deepEqual(tasks.map(task => f.store.getItem(task.id)), snapshot)
    for (const date of ['2026-12-31', '2027-06-01']) assert.deepEqual(list(f.store, { today: date }).counts, list(f.store).counts)
    const backup = path.join(f.folder, 'priorities.sqlite')
    await f.store.backupTo(backup)
    assert.equal(f.store.checkIntegrity(backup), undefined)
    f.store.replaceWith(backup)
    assert.deepEqual(tasks.map(task => f.store.getItem(task.id)), snapshot)
    assert.ok(fs.readdirSync(path.join(f.folder, 'backups')).some(name => name.startsWith('pre-migration-')))
  } finally { f.close() }
})

test('Backlog and planned scopes filter before counts and pagination', () => {
  const f = fixture()
  try {
    const backlog = make(f.store, 'Undecided')
    const capture = f.store.submitCapture(crypto.randomUUID(), 0, 'Capture', undefined, undefined, undefined, 'inbox')
    const planned = make(f.store, 'Planned')
    move(f.store, planned, 'next')
    const waiting = list(f.store, { scope: 'backlog', limit: 1 })
    assert.equal(waiting.total, 2)
    assert.equal(waiting.counts.unplanned, 2)
    assert.equal(waiting.categoryCounts.unassigned, 2)
    assert.equal(waiting.counts.next, 0)
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
    const id = f.store.submitCapture(crypto.randomUUID(), 0, 'Tag this capture', undefined, undefined, undefined, 'inbox')
    const before = f.store.getItem(id)
    f.store.setItemTags(id, ['Planning', 'New tag', 'planning'])
    const tagged = f.store.getItem(id)
    assert.equal(tagged.kind, 'inbox')
    assert.equal(tagged.categoryId, before.categoryId)
    assert.equal(tagged.revision, before.revision + 1)
    assert.deepEqual(new Set(tagged.tags), new Set(['planning', 'New tag']))
    assert.equal(f.store.taxonomy().tags.filter(tag => tag.name.toLowerCase() === 'planning').length, 1)
    f.store.setItemTags(id, ['New tag'])
    assert.deepEqual(f.store.getItem(id).tags, ['New tag'])
  } finally { f.close() }
})
