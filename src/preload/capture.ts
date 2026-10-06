import { contextBridge, ipcRenderer } from 'electron'
import type { capturedApi } from '../shared/contracts'

const capture: Pick<capturedApi, 'capture'> & { windows: Omit<capturedApi['windows'], 'onView' | 'ready'> } = {
  capture: {
    getState: () => ipcRenderer.invoke('capture:get-state'),
    subcategories: () => ipcRenderer.invoke('capture:subcategories'),
  categories: () => ipcRenderer.invoke('capture:categories'),
    updateDraft: (input) => ipcRenderer.invoke('capture:update-draft', input),
    flushBeforeQuit: (input) => ipcRenderer.invoke('capture:flush-before-quit', input),
    submit: (input) => ipcRenderer.invoke('capture:submit', input),
    addImage: (input) => ipcRenderer.invoke('capture:add-image', input),
    removeImage: (input) => ipcRenderer.invoke('capture:remove-image', input),
    dismiss: (reason) => ipcRenderer.invoke('capture:dismiss', reason),
    resize: (height) => ipcRenderer.send('capture:resize', height),
    onState: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, state: Parameters<typeof callback>[0]) => callback(state)
      ipcRenderer.on('capture:state', listener)
      return () => ipcRenderer.removeListener('capture:state', listener)
    },
    onQuitRequest: (callback) => { const listener = () => callback(); ipcRenderer.on('app:prepare-quit', listener); return () => ipcRenderer.removeListener('app:prepare-quit', listener) },
    respondToQuit: (saved, body) => ipcRenderer.send('app:quit-ready', { saved, body }),
    ready: () => ipcRenderer.send('capture:ready'),
  },
  windows: { openCapture: () => ipcRenderer.send('windows:open-capture'), openNotes: () => ipcRenderer.send('windows:open-notes'), openSettings: () => ipcRenderer.send('windows:open-settings'), quit: () => ipcRenderer.send('app:quit') },
}
contextBridge.exposeInMainWorld('captured', capture)
