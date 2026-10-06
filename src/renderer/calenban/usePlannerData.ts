import { useCallback, useEffect, useRef, useState } from 'react'
import type { PlannerEvent, PlannerTask } from '../../shared/contracts'
import { resultValue as valueOf } from '../apiResult'

export function usePlannerData(from: string, to: string) {
  const [tasks, setTasks] = useState<PlannerTask[]>([])
  const [events, setEvents] = useState<PlannerEvent[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const requestNumber = useRef(0)
  const activeRange = useRef({ from, to })
  activeRange.current = { from, to }

  const refresh = useCallback(async () => {
    // A mutation started in an older view may finish after navigation.
    if (activeRange.current.from !== from || activeRange.current.to !== to) return
    const request = ++requestNumber.current
    setLoading(true)
    try {
      const data = valueOf(await window.captured.planner.tasks(from, to))
      if (request !== requestNumber.current) return
      setTasks(data.tasks)
      setEvents(data.events)
      setTags(data.tags)
      setError('')
    } catch (reason) {
      if (request === requestNumber.current) setError(reason instanceof Error ? reason.message : 'Calenban could not be loaded.')
    } finally {
      if (request === requestNumber.current) setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void refresh(); return () => { requestNumber.current++ } }, [refresh])
  useEffect(() => window.captured.planner.onChanged(() => { void refresh() }), [refresh])
  return { tasks, events, tags, loading, error, refresh }
}
