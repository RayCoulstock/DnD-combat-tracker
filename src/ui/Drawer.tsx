import type {ReactNode} from 'react'
import Modal from '../Modal'
import {Button} from './Button'
// Modal drawer. Keep the form/draft owner outside this wrapper; its children
// remain mounted while closed, just as a collapsed inspector's children do.
export function Drawer({open,title,onClose,children,footer,className=''}:{open:boolean;title:string;onClose:()=>void;children:ReactNode;footer?:ReactNode;className?:string}){
 return <Modal open={open} label={title} className={`ledger-drawer ${className}`} onClose={onClose}>
  <div className="ledger-drawer-heading"><h2>{title}</h2><Button onClick={onClose} aria-label={`Close ${title}`}>Close</Button></div>
  <div className="ledger-drawer-body">{children}</div>{footer&&<div className="ledger-drawer-footer">{footer}</div>}
 </Modal>
}
