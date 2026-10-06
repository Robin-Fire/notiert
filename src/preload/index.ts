import { contextBridge, ipcRenderer } from 'electron'
import type { capturedApi } from '../shared/contracts'

const api: Omit<capturedApi, 'capture'> = {
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status); ipcRenderer.on('updates:changed', listener); return () => ipcRenderer.removeListener('updates:changed', listener) },
  },
  notes: {
    onTaxonomyChanged: (callback) => { const listener = () => callback(); ipcRenderer.on('notes:taxonomy-changed', listener); return () => ipcRenderer.removeListener('notes:taxonomy-changed', listener) },
    migrationStatus:()=>ipcRenderer.invoke('notes:migration-status'), acknowledgeMigration:()=>ipcRenderer.invoke('notes:migration-acknowledge'),
    createSubcategory: input => ipcRenderer.invoke('notes:subcategory:create',input), updateSubcategory: input => ipcRenderer.invoke('notes:subcategory:update',input), deleteSubcategory: id => ipcRenderer.invoke('notes:subcategory:delete',id), reorderSubcategories: input => ipcRenderer.invoke('notes:subcategories:reorder',input), migrationReview: () => ipcRenderer.invoke('notes:migration-review'), resolveMigrationReview: input => ipcRenderer.invoke('notes:migration-review:resolve',input),
    list: (filter) => ipcRenderer.invoke('notes:list', filter), tags: () => ipcRenderer.invoke('notes:tags'), taxonomy: () => ipcRenderer.invoke('notes:taxonomy'), createCategory: (name) => ipcRenderer.invoke('notes:category:create', name), updateCategory: (input) => ipcRenderer.invoke('notes:category:update', input), deleteCategory: (id) => ipcRenderer.invoke('notes:category:delete', id), reorderCategories: (input) => ipcRenderer.invoke('notes:categories:reorder', input), reorderTags: (input) => ipcRenderer.invoke('notes:tags:reorder', input), createTag: (input) => ipcRenderer.invoke('notes:tag:create', input), updateTag: (input) => ipcRenderer.invoke('notes:tag:update', input), deleteTag: (id) => ipcRenderer.invoke('notes:tag:delete', id), get: (id) => ipcRenderer.invoke('notes:get', id), image: (id) => ipcRenderer.invoke('notes:image', id),
    update: (input) => ipcRenderer.invoke('notes:update', input), updateItem: (input) => ipcRenderer.invoke('notes:update-item', input), setCategory: (input) => ipcRenderer.invoke('notes:set-category', input), trash: (ids) => ipcRenderer.invoke('notes:trash', ids),
    setTags: (input) => ipcRenderer.invoke('notes:set-tags', input),
    restore: (ids) => ipcRenderer.invoke('notes:restore', ids), deletePermanently: (ids) => ipcRenderer.invoke('notes:delete-permanently', ids),
    copy: (ids) => ipcRenderer.invoke('notes:copy', ids),
    emptyTrash: () => ipcRenderer.invoke('notes:empty-trash'),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, seq: number) => callback(seq); ipcRenderer.on('notes:changed', listener); return () => ipcRenderer.removeListener('notes:changed', listener) },
  },
  planner: {
    backlogSummary: (later) => ipcRenderer.invoke('planner:backlog-summary', later),
    inbox: (input) => ipcRenderer.invoke('planner:inbox', input ?? {}), inboxCount: () => ipcRenderer.invoke('planner:inbox-count'), unfile: (id) => ipcRenderer.invoke('planner:unfile', id), classify: (input) => ipcRenderer.invoke('planner:classify', input),
    tasks: (from, to) => ipcRenderer.invoke('planner:tasks', { from, to }), move: (input) => ipcRenderer.invoke('planner:move', input),
    scheduleTask: (input) => ipcRenderer.invoke('planner:task:schedule', input), createTask: (input) => ipcRenderer.invoke('planner:task:create', input), updateEventTiming: (input) => ipcRenderer.invoke('planner:event:timing', input),
    backlog: (input) => ipcRenderer.invoke('planner:backlog', input ?? {}), setReady: (input) => ipcRenderer.invoke('planner:ready', input), setTaskCompleted: (input) => ipcRenderer.invoke('planner:complete', input), reorderBacklog: (input) => ipcRenderer.invoke('planner:backlog-reorder', input),
    createEvent: (input) => ipcRenderer.invoke('planner:event:create', input), updateEvent: (input) => ipcRenderer.invoke('planner:event:update', input),
    deleteEvent: (id, scope) => ipcRenderer.invoke('planner:event:delete', id, scope), undoDeleteEvent: (snapshot) => ipcRenderer.invoke('planner:event:undo-delete', snapshot),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, seq: number) => callback(seq); ipcRenderer.on('planner:changed', listener); return () => ipcRenderer.removeListener('planner:changed', listener) },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'), update: (input) => ipcRenderer.invoke('settings:update', input),
    onChanged: (callback) => { const listener = () => callback(); ipcRenderer.on('settings:changed', listener); return () => ipcRenderer.removeListener('settings:changed', listener) },
    openFolder: () => ipcRenderer.invoke('settings:open-folder'),
    displays: () => ipcRenderer.invoke('settings:displays'),
  },
  data: {
    export: (input) => ipcRenderer.invoke('data:export', input), backup: () => ipcRenderer.invoke('data:backup'), restore: () => ipcRenderer.invoke('data:restore'), diagnostics: () => ipcRenderer.invoke('data:diagnostics'),
  },
  windows: {
    openCapture: context => ipcRenderer.send('windows:open-capture',context), openNotes: () => ipcRenderer.send('windows:open-notes'),
    openSettings: () => ipcRenderer.send('windows:open-settings'), quit: () => ipcRenderer.send('app:quit'),
    ready: () => ipcRenderer.send('notes:ready'),
    onView: (callback) => { const listener = (_event: Electron.IpcRendererEvent, view: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings') => callback(view); ipcRenderer.on('notes:view', listener); return () => ipcRenderer.removeListener('notes:view', listener) },
  },
}

contextBridge.exposeInMainWorld('captured', api)
