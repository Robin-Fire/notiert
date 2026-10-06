import { useState } from 'react'
import { Check, ChevronDown, Hash, Search, X } from 'lucide-react'
import type { TagRecord } from '../../shared/contracts'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover'

export type TagFilterValue = { included: string[]; excluded: string[] }
export function TagFilter({ tags, value, onChange, category }: { tags: TagRecord[]; value: TagFilterValue; onChange: (value: TagFilterValue) => void; category: string }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const matching = tags.filter(tag => tag.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  const [mode, setMode] = useState<'included' | 'excluded'>('included')
  const count = value.included.length + value.excluded.length
  const summary = count ? [value.included.length && `${value.included.length} shown`, value.excluded.length && `${value.excluded.length} hidden`].filter(Boolean).join(' · ') : 'All tags'
  const clear = () => onChange({ included: [], excluded: [] })
  function toggle(name: string) {
    const other = mode === 'included' ? 'excluded' : 'included'
    onChange({ ...value, [mode]: value[mode].includes(name) ? value[mode].filter(tag => tag !== name) : [...value[mode], name], [other]: value[other].filter(tag => tag !== name) })
  }
  return <div className="backlog-tag-filter">
    <Popover open={open} onOpenChange={next => { setOpen(next); if (!next) setQuery('') }}>
      <PopoverTrigger className={`tag-filter-trigger ${count ? 'is-filtered' : ''}`} aria-label={`Tag filter for ${category}: ${summary}`}>
        <Hash size={13} /><span>{summary}</span><ChevronDown size={12} />
      </PopoverTrigger>
      <PopoverContent align="start" className="tag-filter-popover" aria-label={`Tag filter for ${category}`}>
        <PopoverTitle className="tag-filter-title">Filter by tag</PopoverTitle>
        <div className="planner-view-switch tag-filter-modes" aria-label="Tag filter mode"><button type="button" aria-pressed={mode === 'included'} onClick={() => setMode('included')}>Show</button><button type="button" aria-pressed={mode === 'excluded'} onClick={() => setMode('excluded')}>Hide</button></div>
        <p className="tag-filter-help">{mode === 'included' ? 'Show items with any selected tag.' : 'Hide items with any selected tag.'}</p>
        <label className="tag-filter-find"><Search size={13} /><input autoFocus aria-label={`Find tag for ${category}`} placeholder="Find a tag…" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="tag-filter-list">
          {matching.map(tag => <button type="button" className="tag-filter-option" aria-label={tag.name} aria-pressed={value[mode].includes(tag.name)} key={tag.id} onClick={() => toggle(tag.name)}><Hash size={13} style={{ color: tag.color }} /><span>{tag.name}</span>{value[mode].includes(tag.name) ? <Check size={13} /> : value[mode === 'included' ? 'excluded' : 'included'].includes(tag.name) ? <small>{mode === 'included' ? 'Hidden' : 'Shown'}</small> : null}</button>)}
          {!matching.length && <p className="tag-filter-empty">{tags.length ? 'No matching tags' : 'No tags yet'}</p>}
        </div>
        <button type="button" className="filter-clear" disabled={!count} onClick={clear}>Clear filters</button>
      </PopoverContent>
    </Popover>
    {!!count && <button type="button" className="tag-filter-reset" aria-label={`Clear tag filter for ${category}`} onClick={clear}><X size={12} /></button>}
  </div>
}
