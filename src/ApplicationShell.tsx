import {useState,type ReactNode} from 'react'
import {Swords,HelpCircle,UserRound,List,Map,LayoutGrid,Plus,ChevronRight,Users} from 'lucide-react'
import {Button,Menu,SplitButton,StatusPill,Popover,type MenuEntry} from './ui'
import Modal from './Modal'
import './application-shell.css'

export interface TableChrome {
 visible?:boolean; sessionState?:string; context?:ReactNode; players?:ReactNode; sessionItems?:MenuEntry[]
 templatesRequest?:number; libraryOpen?:boolean; closeLibrary?:()=>void
}
export function AppBar({mode,player,signedIn,status,count,onMode,onTable,onAssets,onCombatants,onTemplates,onRejoin,onSignOut}:{mode:'local'|'online';player:boolean;signedIn:boolean;status:string;count:number;onMode:(mode:'local'|'online')=>void;onTable:()=>void;onAssets?:()=>void;onCombatants?:()=>void;onTemplates?:()=>void;onRejoin:()=>void;onSignOut:()=>void}){
 const[help,setHelp]=useState(false)
 const modes:MenuEntry[]=[{id:'local',label:'Local tracker',onSelect:()=>onMode('local')},{id:'online',label:'Multiplayer',onSelect:()=>onMode('online')}]
 return <><header className="ledger-appbar" data-ui-zone="A" aria-label="Application bar">
  <Button className="ledger-brand" aria-label="Encounter Ledger — Table" onClick={onTable}><Swords aria-hidden="true" size={20}/><span>Encounter <b>Ledger</b></span></Button>
  {!player&&<Menu label="Table mode" className="ledger-mode" triggerContent={<>{mode==='local'?'Local tracker':'Multiplayer'} ▾</>} items={modes}/>}
  <nav aria-label="Application navigation"><Button className="ledger-table-link" onClick={onTable}>Table</Button>{(onAssets||onCombatants||onTemplates)&&<Menu label="Libraries" items={[...(onCombatants?[{id:'combatants',label:'Combatant Library',onSelect:onCombatants}]:[]),...(onAssets?[{id:'assets',label:'3D Asset Library',onSelect:onAssets}]:[]),...(onTemplates?[{id:'templates',label:'Map templates · current table',onSelect:onTemplates}]:[])]}/>}</nav>
  <div className="ledger-account"><span className={`connection ${mode==='local'?'local':status.toLowerCase()} ledger-connection`} role="status">{mode==='local'?'Local only':status}</span>{mode==='online'&&signedIn&&status==='Connected'&&<span className="ledger-online-count">{count} players online</span>}
   <Button className="ledger-help" aria-label="Help and keyboard shortcuts" onClick={()=>setHelp(true)}><HelpCircle size={18}/></Button>
   <Menu label="Account" triggerContent={<><UserRound size={18}/><span className="ledger-account-label">{signedIn?(player?'Player':'DM'):'Account'}</span></>} items={[
    ...(player?modes:[]),{id:'help',label:'Help and keyboard shortcuts',onSelect:()=>setHelp(true)},
    ...(signedIn?[{id:'rejoin',label:'Refresh / rejoin',onSelect:onRejoin},{id:'logout',label:'Sign out',onSelect:onSignOut,group:'Account'}]:[{id:'signin',label:'Sign in',onSelect:()=>onMode('online')}])
   ]}/>
  </div>
 </header>{help&&<Modal label="Help and keyboard shortcuts" onClose={()=>setHelp(false)}><section className="ledger-help-sheet"><h2>Help and keyboard shortcuts</h2><p>Local tracker is stored in this browser tab. Multiplayer encounter changes save through the server; campaign character state and checkpoints have separate explicit save actions.</p><h3>Map editor</h3><dl><dt>V / F / W / D / O / E</dt><dd>Select / Floor / Wall / Door / Object / Erase</dd><dt>Delete / Shift+D</dt><dd>Delete / duplicate selected scenery where supported</dd><dt>Escape</dt><dd>Close the top menu or dialog; otherwise cancel the current map interaction</dd></dl><p>Shortcuts do not run in text fields or open dialogs. Use labelled map controls for camera, floors, fullscreen and tactical tools. Ruler measurement uses a left drag.</p><p>Menus: arrows, Home/End and typing select actions; Enter activates. Tab leaves the menu.</p><Button onClick={()=>setHelp(false)}>Close help</Button></section></Modal>}</>
}
export function SessionBar({children,round,state,view,onView,players,items,add,next,canChange=true,hasCombatants=false,library,editorAllowed=true,player=false}:{children?:ReactNode;round?:number;state:string;view?:string;onView?:(view:string)=>void;players?:ReactNode;items?:MenuEntry[];add?:()=>void;next?:()=>void;canChange?:boolean;hasCombatants?:boolean;library?:()=>void;editorAllowed?:boolean;player?:boolean}){
 const views=[{id:'tracker',label:'Tracker',icon:List},{id:'map',label:'Battle map',icon:Map},{id:'editor',label:'Map editor',icon:LayoutGrid}].filter(item=>editorAllowed||item.id!=='editor')
 const additions:MenuEntry[]=[{id:'paste',label:'Paste stat block',onSelect:()=>add?.()},...(library?[{id:'library',label:'From Combatant Library',onSelect:library}]:[])]
 return <section className={`ledger-sessionbar ${player?'ledger-player-session':''}`} data-ui-zone="B" aria-label="Session bar">
  <div className="ledger-context" data-ui-zone="B1">{children}</div>
  <div className="ledger-round-state" data-ui-zone="B2">{round!==undefined&&<span className="ledger-round">Round <strong>{round}</strong></span>}<StatusPill tone={state==='Live'?'success':'neutral'}>{state}</StatusPill></div>
  {onView&&<><div className="ledger-views" role="group" aria-label="Choose encounter view" data-ui-zone="B3">{views.map(({id,label,icon:Icon})=><Button key={id} aria-label={label} aria-pressed={view===id} onClick={()=>onView(id)}><Icon aria-hidden="true" size={16}/><span>{label}</span></Button>)}</div><div className="ledger-compact-views"><Menu label="Views" triggerContent={<LayoutGrid size={18}/>} items={views.map(({id,label})=>({id,label,onSelect:()=>onView(id)}))}/></div></>}
  <div className="ledger-session-actions">
   {players&&<div className="ledger-players" data-ui-zone="B4">{players}</div>}
   {items&&items.length>0&&<div data-ui-zone="B5"><Menu label="Session" triggerContent={<><span className="ledger-session-label">Session ▾</span><span className="ledger-session-icon" aria-hidden="true">···</span></>} items={items}/></div>}
   {add&&<div className="ledger-add" data-ui-zone="B6"><div className="ledger-add-wide"><SplitButton label="Add combatant" onClick={add} menuLabel="Add combatant options" disabled={!canChange} items={additions}/></div><div className="ledger-add-compact"><Menu label="Add combatant" triggerContent={<Plus size={18}/>} disabled={!canChange} items={additions}/></div></div>}
   {next&&<Button className="ledger-next" aria-label="Next turn" variant="primary" disabled={!canChange||!hasCombatants} onClick={next}><span>Next turn</span><ChevronRight size={18}/></Button>}
  </div>
 </section>
}
export function Presence({members,onManage}:{members:{id:string;displayName:string;connected:boolean}[];onManage?:()=>void}){
 return <Popover label="Players"><h3>Players · {members.filter(m=>m.connected).length}/{members.length} online</h3>{members.length?<ul>{members.map(m=><li key={m.id}>{m.displayName} · {m.connected?'Connected':'Offline'}</li>)}</ul>:<p>No players yet.</p>}{onManage&&<Button onClick={onManage}><Users size={16}/>Invitations & token visibility</Button>}</Popover>
}
