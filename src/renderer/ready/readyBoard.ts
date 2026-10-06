import type { Category, PlannerTask } from '../../shared/contracts'

export function readyColumns(categories: Category[], tasks: PlannerTask[]) {
  const grouped = new Map<string, PlannerTask[]>()
  for (const task of tasks) {
    if (!task.ready || task.plannedDate || task.completedAt !== null || task.later) continue
    const key = task.categoryId ?? 'unassigned'
    const items = grouped.get(key) ?? []
    items.push(task)
    grouped.set(key, items)
  }
  return [...categories.map((category) => ({ id: category.id, name: category.name })), { id: 'unassigned', name: 'Unassigned' }]
    .flatMap((category) => {
      const items = grouped.get(category.id)
      return items?.length ? [{ ...category, tasks: [...items].sort((a, b) => a.position - b.position || a.createdAt - b.createdAt || a.id.localeCompare(b.id)) }] : []
    })
}

export function readyMove(items: PlannerTask[], activeIndex: number, overIndex: number) {
  if (activeIndex < 0 || activeIndex >= items.length || overIndex < 0 || overIndex > items.length) return null
  const target = Math.min(overIndex, items.length - 1)
  if (activeIndex === target) return null
  const reordered = [...items]
  const [task] = reordered.splice(activeIndex, 1)
  reordered.splice(target, 0, task)
  return { id: task.id, plannedDate: null, beforeEventId: null, beforeId: reordered[target + 1]?.id ?? null }
}
