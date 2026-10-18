import { contextBridge, ipcRenderer } from 'electron'
import type { capturedApi } from '../shared/contracts'

const api: Omit<capturedApi, 'capture'> = {
  taskWorkspace: {
    list: input => ipcRenderer.invoke('tasks:list', input),
    overview: input => ipcRenderer.invoke('tasks:overview', input),
    complete: input => ipcRenderer.invoke('tasks:complete', input),
    undoCompletion: input => ipcRenderer.invoke('tasks:undo-completion', input),
    move: input => ipcRenderer.invoke('tasks:move', input),
    moveMany: input => ipcRenderer.invoke('tasks:move-many', input),
    undo: input => ipcRenderer.invoke('tasks:undo', input),
    create: input => ipcRenderer.invoke('tasks:create', input),
  },
  updates: {
    getStatus: () => ipcRenderer.invoke('updates:status'),
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.invoke('updates:install'),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status); ipcRenderer.on('updates:changed', listener); return () => ipcRenderer.removeListener('updates:changed', listener) },
  },
  items: {
    onTaxonomyChanged: (callback) => { const listener = () => callback(); ipcRenderer.on('items:taxonomy-changed', listener); return () => ipcRenderer.removeListener('items:taxonomy-changed', listener) },
    migrationStatus:()=>ipcRenderer.invoke('items:migration-status'), acknowledgeMigration:()=>ipcRenderer.invoke('items:migration-acknowledge'),
    createSubcategory: input => ipcRenderer.invoke('items:subcategory:create',input), updateSubcategory: input => ipcRenderer.invoke('items:subcategory:update',input), deleteSubcategory: id => ipcRenderer.invoke('items:subcategory:delete',id), reorderSubcategories: input => ipcRenderer.invoke('items:subcategories:reorder',input), migrationReview: () => ipcRenderer.invoke('items:migration-review'), resolveMigrationReview: input => ipcRenderer.invoke('items:migration-review:resolve',input),
    list: (filter) => ipcRenderer.invoke('items:list', filter), tags: () => ipcRenderer.invoke('items:tags'), taxonomy: () => ipcRenderer.invoke('items:taxonomy'), createCategory: (name) => ipcRenderer.invoke('items:category:create', name), updateCategory: (input) => ipcRenderer.invoke('items:category:update', input), deleteCategory: (id) => ipcRenderer.invoke('items:category:delete', id), reorderCategories: (input) => ipcRenderer.invoke('items:categories:reorder', input), reorderTags: (input) => ipcRenderer.invoke('items:tags:reorder', input), createTag: (input) => ipcRenderer.invoke('items:tag:create', input), updateTag: (input) => ipcRenderer.invoke('items:tag:update', input), deleteTag: (id) => ipcRenderer.invoke('items:tag:delete', id), get: (id) => ipcRenderer.invoke('items:get', id), image: (id) => ipcRenderer.invoke('items:image', id),
    update: (input) => ipcRenderer.invoke('items:update', input), updateItem: (input) => ipcRenderer.invoke('items:update-item', input), setCategory: (input) => ipcRenderer.invoke('items:set-category', input), trash: (ids) => ipcRenderer.invoke('items:trash', ids),
    setTags: (input) => ipcRenderer.invoke('items:set-tags', input),
    restore: (ids) => ipcRenderer.invoke('items:restore', ids), deletePermanently: (ids) => ipcRenderer.invoke('items:delete-permanently', ids),
    copy: (ids) => ipcRenderer.invoke('items:copy', ids),
    emptyTrash: () => ipcRenderer.invoke('items:empty-trash'),
    onChanged: (callback) => { const listener = (_event: Electron.IpcRendererEvent, seq: number) => callback(seq); ipcRenderer.on('items:changed', listener); return () => ipcRenderer.removeListener('items:changed', listener) },
  },
  planner: {
    backlogSummary: (later) => ipcRenderer.invoke('planner:backlog-summary', later),
    backlogCount: () => ipcRenderer.invoke('planner:backlog-count'),
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
    openCapture: context => ipcRenderer.send('windows:open-capture',context), openTasks: () => ipcRenderer.send('windows:open-tasks'),
    openSettings: () => ipcRenderer.send('windows:open-settings'), quit: () => ipcRenderer.send('app:quit'),
    ready: () => ipcRenderer.send('items:ready'),
    onView: (callback) => { const listener = (_event: Electron.IpcRendererEvent, view: 'all' | 'inbox' | 'calenban' | 'trash' | 'settings') => callback(view); ipcRenderer.on('items:view', listener); return () => ipcRenderer.removeListener('items:view', listener) },
  },
}

contextBridge.exposeInMainWorld('captured', api)
