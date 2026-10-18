import { useSyncExternalStore } from 'react'
import type { Category, Subcategory, TagRecord, capturedApi } from '../../shared/contracts'
import { resultValue } from '../apiResult'

type TaxonomyState = {
  categories: Category[]
  subcategories: Subcategory[]
  tags: TagRecord[]
  ready: boolean
  error: string
}

function createTaxonomyStore(api: capturedApi['items']) {
  let state: TaxonomyState = { categories: [], subcategories: [], tags: [], ready: false, error: '' }
  const listeners = new Set<() => void>()
  let unsubscribe: (() => void) | undefined
  let pending: Promise<void> | undefined
  let request = 0
  const publish = () => listeners.forEach((listener) => listener())
  const refresh = (): Promise<void> => {
    const current = ++request
    pending = (async () => {
      try {
        const value = resultValue(await api.taxonomy())
        if (current !== request) return
        state = { ...value, subcategories: value.subcategories ?? [], ready: true, error: '' }
      } catch (reason) {
        if (current !== request) return
        state = {
          ...state,
          error: reason instanceof Error ? reason.message : 'Categories and tags could not be loaded.'
        }
      }
      publish()
    })().finally(() => {
      if (current === request) pending = undefined
    })
    return pending
  }
  return {
    getSnapshot: () => state,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener)
      if (listeners.size === 1) {
        unsubscribe = api.onTaxonomyChanged(() => {
          void refresh()
        })
        if (!pending) void refresh()
      }
      return () => {
        listeners.delete(listener)
        if (!listeners.size) {
          unsubscribe?.()
          unsubscribe = undefined
        }
      }
    }
  }
}

const stores = new WeakMap<capturedApi['items'], ReturnType<typeof createTaxonomyStore>>()
export function useTaxonomy() {
  const api = window.captured.items
  let store = stores.get(api)
  if (!store) {
    store = createTaxonomyStore(api)
    stores.set(api, store)
  }
  return { ...useSyncExternalStore(store.subscribe, store.getSnapshot), refresh: store.refresh }
}
