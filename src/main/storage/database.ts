import { migrateDatabase } from './migrations'
import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AppError } from '../../shared/errors'
import { meetingOccurrences } from '../../shared/meetingRecurrence'
import type { CaptureImage, Category, DeletedPlannerEvent, ImageRef, ItemRecord, ItemFilter, ItemPage, PlannerEvent, PlannerEventInput, PlannerTask, PlannerBacklogSummary, Subcategory, MigrationReview, TagRecord } from '../../shared/contracts'
import { eventOverlapsLocalDay, localDateBounds } from '../../shared/plannerDates'
import { PlannerTaskCreateSchema, PlannerTaskScheduleSchema, PlannerEventTimingSchema, type PlannerTaskCreate, type PlannerTaskSchedule, type PlannerEventTiming } from '../../shared/contracts'
import { placementFields, validLocalDate } from '../../shared/calendarSchedule'
import { horizons, horizonOf, intentionFor, validIntention, type TaskIntention } from '../../shared/taskHorizons'
import { addLocalDays, fromLocalISODate, mondayISO, toLocalISODate } from '../../shared/plannerDates'
import { TasksQuerySchema, TaskWorkspaceMoveSchema, TaskWorkspaceUndoSchema, type TasksQuery, type TasksPage, type TaskWorkspaceMove, type TaskWorkspaceUndo, type TaskWorkspaceItem } from '../../shared/contracts'
import { ItemUpdateSchema, TaskCompletionSchema, TaskCompletionUndoSchema, type ItemUpdate, type TaskCompletionUndo } from '../../shared/contracts'

function decodeImage(dataUrl: string) {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
    if (!match || dataUrl.length > 7_000_000) throw new AppError('INVALID_IMAGE', 'Paste a PNG, JPEG, WebP, or GIF image under 5 MB.')
    const mimeType = match[1] as ImageRef['mimeType']
    const data = Buffer.from(match[2]!, 'base64')
    const valid = mimeType === 'image/png' ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : mimeType === 'image/jpeg' ? data[0] === 255 && data[1] === 216 && data[2] === 255
      : mimeType === 'image/webp' ? data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP'
      : ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6))
    if (!valid || data.length === 0 || data.length > 5_000_000) throw new AppError('INVALID_IMAGE', 'Paste a PNG, JPEG, WebP, or GIF image under 5 MB.')
    return { mimeType, data }
}

type ItemRow = { id: string; body: string; meeting_id: string | null; created_at: number; updated_at: number; deleted_at: number | null; revision: number; meeting_title: string | null; kind: 'inbox' | 'note' | 'task'; processed_at: number | null; completed_at: number | null; tag_names: string | null; image_refs: string | null; task_status: 'open' | 'done' | null; planned_date: string | null; task_position: number; backlog_position: number; before_event_id: string | null; project_id: string | null; subcategory_id: string | null; task_ready: number; is_later: number; intention_json?: string | null }
type PlannerEventRow = { id: string; title: string; start_at: number; end_at: number; all_day: number; series_id: string | null }
const ITEM_PROJECTION = "n.*,(SELECT json_object('kind',i.kind,'targetDate',i.target_date,'position',i.position) FROM task_intentions i WHERE i.note_id=n.id) AS intention_json,m.title AS meeting_title,(SELECT group_concat(t.name,char(31)) FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id) AS tag_names,(SELECT group_concat(ref,char(31)) FROM (SELECT i.id||':'||i.mime_type AS ref FROM item_images i WHERE i.note_id=n.id ORDER BY i.position)) AS image_refs"
const ITEM_FROM = 'FROM notes n LEFT JOIN legacy_meeting_sessions m ON m.id=n.meeting_id'
const itemFrom = (row: ItemRow): ItemRecord & { meetingTitle: string | null } => ({ id: row.id, body: row.body, meetingId: row.meeting_id, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at, revision: row.revision, meetingTitle: row.meeting_title, kind: row.kind, intention: row.intention_json ? JSON.parse(row.intention_json) : undefined, processedAt: row.processed_at, completedAt: row.completed_at, later: Boolean(row.is_later), categoryId: row.project_id, subcategoryId: row.subcategory_id, tags: row.tag_names ? row.tag_names.split('\x1f') : [], images: row.image_refs ? row.image_refs.split('\x1f').map((value) => { const [id, mimeType] = value.split(':'); return { id: id!, mimeType: mimeType as ImageRef['mimeType'] } }) : [] })
const eventFrom = (row: PlannerEventRow): PlannerEvent => ({ id: row.id, title: row.title, startAt: row.start_at, endAt: row.end_at, allDay: Boolean(row.all_day), seriesId: row.series_id })
const taskFrom = (row: ItemRow & { planned_start_at?: number | null; planned_end_at?: number | null }): PlannerTask => ({ ...itemFrom(row), plannedDate: row.planned_date, plannedStartAt: row.planned_start_at ?? null, plannedEndAt: row.planned_end_at ?? null, position: row.task_position, priorityPosition: row.backlog_position, beforeEventId: row.before_event_id, ready: Boolean(row.task_ready), later: Boolean(row.is_later) })
function normalizeTags(tags: string[]) {
  return [...new Map(tags.map((tag) => tag.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).map((tag): [string, string] => [tag.toLowerCase(), tag])).values()].slice(0, 20)
}
const isISODate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year!, month! - 1, day!))
  return date.getUTCFullYear() === year && date.getUTCMonth() === month! - 1 && date.getUTCDate() === day
}
export class Store {
  db: Database.Database
  readonly path: string
  changeSequence = 0
  private backlogSummaryCache = new Map<boolean, { sequence: number; value: PlannerBacklogSummary }>()

  constructor(path: string) {
    this.path = path
    this.db = this.open(path)
    try { this.migrate() } catch (error) { this.db.close(); throw error }
  }

  private open(path: string) {
    const db = new Database(path)
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = FULL')
    db.pragma('foreign_keys = ON')
    db.pragma('busy_timeout = 2000')
    return db
  }

  private migrate() { migrateDatabase(this) }

  workspaceOverview(raw: TasksQuery): Partial<Record<typeof horizons[number], TasksPage>> {
    const input = TasksQuerySchema.parse(raw)
    if (input.query.trim()) return { unplanned: this.listWorkspace({ ...input, horizon: undefined, cursor: undefined }) }
    const sections = input.scope === 'backlog' ? ['unplanned'] as const : horizons
    return this.db.transaction(() => {
      let summary: TasksPage | undefined
      return Object.fromEntries(sections.map(horizon => {
        const page = this.listWorkspace({ ...input, horizon, cursor: undefined }, summary)
        summary ??= page
        return [horizon, page]
      }))
    })()
  }

  listWorkspace(raw: TasksQuery, summary?: TasksPage): TasksPage {
    const input = TasksQuerySchema.parse(raw)
    if (!validLocalDate(input.today)) throw new AppError('INVALID_INPUT', 'Choose a valid local date.')
    if (input.cursor && (input.cursor.sequence !== this.changeSequence || input.cursor.today !== input.today)) throw new AppError('STALE_PAGE', 'Tasks changed. Refresh the board.')
    const bucket = "CASE WHEN n.kind='inbox' THEN 'unplanned' ELSE coalesce(i.kind,'unplanned') END"
    const where = ["n.deleted_at IS NULL", input.completed ? "n.kind='task' AND n.task_status='done'" : input.query.trim() ? "n.kind='task'" : "(n.kind='inbox' OR (n.kind='task' AND n.task_status='open'))"]
    const params: (string | number | null)[] = []
    if (input.scope === 'planned') where.push("n.kind='task' AND coalesce(i.kind,'unplanned')<>'unplanned'")
    if (input.scope === 'backlog') where.push("(n.kind='inbox' OR coalesce(i.kind,'unplanned')='unplanned')")
    if (input.categoryId !== undefined) { where.push('n.project_id IS ?'); params.push(input.categoryId) }
    if (input.subcategoryId) { where.push('n.subcategory_id=?'); params.push(input.subcategoryId) }
    if (input.query) { where.push("(n.body LIKE ? ESCAPE '\\' OR EXISTS(SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name LIKE ? ESCAPE '\\'))"); const pattern = `%${input.query.replace(/[\\%_]/g, '\\$&')}%`; params.push(pattern, pattern) }
    if (input.tags.length) { where.push(`EXISTS(SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${input.tags.map(() => '?').join(',')}))`); params.push(...input.tags) }
    if (input.excludedTags.length) { where.push(`NOT EXISTS(SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${input.excludedTags.map(() => '?').join(',')}))`); params.push(...input.excludedTags) }
    const from = `${ITEM_FROM} LEFT JOIN task_intentions i ON i.note_id=n.id WHERE ${where.join(' AND ')}`
    const counts = summary?.counts ?? Object.fromEntries(horizons.map(h => [h, 0])) as TasksPage['counts']
    if (!summary) for (const row of this.db.prepare(`SELECT ${bucket} AS horizon,count(*) AS total ${from} GROUP BY horizon`).all(...params) as { horizon: keyof typeof counts; total: number }[]) counts[row.horizon] = row.total
    const categoryCounts: Record<string, number> = summary?.categoryCounts ?? {}
    let captureTotal = summary?.captureTotal ?? 0
    if (!summary) for (const row of this.db.prepare(`SELECT n.project_id AS categoryId,n.kind,count(*) AS total ${from} GROUP BY n.project_id,n.kind`).all(...params) as { categoryId: string | null; kind: string; total: number }[]) { if (row.kind === 'inbox') captureTotal += row.total; if (row.kind !== 'inbox' || input.scope === 'backlog') { const key = row.categoryId ?? 'unassigned'; categoryCounts[key] = (categoryCounts[key] ?? 0) + row.total } }
    const pageWhere = [...where], pageParams = [...params]
    if (input.horizon) { pageWhere.push(`(${bucket})=?`); pageParams.push(input.horizon) }
    if (input.cursor) { pageWhere.push('(coalesce(i.position,0)>? OR (coalesce(i.position,0)=? AND n.id>?))'); pageParams.push(input.cursor.position, input.cursor.position, input.cursor.id) }
    const rows = this.db.prepare(`SELECT ${ITEM_PROJECTION},i.kind AS intention_kind,i.target_date AS intention_date,coalesce(i.position,0) AS intention_position ${ITEM_FROM} LEFT JOIN task_intentions i ON i.note_id=n.id WHERE ${pageWhere.join(' AND ')} ORDER BY coalesce(i.position,0),n.id LIMIT ?`).all(...pageParams, input.limit + 1) as (ItemRow & { intention_kind: TaskIntention['kind'] | null; intention_date: string | null; intention_position: number })[]
    const items: TaskWorkspaceItem[] = rows.slice(0, input.limit).map(row => { const intention: TaskIntention = { kind: row.intention_kind ?? 'unplanned', targetDate: row.intention_date, position: row.intention_position }; return { ...taskFrom(row), intention, horizon: row.kind === 'inbox' ? 'unplanned' : horizonOf(intention, input.today) } })
    const last = items.at(-1)
    return { items, counts, categoryCounts, captureTotal, total: input.horizon ? counts[input.horizon] : Object.values(counts).reduce((a, b) => a + b, 0), nextCursor: rows.length > input.limit && last ? { position: last.intention.position, id: last.id, sequence: this.changeSequence, today: input.today } : null }
  }

  moveWorkspaceMany(inputs: TaskWorkspaceMove[]) {
    const sequence = this.changeSequence
    try {
      this.db.transaction(() => {
        if (!inputs.length || inputs.length > 100 || new Set(inputs.map(input => input.id)).size !== inputs.length) throw new AppError('INVALID_INPUT', 'Select up to 100 distinct items.')
        for (const input of inputs) {
          if (this.getItem(input.id)?.revision !== input.expectedRevision) throw new AppError('STALE_REVISION', 'An item changed. Refresh before planning these items.')
        }
        for (const input of inputs) this.moveWorkspace({ ...input, expectedRevision: this.getItem(input.id)!.revision })
      })()
      this.changeSequence = sequence + 1
    } catch (error) { this.changeSequence = sequence; throw error }
  }

  moveWorkspace(raw: TaskWorkspaceMove): TaskWorkspaceUndo {
    const input = TaskWorkspaceMoveSchema.parse(raw)
    if (!validLocalDate(input.today)) throw new AppError('INVALID_INPUT', 'Choose a valid local date.')
    input.intention = { ...intentionFor(horizonOf(input.intention, input.today)), position: input.intention.position }
    const undo = this.db.transaction(() => {
      const item = this.getItem(input.id)
      if (!item || item.deletedAt !== null || !['inbox', 'task'].includes(item.kind) || item.completedAt !== null) throw new AppError('NOT_FOUND', 'This task is no longer available.')
      if (item.revision !== input.expectedRevision) throw new AppError('STALE_REVISION', 'This item changed. Refresh before moving it.')
      const old = this.db.prepare('SELECT kind,target_date AS targetDate,position FROM task_intentions WHERE note_id=?').get(item.id) as TaskIntention | undefined
      const snapshot: TaskWorkspaceUndo = { id: item.id, expectedRevision: 0, kind: item.kind as 'inbox' | 'task', categoryId: item.categoryId, subcategoryId: item.subcategoryId, tags: item.kind === 'inbox' ? normalizeTags(input.tags ?? item.tags) : item.tags, intention: old ?? null }
      if ('priorityPosition' in item && typeof item.priorityPosition === 'number') snapshot.priorityPosition = item.priorityPosition
      if (old) {
        const source = (this.db.prepare("SELECT i.note_id AS id,i.kind,i.target_date AS targetDate,i.position FROM task_intentions i JOIN notes n ON n.id=i.note_id WHERE n.kind='task' AND n.task_status='open' AND n.deleted_at IS NULL ORDER BY i.position,i.note_id").all() as (TaskIntention & { id: string })[]).filter(row => horizonOf(row, input.today) === horizonOf(old, input.today))
        snapshot.beforeId = source[source.findIndex(row => row.id === item.id) + 1]?.id ?? null
        snapshot.today = input.today
      }
      const category = input.categoryId === undefined ? item.categoryId : input.categoryId
      if (category && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(category)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
      if (item.kind === 'inbox') this.classifyItem(item.id, input.classify ?? 'task', input.tags ?? item.tags, category)
      else this.db.prepare('UPDATE notes SET project_id=?,subcategory_id=?,backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?').run(category, category === item.categoryId ? item.subcategoryId : null, category === item.categoryId && 'priorityPosition' in item ? item.priorityPosition : this.nextBacklogPosition(category), Date.now(), item.id)
      {
        const targetHorizon = horizonOf(input.intention, input.today)
        const rows = this.db.prepare("SELECT i.note_id AS id,i.kind,i.target_date AS targetDate,i.position FROM task_intentions i JOIN notes n ON n.id=i.note_id WHERE n.kind='task' AND n.task_status='open' AND n.deleted_at IS NULL AND i.note_id<>? ORDER BY i.position,i.note_id").all(item.id) as (TaskIntention & { id: string })[]
        const destination = rows.filter(row => horizonOf(row, input.today) === targetHorizon)
        let index = destination.length
        if (input.beforeId) { index = destination.findIndex(row => row.id === input.beforeId); if (index < 0) throw new AppError('STALE_TARGET', 'The destination changed. Refresh before moving.') }
        destination.splice(index, 0, { ...input.intention, id: item.id })
        this.db.prepare('INSERT OR REPLACE INTO task_intentions VALUES(?,?,?,?)').run(item.id, input.intention.kind, input.intention.targetDate, index)
        destination.forEach((row, position) => { if (row.id !== item.id && row.position !== position) { this.db.prepare('UPDATE task_intentions SET position=? WHERE note_id=?').run(position, row.id); this.db.prepare('UPDATE notes SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), row.id) } })
      }
      snapshot.expectedRevision = this.getItem(item.id)!.revision
      return snapshot
    })()
    this.changeSequence++
    return undo
  }

  undoWorkspace(raw: TaskWorkspaceUndo) {
    const input = TaskWorkspaceUndoSchema.parse(raw)
    this.db.transaction(() => {
      const item = this.getItem(input.id)
      if (!item || item.deletedAt !== null || item.revision !== input.expectedRevision) throw new AppError('STALE_REVISION', 'This item changed. Undo is no longer available.')
      if (input.categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId)) throw new AppError('CATEGORY_MISSING', 'The original category no longer exists.')
      this.validateSubcategory(input.categoryId, input.subcategoryId)
      this.db.prepare('UPDATE notes SET kind=?,task_status=?,processed_at=?,project_id=?,subcategory_id=?,revision=revision+1,updated_at=? WHERE id=?').run(input.kind, input.kind === 'task' ? 'open' : null, input.kind === 'task' ? item.processedAt : null, input.categoryId, input.subcategoryId, Date.now(), item.id)
      this.replaceItemTags(item.id, input.tags)
      if (input.priorityPosition !== undefined) {
        const collision = this.db.prepare("SELECT 1 FROM notes WHERE id<>? AND kind='task' AND task_status='open' AND deleted_at IS NULL AND project_id IS ? AND backlog_position=?").get(item.id, input.categoryId, input.priorityPosition)
        this.db.prepare('UPDATE notes SET backlog_position=? WHERE id=?').run(collision ? this.nextBacklogPosition(input.categoryId) : input.priorityPosition, item.id)
      }
      if (input.intention) {
        const today = input.today && validLocalDate(input.today) ? input.today : toLocalISODate(new Date())
        const destination = (this.db.prepare("SELECT i.note_id AS id,i.kind,i.target_date AS targetDate,i.position FROM task_intentions i JOIN notes n ON n.id=i.note_id WHERE n.kind='task' AND n.task_status='open' AND n.deleted_at IS NULL AND i.note_id<>? ORDER BY i.position,i.note_id").all(item.id) as (TaskIntention & { id: string })[]).filter(row => horizonOf(row, today) === horizonOf(input.intention!, today))
        const next = input.beforeId ? destination.findIndex(row => row.id === input.beforeId) : -1
        const index = next >= 0 ? next : input.beforeId === null ? destination.length : Math.min(input.intention.position, destination.length)
        destination.splice(index, 0, { ...input.intention, id: item.id })
        this.db.prepare('INSERT OR REPLACE INTO task_intentions VALUES(?,?,?,?)').run(item.id, input.intention.kind, input.intention.targetDate, index)
        destination.forEach((row, position) => { if (row.id !== item.id && row.position !== position) { this.db.prepare('UPDATE task_intentions SET position=? WHERE note_id=?').run(position, row.id); this.db.prepare('UPDATE notes SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), row.id) } })
      }
      else this.db.prepare('DELETE FROM task_intentions WHERE note_id=?').run(item.id)
    })()
    this.changeSequence++
  }

  createWorkspaceTask(body: string, categoryId: string | null, intention: TaskIntention, subcategoryId: string | null = null, tags: string[] = []) {
    this.db.transaction(() => {
      const task = this.createPlannerTask({ body, categoryId, subcategoryId, tags, placement: { kind: 'backlog' } })
      this.moveWorkspace({ id: task.id, expectedRevision: task.revision, intention, today: toLocalISODate(new Date()), beforeId: null })
    })()
  }

  getCaptureDraft() {
    const draft = this.db.prepare("SELECT body,generation,revision,capture_kind AS captureKind,category_id AS categoryId,subcategory_id AS subcategoryId FROM drafts WHERE key='capture'").get() as { body: string; generation: number; revision: number; captureKind: 'inbox' | 'task' | 'note'; categoryId: string | null; subcategoryId: string | null }
    const rows = this.db.prepare('SELECT id,mime_type,data FROM capture_draft_images ORDER BY position').all() as { id: string; mime_type: ImageRef['mimeType']; data: Buffer }[]
    const tagRow=this.db.prepare("SELECT value FROM app_state WHERE key='capture-tags'").get() as {value:string}|undefined
    const tagState=tagRow?JSON.parse(tagRow.value) as {generation:number;tags:string[]}:null
    return { ...draft, captureKind: 'task' as const, tags:tagState?.generation===draft.generation?tagState.tags:[], images: rows.map((row): CaptureImage => ({ id: row.id, mimeType: row.mime_type, dataUrl: `data:${row.mime_type};base64,${row.data.toString('base64')}` })) }
  }

  updateDraft(body: string, generation: number, revision: number, categoryId: string | null = null, requestedSubcategoryId?: string | null, tags?:string[], captureKind?: 'inbox' | 'task' | 'note') {
    const current = this.db.prepare("SELECT generation,revision,category_id AS categoryId,subcategory_id AS subcategoryId FROM drafts WHERE key='capture'").get() as { generation: number; revision: number; categoryId:string|null;subcategoryId:string|null }
    if (generation < current.generation || (generation === current.generation && revision < current.revision)) return current.revision
    if (categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
    const subcategoryId=requestedSubcategoryId===undefined?(current.categoryId===categoryId?current.subcategoryId:null):requestedSubcategoryId
    this.validateSubcategory(categoryId,subcategoryId)
    const nextRevision = generation === current.generation ? revision : 0
    this.db.transaction(()=> {
      this.db.prepare("UPDATE drafts SET body=?,category_id=?,subcategory_id=?,generation=?,revision=?,updated_at=? WHERE key='capture'").run(body,categoryId,subcategoryId,generation,nextRevision,Date.now())
      if(captureKind!==undefined)this.db.prepare("UPDATE drafts SET capture_kind=? WHERE key='capture'").run(captureKind)
      if(tags!==undefined)this.db.prepare("INSERT OR REPLACE INTO app_state VALUES('capture-tags',?)").run(JSON.stringify({generation,tags:normalizeTags(tags)}))
    })()
    return nextRevision
  }

  prepareCaptureContext(categoryId:string|null,subcategoryId:string|null,tags:string[]=[]) {
    const draft=this.getCaptureDraft()
    if(draft.body.trim()||draft.images.length)return null
    this.updateDraft('',draft.generation,draft.revision+1,categoryId,subcategoryId,tags)
    return this.getCaptureDraft()
  }

  addDraftImage(generation: number, dataUrl: string): CaptureImage {
    const { mimeType, data } = decodeImage(dataUrl)
    const current = this.db.prepare("SELECT generation FROM drafts WHERE key='capture'").get() as { generation: number }
    if (generation !== current.generation) throw new AppError('STALE_DRAFT', 'The capture changed. Open it again before pasting.')
    const stats = this.db.prepare('SELECT count(*) AS count,coalesce(sum(length(data)),0) AS bytes FROM capture_draft_images').get() as { count: number; bytes: number }
    if (stats.count >= 5 || stats.bytes + data.length > 20_000_000) throw new AppError('TOO_MANY_IMAGES', 'A capture can hold up to five images and 20 MB total.')
    const id = randomUUID()
    this.db.prepare('INSERT INTO capture_draft_images(id,position,mime_type,data) VALUES(?,?,?,?)').run(id, stats.count, mimeType, data)
    return { id, mimeType, dataUrl }
  }

  removeDraftImage(generation: number, id: string) {
    const current = this.db.prepare("SELECT generation FROM drafts WHERE key='capture'").get() as { generation: number }
    if (generation !== current.generation) throw new AppError('STALE_DRAFT', 'The capture changed. Open it again before editing images.')
    this.db.prepare('DELETE FROM capture_draft_images WHERE id=?').run(id)
  }

  getItemImage(id: string): string {
    const row = this.db.prepare('SELECT mime_type,data FROM item_images WHERE id=?').get(id) as { mime_type: string; data: Buffer } | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This image is no longer available.')
    return `data:${row.mime_type};base64,${row.data.toString('base64')}`
  }

  submitCapture(requestId: string, generation: number, body: string, categoryId: string | null = null, requestedSubcategoryId?: string | null, requestedTags?:string[], captureKind?: 'inbox' | 'task' | 'note') {
    const existing = this.db.prepare('SELECT id FROM notes WHERE capture_request_id=?').get(requestId) as { id: string } | undefined
    if (existing) return existing.id
    const selectedKind = captureKind ?? 'task'
    const cleaned = body.trim()
    const current = this.db.prepare("SELECT generation,category_id AS categoryId,subcategory_id AS subcategoryId FROM drafts WHERE key='capture'").get() as { generation: number;categoryId:string|null;subcategoryId:string|null }
    const subcategoryId=requestedSubcategoryId===undefined?(current.generation===generation&&current.categoryId===categoryId?current.subcategoryId:null):requestedSubcategoryId
    this.validateSubcategory(categoryId,subcategoryId)
    const hasImages = generation === current.generation && Boolean(this.db.prepare('SELECT 1 FROM capture_draft_images LIMIT 1').get())
    if (!cleaned && !hasImages) throw new AppError('EMPTY_TASK', 'Write something or paste an image before saving.')
    if ([...body].length > 50_000) throw new AppError('TASK_TOO_LONG', 'Tasks can contain up to 50,000 characters.')
    if (categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
    const tags=normalizeTags(requestedTags??(current.generation===generation?this.getCaptureDraft().tags:[]))
    const now = Date.now()
    const id = randomUUID()
    const commit = this.db.transaction(() => {
      this.db.prepare("INSERT INTO notes(id,capture_request_id,body,meeting_id,created_at,updated_at,revision,kind,project_id,subcategory_id) VALUES(?,?,?,NULL,?,?,1,'inbox',?,?)")
        .run(id, requestId, body.replace(/\r\n?/g, '\n'), now, now, categoryId, subcategoryId)
      if (generation === current.generation) {
        this.db.prepare('INSERT INTO item_images(id,note_id,position,mime_type,data) SELECT id,?,position,mime_type,data FROM capture_draft_images').run(id)
        this.db.prepare('DELETE FROM capture_draft_images').run()
      }
      this.db.prepare("UPDATE drafts SET body='',capture_kind='task',category_id=NULL,subcategory_id=NULL,generation=?,revision=0,updated_at=? WHERE key='capture' AND generation<=?").run(generation + 1, now, generation)
      this.replaceItemTags(id,tags)
      this.syncSearch(id)
      if(selectedKind!=='inbox')this.classifyItem(id,selectedKind,tags,categoryId,subcategoryId)
    })
    commit()
    this.changeSequence++
    return id
  }

  listItems(filter: ItemFilter): ItemPage {
    const trashScope = filter.scope === 'trash'
    const prioritySort = filter.sort === 'priority' && !trashScope
    const sortColumn = trashScope ? 'n.deleted_at' : 'n.created_at'
    const where: string[] = [trashScope ? 'n.deleted_at IS NOT NULL' : 'n.deleted_at IS NULL']
    const params: (string | number | null)[] = []
    if (!trashScope) where.push(filter.includeCompleted ? "(n.kind<>'task' OR n.task_status IN ('open','done'))" : "(n.kind<>'task' OR n.task_status='open')")
    if (filter.categoryId) { where.push('n.project_id=?'); params.push(filter.categoryId) }
    if (filter.subcategoryId) { where.push('n.subcategory_id=?'); params.push(filter.subcategoryId) }
    if (filter.noSubcategory) where.push('n.subcategory_id IS NULL')
    if (filter.needsReview) where.push('EXISTS(SELECT 1 FROM taxonomy_migration_review r WHERE r.note_id=n.id)')
    if (filter.kinds?.length) {
      where.push(`n.kind IN (${filter.kinds.map(() => '?').join(',')})`)
      params.push(...filter.kinds)
    }
    if (filter.dateFrom !== undefined) { where.push(`${sortColumn}>=?`); params.push(filter.dateFrom) }
    if (filter.dateTo !== undefined) { where.push(`${sortColumn}<?`); params.push(filter.dateTo) }
    if (filter.tags?.length) {
      where.push(`EXISTS (SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${filter.tags.map(() => '?').join(',')}))`)
      params.push(...filter.tags)
    }
    if (filter.excludedTags?.length) {
      where.push(`NOT EXISTS (SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${filter.excludedTags.map(() => '?').join(',')}))`)
      params.push(...filter.excludedTags)
    }
    const query = filter.query.trim()
    if (query) {
      const terms = query.match(/[\p{L}\p{N}_]+/gu) ?? []
      if (terms.length) {
        const match = terms.map((term) => `"${term.replaceAll('"', '""')}"*`).join(' AND ')
        where.push('('+'n.id IN (SELECT note_id FROM note_search WHERE note_search MATCH ?) OR EXISTS(SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND instr(lower(t.name),lower(?))>0) OR EXISTS(SELECT 1 FROM subcategories s WHERE s.id=n.subcategory_id AND instr(lower(s.name),lower(?))>0)'+')')
        params.push(match,query,query)
      } else {
        where.push("(instr(lower(n.body),lower(?))>0 OR instr(lower(coalesce(m.title,'')),lower(?))>0)")
        params.push(query, query)
      }
    }
    const base = where.join(' AND ')
    const count = this.db.prepare(`SELECT count(*) AS count FROM notes n LEFT JOIN legacy_meeting_sessions m ON m.id=n.meeting_id WHERE ${base}`).get(...params) as { count: number }
    const pageWhere = [...where]
    const pageParams = [...params]
    if (filter.cursor) {
      if (prioritySort && filter.cursor.kindRank === 0 && filter.cursor.priorityPosition !== undefined) {
        pageWhere.push("((n.kind='task' AND n.task_status='open' AND (n.backlog_position>? OR (n.backlog_position=? AND n.id>?))) OR (n.kind='task' AND n.task_status='done') OR n.kind<>'task')")
        pageParams.push(filter.cursor.priorityPosition, filter.cursor.priorityPosition, filter.cursor.id)
      } else if (prioritySort && filter.cursor.kindRank === 1 && filter.cursor.priorityPosition !== undefined) {
        pageWhere.push("((n.kind='task' AND n.task_status='done' AND (n.backlog_position>? OR (n.backlog_position=? AND n.id>?))) OR n.kind<>'task')")
        pageParams.push(filter.cursor.priorityPosition, filter.cursor.priorityPosition, filter.cursor.id)
      } else if (prioritySort && filter.cursor.kindRank === 2) {
        pageWhere.push(`n.kind<>'task' AND (${sortColumn}<? OR (${sortColumn}=? AND n.id<?))`)
        pageParams.push(filter.cursor.sortAt, filter.cursor.sortAt, filter.cursor.id)
      } else if (prioritySort) {
        pageWhere.push(`n.kind<>'task' AND (${sortColumn}<? OR (${sortColumn}=? AND n.id<?))`)
        pageParams.push(filter.cursor.sortAt, filter.cursor.sortAt, filter.cursor.id)
      } else {
        const operator = filter.sort === 'oldest' ? '>' : '<'
        pageWhere.push(`(${sortColumn}${operator}? OR (${sortColumn}=? AND n.id${operator}?))`)
        pageParams.push(filter.cursor.sortAt, filter.cursor.sortAt, filter.cursor.id)
      }
    }
    const order = filter.sort === 'oldest' ? 'ASC' : 'DESC'
    const orderBy = prioritySort ? "CASE WHEN n.kind='task' AND n.task_status='open' THEN 0 WHEN n.kind='task' AND n.task_status='done' THEN 1 ELSE 2 END,CASE WHEN n.kind='task' THEN n.backlog_position ELSE 0 END,CASE WHEN n.kind='task' THEN n.id END ASC,CASE WHEN n.kind<>'task' THEN n.created_at END DESC,CASE WHEN n.kind<>'task' THEN n.id END DESC" : `${sortColumn} ${order},n.id ${order}`
    const items = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE ${pageWhere.join(' AND ')} ORDER BY ${orderBy} LIMIT ?`)
      .all(...pageParams, filter.limit) as ItemRow[]
    const last = items.at(-1)
    const sortAt = last ? (trashScope ? last.deleted_at : last.created_at) : null
    const nextCursor = items.length === filter.limit && last && sortAt !== null
      ? prioritySort ? { sortAt, id: last.id, kindRank: last.kind === 'task' ? (last.task_status === 'done' ? 1 : 0) : 2, ...(last.kind === 'task' ? { priorityPosition: last.backlog_position } : {}) }
        : { sortAt, id: last.id }
      : null
    return { items: items.map(itemFrom), nextCursor, total: count.count }
  }

  listTags(): string[] {
    return (this.db.prepare('SELECT name FROM item_tags ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((row) => row.name)
  }

  taxonomy(): { categories: Category[]; subcategories: Subcategory[]; tags: TagRecord[] } {
    const categories = this.db.prepare('SELECT c.id,c.name,c.color,(SELECT count(*) FROM notes n WHERE n.project_id=c.id AND n.subcategory_id IS NULL AND n.deleted_at IS NULL) AS noSubcategoryCount FROM categories c ORDER BY c.position,c.name COLLATE NOCASE').all() as Category[]
    const rows = this.db.prepare(`SELECT t.id,t.name,NULL AS categoryId,t.color,count(n.id) AS count
      FROM item_tags t LEFT JOIN note_tags nt ON nt.tag_id=t.id LEFT JOIN notes n ON n.id=nt.note_id AND n.deleted_at IS NULL
      GROUP BY t.id ORDER BY t.position,t.name COLLATE NOCASE`).all() as TagRecord[]
    const subcategories = this.db.prepare('SELECT s.id,s.name,s.category_id AS categoryId,s.color,count(n.id) AS count FROM subcategories s LEFT JOIN notes n ON n.subcategory_id=s.id AND n.deleted_at IS NULL GROUP BY s.id ORDER BY s.category_id,s.position,s.name COLLATE NOCASE').all() as Subcategory[]
    return { categories, subcategories, tags: rows }
  }

  createCategory(name: string): Category {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (this.db.prepare('SELECT id FROM categories WHERE name=? COLLATE NOCASE').get(clean)) throw new AppError('DUPLICATE_CATEGORY', 'That category already exists.')
    const category = { id: randomUUID(), name: clean }
    this.db.prepare('INSERT INTO categories(id,name,position) VALUES(?,?,(SELECT coalesce(max(position),-1)+1 FROM categories))').run(category.id, category.name)
    this.changeSequence++
    return category
  }

  updateCategory(id: string, name: string, color?: string): Category {
    const clean = name.trim().replace(/\s+/g, ' ')
    if (!clean || clean.length > 60) throw new AppError('INVALID_INPUT', 'Category names must be 1 to 60 characters.')
    if (this.db.prepare('SELECT id FROM categories WHERE name=? COLLATE NOCASE AND id<>?').get(clean, id)) throw new AppError('DUPLICATE_CATEGORY', 'That category already exists.')
    if (color !== undefined && !/^#[0-9a-f]{6}$/i.test(color)) throw new AppError('INVALID_INPUT', 'Choose a valid category color.')
    const result = this.db.prepare('UPDATE categories SET name=?,color=coalesce(?,color) WHERE id=?').run(clean, color ?? null, id)
    if (!result.changes) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
    this.changeSequence++
    return this.taxonomy().categories.find(category => category.id === id)!
  }

  deleteCategory(id: string) {
    const remove = this.db.transaction(() => {
      if (!this.db.prepare('SELECT id FROM categories WHERE id=?').get(id)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
      const items=this.db.prepare('SELECT id FROM notes WHERE project_id=? ORDER BY backlog_position,id').all(id) as {id:string}[]
      for(const item of items){const note=this.getItem(item.id)!;this.db.prepare('UPDATE notes SET project_id=NULL,subcategory_id=NULL,backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?').run(note.kind==='task'?this.nextBacklogPosition(null):0,Date.now(),item.id)}
      this.db.prepare('UPDATE drafts SET category_id=NULL,subcategory_id=NULL,updated_at=?,revision=revision+1 WHERE category_id=?').run(Date.now(),id)
      this.db.prepare('DELETE FROM categories WHERE id=?').run(id)
    })
    remove()
    this.changeSequence++
  }

  reorderCategories(ids: string[]) {
    const existing = (this.db.prepare('SELECT id FROM categories ORDER BY position,name COLLATE NOCASE').all() as { id: string }[]).map((row) => row.id)
    if (ids.length !== existing.length || new Set(ids).size !== ids.length || ids.some((id) => !existing.includes(id))) throw new AppError('INVALID_REORDER', 'The category list changed. Refresh and try again.')
    this.db.transaction(() => { const update = this.db.prepare('UPDATE categories SET position=? WHERE id=?'); ids.forEach((id, position) => update.run(position, id)) })()
    this.changeSequence++
  }

  reorderTags(_categoryId: string | null, ids: string[]) {
    const existing = this.taxonomy().tags
    if (ids.length!==existing.length || new Set(ids).size!==ids.length || ids.some(id=>!existing.some(tag=>tag.id===id))) throw new AppError('INVALID_REORDER','The tag list changed.')
    this.db.transaction(()=>ids.forEach((id,position)=>this.db.prepare('UPDATE item_tags SET position=? WHERE id=?').run(position,id)))(); this.changeSequence++
  }
  createTag(name: string, _categoryId: string | null = null): TagRecord {
    const clean=name.trim().replace(/\s+/g,' ')
    if (!clean || clean.length>40) throw new AppError('INVALID_INPUT','Choose a tag name up to 40 characters.')
    if (this.db.prepare('SELECT id FROM item_tags WHERE name=? COLLATE NOCASE').get(clean)) throw new AppError('DUPLICATE_TAG','That tag already exists.')
    const tag={id:randomUUID(),name:clean,categoryId:null,color:'#85858e',count:0}
    this.db.prepare('INSERT INTO item_tags(id,name,color,position) VALUES(?,?,?,(SELECT coalesce(max(position),-1)+1 FROM item_tags))').run(tag.id,clean,tag.color)
    this.changeSequence++; return tag
  }
  updateTag(id: string, _categoryId: string | null, color: string, name?: string) {
    if (name!==undefined && (!name.trim() || name.trim().length>40)) throw new AppError('INVALID_INPUT','Choose a valid tag name.')
    if (name!==undefined && this.db.prepare('SELECT id FROM item_tags WHERE name=? COLLATE NOCASE AND id<>?').get(name.trim(),id)) throw new AppError('DUPLICATE_TAG','That tag already exists.')
    this.db.transaction(()=> {
      const current=this.db.prepare('SELECT name FROM item_tags WHERE id=?').get(id) as {name:string}|undefined
      if(!current)throw new AppError('TAG_MISSING','Tag no longer exists.')
      if(name!==undefined&&name.trim()!==current.name)this.db.prepare('UPDATE notes SET revision=revision+1,updated_at=? WHERE id IN(SELECT note_id FROM note_tags WHERE tag_id=?)').run(Date.now(),id)
      this.db.prepare('UPDATE item_tags SET color=?,name=coalesce(?,name) WHERE id=?').run(color,name?.trim()??null,id)
    })()
    this.changeSequence++
  }
  private validateSubcategory(categoryId: string | null, subcategoryId: string | null) {
    if (subcategoryId && !this.db.prepare('SELECT id FROM subcategories WHERE id=? AND category_id=?').get(subcategoryId,categoryId)) throw new AppError('INVALID_SUBCATEGORY','Choose a subcategory belonging to the selected category.')
  }
  createSubcategory(name: string, categoryId: string): Subcategory {
    const clean=name.trim().replace(/\s+/g,' ')
    if (!clean || clean.length>40 || !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('INVALID_INPUT','Choose a category and a name up to 40 characters.')
    if (this.db.prepare('SELECT id FROM subcategories WHERE category_id=? AND name=? COLLATE NOCASE').get(categoryId,clean)) throw new AppError('DUPLICATE_SUBCATEGORY','That subcategory already exists here.')
    const item={id:randomUUID(),name:clean,categoryId,color:'#85858e',count:0}
    this.db.prepare('INSERT INTO subcategories VALUES(?,?,?,?,(SELECT coalesce(max(position),-1)+1 FROM subcategories WHERE category_id=?))').run(item.id,categoryId,clean,item.color,categoryId)
    this.changeSequence++; return item
  }
  updateSubcategory(id: string, name: string, color: string) {
    const clean=name.trim().replace(/\s+/g,' ')
    if (!clean || clean.length>40 || !/^#[0-9a-f]{6}$/i.test(color)) throw new AppError('INVALID_INPUT','Choose a valid name and color.')
    const current=this.taxonomy().subcategories.find(item=>item.id===id)
    if (!current) throw new AppError('NOT_FOUND','Subcategory no longer exists.')
    if (this.db.prepare('SELECT id FROM subcategories WHERE category_id=? AND name=? COLLATE NOCASE AND id<>?').get(current.categoryId,clean,id)) throw new AppError('DUPLICATE_SUBCATEGORY','That subcategory already exists here.')
    this.db.prepare('UPDATE subcategories SET name=?,color=? WHERE id=?').run(clean,color,id); this.changeSequence++
  }
  deleteSubcategory(id: string) {
    this.db.transaction(()=> {
      if(!this.db.prepare('SELECT id FROM subcategories WHERE id=?').get(id))throw new AppError('NOT_FOUND','Subcategory no longer exists.')
      this.db.prepare('UPDATE notes SET subcategory_id=NULL,revision=revision+1,updated_at=? WHERE subcategory_id=?').run(Date.now(),id)
      this.db.prepare('UPDATE drafts SET subcategory_id=NULL,revision=revision+1,updated_at=? WHERE subcategory_id=?').run(Date.now(),id)
      this.db.prepare('DELETE FROM subcategories WHERE id=?').run(id)
    })(); this.changeSequence++
  }
  reorderSubcategories(categoryId: string, ids: string[]) {
    const existing=this.taxonomy().subcategories.filter(item=>item.categoryId===categoryId)
    if (ids.length!==existing.length || new Set(ids).size!==ids.length || ids.some(id=>!existing.some(item=>item.id===id))) throw new AppError('INVALID_REORDER','The subcategory list changed.')
    this.db.transaction(()=>ids.forEach((id,position)=>this.db.prepare('UPDATE subcategories SET position=? WHERE id=?').run(position,id)))(); this.changeSequence++
  }
  migrationStatus() {
    const row=this.db.prepare("SELECT value FROM app_state WHERE key='taxonomy-upgrade'").get() as {value:string}|undefined
    const value=row?JSON.parse(row.value) as {subcategories:number;acknowledged?:boolean}:null
    return {upgraded:!!value?.subcategories,acknowledged:!!value?.acknowledged}
  }
  acknowledgeMigration() {
    const row=this.db.prepare("SELECT value FROM app_state WHERE key='taxonomy-upgrade'").get() as {value:string}|undefined
    if(row)this.db.prepare("UPDATE app_state SET value=? WHERE key='taxonomy-upgrade'").run(JSON.stringify({...JSON.parse(row.value),acknowledged:true}))
  }
  migrationReview(): MigrationReview[] { return (this.db.prepare('SELECT note_id AS noteId,reason,candidates FROM taxonomy_migration_review ORDER BY note_id').all() as {noteId:string;reason:string;candidates:string}[]).map(row=>({...row,candidates:JSON.parse(row.candidates) as string[]})) }
  resolveMigrationReview(id: string, expectedRevision: number, subcategoryId: string | null, categoryId?: string | null) {
    this.db.transaction(()=> {
      const item=this.getItem(id)
      if (!item || item.deletedAt!==null) throw new AppError('NOT_FOUND','Restore this item before editing its assignment.')
      this.updateItem(id,expectedRevision,item.body,item.tags,categoryId,undefined,subcategoryId)
      this.db.prepare('DELETE FROM taxonomy_migration_review WHERE note_id=?').run(id)
    })()
  }

  deleteTag(id: string) {
    const remove = this.db.transaction(() => {
      const result = this.db.prepare('DELETE FROM item_tags WHERE id=?').run(id)
      if (!result.changes) throw new AppError('TAG_MISSING', 'That tag no longer exists.')
    })
    remove()
    this.changeSequence++
  }

  getItem(id: string) {
    const row = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE n.id=?`).get(id) as ItemRow | undefined
    return row ? row.kind === 'task' ? taskFrom(row) : itemFrom(row) : null
  }

  listInbox(cursor?: { sortAt: number; id: string }, limit = 50): { items: (ItemRecord & { meetingTitle: string | null })[]; nextCursor: { sortAt: number; id: string } | null; total: number } {
    const cursorWhere = cursor ? ' AND (n.created_at<? OR (n.created_at=? AND n.id<?))' : ''
    const params = cursor ? [cursor.sortAt, cursor.sortAt, cursor.id, limit] : [limit]
    const rows = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE n.deleted_at IS NULL AND n.kind='inbox'${cursorWhere} ORDER BY n.created_at DESC,n.id DESC LIMIT ?`).all(...params) as ItemRow[]
    const last = rows.at(-1)
    return { items: rows.map(itemFrom), nextCursor: rows.length === limit && last ? { sortAt: last.created_at, id: last.id } : null, total: this.inboxCount() }
  }

  inboxCount() {
    return (this.db.prepare("SELECT count(*) AS count FROM notes WHERE deleted_at IS NULL AND kind='inbox'").get() as { count: number }).count
  }

  classifyItem(id: string, kind: 'note' | 'task', tags: string[], requestedCategoryId?: string | null, requestedSubcategoryId?: string | null) {
    const cleanTags = normalizeTags(tags)
    const now = Date.now()
    const transaction = this.db.transaction(() => {
      const current = this.db.prepare("SELECT project_id AS categoryId,subcategory_id AS subcategoryId FROM notes WHERE id=? AND deleted_at IS NULL AND kind='inbox'").get(id) as { categoryId: string | null; subcategoryId: string | null } | undefined
      if (!current) throw new AppError('ALREADY_FILED', 'This Inbox item has already been filed. Reload the Inbox to continue.')
      const categoryId = requestedCategoryId === undefined ? current.categoryId : requestedCategoryId
      if (categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
      const subcategoryId = requestedSubcategoryId === undefined ? (current.categoryId === categoryId ? current.subcategoryId : null) : requestedSubcategoryId
      this.validateSubcategory(categoryId,subcategoryId)
      const changed = this.db.prepare("UPDATE notes SET kind=?,processed_at=?,task_status=?,planned_date=?,planned_start_at=NULL,planned_end_at=NULL,due_date=?,task_position=0,before_event_id=NULL,completed_at=NULL,project_id=?,subcategory_id=?,task_ready=0,is_later=0,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL AND kind='inbox'").run(kind, now, kind === 'task' ? 'open' : null, null, null, categoryId, subcategoryId, now, id)
      if (!changed.changes) throw new AppError('ALREADY_FILED', 'This Inbox item has already been filed. Reload the Inbox to continue.')
      this.replaceItemTags(id, cleanTags, categoryId)
      const priorityPosition = kind === 'task' ? this.nextBacklogPosition(categoryId) : 0
      this.db.prepare('UPDATE notes SET backlog_position=? WHERE id=?').run(priorityPosition, id)
    })
    transaction(); this.changeSequence++
  }

  unfilePlannerTask(id: string) {
    const current = this.db.prepare("SELECT planned_date,before_event_id FROM notes WHERE id=? AND kind='task' AND deleted_at IS NULL").get(id) as { planned_date: string | null; before_event_id: string | null } | undefined
    if (!current) throw new AppError('NOT_FOUND', 'This to-do no longer exists.')
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE notes SET kind='inbox',processed_at=NULL,task_status=NULL,planned_date=NULL,planned_start_at=NULL,planned_end_at=NULL,due_date=NULL,task_position=0,backlog_position=0,before_event_id=NULL,completed_at=NULL,task_ready=0,is_later=0,updated_at=?,revision=revision+1 WHERE id=? AND kind='task' AND deleted_at IS NULL").run(Date.now(), id)
      if (current.planned_date) this.compactTaskSlot(current.planned_date, current.before_event_id)
    })
    transaction(); this.changeSequence++
  }

  setItemTags(id: string, tags: string[]) {
    const current = this.getItem(id)
    if (!current || current.deletedAt !== null) throw new AppError('NOT_FOUND', 'This item no longer exists.')
    const cleanTags = normalizeTags(tags)
    const transaction = this.db.transaction(() => {
      const category = this.db.prepare('SELECT project_id AS categoryId FROM notes WHERE id=?').get(id) as { categoryId: string | null; subcategoryId: string | null } | undefined
      this.replaceItemTags(id, cleanTags, category?.categoryId ?? null)
      this.db.prepare('UPDATE notes SET revision=revision+1,updated_at=? WHERE id=?').run(Date.now(), id)
    })
    transaction(); this.changeSequence++
  }

  private replaceItemTags(id: string, tags: string[], categoryId: string | null = null) {
    this.db.prepare('DELETE FROM note_tags WHERE note_id=?').run(id)
    for (const name of tags) {
      this.db.prepare('INSERT INTO item_tags(id,name,position) VALUES(?,?,(SELECT coalesce(max(position),-1)+1 FROM item_tags)) ON CONFLICT(name) DO NOTHING').run(randomUUID(), name)
      const tag = this.db.prepare('SELECT id FROM item_tags WHERE name=? COLLATE NOCASE').get(name) as { id: string }
      this.db.prepare('INSERT INTO note_tags(note_id,tag_id) VALUES(?,?)').run(id, tag.id)
    }
  }

  private nextBacklogPosition(categoryId: string | null) {
    return (this.db.prepare("SELECT coalesce(max(backlog_position),-1)+1 AS position FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND is_later=0 AND task_ready=0 AND planned_date IS NULL AND project_id IS ?").get(categoryId) as { position: number }).position
  }

  backlogSummary(later = false): PlannerBacklogSummary {
    const cached = this.backlogSummaryCache.get(later)
    if (cached?.sequence === this.changeSequence) return cached.value
    const rows = this.db.prepare(`SELECT project_id AS categoryId,coalesce(subcategory_id,'') AS subcategoryId,count(*) AS count
      FROM notes WHERE deleted_at IS NULL AND kind='task' AND task_status='open' AND task_ready=0
      AND planned_date IS NULL AND is_later=? GROUP BY project_id,subcategory_id`).all(later ? 1 : 0) as { categoryId: string | null; subcategoryId: string; count: number }[]
    const summary: PlannerBacklogSummary = {}
    for (const row of rows) {
      const group = summary[row.categoryId ?? 'unassigned'] ??= { total: 0, subcategoryCounts: {} }
      group.total += row.count
      group.subcategoryCounts[row.subcategoryId] = row.count
    }
    this.backlogSummaryCache.set(later, { sequence: this.changeSequence, value: summary })
    return summary
  }

  listBacklog(input: { categoryId: string | null; query?: string; subcategoryIds?: string[]; includeNoSubcategory?: boolean; tagNames?: string[]; excludedTags?: string[]; includeUntagged?: boolean; cursor?: { priorityPosition: number; id: string }; limit?: number; later?: boolean; countsOnly?: boolean } = { categoryId: null }): { items: PlannerTask[]; nextCursor: { priorityPosition: number; id: string } | null; total: number; subcategoryCounts: Record<string, number> } {
    const limit = input.limit ?? 50
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('INVALID_INPUT', 'Choose a valid backlog page size.')
    const query = input.query?.trim() ?? ''
    const where = ["n.deleted_at IS NULL", "n.kind='task'", "n.task_status='open'", 'n.task_ready=0', 'n.planned_date IS NULL', 'n.is_later=?', 'n.project_id IS ?']
    const params: (string | number | null)[] = []
    params.push(input.later ? 1 : 0, input.categoryId)
    const summary = this.backlogSummary(Boolean(input.later))[input.categoryId ?? 'unassigned']
    const subcategoryCounts = summary?.subcategoryCounts ?? {}
    const baseConditionCount = where.length
    if (input.subcategoryIds!==undefined || input.includeNoSubcategory!==undefined) {
      const selected=input.subcategoryIds??[], clauses:string[]=[]
      if (selected.length) { clauses.push(`n.subcategory_id IN (${selected.map(()=>'?').join(',')})`); params.push(...selected) }
      if (input.includeNoSubcategory) clauses.push('n.subcategory_id IS NULL')
      where.push(clauses.length?`(${clauses.join(' OR ')})`:'0=1')
    }
    const tagNames = [...new Map((input.tagNames ?? []).map((name) => name.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).map((name): [string, string] => [name.toLocaleLowerCase(), name])).values()]
    const includeUntagged = input.includeUntagged ?? false
    const hasTagFilter = input.tagNames !== undefined || input.includeUntagged !== undefined
    if (hasTagFilter && !tagNames.length && !includeUntagged) where.push('0=1')
    else if (hasTagFilter && tagNames.length) {
      const selectedTags = `EXISTS (SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${tagNames.map(() => '?').join(',')}))`
      const untagged = 'NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id)'
      where.push(includeUntagged ? `(${selectedTags} OR ${untagged})` : selectedTags)
      params.push(...tagNames)
    } else if (hasTagFilter && includeUntagged) where.push('NOT EXISTS (SELECT 1 FROM note_tags nt WHERE nt.note_id=n.id)')
    if (input.excludedTags?.length) {
      where.push(`NOT EXISTS (SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND t.name COLLATE NOCASE IN (${input.excludedTags.map(() => '?').join(',')}))`)
      params.push(...input.excludedTags)
    }
    if (query) {
      where.push("(instr(lower(n.body),lower(?))>0 OR EXISTS (SELECT 1 FROM note_tags nt JOIN item_tags t ON t.id=nt.tag_id WHERE nt.note_id=n.id AND instr(lower(t.name),lower(?))>0) OR EXISTS(SELECT 1 FROM subcategories s WHERE s.id=n.subcategory_id AND instr(lower(s.name),lower(?))>0))")
      params.push(query, query, query)
    }
    const base = where.join(' AND ')
    const total = where.length === baseConditionCount ? summary?.total ?? 0 : (this.db.prepare(`SELECT count(*) AS count FROM notes n WHERE ${base}`).get(...params) as { count: number }).count
    if (input.countsOnly) return { items: [], nextCursor: null, total, subcategoryCounts }
    const pageWhere = [...where]
    const pageParams = [...params]
    if (input.cursor) {
      pageWhere.push('(n.backlog_position>? OR (n.backlog_position=? AND n.id>?))')
      pageParams.push(input.cursor.priorityPosition, input.cursor.priorityPosition, input.cursor.id)
    }
    const rows = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE ${pageWhere.join(' AND ')} ORDER BY n.backlog_position,n.id LIMIT ?`)
      .all(...pageParams, limit + 1) as ItemRow[]
    const hasMore = rows.length > limit
    const items = rows.slice(0, limit)
    const last = items.at(-1)
    return { items: items.map(taskFrom), nextCursor: hasMore && last ? { priorityPosition: last.backlog_position, id: last.id } : null, total, subcategoryCounts }
  }

  setTaskReady(id: string) {
    const row = this.db.prepare("SELECT planned_date,before_event_id FROM notes WHERE id=? AND kind='task' AND task_status='open' AND deleted_at IS NULL").get(id) as { planned_date: string | null; before_event_id: string | null } | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This open task no longer exists.')
    this.db.transaction(() => {
      const existingReady = this.db.prepare("SELECT id FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND task_ready=1 AND planned_date IS NULL ORDER BY task_position,created_at,id").all() as { id: string }[]
      this.db.prepare('UPDATE notes SET task_ready=1,is_later=0,planned_date=NULL,planned_start_at=NULL,planned_end_at=NULL,before_event_id=NULL,task_position=0,updated_at=?,revision=revision+1 WHERE id=?').run(Date.now(), id)
      const ids = [...existingReady.map((task) => task.id).filter((taskId) => taskId !== id), id]
      const update = this.db.prepare('UPDATE notes SET task_position=? WHERE id=?')
      ids.forEach((taskId, position) => update.run(position, taskId))
      if (row.planned_date) this.compactTaskSlot(row.planned_date, row.before_event_id)
    })()
    this.changeSequence++
  }

  setTaskCompleted(id: string, completed: boolean) {
    const row = this.db.prepare("SELECT task_status,planned_date,before_event_id,task_ready,project_id AS categoryId FROM notes WHERE id=? AND kind='task' AND deleted_at IS NULL").get(id) as { task_status: 'open' | 'done'; planned_date: string | null; before_event_id: string | null; task_ready: number; categoryId: string | null } | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This to-do no longer exists.')
    if ((row.task_status === 'done') === completed) return
    const now = Date.now()
    this.db.transaction(() => {
      if (completed) {
        this.db.prepare("UPDATE notes SET task_status='done',completed_at=?,task_ready=0,is_later=0,updated_at=?,revision=revision+1 WHERE id=?").run(now, now, id)
        if (row.planned_date) this.compactTaskSlot(row.planned_date, row.before_event_id)
        else if (row.task_ready) this.compactReadySlot()
      } else {
        const backlogPosition = this.nextBacklogPosition(row.categoryId)
        this.db.prepare("UPDATE notes SET task_status='open',completed_at=NULL,is_later=0,planned_date=NULL,planned_start_at=NULL,planned_end_at=NULL,before_event_id=NULL,task_ready=0,task_position=0,backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?").run(backlogPosition, now, id)
        if (row.planned_date) this.compactTaskSlot(row.planned_date, row.before_event_id)
        else if (row.task_ready) this.compactReadySlot()
      }
    })()
    this.changeSequence++
  }

  setItemCategory(id: string, categoryId: string | null, subcategoryId?: string | null) {
    if (categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
    const current=this.getItem(id)
    if (!current) throw new AppError('NOT_FOUND','This item no longer exists.')
    this.updateItem(id,current.revision,current.body,current.tags,categoryId,undefined,subcategoryId)
  }

  reorderBacklog(id: string, categoryId: string | null, beforeId: string | null) {
    const item = this.db.prepare("SELECT id FROM notes WHERE id=? AND kind='task' AND task_status='open' AND deleted_at IS NULL AND project_id IS ?").get(id, categoryId) as { id: string } | undefined
    if (!item) throw new AppError('INVALID_REORDER', 'This to-do is no longer in that category.')
    const rows = this.db.prepare("SELECT id FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND is_later=0 AND task_ready=0 AND planned_date IS NULL AND project_id IS ? ORDER BY backlog_position,id").all(categoryId) as { id: string }[]
    const ids = rows.map((row) => row.id)
    const sourceIndex = ids.indexOf(id)
    if (beforeId === id) return
    const targetIndex = beforeId === null ? ids.length : ids.indexOf(beforeId)
    if (sourceIndex < 0 || targetIndex < 0) throw new AppError('INVALID_REORDER', 'The target to-do is no longer in that category. Refresh and try again.')
    ids.splice(sourceIndex, 1)
    const insertAt = beforeId === null ? ids.length : ids.indexOf(beforeId)
    ids.splice(insertAt, 0, id)
    this.db.transaction(() => {
      const update = this.db.prepare('UPDATE notes SET backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?')
      const now = Date.now()
      ids.forEach((taskId, position) => update.run(position, now, taskId))
    })()
    this.changeSequence++
  }

  reconcileReadyTasks(today: string): number {
    if (!validLocalDate(today)) throw new AppError('INVALID_INPUT', 'Choose a valid local day.')
    // Date-only plans are legacy placements; unfinished ones also return to Ready.
    const changed = this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT id FROM notes WHERE kind='task' AND deleted_at IS NULL
        AND task_status='open' AND completed_at IS NULL AND is_later=0 AND planned_date IS NOT NULL
        AND (planned_date<? OR planned_start_at IS NULL) ORDER BY planned_date,task_position,created_at,id`).all(today) as { id: string }[]
      let position = (this.db.prepare("SELECT coalesce(max(task_position),-1)+1 AS position FROM notes WHERE kind='task' AND deleted_at IS NULL AND task_status='open' AND task_ready=1 AND planned_date IS NULL").get() as { position: number }).position
      const update = this.db.prepare(`UPDATE notes SET task_ready=1,planned_date=NULL,planned_start_at=NULL,
        planned_end_at=NULL,before_event_id=NULL,task_position=?,updated_at=?,revision=revision+1 WHERE id=?`)
      const now = Date.now()
      for (const row of rows) update.run(position++, now, row.id)
      return rows.length
    })()
    if (changed) this.changeSequence++
    return changed
  }

  listPlanner(from: string, to: string): { tasks: PlannerTask[]; events: PlannerEvent[]; tags: string[] } {
    if (!isISODate(from) || !isISODate(to) || to < from) throw new AppError('INVALID_INPUT', 'Choose a valid planner date range.')
    const start = new Date(`${from}T00:00:00`).getTime()
    const end = localDateBounds(to).end
    const rows = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE n.deleted_at IS NULL AND n.kind='task' AND (
      (n.planned_start_at IS NOT NULL AND ((n.planned_start_at<? AND n.planned_end_at>?) OR (n.task_status='open' AND n.is_later=0 AND n.planned_end_at<=?))) OR
      (n.planned_start_at IS NULL AND ((n.task_status='open' AND n.is_later=0 AND ((n.planned_date IS NULL AND n.task_ready=1) OR n.planned_date<=?)) OR (n.task_status='done' AND n.planned_date>=? AND n.planned_date<=?))))
      ORDER BY coalesce(n.planned_date,''),n.before_event_id,n.task_position,n.created_at,n.id`).all(end, start, start, to, from, to) as ItemRow[]
    const tasks = rows.map(taskFrom)
    const events = (this.db.prepare('SELECT * FROM planner_events WHERE start_at<? AND end_at>? ORDER BY start_at,end_at,title').all(end, start) as PlannerEventRow[]).map(eventFrom)
    const tags = (this.db.prepare('SELECT name FROM item_tags ORDER BY name COLLATE NOCASE').all() as { name: string }[]).map((row) => row.name)
    return { tasks, events, tags }
  }

  private getPlannerTask(id: string): PlannerTask {
    const row = this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} WHERE n.id=? AND n.kind='task' AND n.deleted_at IS NULL`).get(id) as ItemRow | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This task no longer exists.')
    return taskFrom(row)
  }

  schedulePlannerTask(raw: PlannerTaskSchedule): PlannerTask {
    const input = PlannerTaskScheduleSchema.parse(raw)
    const result = this.db.transaction(() => {
      const task = this.getPlannerTask(input.id)
      if (task.completedAt !== null) throw new AppError('TASK_COMPLETED', 'Reopen this task before scheduling it.')
      if (task.revision !== input.expectedRevision) throw new AppError('REVISION_CONFLICT', 'This task changed. Reload it and try again.')
      const fields = placementFields(input.placement)
      const position = fields.plannedDate === null && fields.ready
        ? (this.db.prepare("SELECT coalesce(max(task_position),-1)+1 AS position FROM notes WHERE kind='task' AND deleted_at IS NULL AND task_ready=1 AND planned_date IS NULL AND id<>?").get(task.id) as { position: number }).position : 0
      let priority = task.priorityPosition
      if (input.placement.kind === 'backlog') priority = this.nextBacklogPosition(task.categoryId)
      if (input.placement.kind === 'backlog-top') {
        this.db.prepare("UPDATE notes SET backlog_position=backlog_position+1,updated_at=?,revision=revision+1 WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND is_later=0 AND task_ready=0 AND planned_date IS NULL AND project_id IS ?").run(Date.now(), task.categoryId)
        priority = 0
      }
      const later = input.placement.kind === 'later'
      this.db.prepare('UPDATE notes SET planned_date=?,planned_start_at=?,planned_end_at=?,before_event_id=NULL,task_ready=?,is_later=?,task_position=?,backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?').run(fields.plannedDate, fields.plannedStartAt, fields.plannedEndAt, fields.ready ? 1 : 0, later ? 1 : 0, position, priority, Date.now(), task.id)
      if (task.plannedDate) this.compactTaskSlot(task.plannedDate, task.beforeEventId)
      else if (task.ready) this.compactReadySlot()
      return this.getPlannerTask(task.id)
    })()
    this.changeSequence++
    return result
  }

  createPlannerTask(raw: PlannerTaskCreate): PlannerTask {
    const input = PlannerTaskCreateSchema.parse(raw)
    const result = this.db.transaction(() => {
      if (input.categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(input.categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
      this.validateSubcategory(input.categoryId,input.subcategoryId ?? null)
      const id = randomUUID(), now = Date.now()
      this.db.prepare("INSERT INTO notes(id,body,created_at,updated_at,kind,processed_at,task_status,project_id,subcategory_id,backlog_position) VALUES(?,?,?,?,'task',?,'open',?,?,?)").run(id, input.body, now, now, now, input.categoryId, input.subcategoryId ?? null, this.nextBacklogPosition(input.categoryId))
      this.replaceItemTags(id, normalizeTags(input.tags), input.categoryId)
      this.syncSearch(id)
      const scheduled = this.schedulePlannerTask({ id, expectedRevision: 1, placement: input.placement })
      this.db.prepare('UPDATE task_intentions SET kind=?,target_date=? WHERE note_id=?').run(input.placement.kind==='later'?'later':'unplanned',null,id)
      return this.getPlannerTask(id)!
    })()
    return result
  }

  updatePlannerEventTiming(raw: PlannerEventTiming): PlannerEvent {
    const input = PlannerEventTimingSchema.parse(raw)
    return this.db.transaction(() => {
      const current = this.db.prepare('SELECT * FROM planner_events WHERE id=?').get(input.id) as PlannerEventRow | undefined
      if (!current) throw new AppError('NOT_FOUND', 'This meeting no longer exists.')
      if (current.start_at !== input.expectedStartAt || current.end_at !== input.expectedEndAt || Boolean(current.all_day) !== input.expectedAllDay) throw new AppError('REVISION_CONFLICT', 'This meeting changed. Reload it and try again.')
      return this.updatePlannerEvent({ id: input.id, title: current.title, startAt: input.startAt, endAt: input.endAt, allDay: input.allDay })
    })()
  }

  movePlannerTask(id: string, plannedDate: string | null, beforeEventId: string | null, beforeId: string | null) {
    if (plannedDate !== null && !isISODate(plannedDate)) throw new AppError('INVALID_INPUT', 'Choose a valid planner date.')
    const row = this.db.prepare("SELECT planned_date,before_event_id,task_position FROM notes WHERE id=? AND kind='task' AND task_status='open' AND deleted_at IS NULL").get(id) as { planned_date: string | null; before_event_id: string | null; task_position: number } | undefined
    if (!row) throw new AppError('NOT_FOUND', 'This open task no longer exists.')
    if (plannedDate === null && beforeEventId !== null) throw new AppError('INVALID_INPUT', 'An unscheduled task cannot be attached to a meeting.')
    if (beforeEventId) {
      const bounds = localDateBounds(plannedDate!)
      if (!this.db.prepare('SELECT id FROM planner_events WHERE id=? AND start_at<? AND end_at>?').get(beforeEventId, bounds.end, bounds.start)) throw new AppError('INVALID_INPUT', 'That meeting does not overlap the selected day.')
    }
    const readySlot = plannedDate === null ? ' AND task_ready=1' : ''
    const sameSlot = this.db.prepare(`SELECT id FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND planned_date IS ? AND before_event_id IS ?${readySlot} ORDER BY task_position,created_at,id`).all(plannedDate, beforeEventId) as { id: string }[]
    if (beforeId && !sameSlot.some((item) => item.id === beforeId && item.id !== id)) throw new AppError('INVALID_INPUT', 'The task order changed. Reload and try again.')
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE notes SET planned_date=?,planned_start_at=NULL,planned_end_at=NULL,before_event_id=?,task_ready=1,is_later=0,task_position=0,revision=revision+1,updated_at=? WHERE id=?').run(plannedDate, beforeEventId, Date.now(), id)
      const ids = sameSlot.map((item) => item.id).filter((taskId) => taskId !== id)
      const index = beforeId ? ids.indexOf(beforeId) : ids.length
      ids.splice(index < 0 ? ids.length : index, 0, id)
      const update = this.db.prepare('UPDATE notes SET task_position=? WHERE id=?')
      ids.forEach((taskId, position) => update.run(position, taskId))
      if (row.planned_date !== null) this.compactTaskSlot(row.planned_date, row.before_event_id)
      else this.compactReadySlot()
    })
    transaction(); this.changeSequence++
  }

  private compactTaskSlot(day: string, eventId: string | null) {
    const rows = this.db.prepare("SELECT id FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND planned_date=? AND before_event_id IS ? ORDER BY task_position,created_at,id").all(day, eventId) as { id: string }[]
    const update = this.db.prepare('UPDATE notes SET task_position=? WHERE id=?')
    rows.forEach((row, position) => update.run(position, row.id))
  }

  private compactReadySlot() {
    const rows = this.db.prepare("SELECT id FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND task_ready=1 AND planned_date IS NULL AND before_event_id IS NULL ORDER BY task_position,created_at,id").all() as { id: string }[]
    const update = this.db.prepare('UPDATE notes SET task_position=? WHERE id=?')
    rows.forEach((row, position) => update.run(position, row.id))
  }

  savePlannerEvent(input: PlannerEventInput): PlannerEvent {
    const title = input.title.trim()
    if (!title || title.length > 120 || !Number.isSafeInteger(input.startAt) || !Number.isSafeInteger(input.endAt) || input.endAt <= input.startAt) throw new AppError('INVALID_INPUT', 'Enter a title and valid meeting start and end times.')
    if (input.recurrence) {
      const occurrences = meetingOccurrences(input.startAt, input.endAt, input.recurrence)
      return this.db.transaction(() => {
        const saved = occurrences.map((times, index) => this.savePlannerEvent({ ...input, ...times, id: index === 0 ? input.id : undefined, recurrence: undefined }))
        const seriesId = randomUUID()
        for (const event of saved) this.db.prepare('UPDATE planner_events SET series_id=? WHERE id=?').run(seriesId, event.id)
        return { ...saved[0]!, seriesId }
      })()
    }
    const now = Date.now()
    const id = input.id ?? randomUUID()
    const save = this.db.transaction(() => {
      this.db.prepare('INSERT INTO planner_events(id,title,start_at,end_at,all_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,start_at=excluded.start_at,end_at=excluded.end_at,all_day=excluded.all_day,updated_at=excluded.updated_at').run(id, title, input.startAt, input.endAt, input.allDay ? 1 : 0, now, now)
      const taskRows = this.db.prepare("SELECT id,planned_date,before_event_id FROM notes WHERE before_event_id=? AND kind='task' AND deleted_at IS NULL").all(id) as { id: string; planned_date: string | null; before_event_id: string | null }[]
      for (const task of taskRows) {
        const bounds = task.planned_date ? localDateBounds(task.planned_date) : null
        if (!bounds || input.startAt >= bounds.end || input.endAt <= bounds.start) {
          this.db.prepare('UPDATE notes SET before_event_id=NULL,revision=revision+1,updated_at=? WHERE id=?').run(now, task.id)
          if (task.planned_date) this.compactTaskSlot(task.planned_date, null)
        }
      }
      return this.db.prepare('SELECT * FROM planner_events WHERE id=?').get(id) as PlannerEventRow
    })
    const row = save()
    this.changeSequence++
    return eventFrom(row)
  }

  updatePlannerEvent(input: PlannerEventInput & { id: string }) {
    if (!this.db.prepare('SELECT id FROM planner_events WHERE id=?').get(input.id)) throw new AppError('NOT_FOUND', 'This scheduled meeting no longer exists.')
    return this.savePlannerEvent(input)
  }

  deletePlannerEvent(id: string, scope: 'instance' | 'series' = 'instance'): DeletedPlannerEvent {
    const event = this.db.prepare('SELECT * FROM planner_events WHERE id=?').get(id) as PlannerEventRow | undefined
    if (!event) throw new AppError('NOT_FOUND', 'This meeting no longer exists.')
    if (scope === 'series' && event.series_id) {
      return this.db.transaction(() => {
        const members = this.db.prepare('SELECT id FROM planner_events WHERE series_id=? ORDER BY start_at,id').all(event.series_id) as { id: string }[]
        const snapshots = members.map(member => this.deletePlannerEvent(member.id))
        const selected = snapshots.find(snapshot => snapshot.event.id === id)!
        return { ...selected, additional: snapshots.filter(snapshot => snapshot.event.id !== id) }
      })()
    }
    const affected = this.db.prepare("SELECT id,planned_date,task_position FROM notes WHERE before_event_id=? AND kind='task' AND deleted_at IS NULL ORDER BY task_position,created_at,id").all(id) as { id: string; planned_date: string | null; task_position: number }[]
    const transaction = this.db.transaction(() => {
      this.db.prepare('UPDATE notes SET before_event_id=NULL,revision=revision+1,updated_at=? WHERE before_event_id=?').run(Date.now(), id)
      this.db.prepare('DELETE FROM planner_events WHERE id=?').run(id)
      for (const task of affected) if (task.planned_date) this.compactTaskSlot(task.planned_date, null)
    })
    transaction(); this.changeSequence++
    return { event: eventFrom(event), anchors: affected.map((task) => ({ id: task.id, plannedDate: task.planned_date, position: task.task_position })) }
  }

  undoDeletePlannerEvent(snapshot: DeletedPlannerEvent) {
    if (snapshot.additional?.length) {
      this.db.transaction(() => {
        this.undoDeletePlannerEvent({ event: snapshot.event, anchors: snapshot.anchors })
        for (const member of snapshot.additional!) this.undoDeletePlannerEvent(member)
      })()
      return
    }
    const { event, anchors } = snapshot
    if (this.db.prepare('SELECT id FROM planner_events WHERE id=?').get(event.id)) throw new AppError('ALREADY_EXISTS', 'This meeting has already been restored.')
    const now = Date.now()
    const restore = this.db.transaction(() => {
      this.db.prepare('INSERT INTO planner_events(id,title,start_at,end_at,all_day,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(event.id, event.title, event.startAt, event.endAt, event.allDay ? 1 : 0, now, now)
      this.db.prepare('UPDATE planner_events SET series_id=? WHERE id=?').run(event.seriesId ?? null, event.id)
      const days = new Set<string>()
      for (const anchor of anchors) {
        if (!anchor.plannedDate || !eventOverlapsLocalDay(event.startAt, event.endAt, anchor.plannedDate)) continue
        const changed = this.db.prepare("UPDATE notes SET before_event_id=?,task_position=?,revision=revision+1,updated_at=? WHERE id=? AND kind='task' AND deleted_at IS NULL AND planned_date=? AND planned_start_at IS NULL AND before_event_id IS NULL").run(event.id, anchor.position, now, anchor.id, anchor.plannedDate)
        if (changed.changes) days.add(anchor.plannedDate)
      }
      for (const day of days) { this.compactTaskSlot(day, event.id); this.compactTaskSlot(day, null) }
    })
    restore(); this.changeSequence++
  }

  updateItemBody(id: string, expectedRevision: number, body: string) {
    const current = this.getItem(id)
    if (!current) throw new AppError('NOT_FOUND', 'This task no longer exists.')
    if (current.revision !== expectedRevision) throw new AppError('REVISION_CONFLICT', 'This task changed elsewhere. Reload it before saving.')
    if ([...body].length > 50_000) throw new AppError('TASK_TOO_LONG', 'Tasks can contain up to 50,000 characters.')
    const now = Date.now()
    const transaction = this.db.transaction(() => {
      const changed = this.db.prepare('UPDATE notes SET body=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL').run(body.replace(/\r\n?/g, '\n'), now, id, expectedRevision)
      if (!changed.changes) throw new AppError('REVISION_CONFLICT', 'This task changed elsewhere. Reload it before saving.')
      this.syncSearch(id)
    })
    transaction()
    this.changeSequence++
    const updated = this.getItem(id)
    if (!updated) throw new AppError('NOT_FOUND', 'This task no longer exists.')
    return updated
  }

  saveItem(raw: ItemUpdate) {
    const input = ItemUpdateSchema.parse(raw)
    if (input.plan && validLocalDate(input.plan.today)) input.plan.intention = { ...intentionFor(horizonOf(input.plan.intention, input.plan.today)), position: input.plan.intention.position }
    const sequence = this.changeSequence
    try {
      const result = this.db.transaction(() => {
        const current = this.getItem(input.id)
        if ((input.plan || input.placement) && (current?.kind !== 'task' || current.completedAt !== null)) throw new AppError('INVALID_INPUT', 'Only open tasks can be planned or scheduled.')
        let updated = this.updateItem(input.id, input.expectedRevision, input.body, input.tags, input.categoryId, input.images, input.subcategoryId)
        if (input.plan) {
          this.moveWorkspace({ id: input.id, expectedRevision: updated.revision, ...input.plan, beforeId: null })
          updated = this.getItem(input.id)!
        }
        if (input.placement) this.schedulePlannerTask({ id: input.id, expectedRevision: updated.revision, placement: input.placement })
        return this.getItem(input.id)!
      })()
      this.changeSequence = sequence + 1
      return result
    } catch (error) { this.changeSequence = sequence; throw error }
  }

  completeWorkspace(raw: { id: string; expectedRevision: number; completed: boolean }): TaskCompletionUndo {
    const input = TaskCompletionSchema.parse(raw)
    const task = this.getPlannerTask(input.id)
    if (task.revision !== input.expectedRevision) throw new AppError('STALE_REVISION', 'This task changed. Refresh before completing it.')
    this.setTaskCompleted(input.id, input.completed)
    return { task, expectedRevision: this.getPlannerTask(input.id).revision }
  }

  undoCompletion(raw: TaskCompletionUndo) {
    const { task, expectedRevision } = TaskCompletionUndoSchema.parse(raw)
    this.db.transaction(() => {
      const current = this.getPlannerTask(task.id)
      if (current.revision !== expectedRevision) throw new AppError('STALE_REVISION', 'This task changed. Undo is no longer available.')
      const anchor = task.beforeEventId && this.db.prepare('SELECT 1 FROM planner_events WHERE id=?').get(task.beforeEventId) ? task.beforeEventId : null
      // Remove the current placement before inserting the original slot again.
      this.db.prepare("UPDATE notes SET task_status='done',task_ready=0,planned_date=NULL,planned_start_at=NULL,planned_end_at=NULL,before_event_id=NULL WHERE id=?").run(task.id)
      if (current.plannedDate) this.compactTaskSlot(current.plannedDate, current.beforeEventId)
      else if (current.ready) this.compactReadySlot()
      if (task.completedAt === null && task.plannedStartAt === null && (task.plannedDate || task.ready)) {
        this.db.prepare("UPDATE notes SET task_position=task_position+1,revision=revision+1,updated_at=? WHERE id<>? AND kind='task' AND task_status='open' AND deleted_at IS NULL AND planned_start_at IS NULL AND planned_date IS ? AND before_event_id IS ? AND task_ready=? AND task_position>=?")
          .run(Date.now(), task.id, task.plannedDate, anchor, task.ready ? 1 : 0, task.position)
      }
      this.db.prepare('UPDATE notes SET task_status=?,completed_at=?,task_ready=?,is_later=?,planned_date=?,planned_start_at=?,planned_end_at=?,before_event_id=?,task_position=?,backlog_position=?,updated_at=?,revision=revision+1 WHERE id=?')
        .run(task.completedAt === null ? 'open' : 'done', task.completedAt, task.ready ? 1 : 0, task.later ? 1 : 0, task.plannedDate, task.plannedStartAt, task.plannedEndAt, anchor, task.position, task.priorityPosition, Date.now(), task.id)
      if (task.plannedDate) this.compactTaskSlot(task.plannedDate, anchor)
      else if (task.ready) this.compactReadySlot()
    })()
    this.changeSequence++
  }

  updateItem(id: string, expectedRevision: number, body: string, tags: string[], requestedCategoryId?: string | null, images?: (ImageRef & { dataUrl?: string })[], requestedSubcategoryId?: string | null) {
    const current = this.getItem(id)
    if (!current || current.deletedAt !== null) throw new AppError('NOT_FOUND', 'This item no longer exists.')
    if (current.revision !== expectedRevision) throw new AppError('REVISION_CONFLICT', 'This item changed elsewhere. Reload it before saving.')
    if ([...body].length > 50_000) throw new AppError('TASK_TOO_LONG', 'Tasks can contain up to 50,000 characters.')
    const categoryId = requestedCategoryId === undefined ? current.categoryId : requestedCategoryId
    if (categoryId && !this.db.prepare('SELECT id FROM categories WHERE id=?').get(categoryId)) throw new AppError('CATEGORY_MISSING', 'That category no longer exists.')
    const subcategoryId=requestedSubcategoryId===undefined ? (current.categoryId===categoryId?current.subcategoryId:null):requestedSubcategoryId
    this.validateSubcategory(categoryId,subcategoryId)
    const cleanTags = normalizeTags(tags)
    const now = Date.now()
    const transaction = this.db.transaction(() => {
      const movedTask = current.kind === 'task' && current.categoryId !== categoryId
      const priorityPosition = movedTask ? this.nextBacklogPosition(categoryId) : null
      const changed = this.db.prepare('UPDATE notes SET body=?,project_id=?,subcategory_id=?,backlog_position=coalesce(?,backlog_position),updated_at=?,revision=revision+1 WHERE id=? AND revision=? AND deleted_at IS NULL').run(body.replace(/\r\n?/g, '\n'), categoryId, subcategoryId, priorityPosition, now, id, expectedRevision)
      if (!changed.changes) throw new AppError('REVISION_CONFLICT', 'This item changed elsewhere. Reload it before saving.')
      if (images !== undefined) {
        if (images.length > 5 || new Set(images.map(image => image.id)).size !== images.length) throw new AppError('INVALID_IMAGE', 'Choose up to five distinct images.')
        const rows = images.map(image => {
          if (image.dataUrl !== undefined) return { id: randomUUID(), ...decodeImage(image.dataUrl) }
          const row = this.db.prepare('SELECT id,mime_type AS mimeType,data FROM item_images WHERE id=? AND note_id=?').get(image.id, id) as { id: string; mimeType: ImageRef['mimeType']; data: Buffer } | undefined
          if (!row) throw new AppError('INVALID_IMAGE', 'This attached image is no longer available.')
          return row
        })
        if (rows.reduce((total, row) => total + row.data.length, 0) > 20_000_000) throw new AppError('INVALID_IMAGE', 'Images can total up to 20 MB.')
        this.db.prepare('DELETE FROM item_images WHERE note_id=?').run(id)
        rows.forEach((row, position) => this.db.prepare('INSERT INTO item_images(id,note_id,position,mime_type,data) VALUES(?,?,?,?,?)').run(row.id, id, position, row.mimeType, row.data))
      }
      this.replaceItemTags(id, cleanTags, categoryId)
      this.syncSearch(id)
    })
    transaction()
    this.changeSequence++
    const updated = this.getItem(id)
    if (!updated) throw new AppError('NOT_FOUND', 'This item no longer exists.')
    return updated
  }

  private syncSearch(id: string) {
    const row = this.db.prepare('SELECT n.id,n.body,coalesce(m.title,\'\') AS title FROM notes n LEFT JOIN legacy_meeting_sessions m ON m.id=n.meeting_id WHERE n.id=?').get(id) as { id: string; body: string; title: string } | undefined
    this.db.prepare('DELETE FROM note_search WHERE note_id=?').run(id)
    if (row) this.db.prepare('INSERT INTO note_search(note_id,body,meeting_title) VALUES(?,?,?)').run(id, row.body, row.title)
  }

  trash(ids: string[]) { this.changeRows(ids, 'UPDATE notes SET deleted_at=?,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NULL', Date.now(), Date.now()) }
  restore(ids: string[]) {
    const now = Date.now()
    this.db.transaction(() => {
      const select = this.db.prepare('SELECT id,kind,project_id,backlog_position FROM notes WHERE id=? AND deleted_at IS NOT NULL')
      const restore = this.db.prepare('UPDATE notes SET deleted_at=NULL,updated_at=?,revision=revision+1 WHERE id=? AND deleted_at IS NOT NULL')
      for (const id of [...new Set(ids)]) {
        const row = select.get(id) as { id: string; kind: string; project_id: string | null; subcategory_id: string | null; backlog_position: number } | undefined
        if (!row) continue
        if (row.kind === 'task') {
          const collision = this.db.prepare("SELECT 1 FROM notes WHERE kind='task' AND task_status='open' AND deleted_at IS NULL AND project_id IS ? AND backlog_position=?").get(row.project_id, row.backlog_position)
          if (collision) this.db.prepare('UPDATE notes SET backlog_position=? WHERE id=?').run(this.nextBacklogPosition(row.project_id), id)
        }
        restore.run(now, id)
      }
    })()
    this.changeSequence++
  }
  permanentlyDelete(ids: string[]) {
    const transaction = this.db.transaction(() => { for (const id of ids) { this.db.prepare('DELETE FROM note_search WHERE note_id=?').run(id); this.db.prepare('DELETE FROM notes WHERE id=? AND deleted_at IS NOT NULL').run(id) } })
    transaction(); this.changeSequence++
  }
  emptyTrash() {
    const transaction = this.db.transaction(() => {
      this.db.prepare('DELETE FROM note_search WHERE note_id IN (SELECT id FROM notes WHERE deleted_at IS NOT NULL)').run()
      this.db.prepare('DELETE FROM notes WHERE deleted_at IS NOT NULL').run()
    })
    transaction(); this.changeSequence++
  }
  private changeRows(ids: string[], sql: string, ...common: number[]) {
    const transaction = this.db.transaction(() => { for (const id of ids) this.db.prepare(sql).run(...common, id) })
    transaction(); this.changeSequence++
  }

  getDraftText(ids: string[]) { return ids.map((id) => this.getItem(id)).filter((n): n is NonNullable<typeof n> => Boolean(n)).map((n) => n.body).join('\n\n') }

  taskExportMetadata(ids: string[]) {
    const metadata = new Map<string, { categoryName: string | null; subcategoryName:string|null; ready: boolean; plannedDate: string | null; plannedStartAt: number | null; plannedEndAt: number | null; intention?: TaskIntention }>()
    for (let offset = 0; offset < ids.length; offset += 500) {
      const batch = ids.slice(offset, offset + 500)
      if (!batch.length) continue
      const rows = this.db.prepare(`SELECT n.id,(SELECT json_object('kind',i.kind,'targetDate',i.target_date,'position',i.position) FROM task_intentions i WHERE i.note_id=n.id) AS intention_json,c.name AS category_name,s.name AS subcategory_name,n.task_ready,n.planned_date,n.planned_start_at,n.planned_end_at FROM notes n LEFT JOIN categories c ON c.id=n.project_id LEFT JOIN subcategories s ON s.id=n.subcategory_id WHERE n.id IN (${batch.map(() => '?').join(',')})`).all(...batch) as { id: string; intention_json: string | null; category_name: string | null; subcategory_name:string|null; task_ready: number; planned_date: string | null; planned_start_at: number | null; planned_end_at: number | null }[]
      for (const row of rows) metadata.set(row.id, { intention: row.intention_json ? JSON.parse(row.intention_json) : undefined, categoryName: row.category_name, subcategoryName:row.subcategory_name, ready: Boolean(row.task_ready), plannedDate: row.planned_date, plannedStartAt: row.planned_start_at, plannedEndAt: row.planned_end_at })
    }
    return metadata
  }

  recentItems(scope: 'all' | 'full' = 'all') {
    const deleted = scope === 'full' ? '' : 'WHERE n.deleted_at IS NULL'
    return this.db.prepare(`SELECT ${ITEM_PROJECTION} ${ITEM_FROM} ${deleted} ORDER BY n.created_at DESC,n.id DESC`).all() as ItemRow[]
  }
  legacyMeetingLabels() { return this.db.prepare('SELECT id,title,started_at,ended_at,created_at,updated_at FROM legacy_meeting_sessions ORDER BY started_at DESC').all() as { id: string; title: string; started_at: number; ended_at: number | null; created_at: number; updated_at: number }[] }
  backupTo(path: string) { return this.db.backup(path) }
  checkIntegrity(path?: string) {
    const database = path ? new Database(path, { readonly: true, fileMustExist: true }) : this.db
    try {
      const result = database.pragma('integrity_check') as { integrity_check: string }[]
      if (result.length !== 1 || result[0]?.integrity_check !== 'ok') throw new AppError('DB_CORRUPT', 'The selected backup failed its SQLite integrity check.')
      const version = database.prepare('SELECT max(version) AS version FROM schema_migrations').get() as { version: number | null }
      const required = ['notes', 'drafts', 'app_state', 'schema_migrations', 'note_search', ...(version.version && version.version >= 3 ? ['legacy_meeting_sessions', 'planner_events', 'item_tags', 'note_tags'] : ['meetings']), ...(version.version && version.version >= 4 ? ['item_images', 'capture_draft_images'] : []), ...(version.version && version.version >= 5 ? ['categories'] : []), ...(version.version && version.version >= 12 ? ['subcategories','taxonomy_migration_review','taxonomy_migration_mapping'] : []), ...(version.version && version.version >= 14 ? ['task_intentions'] : [])]
      const tables = new Set((database.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view')").all() as { name: string }[]).map((row) => row.name))
      if (required.some((name) => !tables.has(name))) throw new AppError('DB_INVALID_SCHEMA', 'The selected file is not a complete captured backup.')
      if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].includes(version.version ?? 0)) throw new AppError(version.version && version.version > 18 ? 'DB_NEWER_VERSION' : 'DB_INVALID_SCHEMA', 'This backup has an unsupported captured schema.')
      if ((database.pragma('foreign_key_check') as unknown[]).length) throw new AppError('DB_CORRUPT', 'The selected backup contains invalid note links.')
      if (version.version! >= 14) {
        if (!(database.pragma('table_info(drafts)') as { name: string }[]).some(column => column.name === 'capture_kind')) throw new AppError('DB_INVALID_SCHEMA', 'This backup is missing capture type storage.')
        const intentions = database.prepare('SELECT kind,target_date AS targetDate,position FROM task_intentions').all() as TaskIntention[]
        if (intentions.some(intention => !validIntention(intention)) || database.prepare("SELECT 1 FROM notes n LEFT JOIN task_intentions i ON i.note_id=n.id WHERE n.kind='task' AND i.note_id IS NULL LIMIT 1").get()) throw new AppError('DB_CORRUPT', 'This backup contains invalid task plans.')
      }
    } finally { if (path) database.close() }
  }
  replaceWith(path: string) {
    const stagingPath = `${this.path}.restore-stage-${randomUUID()}`
    const recoveryPath = `${this.path}.recovery-${randomUUID()}`
    fs.copyFileSync(path, stagingPath)
    this.checkIntegrity(stagingPath)
    for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${stagingPath}${suffix}`)) fs.unlinkSync(`${stagingPath}${suffix}`)
    this.db.pragma('wal_checkpoint(TRUNCATE)')
    this.db.close()
    let movedOriginal = false
    try {
      for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${this.path}${suffix}`)) fs.unlinkSync(`${this.path}${suffix}`)
      if (fs.existsSync(this.path)) { fs.renameSync(this.path, recoveryPath); movedOriginal = true }
      fs.renameSync(stagingPath, this.path)
      this.db = this.open(this.path)
      this.migrate()
      this.checkIntegrity()
      this.changeSequence++
    } catch (error) {
      try { this.db?.close() } catch { /* database may not have reopened */ }
      if (fs.existsSync(this.path)) fs.unlinkSync(this.path)
      for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${this.path}${suffix}`)) fs.unlinkSync(`${this.path}${suffix}`)
      if (movedOriginal && fs.existsSync(recoveryPath)) fs.renameSync(recoveryPath, this.path)
      this.db = this.open(this.path)
      this.migrate()
      throw error
    } finally {
      if (fs.existsSync(stagingPath)) fs.unlinkSync(stagingPath)
      for (const suffix of ['-wal', '-shm']) if (fs.existsSync(`${stagingPath}${suffix}`)) fs.unlinkSync(`${stagingPath}${suffix}`)
      if (fs.existsSync(recoveryPath)) fs.unlinkSync(recoveryPath)
    }
  }
  close() { this.db.pragma('wal_checkpoint(TRUNCATE)'); this.db.close() }
}
