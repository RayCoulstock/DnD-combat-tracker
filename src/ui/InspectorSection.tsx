import {useId,useState,type ReactNode} from 'react'
export function InspectorSection({title,description,children,defaultOpen=false,open,onOpenChange,sectionId,persistenceKey,className=''}:{title:string;description?:string;children:ReactNode;defaultOpen?:boolean;open?:boolean;onOpenChange?:(open:boolean)=>void;sectionId?:string;persistenceKey?:string;className?:string}){
 const id=useId(),[localOpen,setLocalOpen]=useState(()=>{try{const value=persistenceKey?localStorage.getItem(`ledger.ui.inspector.${persistenceKey}`):null;return value===null?defaultOpen:value==='true'}catch{return defaultOpen}}),expanded=open??localOpen
 return <details data-section={sectionId} data-ui-section={sectionId} className={`ledger-inspector-section ${className}`} open={expanded} onToggle={event=>{const next=event.currentTarget.open;if(next===expanded)return;if(open===undefined)setLocalOpen(next);if(persistenceKey)try{localStorage.setItem(`ledger.ui.inspector.${persistenceKey}`,String(next))}catch{/* Optional UI preference. */}onOpenChange?.(next)}}>
  <summary id={id}>{title}{description&&<span className="ledger-section-description">{description}</span>}</summary>
  <div className="ledger-inspector-body" role="region" aria-labelledby={id}>{children}</div>
 </details>
}
