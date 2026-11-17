import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ColorPalette } from './ColorPalette'
import { useState, type ReactNode } from 'react'
import { Hash, Trash2, Pencil } from 'lucide-react'
import type { TagRecord } from '../../shared/contracts'
import { resultValue } from '../apiResult'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
export function TaxonomyNav({
  tags, activeTagId, onTag, onChanged
}: {
  activeTagId?: string
  onTag: (id: string) => void
  tags: TagRecord[]
  onChanged: () => Promise<void>
}) {
  const [rename,setRename]=useState<{id:string;name:string;color:string}|null>(null)
  const [busy,setBusy]=useState(false)
  const [error, setError] = useState('')
  async function run(action:()=>Promise<unknown>) { if(busy)return; setBusy(true); setError(''); try{await action();await onChanged()}catch(reason){setError(reason instanceof Error?reason.message:'Could not save tags.')}finally{setBusy(false)} }
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
    await run(async () => resultValue(await window.captured.items.reorderTags({
      categoryId: null,
      ids: ordered.map((tag) => tag.id)
    })))
    setPendingTagOrder(null)
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete tag "${name}" from all tasks?`)) return
    await run(async () => {
      resultValue(await window.captured.items.deleteTag(id))
      setRename(null)
    })
  }
  function edit(item: TagRecord) {
    return {
      'aria-label': `Edit tag ${item.name}`,
      disabled: busy,
      title: `Edit ${item.name}`,
      onClick: () => {
        setError('')
        setRename({ id: item.id, name: item.name, color: item.color ?? '#85858e' })
      }
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
                active={activeTagId === item.id} onSelect={() => onTag(item.id)}>
                <button type="button" className="taxonomy-row-action" {...edit(item)}><Pencil size={13} /></button>
              </SortableTagRow>
            ))}
          </SortableContext>
        </DndContext>
      )}
      {error && !rename && <p role="alert" className="inline-error">{error}</p>}
    </section>
    <Dialog open={!!rename} onOpenChange={open => { if (!open && !busy) setRename(null) }}>
      <DialogContent className="taxonomy-dialog" showCloseButton={!busy}>
        <DialogTitle>Edit tag</DialogTitle>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {rename && (
          <form className="taxonomy-dialog-form" onSubmit={event => {
            event.preventDefault()
            void run(async () => {
              resultValue(await window.captured.items.updateTag({ ...rename, categoryId: null }))
              setRename(null)
            })
          }}>
            <label>
              Name
              <input autoFocus aria-label="Rename tag" maxLength={40} value={rename.name}
                onChange={event => setRename({ ...rename, name: event.target.value })} />
            </label>
            <div className="taxonomy-color-field">
              <span>Color</span>
              <ColorPalette value={rename.color} disabled={busy} onChange={color => setRename({ ...rename, color })} />
            </div>
            <div className="taxonomy-edit-tools">
              <button type="button" className="button secondary small danger-action" disabled={busy}
                onClick={() => void remove(rename.id, rename.name)}><Trash2 size={13} /> Delete</button>
            </div>
            <div className="dialog-actions">
              <button className="button secondary" disabled={busy} type="button" onClick={() => setRename(null)}>Cancel</button>
              <button className="button primary" disabled={busy || !rename.name.trim()}>Save</button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  </div>
}

function SortableTagRow({ tag, canReorder, active, onSelect, children }: {
  tag: TagRecord; canReorder: boolean; active: boolean; onSelect: () => void; children: ReactNode
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
        aria-pressed={active}
        onClick={onSelect}
      >
        <Hash size={15} color={tag.color} /><span className="taxonomy-name">{tag.name}</span>
        {!!tag.count && <small>{tag.count}</small>}
      </button>
      {children}
    </div>
  )
}
