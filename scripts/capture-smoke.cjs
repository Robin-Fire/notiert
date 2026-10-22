const selectOption = require('./select-option.cjs')
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const tempRoot = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(tempRoot, 'captured-capture-smoke-'))
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
app.commandLine.appendSwitch('disable-gpu')
require('../out/main/index.js')

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const findWindow = (name) => BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith(`/${name}.html`))

app.whenReady().then(async () => {
  for (let attempt = 0; attempt < 50 && !findWindow('index'); attempt++) await wait(100)
  const notes = findWindow('index')
  if (!notes) throw new Error('Task window did not load')
  const originalExecute = notes.webContents.executeJavaScript.bind(notes.webContents)
  notes.webContents.executeJavaScript = async code => { try { return await originalExecute(code) } catch (error) { console.error('Failed main-window capture smoke step:', code); throw error } }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await notes.webContents.executeJavaScript("document.documentElement.dataset.windowReady === 'true'")) break
    await wait(100)
  }
  await notes.webContents.executeJavaScript("[...document.querySelectorAll('.side-nav button')].find((button) => button.textContent.trim()==='Tasks').click()")
  await wait(300)
  const createdCategory = await notes.webContents.executeJavaScript("window.captured.items.createCategory('Capture smoke')")
  if (!createdCategory.ok) throw new Error(`Category creation failed: ${createdCategory.message}`)
  const categoryId = createdCategory.value.id
  const subcategory = await notes.webContents.executeJavaScript(`window.captured.items.createSubcategory({ name: 'Nested capture', categoryId: '${categoryId}' })`)
  if (!subcategory.ok) throw new Error('Subcategory creation failed')
  const subcategoryId = subcategory.value.id
  await notes.webContents.executeJavaScript("document.querySelector('.sidebar-capture').click()")
  for (let attempt = 0; attempt < 50 && !findWindow('capture'); attempt++) await wait(100)
  const capture = findWindow('capture')
  if (!capture) throw new Error('Capture window did not load')
  const captureExecute = capture.webContents.executeJavaScript.bind(capture.webContents)
  capture.webContents.executeJavaScript = async code => { try { return await captureExecute(code) } catch (error) { console.error('Failed capture-window smoke step:', code); throw error } }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await capture.webContents.executeJavaScript("Boolean(document.querySelector('.capture-input'))")) break
    await wait(100)
  }
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await capture.webContents.executeJavaScript("Boolean(document.querySelector('[aria-label=\"Capture category\"]'))")) break
    await wait(100)
  }
  await selectOption(code=>capture.webContents.executeJavaScript(code), '[aria-label="Capture category"]', categoryId)
  await selectOption(code=>capture.webContents.executeJavaScript(code), '[aria-label="Capture category"]', `subcategory:${subcategoryId}`)
  await capture.webContents.executeJavaScript("document.querySelector('input[aria-label=\"Capture tags\"]').focus()")
  await capture.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[aria-label="Capture tags"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'focus, follow up'); input.dispatchEvent(new Event('input', { bubbles: true })); })()` )
  await wait(150)
  await capture.webContents.executeJavaScript(`document.querySelector('input[aria-label="Capture tags"]').dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true, cancelable: true}))`)
  await capture.webContents.executeJavaScript("document.querySelector('.capture-input').focus()")
  await wait(300)
  const draft = await capture.webContents.executeJavaScript("window.captured.capture.getState()")
  if (!draft.ok || draft.value.subcategoryId !== subcategoryId || draft.value.tags.join(',') !== 'focus,follow up') throw new Error(`Capture metadata not persisted: ${JSON.stringify(draft)}`)
  capture.webContents.insertText('Capture smoke test')
  await wait(400)
  const before = await capture.webContents.executeJavaScript("({ text: document.querySelector('.capture-input').value, disabled: document.querySelector('.capture-submit')?.disabled, error: document.querySelector('.capture-alert')?.innerText })")
  if (before.text !== 'Capture smoke test' || before.disabled) throw new Error(`Capture entry failed: ${JSON.stringify(before)}`)
  await capture.webContents.executeJavaScript("document.querySelector('.capture-submit').click()")
  await wait(500)
  const after = await capture.webContents.executeJavaScript("({ text: document.querySelector('.capture-input').value, error: document.querySelector('.capture-alert')?.innerText })")
  const Database = require('better-sqlite3')
  const db = new Database(path.join(profile, 'captured.sqlite'), { readonly: true })
  const count = db.prepare("SELECT count(*) AS count FROM notes WHERE kind='task' AND body='Capture smoke test'").get().count
  const categorizedCount = db.prepare("SELECT count(*) AS count FROM notes WHERE kind='task' AND body='Capture smoke test' AND project_id=?").get(categoryId).count
  const metadata = db.prepare("SELECT subcategory_id FROM notes WHERE body='Capture smoke test'").get()
  const tags = db.prepare("SELECT t.name FROM item_tags t JOIN note_tags nt ON nt.tag_id=t.id JOIN notes n ON n.id=nt.note_id WHERE n.body='Capture smoke test' ORDER BY t.name").all().map(row => row.name)
  db.close()
  if (metadata.subcategory_id !== subcategoryId || tags.join(',') !== 'focus,follow up') throw new Error('Saved capture metadata mismatch')
  if (count !== 1 || categorizedCount !== 1) throw new Error(`Capture was not saved with its category: ${JSON.stringify({ after, count, categorizedCount })}`)
  let visible = false
  for (let attempt = 0; attempt < 30; attempt++) {
    visible = await notes.webContents.executeJavaScript("Boolean([...document.querySelectorAll('.tasks-card-body, .backlog-task-title')].some((item) => item.textContent === 'Capture smoke test'))")
    if (visible) break
    await wait(100)
  }
  if (!visible) throw new Error('Saved task did not appear in Tasks')
  await notes.webContents.executeJavaScript("document.querySelector('.sidebar-capture').click()")
  await wait(250)
  const rememberedCategory = await capture.webContents.executeJavaScript("document.querySelector('[aria-label=\"Capture category\"]').value")
  if (rememberedCategory !== `subcategory:${subcategoryId}`) throw new Error('Capture must remember its category after saving and reopening')
  const pasted = await capture.webContents.executeJavaScript(`(() => {
    const base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl8n+QAAAAASUVORK5CYII='
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], 'snip.png', { type: 'image/png' }))
    const input = document.querySelector('.capture-input')
    return input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })()`)
  for (let attempt = 0; attempt < 30; attempt++) {
    const ready = await capture.webContents.executeJavaScript("Boolean(document.querySelector('.capture-images img')) && !document.querySelector('.capture-submit').disabled")
    if (ready) break
    await wait(100)
  }
  const imageReady = await capture.webContents.executeJavaScript("Boolean(document.querySelector('.capture-images img')) && !document.querySelector('.capture-submit').disabled")
  if (!imageReady) throw new Error(`Image paste did not become ready: ${pasted}`)
  await capture.webContents.executeJavaScript("window.captured.capture.dismiss('escape')")
  await wait(150)
  await notes.webContents.executeJavaScript("window.captured.windows.openCapture()")
  await wait(200)
  if (await capture.webContents.executeJavaScript("document.querySelector('[aria-label=\"Capture category\"]').value") !== `subcategory:${subcategoryId}`) throw new Error('Image-only drafts must keep the session category')
  await capture.webContents.executeJavaScript("document.querySelector('.capture-submit').click()")
  await wait(350)
  const imageCount = dbImageCount(profile)
  if (imageCount !== 1) throw new Error(`Image-only capture was not saved: ${imageCount}`)
  for (let attempt = 0; attempt < 30; attempt++) {
    const hasRow = await notes.webContents.executeJavaScript("Boolean([...document.querySelectorAll('.tasks-card-body, .backlog-task-title')].find((item) => item.textContent.includes('Image capture')))")
    if (hasRow) break
    await wait(100)
  }
  await notes.webContents.executeJavaScript("[...document.querySelectorAll('.tasks-card-body, .backlog-task-title')].find((item) => item.textContent.includes('Image capture')).click()")
  await notes.webContents.executeJavaScript("(() => { const button=document.querySelector('.task-detail-dialog .image-section-toggle'); if(button?.getAttribute('aria-expanded')==='false')button.click(); })()")
  for (let attempt = 0; attempt < 30; attempt++) {
    const rendered = await notes.webContents.executeJavaScript("Boolean(document.querySelector('.task-detail-dialog .attachment-thumbnails img'))")
    if (rendered) break
    await wait(100)
  }
  const imageRendered = await notes.webContents.executeJavaScript("document.querySelector('.task-detail-dialog .attachment-thumbnails img')?.getAttribute('src')?.startsWith('data:image/png;base64,') ?? false")
  if (!imageRendered) throw new Error('Saved image did not render in item details')
  process.stdout.write(`capture_saved=${count} categorized_capture_saved=${categorizedCount} visible_in_backlog=${visible} image_capture_saved=${imageCount} image_rendered=${imageRendered}\n`)
  await notes.webContents.executeJavaScript("[...document.querySelectorAll('.task-detail-actions button')].find(button=>button.textContent.trim()==='Close')?.click()")
  await wait(300)
  app.exit(0)
}).catch((error) => { process.stderr.write(`${error.stack ?? error}\n`); app.exit(1) })

function dbImageCount(profilePath) {
  const Database = require('better-sqlite3')
  const db = new Database(path.join(profilePath, 'captured.sqlite'), { readonly: true })
  try { return db.prepare("SELECT count(*) AS count FROM notes n JOIN item_images i ON i.note_id=n.id WHERE n.kind='task' AND n.body=''").get().count }
  finally { db.close() }
}

app.on('quit', () => {
  const target = path.resolve(profile)
  if (path.dirname(target) !== tempRoot || !path.basename(target).startsWith('captured-capture-smoke-')) return
  try { fs.rmSync(target, { recursive: true, force: true }) } catch {}
})
