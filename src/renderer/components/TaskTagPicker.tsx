import { useMemo, useState } from 'react'
import { Check, Hash, Plus, Search } from 'lucide-react'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover'

export function TaskTagPicker({ tags, suggestions, label, disabled, onSave }: {
  tags: string[]
  suggestions: string[]
  label: string
  disabled: boolean
  onSave: (tags: string[]) => Promise<boolean>
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const name = query.trim().replace(/^#+/, '').replace(/\s+/g, ' ')
  const options = useMemo(() => [...new Map([...tags, ...suggestions].map(tag => [tag.toLocaleLowerCase(), tag])).values()], [tags, suggestions])
  const matching = options.filter(tag => tag.toLocaleLowerCase().includes(name.toLocaleLowerCase()))
  const canCreate = !!name && name.length <= 40 && !options.some(tag => tag.toLocaleLowerCase() === name.toLocaleLowerCase())
  async function toggle(tag: string) {
    if (disabled || saving) return
    const next = tags.includes(tag) ? tags.filter(value => value !== tag) : [...tags, tag]
    if (next.length > 20) return
    setSaving(true)
    try { if (await onSave(next)) setQuery('') } finally { setSaving(false) }
  }
  return (
    <Popover open={open} onOpenChange={value => { setOpen(value); if (!value) setQuery('') }}>
      <PopoverTrigger disabled={disabled && !open} aria-label={`Edit tags for ${label}`}><Hash size={11} /> Tags</PopoverTrigger>
      <PopoverContent onKeyDown={event => event.stopPropagation()} align="end" className="task-tag-popover" aria-label={`Tags for ${label}`}>
        <PopoverTitle className="task-tag-title">Tags</PopoverTitle>
        <label className="task-tag-search"><Search size={13} /><input autoFocus aria-label={`Find or create tags for ${label}`} placeholder="Find or create a tag…" value={query} maxLength={40} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && canCreate) { event.preventDefault(); void toggle(name) } }} /></label>
        <div className="task-tag-options" aria-label="Available tags">
          {matching.map(tag => <button key={tag} type="button" role="checkbox" aria-checked={tags.includes(tag)} disabled={disabled || saving || (!tags.includes(tag) && tags.length >= 20)} onClick={() => void toggle(tag)}><span>#{tag.replace(/^#+/, '')}</span>{tags.includes(tag) && <Check size={13} />}</button>)}
          {canCreate && <button type="button" disabled={disabled || saving || tags.length >= 20} onClick={() => void toggle(name)}><Plus size={13} /><span>Create #{name}</span></button>}
          {!matching.length && !canCreate && <p>No tags yet. Type to create one.</p>}
        </div>
        {tags.length >= 20 && <small>20 tags maximum</small>}
      </PopoverContent>
    </Popover>
  )
}
