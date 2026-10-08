const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const tempRoot = path.resolve(os.tmpdir()), profile = fs.mkdtempSync(path.join(tempRoot, 'captured-tasks-smoke-'))
const output = path.resolve(__dirname, '../tests/.visual')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')
require('../out/main/index.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 80; i++) { win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().endsWith('/index.html')); if (win && await win.webContents.executeJavaScript('document.documentElement.dataset.windowReady === "true"')) break; await wait(100) }
  assert.ok(win, 'Notes window loaded')
  win.webContents.setBackgroundThrottling(false)
  win.setSize(1400, 850)
  const evaluate = async code => { try { return await win.webContents.executeJavaScript(code) } catch (error) { throw Error(`${code}: ${error.message}`) } }
  const until = async (code, label = code) => { for (let i = 0; i < 100; i++) { if (await evaluate(code)) return; await wait(100) } throw Error(`Timed out: ${label}: ${await evaluate(`document.querySelector('main')?.textContent`)}`) }
  const click = async (label, selector = 'button') => { await evaluate(`[...document.querySelectorAll(${JSON.stringify(selector)})].find(button=>button.textContent.trim()===${JSON.stringify(label)}).click()`); await wait(150) }
  const errors = []
  win.webContents.on('console-message', event => { if (event.level === 'error') errors.push(event.message) })
  const seeded = await evaluate(`(async()=>{
    const unwrap=result=>{if(!result.ok)throw Error(result.message);return result.value};
    const work=unwrap(await window.captured.notes.createCategory('Work')),personal=unwrap(await window.captured.notes.createCategory('Personal'));
    const iso=date=>date.toLocaleDateString('sv-SE'),today=iso(new Date()),tomorrow=new Date();tomorrow.setDate(tomorrow.getDate()+1);
    const monday=new Date();monday.setDate(monday.getDate()-((monday.getDay()+6)%7));const next=new Date(monday);next.setDate(next.getDate()+7);
    const create=async(body,categoryId,kind,targetDate=null)=>unwrap(await window.captured.taskWorkspace.create({body,categoryId,tags:['Planning'],intention:{kind,targetDate,position:0}}));
    await create('Send the revised proposal',work.id,'day',today);await create('Review customer feedback',work.id,'day',today);await create('Prepare the release checklist',work.id,'day',today);
    await create('Book an appointment',personal.id,'day',iso(tomorrow));await create('Update the team handbook',work.id,'week',iso(monday));await create('Plan the next iteration',work.id,'week',iso(next));await create('Organize the photo library',personal.id,'later');await create('Decide where this belongs',null,'unplanned');
    const date=new Date();date.setHours(10,0,0,0);const scheduled=unwrap(await window.captured.planner.createTask({body:'Scheduled review',categoryId:work.id,placement:{kind:'timed',startAt:date.getTime(),endAt:date.getTime()+3600000}}));
    return {work,personal,scheduled,today};
  })()`)
  await evaluate(`window.captured.windows.openCapture({categoryId:'${seeded.work.id}'})`)
  let captureWindow
  for(let attempt=0;attempt<60;attempt++){captureWindow=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/capture.html'));if(captureWindow && await captureWindow.webContents.executeJavaScript('Boolean(window.captured?.capture)'))break;await wait(100)}
  assert.ok(captureWindow)
  const capture=await captureWindow.webContents.executeJavaScript(`(async()=>{const state=await window.captured.capture.getState();const saved=await window.captured.capture.submit({requestId:crypto.randomUUID(),generation:state.value.generation,body:'Idea from the client call',categoryId:'${seeded.work.id}'});await window.captured.capture.dismiss('saved');return saved})()`)
  assert.equal(capture.ok,true,capture.message);seeded.capture=capture.value
  await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button=>button.textContent.trim().startsWith('Tasks')).click()`)
  await until(`document.querySelectorAll('.tasks-card').length===10`, 'all workspace cards')
  async function screenshot(name, width = 1400, height = 850) {
    const html = await evaluate(`(()=>{const clone=document.documentElement.cloneNode(true);document.querySelectorAll('select').forEach((select,index)=>{const copy=clone.querySelectorAll('select')[index];for(const option of copy.options)option.toggleAttribute('selected',option.value===select.value)});return clone.outerHTML})()`), file = path.join(profile, 'tasks-snapshot.html'), base = pathToFileURL(path.resolve(__dirname, '../out/renderer/index.html')).href
    fs.writeFileSync(file, html.replace('<head>', `<head><base href="${base}">`))
    const preview = new BrowserWindow({ width, height, show: false, webPreferences: { offscreen: true, javascript: false } })
    try { await preview.loadFile(file); await wait(400); fs.writeFileSync(path.join(output, name), (await preview.webContents.capturePage()).toPNG()) } finally { preview.destroy() }
  }
  await screenshot('tasks-time-light.png')
  const ids = () => evaluate(`[...document.querySelectorAll('.tasks-card')].map(card=>card.dataset.taskId).sort()`)
  const original = await ids()
  await click('By category'); assert.deepEqual(await ids(), original)
  await screenshot('tasks-category-light.png')
  await click('By time')
  // Drag an unscheduled task into another horizon.
  const task = (await evaluate(`window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Send the revised proposal'})`)).value.items[0]
  const rect = selector => evaluate(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(Math.max(270,Math.min(innerHeight-50,r.top+r.height/2)))}})()`)
  win.focus(); await wait(300)
  async function drag(source, destination) {
    const start=await rect(source)
    win.webContents.sendInputEvent({ type: 'mouseMove', ...start }); win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 })
    await wait(250)
    win.webContents.sendInputEvent({type:'mouseMove',x:start.x+10,y:start.y,button:'left'});await wait(250)
    const end=await rect(destination)
    for (let step=1;step<=20;step++){win.webContents.sendInputEvent({type:'mouseMove',x:Math.round(start.x+(end.x-start.x)*step/20),y:Math.round(start.y+(end.y-start.y)*step/20),button:'left'});await wait(25)}
    await wait(150);win.webContents.sendInputEvent({type:'mouseUp',...end,button:'left',clickCount:1});await wait(20);assert.equal(await evaluate(`Boolean(document.querySelector('.tasks-drag-preview'))`),false,'Drop removes overlay immediately without a return animation');await wait(230)
  }
  // Sort a capture in one action and exercise Undo.
  await drag(`[data-task-id="${seeded.capture.id}"] .tasks-drag-handle`,'.tasks-board > [data-horizon="tomorrow"] .tasks-section')
  await until(`document.querySelector('.tasks-notice')?.textContent.includes('Moved to Tomorrow')`, 'capture classification')
  assert.equal((await evaluate(`window.captured.notes.get('${seeded.capture.id}')`)).value.kind, 'task')
  await click('Undo'); await until(`document.querySelector('.tasks-notice')?.textContent.includes('Change undone')`, 'capture undo')
  assert.equal((await evaluate(`window.captured.notes.get('${seeded.capture.id}')`)).value.kind, 'inbox')
  await drag(`[data-task-id="${task.id}"] .tasks-drag-handle`,'.tasks-board > [data-horizon="tomorrow"] .tasks-section')
  await until(`document.querySelector('.tasks-notice')?.textContent.includes('Moved to Tomorrow')`, 'pointer horizon move')
  const moved = (await evaluate(`window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Send the revised proposal'})`)).value.items[0]
  assert.equal(moved.horizon, 'tomorrow'); assert.equal(moved.categoryId, seeded.work.id)
  await until(`document.querySelector('.tasks-page')?.getAttribute('aria-busy')==='false'`)
  const release=(await evaluate(`window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Prepare the release checklist'})`)).value.items[0]
  const feedback=(await evaluate(`window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Review customer feedback'})`)).value.items[0]
  await drag(`[data-task-id="${release.id}"] .tasks-drag-handle`,`[data-task-id="${feedback.id}"] .tasks-card-body`)
  await until(`document.querySelector('.tasks-board > [data-horizon="today"] .tasks-card')?.dataset.taskId==='${release.id}'`, 'same horizon reorder')
  await click('By category')
  await drag(`[data-task-id="${feedback.id}"] .tasks-drag-handle`,'.tasks-category-column:nth-child(2) .tasks-card-body')
  await until(`document.querySelector('.tasks-notice')?.textContent.includes('Moved to Tomorrow')`, 'category and horizon move')
  const cross=(await evaluate(`window.captured.notes.get('${feedback.id}')`)).value
  assert.equal(cross.categoryId,seeded.personal.id)
  await click('By time')
  const before = [seeded.scheduled.plannedDate, seeded.scheduled.plannedStartAt, seeded.scheduled.plannedEndAt]
  await evaluate(`(async()=>{const task=(await window.captured.notes.get('${seeded.scheduled.id}')).value;return window.captured.taskWorkspace.move({id:task.id,expectedRevision:task.revision,today:'${seeded.today}',intention:{kind:'later',targetDate:null,position:0}})})()`)
  const scheduled = (await evaluate(`window.captured.notes.get('${seeded.scheduled.id}')`)).value
  assert.deepEqual([scheduled.plannedDate, scheduled.plannedStartAt, scheduled.plannedEndAt], before)
  await evaluate(`window.captured.settings.update({theme:'dark'})`); await wait(200); await screenshot('tasks-time-dark.png')
  win.setSize(1050, 750); await wait(200); await screenshot('tasks-time-narrow.png', 1050, 750)
  const near=await evaluate(`(()=>{const board=document.querySelector('.tasks-board').getBoundingClientRect();return ['today','tomorrow','next-week'].every(h=>{const rect=document.querySelector('.tasks-board > [data-horizon="'+h+'"]').getBoundingClientRect();return rect.left>=board.left&&rect.right<=board.right})})()`);assert.equal(near,true,'Near-term columns fit together in the narrow window')
  await drag(`[data-task-id="${task.id}"] .tasks-drag-handle`,'.tasks-board > [data-horizon="later"]')
  await until(`document.querySelector('.tasks-notice')?.textContent.includes('Moved to Later')`,'drop on collapsed Later')
  assert.equal(await evaluate(`document.querySelectorAll('.tasks-card select').length`),0,'Cards move only by dragging')
  assert.equal(await evaluate(`document.querySelectorAll('[data-horizon="week"]').length`),0,'This week column removed')
  const bottom=await evaluate(`(async()=>{for(let i=0;i<12;i++){await window.captured.taskWorkspace.create({body:'Scroll check '+i+' Longer task text to verify that all columns grow with the page.',categoryId:'${seeded.work.id}',intention:{kind:'day',targetDate:'${seeded.today}',position:0}})}return (await window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Scroll check 11'})).value.items[0]})()`)
  await until(`Boolean(document.querySelector('[data-task-id="${bottom.id}"]'))`,'long page cards')
  const scroll=await evaluate(`(()=>{const page=document.querySelector('.tasks-page');return {scrollable:page.scrollHeight>page.clientHeight,columns:[...document.querySelectorAll('.tasks-column-content')].every(column=>!['auto','scroll'].includes(getComputedStyle(column).overflowY))}})()`)
  assert.equal(scroll.scrollable,true,'Whole page grows and scrolls');assert.equal(scroll.columns,true,'No column scroll containers')
  await evaluate(`document.querySelector('[data-task-id="${bottom.id}"]').scrollIntoView({block:'center'})`);await wait(150)
  assert.equal(await evaluate(`document.querySelector('.tasks-page').scrollTop>0`),true,'Page scrolls to lower cards')
  await drag(`[data-task-id="${bottom.id}"] .tasks-drag-handle`,'.tasks-board > [data-horizon="tomorrow"]')
  await until(`document.querySelector('.tasks-notice')?.textContent.includes('Moved to Tomorrow')`,'drag after whole-page scroll')
  assert.equal((await evaluate(`window.captured.taskWorkspace.list({today:'${seeded.today}',query:'Scroll check 11'})`)).value.items[0].horizon,'tomorrow')
  await click('Calendar', '.side-nav button'); await until(`document.querySelector('[data-slot="event-calendar-day-column"]')`, 'unchanged Calendar grid')
  assert.equal(errors.length, 0, errors.join('\n'))
  process.stdout.write('tasks_layouts=ok capture_sort_undo=ok pointer_move_reorder_category_collapsed=ok calendar_isolation=ok visual_light_dark_narrow=ok\n')
  app.exit(0)
}).catch(error => { process.stderr.write(`${error.stack ?? error}\n`); app.exit(1) })
app.on('quit', () => { const target = path.resolve(profile); if (path.dirname(target) === tempRoot && path.basename(target).startsWith('captured-tasks-smoke-')) { try { fs.rmSync(target, { recursive: true, force: true }) } catch {} } })
