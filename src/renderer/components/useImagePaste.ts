import { useRef, useState, type ClipboardEvent } from 'react'
import type { CaptureImage, ImageRef } from '../../shared/contracts'

export type EditableImage = ImageRef & { dataUrl?: string }
export function useImagePaste<T extends EditableImage = CaptureImage>(onError: (message: string) => void, initialImages: T[] = []) {
  const [images, setImages] = useState<(T | CaptureImage)[]>(initialImages)
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const current = useRef(images)
  function remove(id: string) { if (!locked.current) { current.current = current.current.filter(image => image.id !== id); setImages(current.current) } }
  function onPaste(event: ClipboardEvent) {
    const files = [...event.clipboardData.items].filter(item => item.kind === 'file' && item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => file !== null)
    if (!files.length) return
    event.preventDefault()
    if (locked.current) return
    if (current.current.length + files.length > 5) { onError('An item can hold up to five images.'); return }
    if (files.some(file => !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5_000_000)) { onError('Paste PNG, JPEG, WebP, or GIF images under 5 MB each.'); return }
    locked.current = true; setPending(true)
    void Promise.all(files.map(file => new Promise<CaptureImage>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ id: crypto.randomUUID(), mimeType: file.type as ImageRef['mimeType'], dataUrl: String(reader.result) })
      reader.onerror = () => reject(new Error('The image could not be read. Try pasting again.'))
      reader.readAsDataURL(file)
    }))).then(added => {
      current.current = [...current.current, ...added]; setImages(current.current)
    }).catch(reason => onError(reason instanceof Error ? reason.message : 'Could not paste image.'))
      .finally(() => { locked.current = false; setPending(false) })
  }
  return { images, remove, onPaste, pending, isPending: () => locked.current }
}
