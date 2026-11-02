import {useCallback,useState} from 'react'
// UI preferences never contain encounter, map, library or permission data.
export function useWorkspacePreference(key:string,fallback:boolean){
 const storageKey=`ledger.ui.${key}`
 const[value,setValue]=useState(()=>{try{const saved=localStorage.getItem(storageKey);return saved===null?fallback:saved==='true'}catch{return fallback}})
 const update=useCallback((next:boolean)=>{setValue(next);try{localStorage.setItem(storageKey,String(next))}catch{/* Storage can be unavailable in private browsing. */}},[storageKey])
 return[value,update] as const
}
