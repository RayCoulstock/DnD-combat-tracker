import {useId,useState,type ReactNode} from 'react'
export function InspectorSection({title,description,children,defaultOpen=false,open,onOpenChange}:{title:string;description?:string;children:ReactNode;defaultOpen?:boolean;open?:boolean;onOpenChange?:(open:boolean)=>void}){
 const id=useId(),[localOpen,setLocalOpen]=useState(defaultOpen),expanded=open??localOpen
 return <details className="ledger-inspector-section" open={expanded} onToggle={event=>{const next=event.currentTarget.open;if(next===expanded)return;if(open===undefined)setLocalOpen(next);onOpenChange?.(next)}}>
  <summary id={id}>{title}{description&&<span className="ledger-section-description">{description}</span>}</summary>
  <div className="ledger-inspector-body" role="region" aria-labelledby={id}>{children}</div>
 </details>
}
