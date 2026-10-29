import {dungeonLevels,primaryLevelId,type DungeonMap} from '../shared/dungeon'
import type {GameCommand} from '../shared/domain'
export interface LevelView {activeId:string;mode:'single'|'stacked';hiddenIds:string[];select:(id:string)=>void;setMode:(mode:'single'|'stacked')=>void;toggle:(id:string)=>void}
export default function DungeonLevelsPanel({map,view,send,disabled}:{map:DungeonMap;view:LevelView;send:(command:GameCommand)=>Promise<void>;disabled:boolean}){
 const levels=[...dungeonLevels(map)].sort((a,b)=>a.elevationFeet-b.elevationFeet||a.name.localeCompare(b.name))
 return <details open className="dungeon-levels"><summary>Dungeon Levels <small>{levels.length} · editing {levels.find(l=>l.id===view.activeId)?.name}</small></summary>
 <label>Map view<select aria-label="Level view" value={view.mode} onChange={e=>view.setMode(e.target.value as LevelView['mode'])}><option value="single">Single floor</option><option value="stacked">Stacked floors</option></select></label>
 <p>Selection and local visibility affect your view only. Player visibility is shared.</p>
 {levels.map(level=><section key={level.id} data-level-id={level.id} aria-label={`Level: ${level.name}`}>
  <button type="button" aria-pressed={view.activeId===level.id} onClick={()=>view.select(level.id)}>Edit {level.name} · {level.elevationFeet} ft</button>
  <label><input type="checkbox" checked={!view.hiddenIds.includes(level.id)} onChange={()=>view.toggle(level.id)}/>Show {level.name} locally</label>
  <form key={`${level.name}:${level.elevationFeet}:${level.playerVisible}`} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void send({type:'map.level.update',id:level.id,name:String(data.get('name')),elevationFeet:Number(data.get('elevation')),playerVisible:data.get('visible')==='on'})}}>
   <label>Level name<input aria-label={`${level.name} name`} name="name" defaultValue={level.name} maxLength={150} required disabled={disabled}/></label>
   <label>Elevation (feet)<input aria-label={`${level.name} elevation`} name="elevation" type="number" min={-1000} max={1000} step="any" defaultValue={level.elevationFeet} required disabled={disabled}/></label>
   <label><input aria-label={`${level.name} player visibility`} name="visible" type="checkbox" defaultChecked={level.playerVisible} disabled={disabled}/>Visible to players</label>
   <button disabled={disabled}>Apply level settings</button>
  </form>
  <button disabled={disabled||levels.length>=12} onClick={()=>void send({type:'map.level.duplicate',id:level.id,newId:crypto.randomUUID(),name:`${level.name.slice(0,140)} copy`,elevationFeet:level.elevationFeet+10})}>Duplicate {level.name}</button>
  <button disabled={disabled||levels.length===1} onClick={()=>{if(confirm(`Delete ${level.name}? Transfer its combatants first. Undo can restore this level; shared asset files stay available.`))void send({type:'map.level.remove',id:level.id})}}>Delete {level.name}</button>
 </section>)}
 <form onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void send({type:'map.level.add',id:crypto.randomUUID(),name:String(data.get('name')),elevationFeet:Number(data.get('elevation')),width:Number(data.get('width')),height:Number(data.get('height'))})}}>
  <h3>Add blank level</h3>
  <label>New level name<input aria-label="New level name" name="name" defaultValue="Upper Floor" maxLength={150} required/></label>
  <label>New level elevation<input aria-label="New level elevation" name="elevation" type="number" min={-1000} max={1000} step="any" defaultValue={10} required/></label>
  <label>Level width (squares)<input aria-label="New level width" name="width" type="number" min={4} max={50} defaultValue={map.width} required/></label>
  <label>Level height (squares)<input aria-label="New level height" name="height" type="number" min={4} max={50} defaultValue={map.height} required/></label>
  <button disabled={disabled||levels.length>=12}>Add level</button>
 </form>
 <small>Primary level: {levels.find(l=>l.id===primaryLevelId(map))?.name}. 1 square = 5 feet; elevation is absolute.</small>
 </details>
}
