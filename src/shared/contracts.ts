import type { z } from 'zod'
import { z as Z } from 'zod'
import { validIntention, type TaskIntention, type Horizon } from './taskHorizons'

export const TaskIntentionSchema = Z.object({ kind: Z.enum(['unplanned', 'day', 'week', 'later']), targetDate: Z.string().nullable(), position: Z.number().int().nonnegative().default(0) }).refine(validIntention, 'Choose a valid day or Monday week anchor.')
export const TaskWorkspaceCreateSchema = Z.object({ body: Z.string().trim().min(1).max(50000), categoryId: Z.string().uuid().nullable(), subcategoryId: Z.string().uuid().nullable().default(null), tags: Z.array(Z.string().max(40)).max(20).default([]), intention: TaskIntentionSchema })
export const TasksQuerySchema = Z.object({ today: Z.string(), query: Z.string().max(500).default(''), categoryId: Z.string().uuid().nullable().optional(), subcategoryId: Z.string().uuid().optional(), tags: Z.array(Z.string().max(40)).max(100).default([]), excludedTags: Z.array(Z.string().max(40)).max(100).default([]), completed: Z.boolean().default(false), horizon: Z.enum(['unplanned', 'today', 'tomorrow', 'week', 'next-week', 'later', 'upcoming']).optional(), cursor: Z.object({ position: Z.number().int().nonnegative(), id: Z.string(), sequence: Z.number().int(), today: Z.string() }).optional(), limit: Z.number().int().min(1).max(100).default(50) })
export const TaskWorkspaceMoveSchema = Z.object({ id: Z.string().uuid(), expectedRevision: Z.number().int().nonnegative(), intention: TaskIntentionSchema, beforeId: Z.string().uuid().nullable().default(null), categoryId: Z.string().uuid().nullable().optional(), today: Z.string(), classify: Z.enum(['task', 'note']).optional(), tags: Z.array(Z.string().max(40)).max(20).optional() })
export type TaskWorkspaceMove = z.infer<typeof TaskWorkspaceMoveSchema>
export type TasksQuery = z.infer<typeof TasksQuerySchema>
export type TaskWorkspaceItem = PlannerTask & { intention: TaskIntention; horizon: Horizon }
export type TasksPage = { items: TaskWorkspaceItem[]; total: number; counts: Record<Horizon, number>; categoryCounts?: Record<string, number>; captureTotal?: number; nextCursor: z.infer<typeof TasksQuerySchema>['cursor'] | null }
export type TaskWorkspaceUndo = { id: string; expectedRevision: number; kind: 'inbox' | 'task'; categoryId: string | null; subcategoryId: string | null; tags: string[]; intention: TaskIntention | null; beforeId?: string | null; today?: string; priorityPosition?: number }
export const TaskWorkspaceUndoSchema = Z.object({ id: Z.string().uuid(), expectedRevision: Z.number().int().nonnegative(), kind: Z.enum(['inbox', 'task']), categoryId: Z.string().uuid().nullable(), subcategoryId: Z.string().uuid().nullable(), tags: Z.array(Z.string().max(40)).max(20), intention: TaskIntentionSchema.nullable(), beforeId: Z.string().uuid().nullable().optional(), today: Z.string().optional(), priorityPosition: Z.number().int().nonnegative().optional() })

export const ImageRefSchema = Z.object({ id: Z.string().uuid(), mimeType: Z.enum(['image/png', 'image/jpeg', 'image/webp', 'image/gif']) })
export type ImageRef = z.infer<typeof ImageRefSchema>
export type CaptureImage = ImageRef & { dataUrl: string }
export const NoteSchema = Z.object({
  id: Z.string(), body: Z.string(), meetingId: Z.string().nullable(), createdAt: Z.number(), updatedAt: Z.number(),
  deletedAt: Z.number().nullable(), revision: Z.number(), kind: Z.enum(['inbox', 'note', 'task']).default('note'),
  processedAt: Z.number().nullable().default(null), completedAt: Z.number().nullable().default(null), later: Z.boolean().default(false), categoryId: Z.string().nullable().default(null), subcategoryId: Z.string().nullable().default(null), tags: Z.array(Z.string()).default([]), images: Z.array(ImageRefSchema).default([]), intention: TaskIntentionSchema.optional(),
})
export const PlannerEventSchema = Z.object({ id: Z.string(), title: Z.string(), startAt: Z.number(), endAt: Z.number(), allDay: Z.boolean(), seriesId: Z.string().uuid().nullable().optional() })
export const PlannerTaskSchema = NoteSchema.extend({ meetingTitle: Z.string().nullable(), plannedDate: Z.string().nullable(), plannedStartAt: Z.number().nullable().default(null), plannedEndAt: Z.number().nullable().default(null), position: Z.number(), priorityPosition: Z.number().int().nonnegative(), beforeEventId: Z.string().nullable(), ready: Z.boolean() })
const CalendarInstantSchema = Z.number().int().min(-8640000000000000).max(8640000000000000)
export const TaskPlacementSchema = Z.discriminatedUnion('kind', [
  Z.object({ kind: Z.literal('timed'), startAt: CalendarInstantSchema, endAt: CalendarInstantSchema }).refine((value) => value.endAt > value.startAt, 'End time must be after start time.'),
  Z.object({ kind: Z.literal('ready') }), Z.object({ kind: Z.literal('backlog') }), Z.object({ kind: Z.literal('backlog-top') }), Z.object({ kind: Z.literal('later') }),
])
export const PlannerTaskScheduleSchema = Z.object({ id: Z.string().uuid(), expectedRevision: Z.number().int().nonnegative(), placement: TaskPlacementSchema })
export const PlannerTaskCreateSchema = Z.object({ body: Z.string().trim().min(1).max(50000), categoryId: Z.string().uuid().nullable().default(null), subcategoryId: Z.string().uuid().nullable().optional(), tags: Z.array(Z.string().max(40)).max(20).default([]), placement: TaskPlacementSchema })
export const PlannerEventTimingSchema = Z.object({ id: Z.string().uuid(), startAt: CalendarInstantSchema, endAt: CalendarInstantSchema, allDay: Z.boolean(), expectedStartAt: CalendarInstantSchema, expectedEndAt: CalendarInstantSchema, expectedAllDay: Z.boolean() }).refine((value) => value.endAt > value.startAt, 'End time must be after start time.')
export const ClassifyItemSchema = Z.object({ id: Z.string().uuid(), kind: Z.enum(['note', 'task']), tags: Z.array(Z.string().max(40)).max(20), categoryId: Z.string().uuid().nullable().optional(), subcategoryId: Z.string().uuid().nullable().optional() })
export const PlannerReadySchema = Z.object({ id: Z.string().uuid() })
export const PlannerCompleteSchema = Z.object({ id: Z.string().uuid(), completed: Z.boolean() })
export const PlannerCategorySchema = Z.object({ id: Z.string().uuid(), categoryId: Z.string().uuid().nullable(), subcategoryId: Z.string().uuid().nullable().optional() })
export const ItemCategorySchema = PlannerCategorySchema
export const PlannerMoveSchema = Z.object({ id: Z.string().uuid(), plannedDate: Z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(), beforeEventId: Z.string().uuid().nullable(), beforeId: Z.string().uuid().nullable() })
export const PlannerQuerySchema = Z.object({ from: Z.string(), to: Z.string() })
export const PlannerBacklogQuerySchema = Z.object({
  categoryId: Z.string().uuid().nullable().default(null),
  query: Z.string().max(500).default(''),
  subcategoryIds: Z.array(Z.string().uuid()).max(1000).optional(),
  includeNoSubcategory: Z.boolean().optional(),
  tagNames: Z.array(Z.string().max(40)).max(1000).optional(),
  excludedTags: Z.array(Z.string().max(40)).max(1000).optional(),
  includeUntagged: Z.boolean().optional(),
  cursor: Z.object({ priorityPosition: Z.number().int().nonnegative(), id: Z.string().uuid() }).optional(),
  limit: Z.number().int().min(1).max(100).default(50),
  later: Z.boolean().default(false),
  countsOnly: Z.boolean().optional(),
})
export const PlannerBacklogReorderSchema = Z.object({ id: Z.string().uuid(), categoryId: Z.string().uuid().nullable(), beforeId: Z.string().uuid().nullable() })
export const PlannerEventInputSchema = Z.object({ id: Z.string().uuid().optional(), title: Z.string().trim().min(1).max(120), startAt: Z.number().int(), endAt: Z.number().int(), allDay: Z.boolean(), recurrence: Z.object({ frequency: Z.enum(['daily', 'weekly', 'monthly']), until: Z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).optional() }).refine((event) => event.endAt > event.startAt, 'End time must be after start time.')
const DeletedOccurrenceSchema = Z.object({
  event: PlannerEventSchema.extend({ id: Z.string().uuid() }),
  anchors: Z.array(Z.object({ id: Z.string().uuid(), plannedDate: Z.string().nullable(), position: Z.number().int().nonnegative() })).max(10000),
})
export const DeletedPlannerEventSchema = DeletedOccurrenceSchema.extend({ additional: Z.array(DeletedOccurrenceSchema).max(365).optional() })
export const SettingsSchema = Z.object({
  shortcut: Z.string(), shortcutEnabled: Z.boolean(), shortcutRegistered: Z.boolean(), launchAtLogin: Z.boolean(), theme: Z.enum(['system', 'light', 'dark']),
  monitor: Z.string(), captureProtection: Z.boolean(), protectionTestApp: Z.string(), protectionTestDate: Z.string(),
  protectionTestOS: Z.string(), lastBackupAt: Z.number().nullable(), backupWarning: Z.boolean(), firstRunComplete: Z.boolean(), closeToTray: Z.boolean(),
  calendarStartMinute: Z.number().int().min(0).max(1425).multipleOf(15).default(480),
  calendarEndMinute: Z.number().int().min(15).max(1440).multipleOf(15).default(1080),
})
export const CalendarHoursSchema = SettingsSchema.pick({ calendarStartMinute: true, calendarEndMinute: true }).refine((value) => value.calendarEndMinute > value.calendarStartMinute, 'Calendar end time must be after start time.')
// Optional patches must not apply field defaults when changing unrelated settings.
export const SettingsPatchSchema = SettingsSchema.partial().extend({
  calendarStartMinute: Z.number().int().min(0).max(1425).multipleOf(15).optional(),
  calendarEndMinute: Z.number().int().min(15).max(1440).multipleOf(15).optional(),
})
export const NoteFilterSchema = Z.object({
  query: Z.string().max(500).default(''), scope: Z.enum(['notes', 'trash']), sort: Z.enum(['newest', 'oldest', 'priority']).default('newest'),
  categoryId: Z.string().uuid().optional(),
  subcategoryId: Z.string().uuid().optional(),
  noSubcategory: Z.boolean().optional(),
  needsReview: Z.boolean().optional(),
  dateFrom: Z.number().optional(), dateTo: Z.number().optional(),
  kinds: Z.array(Z.enum(['inbox', 'note', 'task'])).max(3).optional(), tags: Z.array(Z.string().max(40)).max(10000).optional(),
  excludedTags: Z.array(Z.string().max(40)).max(1000).optional(),
  includeCompleted: Z.boolean().default(false),
  cursor: Z.object({ sortAt: Z.number(), id: Z.string(), priorityPosition: Z.number().int().nonnegative().optional(), kindRank: Z.number().int().min(0).max(2).optional() }).optional(), limit: Z.number().int().min(1).max(100).default(50),
})
export const CaptureSubmitSchema = Z.object({ requestId: Z.string().uuid(), generation: Z.number().int().nonnegative(), body: Z.string().max(100000), tags:Z.array(Z.string().max(40)).max(20).optional(), categoryId: Z.string().uuid().nullable().optional(), subcategoryId: Z.string().uuid().nullable().optional(), captureKind: Z.enum(['inbox', 'task', 'note']).optional() })
export const NoteUpdateSchema = Z.object({ id: Z.string().uuid(), expectedRevision: Z.number().int(), body: Z.string().max(100000) })
export const IdsSchema = Z.array(Z.string().uuid()).min(1).max(500)
export const InboxPageSchema = Z.object({ cursor: Z.object({ sortAt: Z.number().int(), id: Z.string().uuid() }).optional(), limit: Z.number().int().min(1).max(100).default(50) })
export const CategoryNameSchema = Z.string().trim().min(1).max(60)
export const TagNameSchema = Z.string().trim().min(1).max(40)
export const TagUpdateSchema = Z.object({ id: Z.string().uuid(), categoryId: Z.string().uuid().nullable(), color: Z.string().regex(/^#[0-9a-fA-F]{6}$/), name: Z.string().trim().min(1).max(40).optional() })
export const CategoryUpdateSchema = Z.object({ id: Z.string().uuid(), name: CategoryNameSchema })
export const CategoriesReorderSchema = Z.object({ ids: Z.array(Z.string().uuid()).max(1000) })
export const TagsReorderSchema = Z.object({ categoryId: Z.string().uuid().nullable(), ids: Z.array(Z.string().uuid()).max(1000) })

export type Note = z.infer<typeof NoteSchema>
export type PlannerEvent = z.infer<typeof PlannerEventSchema>
export type PlannerEventInput = z.infer<typeof PlannerEventInputSchema>
export type DeletedPlannerEvent = z.infer<typeof DeletedPlannerEventSchema>
export type PlannerTask = z.infer<typeof PlannerTaskSchema>
export type TaskPlacement = z.infer<typeof TaskPlacementSchema>
export type PlannerTaskSchedule = z.infer<typeof PlannerTaskScheduleSchema>
export type PlannerTaskCreate = z.infer<typeof PlannerTaskCreateSchema>
export type PlannerEventTiming = z.infer<typeof PlannerEventTimingSchema>
export type Settings = z.infer<typeof SettingsSchema>
export type SettingsUpdate = Partial<Pick<Settings, 'shortcut' | 'shortcutEnabled' | 'launchAtLogin' | 'theme' | 'monitor' | 'captureProtection' | 'protectionTestApp' | 'protectionTestDate' | 'closeToTray' | 'firstRunComplete' | 'calendarStartMinute' | 'calendarEndMinute'>>
export type NoteFilter = z.infer<typeof NoteFilterSchema>
export type CaptureState = { body: string; images: CaptureImage[]; generation: number; revision: number; shortcut: string; theme: Settings['theme']; available: boolean; captureKind?: 'inbox' | 'task' | 'note'; tags?:string[]; categoryId: string | null; subcategoryId?: string | null }
export type ApiResult<T> = { ok: true; value: T } | { ok: false; code: string; message: string }
export type NotePage = { items: (Note & { meetingTitle: string | null })[]; nextCursor: { sortAt: number; id: string; priorityPosition?: number; kindRank?: number } | null; total: number }
export type InboxPage = { items: (Note & { meetingTitle: string | null })[]; nextCursor: { sortAt: number; id: string } | null; total: number }
export type PlannerBacklogPage = { items: PlannerTask[]; nextCursor: { priorityPosition: number; id: string } | null; total: number; subcategoryCounts: Record<string, number> }
export type PlannerBacklogSummary = Record<string, { total: number; subcategoryCounts: Record<string, number> }>
export type Category = { id: string; name: string; noSubcategoryCount?: number }
export type Subcategory = { id: string; name: string; categoryId: string; color: string; count: number }
export type MigrationReview = { noteId: string; reason: string; candidates: string[] }
export type TagRecord = { id: string; name: string; categoryId: string | null; color: string; count: number }

export type capturedApi = {
  taskWorkspace: {
    list(input: TasksQuery): Promise<ApiResult<TasksPage>>
    move(input: TaskWorkspaceMove): Promise<ApiResult<TaskWorkspaceUndo>>
    undo(input: TaskWorkspaceUndo): Promise<ApiResult<void>>
    create(input: z.input<typeof TaskWorkspaceCreateSchema>): Promise<ApiResult<void>>
  }
  updates: {
    getStatus(): Promise<ApiResult<{ status: 'idle' | 'checking' | 'available' | 'downloaded' | 'error'; version?: string; message?: string }>>
    check(): Promise<ApiResult<void>>
    install(): Promise<ApiResult<void>>
    onChanged(callback: (status: { status: 'idle' | 'checking' | 'available' | 'downloaded' | 'error'; version?: string; message?: string }) => void): () => void
  }
  capture: {
    getState(): Promise<ApiResult<CaptureState>>
    categories(): Promise<ApiResult<Category[]>>
    subcategories(): Promise<ApiResult<Subcategory[]>>
    updateDraft(input: { body: string; generation: number; revision: number; categoryId: string | null; subcategoryId?: string | null; tags?:string[]; captureKind?: 'inbox' | 'task' | 'note' }): Promise<ApiResult<{ revision: number }>>
    flushBeforeQuit(input: { body: string; generation: number; revision: number; categoryId: string | null; subcategoryId?: string | null; tags?:string[]; captureKind?: 'inbox' | 'task' | 'note' }): Promise<ApiResult<{ revision: number }>>
    submit(input: z.infer<typeof CaptureSubmitSchema>): Promise<ApiResult<{ id: string }>>
    addImage(input: { generation: number; dataUrl: string }): Promise<ApiResult<CaptureImage>>
    removeImage(input: { generation: number; id: string }): Promise<ApiResult<void>>
    dismiss(reason: 'escape' | 'blur' | 'saved'): Promise<ApiResult<void>>
    resize(height: number): void
    onState(callback: (state: Partial<CaptureState>) => void): () => void
    onQuitRequest(callback: () => void): () => void
    respondToQuit(saved: boolean, body: string): void
    ready(): void
  }
  notes: {
    list(filter: NoteFilter): Promise<ApiResult<NotePage>>
    tags(): Promise<ApiResult<string[]>>
    taxonomy(): Promise<ApiResult<{ categories: Category[]; subcategories: Subcategory[]; tags: TagRecord[] }>>
    createSubcategory(input: { name: string; categoryId: string }): Promise<ApiResult<Subcategory>>
    updateSubcategory(input: { id: string; name: string; color: string }): Promise<ApiResult<void>>
    deleteSubcategory(id: string): Promise<ApiResult<void>>
    reorderSubcategories(input: { categoryId: string; ids: string[] }): Promise<ApiResult<void>>
    migrationStatus(): Promise<ApiResult<{upgraded:boolean;acknowledged:boolean}>>
    acknowledgeMigration(): Promise<ApiResult<void>>
    migrationReview(): Promise<ApiResult<MigrationReview[]>>
    resolveMigrationReview(input: { id: string; expectedRevision: number; subcategoryId: string | null; categoryId?: string | null }): Promise<ApiResult<void>>
    createCategory(name: string): Promise<ApiResult<Category>>
    updateCategory(input: z.infer<typeof CategoryUpdateSchema>): Promise<ApiResult<Category>>
    deleteCategory(id: string): Promise<ApiResult<void>>
    reorderCategories(input: z.infer<typeof CategoriesReorderSchema>): Promise<ApiResult<void>>
    reorderTags(input: z.infer<typeof TagsReorderSchema>): Promise<ApiResult<void>>
    createTag(input: { name: string; categoryId?: string | null }): Promise<ApiResult<TagRecord>>
    updateTag(input: z.infer<typeof TagUpdateSchema>): Promise<ApiResult<void>>
    deleteTag(id: string): Promise<ApiResult<void>>
    get(id: string): Promise<ApiResult<(Note & { meetingTitle: string | null }) | PlannerTask | null>>
    image(id: string): Promise<ApiResult<string>>
    update(input: z.infer<typeof NoteUpdateSchema>): Promise<ApiResult<Note>>
    updateItem(input: { id: string; expectedRevision: number; body: string; tags: string[]; subcategoryId?: string | null; categoryId?: string | null; images?: (ImageRef & { dataUrl?: string })[] }): Promise<ApiResult<Note & { meetingTitle: string | null }>>
    setCategory(input: z.infer<typeof ItemCategorySchema>): Promise<ApiResult<void>>
    setTags(input: { id: string; tags: string[] }): Promise<ApiResult<void>>
    trash(ids: string[]): Promise<ApiResult<void>>
    restore(ids: string[]): Promise<ApiResult<void>>
    deletePermanently(ids: string[]): Promise<ApiResult<void>>
    emptyTrash(): Promise<ApiResult<void>>
    copy(ids: string[]): Promise<ApiResult<string>>
    onChanged(callback: (sequence: number) => void): () => void
    onTaxonomyChanged(callback: () => void): () => void
  }
  planner: {
    inbox(input?: { cursor?: InboxPage['nextCursor']; limit?: number }): Promise<ApiResult<InboxPage>>
    inboxCount(): Promise<ApiResult<number>>
    unfile(id: string): Promise<ApiResult<void>>
    classify(input: z.infer<typeof ClassifyItemSchema>): Promise<ApiResult<void>>
    tasks(from: string, to: string): Promise<ApiResult<{ tasks: PlannerTask[]; events: PlannerEvent[]; tags: string[] }>>
    backlog(input?: z.infer<typeof PlannerBacklogQuerySchema>): Promise<ApiResult<PlannerBacklogPage>>
    backlogSummary(later: boolean): Promise<ApiResult<PlannerBacklogSummary>>
    setReady(input: z.infer<typeof PlannerReadySchema>): Promise<ApiResult<void>>
    setTaskCompleted(input: z.infer<typeof PlannerCompleteSchema>): Promise<ApiResult<void>>
    reorderBacklog(input: { id: string; categoryId: string | null; beforeId: string | null }): Promise<ApiResult<void>>
    move(input: z.infer<typeof PlannerMoveSchema>): Promise<ApiResult<void>>
    scheduleTask(input: PlannerTaskSchedule): Promise<ApiResult<PlannerTask>>
    createTask(input: PlannerTaskCreate): Promise<ApiResult<PlannerTask>>
    updateEventTiming(input: PlannerEventTiming): Promise<ApiResult<PlannerEvent>>
    createEvent(input: z.infer<typeof PlannerEventInputSchema>): Promise<ApiResult<PlannerEvent>>
    updateEvent(input: z.infer<typeof PlannerEventInputSchema> & { id: string }): Promise<ApiResult<PlannerEvent>>
    deleteEvent(id: string, scope?: 'instance' | 'series'): Promise<ApiResult<DeletedPlannerEvent>>
    undoDeleteEvent(snapshot: DeletedPlannerEvent): Promise<ApiResult<void>>
    onChanged(callback: (sequence: number) => void): () => void
  }
  settings: {
    get(): Promise<ApiResult<Settings>>
    update(input: SettingsUpdate): Promise<ApiResult<Settings>>
    onChanged(callback: () => void): () => void
    openFolder(): Promise<ApiResult<void>>
    displays(): Promise<ApiResult<{ id: number; label: string; primary: boolean }[]>>
  }
  data: {
    export(input: { format: 'txt' | 'md'; scope: 'selected' | 'all' | 'full'; ids?: string[] }): Promise<ApiResult<void>>
    backup(): Promise<ApiResult<void>>
    restore(): Promise<ApiResult<void>>
    diagnostics(): Promise<ApiResult<void>>
  }
  windows: { openCapture(context?:{categoryId:string|null;subcategoryId?:string|null;tags?:string[]}): void; openNotes(): void; openSettings(): void; quit(): void; ready(): void; onView(callback: (view: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings') => void): () => void }
}
