export function taggedTaskOrderKey(tagIds: string[]): string {
  return `tagged-task-order:${JSON.stringify([...tagIds].sort())}`
}

export function reorderTaggedTaskIds(ids: string[], id: string, targetId: string, after: boolean) {
  if (id === targetId || !ids.includes(id)) return null
  const remaining = ids.filter((entry) => entry !== id)
  const target = remaining.indexOf(targetId)
  if (target < 0) return null
  remaining.splice(target + Number(after), 0, id)
  return remaining
}
