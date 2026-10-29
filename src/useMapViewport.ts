import {useEffect,useRef,useState,type RefObject} from 'react'
// Expand the owning workspace in place; the Canvas, inspector and drafts stay mounted.
export function useMapViewport(shell:RefObject<HTMLElement|null>){
 const[inspector,setInspector]=useState(false)
 const[expanded,setExpanded]=useState(false),[native,setNative]=useState(false),[error,setError]=useState('')
 const nativeOwned=useRef(false)
 useEffect(()=>{
  const changed=()=>{const active=nativeOwned.current&&document.fullscreenElement===document.documentElement;setNative(active);if(!document.fullscreenElement)nativeOwned.current=false}
  document.addEventListener('fullscreenchange',changed)
  return()=>{document.removeEventListener('fullscreenchange',changed);if(nativeOwned.current&&document.fullscreenElement===document.documentElement)void document.exitFullscreen().catch(()=>{})}
 },[])
 useEffect(()=>{
  if(!expanded||!shell.current)return
  const element=shell.current.closest<HTMLElement>('.dungeon-builder')??shell.current
  const original=element.getAttribute('data-map-expanded'),scroll={x:window.scrollX,y:window.scrollY},inert:HTMLElement[]=[]
  // Background siblings are covered visually and excluded from keyboard focus.
  let branch:HTMLElement|null=element
  while(branch&&branch!==document.body){for(const sibling of branch.parentElement?.children??[]){if(sibling!==branch&&sibling instanceof HTMLElement&&!sibling.inert&&sibling.tagName!=='DIALOG'){sibling.inert=true;inert.push(sibling)}}branch=branch.parentElement}
  element.setAttribute('data-map-expanded','true');document.body.classList.add('map-viewport-expanded')
  return()=>{if(original===null)element.removeAttribute('data-map-expanded');else element.setAttribute('data-map-expanded',original);document.body.classList.remove('map-viewport-expanded');for(const sibling of inert)sibling.inert=false;window.scrollTo(scroll.x,scroll.y)}
 },[expanded,shell])
 useEffect(()=>{
  if(!expanded||!shell.current)return
  const root=shell.current.closest<HTMLElement>('.dungeon-builder')
  if(!root)return
  const panel=root.querySelector<HTMLElement>('.inspector'),wasInert=panel?.inert??false
  root.setAttribute('data-expanded-inspector',String(inspector));if(panel)panel.inert=!inspector
  return()=>{root.removeAttribute('data-expanded-inspector');if(panel)panel.inert=wasInert}
 },[expanded,inspector,shell])
 const restore=()=>{setExpanded(false);setError('');if(nativeOwned.current&&document.fullscreenElement===document.documentElement)void document.exitFullscreen().catch(()=>setError('Could not exit browser fullscreen. Use the browser controls.'))}
 const toggleNative=async()=>{
  setError('');setExpanded(true)
  if(nativeOwned.current&&document.fullscreenElement===document.documentElement){try{await document.exitFullscreen()}catch{setError('Could not exit browser fullscreen. Use the browser controls.')}return}
  if(!document.documentElement.requestFullscreen){setError('Browser fullscreen is unavailable. Expanded view remains active.');return}
  try{await document.documentElement.requestFullscreen();nativeOwned.current=true;setNative(document.fullscreenElement===document.documentElement)}catch{nativeOwned.current=false;setNative(false);setError('Browser fullscreen was not permitted. Expanded view remains active.')}
 }
 return {expanded,native,error,inspector,toggleInspector:()=>setInspector(value=>!value),expand:()=>setExpanded(true),restore,toggleNative}
}
