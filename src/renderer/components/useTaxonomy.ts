import { useEffect, useState } from 'react'
import type { Category, Subcategory, TagRecord } from '../../shared/contracts'
export function useTaxonomy() {
  const [taxonomy,setTaxonomy]=useState<{categories:Category[];subcategories:Subcategory[];tags:TagRecord[]}>({categories:[],subcategories:[],tags:[]})
  useEffect(()=>{let active=true; const refresh=()=>{void window.captured.notes.taxonomy().then(result=>{if(active&&result.ok)setTaxonomy({...result.value,subcategories:result.value.subcategories??[]})}).catch(()=>{})}; refresh(); const unsubscribe=window.captured.notes.onTaxonomyChanged(refresh); return ()=>{active=false;unsubscribe()}},[])
  return taxonomy
}
