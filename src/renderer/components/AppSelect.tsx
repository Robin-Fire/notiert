// Shared adapter for ReUI @reui/c-select-1 (Base UI Select).
import { Children, isValidElement, useId, useState, type ReactNode } from 'react'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from './ui/select'
import './app-select.css'

type Props = { children: ReactNode; value: string | number; onChange: (event: { target: { value: string }; currentTarget: { value: string } }) => void; disabled?: boolean; className?: string; id?: string; 'aria-label'?: string; title?: string }
function text(node: ReactNode): string { return Children.toArray(node).map(child => isValidElement<{ children?: ReactNode }>(child) ? text(child.props.children) : String(child ?? '')).join('') }
function optionsOf(children: ReactNode): { value: string; label: string; content: ReactNode; disabled?: boolean }[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return []
    if (child.type === 'option') return [{ value: String(child.props.value ?? text(child.props.children)), label: text(child.props.children), content: child.props.children, disabled: child.props.disabled }]
    return optionsOf(child.props.children)
  })
}
export function AppSelect({ children, value, onChange, disabled = false, className = '', id, ...props }: Props) {
  const generated = useId()
  const [open, setOpen] = useState(false)
  const items = optionsOf(children)
  return <Select open={open} onOpenChange={setOpen} items={items} value={String(value)} disabled={disabled} onValueChange={next => { if (next !== null) onChange({ target: { value: next }, currentTarget: { value: next } }) }}>
    <SelectTrigger {...props} id={id ?? generated} value={String(value)} disabled={disabled} className={`app-select ${className}`}><SelectValue /></SelectTrigger>
    <SelectContent onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setOpen(false) } }} alignItemWithTrigger={false} className="app-select-popup"><SelectGroup>{items.map(item => <SelectItem key={item.value} value={item.value} disabled={item.disabled} data-value={item.value}>{item.content}</SelectItem>)}</SelectGroup></SelectContent>
  </Select>
}
