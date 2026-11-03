import {Button} from './Button'
import type {ReactNode} from 'react'
export function Feedback({children,error=false,onDismiss}:{children:ReactNode;error?:boolean;onDismiss?:()=>void}){
 return <div className={`ledger-feedback ${error?'is-error':'is-success'}`} role={error?'alert':'status'}><span>{children}</span>{onDismiss&&<Button aria-label="Dismiss message" onClick={onDismiss}>×</Button>}</div>
}
export function EmptyState({title,children}:{title:string;children?:ReactNode}){return <div className="ledger-empty-state"><h3>{title}</h3>{children&&<p>{children}</p>}</div>}
