const { contextBridge, ipcRenderer } = require('electron')

const date = (offset) => {
  const value = new Date()
  value.setHours(0, 0, 0, 0)
  value.setDate(value.getDate() + offset)
  return value
}
const iso = (offset) => {
  const value = date(offset)
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}
const at = (offset, hour, minute = 0) => { const value = date(offset); value.setHours(hour, minute); return value.getTime() }
const event = (id, title, offset, hour, minute, lengthMinutes) => ({ id, title, startAt: at(offset, hour, minute), endAt: at(offset, hour, minute + lengthMinutes), allDay: false })
const events = [
  event('11111111-1111-4111-8111-111111111111', 'Design sync', 0, 9, 0, 35),
  event('22222222-2222-4222-8222-222222222222', 'Project review', 0, 11, 15, 45),
  event('33333333-3333-4333-8333-333333333333', 'Team standup', 1, 10, 0, 25),
  event('44444444-4444-4444-8444-444444444444', 'Customer call', 2, 14, 0, 60),
]
const task = (id, body, plannedDate, beforeEventId, position, tags = []) => ({ id, body, meetingId: null, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, revision: 1, kind: 'task', processedAt: Date.now(), tags, meetingTitle: null, status: 'open', plannedDate, beforeEventId, position })
const tasks = [
  task('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Prepare design questions\nBring the latest sketches', iso(0), events[0].id, 0, ['Design']),
  task('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Summarize feedback', iso(0), events[1].id, 0, ['Work']),
  task('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Write the follow-up and send it to the team', iso(0), null, 0, ['Work']),
  task('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Draft next iteration', iso(1), events[2].id, 0, ['Design']),
  task('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Check customer notes', iso(2), events[3].id, 0, ['Customer']),
  task('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Triage new idea', null, null, 0, ['Personal']),
  task('12121212-1212-4212-8212-121212121212', 'Plan the next release', null, null, 1, ['Work']),
  task('13131313-1313-4313-8313-131313131313', 'Review old checklist', iso(-2), null, 0, ['Work']),
]
const note = { id: '14141414-1414-4414-8414-141414141414', body: 'A reference note with details and tags.', meetingId: null, createdAt: Date.now(), updatedAt: Date.now(), deletedAt: null, revision: 1, kind: 'note', processedAt: Date.now(), tags: ['Work'], images: [], meetingTitle: null }
const capture = { ...note, id: '15151515-1515-4515-8515-151515151515', kind: 'inbox', body: 'An unfiled thought about the next design iteration', tags: [] }
const ok = (value) => Promise.resolve({ ok: true, value })
const noop = () => () => {}

contextBridge.exposeInMainWorld('captured', {
  notes: { list: () => ok({ items: [note], nextCursor: null, total: 1 }), tags: () => ok(['Customer', 'Design', 'Personal', 'Work']), get: () => ok(note), update: () => ok(note), updateItem: () => ok(note), setTags: () => ok(), trash: () => ok(), restore: () => ok(), deletePermanently: () => ok(), emptyTrash: () => ok(), copy: () => ok('Copied'), onChanged: noop },
  planner: { inbox: () => ok({ items: [capture], nextCursor: null, total: 1 }), inboxCount: () => ok(1), unfile: () => ok(), classify: () => ok(), tasks: () => ok({ tasks, events, tags: ['Customer', 'Design', 'Personal', 'Work'], completedUnscheduledTotal: 0 }), move: (input) => { ipcRenderer.send('visual:move', input); return ok() }, complete: () => ok(), createEvent: () => ok(events[0]), updateEvent: () => ok(events[0]), deleteEvent: () => ok({ event: events[0], anchors: [] }), undoDeleteEvent: () => ok(), onChanged: noop },
  settings: { get: () => ok({ shortcut: 'Control+N', shortcutEnabled: true, shortcutRegistered: true, launchAtLogin: false, theme: process.env.PREVIEW_THEME === 'dark' ? 'dark' : 'light', monitor: 'active', captureProtection: false, protectionTestApp: '', protectionTestDate: '', protectionTestOS: '', lastBackupAt: null, backupWarning: false, firstRunComplete: true, closeToTray: true }), displays: () => ok([]), update: () => ok(), onChanged: noop, openFolder: () => ok() },
  data: { export: () => ok(), backup: () => ok(), restore: () => ok(), diagnostics: () => ok() },
  windows: { openCapture() {}, openNotes() {}, openSettings() {}, quit() {}, ready() {}, onView(callback) { setTimeout(() => callback(process.env.PREVIEW_VIEW === 'inbox' ? 'inbox' : process.env.PREVIEW_VIEW === 'notes' ? 'all' : 'calenban'), 10); return () => {} } },
})
