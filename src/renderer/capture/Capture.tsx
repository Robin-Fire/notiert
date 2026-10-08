import { AppSelect } from '../components/AppSelect'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CompositionEvent, type KeyboardEvent } from 'react'
import { AlertCircle, ArrowUpRight, Copy, CornerDownLeft, Folder, RotateCcw, X } from 'lucide-react'
import type { CaptureState, Category, Subcategory } from '../../shared/contracts'

export function Capture() {
  const [state, setState] = useState<CaptureState>({ body: '', images: [], generation: 0, revision: 0, shortcut: 'Control+N', theme: 'system', available: false, categoryId: null })
  const [subcategories,setSubcategories]=useState<Subcategory[]>([])
  const captureKind = useRef<'inbox' | 'task'>('inbox')
  const captureTags=useRef<string[]>([])
  const subcategoryId=useRef<string|null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [body, setBody] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [composing, setComposing] = useState(false)
  const [tooLong, setTooLong] = useState(false)
  const [imagePending, setImagePending] = useState(false)
  const savingLock = useRef(false)
  const imagePendingRef = useRef(false)
  const requestIdRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const revision = useRef(0)
  const generation = useRef(0)
  const categoryId = useRef<string | null>(null)
  const draftTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const bodyRef = useRef('')
  const requestedHeight = useRef<number | null>(null)
  bodyRef.current = body

  const resizeCapture = useCallback((height: number) => {
    if (requestedHeight.current === height) return
    requestedHeight.current = height
    window.captured.capture.resize(height)
  }, [])

  useEffect(() => {
    const refreshCategories = async () => {
      try {
        const result = await window.captured.capture.categories()
        if (result.ok) setCategories(result.value)
        const subs=await window.captured.capture.subcategories();if(subs.ok)setSubcategories(subs.value)
      } catch { /* Keep capture usable if taxonomy is temporarily unavailable. */ }
    }
    const apply = (next: Partial<CaptureState>) => {
      setState((current) => ({ ...current, ...next }))
      if (typeof next.body === 'string') setBody(next.body)
      if (typeof next.generation === 'number') generation.current = next.generation
      if (typeof next.revision === 'number') revision.current = next.revision
      if(next.captureKind!==undefined)captureKind.current=next.captureKind === 'note' ? 'task' : next.captureKind
      if(next.tags!==undefined)captureTags.current=next.tags
      if(next.subcategoryId!==undefined)subcategoryId.current=next.subcategoryId
      if (next.categoryId !== undefined) categoryId.current = next.categoryId
      if (next.theme) document.documentElement.dataset.theme = next.theme
      if (next.available !== undefined) void refreshCategories()
    }
    void window.captured.capture.getState().then((result) => { if (result.ok) apply(result.value) })
    const unsubscribe = window.captured.capture.onState(apply)
    const focus = () => { inputRef.current?.focus(); inputRef.current?.setSelectionRange(bodyRef.current.length, bodyRef.current.length) }
    window.addEventListener('focus', focus)
    const initialFocus = setTimeout(focus, 40)
    return () => { clearTimeout(initialFocus); unsubscribe(); window.removeEventListener('focus', focus); clearTimeout(draftTimer.current) }
  }, [])

  useLayoutEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.style.height = 'auto'
    const contentHeight = Math.min(input.scrollHeight, 132)
    input.style.height = `${contentHeight}px`
  }, [body])

  useLayoutEffect(() => {
    const content = contentRef.current
    if (!content) return
    // Measure the actual layout, including wrapped tags and storage messages.
    const updateHeight = () => resizeCapture(Math.min(320, Math.max(88, Math.ceil(content.getBoundingClientRect().height) + 17)))
    const observer = new ResizeObserver(updateHeight)
    observer.observe(content)
    updateHeight()
    return () => observer.disconnect()
  }, [resizeCapture])

  const persistDraft = useCallback(async (draft: string, selectedCategory = categoryId.current) => {
    if (!state.available || saving) return
    revision.current += 1
    const result = await window.captured.capture.updateDraft({ body: draft, generation: generation.current, revision: revision.current, categoryId: selectedCategory,subcategoryId:subcategoryId.current,tags:captureTags.current, captureKind:captureKind.current })
    if (result.ok) revision.current = Math.max(revision.current, result.value.revision)
  }, [saving, state.available])

  const flushDraft = useCallback(async () => {
    clearTimeout(draftTimer.current)
    await persistDraft(bodyRef.current)
  }, [persistDraft])

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape' || !document.querySelector('.capture-card')) return
      event.preventDefault()
      void flushDraft().finally(() => window.captured.capture.dismiss('escape'))
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [flushDraft])

  useEffect(() => {
    const unsubscribe = window.captured.capture.onQuitRequest(() => {
      clearTimeout(draftTimer.current)
      const draft = bodyRef.current
      void window.captured.capture.flushBeforeQuit({ body: draft, generation: generation.current, revision: revision.current + 1, categoryId: categoryId.current,subcategoryId:subcategoryId.current,tags:captureTags.current, captureKind:captureKind.current }).then((result) => {
        if (result.ok) { revision.current = Math.max(revision.current, result.value.revision); window.captured.capture.respondToQuit(true, draft) }
        else window.captured.capture.respondToQuit(false, draft)
      }).catch(() => window.captured.capture.respondToQuit(false, draft))
    })
    window.captured.capture.ready()
    return unsubscribe
  }, [])

  const onChange = (value: string) => {
    const count = [...value].length
    if (count > 50_000) { setTooLong(true); return }
    setTooLong(false)
    setBody(value)
    setError('')
    requestIdRef.current = null
    clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => void persistDraft(value), 250)
  }

  const submit = async () => {
    if ((!body.trim() && !state.images.length) || savingLock.current || imagePendingRef.current || composing || !state.available) return
    savingLock.current = true
    clearTimeout(draftTimer.current)
    setSaving(true)
    setError('')
    const id = requestIdRef.current ?? crypto.randomUUID()
    requestIdRef.current = id
    try {
      const result = await window.captured.capture.submit({ requestId: id, generation: generation.current, body, categoryId: categoryId.current,subcategoryId:subcategoryId.current,tags:captureTags.current, captureKind:captureKind.current })
      if (!result.ok) { setError(result.message); return }
      setBody('')
      setState((current) => ({ ...current, images: [] }))
      bodyRef.current = ''
      requestIdRef.current = null
      revision.current = 0
      generation.current += 1
      captureKind.current='inbox'
      captureTags.current=[]
      setState((current) => ({ ...current, categoryId: categoryId.current,subcategoryId:subcategoryId.current,tags:[],captureKind:'inbox' }))
      try { await window.captured.capture.dismiss('saved') } catch { /* The capture is already saved. */ }
    } catch { setError('The capture could not be saved. Your text and images are still here. Try again.') }
    finally { savingLock.current = false; setSaving(false) }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return
      event.preventDefault()
      void submit()
    }
  }

  const onPaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...event.clipboardData.items].filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter((file): file is File => file !== null)
    if (files.length) {
      event.preventDefault()
      if (imagePendingRef.current) return
      if (state.images.length + files.length > 5) { setError('A capture can hold up to five images.'); return }
      imagePendingRef.current = true
      setImagePending(true)
      void (async () => {
        try {
          for (const file of files) {
            if (file.size > 5_000_000) throw new Error('Each image must be under 5 MB.')
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The image could not be read.'))
              reader.onerror = () => reject(new Error('The image could not be read.'))
              reader.readAsDataURL(file)
            })
            const result = await window.captured.capture.addImage({ generation: generation.current, dataUrl })
            if (!result.ok) throw new Error(result.message)
            setState((current) => ({ ...current, images: [...current.images, result.value] }))
          }
          setError('')
        } catch (reason) { setError(reason instanceof Error ? reason.message : 'The image could not be pasted.') }
        finally { imagePendingRef.current = false; setImagePending(false) }
      })()
      return
    }
    const pasted = event.clipboardData.getData('text/plain').replace(/\r\n?/g, '\n')
    const current = body
    const start = event.currentTarget.selectionStart
    const end = event.currentTarget.selectionEnd
    const value = current.slice(0, start) + pasted + current.slice(end)
    if ([...value].length > 50_000) { event.preventDefault(); setTooLong(true) }
  }

  const removeImage = async (id: string) => {
    if (imagePendingRef.current) return
    imagePendingRef.current = true
    setImagePending(true)
    try {
      const result = await window.captured.capture.removeImage({ generation: generation.current, id })
      if (result.ok) setState((current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))
      else setError(result.message)
    } catch { setError('The image could not be removed. Try again.') }
    finally { imagePendingRef.current = false; setImagePending(false) }
  }

  const copyText = async () => { await navigator.clipboard.writeText(body); setError('Text copied. It is still here until you close this bar.') }
  return <main className="capture-shell" aria-label="Capture a thought">
    <div className="capture-card">
      <div className="capture-content" ref={contentRef}>
      <header className="capture-header">
        <span className="wordmark">captured</span>
        <span className="capture-heading">Quick capture</span>
        <button className="icon-button capture-open" title="Open tasks" aria-label="Open tasks" onClick={() => window.captured.windows.openNotes()}><ArrowUpRight size={15} /></button>
        <button className="icon-button capture-close" title="Close capture (Esc)" aria-label="Close capture" onClick={() => void flushDraft().finally(() => window.captured.capture.dismiss('escape'))}><X size={15} /></button>
      </header>
      <textarea
        ref={inputRef} className="capture-input" rows={1} value={body} maxLength={100000}
        placeholder={state.available ? 'Capture a thought…' : 'Storage is unavailable. Keep this text on screen.'}
        aria-label="Task text" aria-describedby="capture-status" readOnly={saving}
        onChange={(event) => onChange(event.target.value)} onKeyDown={onKeyDown} onPaste={onPaste}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={(_event: CompositionEvent<HTMLTextAreaElement>) => setComposing(false)}
        onBlur={(event) => {
          void flushDraft()
          const next = event.relatedTarget
          if (!(next instanceof Node && event.currentTarget.closest('.capture-card')?.contains(next))) void window.captured.capture.dismiss('blur')
        }}
      />
      <label className="capture-category-control"><span>Save as</span><AppSelect aria-label="Capture type" value={state.captureKind === 'note' ? 'task' : state.captureKind ?? 'inbox'} disabled={saving} onChange={event => { captureKind.current=event.target.value as 'inbox' | 'task';setState(current=>({...current,captureKind:captureKind.current}));void persistDraft(bodyRef.current) }}><option value="inbox">Capture · sort later</option><option value="task">Task</option></AppSelect></label>
      {categories.length > 0 && <label className="capture-category-control"><Folder size={13} /><span>Category</span><AppSelect aria-label="Capture category" disabled={saving} value={state.categoryId ?? ''} onChange={(event) => {
        const selected = event.target.value || null
        categoryId.current = selected;subcategoryId.current=null
        setState((current) => ({ ...current, categoryId: selected,subcategoryId:null }))
        void persistDraft(bodyRef.current, selected)
      }}><option value="">Unassigned</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</AppSelect></label>}
      {state.categoryId&&<label className="capture-category-control"><Folder size={13}/><span>Subcategory</span><AppSelect aria-label="Capture subcategory" disabled={saving} value={state.subcategoryId??''} onChange={event=>{subcategoryId.current=event.target.value||null;setState(current=>({...current,subcategoryId:subcategoryId.current}));void persistDraft(bodyRef.current)}}><option value="">No subcategory</option>{subcategories.filter(item=>item.categoryId===state.categoryId).map(item=><option key={item.id} value={item.id}>{item.name}</option>)}</AppSelect></label>}
      {!!state.tags?.length&&<div className="capture-context-tags" aria-label="Capture tags">{state.tags.map(tag=><span key={tag}>#{tag}<button type="button" aria-label={`Remove capture tag ${tag}`} disabled={saving} onClick={()=>{captureTags.current=captureTags.current.filter(value=>value!==tag);setState(current=>({...current,tags:captureTags.current}));void persistDraft(bodyRef.current)}}><X size={10}/></button></span>)}</div>}
      {state.images.length > 0 && <div className="capture-images" aria-label="Pasted images">{state.images.map((image, index) => <div className="capture-image" key={image.id}><img src={image.dataUrl} alt={`Pasted image ${index + 1}`} /><button type="button" aria-label={`Remove pasted image ${index + 1}`} onClick={() => void removeImage(image.id)} disabled={saving || imagePending}><X size={12} /></button></div>)}</div>}
      {(error || tooLong || !state.available) && <div className={`capture-alert ${!state.available || error ? 'is-error' : ''}`} id="capture-status" role="status">
        <AlertCircle size={14} /> <span>{!state.available ? 'Couldn’t reach local storage. This draft may not be persisted.' : tooLong ? 'A task can contain up to 50,000 characters. Existing text was kept.' : error}</span>
        {(error || !state.available) && <div className="capture-alert-actions">{error && <button onClick={() => void submit()} disabled={saving}><RotateCcw size={13} /> Retry</button>}<button onClick={() => void copyText()}><Copy size={13} /> Copy</button></div>}
      </div>}
      {state.available && !error && <footer className="capture-footer">
        <span className="capture-hint"><kbd>Shift ↵</kbd> new line <span className="capture-hint-divider">·</span> <kbd>Esc</kbd> close</span>
        {[...body].length > 47_500 && <span className="capture-count near-limit">{[...body].length.toLocaleString()} / 50,000</span>}
        <button className="capture-submit" title="Save capture (Enter)" onClick={() => void submit()} disabled={(!body.trim() && !state.images.length) || saving || imagePending || !state.available} aria-label="Save capture"><span>{saving ? 'Saving…' : imagePending ? 'Pasting…' : 'Save'}</span><CornerDownLeft size={13} /></button>
      </footer>}
      </div>
    </div>
  </main>
}
