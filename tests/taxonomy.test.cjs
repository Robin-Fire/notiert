const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test, after } = require('node:test')
const { buildSync } = require('esbuild')
const Database = require('better-sqlite3')
const legacyTaxonomy = require('./helpers/taxonomy-fixture.cjs')
const generated = path.join(__dirname, '.generated', 'taxonomy')
fs.mkdirSync(generated, { recursive: true })
buildSync({ entryPoints: [path.join(__dirname, '../src/main/storage/database.ts')], outfile: path.join(generated, 'database.cjs'), bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
const { Store } = require(path.join(generated, 'database.cjs'))
after(() => fs.rmSync(generated, { recursive: true, force: true }))
function fixture() {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'captured-taxonomy-'))
  const file = path.join(folder, 'notes.sqlite')
  return { folder, file, store: new Store(file), close() { this.store?.close(); this.store = null; fs.rmSync(folder, { recursive: true, force: true }) } }
}
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8n+QAAAAASUVORK5CYII='
test('included tags combine with OR and excluded tags win before counts and pagination', () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Work')
    const make = (body, tags) => f.store.createPlannerTask({ body, categoryId: category.id, tags, placement: { kind: 'backlog' } })
    const first = make('First', ['Design'])
    const second = make('Second', ['Work'])
    make('Hidden overlap', ['Design', 'Waiting'])
    const untagged = make('Untagged', [])
    make('Hidden', ['Waiting'])
    const filter = { categoryId: category.id, tagNames: ['design', 'work'], excludedTags: ['waiting'], limit: 1 }
    const page = f.store.listBacklog(filter)
    assert.equal(page.total, 2)
    assert.equal(page.items[0].id, first.id)
    const next = f.store.listBacklog({ ...filter, cursor: page.nextCursor })
    assert.equal(next.items[0].id, second.id)
    assert.equal(next.nextCursor, null)
    assert.deepEqual(f.store.listBacklog({ categoryId: category.id, excludedTags: ['Waiting'] }).items.map(item => item.id), [first.id, second.id, untagged.id])
    const notes = f.store.listNotes({ query: '', scope: 'notes', sort: 'oldest', categoryId: category.id, tags: ['Design', 'Work'], excludedTags: ['Waiting'], includeCompleted: false, limit: 1 })
    assert.equal(notes.total, 2)
    const noteNext = f.store.listNotes({ query: '', scope: 'notes', sort: 'oldest', categoryId: category.id, tags: ['Design', 'Work'], excludedTags: ['Waiting'], includeCompleted: false, limit: 1, cursor: notes.nextCursor })
    assert.equal(noteNext.items.length, 1)
    assert.notEqual(noteNext.items[0].id, notes.items[0].id)
    assert.equal(f.store.listNotes({ query: '', scope: 'notes', excludedTags: ['Waiting'], includeCompleted: false, limit: 50 }).total, 3)
  } finally { f.close() }
})
function create(store, body, categoryId, tags, kind = 'note') {
  const id = store.submitCapture(randomUUID(), store.getCaptureDraft().generation, body, categoryId)
  if (kind !== 'inbox') store.classifyItem(id, kind, tags)
  else store.updateItem(id, store.getNote(id).revision, body, tags)
  return id
}
test('v11 migration preserves all data and applies only unambiguous matching subcategories', async () => {
  const f = fixture()
  try {
    const work = f.store.createCategory('Work'), home = f.store.createCategory('Home')
    const alpha = f.store.createTag('Alpha'), beta = f.store.createTag('Beta'), foreign = f.store.createTag('Home label'), independent = f.store.createTag('Waiting')
    f.store.updateTag(alpha.id, null, '#123456')
    f.store.addDraftImage(0, png)
    const one = create(f.store, 'Single matching label', work.id, ['Alpha', 'Waiting'], 'task')
    const multiple = create(f.store, 'Multiple matching labels', work.id, ['Alpha', 'Beta'])
    const mismatch = create(f.store, 'Matching and foreign', work.id, ['Alpha', 'Home label'])
    const foreignOnly = create(f.store, 'Foreign only', work.id, ['Home label'])
    const unassigned = create(f.store, 'Unassigned legacy', null, ['Alpha'])
    const empty = create(f.store, 'No labels', work.id, [])
    const inbox = create(f.store, 'Inbox', work.id, ['Beta'], 'inbox')
    const completed = create(f.store, 'Done', work.id, ['Alpha'], 'task')
    f.store.setTaskCompleted(completed, true)
    const trashed = create(f.store, 'Trash', work.id, ['Beta'])
    f.store.trash([trashed])
    f.store.schedulePlannerTask({ id: one, expectedRevision: f.store.getNote(one).revision, placement: { kind: 'timed', startAt: 1800000000000, endAt: 1800001800000 } })
    f.store.updateDraft('Unfinished capture', f.store.getCaptureDraft().generation, 10, work.id)
    const ids = [one, multiple, mismatch, foreignOnly, unassigned, empty, inbox, completed, trashed]
    const snapshot = ids.map(id => f.store.getNote(id))
    const imageId = snapshot[0].images[0].id
    const priority = f.store.db.prepare('SELECT id,backlog_position,task_position FROM notes ORDER BY id').all()
    const links = f.store.db.prepare('SELECT * FROM note_tags ORDER BY note_id,tag_id').all()
    legacyTaxonomy(f.store, [[alpha.id,work.id],[beta.id,work.id],[foreign.id,home.id]])
    f.store.close(); f.store = new Store(f.file)
    const taxonomy = f.store.taxonomy()
    assert.equal(taxonomy.subcategories.length, 3)
    assert.ok(taxonomy.tags.every(tag => tag.categoryId === null))
    const migratedAlpha = taxonomy.subcategories.find(sub => sub.name === 'Alpha')
    const migratedBeta = taxonomy.subcategories.find(sub => sub.name === 'Beta')
    assert.equal(migratedAlpha.color, '#123456')
    assert.equal(f.store.getNote(one).subcategoryId, migratedAlpha.id)
    assert.equal(f.store.getNote(mismatch).subcategoryId, migratedAlpha.id)
    assert.equal(f.store.getNote(inbox).subcategoryId, migratedBeta.id)
    assert.equal(f.store.getNote(completed).subcategoryId, migratedAlpha.id)
    assert.equal(f.store.getNote(trashed).subcategoryId, migratedBeta.id)
    for (const id of [multiple,foreignOnly,unassigned,empty]) assert.equal(f.store.getNote(id).subcategoryId,null)
    for (const before of snapshot) {
      const after = f.store.getNote(before.id)
      assert.deepEqual({ ...after, subcategoryId: null, intention: undefined }, { ...before, subcategoryId: null, intention: undefined })
    }
    assert.deepEqual(f.store.db.prepare('SELECT * FROM note_tags ORDER BY note_id,tag_id').all(), links)
    assert.deepEqual(f.store.db.prepare('SELECT id,backlog_position,task_position FROM notes ORDER BY id').all(), priority)
    assert.equal(f.store.getItemImage(imageId), png)
    assert.equal(f.store.getCaptureDraft().body, 'Unfinished capture')
    assert.equal(f.store.getCaptureDraft().subcategoryId, null)
    assert.deepEqual(new Set(f.store.migrationReview().map(row=>row.noteId)),new Set([multiple,mismatch,foreignOnly,unassigned]))
    assert.equal(f.store.migrationStatus().upgraded,true)
    f.store.acknowledgeMigration();assert.equal(f.store.migrationStatus().acknowledged,true)
    const reports=f.store.migrationReview()
    f.store.close();f.store=new Store(f.file)
    assert.deepEqual(f.store.taxonomy(),taxonomy)
    assert.deepEqual(f.store.migrationReview(),reports)
    assert.equal(f.store.migrationStatus().acknowledged,true)
    const backup = path.join(f.folder,'new-backup.sqlite')
    await f.store.backupTo(backup);f.store.checkIntegrity(backup)
    const pre = path.join(f.folder,'backups',fs.readdirSync(path.join(f.folder,'backups')).find(name=>name.startsWith('pre-migration-')))
    f.store.checkIntegrity(pre)
    const restore = path.join(f.folder,'restored.sqlite');fs.copyFileSync(pre,restore)
    const restored=new Store(restore)
    try {assert.deepEqual(new Set(restored.getNote(one).tags),new Set(['Alpha','Waiting']));assert.equal(restored.getItemImage(imageId),png)}finally{restored.close()}
    assert.ok(taxonomy.tags.some(tag=>tag.id===independent.id))
  } finally { f.close() }
})

test('migration failure rolls back schema, item assignments and tag associations', () => {
  const f=fixture()
  try {
    const category=f.store.createCategory('Work'),tag=f.store.createTag('Project')
    const id=create(f.store,'Original',category.id,['Project'])
    legacyTaxonomy(f.store,[[tag.id,category.id]])
    f.store.db.exec("CREATE TRIGGER fail_assignment BEFORE UPDATE ON notes BEGIN SELECT RAISE(ABORT,'Injected failure'); END;")
    f.store.close();f.store=null
    assert.throws(()=>new Store(f.file),/Injected failure/)
    const db=new Database(f.file)
    assert.equal(db.prepare('SELECT max(version) AS version FROM schema_migrations').get().version,11)
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name='subcategories'").get(),undefined)
    assert.equal(db.prepare('SELECT category_id FROM item_tags WHERE id=?').get(tag.id).category_id,category.id)
    assert.equal(db.prepare('SELECT count(*) AS count FROM note_tags WHERE note_id=?').get(id).count,1)
    db.exec('DROP TRIGGER fail_assignment');db.close()
    f.store=new Store(f.file);assert.ok(f.store.getNote(id).subcategoryId)
  }finally{f.close()}
})

test('one subcategory is category-scoped while independent tags survive moves and deletion', () => {
  const f=fixture()
  try {
    const a=f.store.createCategory('A'),b=f.store.createCategory('B')
    const sa=f.store.createSubcategory('Ideas',a.id),sb=f.store.createSubcategory('Ideas',b.id)
    assert.throws(()=>f.store.createSubcategory('ideas',a.id),/already exists/)
    const id=create(f.store,'Task',a.id,['Waiting','Follow-up'],'task')
    let item=f.store.getNote(id)
    item=f.store.updateItem(id,item.revision,item.body,item.tags,a.id,undefined,sa.id)
    const priority=f.store.db.prepare('SELECT backlog_position FROM notes WHERE id=?').get(id).backlog_position
    assert.throws(()=>f.store.updateItem(id,item.revision,'Wrong',[],a.id,undefined,sb.id),/belonging/)
    assert.deepEqual(f.store.getNote(id),item)
    assert.throws(()=>f.store.db.prepare('UPDATE notes SET subcategory_id=? WHERE id=?').run(sb.id,id),/belong/)
    assert.throws(()=>f.store.db.prepare('UPDATE subcategories SET category_id=? WHERE id=?').run(b.id,sa.id),/parent/)
    f.store.setItemCategory(id,b.id)
    item=f.store.getNote(id);assert.equal(item.subcategoryId,null);assert.deepEqual(new Set(item.tags),new Set(['Waiting','Follow-up']))
    f.store.setItemCategory(id,b.id,sb.id);assert.equal(f.store.getNote(id).subcategoryId,sb.id)
    f.store.deleteSubcategory(sb.id);assert.equal(f.store.getNote(id).subcategoryId,null);assert.equal(f.store.getNote(id).categoryId,b.id)
    f.store.deleteCategory(b.id);assert.equal(f.store.getNote(id).categoryId,null);assert.deepEqual(new Set(f.store.getNote(id).tags),new Set(['Waiting','Follow-up']))
    assert.equal(typeof priority,'number')
    const tag=f.store.taxonomy().tags.find(tag=>tag.name==='Waiting')
    f.store.updateTag(tag.id,null,'#123456','Blocked');assert.ok(f.store.getNote(id).tags.includes('Blocked'))
  }finally{f.close()}
})

test('subcategory filters, independent tag filters, priority pagination and taxonomy search combine correctly', () => {
  const f=fixture()
  try {
    const category=f.store.createCategory('Work'),sub=f.store.createSubcategory('Project Alpha',category.id)
    const a=create(f.store,'First',category.id,['Waiting'],'task'),b=create(f.store,'Second',category.id,[],'task'),c=create(f.store,'Third',category.id,['Waiting'],'task')
    for(const id of [a,b]){const item=f.store.getNote(id);f.store.updateItem(id,item.revision,item.body,item.tags,undefined,undefined,sub.id)}
    assert.deepEqual(f.store.listBacklog({categoryId:category.id,subcategoryIds:[sub.id],includeNoSubcategory:false,tagNames:['Waiting']}).items.map(item=>item.id),[a])
    assert.deepEqual(f.store.listBacklog({categoryId:category.id,subcategoryIds:[],includeNoSubcategory:true}).items.map(item=>item.id),[c])
    assert.deepEqual(f.store.listBacklog({categoryId:category.id,includeUntagged:true}).items.map(item=>item.id),[b])
    const first=f.store.listBacklog({categoryId:category.id,subcategoryIds:[sub.id],limit:1})
    const second=f.store.listBacklog({categoryId:category.id,subcategoryIds:[sub.id],cursor:first.nextCursor,limit:1})
    assert.deepEqual([...first.items,...second.items].map(item=>item.id),[a,b])
    const filter={scope:'notes',sort:'newest',query:'Project Alpha',limit:50}
    assert.equal(f.store.listNotes(filter).total,2)
    assert.equal(f.store.listBacklog({categoryId:category.id,query:'Project Alpha'}).total,2)
    assert.equal(f.store.listNotes({...filter,query:'Waiting'}).total,2)
    assert.equal(f.store.taskExportMetadata([a]).get(a).subcategoryName,'Project Alpha')
  }finally{f.close()}
})

test('capture subcategory persists, classification preserves it, and explicit clear works', () => {
  const f=fixture()
  try {
    const category=f.store.createCategory('Work'),sub=f.store.createSubcategory('Project',category.id)
    f.store.updateDraft('Draft',0,1,category.id,sub.id)
    f.store.close();f.store=new Store(f.file)
    assert.equal(f.store.getCaptureDraft().subcategoryId,sub.id)
    const id=f.store.submitCapture(randomUUID(),0,'Draft',category.id,sub.id)
    assert.equal(f.store.getNote(id).subcategoryId,sub.id)
    f.store.classifyItem(id,'task',['Waiting']);assert.equal(f.store.getNote(id).subcategoryId,sub.id)
    f.store.setItemCategory(id,category.id,null);assert.equal(f.store.getNote(id).subcategoryId,null)
    f.store.updateDraft('Another',1,1,category.id,sub.id)
    f.store.deleteCategory(category.id);assert.equal(f.store.getCaptureDraft().categoryId,null);assert.equal(f.store.getCaptureDraft().subcategoryId,null)
  }finally{f.close()}
})


test('capture context preserves independent tags and never replaces a nonempty draft', () => {
  const f=fixture()
  try {
    const category=f.store.createCategory('Work'),sub=f.store.createSubcategory('Project',category.id)
    const context=f.store.prepareCaptureContext(category.id,sub.id,['waiting'])
    assert.equal(context.subcategoryId,sub.id);assert.deepEqual(context.tags,['waiting'])
    f.store.updateDraft('Draft',0,context.revision+1,category.id)
    assert.equal(f.store.getCaptureDraft().subcategoryId,sub.id)
    assert.deepEqual(f.store.getCaptureDraft().tags,['waiting'])
    assert.equal(f.store.prepareCaptureContext(null,null,['other']),null)
    f.store.close();f.store=new Store(f.file)
    const id=f.store.submitCapture(randomUUID(),0,'Draft',category.id)
    assert.equal(f.store.getNote(id).subcategoryId,sub.id);assert.deepEqual(f.store.getNote(id).tags,['waiting'])
    assert.deepEqual(f.store.getCaptureDraft().tags,[])
    f.store.prepareCaptureContext(null,null,['global']);f.store.addDraftImage(1,png)
    assert.equal(f.store.prepareCaptureContext(category.id,sub.id),null)
  }finally{f.close()}
})


test('backlog subcategory counts cover all pages and stay separate from Later and filters', () => {
  const f=fixture()
  try {
    const category=f.store.createCategory('Work'), empty=f.store.createCategory('Empty')
    const sub=f.store.createSubcategory('Project',category.id), unused=f.store.createSubcategory('Unused',category.id)
    const a=create(f.store,'First',category.id,[],'task'), b=create(f.store,'Second',category.id,[],'task')
    const later=create(f.store,'Later',category.id,[],'task')
    f.store.setItemCategory(a,category.id,sub.id)
    f.store.setItemCategory(later,category.id,sub.id)
    f.store.schedulePlannerTask({id:later,expectedRevision:f.store.getNote(later).revision,placement:{kind:'later'}})
    const page=f.store.listBacklog({categoryId:category.id,limit:1})
    assert.equal(page.items.length,1)
    assert.deepEqual(page.subcategoryCounts,{[sub.id]:1,'':1})
    assert.equal(page.subcategoryCounts[unused.id],undefined)
    assert.deepEqual(f.store.listBacklog({categoryId:category.id,query:'no match',subcategoryIds:[],includeNoSubcategory:false}).subcategoryCounts,page.subcategoryCounts)
    assert.deepEqual(f.store.listBacklog({categoryId:category.id,later:true}).subcategoryCounts,{[sub.id]:1})
    assert.deepEqual(f.store.listBacklog({categoryId:empty.id}).subcategoryCounts,{})
    f.store.setTaskCompleted(b,true)
    assert.deepEqual(f.store.listBacklog({categoryId:category.id}).subcategoryCounts,{[sub.id]:1})
  } finally { f.close() }
})

test('category colors persist through rename, reopen, and backups', async () => {
  const f = fixture()
  try {
    const category = f.store.createCategory('Color category')
    f.store.updateCategory(category.id, category.name, '#ef4444')
    f.store.updateCategory(category.id, 'Renamed category')
    assert.throws(() => f.store.updateCategory(category.id, 'Renamed category', 'invalid'))
    f.store.close(); f.store = new Store(f.file)
    assert.equal(f.store.taxonomy().categories.find(item => item.id === category.id).color, '#ef4444')
    const backup = path.join(f.folder, 'colors.sqlite')
    await f.store.backupTo(backup)
    f.store.checkIntegrity(backup)
    f.store.updateCategory(category.id, 'Renamed category', '#3b82f6')
    f.store.replaceWith(backup)
    assert.equal(f.store.taxonomy().categories.find(item => item.id === category.id).color, '#ef4444')
  } finally { f.close() }
})
