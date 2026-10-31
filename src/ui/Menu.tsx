import {useId,useRef,useState,type ReactNode} from 'react'
import {Button} from './Button'
import FloatingSurface from './FloatingSurface'
export interface MenuEntry {id:string;label:string;onSelect:()=>void;disabled?:boolean;danger?:boolean;group?:string}
export function Menu({label,items,disabled=false,triggerContent,className=''}:{label:string;items:MenuEntry[];disabled?:boolean;triggerContent?:ReactNode;className?:string}){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false),[last,setLast]=useState(false)
 if(disabled&&open)setOpen(false)
 return <><Button ref={trigger} className={`ledger-menu-trigger ${className}`} disabled={disabled} aria-label={label} aria-haspopup="menu" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>{setLast(false);setOpen(value=>!value)}} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setLast(event.key==='ArrowUp');setOpen(true)}}}>{triggerContent??<>{label}<span aria-hidden="true">▾</span></>}</Button>
  <FloatingSurface id={id} open={open&&!disabled} label={label} role="menu" trigger={trigger} onClose={()=>setOpen(false)} focusLast={last}>
   {items.map((item,index)=><div key={item.id} role="presentation">{item.group&&item.group!==items[index-1]?.group&&<div className="ledger-menu-group" role="presentation">{item.group}</div>}<Button role="menuitem" className="ledger-menu-item" variant={item.danger?'danger':'secondary'} disabled={item.disabled} onClick={()=>{setOpen(false);item.onSelect()}}>{item.label}</Button></div>)}
  </FloatingSurface>
 </>
}
export function SplitButton({label,onClick,menuLabel,items,disabled=false}:{label:string;onClick:()=>void;menuLabel:string;items:MenuEntry[];disabled?:boolean}){
 return <div className="ledger-split-button" role="group" aria-label={label}><Button onClick={onClick} disabled={disabled}>{label}</Button><Menu label={menuLabel} items={items} disabled={disabled} triggerContent={<span aria-hidden="true">▾</span>}/></div>
}
