import {useLayoutEffect,useRef,type ReactNode,type RefObject,type KeyboardEvent} from 'react'
import {createPortal} from 'react-dom'
const layers:string[]=[]
// Internal implementation shared by the action-only menu and form popover.
// Native popovers join the browser top layer; the scoped portal is a fallback
// for browsers without that API and keeps nested controls inside native dialogs.
export default function FloatingSurface({id,open,label,role,trigger,children,onClose,focusLast=false}:{id:string;open:boolean;label:string;role:'menu'|'dialog';trigger:RefObject<HTMLButtonElement|null>;children:ReactNode;onClose:()=>void;focusLast?:boolean}){
 const ref=useRef<HTMLDivElement>(null),close=useRef(onClose),search=useRef({text:'',at:0})
 useLayoutEffect(()=>{close.current=onClose},[onClose])
 useLayoutEffect(()=>{
  if(!open||!ref.current)return
  const panel=ref.current,anchor=trigger.current
  if(typeof panel.showPopover==='function')panel.showPopover()
  layers.push(id)
  const position=()=>{
   if(!anchor)return
   const box=anchor.getBoundingClientRect(),size=panel.getBoundingClientRect(),gap=6,pad=8
   panel.style.left=`${Math.max(pad,Math.min(box.left,window.innerWidth-size.width-pad))}px`
   const below=box.bottom+gap
   panel.style.top=`${Math.max(pad,Math.min(below+size.height<=window.innerHeight-pad?below:box.top-size.height-gap,window.innerHeight-size.height-pad))}px`
  }
  position()
  const candidates=Array.from(panel.querySelectorAll<HTMLElement>(role==='menu'?'[role=menuitem]:not(:disabled)':'input:not(:disabled),select:not(:disabled),textarea:not(:disabled),button:not(:disabled),a[href],[tabindex="0"]')).filter(node=>node.getClientRects().length)
  const first=focusLast?candidates.at(-1):candidates[0]
  ;(first??panel).focus()
  const blockedByDialog=()=>{const dialog=document.activeElement?.closest('dialog[open]');return Boolean(dialog&&!dialog.contains(anchor)&&!dialog.contains(panel))}
  const key=(event:globalThis.KeyboardEvent)=>{
   if(layers.at(-1)!==id||blockedByDialog()||event.key!=='Escape'||event.isComposing)return
   event.preventDefault();event.stopImmediatePropagation();close.current()
  }
  const outside=(event:PointerEvent)=>{
   if(layers.at(-1)!==id||blockedByDialog())return
   const path=event.composedPath()
   if(!path.includes(panel)&&(!anchor||!path.includes(anchor))){
    // Consume the dismissal gesture, including the later pointerup/click:
    // the scene can handle clicks as well as pointerdown to paint a square.
    const target=event.target
    const finish=()=>{document.removeEventListener('pointerup',consume,true);document.removeEventListener('click',consume,true);clearTimeout(timer)}
    const consume=(next:Event)=>{if(next.target===target){next.preventDefault();next.stopImmediatePropagation()}if(next.type==='click')finish()}
    const timer=setTimeout(finish,1000)
    document.addEventListener('pointerup',consume,true);document.addEventListener('click',consume,true)
    event.preventDefault();event.stopImmediatePropagation();close.current()
   }
  }
  const observer=new ResizeObserver(position);observer.observe(panel);if(anchor)observer.observe(anchor)
  window.addEventListener('resize',position);window.addEventListener('scroll',position,true)
  document.addEventListener('keydown',key,true);document.addEventListener('pointerdown',outside,true)
  return()=>{
   layers.splice(layers.lastIndexOf(id),1)
   observer.disconnect();window.removeEventListener('resize',position);window.removeEventListener('scroll',position,true)
   document.removeEventListener('keydown',key,true);document.removeEventListener('pointerdown',outside,true)
   const restore=panel.contains(document.activeElement)||document.activeElement===document.body
   if(typeof panel.hidePopover==='function'&&panel.matches(':popover-open'))panel.hidePopover()
   if(restore&&anchor?.isConnected)anchor.focus({preventScroll:true})
  }
 },[open,id,trigger,role,focusLast])
 const keyboard=(event:KeyboardEvent<HTMLDivElement>)=>{
  event.stopPropagation()
  if(role!=='menu'||event.nativeEvent.isComposing)return
  const items=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=menuitem]:not(:disabled)'))
  if(event.key==='Tab'){close.current();trigger.current?.focus();return}
  const current=items.indexOf(document.activeElement as HTMLButtonElement)
  const index=event.key==='ArrowDown'?(current+1)%items.length:event.key==='ArrowUp'?(current-1+items.length)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null
  if(index!==null){event.preventDefault();items[index]?.focus();return}
  if(event.key.length===1&&event.key.trim()&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
   const now=Date.now(),letter=event.key.toLocaleLowerCase(),previous=now-search.current.at<700?search.current.text:''
   const text=previous===letter?letter:previous+letter;search.current={text,at:now}
   const ordered=[...items.slice(current+1),...items.slice(0,current+1)],match=ordered.find(item=>item.textContent?.trim().toLocaleLowerCase().startsWith(text))
   if(match){event.preventDefault();match.focus()}
  }
 }
 if(!open)return null
 return createPortal(<div ref={ref} id={id} popover={typeof HTMLElement.prototype.showPopover==='function'?'manual':undefined} role={role} aria-label={label} tabIndex={-1} data-ledger-overlay-open="true" className={`ledger-floating ledger-${role==='menu'?'menu':'popover'}`} onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()} onKeyDown={keyboard}>{children}</div>,trigger.current?.closest('dialog')??document.body)
}
