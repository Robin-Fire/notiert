/// <reference types="vite/client" />
import type { capturedApi } from '../shared/contracts'
declare global { interface Window { captured: capturedApi } }
