import type {EncounterState} from './domain.ts'
export type CombatantId=string|number
export interface TurnOrder {mode:'initiative'|'manual';manualIds:CombatantId[];completedIds:CombatantId[]}
const same=(a:CombatantId|null,b:CombatantId|null)=>String(a)===String(b)
export const allegianceLabels={hero:'Ally',enemy:'Enemy',neutral:'Neutral'} as const
// Stable Array.sort preserves the existing tie rule and persisted SQL ordinal.
export function prepareTurnOrder(state:EncounterState):EncounterState{
 const ids=new Set(state.combatants.map(c=>String(c.id))),index=state.combatants.findIndex(c=>same(c.id,state.activeId))
 const unique=(values:CombatantId[])=>values.filter((id,i)=>ids.has(String(id))&&values.findIndex(other=>same(id,other))===i)
 const previous=state.turnOrder
 return {...state,turnOrder:{mode:previous?.mode??'initiative',manualIds:unique(previous?.manualIds??[]),completedIds:unique(previous?.completedIds??state.combatants.slice(0,Math.max(0,index)).map(c=>c.id)).filter(id=>!same(id,state.activeId))}}
}
export function reconcileTurnOrder(state:EncounterState):EncounterState{
 if(!state.turnOrder)return {...state,combatants:[...state.combatants].sort((a,b)=>b.initiative-a.initiative)}
 const prepared=prepareTurnOrder(state),order=prepared.turnOrder!
 const manualIds=order.manualIds.length||order.mode==='manual'?[...order.manualIds,...state.combatants.filter(c=>!order.manualIds.some(id=>same(id,c.id))).map(c=>c.id)]:[]
 const ranks=new Map(manualIds.map((id,i)=>[String(id),i]))
 return {...prepared,turnOrder:{...order,manualIds},combatants:[...state.combatants].sort(order.mode==='manual'?(a,b)=>ranks.get(String(a.id))!-ranks.get(String(b.id))!:(a,b)=>b.initiative-a.initiative)}
}
export function nextTurn(state:EncounterState):EncounterState{
 if(!state.combatants.length)return state
 const prepared=prepareTurnOrder(state),order=prepared.turnOrder!,index=state.combatants.findIndex(c=>same(c.id,state.activeId))
 if(index<0)return {...prepared,activeId:state.combatants[0].id}
 const completedIds=[...order.completedIds,state.combatants[index].id],done=new Set(completedIds.map(String))
 const next=Array.from({length:state.combatants.length},(_,i)=>state.combatants[(index+1+i)%state.combatants.length]).find(c=>!done.has(String(c.id)))
 return {...prepared,activeId:next?.id??state.combatants[0].id,round:state.round+(next?0:1),turnOrder:{...order,completedIds:next?completedIds:[]}}
}
export function removeFromOrder(state:EncounterState,id:CombatantId):EncounterState{
 const prepared=prepareTurnOrder(state),index=state.combatants.findIndex(c=>same(c.id,id)),remaining=state.combatants.filter(c=>!same(c.id,id))
 let next={...prepared,combatants:remaining}
 if(same(state.activeId,id)){
  const done=new Set(prepared.turnOrder!.completedIds.map(String))
  const pending=Array.from({length:state.combatants.length},(_,i)=>state.combatants[(index+1+i)%state.combatants.length]).find(c=>!same(c.id,id)&&!done.has(String(c.id)))
  next={...next,activeId:pending?.id??remaining[0]?.id??null,round:state.round+(remaining.length&&!pending?1:0),turnOrder:{...prepared.turnOrder!,completedIds:pending?prepared.turnOrder!.completedIds:[]}}
 }
 return reconcileTurnOrder(next)
}
