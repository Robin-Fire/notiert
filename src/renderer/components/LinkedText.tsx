import type { ReactNode } from 'react'

export function LinkedText({ text, linksOnly = false }: { text: string; linksOnly?: boolean }) {
  const parts: ReactNode[] = []
  let cursor = 0
  for (const match of text.matchAll(/\b(?:https?:\/\/|www\.)[^\s<>"']+/gi)) {
    let label = match[0].replace(/[.,!?;:]+$/, '')
    // Preserve balanced parentheses inside URLs, excluding surrounding prose.
    while (label.endsWith(')') && (label.match(/\)/g)?.length ?? 0) > (label.match(/\(/g)?.length ?? 0)) label = label.slice(0, -1)
    const href = /^www\./i.test(label) ? `https://${label}` : label
    try { if (!new URL(href).hostname) continue } catch { continue }
    if (!linksOnly) parts.push(text.slice(cursor, match.index))
    else if (parts.length) parts.push(' · ')
    parts.push(<a className="task-text-link" key={match.index} href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>{label}</a>)
    cursor = match.index! + label.length
  }
  if (!linksOnly) parts.push(text.slice(cursor))
  return <>{parts}</>
}
