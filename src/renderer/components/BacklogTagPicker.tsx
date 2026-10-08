// Adapted from ReUI @reui/c-combobox-12 (Base UI multi-select).
import { Fragment, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { Field } from './ui/field'
import { Combobox, ComboboxChip, ComboboxChips, ComboboxChipsInput, ComboboxContent, ComboboxEmpty, ComboboxItem, ComboboxList, ComboboxValue, useComboboxAnchor } from './ui/combobox'

type Option = { name: string; create?: boolean }
export function BacklogTagPicker({ tags, suggestions, label, disabled, onSave }: { tags: string[]; suggestions: string[]; label: string; disabled: boolean; onSave: (tags: string[]) => Promise<boolean> }) {
  const anchor = useComboboxAnchor()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState(false)
  const name = query.trim().replace(/\s+/g, ' ')
  const options = useMemo(() => [...new Map([...suggestions, ...tags].map(name => [name.toLocaleLowerCase(), { name }])).values()], [suggestions, tags])
  const canCreate = !!name && name.length <= 40 && !options.some(option => option.name.toLocaleLowerCase() === name.toLocaleLowerCase())
  const items: Option[] = canCreate ? [...options, { name, create: true }] : options
  const value = tags.map(name => ({ name }))
  async function save(selected: Option[]) {
    if (disabled || saving || selected.length > 20) return
    setSaving(true)
    try { if (await onSave(selected.map(option => option.name))) setQuery('') } finally { setSaving(false) }
  }
  return <Field className="backlog-tag-picker max-w-xs"><Combobox multiple autoHighlight items={items} value={value} inputValue={query} onInputValueChange={setQuery} isItemEqualToValue={(a: Option, b: Option) => a.name.toLocaleLowerCase() === b.name.toLocaleLowerCase()} itemToStringLabel={(item: Option) => item.name} disabled={disabled || saving} onValueChange={selected => void save(selected)}>
    <ComboboxChips ref={anchor}><ComboboxValue>{(values: Option[]) => <Fragment>{values.map(value => <ComboboxChip key={value.name}>{value.name}</ComboboxChip>)}<ComboboxChipsInput aria-label={`Tags for ${label}`} placeholder="Add tags…" maxLength={40} onKeyDown={event => { if (event.key === 'Enter' && canCreate && !options.some(option => option.name.toLocaleLowerCase().includes(name.toLocaleLowerCase()))) { event.preventDefault(); void save([...value, { name }]) } }} /></Fragment>}</ComboboxValue></ComboboxChips>
    <ComboboxContent anchor={anchor} className="backlog-tag-popup"><ComboboxEmpty>No matching tags</ComboboxEmpty><ComboboxList>{(item: Option) => <ComboboxItem key={`${item.create ? 'new:' : ''}${item.name}`} value={item} disabled={tags.length >= 20 && !tags.includes(item.name)}>{item.create ? <><Plus size={13} /> Create “{item.name}”</> : item.name}</ComboboxItem>}</ComboboxList></ComboboxContent>
  </Combobox>{tags.length >= 20 && <small>20 tags maximum</small>}</Field>
}
