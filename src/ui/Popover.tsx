import {useId,useRef,useState,type ReactNode} from 'react'
import {Button} from './Button'
import FloatingSurface from './FloatingSurface'
// Nonmodal form/information popover. Focus is not trapped; modal forms use Drawer.
export function Popover({label,children,disabled=false}:{label:string;children:ReactNode;disabled?:boolean}){
 const id=useId(),trigger=useRef<HTMLButtonElement>(null),[open,setOpen]=useState(false)
 if(disabled&&open)setOpen(false)
 return <><Button ref={trigger} disabled={disabled} aria-haspopup="dialog" aria-expanded={open} aria-controls={open?id:undefined} onClick={()=>setOpen(value=>!value)}>{label}</Button>
  <FloatingSurface id={id} open={open&&!disabled} label={label} role="dialog" trigger={trigger} onClose={()=>setOpen(false)}>{children}</FloatingSurface>
 </>
}
