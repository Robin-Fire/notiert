import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { CalendarHoursSchema, SettingsSchema, type Settings } from '../shared/contracts'

const defaults: Settings = {
  shortcut: 'Control+N', shortcutEnabled: true, shortcutRegistered: false, launchAtLogin: false, theme: 'system', monitor: 'active',
  captureProtection: true, protectionTestApp: '', protectionTestDate: '', protectionTestOS: '', lastBackupAt: null, backupWarning: false, firstRunComplete: false, closeToTray: true,
  showCalendar: true, calendarStartMinute: 480, calendarEndMinute: 1080,
}

export class SettingsStore {
  private value: Settings = { ...defaults }
  private filePath = ''
  load() {
    this.filePath = path.join(app.getPath('userData'), 'settings.json')
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as Partial<Settings>
      if (!CalendarHoursSchema.safeParse({ ...defaults, ...parsed }).success) { parsed.calendarStartMinute = defaults.calendarStartMinute; parsed.calendarEndMinute = defaults.calendarEndMinute }
      this.value = SettingsSchema.parse({ ...defaults, ...parsed, shortcutRegistered: false })
    } catch { this.value = { ...defaults } }
  }
  get(): Settings { return { ...this.value } }
  patch(input: Partial<Settings>) {
    CalendarHoursSchema.parse({ ...this.value, ...input })
    this.value = SettingsSchema.parse({ ...this.value, ...input })
    this.write()
    return this.get()
  }
  setRegistration(registered: boolean) { this.value.shortcutRegistered = registered; this.write() }
  write() {
    if (!this.filePath) return
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true })
    const temp = `${this.filePath}.tmp`
    fs.writeFileSync(temp, JSON.stringify(this.value, null, 2), { encoding: 'utf8' })
    fs.renameSync(temp, this.filePath)
  }
}
