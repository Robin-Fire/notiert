const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'captured-item-edit-smoke-'))
const output = path.resolve(__dirname, '../tests/.visual')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')
require('../out/main/index.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  let window
  for (let i=0;i<60;i++) {
    window=BrowserWindow.getAllWindows().find(win=>win.webContents.getURL().endsWith('/index.html'))
    if(window&&await window.webContents.executeJavaScript('Boolean(document.querySelector(".sidebar"))'))break
    await wait(100)
  }
  if(!window)throw Error('Notes window did not load')
  window.setSize(1400,800)
  window.webContents.setBackgroundThrottling(false)
  const evaluate=async code=>{try{return await window.webContents.executeJavaScript(code)}catch(error){throw Error(`${code}: ${error.message}`)}}
  const until=async code=>{for(let i=0;i<80;i++){if(await evaluate(code))return;await wait(100)}throw Error(`Timed out: ${code}: ${await evaluate("document.querySelector('main')?.textContent")}`)}
  const expandUnplanned=async()=>{await until(`Boolean(document.querySelector('.tasks-page'))`);await evaluate(`document.querySelector('.tasks-board > [data-horizon="unplanned"].is-collapsed .tasks-column-heading button')?.click()`)}
  const errors=[]
  window.webContents.on('console-message',event=>{if(event.level==='error')errors.push(event.message)})
  const seeded=await evaluate(`(async()=>{
    const category=await window.captured.notes.createCategory('Work');if(!category.ok)throw Error(category.message);
    const other=await window.captured.notes.createCategory('Personal');
    const sub=await window.captured.notes.createSubcategory({name:'Project Alpha',categoryId:category.value.id});if(!sub.ok)throw Error(sub.message);
    const task=await window.captured.planner.createTask({body:'Screenshot context',categoryId:category.value.id,subcategoryId:sub.value.id,tags:['waiting','follow-up'],placement:{kind:'backlog'}});if(!task.ok)throw Error(task.message);
    return {category:category.value,other:other.value,sub:sub.value,task:task.value};
  })()`)
  await wait(350)
  await evaluate(`[...document.querySelectorAll('.note-row-open')].find(button=>button.textContent.includes('Screenshot context')).click()`)
  await wait(200)
  assert.equal(await evaluate(`Boolean(document.querySelector('.task-detail-dialog'))`),true)
  assert.equal(await evaluate(`Boolean(document.querySelector('.detail-panel'))`),false)
  await evaluate(`(()=>{
    const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8n+QAAAAASUVORK5CYII=';
    const bytes=Uint8Array.from(atob(png),value=>value.charCodeAt(0));
    const transfer=new DataTransfer();transfer.items.add(new File([bytes],'snip.png',{type:'image/png'}));
    document.querySelector('.task-detail-editor').dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));
  })()`)
  await wait(200)
  assert.equal(await evaluate(`document.querySelectorAll('.attachment-thumbnail').length`),1)
  const screenshot=async name=>{
    const html=await evaluate(`(()=>{const clone=document.documentElement.cloneNode(true);const selects=clone.querySelectorAll('select');document.querySelectorAll('select').forEach((live,index)=>{[...selects[index].options].forEach((option,position)=>{if(live.options[position].selected)option.setAttribute('selected','selected');else option.removeAttribute('selected')})});const areas=clone.querySelectorAll('textarea');document.querySelectorAll('textarea').forEach((live,index)=>{areas[index].textContent=live.value});return clone.outerHTML})()` )
    const file=path.join(profile,'snapshot.html'),base=pathToFileURL(path.resolve(__dirname,'../out/renderer/index.html')).href
    fs.writeFileSync(file,html.replace('<head>',`<head><base href="${base}">`))
    const preview=new BrowserWindow({width:1180,height:800,show:false,webPreferences:{offscreen:true,javascript:false}})
    try{await preview.loadFile(file);await wait(350);fs.writeFileSync(path.join(output,name),(await preview.webContents.capturePage()).toPNG())}finally{preview.destroy()}
  }
  await screenshot('taxonomy-editor-light.png')
  await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent.trim()==='Save').click()`)
  await wait(200)
  let saved=await evaluate(`window.captured.notes.get(${JSON.stringify(seeded.task.id)})`)
  assert.equal(saved.ok,true);assert.equal(saved.value.images.length,1);assert.equal(saved.value.subcategoryId,seeded.sub.id);assert.deepEqual(new Set(saved.value.tags),new Set(['waiting','follow-up']))
  const image=await evaluate(`window.captured.notes.image(${JSON.stringify(saved.value.images[0].id)})`);assert.equal(image.ok,true)
  const close = () => evaluate(`[...document.querySelectorAll('.task-detail-actions button')].find(button=>button.textContent.trim()==='Close').click()`)
  const checkImages = async () => {
    await wait(200)
    assert.equal(await evaluate(`document.querySelector('.task-detail-dialog .image-section-toggle').getAttribute('aria-expanded')`),'true')
    assert.equal(await evaluate(`document.querySelectorAll('.task-detail-dialog .attachment-thumbnail img').length`),1)
    assert.equal(await evaluate(`(()=>{const el=document.querySelector('.task-detail-dialog');return el.scrollHeight<=el.clientHeight||getComputedStyle(el).overflowY==='auto'})()`),true)
  }
  assert.equal(await evaluate(`Boolean(document.querySelector('.task-detail-dialog'))`),false)
  await evaluate(`[...document.querySelectorAll('.note-row-open')].find(button=>button.textContent.includes('Screenshot context')).click()`)
  await checkImages()
  assert.equal(await evaluate(`document.querySelector('.task-schedule-fields select').value`),'backlog')
  await screenshot('item-edit-all-light.png')
  await close()
  await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button=>button.textContent.trim().startsWith('Tasks')).click()`)
  await wait(300)
  await expandUnplanned()
  await until(`Boolean(document.querySelector('.tasks-card-body'))`)
  await evaluate(`document.querySelector('.tasks-card-body').click()`)
  await checkImages()
  await screenshot('item-edit-backlog-light.png')
  await evaluate(`[...document.querySelectorAll('.task-detail-actions button')].find(button=>button.textContent.trim()==='Return to captures').click()`)
  await wait(200)
  await evaluate(`[...document.querySelectorAll('.side-nav button')].find(button=>button.textContent.trim().startsWith('Tasks')).click()`)
  await wait(300)
  await expandUnplanned()
  await until(`Boolean(document.querySelector('.tasks-card-body'))`)
  await evaluate(`document.querySelector('.tasks-card-body').click()`)
  await checkImages()
  assert.equal(await evaluate(`document.querySelector('h2#task-detail-title').textContent`),'Edit inbox item')
  assert.equal(await evaluate(`document.querySelector('.task-schedule-fields')===null`),true)
  await screenshot('item-edit-inbox-light.png')
  await evaluate(`(()=>{const textarea=document.querySelector('.task-detail-editor');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(textarea,'Edited in Inbox');textarea.dispatchEvent(new Event('input',{bubbles:true}));})()`)
  await wait(100)
  await evaluate(`[...document.querySelectorAll('.task-detail-actions button')].find(button=>button.textContent.trim()==='Save').click()`)
  await wait(200)
  assert.equal(await evaluate(`document.querySelector('.tasks-page')!==null && document.querySelector('.task-detail-dialog')===null`),true)
  saved=await evaluate(`window.captured.notes.get(${JSON.stringify(seeded.task.id)})`)
  assert.equal(saved.value.body,'Edited in Inbox');assert.equal(saved.value.images.length,1)
  assert.equal(errors.length,0,errors.join('\n'))
  process.stdout.write('shared_editor=ok expanded_images=ok inbox_save=ok schedule=ok screenshots=tests/.visual\n')
  app.exit(0)
}).catch(error=>{process.stderr.write(`${error.stack??error}\n`);app.exit(1)})
app.on('quit',()=>{const target=path.resolve(profile);if(path.dirname(target)!==tempRoot||!path.basename(target).startsWith('captured-item-edit-smoke-'))return;try{fs.rmSync(target,{recursive:true,force:true})}catch{}})
