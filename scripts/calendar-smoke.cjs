const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'captured-calendar-smoke-'))
const output = path.resolve(__dirname, '../tests/.visual')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')
require('../out/main/index.js')
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

app.whenReady().then(async () => {
  let window
  for (let attempt = 0; attempt < 60; attempt++) {
    window = BrowserWindow.getAllWindows().find((win) => win.webContents.getURL().endsWith('/index.html'))
    if (window && await window.webContents.executeJavaScript('Boolean(document.querySelector(".sidebar"))')) break
    await wait(100)
  }
  if (!window) throw new Error('Notes window did not load')
  window.setSize(1180, 800)
  const evaluate = async (code) => {
    try { return await window.webContents.executeJavaScript(code) }
    catch (error) { console.error('Failed calendar smoke step:', code); throw error }
  }
  const until = async (code, description) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await evaluate(code)) return
      await wait(100)
    }
    const state = await evaluate(`({view:document.querySelector('.side-nav .active')?.textContent,alerts:[...document.querySelectorAll('[role="alert"]')].map(el=>el.textContent),text:document.querySelector('main')?.textContent?.slice(0,1500)})`)
    throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(state)}`)
  }
  await until(`document.documentElement.dataset.windowReady === 'true'`, 'initial window navigation')
  // Offscreen rendering avoids platform capture restrictions on desktop windows.
  async function screenshot(name, width = 1180, height = 800) {
    const html = await evaluate('document.documentElement.outerHTML')
    const file = path.join(profile, 'calendar-snapshot.html')
    const base = pathToFileURL(path.resolve(__dirname, '../out/renderer/index.html')).href
    fs.writeFileSync(file, html.replace('<head>', `<head><base href="${base}">`))
    const preview = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true, javascript: false } })
    try { await preview.loadFile(file); await wait(350); fs.writeFileSync(path.join(output, name), (await preview.webContents.capturePage()).toPNG()) }
    finally { preview.destroy() }
  }
  const errors = []
  window.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message) })
  const seeded = await evaluate(`(async () => {
    const date = new Date(); date.setHours(9,0,0,0);
    const meeting = await window.captured.planner.createEvent({title:'Design sync',startAt:date.getTime(),endAt:date.getTime()+3600000,allDay:false});
    date.setHours(11,0,0,0);
    const task = await window.captured.planner.createTask({body:'Prepare review',tags:['Planning'],categoryId:null,placement:{kind:'timed',startAt:date.getTime(),endAt:date.getTime()+3600000}});
    const ready = await window.captured.planner.createTask({body:'Ready for scheduling',placement:{kind:'ready'}});
    const key = [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    const untimed = await window.captured.planner.createEvent({title:'All-day meeting',startAt:new Date(key+'T00:00').getTime(),endAt:new Date(key+'T00:00').getTime()+86400000,allDay:true});
    return {meeting,task,ready,untimed,key};
  })()`)
  for (const name of ['meeting', 'task', 'ready', 'untimed']) assert.equal(seeded[name].ok, true, seeded[name].message)
  const clickText = async (text, selector = 'button') => {
    await evaluate(`(() => { const button=[...document.querySelectorAll(${JSON.stringify(selector)})].find((item)=>item.textContent.trim()===${JSON.stringify(text)}); if(!button) throw Error('Missing button '+${JSON.stringify(text)}); button.click(); })()`)
    await wait(250)
  }
  const backlogTask = await evaluate(`window.captured.planner.createTask({body:'Backlog to Ready regression',placement:{kind:'backlog'}})`)
  assert.equal(backlogTask.ok, true)
  await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button=>button.textContent.trim().startsWith('Backlog')).click()`)
  await until(`Boolean([...document.querySelectorAll('.backlog-task')].find(row=>row.textContent.includes('Backlog to Ready regression')))`, 'Backlog task')
  await evaluate(`(() => {const row=[...document.querySelectorAll('.backlog-task')].find(row=>row.textContent.includes('Backlog to Ready regression')); if(!row) throw Error('Backlog task missing'); [...row.querySelectorAll('button')].find(button=>button.textContent.trim()==='Add to Ready').click()})()`)
  await wait(300)
  await clickText('Calendar', '.side-nav button')
  await until(`Boolean(document.querySelector('.calendar-ready')?.textContent.includes('Backlog to Ready regression')) && Boolean(document.querySelector('[data-slot="event-calendar-day-column"]'))`, 'Calendar grid and Ready task')
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-ready')?.textContent.includes('Backlog to Ready regression'))`), true, 'Backlog task must appear in Ready')
  await evaluate(`window.captured.windows.ready(); window.captured.settings.get()`)
  await wait(100)
  assert.equal(await evaluate(`Boolean(document.querySelector('.calendar-page'))`), true, 'Duplicate renderer readiness must preserve Calendar navigation')
  const rect = async (selector, text, edge = 'center') => evaluate(`(() => {
    const elements=[...document.querySelectorAll(${JSON.stringify(selector)})];
    const element=${text ? `elements.find((item)=>item.textContent.includes(${JSON.stringify(text)}))` : 'elements[0]'};
    if(!element) throw Error('Missing drag element');
    const r=element.getBoundingClientRect();
    return {x:Math.round(r.left+r.width/2),y:Math.round(${edge === 'bottom' ? 'r.bottom-2' : 'r.top+r.height/2'}),left:r.left,top:r.top,width:r.width,height:r.height};
  })()`)
  const drag = async (start, end) => {
    window.webContents.sendInputEvent({ type: 'mouseMove', x: start.x, y: start.y })
    window.webContents.sendInputEvent({ type: 'mouseDown', x: start.x, y: start.y, button: 'left', clickCount: 1 })
    for (let step = 1; step <= 16; step++) {
      window.webContents.sendInputEvent({ type: 'mouseMove', x: Math.round(start.x + (end.x - start.x) * step / 16), y: Math.round(start.y + (end.y - start.y) * step / 16), button: 'left' })
      await wait(18)
    }
    window.webContents.sendInputEvent({ type: 'mouseUp', x: end.x, y: end.y, button: 'left', clickCount: 1 })
    await wait(550)
  }
  const columnWidth = (await rect('[data-slot="event-calendar-day-column"]')).width
  let position = await rect('[data-slot="event-calendar-event"]', 'Design sync')
  await drag(position, { x: Math.round(position.x + columnWidth), y: position.y })
  let data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  let meeting = data.value.events.find((event) => event.id === seeded.meeting.value.id)
  assert.ok(meeting.startAt > seeded.meeting.value.startAt, 'Meeting drag must persist a new date')
  const firstMeetingStart = meeting.startAt
  position = await evaluate(`(() => {const chip=[...document.querySelectorAll('[data-slot="event-calendar-event"]')].find((item)=>item.textContent.includes('Design sync'));const r=chip.querySelector('[data-edge="end"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`)
  await drag(position, { x: position.x, y: position.y + 32 })
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  meeting = data.value.events.find((event) => event.id === seeded.meeting.value.id)
  assert.equal(meeting.startAt, firstMeetingStart)
  assert.equal(meeting.endAt - meeting.startAt, 90 * 60_000, 'Meeting end resize must persist')

  position = await rect('[data-slot="event-calendar-event"]', 'Prepare review')
  await drag(position, { x: Math.round(position.x + columnWidth), y: position.y - 32 })
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  let task = data.value.tasks.find((entry) => entry.id === seeded.task.value.id)
  assert.ok(task.plannedStartAt !== seeded.task.value.plannedStartAt, 'Task move must persist')
  const movedStart = task.plannedStartAt
  position = await evaluate(`(() => {const chip=[...document.querySelectorAll('[data-slot="event-calendar-event"]')].find((item)=>item.textContent.includes('Prepare review'));const r=chip.querySelector('[data-edge="start"]').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`)
  await drag(position, { x: position.x, y: position.y + 16 })
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  task = data.value.tasks.find((entry) => entry.id === seeded.task.value.id)
  assert.equal(task.plannedStartAt, movedStart + 15 * 60_000, 'Task start resize must persist')

  // Pointer drag from Ready into the time grid.
  position = await rect('.calendar-ready-task', 'Ready for scheduling')
  const target = await rect('[data-slot="event-calendar-day-column"]')
  await drag(position, { x: target.x, y: Math.round(target.top + 4 * 64) })
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  const ready = data.value.tasks.find((entry) => entry.id === seeded.ready.value.id)
  assert.ok(ready.plannedStartAt !== null, 'External Ready drag must create a time block')

  // Return a scheduled task to Ready using the primitive's pointer gesture.
  position = await rect('[data-slot="event-calendar-event"]', 'Prepare review')
  const readyPane = await rect('[data-calendar-ready]')
  await drag(position, { x: readyPane.x, y: Math.round(readyPane.top + 180) })
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  task = data.value.tasks.find((entry) => entry.id === seeded.task.value.id)
  assert.equal(task.plannedStartAt, null); assert.equal(task.plannedDate, null); assert.equal(task.ready, true)

  await evaluate(`window.captured.settings.update({calendarStartMinute:495,calendarEndMinute:1005})`)
  await until(`document.querySelector('[data-slot="event-calendar-day-column"]')?.dataset.ecBoundsStart === '495'`, 'updated calendar hours')
  assert.equal(await evaluate(`document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecBoundsStart`), '495')
  await screenshot('calendar-three-light.png')
  const surfaces = await evaluate(`(() => {const chip=document.querySelector('[data-slot="event-calendar-event"]');const style=getComputedStyle(chip);return {background:style.backgroundColor,opacity:style.opacity,isolation:getComputedStyle(document.querySelector('.calendar-grid-pane')).isolation}})()`)
  assert.equal(surfaces.opacity, '1')
  assert.equal(surfaces.isolation, 'isolate')
  assert.ok(!surfaces.background.includes('/'), 'Event color must have no alpha channel')
  await evaluate(`[...document.querySelectorAll('[data-slot="event-calendar-event"]')].find(item=>item.textContent.includes('Design sync')).click()`)
  await until(`Boolean(document.querySelector('.modal-backdrop'))`, 'meeting dialog')
  await screenshot('calendar-modal-light.png')
  await clickText('Cancel', '.modal-backdrop button')
  await clickText('Workweek')
  assert.equal(await evaluate(`document.querySelectorAll('[data-slot="event-calendar-day-column"]').length`), 5)
  await evaluate(`window.captured.settings.update({theme:'dark'})`)
  await until(`document.documentElement.dataset.theme === 'dark' && document.querySelector('[data-slot="event-calendar-day-column"]')?.dataset.ecBoundsStart === '495'`, 'dark Calendar')
  assert.equal(await evaluate(`document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecBoundsStart`), '495', 'Theme changes must retain calendar hours')
  await screenshot('calendar-workweek-dark.png')
  window.setSize(1920,1080)
  await wait(150)
  await screenshot('calendar-workweek-large-dark.png',1920,1080)
  window.setSize(1180,800)
  window.webContents.reload()
  await until(`document.documentElement.dataset.windowReady === 'true'`, 'reloaded window navigation')
  await clickText('Calendar', '.side-nav button')
  await until(`document.querySelector('[data-slot="event-calendar-day-column"]')?.dataset.ecBoundsStart === '495'`, 'reloaded Calendar')
  assert.equal(await evaluate(`document.querySelector('[data-slot="event-calendar-day-column"]').dataset.ecBoundsStart`), '495')
  data = await evaluate(`window.captured.planner.tasks(${JSON.stringify(seeded.key)},'2099-12-31')`)
  assert.equal(data.value.events.find((event) => event.id === seeded.meeting.value.id).startAt, firstMeetingStart)
  assert.equal(data.value.tasks.find((entry) => entry.id === seeded.ready.value.id).plannedStartAt, ready.plannedStartAt)
  assert.equal(errors.length, 0, errors.join('\n'))
  process.stdout.write('calendar_meeting_drag_resize=ok task_drag_resize=ok ready_drag=ok unschedule_drag=ok settings=ok workweek=ok reload_persistence=ok screenshots=tests/.visual\n')
  app.exit(0)
}).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); app.exit(1) })

app.on('quit', () => {
  const target = path.resolve(profile)
  if (path.dirname(target) === tempRoot && path.basename(target).startsWith('captured-calendar-smoke-')) {
    try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
  }
})
