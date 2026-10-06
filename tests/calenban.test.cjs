const legacyTaxonomy = require('./helpers/taxonomy-fixture.cjs')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, test } = require('node:test')
const { randomUUID } = require('node:crypto')
const Database = require('better-sqlite3')
const { buildSync } = require('esbuild')

const root = path.resolve(__dirname, '..')
const generated = path.join(__dirname, '.generated', 'calenban')
fs.mkdirSync(generated, { recursive: true })
buildSync({ absWorkingDir: root, entryPoints: ['src/main/storage/database.ts'], outfile: path.join(generated, 'database.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
buildSync({ absWorkingDir: root, entryPoints: ['src/shared/plannerDrop.ts'], outfile: path.join(generated, 'plannerDrop.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
buildSync({ absWorkingDir: root, entryPoints: ['src/shared/plannerDates.ts'], outfile: path.join(generated, 'plannerDates.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { Store } = require(path.join(generated, 'database.cjs'))
const { resolvePlannerDrop } = require(path.join(generated, 'plannerDrop.cjs'))
const { localDateBounds, eventOverlapsLocalDay } = require(path.join(generated, 'plannerDates.cjs'))

after(() => fs.rmSync(generated, { recursive: true, force: true }))

function withStore(callback) {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-test-'))
  const store = new Store(path.join(folder, 'notes.sqlite'))
  try { callback(store) }
  finally { store.close(); fs.rmSync(folder, { recursive: true, force: true }) }
}

function captureTask(store, body, tags = []) {
  const id = store.submitCapture(randomUUID(), 0, body)
  store.classifyItem(id, 'task', tags)
  return id
}

test('pasted image survives draft restart, image-only capture, filing, and backup', async () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-image-test-'))
  const file = path.join(folder, 'notes.sqlite')
  const backup = path.join(folder, 'backup.sqlite')
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8n+QAAAAASUVORK5CYII='
  let store = new Store(file)
  try {
    const image = store.addDraftImage(0, dataUrl)
    assert.deepEqual(store.getCaptureDraft().images, [image])
    store.close()
    store = new Store(file)
    assert.deepEqual(store.getCaptureDraft().images, [image])
    const id = store.submitCapture(randomUUID(), 0, '')
    assert.deepEqual(store.getNote(id).images, [{ id: image.id, mimeType: 'image/png' }])
    assert.equal(store.getItemImage(image.id), dataUrl)
    assert.deepEqual(store.getCaptureDraft().images, [])
    store.classifyItem(id, 'task', ['Visual'])
    assert.equal(store.getNote(id).images.length, 1)
    await store.backupTo(backup)
    store.checkIntegrity(backup)
    const removable = store.addDraftImage(1, dataUrl)
    store.removeDraftImage(1, removable.id)
    assert.deepEqual(store.getCaptureDraft().images, [])
    assert.throws(() => store.addDraftImage(1, 'data:image/png;base64,ZmFrZQ=='), /Paste a PNG/)
  } finally { store.close(); fs.rmSync(folder, { recursive: true, force: true }) }
})

test('version 3 database migrates to image storage without losing notes', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-v3-'))
  const file = path.join(folder, 'notes.sqlite')
  let store = new Store(file)
  try {
    const id = store.submitCapture(randomUUID(), 0, 'Before image support')
    store.db.exec('DROP TABLE item_images; DROP TABLE capture_draft_images; DELETE FROM schema_migrations WHERE version=4;')
    store.close()
    store = new Store(file)
    assert.equal(store.getNote(id).body, 'Before image support')
    assert.deepEqual(store.getNote(id).images, [])
    assert.equal(store.checkIntegrity(), undefined)
  } finally { store.close(); fs.rmSync(folder, { recursive: true, force: true }) }
})

test('classification is one-shot and preserves task tags', () => {
  withStore((store) => {
    const id = captureTask(store, 'Plan the launch\nWrite the checklist', [' Work  ', 'work', 'Project A'])
    const day = '2026-09-26'
    store.movePlannerTask(id, day, null, null)
    assert.throws(() => store.classifyItem(id, 'task', []), /already been filed/i)
    assert.equal(store.db.prepare('SELECT planned_date FROM notes WHERE id=?').get(id).planned_date, day)
    assert.equal(store.db.prepare('SELECT task_status FROM notes WHERE id=?').get(id).task_status, 'open')
    assert.equal(store.getNote(id).tags.length, 2)
  })
})

test('categories and tag colors persist while tags remain independent', () => {
  withStore((store) => {
    const id = captureTask(store, 'Categorized task', ['Work'])
    const first = store.createCategory('Projects')
    const second = store.createCategory('Areas')
    const work = store.taxonomy().tags.find((tag) => tag.name === 'Work')
    assert.equal(work.categoryId, null)
    store.updateTag(work.id, first.id, '#c2413b')
    assert.equal(store.taxonomy().tags.find((tag) => tag.id === work.id).categoryId, null)
    assert.equal(store.taxonomy().tags.find((tag) => tag.id === work.id).color, '#c2413b')
    store.updateTag(work.id, second.id, '#2563eb')
    assert.equal(store.taxonomy().tags.find((tag) => tag.id === work.id).categoryId, null)
    assert.equal(store.listNotes({ query: '', scope: 'notes', tags: ['Work'], limit: 50, sort: 'newest' }).items[0].id, id)
    assert.throws(() => store.createTag('work', first.id), /already exists/i)
  })
})

test('deleting a category keeps its items and tags, while deleting a tag removes its item links', () => {
  withStore((store) => {
    const uncategorized = store.createTag('General', null)
    const category = store.createCategory('Projects')
    const projectTag = store.createTag('Planning', category.id)
    const id = store.submitCapture(randomUUID(), 0, 'Keep this item', category.id)
    store.classifyItem(id, 'note', [projectTag.name], category.id)

    store.deleteCategory(category.id)

    assert.equal(store.getNote(id).categoryId, null)
    assert.deepEqual(store.getNote(id).tags, ['Planning'])
    assert.equal(store.taxonomy().categories.some((entry) => entry.id === category.id), false)
    assert.equal(store.taxonomy().tags.find((entry) => entry.id === projectTag.id).categoryId, null)
    assert.deepEqual(store.db.prepare('SELECT id,position FROM item_tags ORDER BY position').all(), [
      { id: uncategorized.id, position: 0 }, { id: projectTag.id, position: 1 },
    ])

    store.deleteTag(projectTag.id)

    assert.ok(store.getNote(id))
    assert.deepEqual(store.getNote(id).tags, [])
    assert.deepEqual(store.taxonomy().tags.map((entry) => entry.id), [uncategorized.id])
    assert.throws(() => store.deleteTag(projectTag.id), /tag no longer exists/i)
  })
})

test('unscheduled tasks can be reordered and dated tasks can be dropped onto an unscheduled card', () => {
  withStore((store) => {
    const first = captureTask(store, 'First')
    const second = captureTask(store, 'Second')
    const third = captureTask(store, 'Third')
    store.movePlannerTask(second, null, null, null)
    store.movePlannerTask(first, null, null, second)
    store.movePlannerTask(third, '2026-09-26', null, null)
    store.movePlannerTask(third, null, null, first)
    const order = store.listPlanner('2026-09-26', '2026-09-26').tasks.filter((task) => task.plannedDate === null).map((task) => task.body)
    assert.deepEqual(order, ['Third', 'First', 'Second'])
  })
})

test('Inbox retrieval paginates without losing stable ordering', () => {
  withStore((store) => {
    for (let index = 0; index < 55; index++) store.submitCapture(randomUUID(), 0, 'Capture ' + index)
    const firstPage = store.listInbox(undefined, 50)
    const secondPage = store.listInbox(firstPage.nextCursor, 50)
    assert.equal(firstPage.items.length, 50)
    assert.equal(firstPage.total, 55)
    assert.equal(secondPage.items.length, 5)
    assert.equal(secondPage.nextCursor, null)
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 55)
  })
})

test('tasks move between category backlog, Ready, a day, and back to Ready', () => {
  withStore((store) => {
    const category = store.createCategory('Client A')
    const id = store.submitCapture(randomUUID(), 0, 'Prepare review')
    store.classifyItem(id, 'task', ['Design'], category.id)
    assert.equal(store.listBacklog({ categoryId: category.id }).items[0].categoryId, category.id)
    const otherCategory = store.createCategory('Client B')
    store.setItemCategory(id, otherCategory.id)
    assert.equal(store.listBacklog({ categoryId: otherCategory.id }).items[0].categoryId, otherCategory.id)
    store.setItemCategory(id, category.id)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-28').tasks.length, 0)
    const priority = store.db.prepare('SELECT backlog_position FROM notes WHERE id=?').get(id).backlog_position
    store.setTaskReady(id)
    assert.equal(store.listBacklog({ categoryId: category.id }).total, 0)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-28').tasks[0].ready, true)
    store.movePlannerTask(id, '2026-09-27', null, null)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-28').tasks[0].plannedDate, '2026-09-27')
    store.setTaskReady(id)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-28').tasks[0].plannedDate, null)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-28').tasks[0].categoryId, category.id)
    assert.equal(store.db.prepare('SELECT backlog_position FROM notes WHERE id=?').get(id).backlog_position, priority)
  })
})

test('v7 migration assigns direct categories only from unambiguous legacy tags and initializes priority', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-v7-'))
  const file = path.join(folder, 'notes.sqlite')
  let store = new Store(file)
  try {
    const one = store.createCategory('One')
    const two = store.createCategory('Two')
    const onlyOne = store.createTag('Only one', one.id)
    const alsoOne = store.createTag('Also one', one.id)
    const other = store.createTag('Other', two.id)
    const note = store.submitCapture(randomUUID(), 0, 'Legacy note')
    store.classifyItem(note, 'note', [onlyOne.name])
    store.db.prepare('UPDATE notes SET project_id=NULL WHERE id=?').run(note)
    const ambiguous = store.submitCapture(randomUUID(), 0, 'Ambiguous note')
    store.classifyItem(ambiguous, 'note', [alsoOne.name, other.name])
    store.db.prepare('UPDATE notes SET project_id=NULL WHERE id=?').run(ambiguous)
    const newest = store.submitCapture(randomUUID(), 0, 'Newest task')
    store.classifyItem(newest, 'task', [], one.id)
    const older = store.submitCapture(randomUUID(), 0, 'Older task')
    store.classifyItem(older, 'task', [], one.id)
    store.db.prepare('UPDATE notes SET created_at=100 WHERE id=?').run(newest)
    store.db.prepare('UPDATE notes SET created_at=50 WHERE id=?').run(older)

    legacyTaxonomy(store, [[onlyOne.id,one.id],[alsoOne.id,one.id],[other.id,two.id]])
    store.db.exec('DROP TRIGGER notes_timing_insert; DROP TRIGGER notes_timing_update; DROP INDEX notes_timed_plan; DROP INDEX notes_later; DROP INDEX item_tags_order; DROP INDEX notes_backlog_priority; ALTER TABLE notes DROP COLUMN planned_start_at; ALTER TABLE notes DROP COLUMN planned_end_at; ALTER TABLE notes DROP COLUMN is_later; ALTER TABLE item_tags DROP COLUMN position; ALTER TABLE notes DROP COLUMN backlog_position; ALTER TABLE drafts DROP COLUMN category_id; DELETE FROM schema_migrations WHERE version>=8;')
    store.close()
    store = null
    store = new Store(file)

    assert.equal(store.getNote(note).categoryId, one.id)
    assert.equal(store.getNote(ambiguous).categoryId, null)
    assert.deepEqual(store.listBacklog({ categoryId: one.id }).items.map((item) => item.id), [newest, older])
    assert.equal(store.getCaptureDraft().categoryId, null)
    assert.equal(store.checkIntegrity(), undefined)
    assert.ok(fs.readdirSync(path.join(folder, 'backups')).some((name) => name.startsWith('pre-migration-')))
  } finally { store?.close(); fs.rmSync(folder, { recursive: true, force: true }) }
})

test('capture category persists in the draft and copies to the submitted Inbox item', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-capture-category-'))
  const file = path.join(folder, 'notes.sqlite')
  let store = new Store(file)
  try {
    const category = store.createCategory('Personal')
    store.updateDraft('Captured thought', 0, 0, category.id)
    store.close()
    store = new Store(file)
    assert.equal(store.getCaptureDraft().categoryId, category.id)
    const id = store.submitCapture(randomUUID(), 0, 'Captured thought', category.id)
    assert.equal(store.getNote(id).categoryId, category.id)
    assert.equal(store.getCaptureDraft().categoryId, null)
  } finally { store?.close(); fs.rmSync(folder, { recursive: true, force: true }) }
})

test('classification preserves an Inbox category by default and honors an explicit Unassigned choice', () => {
  withStore((store) => {
    const category = store.createCategory('Work')
    const tag = store.createTag('Planning', category.id)
    const keep = store.submitCapture(randomUUID(), 0, 'Keep my category', category.id)
    store.classifyItem(keep, 'note', [tag.name])
    assert.equal(store.getNote(keep).categoryId, category.id)
    const clear = store.submitCapture(randomUUID(), 0, 'Leave unassigned', category.id)
    store.classifyItem(clear, 'note', [tag.name], null)
    assert.equal(store.getNote(clear).categoryId, null)
  })
})

test('category tag filters use OR matching, deduplicate multi-tag tasks, and include No tag', () => {
  withStore((store) => {
    const category = store.createCategory('Work')
    const otherCategory = store.createCategory('Home')
    const tagOne = store.createTag('Planning', category.id)
    const tagTwo = store.createTag('Writing', category.id)
    const foreignTag = store.createTag('Home tag', otherCategory.id)
    const matching = store.submitCapture(randomUUID(), 0, 'Both tags')
    store.classifyItem(matching, 'task', [tagOne.name, tagTwo.name], category.id)
    const foreignTagged = store.submitCapture(randomUUID(), 0, 'Foreign tag')
    store.classifyItem(foreignTagged, 'task', [foreignTag.name], category.id)
    const untagged = store.submitCapture(randomUUID(), 0, 'No tag')
    store.classifyItem(untagged, 'task', [], category.id)
    const unrelated = store.submitCapture(randomUUID(), 0, 'Another category')
    store.classifyItem(unrelated, 'task', [tagOne.name], otherCategory.id)

    const filtered = store.listBacklog({ categoryId: category.id, tagNames: [tagOne.name, tagTwo.name], includeUntagged: true })
    assert.deepEqual(filtered.items.map((item) => item.id), [matching, untagged])
    assert.equal(filtered.total, 2)
    assert.ok(!('tagNames' in filtered), 'backlog pages omit unused tag options')
    assert.deepEqual(store.listBacklog({ categoryId: category.id, tagNames: [foreignTag.name], includeUntagged: false }).items.map((item) => item.id), [foreignTagged])
    assert.deepEqual(store.listBacklog({ categoryId: category.id, tagNames: [], includeUntagged: false }).items, [])
    assert.deepEqual(store.listBacklog({ categoryId: category.id, tagNames: [], includeUntagged: true }).items.map((item) => item.id), [untagged])
  })
})

test('reordering a category backlog updates the shared order used by category and tag pages', () => {
  withStore((store) => {
    const category = store.createCategory('Work')
    const tag = store.createTag('Planning', category.id)
    const first = store.submitCapture(randomUUID(), 0, 'First')
    const second = store.submitCapture(randomUUID(), 0, 'Second')
    const third = store.submitCapture(randomUUID(), 0, 'Third')
    store.classifyItem(first, 'task', [tag.name], category.id)
    store.classifyItem(second, 'task', [tag.name], category.id)
    store.classifyItem(third, 'task', [], category.id)
    store.reorderBacklog(first, category.id, null)

    const backlog = store.listBacklog({ categoryId: category.id }).items.map((item) => item.id)
    const categoryPage = store.listNotes({ query: '', scope: 'notes', categoryId: category.id, limit: 50, sort: 'priority' }).items.filter((item) => item.kind === 'task').map((item) => item.id)
    const tagPage = store.listNotes({ query: '', scope: 'notes', tags: [tag.name], limit: 50, sort: 'priority' }).items.filter((item) => item.kind === 'task').map((item) => item.id)
    assert.deepEqual(backlog, [second, third, first])
    assert.deepEqual(categoryPage, [second, third, first])
    assert.deepEqual(tagPage, [second, first])
    assert.throws(() => store.reorderBacklog(first, category.id, 'ffffffff-ffff-4fff-8fff-ffffffffffff'), /target to-do/i)
  })
})

test('Backlog pagination keeps a stable priority cursor and places a move after the loaded page', () => {
  withStore((store) => {
    const category = store.createCategory('Work')
    const ids = []
    for (let index = 0; index < 55; index++) {
      const id = store.submitCapture(randomUUID(), 0, `Task ${index}`)
      store.classifyItem(id, 'task', [], category.id)
      ids.push(id)
    }
    const firstPage = store.listBacklog({ categoryId: category.id, limit: 50 })
    const secondPage = store.listBacklog({ categoryId: category.id, cursor: firstPage.nextCursor, limit: 50 })
    assert.equal(firstPage.items.length, 50)
    assert.equal(secondPage.items.length, 5)
    assert.equal(firstPage.total, 55)
    assert.equal(new Set([...firstPage.items, ...secondPage.items].map((item) => item.id)).size, 55)

    store.reorderBacklog(ids[0], category.id, secondPage.items[0].id)
    const reordered = store.listBacklog({ categoryId: category.id, limit: 52 }).items.map((item) => item.id)
    assert.equal(reordered[49], ids[0])
    assert.equal(reordered[50], ids[50])
  })
})

test('task body and tags update atomically', () => {
  withStore((store) => {
    const id = captureTask(store, 'Before', ['old'])
    const current = store.getNote(id)
    store.db.exec("CREATE TRIGGER fail_tag_link BEFORE INSERT ON note_tags BEGIN SELECT RAISE(ABORT, 'forced tag failure'); END")
    assert.throws(() => store.updateItem(id, current.revision, 'After', ['new']), /forced tag failure/)
    assert.equal(store.getNote(id).body, 'Before')
    assert.deepEqual(store.getNote(id).tags, ['old'])
    store.db.exec('DROP TRIGGER fail_tag_link')
    const updated = store.updateItem(id, current.revision, 'After', ['new'])
    assert.equal(updated.body, 'After')
    assert.deepEqual(updated.tags, ['new'])
  })
})

test('all items support multi-type and multi-tag filters', () => {
  withStore((store) => {
    const workId = store.submitCapture(randomUUID(), 0, 'Project note')
    store.classifyItem(workId, 'note', ['Work'])
    const homeId = store.submitCapture(randomUUID(), 0, 'Personal note')
    store.classifyItem(homeId, 'note', ['Home'])
    const taskId = store.submitCapture(randomUUID(), 0, 'Project task')
    store.classifyItem(taskId, 'task', ['Work'])
    const inboxId = store.submitCapture(randomUUID(), 0, 'Unfiled thought')
    assert.deepEqual(store.listTags(), ['Home', 'Work'])
    const base = { query: '', scope: 'notes', sort: 'newest', limit: 50 }
    assert.equal(store.listNotes(base).total, 4)
    assert.deepEqual(store.listNotes({ ...base, kinds: ['note', 'task'], tags: ['work'] }).items.map((item) => item.id), [taskId, workId])
    assert.deepEqual(store.listNotes({ ...base, tags: ['work', 'home'] }).items.map((item) => item.id), [taskId, homeId, workId])
    assert.deepEqual(store.listNotes({ ...base, kinds: ['inbox'] }).items.map((item) => item.id), [inboxId])
    assert.equal(store.listNotes({ ...base, kinds: [], tags: [] }).total, 4)
  })
})

test('event and anchored-task updates roll back together on a database failure', () => {
  withStore((store) => {
    const start = new Date(2026, 8, 28, 10).getTime()
    const end = new Date(2026, 8, 28, 11).getTime()
    const meeting = store.savePlannerEvent({ title: 'Design review', startAt: start, endAt: end, allDay: false })
    const id = captureTask(store, 'Prepare notes')
    store.movePlannerTask(id, '2026-09-28', meeting.id, null)
    store.db.exec("CREATE TRIGGER fail_anchor BEFORE UPDATE OF before_event_id ON notes WHEN NEW.before_event_id IS NULL BEGIN SELECT RAISE(ABORT, 'forced anchor failure'); END")
    assert.throws(() => store.updatePlannerEvent({ id: meeting.id, title: 'Moved review', startAt: new Date(2026, 8, 29, 10).getTime(), endAt: new Date(2026, 8, 29, 11).getTime(), allDay: false }), /forced anchor failure/)
    assert.equal(store.listPlanner('2026-09-28', '2026-09-29').events[0].startAt, start)
    assert.equal(store.db.prepare('SELECT before_event_id FROM notes WHERE id=?').get(id).before_event_id, meeting.id)
  })
})

test('undoing a meeting deletion restores its task anchors and order', () => {
  withStore((store) => {
    const day = '2026-09-28'
    const meeting = store.savePlannerEvent({ title: 'Review', startAt: new Date(2026, 8, 28, 10).getTime(), endAt: new Date(2026, 8, 28, 11).getTime(), allDay: false })
    const first = captureTask(store, 'First')
    const second = captureTask(store, 'Second')
    store.movePlannerTask(first, day, meeting.id, null)
    store.movePlannerTask(second, day, meeting.id, null)
    const snapshot = store.deletePlannerEvent(meeting.id)
    assert.equal(store.listPlanner(day, day).events.length, 0)
    assert.equal(store.getNote(first).kind, 'task')
    assert.equal(store.db.prepare('SELECT before_event_id FROM notes WHERE id=?').get(first).before_event_id, null)
    store.undoDeletePlannerEvent(snapshot)
    assert.equal(store.listPlanner(day, day).events[0].id, meeting.id)
    const restored = store.listPlanner(day, day).tasks.filter((task) => task.beforeEventId === meeting.id)
    assert.deepEqual(restored.map((task) => task.id), [first, second])
    assert.throws(() => store.undoDeletePlannerEvent(snapshot), /already been restored/i)
  })
})

test('planner includes weekend and spanning meetings in each overlapping local day', () => {
  withStore((store) => {
    const saturday = localDateBounds('2026-09-26')
    const sunday = localDateBounds('2026-09-27')
    const meeting = store.savePlannerEvent({ title: 'Weekend handoff', startAt: saturday.start + 23 * 60 * 60_000, endAt: sunday.start + 60 * 60_000, allDay: false })
    assert.equal(eventOverlapsLocalDay(meeting.startAt, meeting.endAt, '2026-09-26'), true)
    assert.equal(eventOverlapsLocalDay(meeting.startAt, meeting.endAt, '2026-09-27'), true)
    assert.equal(store.listPlanner('2026-09-26', '2026-09-26').events[0].id, meeting.id)
    assert.equal(store.listPlanner('2026-09-27', '2026-09-27').events[0].id, meeting.id)
  })
})

test('drop resolution handles unscheduled targets and inserts before or after a task', () => {
  const tasks = [
    { id: 'source', plannedDate: '2026-09-28', beforeEventId: null, position: 0 },
    { id: 'unscheduled', plannedDate: null, beforeEventId: null, position: 0 },
    { id: 'later', plannedDate: '2026-09-29', beforeEventId: null, position: 1 },
    { id: 'target', plannedDate: '2026-09-29', beforeEventId: null, position: 0 },
  ]
  assert.deepEqual(resolvePlannerDrop('source', 'unscheduled', 0, tasks), { id: 'source', plannedDate: null, beforeEventId: null, beforeId: 'unscheduled' })
  assert.deepEqual(resolvePlannerDrop('source', 'target', 10, tasks), { id: 'source', plannedDate: '2026-09-29', beforeEventId: null, beforeId: 'later' })
  assert.deepEqual(resolvePlannerDrop('source', 'target', -10, tasks), { id: 'source', plannedDate: '2026-09-29', beforeEventId: null, beforeId: 'target' })
})

test('date bounds follow local daylight-saving day lengths', () => {
  const spring = localDateBounds('2026-03-29')
  const autumn = localDateBounds('2026-10-25')
  assert.ok([23, 24].includes((spring.end - spring.start) / 3_600_000))
  assert.ok([24, 25].includes((autumn.end - autumn.start) / 3_600_000))
})

test('version 2 database migrates with historical meeting labels intact', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-v2-'))
  const file = path.join(folder, 'legacy.sqlite')
  const legacy = new Database(file)
  legacy.exec(`
    CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
    INSERT INTO schema_migrations VALUES(1,1),(2,2);
    CREATE TABLE notes(id TEXT PRIMARY KEY,capture_request_id TEXT UNIQUE,body TEXT NOT NULL,meeting_id TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,deleted_at INTEGER,revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE meetings(id TEXT PRIMARY KEY,title TEXT NOT NULL,started_at INTEGER NOT NULL,ended_at INTEGER,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE drafts(key TEXT PRIMARY KEY,body TEXT NOT NULL,meeting_id TEXT,generation INTEGER NOT NULL DEFAULT 0,revision INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
    CREATE TABLE app_state(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE INDEX notes_created ON notes(deleted_at,created_at DESC,id DESC);
    CREATE INDEX notes_meeting_created ON notes(meeting_id,created_at DESC,id DESC);
    CREATE VIRTUAL TABLE note_search USING fts5(note_id UNINDEXED,body,meeting_title,tokenize='unicode61 remove_diacritics 2');
    INSERT INTO drafts(key,body,updated_at) VALUES('capture','',1);
  `)
  const meetingId = randomUUID(), noteId = randomUUID()
  legacy.prepare('INSERT INTO meetings VALUES(?,?,?,?,?,?)').run(meetingId, 'Historical sync', 10, 20, 1, 2)
  legacy.prepare('INSERT INTO notes(id,body,meeting_id,created_at,updated_at) VALUES(?,?,?,?,?)').run(noteId, 'Old note', meetingId, 10, 10)
  legacy.close()
  let store
  try {
    store = new Store(file)
    assert.equal(store.legacyMeetingLabels()[0].title, 'Historical sync')
    assert.equal(store.getNote(noteId).meetingTitle, 'Historical sync')
    assert.equal(store.checkIntegrity(), undefined)
  } finally { store?.close(); fs.rmSync(folder, { recursive: true, force: true }) }
})


test('weekly meetings repeat through an inclusive end date and each occurrence can be removed independently', () => {
  withStore((store) => {
    const first = store.savePlannerEvent({ title: 'Weekly review', startAt: new Date(2026, 9, 5, 9).getTime(), endAt: new Date(2026, 9, 5, 10).getTime(), allDay: false, recurrence: { frequency: 'weekly', until: '2026-10-19' } })
    const occurrences = store.listPlanner('2026-10-01', '2026-10-31').events
    assert.equal(occurrences.length, 3)
    assert.equal(occurrences[0].id, first.id)
    assert.equal(new Set(occurrences.map((event) => event.id)).size, 3)
    assert.deepEqual(occurrences.map((event) => new Date(event.startAt).getDate()), [5, 12, 19])
    const deleted = store.deletePlannerEvent(occurrences[1].id)
    assert.equal(store.listPlanner('2026-10-01', '2026-10-31').events.length, 2)
    store.undoDeletePlannerEvent(deleted)
    assert.equal(store.listPlanner('2026-10-01', '2026-10-31').events.length, 3)
  })
})

test('monthly repeats skip missing dates and invalid recurrence rolls back without saving any meeting', () => {
  withStore((store) => {
    const input = { title: 'Month end', startAt: new Date(2026, 0, 31, 9).getTime(), endAt: new Date(2026, 0, 31, 10).getTime(), allDay: false }
    store.savePlannerEvent({ ...input, recurrence: { frequency: 'monthly', until: '2026-04-30' } })
    const occurrences = store.listPlanner('2026-01-01', '2026-04-30').events
    assert.deepEqual(occurrences.map((event) => [new Date(event.startAt).getMonth(), new Date(event.startAt).getDate()]), [[0, 31], [2, 31]])
    assert.throws(() => store.savePlannerEvent({ ...input, recurrence: { frequency: 'daily', until: '2026-02-30' } }), /repeat end date/)
    assert.throws(() => store.savePlannerEvent({ ...input, recurrence: { frequency: 'daily', until: '2028-01-31' } }), /366 meetings/)
    assert.equal(store.db.prepare('SELECT count(*) AS count FROM planner_events').get().count, 2)
  })
})

test('recurring all-day and timed meetings preserve local calendar times across daylight saving changes', () => {
  const previousTimezone = process.env.TZ
  process.env.TZ = 'Europe/Berlin'
  try {
    withStore((store) => {
      store.savePlannerEvent({ title: 'Daily review', startAt: new Date(2026, 9, 24, 9).getTime(), endAt: new Date(2026, 9, 24, 10).getTime(), allDay: false, recurrence: { frequency: 'daily', until: '2026-10-26' } })
      store.savePlannerEvent({ title: 'All day', startAt: new Date(2026, 9, 24).getTime(), endAt: new Date(2026, 9, 25).getTime(), allDay: true, recurrence: { frequency: 'daily', until: '2026-10-26' } })
      const events = store.listPlanner('2026-10-24', '2026-10-26').events
      const timed = events.filter((event) => !event.allDay)
      assert.deepEqual(timed.map((event) => new Date(event.startAt).getHours()), [9, 9, 9])
      assert.deepEqual(timed.map((event) => new Date(event.endAt).getHours()), [10, 10, 10])
      const allDay = events.filter((event) => event.allDay)
      assert.deepEqual(allDay.map((event) => new Date(event.endAt).getHours()), [0, 0, 0])
      assert.equal(allDay[1].endAt - allDay[1].startAt, 25 * 60 * 60 * 1000)
    })
  } finally { if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone }
})


test('item image edits are atomic, retain attachments, and reject conflicts and foreign images', () => withStore(store => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8n+QAAAAASUVORK5CYII='
  const id = captureTask(store, 'Original')
  let note = store.getNote(id)
  const added = { id: randomUUID(), mimeType: 'image/png', dataUrl }
  note = store.updateItem(id, note.revision, 'With screenshot', ['Visual'], undefined, [added])
  assert.equal(note.images.length, 1)
  assert.equal(store.getItemImage(note.images[0].id), dataUrl)
  assert.throws(() => store.updateItem(id, note.revision - 1, 'Stale', [], undefined, []), /changed elsewhere/)
  assert.throws(() => store.updateItem(id, note.revision, 'Invalid', [], undefined, [...note.images, { ...added, dataUrl: 'data:image/png;base64,ZmFrZQ==' }]), /Paste a PNG/)
  assert.equal(store.getNote(id).body, 'With screenshot')
  assert.deepEqual(store.getNote(id).images, note.images)
  const other = captureTask(store, 'Other')
  assert.throws(() => store.updateItem(other, store.getNote(other).revision, 'Foreign', [], undefined, note.images), /no longer available/)
  const retained = store.updateItem(id, note.revision, 'Retained', [], undefined, note.images)
  assert.deepEqual(retained.images, note.images)
  const removed = store.updateItem(id, retained.revision, 'Removed', [], undefined, [])
  assert.deepEqual(removed.images, [])
  assert.throws(() => store.getItemImage(note.images[0].id), /no longer available/)
}))


test('backlog summary groups eligible tasks and counts-only requests preserve filtering', () => {
  withStore(store => {
    const category = store.createCategory('Work')
    const subcategory = store.createSubcategory('Planning', category.id)
    const assigned = captureTask(store, 'Prepare review', ['Waiting'])
    store.setItemCategory(assigned, category.id, subcategory.id)
    captureTask(store, 'Unassigned work')
    const ready = captureTask(store, 'Ready work'); store.setTaskReady(ready)
    const done = captureTask(store, 'Done work'); store.setTaskCompleted(done, true)
    const trashed = captureTask(store, 'Trashed work'); store.trash([trashed])
    const later = captureTask(store, 'Later work')
    store.schedulePlannerTask({ id: later, expectedRevision: store.getNote(later).revision, placement: { kind: 'later' } })
    assert.deepEqual(store.backlogSummary(), {
      [category.id]: { total: 1, subcategoryCounts: { [subcategory.id]: 1 } },
      unassigned: { total: 1, subcategoryCounts: { '': 1 } },
    })
    assert.deepEqual(store.backlogSummary(true), { unassigned: { total: 1, subcategoryCounts: { '': 1 } } })
    const count = store.listBacklog({ categoryId: category.id, tagNames: ['Waiting'], countsOnly: true })
    assert.equal(count.total, 1)
    assert.deepEqual(count.items, [])
    assert.equal(count.nextCursor, null)
    assert.equal(store.listBacklog({ categoryId: category.id, excludedTags: ['Waiting'], countsOnly: true }).total, 0)
    store.setTaskReady(assigned)
    assert.deepEqual(store.backlogSummary(), { unassigned: { total: 1, subcategoryCounts: { '': 1 } } })
  })
})

test('backlog pages share counts until the next database change', () => {
  withStore(store => {
    const first = store.createCategory('First'), second = store.createCategory('Second')
    store.setItemCategory(captureTask(store, 'First work'), first.id)
    store.setItemCategory(captureTask(store, 'Second work'), second.id)
    const prepare = store.db.prepare.bind(store.db)
    let reads = 0
    store.db.prepare = (...args) => { reads++; return prepare(...args) }
    try {
      store.backlogSummary()
      store.listBacklog({ categoryId: first.id })
      store.listBacklog({ categoryId: second.id })
      store.listBacklog({ categoryId: first.id, countsOnly: true })
      assert.equal(reads, 3, 'one shared count query and two task pages')
    } finally { store.db.prepare = prepare }
    captureTask(store, 'New unassigned work')
    assert.equal(store.backlogSummary().unassigned.total, 1)
  })
})

 test('series deletion removes only linked occurrences and undo restores their membership', () => {
  withStore(store => {
    const input = { title: 'Review', startAt: new Date(2026, 9, 5, 9).getTime(), endAt: new Date(2026, 9, 5, 10).getTime(), allDay: false }
    const first = store.savePlannerEvent({ ...input, recurrence: { frequency: 'weekly', until: '2026-10-19' } })
    const unrelated = store.savePlannerEvent(input)
    const members = store.db.prepare('SELECT id FROM planner_events WHERE series_id=? ORDER BY start_at').all(first.seriesId)
    assert.equal(members.length, 3)
    const one = store.deletePlannerEvent(members[1].id)
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM planner_events WHERE series_id=?').get(first.seriesId).n, 2)
    store.undoDeletePlannerEvent(one)
    const all = store.deletePlannerEvent(members[1].id, 'series')
    assert.equal(all.additional.length, 2)
    assert.deepEqual(store.db.prepare('SELECT id FROM planner_events').all(), [{ id: unrelated.id }])
    store.undoDeletePlannerEvent(all)
    assert.equal(store.db.prepare('SELECT count(*) AS n FROM planner_events WHERE series_id=?').get(first.seriesId).n, 3)
    assert.throws(() => store.undoDeletePlannerEvent(all), /already been restored/)
  })
})
