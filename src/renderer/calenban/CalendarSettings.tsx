import { AppSelect } from '../components/AppSelect'
import { useEffect, useState } from 'react'
import { CalendarHoursSchema, type Settings, type SettingsUpdate } from '../../shared/contracts'
import { minuteLabel } from '../../shared/calendarSchedule'

const hours = Array.from({ length: 97 }, (_, index) => index * 15)
export function CalendarSettings({ settings, save }: { settings: Settings | null; save: (input: SettingsUpdate) => Promise<boolean> }) {
  const [start, setStart] = useState(settings?.calendarStartMinute ?? 480)
  const [end, setEnd] = useState(settings?.calendarEndMinute ?? 1080)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  useEffect(() => { setStart(settings?.calendarStartMinute ?? 480); setEnd(settings?.calendarEndMinute ?? 1080) }, [settings?.calendarStartMinute, settings?.calendarEndMinute])
  const valid = CalendarHoursSchema.safeParse({ calendarStartMinute: start, calendarEndMinute: end }).success
  return <><div className="settings-heading"><h2>Calendar</h2><p>Choose the hours shown in Day, 3 days, and Workweek.</p></div>
    <div className="setting-row"><div><b>Visible start time</b><span>The first time shown in the calendar.</span></div><AppSelect className="filter-select setting-select" aria-label="Calendar start time" value={start} disabled={busy} onChange={(event) => { setStart(Number(event.target.value)); setNotice('') }}>{hours.slice(0, -1).map((minute) => <option key={minute} value={minute}>{minuteLabel(minute)}</option>)}</AppSelect></div>
    <div className="setting-row"><div><b>Visible end time</b><span>Choose 24:00 to show through midnight.</span></div><AppSelect className="filter-select setting-select" aria-label="Calendar end time" value={end} disabled={busy} onChange={(event) => { setEnd(Number(event.target.value)); setNotice('') }}>{hours.slice(1).map((minute) => <option key={minute} value={minute}>{minuteLabel(minute)}</option>)}</AppSelect></div>
    {!valid && <p className="inline-error" role="alert">End time must be after start time.</p>}
    <div className="dialog-actions"><button className="button primary" disabled={!valid || busy || !settings} onClick={async () => { setBusy(true); try { const saved = await save({ calendarStartMinute: start, calendarEndMinute: end }); setNotice(saved ? 'Calendar hours saved.' : 'Could not save calendar hours.') } finally { setBusy(false) } }}>{busy ? 'Saving…' : 'Save calendar hours'}</button></div>
    <p className="setting-note">Changing these hours keeps your saved schedules. Items outside this range remain available from the calendar’s hidden-items list.</p>
    {notice && <p role="status">{notice}</p>}
  </>
}
