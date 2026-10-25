import type {ReactNode,RefObject} from 'react'
export interface ObjectToolbarContext{title:string;position:[number,number,number];actions:{label:string;run:()=>void;disabled?:boolean}[];properties?:ReactNode;onDismiss:()=>void}
export default function FloatingObjectToolbar({context,target}:{context:ObjectToolbarContext;target:RefObject<HTMLDivElement|null>}){
 const dismiss=()=>{const canvas=target.current?.closest('.tabletop-shell')?.querySelector<HTMLElement>('.battlefield-wrap');context.onDismiss();canvas?.setAttribute('tabindex','-1');canvas?.focus({preventScroll:true})}
 return <div ref={target} className="floating-object-toolbar" role="toolbar" aria-label={`${context.title} controls`} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();dismiss()}}}><strong>{context.title}</strong><div className="floating-actions">{context.actions.map(a=><button key={a.label} disabled={a.disabled} onClick={a.run}>{a.label}</button>)}<button aria-label="Dismiss object controls" onClick={dismiss}>×</button></div>{context.properties&&<details><summary>Properties</summary>{context.properties}</details>}</div>
}
