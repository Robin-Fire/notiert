const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(root, 'captured-modal-style-'))
const output = path.resolve(__dirname, '../tests/.visual')
fs.mkdirSync(output, { recursive: true })
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false, captureProtection: false, theme: 'light' }))
app.setPath('userData', profile)
require('../out/main/index.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 60; i++) {
    win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'))
    if (win && await win.webContents.executeJavaScript('Boolean(document.querySelector(".sidebar"))')) break
    await wait(100)
  }
  win.setSize(1100, 800); win.show(); win.focus()
  const evaluate = async code => { try { return await win.webContents.executeJavaScript(code) } catch(error) { throw Error(code + ": " + error.message) } }
  const click = async code => { await evaluate(code); await wait(200) }
  const screenshot = async name => { await wait(200); fs.writeFileSync(path.join(output, name), (await win.webContents.capturePage()).toPNG()) }
  async function verifyDialog(selector) {
    const metrics = await evaluate(`(() => {
      const dialog = document.querySelector(${JSON.stringify(selector)}), r = dialog.getBoundingClientRect()
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight, overflow: dialog.scrollWidth > dialog.clientWidth + 1 }
    })()`)
    assert.ok(metrics.left >= 0 && metrics.right <= metrics.width && metrics.top >= 0 && metrics.bottom <= metrics.height, JSON.stringify(metrics))
    assert.equal(metrics.overflow, false, 'Dialog must not scroll horizontally')
  }
  await click(`document.querySelector('[aria-label="Add category"]').click()`)
  await verifyDialog('.taxonomy-dialog')
  await screenshot('modal-add-category-light.png')
  await click(`document.querySelector('.taxonomy-dialog input').focus()`)
  win.webContents.insertText('Modal review')
  await wait(100)
  await click(`document.querySelector('.taxonomy-dialog .button.primary').click()`)
  await click(`document.querySelector('[aria-label="Edit category Modal review"]').click()`)
  await verifyDialog('.taxonomy-dialog')
  await screenshot('modal-edit-category-light.png')
  await click(`document.querySelector('.taxonomy-dialog [data-slot="dialog-close"]').click()`)
  await click(`[...document.querySelectorAll('.tasks-heading button')].find(b => b.textContent.includes('Add task')).click()`)
  await verifyDialog('.tasks-dialog')
  await evaluate(`document.querySelector('.tasks-dialog textarea').focus()`)
  win.webContents.insertText('Review modal alignment')
  await wait(100)
  await click(`document.querySelector('.tasks-dialog [aria-label="Edit tags for task"]').click()`)
  await screenshot('modal-task-tags-light.png')
  win.webContents.sendInputEvent({type:'keyDown', keyCode:'Escape'})
  await wait(150)
  assert.equal(await evaluate(`Boolean(document.querySelector('.tasks-dialog'))`), true, 'Escape closes picker without closing modal')
  await evaluate(`document.querySelector('.tasks-dialog button[type="submit"]').focus()`)
  win.webContents.sendInputEvent({type:'keyDown', keyCode:'Tab'})
  await wait(100)
  assert.equal(await evaluate(`document.activeElement === document.querySelector('.tasks-dialog textarea')`), true, 'Tab stays in dialog')
  const focus = await evaluate(`({ color: getComputedStyle(document.activeElement).outlineColor, style: getComputedStyle(document.activeElement).outlineStyle })`)
  assert.equal(focus.style, 'solid'); assert.notEqual(focus.color, 'rgb(37, 99, 235)', 'Focus is neutral')
  await screenshot('modal-add-task-light.png')
  await evaluate(`window.captured.settings.update({theme:'dark'})`)
  await wait(150)
  await screenshot('modal-add-task-dark.png')
  await click(`document.querySelector('.tasks-dialog button[type="submit"]').click()`)
  await click(`document.querySelector('.tasks-board > [data-horizon="unplanned"].is-collapsed .tasks-column-heading button')?.click()`)
  await click(`document.querySelector('.tasks-card-body').click()`)
  await verifyDialog('.task-detail-dialog')
  const alignment = await evaluate(`(() => { const text = document.querySelector('.task-detail-editor').getBoundingClientRect(), category = document.querySelector('.task-detail-content .category-picker').getBoundingClientRect(); return Math.abs(text.left - category.left) })()`)
  assert.ok(alignment < 1, 'Editor and metadata share the same left edge')
  await screenshot('modal-task-detail-dark.png')
  await click(`[...document.querySelectorAll('.task-detail-primary-actions button')].find(b => b.textContent.trim() === 'Close').click()`)
  await click(`document.querySelector('.capture-button').click()`)
  let capture
  for (let i = 0; i < 60; i++) {
    capture = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/capture.html'))
    if (capture && await capture.webContents.executeJavaScript('Boolean(document.querySelector(".capture-tag-control > button"))')) break
    await wait(100)
  }
  capture.show(); capture.focus(); await wait(300)
  const controls = await capture.webContents.executeJavaScript(`(() => {
    const tag = document.querySelector('.capture-tag-control > button'), category = document.querySelector('[aria-label="Capture category"]')
    return { tag: tag.getBoundingClientRect().height, category: category.getBoundingClientRect().height, font: getComputedStyle(tag).fontSize }
  })()`)
  assert.ok(Math.abs(controls.tag - controls.category) < 1, 'Capture tags and category controls share a height')
  assert.equal(controls.font, '11px')
  fs.writeFileSync(path.join(output, 'quick-capture-compact-dark.png'), (await capture.webContents.capturePage()).toPNG())
  console.log('modal styles: category add/edit, task add/detail, tag popup, keyboard focus trap, neutral focus, light/dark passed')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
app.on('quit', () => { if (path.dirname(profile) === root && path.basename(profile).startsWith('captured-modal-style-')) { try { fs.rmSync(profile, {recursive:true, force:true}) } catch {} } })
