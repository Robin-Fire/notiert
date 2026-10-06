const { app, BrowserWindow, ipcMain } = require('electron')
const fs = require('fs')
const path = require('path')
const os = require('os')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'tests', '.visual')
const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'captured-visual-'))
const theme = process.env.PREVIEW_THEME === 'dark' ? 'dark' : 'light'
const view = process.env.PREVIEW_VIEW === 'inbox' ? 'inbox' : process.env.PREVIEW_VIEW === 'notes' ? 'notes' : 'calenban'
const mode = process.env.PREVIEW_MODE === 'week' ? 'week' : 'three'
const scene = process.env.PREVIEW_DETAIL || mode
const zoom = Number(process.env.PREVIEW_ZOOM || 1)
const filename = path.join(output, `${view}-${scene}-${theme}-${Math.round(zoom * 100)}.png`)
const moves = []
ipcMain.on('visual:move', (_event, input) => moves.push(input))
fs.mkdirSync(output, { recursive: true })
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')

app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 1040, height: 740, show: false, webPreferences: { preload: path.join(__dirname, 'visual-preload.cjs'), contextIsolation: true, sandbox: false, offscreen: true } })
  await window.loadFile(path.join(root, 'out/renderer/index.html'))
  window.webContents.setZoomFactor(zoom)
  await new Promise((resolve) => setTimeout(resolve, 500))
  async function click(selector) {
    const point = await window.webContents.executeJavaScript(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) } })()`)
    window.webContents.sendInputEvent({ type: 'mouseDown', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    window.webContents.sendInputEvent({ type: 'mouseUp', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  if (view === 'notes' && process.env.PREVIEW_DETAIL === 'edit') {
    await click('.note-row-open')
    await click('.edit-button')
  }
  if (view === 'calenban' && process.env.PREVIEW_DETAIL === 'task') await click('.planner-task-title')
  if (view === 'calenban' && mode === 'week') {
    await click('.planner-view-switch button:last-child')
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
  const dragKind = process.env.PREVIEW_DRAG
  if (view === 'calenban' && ['lane', 'card', 'overdue'].includes(dragKind)) {
    const startSelector = dragKind === 'overdue' ? '.overdue-tray .reui-kanban-item-handle' : '.unscheduled-pane .reui-kanban-item-handle'
    const endSelector = dragKind === 'card' ? '.reui-kanban-column:nth-child(2) .reui-kanban-item' : '.reui-kanban-column:nth-child(2) .day-end-slot > .reui-kanban-column-content'
    const points = await window.webContents.executeJavaScript(`(() => { const start = document.querySelector(${JSON.stringify(startSelector)}).getBoundingClientRect(); const end = document.querySelector(${JSON.stringify(endSelector)}).getBoundingClientRect(); return { start: { x: Math.round(start.left + start.width / 2), y: Math.round(start.top + start.height / 2) }, end: { x: Math.round(end.left + end.width / 2), y: Math.round(${dragKind === 'card' ? 'end.top + 12' : 'end.bottom - 18'}) } } })()`)
    window.webContents.sendInputEvent({ type: 'mouseMove', x: points.start.x, y: points.start.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: points.start.x, y: points.start.y, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 12; step++) {
      const x = Math.round(points.start.x + (points.end.x - points.start.x) * step / 12)
      const y = Math.round(points.start.y + (points.end.y - points.start.y) * step / 12)
      window.webContents.sendInputEvent({ type: 'mouseMove', x, y, button: 'left', movementX: x - points.start.x, movementY: y - points.start.y })
      await new Promise((resolve) => setTimeout(resolve, 16))
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: points.end.x, y: points.end.y, button: 'left', clickCount: 1 })
    await new Promise((resolve) => setTimeout(resolve, 300))
    fs.writeFileSync(path.join(output, `drag-${dragKind}.json`), JSON.stringify({ points, moves }))
  }
  const image = await window.webContents.capturePage()
  fs.writeFileSync(filename, image.toPNG())
  const metrics = await window.webContents.executeJavaScript(`(() => { const board = document.querySelector('.reui-kanban-board'); return { columns: document.querySelectorAll('.reui-kanban-column').length, width: board?.clientWidth, contentWidth: board?.scrollWidth, viewportWidth: window.innerWidth, pixelRatio: window.devicePixelRatio } })()`)
  fs.writeFileSync(path.join(output, `${view}-${scene}-${theme}-${Math.round(zoom * 100)}.json`), JSON.stringify(metrics))
  window.destroy()
  app.quit()
}).catch((error) => { fs.writeFileSync(path.join(output, 'error.txt'), String(error.stack ?? error)); app.exit(1) })

app.on('before-quit', () => {
  const target = path.resolve(profile)
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('captured-visual-')) return
  try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
})
