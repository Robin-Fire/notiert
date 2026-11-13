import { RichTextEditor } from '@editorcn/editor'
import { useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { ItemImages } from './ItemImages'
import type { useImagePaste } from './useImagePaste'
import '@editorcn/editor/style.css'
import './task-description.css'

export type TaskDescription = { body: string; bodyHtml?: string | null }

const extensions = [
  StarterKit.configure({
    blockquote: false,
    code: false,
    codeBlock: false,
    heading: false,
    horizontalRule: false,
    italic: false,
    link: false,
    orderedList: false,
    strike: false,
    underline: false
  })
]

export function TaskDescriptionField({ label, accessibleName, value, onChange, images, disabled }: {
  label: string
  accessibleName: string
  value: TaskDescription
  onChange: (value: TaskDescription) => void
  images: ReturnType<typeof useImagePaste>
  disabled: boolean
}) {
  const editor = useEditor({
    extensions,
    content: value.bodyHtml ?? {
      type: 'doc',
      content: value.body.split(/\r\n?|\n/).map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : []
      }))
    },
    parseOptions: { preserveWhitespace: 'full' },
    autofocus: 'start',
    shouldRerenderOnTransaction: false,
    editorProps: {
      attributes: {
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': accessibleName
      }
    },
    onUpdate: ({ editor, transaction }) => {
      if (!transaction.docChanged) return
      const { doc } = editor.state
      // Cards and search use plain text. Store editor markup only when it carries formatting.
      const formatted = doc.rangeHasMark(0, doc.content.size, editor.schema.marks.bold!)
        || doc.content.content.some((node) => node.type.name === 'bulletList')
      onChange({
        body: doc.textBetween(0, doc.content.size, '\n', '\n'),
        bodyHtml: formatted ? editor.getHTML() : null
      })
    }
  })

  return (
    <div className="task-description">
      <span>{label}</span>
      <div onPasteCapture={disabled ? undefined : images.onPaste}>
        <RichTextEditor editor={editor} className="task-description-editor" editable={!disabled}>
          <RichTextEditor.Toolbar>
            <RichTextEditor.ControlsGroup>
              <RichTextEditor.Bold />
              <RichTextEditor.BulletList />
            </RichTextEditor.ControlsGroup>
          </RichTextEditor.Toolbar>
          <RichTextEditor.Content />
        </RichTextEditor>
      </div>
      <TaskDescriptionImages images={images} disabled={disabled} />
    </div>
  )
}

export function TaskDescriptionImages({ images, disabled }: {
  images: ReturnType<typeof useImagePaste>
  disabled: boolean
}) {
  return (
    <>
      <ItemImages images={images.images} expanded onRemove={images.remove} disabled={disabled || images.pending} />
      {images.pending && <span className="image-paste-hint" role="status">Reading image…</span>}
    </>
  )
}
