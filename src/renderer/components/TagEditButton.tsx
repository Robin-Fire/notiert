import { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import type { TagRecord } from '../../shared/contracts'
import { resultValue } from '../apiResult'
import { ColorPalette } from './ColorPalette'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from './ui/dialog'

export function TagEditButton({ tag, onChanged }: { tag: TagRecord; onChanged: () => Promise<void> }) {
  const [rename, setRename] = useState<{ id: string; name: string; color: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function run(action: () => Promise<unknown>) {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      await action()
      await onChanged()
      setRename(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not save tags.')
    } finally {
      setBusy(false)
    }
  }

  async function remove(id: string, name: string) {
    if (!window.confirm(`Delete tag "${name}" from all tasks?`)) return
    await run(async () => resultValue(await window.captured.items.deleteTag(id)))
  }

  return (
    <Dialog open={!!rename} onOpenChange={(open) => {
      if (open) {
        setError('')
        setRename({ id: tag.id, name: tag.name, color: tag.color ?? '#85858e' })
      } else if (!busy) {
        setRename(null)
      }
    }}>
      <DialogTrigger className="tasks-view-options" aria-label={`Edit tag ${tag.name}`} title={`Edit ${tag.name}`}>
        <Pencil size={15} aria-hidden="true" />
      </DialogTrigger>
      <DialogContent className="taxonomy-dialog" showCloseButton={!busy}>
        <DialogTitle>Edit tag</DialogTitle>
        {error && <p role="alert" className="inline-error">{error}</p>}
        {rename && (
          <form className="taxonomy-dialog-form" onSubmit={event => {
            event.preventDefault()
            void run(async () => {
              resultValue(await window.captured.items.updateTag({ ...rename, categoryId: null }))
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
  )
}
