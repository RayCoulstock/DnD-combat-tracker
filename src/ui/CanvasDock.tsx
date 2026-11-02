import type {ReactNode} from 'react'
export function CanvasDock({slot,label,children,className=''}:{slot:1|2|3|4|5|6;label:string;children:ReactNode;className?:string}){
 return <div data-ui-zone={`D${slot}`} className={`ledger-canvas-dock dock-${slot} ${className}`} role={slot===2?'status':'group'} aria-label={label} onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}>{children}</div>
}
