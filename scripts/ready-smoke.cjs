const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'captured-ready-smoke-'))
const output = path.resolve(__dirname, '../tests/.visual')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')
require('../out/main/index.js')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 80; i++) {
    win = BrowserWindow.getAllWindows().find((item) => item.webContents.getURL().endsWith('/index.html'))
    if (win && await win.webContents.executeJavaScript('document.documentElement.dataset.windowReady === "true"')) break
    await wait(100)
  }
  assert.ok(win)
  win.setSize(1180, 800)
  const evaluate = (code) => win.webContents.executeJavaScript(code)
  const until = async (code) => {
    for (let i = 0; i < 80; i++) { if (await evaluate(code)) return; await wait(100) }
    throw Error(`Timed out: ${code}`)
  }
  const nav = async (label) => { await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button => button.textContent.trim() === ${JSON.stringify(label)}).click()`); await wait(250) }
  const seeded = await evaluate(`(async () => {
    const unwrap = result => { if (!result.ok) throw Error(result.message); return result.value };
    const work = unwrap(await window.captured.notes.createCategory('Work'));
    const personal = unwrap(await window.captured.notes.createCategory('Personal'));
    const empty = unwrap(await window.captured.notes.createCategory('Empty category'));
    const make = async (body, categoryId, kind = 'ready') => unwrap(await window.captured.planner.createTask({body, categoryId, tags:['Planning'], placement:{kind}}));
    const first = await make('Prepare the release\\nReview all changes\\nConfirm the launch checklist', work.id);
    const second = await make('Review customer feedback', work.id);
    const third = await make('Plan next iteration', work.id);
    await make('Book a weekend trip', personal.id);
    await make('Decide where this belongs', null);
    await make('Hidden backlog task', empty.id, 'backlog');
    return {work,personal,empty,first,second,third};
  })()`)
  await nav('Ready')
  await until(`document.querySelectorAll('.ready-column').length === 3`)
  const columnNames = () => evaluate(`[...document.querySelectorAll('.ready-column-header [data-slot="frame-panel-title"]')].map(el=>el.textContent)`)
  assert.deepEqual(await columnNames(), ['Work', 'Personal', 'Unassigned'])
  assert.equal(await evaluate(`document.querySelector('.ready-card-text').textContent`), 'Prepare the release\nReview all changes\nConfirm the launch checklist')
  const workOrder = () => evaluate(`[...document.querySelector('.ready-column-content').querySelectorAll('.ready-card')].map(el=>el.dataset.value)`)
  const rect = (id, handle = false) => evaluate(`(() => { const el=document.querySelector('[data-slot="kanban-item"][data-value="${id}"]')${handle ? '.querySelector(".ready-card-handle")' : ''}; const r=el.getBoundingClientRect(); return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)} })()`)
  const start = await rect(seeded.third.id, true), end = await rect(seeded.first.id)
  win.webContents.sendInputEvent({ type:'mouseMove', ...start })
  win.webContents.sendInputEvent({ type:'mouseDown', ...start, button:'left', clickCount:1 })
  for (let step = 1; step <= 16; step++) {
    win.webContents.sendInputEvent({type:'mouseMove', x:Math.round(start.x+(end.x-start.x)*step/16), y:Math.round(start.y+(end.y-start.y)*step/16), button:'left'})
    await wait(25)
  }
  win.webContents.sendInputEvent({type:'mouseUp', ...end, button:'left', clickCount:1})
  await until(`document.querySelector('.ready-column-content .ready-card')?.dataset.value === '${seeded.third.id}'`)
  assert.deepEqual(await workOrder(), [seeded.third.id, seeded.first.id, seeded.second.id])
  win.reload()
  await until(`document.documentElement.dataset.windowReady === 'true'`)
  await nav('Ready')
  await until(`document.querySelectorAll('.ready-column').length === 3`)
  assert.deepEqual(await workOrder(), [seeded.third.id, seeded.first.id, seeded.second.id])
  await evaluate(`window.captured.notes.reorderCategories({ids:${JSON.stringify([seeded.personal.id, seeded.empty.id, seeded.work.id])}})`)
  await until(`document.querySelector('.ready-column-header [data-slot="frame-panel-title"]')?.textContent === 'Personal'`)
  assert.deepEqual(await columnNames(), ['Personal', 'Work', 'Unassigned'])
  await evaluate(`document.querySelector('.ready-card-text').click()`)
  await until(`Boolean(document.querySelector('[role="dialog"]'))`)
  await evaluate(`[...document.querySelectorAll('[role="dialog"] button')].find(button => button.textContent.trim() === 'Close').click()`)
  await until(`!document.querySelector('[role="dialog"]')`)
  // Capture a static offscreen render of the actual board for layout review.
  const html = await evaluate('document.documentElement.outerHTML')
  const file = path.join(profile, 'ready.html')
  const base = pathToFileURL(path.resolve(__dirname, '../out/renderer/index.html')).href
  fs.writeFileSync(file, html.replace('<head>', `<head><base href="${base}">`))
  const preview = new BrowserWindow({width:1180,height:800,show:false,webPreferences:{offscreen:true,javascript:false}})
  await preview.loadFile(file); await wait(350)
  fs.writeFileSync(path.join(output, 'ready-board.png'), (await preview.webContents.capturePage()).toPNG())
  preview.destroy()
  await nav('Calendar')
  await until(`document.querySelectorAll('.calendar-ready-task').length === 5`)
  await nav('Ready')
  await until(`document.querySelectorAll('.ready-column').length === 3`)
  await evaluate(`(async()=>{const key=new Date().toLocaleDateString('sv-SE');const data=await window.captured.planner.tasks(key,key);for(const task of data.value.tasks.filter(task=>task.ready&&!task.plannedDate))await window.captured.planner.setTaskCompleted({id:task.id,completed:true})})()`)
  await until(`document.querySelectorAll('.ready-column').length === 0 && document.querySelector('.ready-page .empty-state')`)
  process.stdout.write('ready_category_order=ok empty_columns=ok full_text=ok drag_reorder=ok reload_persistence=ok task_detail=ok calendar_ready=ok empty_board=ok\n')
  app.exit(0)
}).catch(error => { process.stderr.write(`${error.stack ?? error}\n`); app.exit(1) })

app.on('quit', () => {
  const target = path.resolve(profile)
  if (path.dirname(target) === tempRoot && path.basename(target).startsWith('captured-ready-smoke-')) {
    try { fs.rmSync(target, { recursive:true, force:true }) } catch {}
  }
})
