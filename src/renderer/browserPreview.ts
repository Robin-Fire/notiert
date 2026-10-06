import type { Category, Subcategory, MigrationReview, ImageRef, Note, capturedApi, PlannerEvent, PlannerEventInput, DeletedPlannerEvent, PlannerTask, TagRecord } from '../shared/contracts'

import { meetingOccurrences } from '../shared/meetingRecurrence'
import { eventOverlapsLocalDay, localDateBounds } from '../shared/plannerDates'
import { CalendarHoursSchema, SettingsSchema, PlannerTaskCreateSchema, PlannerTaskScheduleSchema, PlannerEventTimingSchema, type SettingsUpdate, type PlannerTaskCreate, type PlannerTaskSchedule, type PlannerEventTiming, type Settings } from '../shared/contracts'
import { placementFields } from '../shared/calendarSchedule'

// Browser-only sample data. Electron supplies the real API and database.
type Item = (Note & { meetingTitle: null }) | PlannerTask
const now = Date.now()
const initialCategories: Category[] = [{ id: '11111111-1111-4111-8111-111111111111', name: 'Work' }, { id: '22222222-2222-4222-8222-222222222222', name: 'Personal' }]
const sample: Item[] = [
  { id: '14141414-1414-4414-8414-141414141414', body: 'Ideas for the next release\nKeep the capture flow quick and calm.', meetingId: null, meetingTitle: null, createdAt: now, updatedAt: now, deletedAt: null, revision: 1, kind: 'note', processedAt: now, completedAt: null, later: false, subcategoryId:null, categoryId: initialCategories[0]!.id, tags: ['Planning', 'Ideas'], images: [] },
  { id: '15151515-1515-4515-8515-151515151515', body: 'A thought to file later', meetingId: null, meetingTitle: null, createdAt: now, updatedAt: now, deletedAt: null, revision: 1, kind: 'inbox', processedAt: null, completedAt: null, later: false, subcategoryId:null, categoryId: null, tags: [], images: [] },
]
const initialTags: TagRecord[] = [
  { id: '33333333-3333-4333-8333-333333333333', name: 'Planning', categoryId: initialCategories[0]!.id, color: '#2563eb', count: 0 },
  { id: '44444444-4444-4444-8444-444444444444', name: 'Ideas', categoryId: initialCategories[0]!.id, color: '#e65b50', count: 0 },
  { id: '55555555-5555-4555-8555-555555555555', name: 'Home', categoryId: initialCategories[1]!.id, color: '#18824b', count: 0 },
]
const stored = (() => { try { return JSON.parse(localStorage.getItem('captured-browser-preview') ?? localStorage.getItem('notiert-browser-preview') ?? localStorage.getItem('notable-browser-preview') ?? 'null') as { items: Item[]; categories: Category[]; tags: TagRecord[]; subcategories?:Subcategory[]; reviews?:MigrationReview[]; events?: PlannerEvent[] } | null } catch { return null } })()
let items = stored?.items ?? sample
items = items.map((item) => ({ ...item, subcategoryId:item.subcategoryId??null, completedAt: 'completedAt' in item ? item.completedAt : null, later: 'later' in item ? item.later : false, categoryId: 'categoryId' in item ? item.categoryId : null })).map((item) => item.kind === 'task' ? { ...item, plannedStartAt: 'plannedStartAt' in item ? item.plannedStartAt : null, plannedEndAt: 'plannedEndAt' in item ? item.plannedEndAt : null, priorityPosition: 'priorityPosition' in item ? item.priorityPosition : 0, ready: 'ready' in item ? item.ready : Boolean('plannedDate' in item && item.plannedDate), later: 'later' in item ? item.later : false, position: 'position' in item ? item.position : 0, beforeEventId: 'beforeEventId' in item ? item.beforeEventId : null } as PlannerTask : item)
let events: PlannerEvent[] = stored?.events ?? []
const categories = stored?.categories ?? initialCategories
const tags = stored?.tags ?? initialTags
let subcategories:Subcategory[]=stored?.subcategories??tags.filter(tag=>tag.categoryId).map(tag=>({...tag,id:crypto.randomUUID(),categoryId:tag.categoryId!}))
let reviews:MigrationReview[]=stored?.reviews??[]
if(!stored?.subcategories){for(const item of items){const linked=tags.filter(tag=>tag.categoryId&&item.tags.includes(tag.name));const matching=linked.filter(tag=>tag.categoryId===item.categoryId);if(matching.length===1)item.subcategoryId=subcategories.find(sub=>sub.categoryId===item.categoryId&&sub.name===matching[0]!.name)!.id;if(matching.length>1||linked.some(tag=>tag.categoryId!==item.categoryId))reviews.push({noteId:item.id,reason:matching.length>1?'multiple-matching-subcategories':'foreign-category-labels',candidates:linked.map(tag=>subcategories.find(sub=>sub.name===tag.name&&sub.categoryId===tag.categoryId)!.id)})}tags.forEach(tag=>{tag.categoryId=null})}
const listeners = new Set<() => void>()
const listen = (callback: () => void) => { listeners.add(callback); return () => listeners.delete(callback) }
const taxonomyListeners = new Set<() => void>()
const taxonomySignature = () => JSON.stringify([categories, subcategories, tags, items.map(({ categoryId, subcategoryId, tags, deletedAt }) => ({ categoryId, subcategoryId, tags, deletedAt }))])
let previousTaxonomy = taxonomySignature()
const changed = () => {
  const signature = taxonomySignature()
  if (signature !== previousTaxonomy) { previousTaxonomy = signature; taxonomyListeners.forEach(callback => callback()) }
 localStorage.setItem('captured-browser-preview', JSON.stringify({ items, categories, subcategories, tags, events, reviews })); listeners.forEach((callback) => callback()) }
const ok = <T,>(value: T) => Promise.resolve({ ok: true as const, value })
const visible = () => items.filter((item) => item.deletedAt === null)
const tagList = () => tags.map((tag) => ({ ...tag, count: visible().filter((item) => item.tags.includes(tag.name)).length }))
const plannerTasks = () => visible().filter((item): item is PlannerTask => item.kind === 'task' && 'plannedDate' in item && item.completedAt === null)
const allPlannerTasks = () => visible().filter((item): item is PlannerTask => item.kind === 'task' && 'plannedDate' in item)
const nextPriority = (categoryId: string | null) => Math.max(-1, ...plannerTasks().filter((task) => task.categoryId === categoryId).map((task) => task.priorityPosition)) + 1
const assignCategory = (item: Item, categoryId: string | null) => {
  if (item.categoryId === categoryId) return
  if (item.kind === 'task') (item as PlannerTask).priorityPosition = nextPriority(categoryId)
  item.categoryId = categoryId; item.subcategoryId=null
}
const readyTasks = () => plannerTasks().filter((task) => task.ready && !task.plannedDate).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
const saveEvent = (input: PlannerEventInput) => {
  try {
    const occurrences = meetingOccurrences(input.startAt, input.endAt, input.recurrence)
    const saved = occurrences.map((times, index) => ({ id: index === 0 && input.id ? input.id : crypto.randomUUID(), title: input.title, ...times, allDay: input.allDay }))
    events = [...events.filter((event) => event.id !== input.id), ...saved]
    for (const task of plannerTasks()) {
      if (task.beforeEventId === input.id && task.plannedDate && !eventOverlapsLocalDay(saved[0]!.startAt, saved[0]!.endAt, task.plannedDate)) task.beforeEventId = null
    }
    changed(); return ok(saved[0]!)
  } catch (reason) { return Promise.resolve({ ok: false as const, code: 'INVALID_RECURRENCE', message: reason instanceof Error ? reason.message : 'The meeting could not be saved.' }) }
}
const settings: Settings = (() => {
  const defaults = { shortcut: 'Control+N', shortcutEnabled: true, shortcutRegistered: true, launchAtLogin: false, theme: 'light', monitor: 'active', captureProtection: false, protectionTestApp: '', protectionTestDate: '', protectionTestOS: '', lastBackupAt: null, backupWarning: false, firstRunComplete: true, closeToTray: true, calendarStartMinute: 480, calendarEndMinute: 1080 }
  try { const value = SettingsSchema.parse({ ...defaults, ...JSON.parse(localStorage.getItem('captured-preview-settings') ?? localStorage.getItem('notiert-preview-settings') ?? '{}') }); CalendarHoursSchema.parse(value); return value } catch { return SettingsSchema.parse(defaults) }
})()
const settingsListeners = new Set<() => void>()
const failure = (message: string, code = 'INVALID_INPUT') => Promise.resolve({ ok: false as const, code, message })
const scheduleTask = (raw: PlannerTaskSchedule) => {
  const parsed = PlannerTaskScheduleSchema.safeParse(raw)
  if (!parsed.success) return failure('Choose a valid task time range.')
  const input = parsed.data
  const task = plannerTasks().find((task) => task.id === input.id)
  if (!task) return failure('This open task no longer exists.', 'NOT_FOUND')
  if (task.revision !== input.expectedRevision) return failure('This task changed. Reload it and try again.', 'REVISION_CONFLICT')
  if (input.placement.kind === 'backlog-top') plannerTasks().filter((entry) => entry.id !== task.id && !entry.later && !entry.ready && !entry.plannedDate && entry.categoryId === task.categoryId).forEach((entry) => { entry.priorityPosition++ })
  Object.assign(task, placementFields(input.placement), { later: input.placement.kind === 'later', revision: task.revision + 1, updatedAt: Date.now(), position: input.placement.kind === 'ready' ? readyTasks().length : 0 })
  if (input.placement.kind === 'backlog') task.priorityPosition = nextPriority(task.categoryId)
  if (input.placement.kind === 'backlog-top') task.priorityPosition = 0
  changed(); return ok({ ...task })
}

const api = {
  updates: { getStatus: () => ok({ status: 'idle' as const }), check: () => ok(undefined), install: () => ok(undefined), onChanged: () => () => {} },
  capture: { submit: ({body,categoryId=null,subcategoryId=null,tags:labels=[]}:{body:string;categoryId?:string|null;subcategoryId?:string|null;tags?:string[]})=>{
    if(subcategoryId&&!subcategories.some(sub=>sub.id===subcategoryId&&sub.categoryId===categoryId))return failure('Invalid subcategory.')
    const id=crypto.randomUUID()
    for(const name of labels)if(!tags.some(tag=>tag.name.toLowerCase()===name.toLowerCase()))tags.push({id:crypto.randomUUID(),name,categoryId:null,color:'#85858e',count:0})
    items=[{id,body,meetingId:null,meetingTitle:null,createdAt:Date.now(),updatedAt:Date.now(),deletedAt:null,revision:1,kind:'inbox',processedAt:null,completedAt:null,later:false,subcategoryId,categoryId,tags:labels,images:[]},...items]
    changed();return ok({id})
  } },
  notes: {
    onTaxonomyChanged: (callback: () => void) => { taxonomyListeners.add(callback); return () => taxonomyListeners.delete(callback) },
    createSubcategory: ({name,categoryId}:{name:string;categoryId:string})=>{if(subcategories.some(item=>item.categoryId===categoryId&&item.name.toLowerCase()===name.trim().toLowerCase()))return failure('Subcategory already exists.');const item={id:crypto.randomUUID(),name:name.trim(),categoryId,color:'#85858e',count:0};subcategories.push(item);changed();return ok(item)},
    updateSubcategory:({id,name,color}:{id:string;name:string;color:string})=>{const item=subcategories.find(item=>item.id===id);if(!item)return failure('Subcategory no longer exists.');if(subcategories.some(other=>other.id!==id&&other.categoryId===item.categoryId&&other.name.toLowerCase()===name.trim().toLowerCase()))return failure('Subcategory already exists.');Object.assign(item,{name:name.trim(),color});changed();return ok(undefined)},
    deleteSubcategory:(id:string)=>{subcategories=subcategories.filter(item=>item.id!==id);items.forEach(item=>{if(item.subcategoryId===id)item.subcategoryId=null});changed();return ok(undefined)},
    reorderSubcategories:({categoryId,ids}:{categoryId:string;ids:string[]})=>{const group=subcategories.filter(item=>item.categoryId===categoryId);if(ids.length!==group.length||new Set(ids).size!==ids.length||ids.some(id=>!group.some(item=>item.id===id)))return failure('Subcategory list changed.');subcategories=[...subcategories.filter(item=>item.categoryId!==categoryId),...ids.map(id=>group.find(item=>item.id===id)!)];changed();return ok(undefined)},
    migrationStatus:()=>ok({upgraded:subcategories.length>0,acknowledged:(localStorage.getItem('captured-preview-taxonomy-ack') ?? localStorage.getItem('notiert-preview-taxonomy-ack'))==='true'}),acknowledgeMigration:()=>{localStorage.setItem('captured-preview-taxonomy-ack','true');return ok(undefined)},
    migrationReview:()=>ok(reviews.filter(row=>items.some(item=>item.id===row.noteId))),
    resolveMigrationReview:({id,expectedRevision,categoryId,subcategoryId}:{id:string;expectedRevision:number;categoryId?:string|null;subcategoryId:string|null})=>{const item=items.find(item=>item.id===id);if(!item||item.revision!==expectedRevision)return failure('Item changed. Reload it.');const category=categoryId===undefined?item.categoryId:categoryId;if(subcategoryId&&!subcategories.some(sub=>sub.id===subcategoryId&&sub.categoryId===category))return failure('Invalid subcategory.');assignCategory(item,category);item.subcategoryId=subcategoryId;item.revision++;reviews=reviews.filter(row=>row.noteId!==id);changed();return ok(undefined)},
    list: (filter: { scope: 'notes' | 'trash'; tags?: string[]; excludedTags?: string[]; kinds?: string[]; query?: string; categoryId?: string; subcategoryId?:string;noSubcategory?:boolean;needsReview?:boolean; sort?: string; includeCompleted?: boolean }) => { const found = items.filter((item) => (filter.scope === 'trash' ? item.deletedAt !== null : item.deletedAt === null && (filter.includeCompleted || item.completedAt === null)) && (!filter.categoryId || item.categoryId === filter.categoryId) && (!filter.subcategoryId||item.subcategoryId===filter.subcategoryId) && (!filter.noSubcategory||!item.subcategoryId) && (!filter.needsReview||reviews.some(row=>row.noteId===item.id)) && (!filter.tags?.length || filter.tags.some((tag) => item.tags.includes(tag))) && (!filter.excludedTags?.some(tag => item.tags.some(name => name.toLocaleLowerCase() === tag.toLocaleLowerCase()))) && (!filter.kinds?.length || filter.kinds.includes(item.kind)) && (!filter.query || item.body.toLowerCase().includes(filter.query.toLowerCase()))); if (filter.sort === 'priority') found.sort((a, b) => (a.kind === 'task' ? (a.completedAt === null ? 0 : 1) : 2) - (b.kind === 'task' ? (b.completedAt === null ? 0 : 1) : 2) || (a.kind === 'task' && b.kind === 'task' ? (a as PlannerTask).priorityPosition - (b as PlannerTask).priorityPosition : b.createdAt - a.createdAt)); return ok({ items: found, nextCursor: null, total: found.length }) },
    tags: () => ok(tags.map((tag) => tag.name)), taxonomy: () => ok({ categories: categories.map(category=>({...category,noSubcategoryCount:visible().filter(item=>item.categoryId===category.id&&!item.subcategoryId).length})), subcategories:subcategories.map(sub=>({...sub,count:visible().filter(item=>item.subcategoryId===sub.id).length})), tags: tagList() }),
    createCategory: (name: string) => { const category = { id: crypto.randomUUID(), name }; categories.push(category); changed(); return ok(category) },
    updateCategory: ({ id, name }: { id: string; name: string }) => { const category = categories.find((entry) => entry.id === id); if (!category) return failure('That category no longer exists.'); if (categories.some((entry) => entry.id !== id && entry.name.toLocaleLowerCase() === name.trim().toLocaleLowerCase())) return failure('That category already exists.'); category.name = name.trim().replace(/\s+/g, ' '); changed(); return ok({ ...category }) },
    deleteCategory: (id: string) => { const index = categories.findIndex((category) => category.id === id); if (index < 0) return failure('That category no longer exists.'); categories.splice(index, 1); subcategories=subcategories.filter(sub=>sub.categoryId!==id); tags.filter((tag) => tag.categoryId === id).forEach((tag) => { tag.categoryId = null }); items.forEach((item) => { if (item.categoryId === id) assignCategory(item, null) }); changed(); return ok(undefined) },
    reorderCategories: ({ ids }: { ids: string[] }) => { if (ids.length !== categories.length || new Set(ids).size !== ids.length || ids.some((id) => !categories.some((category) => category.id === id))) return failure('The category list changed. Refresh and try again.'); categories.splice(0, categories.length, ...ids.map((id) => categories.find((category) => category.id === id)!)); changed(); return ok(undefined) },
    reorderTags: ({ categoryId, ids }: { categoryId: string | null; ids: string[] }) => { const group = tags.filter((tag) => tag.categoryId === categoryId); if (ids.length !== group.length || new Set(ids).size !== ids.length || ids.some((id) => !group.some((tag) => tag.id === id))) return failure('The tag list changed. Refresh and try again.'); const ordered = ids.map((id) => group.find((tag) => tag.id === id)!); tags.splice(0, tags.length, ...tags.filter((tag) => tag.categoryId !== categoryId), ...ordered); changed(); return ok(undefined) },
    createTag: ({ name }: { name: string; categoryId?: string | null }) => { if(tags.some(tag=>tag.name.toLowerCase()===name.trim().toLowerCase()))return failure('Tag already exists.'); const tag = { id: crypto.randomUUID(), name, categoryId:null, color: '#85858e', count: 0 }; tags.push(tag); changed(); return ok(tag) },
    updateTag: ({id,name,color}:{id:string;name?:string;color:string})=>{const tag=tags.find(item=>item.id===id);if(tag){if(name&&tags.some(other=>other.id!==id&&other.name.toLowerCase()===name.toLowerCase()))return failure('Tag already exists.');if(name){const old=tag.name;tag.name=name;items.forEach(item=>{item.tags=item.tags.map(value=>value===old?name:value)})}tag.color=color}changed();return ok(undefined)},
    deleteTag: (id: string) => { const index = tags.findIndex((tag) => tag.id === id); if (index < 0) return failure('That tag no longer exists.'); const [tag] = tags.splice(index, 1); items.forEach((item) => { item.tags = item.tags.filter((name) => name.toLocaleLowerCase() !== tag!.name.toLocaleLowerCase()) }); changed(); return ok(undefined) },
    get: (id: string) => ok(items.find((item) => item.id === id) ?? null), image: (id: string) => ok((items.flatMap(item => item.images).find(image => image.id === id) as (ImageRef & { dataUrl?: string }) | undefined)?.dataUrl ?? ''),
    update: ({ id, body }: { id: string; body: string }) => { const item = items.find((entry) => entry.id === id)!; item.body = body; item.revision++; changed(); return ok(item) },
    updateItem: ({ id, body, tags: names, categoryId, subcategoryId, images }: { id: string; body: string; tags: string[]; categoryId?: string | null; subcategoryId?:string|null; images?: (ImageRef & { dataUrl?: string })[] }) => { const item = items.find((entry) => entry.id === id)!; item.body = body; item.tags = names; if (images !== undefined) item.images = images; if (categoryId !== undefined) assignCategory(item, categoryId); if(subcategoryId!==undefined)item.subcategoryId=subcategoryId; item.revision++; changed(); return ok(item) },
    setCategory: ({ id, categoryId,subcategoryId }: { id: string; categoryId: string | null;subcategoryId?:string|null }) => { const item = items.find((entry) => entry.id === id); if (item) {assignCategory(item, categoryId);if(subcategoryId!==undefined)item.subcategoryId=subcategoryId} changed(); return ok(undefined) },
    setTags: ({ id, tags: names }: { id: string; tags: string[] }) => { const item = items.find((entry) => entry.id === id); if (item) item.tags = names; changed(); return ok(undefined) },
    trash: (ids: string[]) => { items.filter((item) => ids.includes(item.id)).forEach((item) => { item.deletedAt = Date.now() }); changed(); return ok(undefined) },
    restore: (ids: string[]) => { items.filter((item) => ids.includes(item.id)).forEach((item) => { item.deletedAt = null }); changed(); return ok(undefined) },
    deletePermanently: (ids: string[]) => { items = items.filter((item) => !ids.includes(item.id)); changed(); return ok(undefined) },
    emptyTrash: () => { items = visible(); changed(); return ok(undefined) }, copy: (ids: string[]) => ok(items.filter((item) => ids.includes(item.id)).map((item) => item.body).join('\n')), onChanged: listen,
  },
  planner: {
    backlogSummary: (later: boolean) => {
      const summary: import('../shared/contracts').PlannerBacklogSummary = {}
      for (const task of plannerTasks().filter(task => task.later === later && !task.ready && !task.plannedDate)) {
        const group = summary[task.categoryId ?? 'unassigned'] ??= { total: 0, subcategoryCounts: {} }
        group.total++
        const subcategoryId = task.subcategoryId ?? ''
        group.subcategoryCounts[subcategoryId] = (group.subcategoryCounts[subcategoryId] ?? 0) + 1
      }
      return ok(summary)
    },
    scheduleTask,
    createTask: (raw: PlannerTaskCreate) => {
      const parsed = PlannerTaskCreateSchema.safeParse(raw)
      if (!parsed.success) return failure('Choose valid task details and times.')
      const input = parsed.data, timestamp = Date.now()
      const task: PlannerTask = { id: crypto.randomUUID(), body: input.body, meetingId: null, meetingTitle: null, createdAt: timestamp, updatedAt: timestamp, deletedAt: null, revision: 1, kind: 'task', processedAt: timestamp, completedAt: null, later: input.placement.kind === 'later', subcategoryId:input.subcategoryId??null, categoryId: input.categoryId, tags: input.tags, images: [], ...placementFields(input.placement), priorityPosition: nextPriority(input.categoryId), position: readyTasks().length }
      if (input.placement.kind === 'backlog-top') { plannerTasks().filter((entry) => !entry.later && !entry.ready && !entry.plannedDate && entry.categoryId === input.categoryId).forEach((entry) => { entry.priorityPosition++ }); task.priorityPosition = 0 }
      for (const name of input.tags) if (!tags.some((tag) => tag.name.toLocaleLowerCase() === name.toLocaleLowerCase())) tags.push({ id: crypto.randomUUID(), name, categoryId: null, color: '#85858e', count: 0 })
      items.push(task); changed(); return ok({ ...task })
    },
    updateEventTiming: (raw: PlannerEventTiming) => {
      const parsed = PlannerEventTimingSchema.safeParse(raw)
      if (!parsed.success) return failure('Choose valid meeting times.')
      const input = parsed.data, current = events.find((event) => event.id === input.id)
      if (!current) return failure('This meeting no longer exists.', 'NOT_FOUND')
      if (current.startAt !== input.expectedStartAt || current.endAt !== input.expectedEndAt || current.allDay !== input.expectedAllDay) return failure('This meeting changed. Reload it and try again.', 'REVISION_CONFLICT')
      return saveEvent({ id: input.id, title: current.title, startAt: input.startAt, endAt: input.endAt, allDay: input.allDay })
    },
    inbox: () => { const inbox = visible().filter((item) => item.kind === 'inbox'); return ok({ items: inbox, nextCursor: null, total: inbox.length }) },
    inboxCount: () => ok(visible().filter((item) => item.kind === 'inbox').length),
    unfile: (id: string) => { const item = items.find((entry) => entry.id === id); if (item) Object.assign(item, { kind: 'inbox', plannedDate: null, plannedStartAt: null, plannedEndAt: null, ready: false, later: false, beforeEventId: null, revision: item.revision + 1 }); changed(); return ok(undefined) },
    classify: ({ id, kind, tags: names, categoryId,subcategoryId }: { id: string; kind: 'note' | 'task'; tags: string[]; categoryId?: string | null;subcategoryId?:string|null }) => { const item = items.find((entry) => entry.id === id); if (item) { const effectiveCategory = categoryId === undefined ? item.categoryId : categoryId; Object.assign(item, { kind, tags: names, categoryId: effectiveCategory, subcategoryId:subcategoryId??(effectiveCategory===item.categoryId?item.subcategoryId:null), processedAt: Date.now(), ...(kind === 'task' ? { plannedDate: null, plannedStartAt: null, plannedEndAt: null, beforeEventId: null, position: visible().filter((entry) => entry.kind === 'task').length, priorityPosition: nextPriority(effectiveCategory), ready: false } : {}) }) }; for (const name of names) if (!tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) tags.push({ id: crypto.randomUUID(), name, categoryId: null, color: '#85858e', count: 0 }); changed(); return ok(undefined) },
    tasks: (from: string, to: string) => {
      const start = localDateBounds(from).start, end = localDateBounds(to).end
      const found = allPlannerTasks().filter((task) => task.later ? false : task.plannedStartAt !== null && task.plannedEndAt !== null
        ? (task.plannedStartAt < end && task.plannedEndAt > start) || (task.completedAt === null && task.plannedEndAt <= start)
        : task.completedAt === null ? task.plannedDate ? task.plannedDate <= to : task.ready : task.plannedDate !== null && task.plannedDate >= from && task.plannedDate <= to)
      return ok({ tasks: found.map((task) => ({ ...task })), events: events.filter((event) => event.startAt < end && event.endAt > start).sort((a, b) => a.startAt - b.startAt).map((event) => ({ ...event })), tags: tags.map((tag) => tag.name) })
    },
    backlog: ({ categoryId = null, query = '', subcategoryIds,includeNoSubcategory, tagNames, excludedTags, includeUntagged, cursor, limit = 50, later = false, countsOnly = false }: { categoryId?: string | null; query?: string; subcategoryIds?:string[];includeNoSubcategory?:boolean; tagNames?: string[]; excludedTags?: string[]; includeUntagged?: boolean; cursor?: { priorityPosition: number; id: string }; limit?: number; later?: boolean; countsOnly?: boolean } = {}) => {
      const normalized = query.trim().toLocaleLowerCase()
      const hasTagFilter = tagNames !== undefined || includeUntagged !== undefined
      const subcategoryCounts: Record<string, number> = {}
      for (const task of plannerTasks().filter(task => task.later === later && !task.ready && !task.plannedDate && task.categoryId === categoryId)) {
        const id = task.subcategoryId ?? ''
        subcategoryCounts[id] = (subcategoryCounts[id] ?? 0) + 1
      }
      const found = plannerTasks().filter((task) => task.later === later && !task.ready && !task.plannedDate && task.categoryId === categoryId && ((subcategoryIds===undefined&&includeNoSubcategory===undefined)||!!(task.subcategoryId&&subcategoryIds?.includes(task.subcategoryId))||!!(!task.subcategoryId&&includeNoSubcategory)) && (!hasTagFilter || Boolean(tagNames?.some((tag) => task.tags.some((name) => name.toLowerCase() === tag.toLowerCase())) || (includeUntagged && task.tags.length === 0))) && (!excludedTags?.some(tag => task.tags.some(name => name.toLocaleLowerCase() === tag.toLocaleLowerCase()))) && (!normalized || `${task.body} ${task.tags.join(' ')}`.toLocaleLowerCase().includes(normalized))).sort((a, b) => a.priorityPosition - b.priorityPosition || a.id.localeCompare(b.id))
      const remaining = cursor ? found.filter((task) => task.priorityPosition > cursor.priorityPosition || (task.priorityPosition === cursor.priorityPosition && task.id > cursor.id)) : found
      const page = countsOnly ? [] : remaining.slice(0, limit)
      const last = page.at(-1)
      return ok({ items: page, nextCursor: !countsOnly && remaining.length > limit && last ? { priorityPosition: last.priorityPosition, id: last.id } : null, total: found.length, subcategoryCounts })
    },
    setReady: ({ id }: { id: string }) => {
      const task = items.find((item) => item.id === id && item.kind === 'task') as PlannerTask | undefined
      if (!task || task.deletedAt !== null) return failure('This task no longer exists.', 'NOT_FOUND')
      if (task.completedAt !== null) return failure('Reopen this task before adding it to Ready.')
      task.position = Math.max(-1, ...readyTasks().filter((entry) => entry.id !== id).map((entry) => entry.position)) + 1; task.ready = true; task.later = false; task.plannedDate = null; task.plannedStartAt = null; task.plannedEndAt = null; task.beforeEventId = null; task.revision++; task.updatedAt = Date.now()
      changed(); return ok(undefined)
    },
    setTaskCompleted: ({ id, completed }: { id: string; completed: boolean }) => {
      const task = allPlannerTasks().find((entry) => entry.id === id)
      if (task && (task.completedAt === null) !== completed) {
        if (completed) { task.completedAt = Date.now(); task.ready = false; task.later = false }
        else { task.completedAt = null; task.later = false; task.priorityPosition = nextPriority(task.categoryId); task.plannedDate = null; task.plannedStartAt = null; task.plannedEndAt = null; task.beforeEventId = null; task.ready = false; task.position = 0 }
      }
      changed(); return ok(undefined)
    },
    reorderBacklog: ({ id, categoryId, beforeId }: { id: string; categoryId: string | null; beforeId: string | null }) => {
      const ordered = plannerTasks().filter((task) => !task.later && !task.ready && !task.plannedDate && task.categoryId === categoryId).sort((a, b) => a.priorityPosition - b.priorityPosition || a.id.localeCompare(b.id))
      const ids = ordered.map((task) => task.id)
      const oldIndex = ids.indexOf(id)
      if (oldIndex < 0) return ok(undefined)
      ids.splice(oldIndex, 1)
      const index = beforeId ? ids.indexOf(beforeId) : ids.length
      ids.splice(index < 0 ? ids.length : index, 0, id)
      ids.forEach((taskId, priorityPosition) => { const task = plannerTasks().find((entry) => entry.id === taskId); if (task) task.priorityPosition = priorityPosition })
      changed(); return ok(undefined)
    },
    move: ({ id, plannedDate, beforeEventId, beforeId }: { id: string; plannedDate: string | null; beforeEventId: string | null; beforeId: string | null }) => {
      const task = plannerTasks().find((entry) => entry.id === id)
      if (task) {
        const sourceDate = task.plannedDate
        const sourceEventId = task.beforeEventId
        const sourceWasReady = task.ready
        const sameSlot = plannerTasks().filter((entry) => entry.id !== id && entry.plannedDate === plannedDate && entry.beforeEventId === beforeEventId && (plannedDate !== null || entry.ready)).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
        task.plannedDate = plannedDate; task.plannedStartAt = null; task.plannedEndAt = null; task.revision++; task.beforeEventId = beforeEventId; task.ready = true; task.later = false
        const ids = sameSlot.map((entry) => entry.id)
        const index = beforeId ? ids.indexOf(beforeId) : -1
        ids.splice(index < 0 ? ids.length : index, 0, id)
        for (const [position, taskId] of ids.entries()) {
          const entry = plannerTasks().find((candidate) => candidate.id === taskId)
          if (entry) entry.position = position
        }
        if ((sourceDate !== null || sourceWasReady) && (sourceDate !== plannedDate || sourceEventId !== beforeEventId)) {
          const sourceSlot = plannerTasks().filter((entry) => entry.id !== id && entry.plannedDate === sourceDate && entry.beforeEventId === sourceEventId && (sourceDate !== null || entry.ready)).sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
          sourceSlot.forEach((entry, position) => { entry.position = position })
        }
      }
      changed(); return ok(undefined)
    },
    createEvent: saveEvent,
    updateEvent: saveEvent,
    deleteEvent: (id: string) => {
      const event = events.find((entry) => entry.id === id)
      if (!event) return Promise.resolve({ ok: false as const, code: 'NOT_FOUND', message: 'This meeting no longer exists.' })
      const anchors = plannerTasks().filter((task) => task.beforeEventId === id).map((task) => ({ id: task.id, plannedDate: task.plannedDate, position: task.position }))
      plannerTasks().filter((task) => task.beforeEventId === id).forEach((task) => { task.beforeEventId = null })
      events = events.filter((entry) => entry.id !== id)
      changed(); return ok({ event, anchors })
    },
    undoDeleteEvent: ({ event, anchors }: DeletedPlannerEvent) => {
      events.push(event)
      for (const anchor of anchors) {
        const task = plannerTasks().find((entry) => entry.id === anchor.id && entry.plannedDate === anchor.plannedDate && entry.beforeEventId === null)
        if (task) { task.beforeEventId = event.id; task.position = anchor.position }
      }
      changed(); return ok(undefined)
    }, onChanged: listen,
  },
  settings: { get: () => ok({ ...settings }), displays: () => ok([]), update: (input: SettingsUpdate) => {
    const next = SettingsSchema.safeParse({ ...settings, ...input })
    if (!next.success || !CalendarHoursSchema.safeParse(next.data).success) return failure('Calendar end time must be after start time.')
    Object.assign(settings, next.data); localStorage.setItem('captured-preview-settings', JSON.stringify(settings)); settingsListeners.forEach((listener) => listener()); return ok({ ...settings })
  }, onChanged: (listener: () => void) => { settingsListeners.add(listener); return () => settingsListeners.delete(listener) }, openFolder: () => ok(undefined) },
  data: { export: () => ok(undefined), backup: () => ok(undefined), restore: () => ok(undefined), diagnostics: () => ok(undefined) },
  windows: { openCapture(context?:{categoryId:string|null;subcategoryId?:string|null;tags?:string[]}) { window.dispatchEvent(new window.CustomEvent('captured:browser-capture',{detail:context})) }, openNotes() {}, openSettings() {}, quit() {}, ready() {}, onView: () => () => {} },
} as unknown as capturedApi

Object.defineProperty(window, 'captured', { value: api, configurable: true, writable: true })
