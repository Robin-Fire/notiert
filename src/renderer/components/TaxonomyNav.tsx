import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useState } from 'react'
import { Hash } from 'lucide-react'
import type { TagRecord } from '../../shared/contracts'
import { resultValue } from '../apiResult'
export function TaxonomyNav({
  tags, activeTagId, onTag, onChanged
}: {
  activeTagId?: string
  onTag: (id: string) => void
  tags: TagRecord[]
  onChanged: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pendingTagOrder, setPendingTagOrder] = useState<TagRecord[] | null>(null)
  const orderedTags = pendingTagOrder ?? tags
  const tagSensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], end: ['Space'], cancel: ['Escape'] }
    })
  )

  async function reorderTag({ active, over }: DragEndEvent) {
    if (busy || !over || active.id === over.id) return
    const from = tags.findIndex((tag) => tag.id === active.id)
    const to = tags.findIndex((tag) => tag.id === over.id)
    if (from < 0 || to < 0) return

    const ordered = arrayMove(tags, from, to)
    setPendingTagOrder(ordered)
    setBusy(true)
    setError('')
    try {
      resultValue(await window.captured.items.reorderTags({
        categoryId: null,
        ids: ordered.map((tag) => tag.id)
      }))
      await onChanged()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save tags.')
    } finally {
      setPendingTagOrder(null)
      setBusy(false)
    }
  }

  return <div className="taxonomy-navigation">
    <section aria-label="Tags">
      {orderedTags.length > 0 && (
        <DndContext
          sensors={tagSensors}
          collisionDetection={(args) => args.pointerCoordinates ? pointerWithin(args) : closestCenter(args)}
          onDragEnd={reorderTag}
          accessibility={{
            screenReaderInstructions: {
              draggable: 'Press Enter to toggle the tag filter. To reorder, press Space, use the arrow keys, then press Space to drop or Escape to cancel.'
            },
            announcements: {
              onDragStart: ({ active }) => `Picked up ${tags.find((tag) => tag.id === active.id)?.name}.`,
              onDragOver: ({ over }) => over
                ? `Position ${tags.findIndex((tag) => tag.id === over.id) + 1} of ${tags.length}.`
                : undefined,
              onDragEnd: ({ over }) => over ? 'Tag dropped.' : 'Tag reorder cancelled.',
              onDragCancel: () => 'Tag reorder cancelled.'
            }
          }}
        >
          <SortableContext items={orderedTags.map((tag) => tag.id)} strategy={verticalListSortingStrategy}>
            {orderedTags.map((item) => (
              <SortableTagRow key={item.id} tag={item} canReorder={!busy && orderedTags.length > 1}
                active={activeTagId === item.id} onSelect={() => onTag(item.id)} />
            ))}
          </SortableContext>
        </DndContext>
      )}
      {error && <p role="alert" className="inline-error">{error}</p>}
    </section>
  </div>
}

function SortableTagRow({ tag, canReorder, active, onSelect }: {
  tag: TagRecord; canReorder: boolean; active: boolean; onSelect: () => void
}) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } =
    useSortable({ id: tag.id, disabled: !canReorder })

  return (
    <div
      ref={setNodeRef}
      className="taxonomy-nav-row taxonomy-tag-row"
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <button
        {...(canReorder ? attributes : undefined)}
        {...listeners}
        ref={setActivatorNodeRef}
        type="button"
        className="taxonomy-filter"
        data-reorderable={canReorder || undefined}
        title={tag.name}
        aria-current={active ? 'page' : undefined}
        aria-pressed={active}
        onClick={onSelect}
      >
        <Hash size={15} color={tag.color} /><span className="taxonomy-name">{tag.name}</span>
        {!!tag.count && <small>{tag.count}</small>}
      </button>
    </div>
  )
}
