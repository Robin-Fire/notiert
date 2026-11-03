const { app, BrowserWindow, clipboard, ClipboardItem, nativeImage } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const root = path.resolve(os.tmpdir())
const profile = fs.mkdtempSync(path.join(root, 'captured-image-smoke-'))
fs.writeFileSync(path.join(profile, 'settings.json'), JSON.stringify({ firstRunComplete: true, shortcutEnabled: false, closeToTray: false }))
app.setPath('userData', profile)
require('../out/main/index.js')
const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
app.whenReady().then(async () => {
  let win
  for (let i = 0; i < 100; i++) {
    win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('/index.html'))
    if (win && await win.webContents.executeJavaScript('Boolean(window.captured?.items)')) break
    await wait(100)
  }
  assert.ok(win, 'Tasks window available')
  const original = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)]))))))
  try {
    const image = nativeImage.createFromBitmap(Buffer.from([0, 0, 255, 255]), { width: 1, height: 1 })
    for (const dataUrl of [image.toDataURL(), 'data:image/jpeg;base64,' + image.toJPEG(90).toString('base64')]) {
      const result = await win.webContents.executeJavaScript(`window.captured.items.copyImage(${JSON.stringify(dataUrl)})`)
      assert.equal(result.ok, true, JSON.stringify(result))
      const entries = await clipboard.read()
      const entry = entries.find(item => item.types.includes('image/png'))
      assert.ok(entry, 'Clipboard contains PNG')
      const blob = await entry.getType('image/png')
      const copied = nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer()))
      assert.deepEqual(copied.getSize(), { width: 1, height: 1 })
      assert.deepEqual([...copied.toBitmap()], [...nativeImage.createFromDataURL(dataUrl).toBitmap()])
    }
    for (const invalid of ['https://example.com/image.png', 'data:image/png;base64,YmFk']) {
      const result = await win.webContents.executeJavaScript(`window.captured.items.copyImage(${JSON.stringify(invalid)})`)
      assert.equal(result.ok, false)
      assert.equal(await clipboard.has('image/png'), true, 'Invalid input preserves clipboard')
    }
  } finally {
    if (original.length) await clipboard.write(original)
    else clipboard.clear()
  }
  console.log('image clipboard IPC: PNG, JPEG, invalid input, pixel roundtrip passed')
  app.exit(0)
}).catch(error => { console.error(error); app.exit(1) })
app.on('quit', () => {
  if (path.dirname(profile) === root && path.basename(profile).startsWith('captured-image-smoke-')) fs.rmSync(profile, { recursive: true, force: true })
})

