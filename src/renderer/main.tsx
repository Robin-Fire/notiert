import React from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/sn-pro/latin-400.css'
import '@fontsource/sn-pro/latin-500.css'
import '@fontsource/sn-pro/latin-600.css'
import '@fontsource/geist-mono/latin-400.css'
import './styles.css'
import { TaskApp } from './app/TaskApp'

async function start() {
  if (import.meta.env.DEV && !window.captured) await import('./browserPreview')
  createRoot(document.getElementById('root')!).render(<React.StrictMode><TaskApp /></React.StrictMode>)
}

void start()
