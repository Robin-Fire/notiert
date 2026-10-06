import type { Category, Subcategory } from '../../shared/contracts'
import { useState } from 'react'
import { Check, ChevronDown, Folder } from 'lucide-react'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover'
export function CategoryPicker({ categories, subcategories, categoryId, subcategoryId, onChange, disabled=false, compact=false }: {categories:Category[];subcategories:Subcategory[];categoryId:string|null;subcategoryId:string|null;onChange:(categoryId:string|null,subcategoryId:string|null)=>void;disabled?:boolean;compact?:boolean}) {
  const [open, setOpen] = useState(false)
  if (compact) {
    const category = categories.find(item => item.id === categoryId)
    const subcategory = subcategories.find(item => item.id === subcategoryId && item.categoryId === categoryId)
    return <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger disabled={disabled} className={`inbox-category-trigger ${category ? '' : 'is-unassigned'}`} aria-label="Item category"><Folder size={14} /><span>{category ? `${category.name}${subcategory ? ` / ${subcategory.name}` : ''}` : 'Choose category'}</span><ChevronDown size={12} /></PopoverTrigger>
      <PopoverContent align="start" className="category-picker-popover"><PopoverTitle>Category</PopoverTitle>
        <div className="category-picker-options"><button type="button" disabled={disabled} aria-pressed={!categoryId} onClick={() => { onChange(null, null); setOpen(false) }}>Unassigned{!categoryId && <Check size={14} />}</button>
          {categories.map(item => <button key={item.id} type="button" disabled={disabled} aria-pressed={categoryId === item.id} onClick={() => onChange(item.id, null)}>{item.name}{categoryId === item.id && <Check size={14} />}</button>)}
        </div>
        {categoryId && <><strong>Subcategory</strong><div className="category-picker-options"><button type="button" disabled={disabled} aria-pressed={!subcategoryId} onClick={() => { onChange(categoryId, null); setOpen(false) }}>No subcategory{!subcategoryId && <Check size={14} />}</button>
          {subcategories.filter(item => item.categoryId === categoryId).map(item => <button key={item.id} type="button" disabled={disabled} aria-pressed={subcategoryId === item.id} onClick={() => { onChange(categoryId, item.id); setOpen(false) }}>{item.name}{subcategoryId === item.id && <Check size={14} />}</button>)}
        </div></>}
      </PopoverContent>
    </Popover>
  }
  return <div className="category-picker">
    <label>Category<select aria-label="Item category" disabled={disabled} value={categoryId??''} onChange={event=>onChange(event.target.value||null,null)}><option value="">Unassigned</option>{categories.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>Subcategory<select aria-label="Item subcategory" disabled={disabled||!categoryId} value={subcategoryId??''} onChange={event=>onChange(categoryId,event.target.value||null)}><option value="">No subcategory</option>{subcategories.filter(item=>item.categoryId===categoryId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
  </div>
}
