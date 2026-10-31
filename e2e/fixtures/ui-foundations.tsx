// Browser-only test fixture; not a production route or part of the app bundle.
import {StrictMode,useState} from 'react'
import {createRoot} from 'react-dom/client'
import App from '../../src/App.jsx'
import Modal from '../../src/Modal'
import MiniatureSettings from '../../src/MiniatureSettings'
import {Button,StatusPill,Menu,SplitButton,Popover,Drawer,InspectorSection} from '../../src/ui'
import {combatantSchema} from '../../shared/domain'
import '../../src/styles.css'
const combatant=combatantSchema.parse({id:'sample',name:'Sample character',side:'hero',initiative:10,hp:10,maxHp:10,ac:12,conditions:[],saves:[],actions:[]})
function Fixture(){
 const [drawer,setDrawer]=useState(false),[picker,setPicker]=useState(false),[miniature,setMiniature]=useState(false),[action,setAction]=useState('None'),[count,setCount]=useState(0),[submitted,setSubmitted]=useState(0),[disabled,setDisabled]=useState(false)
 const items=[{id:'alpha',label:'Alpha action',onSelect:()=>setAction('Alpha')},{id:'disabled',label:'Unavailable action',disabled:true,onSelect:()=>setAction('Wrong')},{id:'beta',label:'Beta action',onSelect:()=>setAction('Beta')},{id:'remove',label:'Remove sample',danger:true,group:'Danger',onSelect:()=>setAction('Remove')}]
 return <><section style={{padding:16,background:'var(--ledger-bg)',color:'var(--ledger-ink)',fontFamily:'var(--ledger-font-ui)'}} aria-label="Foundation controls">
  <h1>UI foundations</h1><div style={{display:'flex',gap:12,flexWrap:'wrap'}}>
   <Button onClick={()=>setDrawer(true)}>Open example drawer</Button><Menu label="Example actions" items={items} disabled={disabled}/>
   <SplitButton label="Run primary action" onClick={()=>setCount(c=>c+1)} menuLabel="More primary actions" items={items}/>
   <Popover label="Example form"><label>Popover name<input aria-label="Popover name" defaultValue="Draft"/></label><Button onClick={()=>setAction('Popover')}>Use draft</Button></Popover>
   <Button onClick={()=>setMiniature(true)}>Open miniature sample</Button><Button onClick={()=>setDisabled(v=>!v)}>Toggle menu availability</Button>
  </div>
  <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}}>{(['neutral','success','warning','danger','party']as const).map(tone=><StatusPill key={tone} tone={tone}>{`${tone} status`}</StatusPill>)}</div>
  <p>Selected action: <output aria-label="Selected action">{action}</output></p><p>Primary actions: <output aria-label="Primary actions">{count}</output></p>
  <InspectorSection title="Example inspector" description="Draft settings" defaultOpen><label>Inspector notes<input aria-label="Inspector notes" defaultValue="Unapplied"/></label></InspectorSection>
 </section>
 <Drawer open={drawer} title="Example drawer" onClose={()=>setDrawer(false)} footer={<StatusPill>Draft remains local</StatusPill>}>
  <form onSubmit={event=>{event.preventDefault();setSubmitted(n=>n+1)}}><label>Drawer notes<input aria-label="Drawer notes" defaultValue="Unapplied"/></label><Button>Non-submit button</Button><Button type="submit">Submit example form</Button></form>
  <p>Submissions: <output aria-label="Submissions">{submitted}</output></p><Button onClick={()=>setPicker(true)}>Open nested picker</Button>
  <Menu label="Drawer actions" items={items}/><Popover label="Drawer form"><label>Drawer popover field<input aria-label="Drawer popover field"/></label></Popover>
  {picker&&<Modal label="Nested picker" onClose={()=>setPicker(false)}><h2>Nested picker</h2><Button onClick={()=>setPicker(false)}>Close nested picker</Button></Modal>}
 </Drawer>
 {miniature&&<MiniatureSettings combatant={combatant} connected csrf="" api={async()=>({assets:[],total:0,maxBytes:26214400})} send={async()=>{setAction('Saved miniature')}} onClose={()=>setMiniature(false)}/>}
 <section aria-label="Existing local app"><App/></section></>
}
createRoot(document.getElementById('root')!).render(<StrictMode><Fixture/></StrictMode>)
