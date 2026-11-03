import {useLayoutEffect,useRef,useState} from 'react'
import type {Combatant,EncounterState,GameCommand} from '../shared/domain'
import {allegianceLabels} from '../shared/combatOrder'
import {Button,Feedback,Menu,Popover} from './ui'
import './combat-controls.css'
type Send=(command:GameCommand)=>Promise<void>
type Subject=Pick<Combatant,'id'|'name'|'initiative'|'side'>
export function CombatControls({combatant,send,connected=true}:{combatant:Subject;send:Send;connected?:boolean}){
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[failed,setFailed]=useState(false)
 const formRef=useRef<HTMLFormElement>(null),pendingFocus=useRef(false)
 useLayoutEffect(()=>{if(!busy&&pendingFocus.current){pendingFocus.current=false;formRef.current?.querySelector<HTMLButtonElement>('button[type=submit]')?.focus()}},[busy])
 return <span className="combat-controls"><Popover label={`Edit combat controls for ${combatant.name}`} disabled={!connected} onOpenChange={()=>{setMessage('');setFailed(false)}} triggerContent={<>Initiative {combatant.initiative} · {allegianceLabels[combatant.side]}</>}><form ref={formRef} className="ledger-form combat-control-form" key={`${combatant.id}:${combatant.initiative}:${combatant.side}`} noValidate onSubmit={event=>{event.preventDefault();const fields=new FormData(event.currentTarget),raw=String(fields.get('initiative')).trim(),initiativeChanged=raw!==String(combatant.initiative),side=fields.get('side') as Combatant['side'];if(initiativeChanged&&(!/^[+-]?\d+$/.test(raw)||Math.abs(Number(raw))>1000)){setFailed(true);setMessage('Enter an integer from -1000 to 1000. Empty values are not zero.');return}setFailed(false);if(!initiativeChanged&&side===combatant.side){setMessage('No changes to save.');return}pendingFocus.current=true;setBusy(true);setMessage('');void send({type:'combatant.controls',combatantId:combatant.id,...(initiativeChanged?{initiative:Number(raw)}:{}),...(side!==combatant.side?{side}:{})}).then(()=>setMessage('Combat controls saved.')).catch(e=>{setFailed(true);setMessage(e.message)}).finally(()=>setBusy(false))}}><h3>{combatant.name}</h3><p>Encounter changes only. Library defaults, ownership and campaign state stay separate.</p><fieldset disabled={busy||!connected}><legend>Combat controls</legend><label>Initiative<input name="initiative" inputMode="numeric" defaultValue={combatant.initiative} autoComplete="off"/></label><label>Allegiance<select aria-label="Allegiance" name="side" defaultValue={combatant.side}>{Object.entries(allegianceLabels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label><Button type="submit" variant="primary">{busy?'Saving…':'Save combat controls'}</Button></fieldset>{message&&<Feedback error={failed}>{message}</Feedback>}</form></Popover></span>
}
export function TurnOrderMenu({state,send,connected=true}:{state:Pick<EncounterState,'turnOrder'>;send:Send;connected?:boolean}){
 const[error,setError]=useState(''),[busy,setBusy]=useState(false),mode=state.turnOrder?.mode??'initiative'
 const root=useRef<HTMLDivElement>(null),pendingFocus=useRef(false)
 useLayoutEffect(()=>{if(!busy&&pendingFocus.current){pendingFocus.current=false;root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()}},[busy])
 return <div ref={root} className="turn-order-controls"><Menu label="Turn order" triggerContent={mode==='manual'?'Manual order ▾':'Initiative order ▾'} disabled={!connected||busy} items={(['initiative','manual'] as const).map(value=>({id:value,label:value==='manual'?'Use manual order':'Use initiative order',disabled:value===mode,onSelect:()=>{pendingFocus.current=true;setError('');setBusy(true);void send({type:'initiative.mode',mode:value}).catch(e=>setError(e.message)).finally(()=>setBusy(false))}}))}/>{error&&<Feedback error>{error}</Feedback>}</div>
}
export function ManualMoves({combatant,state,send,connected=true}:{combatant:Subject;state:Pick<EncounterState,'combatants'|'turnOrder'>;send:Send;connected?:boolean}){
 const[busy,setBusy]=useState(false),[error,setError]=useState('')
 const root=useRef<HTMLSpanElement>(null),pendingFocus=useRef<HTMLButtonElement|null>(null)
 useLayoutEffect(()=>{if(!busy&&pendingFocus.current){const target=pendingFocus.current;pendingFocus.current=null;if(target.isConnected&&!target.disabled)target.focus();else root.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()}},[busy])
 if(state.turnOrder?.mode!=='manual')return null
 const index=state.combatants.findIndex(c=>String(c.id)===String(combatant.id))
 const move=(direction:'up'|'down',button:HTMLButtonElement)=>{pendingFocus.current=button;setBusy(true);setError('');void send({type:'initiative.move',combatantId:combatant.id,direction}).catch(e=>setError(e.message)).finally(()=>setBusy(false))}
 return <span ref={root} className="manual-moves"><Button aria-label={`Move ${combatant.name} up`} disabled={!connected||busy||index<=0} onClick={event=>move('up',event.currentTarget)}>↑</Button><Button aria-label={`Move ${combatant.name} down`} disabled={!connected||busy||index===state.combatants.length-1} onClick={event=>move('down',event.currentTarget)}>↓</Button>{error&&<Feedback error>{error}</Feedback>}</span>
}
