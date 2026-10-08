import { TasksQuerySchema, TaskWorkspaceMoveSchema, TaskWorkspaceUndoSchema, TaskWorkspaceCreateSchema } from '../shared/contracts'
import { z as Z } from 'zod'
import { ImageRefSchema } from '../shared/contracts'
import { app, BrowserWindow, clipboard, dialog, globalShortcut, Menu, powerMonitor, screen, shell, Tray, type Display } from 'electron'
import { autoUpdater } from 'electron-updater'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { Store } from './storage/database'
import { SettingsStore } from './settings'
import { CalendarHoursSchema, SettingsPatchSchema, PlannerTaskCreateSchema, PlannerTaskScheduleSchema, PlannerEventTimingSchema } from '../shared/contracts'
import { CaptureSubmitSchema, CategoryNameSchema, CategoryUpdateSchema, CategoriesReorderSchema, TagsReorderSchema, ClassifyItemSchema, DeletedPlannerEventSchema, IdsSchema, InboxPageSchema, ItemCategorySchema, NoteFilterSchema, NoteUpdateSchema, PlannerBacklogQuerySchema, PlannerBacklogReorderSchema, PlannerCompleteSchema, PlannerEventInputSchema, PlannerMoveSchema, PlannerQuerySchema, PlannerReadySchema, TagNameSchema, TagUpdateSchema } from '../shared/contracts'
import { AppError, messageOf } from '../shared/errors'
import { toLocalISODate } from '../shared/plannerDates'

// Reuse the original profile on upgrades; custom test profiles stay isolated.
const defaultProfile = path.join(app.getPath('appData'), 'captured')
const databaseNames = ['captured.sqlite', 'notiert.sqlite', 'notable.sqlite']
if (app.getPath('userData') === defaultProfile && !databaseNames.some(name => fs.existsSync(path.join(defaultProfile, name)))) {
  const legacyProfile = ['notiert', 'notable'].map(name => path.join(app.getPath('appData'), name))
    .find(profile => databaseNames.some(name => fs.existsSync(path.join(profile, name))))
  if (legacyProfile) app.setPath('userData', legacyProfile)
}

const hasSingleInstance = app.requestSingleInstanceLock()
if (!hasSingleInstance) app.quit()

let store: Store | null = null
const settings = new SettingsStore()
let captureWindow: BrowserWindow | null = null
let notesWindow: BrowserWindow | null = null
let notesReady = false
let pendingNotesView: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings' = 'all'
let tray: Tray | null = null
let isQuitting = false
let quitApproved = false
let quitPromptActive = false
let quitReplyTimer: NodeJS.Timeout | undefined
let pendingCapture = false
let captureReady = false
let draftGeneration = 0
let captureHideTimer: NodeJS.Timeout | undefined
let captureCategory: { categoryId: string | null; subcategoryId: string | null } = { categoryId: null, subcategoryId: null }
let rolloverTimer: NodeJS.Timeout | undefined
type UpdateStatus = { status: 'idle' | 'checking' | 'available' | 'downloaded' | 'error'; version?: string; message?: string }
let updateStatus: UpdateStatus = { status: 'idle' }
const CAPTURE_WIDTH = 658

const safeResult = async <T>(work: () => T | Promise<T>) => {
  try { return { ok: true as const, value: await work() } }
  catch (error) { return { ok: false as const, ...messageOf(error) } }
}

function requireStore() {
  if (!store) throw new AppError('DATABASE_UNAVAILABLE', 'Your notes are unavailable right now. Keep this text on screen and try again.')
  return store
}

function isTrusted(event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent, role: 'capture' | 'notes') {
  const expected = role === 'capture' ? captureWindow : notesWindow
  return Boolean(expected && !expected.isDestroyed() && event.sender === expected.webContents && event.senderFrame === expected.webContents.mainFrame)
}

function protect(win: BrowserWindow) {
  if (settings.get().captureProtection) win.setContentProtection(true)
}

function secureWindow(win: BrowserWindow, preload: string) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, target) => {
    const isLocal = target.startsWith('file://') || target.startsWith(process.env.ELECTRON_RENDERER_URL ?? 'http://127.0.0.1:5173')
    if (!isLocal) event.preventDefault()
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('context-menu', (event) => event.preventDefault())
  win.webContents.on('did-fail-load', (_event, code) => {
    console.error('renderer-load-failed', { code })
  })
  void preload
}

function rendererUrl(kind: 'capture' | 'notes') {
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) return `${dev}?window=${kind}`
  const page = kind === 'capture' ? 'capture.html' : 'index.html'
  return pathToFileURL(path.join(__dirname, '../renderer', page)).href
}

function displayForCapture(): Display {
  const configured = settings.get().monitor
  if (configured.startsWith('display:')) {
    const id = Number(configured.slice('display:'.length))
    const selected = screen.getAllDisplays().find((display) => display.id === id)
    if (selected) return selected
  }
  if (configured === 'primary') return screen.getPrimaryDisplay()
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
}

function placeCapture() {
  if (!captureWindow || captureWindow.isDestroyed()) return
  const display = displayForCapture()
  const { x, y, width, height } = display.workArea
  const nextWidth = Math.min(CAPTURE_WIDTH, Math.max(378, width - 14))
  const nextHeight = Math.min(height - 16, Math.max(88, captureWindow.getSize()[1]))
  captureWindow.setBounds({ x: Math.round(x + (width - nextWidth) / 2), y: Math.round(y + height - nextHeight - 15), width: nextWidth, height: nextHeight }, false)
}

function createCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) return captureWindow
  captureWindow = new BrowserWindow({
    width: CAPTURE_WIDTH, height: 88, minWidth: 378, minHeight: 88, maxWidth: 1600, maxHeight: 340,
    show: false, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, alwaysOnTop: true, transparent: true, backgroundColor: '#00000000', hasShadow: false,
    webPreferences: { preload: path.join(__dirname, '../preload/capture.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  protect(captureWindow)
  secureWindow(captureWindow, 'capture')
  captureWindow.on('blur', () => {
    if (!captureWindow?.isVisible()) return
    clearTimeout(captureHideTimer)
    captureHideTimer = setTimeout(() => { if (captureWindow?.isVisible()) captureWindow.hide() }, 120)
  })
  captureWindow.on('closed', () => { captureWindow = null; captureReady = false })
  void captureWindow.loadURL(rendererUrl('capture'))
  return captureWindow
}

function createNotesWindow(view: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings' = 'all') {
  if (notesWindow && !notesWindow.isDestroyed()) {
    pendingNotesView = view
    if (notesWindow.isMinimized()) notesWindow.restore()
    notesWindow.show()
    notesWindow.focus()
    if (notesReady) notesWindow.webContents.send('notes:view', view)
    return notesWindow
  }
  pendingNotesView = view
  notesReady = false
  notesWindow = new BrowserWindow({
    width: 1040, height: 720, minWidth: 760, minHeight: 520, show: false,
    backgroundColor: settings.get().theme === 'dark' ? '#0A0A0A' : '#FAFAFA',
    title: 'captured', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  protect(notesWindow)
  secureWindow(notesWindow, 'notes')
  notesWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) notesReady = false
  })
  notesWindow.on('ready-to-show', () => { if (!isLoginLaunch) notesWindow?.show() })
  notesWindow.on('close', (event) => {
    if (!isQuitting && settings.get().closeToTray) { event.preventDefault(); notesWindow?.hide() }
  })
  notesWindow.on('closed', () => { notesWindow = null; notesReady = false })
  void notesWindow.loadURL(rendererUrl('notes'))
  return notesWindow
}

function captureState() {
  let draft = store?.getCaptureDraft()
  const taxonomy = store?.taxonomy()
  if (captureCategory.categoryId && !taxonomy?.categories.some(item => item.id === captureCategory.categoryId)) captureCategory = { categoryId: null, subcategoryId: null }
  if (captureCategory.subcategoryId && !taxonomy?.subcategories.some(item => item.id === captureCategory.subcategoryId && item.categoryId === captureCategory.categoryId)) captureCategory.subcategoryId = null
  const hasDraft = !!(draft?.body || draft?.images.length)
  if (draft && !hasDraft && (draft.categoryId !== captureCategory.categoryId || draft.subcategoryId !== captureCategory.subcategoryId)) {
    store!.updateDraft(draft.body, draft.generation, draft.revision + 1, captureCategory.categoryId, captureCategory.subcategoryId, draft.tags)
    draft = store!.getCaptureDraft()
  }
  const context = hasDraft ? { categoryId: draft!.categoryId, subcategoryId: draft!.subcategoryId } : captureCategory
  return { ...draft, body: draft?.body ?? '', images: draft?.images ?? [], generation: draft?.generation ?? draftGeneration, revision: draft?.revision ?? 0, ...context, tags: draft?.tags ?? [], available: Boolean(store), shortcut: settings.get().shortcut, theme: settings.get().theme }
}

function rememberCaptureCategory(generation: number, revision: number) {
  const draft = store?.getCaptureDraft()
  if (draft?.generation === generation && draft.revision === revision) captureCategory = { categoryId: draft.categoryId, subcategoryId: draft.subcategoryId }
}

function reconcileTasks() {
  try {
    if (store?.reconcileReadyTasks(toLocalISODate(new Date()))) broadcastChange()
  } catch (error) { console.error('task-rollover-failed', messageOf(error)) }
}

function scheduleRollover() {
  clearTimeout(rolloverTimer)
  reconcileTasks()
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  rolloverTimer = setTimeout(scheduleRollover, midnight.getTime() - now.getTime() + 100)
}

function showCapture() {
  const win = createCaptureWindow()
  if (!captureReady) { pendingCapture = true; return }
  const alreadyVisible = win.isVisible()
  clearTimeout(captureHideTimer)
  placeCapture()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('capture:state', alreadyVisible ? { available: Boolean(store), shortcut: settings.get().shortcut, theme: settings.get().theme } : captureState())
}

function showNotes(view: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings' = 'all') {
  const win = createNotesWindow(view === 'calenban' && !settings.get().showCalendar ? 'all' : view)
  if (!win.isVisible()) win.show()
  win.focus()
}

function requestQuit() {
  if (quitApproved || quitPromptActive) return
  if (captureWindow && !captureWindow.isDestroyed() && captureReady) {
    quitPromptActive = true
    captureWindow.webContents.send('app:prepare-quit')
    clearTimeout(quitReplyTimer)
    quitReplyTimer = setTimeout(() => { void handleQuitResponse(false, '') }, 5000)
    return
  }
  quitApproved = true
  app.quit()
}

async function handleQuitResponse(saved: boolean, body: string) {
  clearTimeout(quitReplyTimer)
  if (saved) { quitPromptActive = false; quitApproved = true; app.quit(); return }
  const options: Electron.MessageBoxOptions = {
    type: 'warning', buttons: ['Retry', 'Copy text', 'Quit without saving', 'Cancel'], defaultId: 3, cancelId: 3,
    title: 'Draft could not be saved', message: 'captured could not save this draft.', detail: 'Copy the text before leaving, retry the save, or choose Quit without saving and lose this draft.',
  }
  const owner = captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible() ? captureWindow : notesWindow && !notesWindow.isDestroyed() && notesWindow.isVisible() ? notesWindow : null
  const response = owner ? await dialog.showMessageBox(owner, options) : await dialog.showMessageBox(options)
  if (response.response === 0) { quitPromptActive = false; requestQuit(); return }
  if (response.response === 1) { quitPromptActive = false; clipboard.writeText(body); return }
  if (response.response === 2) { quitPromptActive = false; quitApproved = true; app.quit(); return }
  quitPromptActive = false
}

function syncTray() {
  if (!tray) return
  const current = settings.get()
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: current.shortcutEnabled ? `Capture thought  (${current.shortcut.replace('Control', 'Ctrl')})` : 'Capture thought', click: showCapture },
    { label: 'Open tasks', click: () => showNotes('all') },
    { type: 'separator' },
    { label: 'Open Plan', visible: current.showCalendar, click: () => showNotes('calenban') },
    { label: 'Settings', click: () => showNotes('settings') },
    { type: 'separator' },
    { label: 'Quit captured', click: requestQuit },
  ]))
  tray.setToolTip('captured')
}

function makeTray() {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'captured.ico')
    : path.join(__dirname, '../../resources/captured.ico')
  tray = new Tray(iconPath)
  tray.on('click', showCapture)
  tray.on('double-click', () => { if (!captureWindow?.isVisible()) showCapture() })
  syncTray()
}

function registerShortcut(accelerator = settings.get().shortcut) {
  if (globalShortcut.isRegistered(accelerator)) return true
  return globalShortcut.register(accelerator, showCapture)
}

function broadcastChange(scope: 'all' | 'notes' | 'planner' = 'all') {
  if (!store) return
  if (scope === 'all' || scope === 'notes') notesWindow?.webContents.send('notes:changed', store.changeSequence)
  if (scope === 'all' || scope === 'planner') notesWindow?.webContents.send('planner:changed', store.changeSequence)
  syncTray()
}

function broadcastTaxonomyChange(scope: 'all' | 'notes' | 'planner' = 'all') {
  broadcastChange(scope)
  notesWindow?.webContents.send('notes:taxonomy-changed')
}

function broadcastSettingsChange() {
  notesWindow?.webContents.send('settings:changed')
}

function broadcastUpdateStatus(status: UpdateStatus) {
  updateStatus = status
  notesWindow?.webContents.send('updates:changed', status)
}

function configureUpdates() {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.on('checking-for-update', () => broadcastUpdateStatus({ status: 'checking' }))
  autoUpdater.on('update-available', (info) => broadcastUpdateStatus({ status: 'available', version: info.version }))
  autoUpdater.on('update-downloaded', (info) => broadcastUpdateStatus({ status: 'downloaded', version: info.version }))
  autoUpdater.on('error', (error) => broadcastUpdateStatus({ status: 'error', message: error.message }))
  setTimeout(() => void autoUpdater.checkForUpdates().catch(() => undefined), 8_000)
}

function settingsView() {
  const value = settings.get()
  if (value.protectionTestDate && value.protectionTestOS !== os.release()) return { ...value, shortcutRegistered: globalShortcut.isRegistered(value.shortcut), protectionTestOS: '' }
  return { ...value, shortcutRegistered: globalShortcut.isRegistered(value.shortcut) }
}

function roleHandler(channel: string, role: 'capture' | 'notes', handler: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => unknown) {
  const { ipcMain } = require('electron') as typeof import('electron')
  ipcMain.handle(channel, async (event, ...args) => {
    if (!isTrusted(event, role)) throw new AppError('UNTRUSTED_SENDER', 'This action is not available from this window.')
    return safeResult(() => handler(event, ...args))
  })
}

function registerIpc() {
  const { ipcMain } = require('electron') as typeof import('electron')
  roleHandler('updates:status', 'notes', () => updateStatus)
  roleHandler('updates:check', 'notes', async () => { if (!app.isPackaged) return; await autoUpdater.checkForUpdates() })
  roleHandler('updates:install', 'notes', () => { if (updateStatus.status === 'downloaded') autoUpdater.quitAndInstall(); })
  roleHandler('capture:get-state', 'capture', () => {
    return captureState()
  })
  roleHandler('capture:categories', 'capture', () => requireStore().taxonomy().categories)
  roleHandler('capture:subcategories', 'capture', () => requireStore().taxonomy().subcategories)
  roleHandler('capture:update-draft', 'capture', (_event, raw) => {
    const input = raw as { body: string; generation: number; revision: number; categoryId?: string | null; subcategoryId?: string | null; tags?:string[]; captureKind?: 'inbox' | 'task' | 'note' }
    if (typeof input.body !== 'string' || [...input.body].length > 50_000 || input.body.length > 200_000 || !Number.isInteger(input.generation) || !Number.isInteger(input.revision) || (input.categoryId !== undefined && input.categoryId !== null && !/^[0-9a-f-]{36}$/i.test(input.categoryId))) throw new AppError('INVALID_INPUT', 'This draft is too large or invalid.')
    const next = requireStore().updateDraft(input.body, input.generation, input.revision, input.categoryId ?? null, Z.string().uuid().nullable().optional().parse(input.subcategoryId), Z.array(TagNameSchema).max(20).optional().parse(input.tags), Z.enum(['inbox','task','note']).optional().parse(input.captureKind))
    rememberCaptureCategory(input.generation, input.revision)
    return { revision: next }
  })
  roleHandler('capture:flush-before-quit', 'capture', (_event, raw) => {
    const input = raw as { body: string; generation: number; revision: number; categoryId?: string | null; subcategoryId?: string | null; tags?:string[]; captureKind?: 'inbox' | 'task' | 'note' }
    if (typeof input.body !== 'string' || [...input.body].length > 50_000 || input.body.length > 100_000 || !Number.isInteger(input.generation) || input.generation < 0 || !Number.isInteger(input.revision) || input.revision < 0 || (input.categoryId !== undefined && input.categoryId !== null && !/^[0-9a-f-]{36}$/i.test(input.categoryId))) throw new AppError('INVALID_INPUT', 'This draft is too large or invalid.')
    return { revision: requireStore().updateDraft(input.body, input.generation, input.revision, input.categoryId ?? null, Z.string().uuid().nullable().optional().parse(input.subcategoryId), Z.array(TagNameSchema).max(20).optional().parse(input.tags), Z.enum(['inbox','task','note']).optional().parse(input.captureKind)) }
  })
  roleHandler('capture:submit', 'capture', (_event, raw) => {
    const input = CaptureSubmitSchema.parse(raw)
    const id = requireStore().submitCapture(input.requestId, input.generation, input.body, input.categoryId ?? null, Z.string().uuid().nullable().optional().parse(input.subcategoryId), Z.array(TagNameSchema).max(20).optional().parse(input.tags), Z.enum(['inbox','task','note']).optional().parse(input.captureKind))
    captureCategory = { categoryId: input.categoryId ?? null, subcategoryId: input.subcategoryId ?? null }
    broadcastTaxonomyChange()
    setImmediate(() => void makeAutomaticBackup())
    return { id }
  })
  roleHandler('capture:add-image', 'capture', (_event, raw) => {
    const input = raw as { generation?: unknown; dataUrl?: unknown }
    if (!Number.isInteger(input?.generation) || typeof input?.dataUrl !== 'string') throw new AppError('INVALID_IMAGE', 'The pasted image is invalid.')
    return requireStore().addDraftImage(input.generation as number, input.dataUrl)
  })
  roleHandler('capture:remove-image', 'capture', (_event, raw) => {
    const input = raw as { generation?: unknown; id?: unknown }
    if (!Number.isInteger(input?.generation) || typeof input?.id !== 'string') throw new AppError('INVALID_IMAGE', 'The image could not be removed.')
    requireStore().removeDraftImage(input.generation as number, input.id)
  })
  roleHandler('capture:dismiss', 'capture', (_event, reason) => {
    if (!['escape', 'blur', 'saved'].includes(reason)) throw new AppError('INVALID_INPUT', 'Invalid dismiss reason.')
    captureWindow?.hide()
  })
  roleHandler('notes:list', 'notes', (_event, raw) => requireStore().listNotes(NoteFilterSchema.parse(raw)))
  roleHandler('notes:tags', 'notes', () => requireStore().listTags())
  roleHandler('notes:taxonomy', 'notes', () => requireStore().taxonomy())
  roleHandler('notes:subcategory:create','notes',(_event,raw)=> { const input=Z.object({name:TagNameSchema,categoryId:Z.string().uuid()}).parse(raw); const result=requireStore().createSubcategory(input.name,input.categoryId); broadcastTaxonomyChange(); return result })
  roleHandler('notes:subcategory:update','notes',(_event,raw)=> { const input=Z.object({id:Z.string().uuid(),name:TagNameSchema,color:Z.string().regex(/^#[0-9a-f]{6}$/i)}).parse(raw); requireStore().updateSubcategory(input.id,input.name,input.color); broadcastTaxonomyChange() })
  roleHandler('notes:subcategory:delete','notes',(_event,raw)=> { requireStore().deleteSubcategory(IdsSchema.element.parse(raw)); broadcastTaxonomyChange() })
  roleHandler('notes:subcategories:reorder','notes',(_event,raw)=> { const input=Z.object({categoryId:Z.string().uuid(),ids:IdsSchema}).parse(raw); requireStore().reorderSubcategories(input.categoryId,input.ids); broadcastTaxonomyChange() })
  roleHandler('notes:migration-status','notes',()=>requireStore().migrationStatus())
  roleHandler('notes:migration-acknowledge','notes',()=>requireStore().acknowledgeMigration())
  roleHandler('notes:migration-review','notes',()=>requireStore().migrationReview())
  roleHandler('notes:migration-review:resolve','notes',(_event,raw)=> { const input=Z.object({id:Z.string().uuid(),expectedRevision:Z.number().int().nonnegative(),subcategoryId:Z.string().uuid().nullable(),categoryId:Z.string().uuid().nullable().optional()}).parse(raw); requireStore().resolveMigrationReview(input.id,input.expectedRevision,input.subcategoryId,input.categoryId); broadcastTaxonomyChange() })
  roleHandler('notes:category:create', 'notes', (_event, raw) => { const result = requireStore().createCategory(CategoryNameSchema.parse(raw)); broadcastTaxonomyChange('notes'); return result })
  roleHandler('notes:category:update', 'notes', (_event, raw) => { const input = CategoryUpdateSchema.parse(raw); const result = requireStore().updateCategory(input.id, input.name, input.color); broadcastTaxonomyChange('notes'); return result })
  roleHandler('notes:category:delete', 'notes', (_event, raw) => { requireStore().deleteCategory(IdsSchema.element.parse(raw)); broadcastTaxonomyChange() })
  roleHandler('notes:categories:reorder', 'notes', (_event, raw) => { const input = CategoriesReorderSchema.parse(raw); requireStore().reorderCategories(input.ids); broadcastTaxonomyChange('notes') })
  roleHandler('notes:tags:reorder', 'notes', (_event, raw) => { const input = TagsReorderSchema.parse(raw); requireStore().reorderTags(input.categoryId, input.ids); broadcastTaxonomyChange('notes') })
  roleHandler('notes:tag:create', 'notes', (_event, raw) => { const input = raw as { name?: unknown; categoryId?: unknown }; const name = TagNameSchema.parse(input?.name); const categoryId = null; const result = requireStore().createTag(name, categoryId); broadcastTaxonomyChange('notes'); return result })
  roleHandler('notes:tag:update', 'notes', (_event, raw) => { const input = TagUpdateSchema.parse(raw); requireStore().updateTag(input.id, input.categoryId, input.color, input.name); broadcastTaxonomyChange() })
  roleHandler('notes:tag:delete', 'notes', (_event, raw) => { requireStore().deleteTag(IdsSchema.element.parse(raw)); broadcastTaxonomyChange() })
  roleHandler('notes:get', 'notes', (_event, id) => requireStore().getNote(String(id)))
  roleHandler('notes:image', 'notes', (_event, id) => requireStore().getItemImage(String(id)))
  roleHandler('notes:update', 'notes', (_event, raw) => { const input = NoteUpdateSchema.parse(raw); const result = requireStore().updateNote(input.id, input.expectedRevision, input.body); broadcastChange('notes'); return result })
  roleHandler('notes:update-item', 'notes', (_event, raw) => {
    const input = raw as { id?: unknown; expectedRevision?: unknown; body?: unknown; tags?: unknown; categoryId?: unknown; images?: unknown; subcategoryId?: unknown }
    if (typeof input?.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id) || !Number.isInteger(input.expectedRevision) || typeof input.body !== 'string' || [...input.body].length > 50_000 || !Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some((tag) => typeof tag !== 'string' || tag.length > 80) || (input.categoryId !== undefined && input.categoryId !== null && (typeof input.categoryId !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.categoryId)))) throw new AppError('INVALID_INPUT', 'This item is too large or invalid.')
    const images = input.images === undefined ? undefined : Z.array(ImageRefSchema.extend({ dataUrl: Z.string().max(7_000_000).optional() })).max(5).parse(input.images)
    const result = requireStore().updateItem(input.id, input.expectedRevision as number, input.body, input.tags as string[], input.categoryId as string | null | undefined, images, Z.string().uuid().nullable().optional().parse(input.subcategoryId))
    broadcastTaxonomyChange(); return result
  })
  roleHandler('notes:set-category', 'notes', (_event, raw) => { const input = ItemCategorySchema.parse(raw); requireStore().setItemCategory(input.id, input.categoryId, input.subcategoryId); broadcastTaxonomyChange() })
  roleHandler('notes:set-tags', 'notes', (_event, raw) => { const input = raw as { id?: unknown; tags?: unknown }; if (typeof input?.id !== 'string' || !Array.isArray(input.tags) || input.tags.length > 20 || input.tags.some((tag) => typeof tag !== 'string' || tag.length > 80)) throw new AppError('INVALID_INPUT', 'Choose up to 20 valid tags.'); requireStore().setItemTags(input.id, input.tags as string[]); broadcastTaxonomyChange() })
  roleHandler('notes:trash', 'notes', (_event, raw) => { const ids = IdsSchema.parse(raw); requireStore().trash(ids); broadcastTaxonomyChange() })
  roleHandler('notes:restore', 'notes', (_event, raw) => { const ids = IdsSchema.parse(raw); requireStore().restore(ids); broadcastTaxonomyChange() })
  roleHandler('notes:delete-permanently', 'notes', async (_event, raw) => {
    const db = requireStore()
    const ids = [...new Set(IdsSchema.parse(raw))].filter((id) => { const note = db.getNote(id); return note !== null && note.deletedAt !== null })
    if (!ids.length) return
    const response = await dialog.showMessageBox(notesWindow!, { type: 'warning', buttons: ['Cancel', 'Delete permanently'], defaultId: 0, cancelId: 0, title: 'Delete permanently?', message: `Permanently delete ${ids.length} ${ids.length === 1 ? 'note' : 'notes'}?`, detail: 'This cannot be undone. Independent backups may still contain them.' })
    if (response.response === 1) { db.permanentlyDelete(ids); broadcastTaxonomyChange() }
  })
  roleHandler('notes:empty-trash', 'notes', async () => {
    const count = requireStore().listNotes({ query: '', scope: 'trash', sort: 'newest', includeCompleted: false, limit: 1 }).total
    if (!count) return
    const response = await dialog.showMessageBox(notesWindow!, { type: 'warning', buttons: ['Cancel', 'Empty trash'], defaultId: 0, cancelId: 0, title: 'Empty trash?', message: `Permanently delete all ${count} ${count === 1 ? 'note' : 'notes'} in Trash?`, detail: 'This cannot be undone. Independent backups may still contain them.' })
    if (response.response === 1) { requireStore().emptyTrash(); broadcastTaxonomyChange() }
  })
  roleHandler('notes:copy', 'notes', (_event, raw) => { const ids = IdsSchema.parse(raw); const value = requireStore().getDraftText(ids); clipboard.writeText(value); return value })
  roleHandler('tasks:list', 'notes', (_event, raw) => requireStore().listWorkspace(TasksQuerySchema.parse(raw)))
  roleHandler('tasks:move', 'notes', (_event, raw) => { const undo = requireStore().moveWorkspace(TaskWorkspaceMoveSchema.parse(raw)); broadcastTaxonomyChange(); return undo })
  roleHandler('tasks:undo', 'notes', (_event, raw) => { requireStore().undoWorkspace(TaskWorkspaceUndoSchema.parse(raw)); broadcastTaxonomyChange() })
  roleHandler('tasks:create', 'notes', (_event, raw) => { const input = TaskWorkspaceCreateSchema.parse(raw); requireStore().createWorkspaceTask(input.body, input.categoryId, input.intention, input.subcategoryId, input.tags); broadcastTaxonomyChange() })
  roleHandler('planner:inbox', 'notes', (_event, raw) => { const input = InboxPageSchema.parse(raw ?? {}); return requireStore().listInbox(input.cursor, input.limit) })
  roleHandler('planner:inbox-count', 'notes', () => requireStore().inboxCount())
  roleHandler('planner:unfile', 'notes', (_event, raw) => { const id = IdsSchema.parse([raw])[0]!; requireStore().unfilePlannerTask(id); broadcastChange() })
  roleHandler('planner:classify', 'notes', (_event, raw) => { const input = ClassifyItemSchema.parse(raw); requireStore().classifyItem(input.id, input.kind, input.tags, input.categoryId, input.subcategoryId); broadcastTaxonomyChange() })
  roleHandler('planner:tasks', 'notes', (_event, raw) => { const input = PlannerQuerySchema.parse(raw); return requireStore().listPlanner(input.from, input.to) })
  roleHandler('planner:backlog', 'notes', (_event, raw) => { const input = PlannerBacklogQuerySchema.parse(raw ?? {}); return requireStore().listBacklog(input) })
  roleHandler('planner:backlog-summary', 'notes', (_event, raw) => requireStore().backlogSummary(Z.boolean().parse(raw)))
  roleHandler('planner:ready', 'notes', (_event, raw) => { const input = PlannerReadySchema.parse(raw); requireStore().setTaskReady(input.id); broadcastChange() })
  roleHandler('planner:complete', 'notes', (_event, raw) => { const input = PlannerCompleteSchema.parse(raw); requireStore().setTaskCompleted(input.id, input.completed); broadcastChange() })
  roleHandler('planner:backlog-reorder', 'notes', (_event, raw) => { const input = PlannerBacklogReorderSchema.parse(raw); requireStore().reorderBacklog(input.id, input.categoryId, input.beforeId); broadcastChange() })
  roleHandler('planner:move', 'notes', (_event, raw) => { const input = PlannerMoveSchema.parse(raw); requireStore().movePlannerTask(input.id, input.plannedDate, input.beforeEventId, input.beforeId); broadcastChange('planner') })
  roleHandler('planner:task:schedule', 'notes', (_event, raw) => { const task = requireStore().schedulePlannerTask(PlannerTaskScheduleSchema.parse(raw)); broadcastChange(); return task })
  roleHandler('planner:task:create', 'notes', (_event, raw) => { const task = requireStore().createPlannerTask(PlannerTaskCreateSchema.parse(raw)); broadcastTaxonomyChange(); return task })
  roleHandler('planner:event:timing', 'notes', (_event, raw) => { const event = requireStore().updatePlannerEventTiming(PlannerEventTimingSchema.parse(raw)); broadcastChange('planner'); return event })
  roleHandler('planner:event:create', 'notes', (_event, raw) => { const input = PlannerEventInputSchema.parse(raw); const event = requireStore().savePlannerEvent(input); broadcastChange('planner'); return event })
  roleHandler('planner:event:update', 'notes', (_event, raw) => { const input = PlannerEventInputSchema.parse(raw); if (!input.id) throw new AppError('INVALID_INPUT', 'Choose a meeting to update.'); const event = requireStore().updatePlannerEvent({ ...input, id: input.id }); broadcastChange('planner'); return event })
  roleHandler('planner:event:delete', 'notes', (_event, id, scope = 'instance') => { if (scope !== 'instance' && scope !== 'series') throw new AppError('INVALID_INPUT', 'Invalid deletion scope.'); if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new AppError('INVALID_INPUT', 'Invalid meeting.'); const snapshot = requireStore().deletePlannerEvent(id, scope); broadcastChange('planner'); return snapshot })
  roleHandler('planner:event:undo-delete', 'notes', (_event, raw) => { const snapshot = DeletedPlannerEventSchema.parse(raw); requireStore().undoDeletePlannerEvent(snapshot); broadcastChange('planner') })
  roleHandler('settings:get', 'notes', () => settingsView())
  roleHandler('settings:update', 'notes', (_event, raw) => {
    const input = raw as Record<string, unknown>
    const allowed = ['shortcut', 'launchAtLogin', 'theme', 'monitor', 'captureProtection', 'protectionTestApp', 'protectionTestDate', 'closeToTray', 'showCalendar', 'calendarStartMinute', 'calendarEndMinute']
    if (Object.keys(input).some((key) => ![...allowed, 'shortcutEnabled', 'firstRunComplete'].includes(key))) throw new AppError('INVALID_INPUT', 'A setting is not supported.')
    if (input.firstRunComplete !== undefined && typeof input.firstRunComplete !== 'boolean') throw new AppError('INVALID_INPUT', 'Invalid setup state.')
    if (input.shortcutEnabled !== undefined && typeof input.shortcutEnabled !== 'boolean') throw new AppError('INVALID_INPUT', 'Invalid shortcut setting.')
    if (input.shortcut !== undefined) {
      if (typeof input.shortcut !== 'string' || input.shortcut.length < 3 || input.shortcut.length > 60) throw new AppError('INVALID_SHORTCUT', 'Choose a valid keyboard shortcut.')
    }
    const parsed = SettingsPatchSchema.parse(input)
    CalendarHoursSchema.parse({ ...settings.get(), ...parsed })
    const old = settings.get().shortcut
    const newShortcut = typeof input.shortcut === 'string' ? input.shortcut : old
    const oldEnabled = settings.get().shortcutEnabled
    const enabled = typeof input.shortcutEnabled === 'boolean' ? input.shortcutEnabled : oldEnabled
    if (enabled && (newShortcut !== old || !globalShortcut.isRegistered(old))) {
      if (!globalShortcut.register(newShortcut, showCapture)) throw new AppError('SHORTCUT_BUSY', 'That shortcut is already in use. Your current shortcut remains active.')
    }
    if (!enabled && oldEnabled) globalShortcut.unregister(old)
    else if (enabled && newShortcut !== old) globalShortcut.unregister(old)
    const result = settings.patch({ ...parsed, ...(typeof input.protectionTestDate === 'string' && input.protectionTestDate ? { protectionTestOS: os.release() } : {}) })
    settings.setRegistration(enabled && globalShortcut.isRegistered(newShortcut))
    if (typeof input.launchAtLogin === 'boolean') app.setLoginItemSettings({ openAtLogin: input.launchAtLogin, args: ['--login-startup'] })
    if (typeof input.captureProtection === 'boolean') {
      for (const win of [captureWindow, notesWindow]) if (win && !win.isDestroyed()) win.setContentProtection(input.captureProtection)
    }
    for (const win of [captureWindow, notesWindow]) if (win && !win.isDestroyed()) win.webContents.send('capture:state', { shortcut: result.shortcut, theme: result.theme })
    syncTray()
    broadcastSettingsChange()
    return settingsView()
  })
  roleHandler('settings:open-folder', 'notes', async () => {
    const error = await shell.openPath(app.getPath('userData'))
    if (error) throw new AppError('OPEN_FOLDER_FAILED', 'The data folder could not be opened.')
  })
  roleHandler('settings:displays', 'notes', () => screen.getAllDisplays().map((display, index) => ({ id: display.id, label: `Display ${index + 1}${display.id === screen.getPrimaryDisplay().id ? ' · Primary' : ''}`, primary: display.id === screen.getPrimaryDisplay().id })))
  roleHandler('data:export', 'notes', async (_event, raw) => exportData(raw))
  roleHandler('data:backup', 'notes', async () => backupToUserPath())
  roleHandler('data:restore', 'notes', async () => restoreBackup())
  roleHandler('data:diagnostics', 'notes', async () => {
    const result = await dialog.showSaveDialog(notesWindow!, { title: 'Export diagnostics', defaultPath: path.join(app.getPath('documents'), `captured-diagnostics-${new Date().toISOString().slice(0, 10)}.txt`), filters: [{ name: 'Text', extensions: ['txt'] }] })
    if (result.canceled || !result.filePath) return
    const integrity = store ? 'ok' : 'unavailable'
    const contents = [`captured diagnostics`, `Date: ${new Date().toISOString()}`, `Version: ${app.getVersion()}`, `Electron: ${process.versions.electron}`, `Windows: ${os.release()}`, `Shortcut registered: ${globalShortcut.isRegistered(settings.get().shortcut)}`, `Database: ${integrity}`].join('\n')
    fs.writeFileSync(result.filePath, contents, 'utf8')
  })
  ipcMain.on('capture:resize', (event, rawHeight: unknown) => {
    if (!isTrusted(event, 'capture') || typeof rawHeight !== 'number' || !Number.isFinite(rawHeight)) return
    const win = captureWindow
    if (!win) return
    const display = displayForCapture()
    const height = Math.round(Math.min(Math.max(88, rawHeight), Math.min(320, display.workArea.height - 24)))
    const current = win.getBounds()
    if (current.height === height) return
    const { x, y, width, height: workHeight } = display.workArea
    const captureWidth = Math.min(CAPTURE_WIDTH, Math.max(378, width - 14))
    win.setBounds({ x: Math.round(x + (width - captureWidth) / 2), y: Math.round(y + workHeight - height - 15), width: captureWidth, height }, false)
  })
  ipcMain.on('windows:open-capture', (event,raw) => {
    if(event.sender!==notesWindow?.webContents)return
    try {
      const context=raw===undefined?null:Z.object({categoryId:Z.string().uuid().nullable(),subcategoryId:Z.string().uuid().nullable().optional(),tags:Z.array(TagNameSchema).max(20).optional()}).parse(raw)
      const draft=context&&!captureWindow?.isVisible()?requireStore().prepareCaptureContext(context.categoryId,context.subcategoryId??null,context.tags):null
      if (draft) captureCategory = { categoryId: draft.categoryId, subcategoryId: draft.subcategoryId }
      showCapture()
      if(draft)captureWindow?.webContents.send('capture:state',draft)
    }catch{showCapture()}
  })
  ipcMain.on('notes:ready', (event) => {
    if (event.sender !== notesWindow?.webContents || notesReady) return
    notesReady = true
    notesWindow.webContents.send('notes:view', pendingNotesView)
  })
  ipcMain.on('windows:open-notes', (event) => { if (event.sender === notesWindow?.webContents || event.sender === captureWindow?.webContents) showNotes('all') })
  ipcMain.on('windows:open-settings', (event) => { if (event.sender === notesWindow?.webContents || event.sender === captureWindow?.webContents) showNotes('settings') })
  ipcMain.on('app:quit', (event) => { if (event.sender === notesWindow?.webContents || event.sender === captureWindow?.webContents) requestQuit() })
  ipcMain.on('capture:ready', (event) => {
    if (event.sender !== captureWindow?.webContents) return
    captureReady = true
    if (pendingCapture) { pendingCapture = false; showCapture() }
  })
  ipcMain.on('app:quit-ready', (event, raw) => {
    if (event.sender !== captureWindow?.webContents || !quitPromptActive || !raw || typeof raw !== 'object') return
    const payload = raw as { saved?: unknown; body?: unknown }
    if (typeof payload.saved !== 'boolean' || typeof payload.body !== 'string' || [...payload.body].length > 50_000) return
    void handleQuitResponse(payload.saved, payload.body)
  })
}

async function exportData(raw: unknown) {
  const input = raw as { format?: string; scope?: string; ids?: string[] }
  if (!input || !['txt', 'md'].includes(input.format ?? '') || !['selected', 'all', 'full'].includes(input.scope ?? '')) throw new AppError('INVALID_INPUT', 'Choose a supported export format and scope.')
  const db = requireStore()
  const rows = input.scope === 'selected'
    ? (IdsSchema.parse(input.ids).map((id) => db.getNote(id)).filter(Boolean) as NonNullable<ReturnType<Store['getNote']>>[])
    : db.recentNotes(input.scope as 'all' | 'full')
  const taskMetadata = db.taskExportMetadata(rows.map((row) => row.id))
  const legacyMeetingLabels = new Map(db.legacyMeetingLabels().map((meeting) => [meeting.id, meeting.title]))
  const ext = input.format as 'txt' | 'md'
  const filename = `captured-export-${new Date().toISOString().slice(0, 10)}.${ext}`
  const choice = await dialog.showSaveDialog(notesWindow!, { title: 'Export notes', defaultPath: path.join(app.getPath('documents'), filename), filters: [{ name: ext === 'md' ? 'Markdown' : 'Text', extensions: [ext] }] })
  if (choice.canceled || !choice.filePath) return
  const list = rows.map((row) => {
    const meetingId = 'meeting_id' in row ? row.meeting_id : row.meetingId
    const title = meetingId ? legacyMeetingLabels.get(meetingId) : null
    const kind = 'kind' in row ? row.kind ?? 'note' : 'note'
    const tags = 'tags' in row ? row.tags : ('tag_names' in row && row.tag_names ? row.tag_names.split(String.fromCharCode(31)) : [])
    const taskStatus = 'status' in row ? row.status : 'task_status' in row ? row.task_status : null
    const plannedDate = 'plannedDate' in row ? row.plannedDate : 'planned_date' in row ? row.planned_date : null
    const dueDate = 'dueDate' in row ? row.dueDate : 'due_date' in row ? row.due_date : null
    const task = taskMetadata.get(row.id)
    const effectivePlannedDate = plannedDate ?? task?.plannedDate ?? null
    const planState = kind !== 'task' ? '' : task?.plannedStartAt != null && task.plannedEndAt != null ? `Scheduled ${new Date(task.plannedStartAt).toLocaleString()} – ${new Date(task.plannedEndAt).toLocaleString()}` : effectivePlannedDate ? `Planned ${effectivePlannedDate}` : task?.ready ? 'Ready' : 'Backlog'
    const intentionState = task?.intention ? task.intention.kind === 'day' ? `Task plan ${task.intention.targetDate}` : task.intention.kind === 'week' ? `Task plan week of ${task.intention.targetDate}` : `Task plan ${task.intention.kind}` : ''
    const metadata = [kind === 'task' ? `To-do${taskStatus === 'done' ? ' · Done' : ''}` : kind === 'inbox' ? 'Inbox' : 'Note', task?.categoryName ? `Category ${task.categoryName}` : '', task?.subcategoryName ? `Subcategory ${task.subcategoryName}`:'', intentionState, planState, ...tags.map((tag) => `#${tag}`), dueDate ? `Due ${dueDate}` : ''].filter(Boolean).join(' · ')
    const images = db.getNote(row.id)?.images ?? []
    const imageText = images.map((image, index) => `![Image ${index + 1}](${db.getItemImage(image.id)})`).join('\n\n')
    const body = [metadata, row.body, imageText].filter(Boolean).join('\n\n')
    const date = new Date('created_at' in row ? row.created_at : row.createdAt).toLocaleString()
    const deleted = 'deleted_at' in row ? row.deleted_at : row.deletedAt
    const status = deleted ? ' · In Trash' : ''
    return ext === 'md' ? `## ${date}${title ? ` · ${title.replace(/[\\[\]#]/g, '')}` : ''}${status}\n\n${body}` : `${date}${title ? ` — ${title}` : ''}${status}\n${body}`
  })
  fs.writeFileSync(choice.filePath, list.join(ext === 'md' ? '\n\n---\n\n' : '\n\n────────────────────\n\n'), 'utf8')
}

async function backupToUserPath() {
  const result = await dialog.showSaveDialog(notesWindow!, { title: 'Create SQLite backup', defaultPath: path.join(app.getPath('documents'), `captured-backup-${new Date().toISOString().slice(0, 10)}.sqlite`), filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }] })
  if (result.canceled || !result.filePath) return
  if (path.resolve(result.filePath) === path.resolve(requireStore().path)) throw new AppError('INVALID_BACKUP_PATH', 'Choose a separate file for the backup.')
  try {
    await requireStore().backupTo(result.filePath)
    settings.patch({ lastBackupAt: Date.now(), backupWarning: false })
  } catch (error) {
    fs.rmSync(result.filePath, { force: true })
    settings.patch({ backupWarning: true })
    broadcastSettingsChange()
    throw error
  }
  broadcastSettingsChange()
}

async function restoreBackup() {
  const result = await dialog.showOpenDialog(notesWindow!, { title: 'Restore SQLite backup', properties: ['openFile'], filters: [{ name: 'SQLite backup', extensions: ['sqlite', 'db'] }] })
  if (result.canceled || !result.filePaths[0]) return
  const db = requireStore()
  const candidate = result.filePaths[0]
  if (path.resolve(candidate) === path.resolve(db.path)) throw new AppError('INVALID_BACKUP_PATH', 'Choose a backup file, not the database currently in use.')
  db.checkIntegrity(candidate)
  const confirmation = await dialog.showMessageBox(notesWindow!, { type: 'warning', buttons: ['Cancel', 'Restore backup'], defaultId: 0, cancelId: 0, title: 'Replace current notes?', message: 'Restore this backup and replace the current database?', detail: 'A safety backup of current data will be created first.' })
  if (confirmation.response !== 1) return
  await createAutomaticBackup('pre-restore')
  db.replaceWith(candidate)
  broadcastTaxonomyChange()
}

const backupDirectory = () => path.join(app.getPath('userData'), 'backups')
async function createAutomaticBackup(label = new Date().toISOString().slice(0, 10)) {
  if (!store) return
  const folder = backupDirectory()
  let target = ''
  try {
    fs.mkdirSync(folder, { recursive: true })
    target = path.join(folder, `${label}-${Date.now()}.sqlite`)
    await store.backupTo(target)
    settings.patch({ lastBackupAt: Date.now(), backupWarning: false })
    broadcastSettingsChange()
  } catch (error) {
    if (target) fs.rmSync(target, { force: true })
    settings.patch({ backupWarning: true })
    broadcastSettingsChange()
    throw error
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(label)) {
    const files = fs.readdirSync(folder).filter((name) => /^\d{4}-\d{2}-\d{2}-\d+\.sqlite$/.test(name)).sort().reverse()
    for (const file of files.slice(7)) fs.rmSync(path.join(folder, file), { force: true })
  } else {
    const older = fs.readdirSync(folder).filter((name) => name.startsWith(`${label}-`) && name.endsWith('.sqlite')).sort().reverse().slice(1)
    for (const file of older) fs.rmSync(path.join(folder, file), { force: true })
  }
}
async function makeAutomaticBackup() {
  if (!store) return
  const today = new Date().toISOString().slice(0, 10)
  const folder = backupDirectory()
  fs.mkdirSync(folder, { recursive: true })
  if (fs.readdirSync(folder).some((file) => file.startsWith(`${today}-`))) return
  try { await createAutomaticBackup(today) } catch (error) { console.error('backup-failed', messageOf(error)) }
}

const isLoginLaunch = process.argv.includes('--login-startup')

if (hasSingleInstance) {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--open-notes')) showNotes('all')
    else showCapture()
  })

  app.whenReady().then(() => {
    fs.mkdirSync(app.getPath('userData'), { recursive: true })
    settings.load()
    try {
      const database = databaseNames.map(name => path.join(app.getPath('userData'), name)).find(filename => fs.existsSync(filename))
      store = new Store(database ?? path.join(app.getPath('userData'), 'captured.sqlite'))
    }
    catch (error) { console.error('database-open-failed', messageOf(error)) }
    makeTray()
    registerIpc()
    configureUpdates()
    const registered = settings.get().shortcutEnabled ? registerShortcut() : false
    settings.setRegistration(registered)
    if (store) {
      scheduleRollover()
      powerMonitor.on('resume', scheduleRollover)
    }
    createCaptureWindow()
    screen.on('display-added', placeCapture)
    screen.on('display-removed', placeCapture)
    screen.on('display-metrics-changed', placeCapture)
    if (!isLoginLaunch) {
      if (!settings.get().firstRunComplete) showNotes('settings')
      else showNotes('all')
    }
    if (pendingCapture) { pendingCapture = false; showCapture() }
    syncTray()
  }).catch((error) => {
    dialog.showErrorBox('captured could not start', 'The app could not initialize its local storage. Try restarting captured.')
    console.error('startup-failed', messageOf(error))
  })

  app.on('before-quit', (event) => {
    if (!quitApproved && captureWindow && !captureWindow.isDestroyed() && captureReady) {
      event.preventDefault()
      requestQuit()
      return
    }
    isQuitting = true
    clearTimeout(rolloverTimer)
    globalShortcut.unregisterAll()
    try { store?.close() } catch (error) { console.error('database-close-failed', messageOf(error)) }
  })
  app.on('window-all-closed', () => { /* tray app stays available until explicit Quit */ })
  app.on('activate', () => showNotes('all'))
}
