import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {ObjectToolbarContext} from './FloatingObjectToolbar'
import {edgePose} from '../shared/architecture'
import ArchitectureProperties from './ArchitectureProperties'
import { calibrationSchema, type ArchitecturalVisual } from '../shared/architecture'
import AssetLibrary from './AssetLibrary'
import SceneryProperties from './SceneryProperties'
import { isScenery, scenerySchema, sceneryLimits, type SceneryProp } from '../shared/scenery'
import type { Asset3D } from '../shared/assets'
import BattleMap3D, { type BattleMap3DProps } from './BattleMap3D'
import { floorTypes, themes, dungeonSchema, readDungeon, type DungeonMap, type ProceduralProp } from '../shared/dungeon'
import { generateDungeon, type GenerationOptions } from '../shared/generator'
import { reconcileBattleMap } from './mapState'
import type { EncounterState, GameCommand } from '../shared/domain'
import type { EditorHit, EditorInteraction } from './DungeonScene'
import './dungeon-builder.css'
import './editor-workspace.css'
export interface MapLibrary { campaignId: string; api: (path: string, body?: unknown) => Promise<unknown>; encounterId: string; revision: number }
interface SavedMap { id: string; name: string; revision: number; document?: DungeonMap; width?: number; height?: number }
const localTemplates = z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(150), revision: z.number().int().positive(), document: dungeonSchema }).strict()).max(100)
const localKey = 'ledger.dungeon.templates.v1'
export default function DungeonBuilder({ state, editing, send, connected, library, battlefield }: {
  state: EncounterState; editing: boolean; send: (command: GameCommand) => Promise<void>; connected: boolean; library?: MapLibrary
  battlefield: Omit<BattleMap3DProps, 'map' | 'dungeonMap' | 'editor'>
}) {
  const workspaceRef=useRef<HTMLElement>(null)
  useEffect(()=>{let frame=0;const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const el=workspaceRef.current;if(el)el.style.setProperty('--workspace-height',`${Math.max(300,window.innerHeight-(el.getBoundingClientRect().top+window.scrollY)-14)}px`)})};const observer=new ResizeObserver(resize);observer.observe(window.document.body);window.addEventListener('resize',resize);resize();return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',resize)}},[])
  const [inspectorHidden,setInspectorHidden]=useState(false)
  const [savedDocument,setSavedDocument]=useState<string|null>(null)
  const baselineAfterLoad=useRef<{revision:number;name:string}|null>(null)
  useEffect(()=>{const pending=baselineAfterLoad.current;if(pending&&state.dungeonMap&&(state.mapRevision??0)!==pending.revision){setSavedDocument(JSON.stringify({document:state.dungeonMap,name:pending.name}));baselineAfterLoad.current=null}},[state.mapRevision,state.dungeonMap])
  const [accordionEpoch,setAccordionEpoch]=useState(0)
  const [architecturalPicker,setArchitecturalPicker]=useState<{kind:'wall'|'door';selected:boolean}|null>(null)
  const [wallAsset,setWallAsset]=useState<Asset3D|null>(null),[doorAsset,setDoorAsset]=useState<Asset3D|null>(null)
  const [knownAssets,setKnownAssets]=useState<Record<string,Asset3D>>({})
  const visualFor=(asset:Asset3D|null):ArchitecturalVisual|undefined=>asset?{assetId:asset.id,calibration:calibrationSchema.strip().parse(asset.presentation.architecture??{})}:undefined
  const [sceneryAsset, setSceneryAsset] = useState<SceneryProp | null>(null), [pickingScenery, setPickingScenery] = useState(false), [snap, setSnap] = useState(true)
  const [selected, setSelected] = useState<EditorHit | null>(null)
  const [tool,setToolValue]=useState<EditorInteraction['tool']>('select'),[toolEpoch,setToolEpoch]=useState(0)
  const setTool=useCallback((next:EditorInteraction['tool'])=>{setToolValue(next);setToolEpoch(n=>n+1);if(!['select','sceneryMove','objectMove'].includes(next))setSelected(null)},[])
  const [floor, setFloor] = useState<DungeonMap['floors'][number]['type']>('stone')
  const [corridorWidth,setCorridorWidth]=useState(2),[wallsOnly,setWallsOnly]=useState(false)
  const [wallMaterial, setWallMaterial] = useState<'stone' | 'wood'>('stone')
  const [propType, setPropType] = useState<ProceduralProp['type']>('crate')
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const [doorState, setDoorState] = useState<'open' | 'closed' | 'locked'>('closed')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [maps, setMaps] = useState<SavedMap[]>([])
  const [templateId, setTemplateId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [name, setName] = useState(state.dungeonMap?.name??'New dungeon')
  const [width, setWidth] = useState(20), [height, setHeight] = useState(20)
  const [showGenerator, setShowGenerator] = useState(false)
  const [seed, setSeed] = useState('my-dungeon')
  const [theme, setTheme] = useState<GenerationOptions['theme']>('stone-dungeon')
  const [roomCount, setRoomCount] = useState(4), [minRoomSize, setMinRoomSize] = useState(3), [maxRoomSize, setMaxRoomSize] = useState(6)
  const [preview, setPreview] = useState<{ document: DungeonMap; options: GenerationOptions } | null>(null)
  const document = preview?.document ?? state.dungeonMap
  const previewGeneration = (newSeed = seed) => {
    try {
      const options = { width, height, roomCount, minRoomSize, maxRoomSize, theme, seed: newSeed }
      setPreview({ document: generateDungeon(options), options }); setSeed(newSeed); setMessage('')
    } catch (e) { setMessage((e as Error).message) }
  }
  const request = async <T,>(path: string, body?: unknown) => await library!.api(`/campaigns/${library!.campaignId}/maps${path}`, body) as T
  const libraryApi = library?.api, libraryCampaign = library?.campaignId
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const list = libraryApi && libraryCampaign ? await libraryApi(`/campaigns/${libraryCampaign}/maps`) as SavedMap[] : localTemplates.parse(JSON.parse(localStorage.getItem(localKey) ?? '[]'))
      if (!cancelled) setMaps(list)
    }
    void load().catch(e => { if (!cancelled) setMessage(e.message) })
    return () => { cancelled = true }
  }, [libraryApi, libraryCampaign, refresh])
  const run = async (fn: () => Promise<unknown>) => {
    if (!connected || busy) return
    setBusy(true); setMessage('')
    try { await fn(); setRefresh(n => n + 1) } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const dispatch = (command: GameCommand) => run(() => send(command))
  const selectedTemplate = maps.find(m => m.id === templateId)
  const localSave = (list: SavedMap[]) => { localStorage.setItem(localKey, JSON.stringify(localTemplates.parse(list))); setMaps(list) }
  const save = (overwrite: boolean) => run(async () => {
    if (!document) throw new Error('Create or generate a map first.')
    if (overwrite && (!selectedTemplate || !confirm('Overwrite the selected saved template? Existing encounters remain unchanged.'))) return
    if (library) await request(overwrite ? `/${templateId}/save` : '', { name, encounterId: library.encounterId, encounterRevision: library.revision, ...(overwrite ? { revision: selectedTemplate!.revision } : {}) })
    else {
      const saved = { id: overwrite ? templateId : crypto.randomUUID(), name, revision: overwrite ? selectedTemplate!.revision + 1 : 1, document: readDungeon({ ...document, name }) }
      localSave([...maps.filter(m => m.id !== saved.id), saved]); setTemplateId(saved.id)
    }
    setSavedDocument(JSON.stringify({document,name})); setMessage('Map saved. Encounter copies remain independent.')
  })
  const loadTemplate = () => run(async () => {
    if (!selectedTemplate) return
    if (document && !confirm('Replace the encounter map with a copy of this template? Combat statistics are preserved.')) return
    baselineAfterLoad.current={revision:state.mapRevision??0,name:selectedTemplate.name}
    try{await send(library ? { type: 'map.template.load', templateId } : { type: 'map.load', document: readDungeon(selectedTemplate.document) }); setName(selectedTemplate.name)}catch(error){baselineAfterLoad.current=null;throw error}
  })
  const manageTemplate = (action: 'rename' | 'duplicate' | 'delete') => run(async () => {
    if (!selectedTemplate) return
    if (action === 'delete' && !confirm('Delete this saved template? Encounter copies will not be deleted.')) return
    if (library) await request(`/${templateId}/${action}`, { revision: selectedTemplate.revision, ...(action !== 'delete' ? { name } : {}) })
    else if (action === 'delete') localSave(maps.filter(m => m.id !== templateId))
    else {
      const saved = { ...selectedTemplate, id: action === 'duplicate' ? crypto.randomUUID() : selectedTemplate.id, revision: action === 'duplicate' ? 1 : selectedTemplate.revision + 1, name, document: readDungeon({ ...readDungeon(selectedTemplate.document), name }) }
      localSave([...maps.filter(m => m.id !== saved.id), saved])
    }
    if (action === 'delete') setTemplateId('')
  })
  const hit = (value: EditorHit) => {
    if (tool === 'scenery' && sceneryAsset) { void dispatch({ type: 'map.scenery.place', prop: { ...sceneryAsset, id: crypto.randomUUID(), position: value.position ?? value.cell } }); return }
    if(tool==='objectMove'){const moving=document?.props.find(p=>p.id===selected?.objectId);if(moving&&!isScenery(moving))void dispatch({type:'map.prop.transform',propId:moving.id,position:value.cell,rotation:moving.rotation,scale:moving.scale??1});setTool('select');return}
    if (tool === 'sceneryMove') {
      const moving = document?.props.find(p => p.id === selected?.objectId)
      if (moving && isScenery(moving)) void dispatch({ type: 'map.scenery.update', propId: moving.id, transform: { position: value.position ?? value.cell, rotation: moving.rotation, scale: moving.scale, verticalOffset: moving.verticalOffset, visible: moving.visible } })
      setTool('select'); return
    }
    if (tool === 'select') {
      // Sparse furniture geometry leaves gaps in its occupied cell. Preserve direct
      // wall/door/prop hits, but let a floor hit select the prop on that square.
      const occupant = !value.objectId && document?.props.find(p => Math.floor(p.position.x + .5) === value.cell.x && Math.floor(p.position.z + .5) === value.cell.z)
      // Logical edge hit areas remain selectable through gaps in custom visuals.
      const edge=!value.objectId&&value.edgeDistance!==undefined&&value.edgeDistance<=.35?document?.walls.find(w=>w.id===value.wall.id):undefined
      const opening=edge&&document?.doors.find(d=>d.wallId===edge.id)
      setSelected(occupant ? { ...value, kind: 'prop', objectId: occupant.id } : edge ? {...value,wall:edge,kind:opening?'door':'wall',objectId:opening?.id??edge.id} : value)
      return
    }
    if (tool === 'floor') { void dispatch({ type: 'map.floor.paint', cells: [value.cell], material: floor }); return }
    if (tool === 'wall' && (value.kind === 'wall' || value.kind === 'door')) { setSelected(value); return }
    if (tool === 'wall') void dispatch({ type: 'map.wall.place', wall: { ...value.wall, material: wallMaterial, ...(wallAsset?{visual:visualFor(wallAsset)}:{}) } })
    else if (tool === 'door') {
      const wall = document?.walls.find(w => w.id === value.wall.id)
      if (!wall) { setMessage('Place a wall on this edge first.'); return }
      const existing = document?.doors.find(d => d.wallId === wall.id)
      void dispatch(existing ? { type: 'map.door.update', doorId: existing.id, state: doorState } : { type: 'map.door.place', door: { id: crypto.randomUUID(), wallId: wall.id, state: doorState, ...(doorAsset?{visual:visualFor(doorAsset)}:{}) } })
    } else if (tool === 'object') void dispatch({ type: 'map.prop.place', prop: { id: crypto.randomUUID(), type: propType, position: value.cell, rotation } })
    else if (tool === 'erase') {
      if (value.kind === 'prop') void dispatch({ type: 'map.prop.remove', propId: value.objectId! })
      else if (value.kind === 'door') void dispatch({ type: 'map.door.remove', doorId: value.objectId! })
      else if (value.kind === 'wall') void dispatch({ type: 'map.wall.remove', wallId: value.objectId! })
      else void dispatch({ type: 'map.floor.paint', cells: [value.cell], material: null })
    }
  }
  const selectedWall=document?.walls.find(w=>w.id===selected?.objectId)
  const prop = document?.props.find(p => p.id === selected?.objectId), door = document?.doors.find(d => d.id === selected?.objectId)
  // Cancellation must survive map-update renders and controls that consume the
  // bubbling key event. Keep ordinary shortcuts in their existing bubble handler.
  useEffect(() => {
    if (!editing) return
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setTool('select'); setSelected(null); setPickingScenery(false); setArchitecturalPicker(null)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [editing, setTool])
  useEffect(() => {
    if (!editing) return
    const key = (e: KeyboardEvent) => {
      if (!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!e.repeat&&connected&&!busy&&!preview&&!pickingScenery&&!architecturalPicker&&!(e.target instanceof HTMLElement&&(e.target.isContentEditable||e.target.closest('input,textarea,select,[role=dialog]')))) {const next=({v:'select',f:'floor',w:'wall',d:'door',o:'object',e:'erase'} as const)[e.key.toLowerCase() as 'v'|'f'|'w'|'d'|'o'|'e'];if(next){e.preventDefault();if(next==='object')setPickingScenery(true);else setTool(next);return}}
      if (!connected || busy || preview || pickingScenery || architecturalPicker || e.repeat || !prop || !isScenery(prop) || (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input,textarea,select')))) return
      const command: GameCommand | null = e.key === 'Delete' ? { type:'map.scenery.remove', propId:prop.id } : e.shiftKey && e.key.toLowerCase() === 'd' ? { type:'map.scenery.duplicate', propId:prop.id, newId:crypto.randomUUID(), position:{x:Math.min(document!.width-1,prop.position.x+1),z:Math.min(document!.height-1,prop.position.z+1)} } : null
      if (command) { e.preventDefault(); setBusy(true); void send(command).catch(error => setMessage(error.message)).finally(() => setBusy(false)) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [editing, connected, busy, preview, pickingScenery, architecturalPicker, prop, document, send,setTool])
  const chooseScenery = (asset: Asset3D) => {
    const role=asset.presentation.architecture?.role
    if(role==='wall'||role==='door'){setKnownAssets(previous=>({...previous,[asset.id]:asset}));if(role==='wall')setWallAsset(asset);else setDoorAsset(asset);setPickingScenery(false);setTool(role);return}

    setSceneryAsset(scenerySchema.parse({ id: 'placement-preview', type: 'asset', assetId: asset.id, label: asset.presentation.displayName || asset.name, category: asset.category, position: {x:0,z:0}, rotation: asset.presentation.defaultRotation, scale: Math.max(sceneryLimits.minScale, Math.min(sceneryLimits.maxScale, asset.presentation.defaultScale)), verticalOffset: Math.max(sceneryLimits.minOffset, Math.min(sceneryLimits.maxOffset, asset.presentation.verticalOffset)), visible: true })); setPickingScenery(false); setTool('scenery')
  }
  const focusProperties=()=>{setInspectorHidden(false);setAccordionEpoch(n=>n+1);window.setTimeout(()=>{const panel=Array.from(window.document.querySelectorAll('.inspector details[open]:nth-of-type(2) .builder-properties')).find(panel=>panel.getClientRects().length>0);panel?.scrollIntoView({block:'nearest',behavior:'smooth'});(panel?.querySelector<HTMLElement>('input[aria-label="Scenery scale"]')??panel?.querySelector<HTMLElement>('input[aria-label="Selected object scale"]')??panel?.querySelector<HTMLElement>('button,input,select'))?.focus()},0)}
  let objectToolbar:ObjectToolbarContext|undefined
  if(prop&&document){
    const scenery=isScenery(prop),position:[number,number,number]=[prop.position.x-document.width/2+.5,1,prop.position.z-document.height/2+.5]
    objectToolbar={title:scenery?prop.label:prop.type,position,onDismiss:()=>{setSelected(null);setTool('select')},actions:[
      {label:'Move',run:()=>setTool(scenery?'sceneryMove':'objectMove')},
      {label:'Rotate',run:()=>void dispatch(scenery?{type:'map.scenery.update',propId:prop.id,transform:{position:prop.position,rotation:(prop.rotation+45)%360,scale:prop.scale,verticalOffset:prop.verticalOffset,visible:prop.visible}}:{type:'map.prop.rotate',propId:prop.id,rotation:((prop.rotation+90)%360)as 0|90|180|270})},
      {label:'Scale',run:()=>focusProperties()},{label:'Duplicate',run:()=>void dispatch(scenery?{type:'map.scenery.duplicate',propId:prop.id,newId:crypto.randomUUID(),position:{x:Math.min(document.width-1,prop.position.x+1),z:Math.min(document.height-1,prop.position.z+1)}}:{type:'map.prop.place',prop:{...prop,id:crypto.randomUUID(),position:{x:Math.min(document.width-1,prop.position.x+1),z:Math.min(document.height-1,prop.position.z+1)}}})},
      {label:'Delete',run:()=>void dispatch({type:'map.prop.remove',propId:prop.id})},{label:'Properties',run:()=>focusProperties()}
    ].map(a=>({...a,disabled:busy||!connected})),properties:<p>Advanced placement and transforms are available in the editor properties panel.</p>}
  }else if(document&&(selectedWall||door)){
    const w=selectedWall??document.walls.find(w=>w.id===door!.wallId)!,pose=edgePose(w,document.width,document.height)
    objectToolbar={title:door?`Door · ${door.state}`:'Logical wall',position:[pose.x,1,pose.z],onDismiss:()=>{setSelected(null);setTool('select')},actions:[
      ...(door?(['open','closed','locked']as const).map(state=>({label:state==='open'?'Open':state==='closed'?(door.state==='locked'?'Unlock / close':'Close'):'Lock',run:()=>void dispatch({type:'map.door.update',doorId:door.id,state})})):[]),
      {label:'Change appearance',run:()=>setArchitecturalPicker({kind:door?'door':'wall',selected:true})},{label:'Remove',run:()=>void dispatch(door?{type:'map.door.remove',doorId:door.id}:{type:'map.wall.remove',wallId:w.id})},{label:'Properties',run:()=>focusProperties()}
    ].map(a=>({...a,disabled:busy||!connected})),properties:<p>{w.id} · {w.material}. The logical edge stays authoritative independently of its visual model.</p>}
  }
  const editor: EditorInteraction = { activation:toolEpoch, document:document??undefined, toolbar:objectToolbar, drawing: ['wall-line','room','corridor'].includes(tool)?{kind:tool as 'wall-line'|'room'|'corridor',width:corridorWidth,wallsOnly,floor,material:wallMaterial,visual:visualFor(wallAsset)}:undefined,onDraw:command=>{void dispatch(command)}, wallVisual:visualFor(wallAsset),doorVisual:visualFor(doorAsset), snap, scenery: tool === 'sceneryMove' && prop && isScenery(prop) ? prop : sceneryAsset ?? undefined, assetScope: battlefield.assetScope, assetContext: battlefield.assetContext, tool, selectedId: selected?.objectId, previewRotation: tool==='objectMove'&&prop&&!isScenery(prop)?prop.rotation:rotation, onHit: hit, onPaint: cells => { void dispatch({ type: 'map.floor.paint', cells, material: floor }) } }
  return <section ref={workspaceRef} className="dungeon-builder" data-editing={editing} data-inspector-hidden={inspectorHidden}>
    {architecturalPicker && library && <div className="miniature-dialog" role="dialog" aria-modal="true" aria-label={`Choose ${architecturalPicker.kind} visual`}><AssetLibrary api={library.api} csrf="" pickerTitle={`Choose ${architecturalPicker.kind} visual`} architecturalRole={architecturalPicker.kind} onClose={()=>setArchitecturalPicker(null)} onPick={asset=>{
      setKnownAssets(previous=>({...previous,[asset.id]:asset}))
      const visual=visualFor(asset)!
      if(architecturalPicker.selected){if(architecturalPicker.kind==='wall'&&selectedWall)void dispatch({type:'map.wall.visual',wallId:selectedWall.id,visual});if(architecturalPicker.kind==='door'&&door)void dispatch({type:'map.door.visual',doorId:door.id,visual})}
      else if(architecturalPicker.kind==='wall'){setWallAsset(asset);setTool('wall')}else{setDoorAsset(asset);setTool('door')}
      setArchitecturalPicker(null)
    }}/></div>}
    {pickingScenery && <div className="miniature-dialog" role="dialog" aria-modal="true" aria-label="Add Object"><AssetLibrary api={library?.api ?? (async () => ({assets:[],total:0,maxBytes:25*1024*1024}))} pickerTitle="Add Object" onPickBuiltin={type => { setPropType(type); setSceneryAsset(null); setPickingScenery(false); setTool('object') }} csrf="" onClose={() => setPickingScenery(false)} onPick={chooseScenery} /></div>}
    <aside className="builder-tools inspector" hidden={!editing||inspectorHidden} aria-label="Map inspector">
      <header className="inspector-header"><span className="eyebrow">MAP EDITOR</span><h2>{document?.name??'Flat battlefield'}</h2><p>{document&&JSON.stringify({document,name})!==savedDocument?'● Unsaved template changes':'Saved template'} · {state.mapRevision??0} revisions</p><button disabled={!connected||busy||Boolean(preview)} onClick={()=>void save(false)}>Save map</button><button onClick={()=>{workspaceRef.current?.querySelectorAll('.inspector details').forEach(d=>d.removeAttribute('open'))}}>Collapse all</button><button onClick={()=>setInspectorHidden(true)}>Hide panel »</button></header>
      <div className="inspector-scroll"><fieldset disabled={!connected||busy||Boolean(preview)} className="inspector-fields"><legend className="visually-hidden">Map tools</legend>
      <details key={`tool:${tool}:${accordionEpoch}`} open><summary>Active tool <small>{tool}</small></summary><div className="builder-properties" aria-label="Tool properties">          <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Snap scenery to grid</label>

          {tool==='scenery'&&sceneryAsset&&<fieldset><legend>Object placement settings</legend><p>{sceneryAsset.label}</p>{(['rotation','scale','verticalOffset'] as const).map(key=><label key={key}>Placement {key}<input type="number" step="any" min={key==='rotation'?0:key==='scale'?sceneryLimits.minScale:sceneryLimits.minOffset} max={key==='rotation'?360:key==='scale'?sceneryLimits.maxScale:sceneryLimits.maxOffset} value={sceneryAsset[key]} onChange={e=>{const result=scenerySchema.safeParse({...sceneryAsset,[key]:Number(e.target.value)});if(result.success)setSceneryAsset(result.data)}}/></label>)}</fieldset>}
          {(tool === 'scenery' || tool === 'sceneryMove') && <p>Click the floor to {tool === 'sceneryMove' ? 'move' : 'place'} scenery. Escape cancels. Middle-drag rotates; right-drag pans.</p>}
          {['wall-line','room','corridor'].includes(tool)&&<p>Left-drag snapped grid vertices to preview; release commits one edit. Escape cancels. Blue adds geometry; red marks corridor openings. Middle-drag rotates.</p>}
          {tool==='room'&&<label><input type="checkbox" checked={wallsOnly} onChange={e=>setWallsOnly(e.target.checked)}/>Walls only</label>}
          {tool==='corridor'&&<label>Corridor width<input aria-label="Corridor width" type="number" min={1} max={10} value={corridorWidth} onChange={e=>setCorridorWidth(Math.max(1,Math.min(10,Number(e.target.value))))}/></label>}
          {['floor','room','corridor'].includes(tool)&&<div className="material-segments floor-segments" role="group" aria-label="Paint material">{floorTypes.map(m=><button key={m} aria-pressed={floor===m} onClick={()=>setFloor(m)}>{m}</button>)}</div>}
          {['object','scenery'].includes(tool)&&<div className="object-choice"><p>{tool==='scenery'?sceneryAsset?.label:propType} · {tool==='scenery'?'Asset Library · GLB':'Built-in object'}</p><button onClick={()=>setPickingScenery(true)}>Change object</button></div>}
          {['wall','wall-line','room','corridor'].includes(tool)&&<>          <p>Wall visual: {wallAsset?.name ?? `Built-in ${wallMaterial}`}</p><button disabled={!library} onClick={()=>setArchitecturalPicker({kind:'wall',selected:false})}>Choose wall visual</button><button onClick={()=>setWallAsset(null)}>Built-in wall visual</button>
</>}
          {tool==='door'&&<>          <p>Door visual: {doorAsset?.name ?? 'Built-in door'}</p><button disabled={!library} onClick={()=>setArchitecturalPicker({kind:'door',selected:false})}>Choose door visual</button><button onClick={()=>setDoorAsset(null)}>Built-in door visual</button></>}
          {['wall','wall-line','room','corridor'].includes(tool)&&<div className="material-segments" role="group" aria-label="Wall material">{(['stone','wood']as const).map(m=><button key={m} aria-pressed={wallMaterial===m} onClick={()=>setWallMaterial(m)}>{m}</button>)}<label className="visually-hidden">Wall material<select aria-label="Wall material" value={wallMaterial} onChange={e => setWallMaterial(e.target.value as typeof wallMaterial)}><option>stone</option><option>wood</option></select></label></div>}
          {tool==='door'&&<label>Door state<select aria-label="Door state" value={doorState} onChange={e => setDoorState(e.target.value as typeof doorState)}><option>closed</option><option>open</option><option>locked</option></select></label>}
          {tool==='object'&&<label>Object rotation<select aria-label="Object rotation" value={rotation} onChange={e => setRotation(Number(e.target.value) as typeof rotation)}>{[0,90,180,270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label>}</div></details>
      <details key={`selection:${selected?.objectId}:${accordionEpoch}`} open={Boolean(selected?.objectId)}><summary>Selection <small>{selected?.kind??'None'}</small></summary><div className="builder-properties">{door&&<div className="material-segments" role="group" aria-label="Selected door state">{(['open','closed','locked']as const).map(value=><button key={value} aria-pressed={door.state===value} onClick={()=>void dispatch({type:'map.door.update',doorId:door.id,state:value})}>{value}</button>)}</div>}          {prop && isScenery(prop) && <SceneryProperties key={`${prop.id}:${state.mapRevision}`} prop={prop} width={document!.width} height={document!.height} send={command => { void dispatch(command) }} onMove={() => setTool('sceneryMove')} />}
          {prop&&!isScenery(prop)&&<form key={`${prop.id}:${state.mapRevision}`} onSubmit={e=>{e.preventDefault();const scale=Number(new FormData(e.currentTarget).get('scale'));void dispatch({type:'map.prop.transform',propId:prop.id,position:prop.position,rotation:prop.rotation,scale})}}><label>Selected object scale<input aria-label="Selected object scale" name="scale" type="number" min={.1} max={10} step={.1} defaultValue={prop.scale??1} required/></label><button>Apply object scale</button></form>}
          {selectedWall&&<button onClick={()=>void dispatch({type:'map.wall.place',wall:{...selectedWall,material:wallMaterial,visual:visualFor(wallAsset)}})}>Apply wall visual choice to selected wall</button>}
          {selectedWall&&<ArchitectureProperties api={library?.api} key={`wall:${selectedWall.id}:${state.mapRevision}`} kind="wall" visual={selectedWall.visual} asset={selectedWall.visual?knownAssets[selectedWall.visual.assetId]:undefined} onChoose={()=>setArchitecturalPicker({kind:'wall',selected:true})} onApply={visual=>void dispatch({type:'map.wall.visual',wallId:selectedWall.id,visual})}/>}
          {door&&<ArchitectureProperties api={library?.api} key={`door:${door.id}:${state.mapRevision}`} kind="door" visual={door.visual} asset={door.visual?knownAssets[door.visual.assetId]:undefined} onChoose={()=>setArchitecturalPicker({kind:'door',selected:true})} onApply={visual=>void dispatch({type:'map.door.visual',doorId:door.id,visual})}/>}        {selected?.objectId && <div className="builder-row"><strong>Selected {selected.kind}: {selected.objectId}</strong>{prop && !isScenery(prop) && <button onClick={() => void dispatch({ type: 'map.prop.rotate', propId: prop.id, rotation: ((prop.rotation + 90) % 360) as typeof rotation })}>Rotate selected object</button>}{door && <button onClick={() => void dispatch({ type: 'map.door.update', doorId: door.id, state: doorState })}>Apply selected door state</button>}<button onClick={() => void dispatch(selected.kind === 'prop' ? { type: 'map.prop.remove', propId: selected.objectId! } : selected.kind === 'door' ? { type: 'map.door.remove', doorId: selected.objectId! } : { type: 'map.wall.remove', wallId: selected.objectId! })}>Remove selected</button></div>}</div></details>
      <details><summary>Scenery <small>{document?.props.length??0} placed</small></summary><ul className="inspector-scenery">{document?.props.map(item=><li key={item.id}><button onClick={()=>{setTool('select');setSelected({cell:{x:Math.floor(item.position.x),z:Math.floor(item.position.z)},wall:{id:'H:0:0',x:0,z:0,axis:'H',material:'stone'},kind:'prop',objectId:item.id})}}>{isScenery(item)?item.label:item.type}</button></li>)}</ul></details>
      <details><summary>Floor <small>{floor}</small></summary><label className="floor-choice">Floor material<select aria-label="Floor material" value={floor} onChange={e=>setFloor(e.target.value as typeof floor)}>{floorTypes.map(t=><option key={t}>{t}</option>)}</select></label><p>{document?.floors.length??0} painted squares · {state.battleMap.gridSizeFeet} feet per square</p></details>
      <details><summary>Map file &amp; templates <small>{maps.length} saved</small></summary><label className="template-name">Template name<input aria-label="Template name" value={name} maxLength={150} onChange={e=>setName(e.target.value)}/></label>        <div className="builder-row"><label>Saved maps<select aria-label="Saved maps" value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Choose a template</option>{maps.map(m => <option key={m.id} value={m.id}>{m.name} · v{m.revision}</option>)}</select></label><button disabled={!selectedTemplate} onClick={loadTemplate}>Open saved map</button><button disabled={!selectedTemplate} onClick={() => void save(true)}>Overwrite selected template</button>{(['rename', 'duplicate', 'delete'] as const).map(action => <button key={action} disabled={!selectedTemplate} onClick={() => void manageTemplate(action)}>{action[0].toUpperCase() + action.slice(1)} template</button>)}</div></details>
      </fieldset><details open={showGenerator} onToggle={e=>setShowGenerator(e.currentTarget.open)}><summary>Generate dungeon <small>{theme}</small></summary>      {<div className="builder-preview"><h3>Dungeon generation</h3><div className="builder-row"><label>Theme<select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value as typeof theme)}>{themes.map(t => <option key={t}>{t}</option>)}</select></label><label>Generation width<input type="number" min={6} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Generation height<input type="number" min={6} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><label>Rooms<input type="number" min={1} max={25} value={roomCount} onChange={e => setRoomCount(Number(e.target.value))} /></label><label>Minimum room size<input type="number" min={3} max={20} value={minRoomSize} onChange={e => setMinRoomSize(Number(e.target.value))} /></label><label>Maximum room size<input type="number" min={3} max={30} value={maxRoomSize} onChange={e => setMaxRoomSize(Number(e.target.value))} /></label><label>Random seed<input value={seed} onChange={e => setSeed(e.target.value)} maxLength={100} /></label><button disabled={busy} onClick={() => previewGeneration()}>Preview dungeon</button><button disabled={busy} onClick={() => previewGeneration(crypto.randomUUID())}>Regenerate with new seed</button></div>
        {preview && <div className="builder-row"><strong>Preview only — the encounter has not changed.</strong><button disabled={!connected || busy} onClick={() => void run(async () => { if (state.dungeonMap && !confirm('Replace the encounter environment with this generated map? Saved templates and combat statistics stay unchanged.')) return; await send({ type: 'map.generate', options: preview.options }); setName(preview.document.name); setPreview(null) })}>Accept generated map</button><button onClick={() => setPreview(null)}>Cancel generation</button></div>}</div>}
</details>
      <fieldset disabled={!connected||busy||Boolean(preview)} className="inspector-fields"><details><summary>New blank map <small>{width} × {height}</small></summary>        <div className="builder-row"><label>Map name<input value={name} onChange={e => setName(e.target.value)} maxLength={150} /></label><label>Map width<input type="number" min={4} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Map height<input type="number" min={4} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><button onClick={() => { if (!document || confirm('Replace the current environment with a blank map? Combatants are preserved; invalid token positions relocate deterministically.')) void dispatch({ type: 'map.blank', id: crypto.randomUUID(), name, width, height }) }}>Create blank map</button></div></details></fieldset>
      {message&&<p role="status">{message}</p>}</div>
    </aside>
    <BattleMap3D {...battlefield} canvasTools={editing?<><fieldset disabled={!connected||busy||Boolean(preview)} className="editor-floating" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><div className="editor-palette" aria-label="Editor tools">{(['select', 'floor', 'wall', 'wall-line', 'room', 'corridor', 'door', 'object', 'erase'] as const).map(t => <button key={t} aria-label={({ select:'Select',floor:'Paint floor',wall:'Draw wall','wall-line':'Wall line',room:'Rectangle room',corridor:'Corridor',door:'Place door',object:'Add Object',erase:'Erase' })[t]} title={`${t} ${({select:'V',floor:'F',wall:'W',door:'D',object:'O',erase:'E'} as Record<string,string>)[t]??''}`} aria-keyshortcuts={({select:'V',floor:'F',wall:'W',door:'D',object:'O',erase:'E'} as Record<string,string>)[t]} aria-pressed={tool === t || t === 'object' && tool === 'scenery'} onClick={() => { if (t === 'object') setPickingScenery(true); else setTool(t) }}><span aria-hidden="true">{({select:'⌖',floor:'▦',wall:'━','wall-line':'┄',room:'□',corridor:'═',door:'Π',object:'❖',erase:'⌫'})[t]}</span>{({ select: 'Select', floor: 'Floor', wall: 'Wall', 'wall-line':'Line',room:'Room',corridor:'Corridor', door: 'Door', object: 'Object', erase: 'Erase' })[t]}</button>)}</div><div className="editor-history"><button disabled={!state.mapUndoDepth} onClick={() => void dispatch({ type: 'map.undo' })}>Undo map edit</button><button disabled={!state.mapRedoDepth} onClick={() => void dispatch({ type: 'map.redo' })}>Redo map edit</button><details><summary>History ▾</summary><button onClick={() => { if (confirm('Clear map undo and redo history? This cannot be undone.')) void dispatch({ type: 'map.history.clear' }) }}>Clear map history</button></details></div></fieldset>{inspectorHidden&&<button className="inspector-reopen" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={()=>setInspectorHidden(false)}>Show inspector «</button>}</>:undefined} map={preview ? reconcileBattleMap({ ...state.battleMap, width: document!.width, height: document!.height }, state.combatants.map(c => c.id)) : state.battleMap} dungeonMap={document} editor={editing && connected && !preview && document ? editor : undefined} canMove={!editing && battlefield.canMove} />
  </section>
}
