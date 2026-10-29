import {useState} from 'react'
import Modal from './Modal'
import {transitionRoute,type FloorTransition} from '../shared/transitions'
import {dungeonLevels,primaryLevelId,type DungeonMap} from '../shared/dungeon'
import type {GameCommand} from '../shared/domain'
import type {BattleMapState} from './mapState'
export default function TransitionTravel({transition,map,battleMap,combatants,combatantId,from,send,onFollow,onClose,disabled}:{transition:FloorTransition;map:DungeonMap;battleMap:BattleMapState;combatants:{id:string|number;floorId?:string;name:string}[];combatantId:string|number;from:'source'|'destination';send:(command:GameCommand)=>Promise<void>;onFollow:(floorId:string)=>void;onClose:()=>void;disabled:boolean}){
 const[allowRemoteSource,setRemote]=useState(false),[allowOccupied,setOccupied]=useState(false),[follow,setFollow]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState('')
 const{source,destination}=transitionRoute(transition,from),level=dungeonLevels(map).find(l=>l.id===destination.floorId)
 const combatant=combatants.find(c=>String(c.id)===String(combatantId)),position=battleMap.tokens[String(combatantId)]
 const offSource=position?.x!==source.x||position?.z!==source.z
 const occupied=combatants.some(c=>String(c.id)!==String(combatantId)&&(c.floorId??primaryLevelId(map))===destination.floorId&&battleMap.tokens[String(c.id)]?.x===destination.x&&battleMap.tokens[String(c.id)]?.z===destination.z)
 return <Modal label="Move through transition" onClose={onClose}><section className="transition-confirmation"><h2>{transition.name||transition.type}</h2>
 <p>Move {combatant?.name??'selected combatant'} to {level?.name??'missing floor'} at square ({destination.x}, {destination.z})?</p><p>Movement cost: {transition.movementCost}. No movement or actions are deducted.</p>
 {!level?.playerVisible&&<p>The destination is hidden. Transferring does not reveal it to players.</p>}
 {offSource&&<label><input type="checkbox" checked={allowRemoteSource} onChange={e=>setRemote(e.target.checked)}/>Combatant is not on the source square. Allow this transfer.</label>}
 {occupied&&<label><input type="checkbox" checked={allowOccupied} onChange={e=>setOccupied(e.target.checked)}/>Destination is occupied. Allow tokens to stack.</label>}
 <label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/>Follow combatant to destination floor</label>
 <button disabled={disabled||busy||!level||offSource&&!allowRemoteSource||occupied&&!allowOccupied} onClick={()=>{setBusy(true);setMessage('');void send({type:'combatant.transition.use',combatantId,transitionId:transition.id,from,allowRemoteSource,allowOccupied}).then(()=>{if(follow)onFollow(destination.floorId);onClose()}).catch(error=>setMessage(error.message)).finally(()=>setBusy(false))}}>Confirm transfer</button>
 {!level?.playerVisible&&level&&<button disabled={disabled||busy} onClick={()=>{setBusy(true);void send({type:'map.level.update',id:level.id,name:level.name,elevationFeet:level.elevationFeet,playerVisible:true}).catch(error=>setMessage(error.message)).finally(()=>setBusy(false))}}>Reveal destination floor</button>}
 <button onClick={onClose}>Cancel</button>{message&&<p role="alert">{message}</p>}</section></Modal>
}
