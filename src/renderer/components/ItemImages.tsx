import { useEffect, useRef, useState } from 'react'
import { Image as ImageIcon, X } from 'lucide-react'
import type { EditableImage } from './useImagePaste'
export function ImageIndicator({ count }: { count: number }) {
  if (!count) return null
  const label = `${count} attached ${count === 1 ? 'image' : 'images'}`
  return <span className="image-indicator" title={label} aria-label={label}><ImageIcon size={13} aria-hidden="true" /><span>{count}</span></span>
}
export function ItemImages({ images, expanded = false, onRemove, disabled = false }: { images: EditableImage[]; expanded?: boolean; onRemove?: (id: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(expanded)
  const [sources, setSources] = useState<Record<string, string>>({})
  const [selected, setSelected] = useState<string | null>(null)
  const viewer = useRef<HTMLDialogElement>(null)
  const imageKey = images.map(image => image.id).join('|')
  useEffect(() => { if (expanded || images.some(image => image.dataUrl)) setOpen(true) }, [expanded, imageKey])
  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all(images.map(async image => {
      if (image.dataUrl) return [image.id, image.dataUrl] as const
      try { const result = await window.captured.notes.image(image.id); return [image.id, result.ok ? result.value : ''] as const }
      catch { return [image.id, ''] as const }
    })).then(entries => { if (active) setSources(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [open, imageKey])
  useEffect(() => { if (selected) viewer.current?.showModal() }, [selected])
  if (!images.length) return null
  return <section className="image-attachments" aria-label="Attached images">
    <button type="button" className="image-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ImageIcon size={14} /> Images · {images.length}<span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div className="attachment-thumbnails">{images.map((image, index) => <div className="attachment-thumbnail" key={image.id}>
      {sources[image.id] ? <button type="button" aria-label={`View image ${index + 1}`} onClick={() => setSelected(image.id)}><img src={sources[image.id]} alt={`Attached image ${index + 1}`} /></button> : <span className="muted">Image loading or unavailable</span>}
      {onRemove && <button type="button" className="attachment-remove" disabled={disabled} aria-label={`Remove image ${index + 1}`} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    </div>)}</div>}
    {selected && <dialog ref={viewer} className="image-viewer" aria-label="Image preview" onClose={() => setSelected(null)} onCancel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="image-viewer-close" aria-label="Close image preview" onClick={() => viewer.current?.close()}><X size={20} /></button>
      <img src={sources[selected]} alt="Attached image preview" />
    </dialog>}
  </section>
}
