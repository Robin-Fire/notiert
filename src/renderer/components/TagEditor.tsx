import { X } from 'lucide-react'
import { TaskTagPicker } from './TaskTagPicker'

export function collectTags(tags: string[], draft = ''): string[] {
  const names = [...tags, ...draft.split(',')]
  return [...new Map(names.map((name) => name.trim().replace(/\s+/g, ' ').slice(0, 40)).filter(Boolean).map((name): [string, string] => [name.toLocaleLowerCase(), name])).values()].slice(0, 20)
}


export function TagEditor({ tags, onTagsChange, suggestions, disabled = false }: {
  tags: string[]
  onTagsChange: (tags: string[]) => void
  suggestions: string[]
  disabled?: boolean
}) {
  return <div className="tag-editor">
    <div className="tag-editor-selection">
      {tags.map(tag => <span className="tag-chip" key={tag}>#{tag.replace(/^#+/, '')}<button type="button" disabled={disabled} aria-label={`Remove tag ${tag}`} onClick={() => onTagsChange(tags.filter(name => name !== tag))}><X size={11} /></button></span>)}
      <TaskTagPicker tags={tags} suggestions={suggestions} label="task" disabled={disabled} onSave={async selected => { onTagsChange(selected); return true }} />
    </div>
  </div>
}
