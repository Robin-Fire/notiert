import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Image as ImageIcon, X } from 'lucide-react'
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
  const [copied, setCopied] = useState<string | null>(null)
  const [copyNotice, setCopyNotice] = useState('')
  const [copying, setCopying] = useState(false)
  const viewer = useRef<HTMLDialogElement>(null)
  const imageKey = images.map(image => image.id).join('|')
  useEffect(() => { if (expanded || images.some(image => image.dataUrl)) setOpen(true) }, [expanded, imageKey])
  useEffect(() => {
    if (!open) return
    let active = true
    void Promise.all(images.map(async image => {
      if (image.dataUrl) return [image.id, image.dataUrl] as const
      try { const result = await window.captured.items.image(image.id); return [image.id, result.ok ? result.value : ''] as const }
      catch { return [image.id, ''] as const }
    })).then(entries => { if (active) setSources(Object.fromEntries(entries)) })
    return () => { active = false }
  }, [open, imageKey])
  useEffect(() => { if (selected) viewer.current?.showModal() }, [selected])
  async function copyImage(id: string) {
    setCopying(true)
    setCopied(null)
    setCopyNotice('')
    try {
      const blob = await (await fetch(sources[id])).blob()
      // Clipboard image writes require PNG, including for JPEG/WebP attachments.
      const bitmap = await createImageBitmap(blob)
      let png: Blob
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Image conversion unavailable')
        context.drawImage(bitmap, 0, 0)
        png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error('Image conversion failed')), 'image/png'))
      } finally { bitmap.close() }
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setCopied(id)
      setCopyNotice('Image copied to clipboard.')
    } catch { setCopyNotice('Could not copy image. Please try again.') }
    finally { setCopying(false) }
  }
  if (!images.length) return null
  return <section className="image-attachments" aria-label="Attached images">
    <button type="button" className="image-section-toggle" aria-expanded={open} onClick={() => setOpen(!open)}><ImageIcon size={14} /> Images · {images.length}<span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div className="attachment-thumbnails">{images.map((image, index) => <div className="attachment-thumbnail" key={image.id}>
      {sources[image.id] ? <button type="button" aria-label={`View image ${index + 1}`} onClick={() => setSelected(image.id)}><img src={sources[image.id]} alt={`Attached image ${index + 1}`} /></button> : <span className="muted">Image loading or unavailable</span>}
      {sources[image.id] && <button type="button" className="attachment-copy" disabled={copying} aria-label={`Copy image ${index + 1}`} title={copied === image.id ? 'Image copied' : 'Copy image'} onClick={() => void copyImage(image.id)}>{copied === image.id ? <Check size={14} /> : <Copy size={14} />}</button>}
      {onRemove && <button type="button" className="attachment-remove" disabled={disabled} aria-label={`Remove image ${index + 1}`} onClick={() => onRemove(image.id)}><X size={12} /></button>}
    </div>)}</div>}
    <span className="image-copy-notice" role="status">{copyNotice}</span>
    {selected && <dialog ref={viewer} className="image-viewer" aria-label="Image preview" onClose={() => setSelected(null)} onCancel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
      <button type="button" className="image-viewer-close" aria-label="Close image preview" onClick={() => viewer.current?.close()}><X size={20} /></button>
      <img src={sources[selected]} alt="Attached image preview" />
    </dialog>}
  </section>
}
