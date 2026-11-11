import { closestCenter, DndContext, KeyboardSensor, MouseSensor, TouchSensor, pointerWithin, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ColorPalette } from './ColorPalette'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, Hash, Plus, Trash2, Pencil, ArrowUp, ArrowDown } from 'lucide-react'
import type { Category, Subcategory, TagRecord } from '../../shared/contracts'
import { resultValue } from '../apiResult'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
export function TaxonomyNav({
  categories, subcategories, tags, activeCategory, activeSubcategory, activeTags, onCategory, onTag, onChanged
}: {
  activeCategory?: string
  activeSubcategory?: string
  activeTags: string[]
  onCategory: (id: string, subcategoryId?: string) => void
  onTag: (name: string) => void
  categories: Category[]
  subcategories: Subcategory[]
  tags: TagRecord[]
  onChanged: () => Promise<void>
}) {
  const drag=useRef<{kind:'category'|'subcategory';id:string;categoryId?:string}|null>(null)
  const [closed,setClosed]=useState<Record<string,boolean>>(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem('captured-sidebar-closed-v1') ?? '{}')
      if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
      return Object.fromEntries(Object.entries(stored).filter(([, value]) => typeof value === 'boolean'))
    } catch { return {} }
  })
  useEffect(() => {
    try { localStorage.setItem('captured-sidebar-closed-v1', JSON.stringify(closed)) } catch { /* Keep navigation usable if storage is unavailable. */ }
  }, [closed])
  const [adding,setAdding]=useState<string|null>(null)
  const [name,setName]=useState('')
  const [rename,setRename]=useState<{kind:'category'|'subcategory'|'tag';id:string;name:string;color?:string}|null>(null)
  const [busy,setBusy]=useState(false)
  const [error, setError] = useState('')
  async function run(action:()=>Promise<unknown>) { if(busy)return; setBusy(true); setError(''); try{await action();await onChanged()}catch(reason){setError(reason instanceof Error?reason.message:'Could not save taxonomy.')}finally{setBusy(false)} }
  async function add(){if(!adding)return;await run(async()=>{if(adding==='category')resultValue(await window.captured.items.createCategory(name));else if(adding==='tag')resultValue(await window.captured.items.createTag({name}));else resultValue(await window.captured.items.createSubcategory({name,categoryId:adding}));setAdding(null);setName('')})}
  function move(kind:'category'|'subcategory',id:string,direction:number,categoryId?:string){const group=kind==='category'?categories:subcategories.filter(item=>item.categoryId===categoryId);const ids=group.map(item=>item.id),index=ids.indexOf(id),target=index+direction;if(target<0||target>=ids.length)return;[ids[index],ids[target]]=[ids[target]!,ids[index]!];void run(async()=>resultValue(await(kind==='category'?window.captured.items.reorderCategories({ids}):window.captured.items.reorderSubcategories({categoryId:categoryId!,ids}))))}
  function dragProps(kind:'category'|'subcategory',id:string,categoryId?:string) {
    return {draggable:!busy,onDragStart:(event:React.DragEvent)=>{drag.current={kind,id,categoryId};event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',id);event.stopPropagation()},onDragEnd:()=>{drag.current=null},onDragOver:(event:React.DragEvent)=>{if(drag.current?.kind===kind&&drag.current.categoryId===categoryId)event.preventDefault()},onDrop:(event:React.DragEvent)=>{event.preventDefault();event.stopPropagation();const active=drag.current;drag.current=null;if(!active||active.kind!==kind||active.categoryId!==categoryId||active.id===id)return;const group=kind==='category'?categories:subcategories.filter(item=>item.categoryId===categoryId);const ids=group.map(item=>item.id),from=ids.indexOf(active.id),to=ids.indexOf(id);if(from<0||to<0)return;ids.splice(to,0,ids.splice(from,1)[0]!);void run(async()=>resultValue(await(kind==='category'?window.captured.items.reorderCategories({ids}):window.captured.items.reorderSubcategories({categoryId:categoryId!,ids}))))}}
  }
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

  async function remove(kind: 'category' | 'subcategory' | 'tag', id: string, name: string) {
    const message = kind === 'category'
      ? `Delete category "${name}" and its subcategories? Tasks become unassigned.`
      : kind === 'subcategory' ? `Delete subcategory "${name}"? Tasks stay in their category.`
      : `Delete tag "${name}" from all tasks?`
    if (!window.confirm(message)) return
    await run(async () => {
      resultValue(await (kind === 'category' ? window.captured.items.deleteCategory(id) : kind === 'subcategory' ? window.captured.items.deleteSubcategory(id) : window.captured.items.deleteTag(id)))
      setRename(null)
    })
  }
  function beginAdd(target: string) {
    setError('')
    setName('')
    setAdding(target)
    setClosed((current) => ({ ...current, [target === 'tag' ? 'tags' : 'categories']: false, [target]: false }))
  }
  function toggleSection(key: string) {
    setClosed((current) => ({ ...current, [key]: !current[key] }))
  }
  function edit(kind: 'category' | 'subcategory' | 'tag', item: Category | Subcategory | TagRecord) {
    return {
      'aria-label': `Edit ${kind} ${item.name}`,
      disabled: busy,
      title: `Edit ${item.name}`,
      onClick: () => {
        setError('')
        setRename({ kind, id: item.id, name: item.name, color: item.color ?? '#85858e' })
      }
    }
  }
  const form=adding&&<form className="taxonomy-dialog-form" onSubmit={event=>{event.preventDefault();void add()}}><input autoFocus aria-label={adding==='category'?'New category name':adding==='tag'?'New tag name':'New subcategory name'} placeholder="Name" maxLength={adding==='category'?60:40} value={name} onChange={event=>setName(event.target.value)}/><div className="dialog-actions"><button className="button secondary" disabled={busy} type="button" onClick={()=>setAdding(null)}>Cancel</button><button disabled={busy||!name.trim()} className="button primary" type="submit">Add</button></div></form>
  return <div className="taxonomy-navigation">
    <section aria-labelledby="sidebar-categories">
      <div className="category-section-heading">
        <h2 id="sidebar-categories">
          <button type="button" aria-expanded={!closed.categories} onClick={() => toggleSection('categories')}>
            {closed.categories ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Categories
          </button>
        </h2>
        <button type="button" aria-label="Add category" title="Add category" onClick={() => beginAdd('category')}><Plus size={16} /></button>
      </div>
      {!closed.categories && (
        categories.length ? categories.map((category) => {
          const children = subcategories.filter((item) => item.categoryId === category.id)
          return (
            <div className="category-group" key={category.id}>
              <div className="taxonomy-nav-row" data-kind="category">
                {children.length ? (
                  <button type="button" className="taxonomy-disclosure" aria-label={`${closed[category.id] ? 'Expand' : 'Collapse'} ${category.name}`}
                    aria-expanded={!closed[category.id]} onClick={() => toggleSection(category.id)}>
                    {closed[category.id] ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                ) : <span className="taxonomy-disclosure" />}
                <button type="button" className="taxonomy-filter" {...dragProps('category', category.id)} title={category.name}
                  aria-pressed={activeCategory === category.id && !activeSubcategory} onClick={() => onCategory(category.id)}>
                  <Folder size={15} color={category.color} /><span className="taxonomy-name">{category.name}</span>
                </button>
                <button type="button" className="taxonomy-row-action" {...edit('category', category)}><Pencil size={13} /></button>
                <button type="button" className="taxonomy-row-action" aria-label={`Add subcategory in ${category.name}`}
                  title="Add subcategory" onClick={() => beginAdd(category.id)}><Plus size={14} /></button>
              </div>
              {!!children.length && !closed[category.id] && <div className="category-children">
                {children.map((item) => (
                  <div className="taxonomy-nav-row" key={item.id}>
                    <button type="button" className="taxonomy-filter" {...dragProps('subcategory', item.id, item.categoryId)} title={item.name}
                      aria-pressed={activeSubcategory === item.id} onClick={() => onCategory(category.id, item.id)}>
                      <Folder size={14} color={item.color} /><span className="taxonomy-name">{item.name}</span>
                      {!!item.count && <small>{item.count}</small>}
                    </button>
                    <button type="button" className="taxonomy-row-action" {...edit('subcategory', item)}><Pencil size={13} /></button>
                  </div>
                ))}
              </div>}
            </div>
          )
        }) : <p className="taxonomy-empty">No categories yet</p>
      )}
    </section>
    <section aria-labelledby="sidebar-tags">
      <div className="category-section-heading">
        <h2 id="sidebar-tags">
          <button type="button" aria-expanded={!closed.tags} onClick={() => toggleSection('tags')}>
            {closed.tags ? <ChevronRight size={14} /> : <ChevronDown size={14} />} Tags
          </button>
        </h2>
        <button type="button" aria-label="Add tag" title="Add tag" onClick={() => beginAdd('tag')}><Plus size={16} /></button>
      </div>
      {!closed.tags && (
        orderedTags.length ? (
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
                  active={activeTags.includes(item.name)} onSelect={() => onTag(item.name)}>
                  <button type="button" className="taxonomy-row-action" {...edit('tag', item)}><Pencil size={13} /></button>
                </SortableTagRow>
              ))}
            </SortableContext>
          </DndContext>
        ) : <p className="taxonomy-empty">No tags yet</p>
      )}
      {error && !adding && !rename && <p role="alert" className="inline-error">{error}</p>}
    </section>
    <Dialog open={!!adding} onOpenChange={open=>{if(!open&&!busy)setAdding(null)}}><DialogContent className="taxonomy-dialog" showCloseButton={!busy}><DialogTitle>{adding==='category'?'Add category':adding==='tag'?'Add tag':'Add subcategory'}</DialogTitle>{error && <p role="alert" className="inline-error">{error}</p>}{form}</DialogContent></Dialog>
    <Dialog open={!!rename} onOpenChange={open=>{if(!open&&!busy)setRename(null)}}><DialogContent className="taxonomy-dialog" showCloseButton={!busy}><DialogTitle>Edit {rename?.kind}</DialogTitle>{error && <p role="alert" className="inline-error">{error}</p>}{rename&&<form className="taxonomy-dialog-form" onSubmit={event=>{event.preventDefault();void run(async()=>{resultValue<unknown>(await(rename.kind==='category'?window.captured.items.updateCategory({id:rename.id,name:rename.name,color:rename.color}):rename.kind==='subcategory'?window.captured.items.updateSubcategory({id:rename.id,name:rename.name,color:rename.color!}):window.captured.items.updateTag({id:rename.id,name:rename.name,color:rename.color!,categoryId:null})));setRename(null)})}}><label>Name<input autoFocus aria-label="Rename taxonomy item" maxLength={rename.kind==='category'?60:40} value={rename.name} onChange={event=>setRename({...rename,name:event.target.value})}/></label>{rename.color&&<div className="taxonomy-color-field"><span>Color</span><ColorPalette value={rename.color} disabled={busy} onChange={color=>setRename({...rename,color})}/></div>}<div className="taxonomy-edit-tools" aria-label="Organize item">{rename.kind !== 'tag' && <><span>Order</span>{[-1, 1].map(direction => {
      const categoryId = rename.kind === 'subcategory' ? subcategories.find(item => item.id === rename.id)?.categoryId : undefined
      const group = rename.kind === 'category' ? categories : subcategories.filter(item => item.categoryId === categoryId)
      const index = group.findIndex(item => item.id === rename.id)
      return <button type="button" className="button secondary small" key={direction} disabled={busy || index + direction < 0 || index + direction >= group.length} onClick={() => move(categoryId ? 'subcategory' : 'category', rename.id, direction, categoryId)}>{direction < 0 ? <ArrowUp size={13} /> : <ArrowDown size={13} />}{direction < 0 ? 'Move up' : 'Move down'}</button>
    })}</>}<button type="button" className="button secondary small danger-action" disabled={busy} onClick={() => void remove(rename.kind, rename.id, rename.name)}><Trash2 size={13} /> Delete</button></div><div className="dialog-actions"><button className="button secondary" disabled={busy} type="button" onClick={()=>setRename(null)}>Cancel</button><button className="button primary" disabled={busy||!rename.name.trim()}>Save</button></div></form>}</DialogContent></Dialog>
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
