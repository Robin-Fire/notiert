import { Check } from 'lucide-react'

// Tailwind 500 shades, stored as hex values to preserve existing tag records.
const colors = [
  ['Slate', '#64748b'], ['Red', '#ef4444'], ['Orange', '#f97316'], ['Amber', '#f59e0b'],
  ['Green', '#22c55e'], ['Teal', '#14b8a6'], ['Cyan', '#06b6d4'], ['Blue', '#3b82f6'],
  ['Indigo', '#6366f1'], ['Violet', '#8b5cf6'], ['Pink', '#ec4899'], ['Rose', '#f43f5e'],
] as const

export function ColorPalette({ value, onChange, disabled = false }: { value: string; onChange: (color: string) => void; disabled?: boolean }) {
  const custom = !colors.some(([, color]) => color === value.toLowerCase())
  return <div className="color-palette" role="group" aria-label="Choose color">
    {colors.map(([name, color]) => <button key={name} type="button" className="color-swatch" title={name} aria-label={name} aria-pressed={value.toLowerCase() === color} style={{ backgroundColor: color }} disabled={disabled} onClick={() => onChange(color)}>{value.toLowerCase() === color && <Check size={15} />}</button>)}
    {custom && <span className="color-swatch color-swatch-custom" title="Current custom color" aria-label="Current custom color" style={{ backgroundColor: value }}><Check size={15} /></span>}
  </div>
}
