import FloatingObjectToolbar,{type ObjectToolbarContext} from './FloatingObjectToolbar'
import ToolbarProjection from './ToolbarProjection'
import {useEffect,useState} from 'react'
import {TOUCH} from 'three'
import TacticalScene,{TacticalSurface,type TacticalInteraction} from './TacticalScene'
import {useTacticalTools} from './useTacticalTools'
import type {TacticalObject,TacticalRecord} from '../shared/tactical'
import type {Actor,GameCommand} from '../shared/domain'
import './tactical-tools.css'
import { Canvas, ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { ChevronLeft, Eye, EyeOff, LocateFixed, RotateCcw } from 'lucide-react'
import { Suspense, useMemo, useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import CombatantMiniature3D from './CombatantMiniature3D'
import { baseFootprint, type MiniatureAppearance } from '../shared/miniatures'
import { DungeonScene, EditorSurface, type EditorInteraction } from './DungeonScene'
import type { DungeonMap } from '../shared/dungeon'
import type { BattleMapState, GridPosition } from './mapState'

interface Combatant {
  id: string | number
  name: string
  short: string
  side: string
  hp: number
  maxHp: number
  initiative: number
  miniature?: MiniatureAppearance
  miniatureStatus?: unknown
  conditions?: string[]
  hpShown?: boolean
  ownerId?: string | null
}

export interface BattleMap3DProps {
  canvasTools?:React.ReactNode
  tactical?:TacticalRecord[]
  actor?:Actor
  onCommand?:(command:GameCommand)=>Promise<void>
  connected?:boolean
  onAppearance?:()=>void
  assetScope?: string
  assetContext?: { campaignId: string; encounterId: string }
  dungeonMap?: DungeonMap
  editor?: EditorInteraction
  combatants: Combatant[]
  map: BattleMapState
  round: number
  selectedId: string | number | null
  activeId: string | number | null
  onSelectToken: (combatantId: string | number) => void
  onMoveToken: (combatantId: string | number, destination: GridPosition) => void
  onToggleGrid: () => void
  onToggleLabels: () => void
  canMove?: boolean
  showSharedControls?: boolean
  playerId?: string
  onReturnToTracker: () => void
}

function toWorld(position: GridPosition, map: BattleMapState): [number, number, number] {
  return [position.x - map.width / 2 + 0.5, 0.32, position.z - map.height / 2 + 0.5]
}

function Token({ combatant, position, map, selected, active, showLabel, onSelect, assetScope, assetContext }: {
  combatant: Combatant
  position: GridPosition
  map: BattleMapState
  selected: boolean
  active: boolean
  showLabel: boolean
  onSelect: () => void
  assetScope?: string
  assetContext?: BattleMap3DProps['assetContext']
}) {
  const color = combatant.side === 'hero' ? '#3c8465' : combatant.side === 'enemy' ? '#a84338' : '#777b7c'
  const [x, , z] = toWorld(position, map), appearance = combatant.miniature
  const footprint = appearance?.assetId ? baseFootprint(appearance.baseSize) : 1
  const placeholder = <mesh castShadow position={[0, .42, 0]}><cylinderGeometry args={[.32, .4, .55, 24]} /><meshStandardMaterial color={color} roughness={.56} metalness={.08} /></mesh>
  const url = appearance?.assetId ? `/api/assets/${appearance.assetId}/file${assetContext ? `?campaignId=${assetContext.campaignId}&encounterId=${assetContext.encounterId}` : ''}#${assetScope ?? 'signed-out'}` : ''
  return <group position={[x, 0, z]} onClick={event => { event.stopPropagation(); if (event.delta <= 3) onSelect() }}>
    {active && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .16, 0]}><torusGeometry args={[footprint * .42, .055, 10, 32]} /><meshStandardMaterial color="#efb83f" emissive="#a56a00" emissiveIntensity={.45} /></mesh>}
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .18, 0]}><ringGeometry args={[footprint * .5, footprint * .54, 4]} /><meshStandardMaterial color="#70c8ff" emissive="#2584ba" emissiveIntensity={.5} /></mesh>}
    {appearance?.assetId ? <CombatantMiniature3D appearance={appearance} url={url} unavailable={!assetScope || combatant.miniatureStatus === 'unavailable'} fallback={placeholder} color={color} /> : placeholder}
    {showLabel && <Html center position={[0, Math.max(1.37, appearance?.assetId ? appearance.scale + appearance.verticalOffset + .45 : 0), 0]} distanceFactor={11} style={{ pointerEvents: 'none' }}><span className="token-label">{active ? '▶ ' : ''}{selected ? '◇ ' : ''}{combatant.name}</span></Html>}
  </group>

}

function BattlefieldGrid({ width, height }: { width: number; height: number }) {
  const positions = useMemo(() => {
    const points: number[] = []
    for (let x = 0; x <= width; x++) points.push(x - width / 2, 0, -height / 2, x - width / 2, 0, height / 2)
    for (let z = 0; z <= height; z++) points.push(-width / 2, 0, z - height / 2, width / 2, 0, z - height / 2)
    return new Float32Array(points)
  }, [width, height])
  return <lineSegments position={[0, 0.012, 0]}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <lineBasicMaterial color="#a7a597" />
  </lineSegments>
}

function BattlefieldScene({ combatants, map, selectedId, activeId, onSelectToken, onMoveToken, controlsRef, canMove, dungeonMap, editor, assetScope, assetContext, tactical, tacticalDraft, tacticalSelected, tacticalInteraction, onSelectTactical, toolbar, toolbarRef }: Omit<BattleMap3DProps, 'round' | 'onToggleGrid' | 'onToggleLabels' | 'onReturnToTracker'> & { controlsRef: React.RefObject<OrbitControlsImpl | null>;tacticalDraft:TacticalObject|null;tacticalSelected:string|null;tacticalInteraction:TacticalInteraction;onSelectTactical:(id:string)=>void;toolbar?:ObjectToolbarContext;toolbarRef:React.RefObject<HTMLDivElement|null> }) {
  const handleFloorClick = (event: ThreeEvent<MouseEvent>) => {
    if (tacticalInteraction.mode!=='navigate' || editor || canMove === false || selectedId === null || event.delta > 3) return
    const destination = {
      x: Math.floor(event.point.x + map.width / 2),
      z: Math.floor(event.point.z + map.height / 2),
    }
    onMoveToken(selectedId, destination)
  }

  return <>
    <color attach="background" args={['#171a19']} />
    <ambientLight intensity={1.05} />
    <directionalLight position={[8, 14, 6]} intensity={2.1} castShadow shadow-mapSize={[1024, 1024]} />
    <mesh position={[0, dungeonMap ? -.08 : 0, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={handleFloorClick}>
      <planeGeometry args={[map.width, map.height]} />
      <meshStandardMaterial color={dungeonMap ? '#242724' : '#666760'} roughness={0.92} metalness={0.02} />
    </mesh>
    {map.showGrid && <BattlefieldGrid width={map.width} height={map.height} />}
    {!dungeonMap && <group>
      <mesh position={[0, 0.75, -map.height / 2]} castShadow receiveShadow><boxGeometry args={[map.width + 0.3, 1.5, 0.3]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
      <mesh position={[-map.width / 2, 0.75, -map.height / 4]} castShadow receiveShadow><boxGeometry args={[0.3, 1.5, map.height / 2]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
      <mesh position={[map.width / 2, 0.75, map.height / 4]} castShadow receiveShadow><boxGeometry args={[0.3, 1.5, map.height / 2]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
    </group>}
    {dungeonMap && <DungeonScene map={dungeonMap} editor={tacticalInteraction.mode==='navigate'?editor:undefined} assetScope={assetScope} assetContext={assetContext} />}
    {editor && tacticalInteraction.mode==='navigate' && <EditorSurface width={map.width} height={map.height} editor={editor} />}
    <TacticalScene records={tactical??[]} draft={tacticalDraft} selectedId={tacticalSelected} width={map.width} height={map.height} feet={map.gridSizeFeet} onSelect={id=>{if(tacticalInteraction.mode==='navigate'&&(!editor||editor.tool==='select'))onSelectTactical(id)}}/>
    {tacticalInteraction.mode!=='navigate'&&<TacticalSurface key={tacticalInteraction.mode} width={map.width} height={map.height} interaction={tacticalInteraction}/>}
    {combatants.map((combatant) => {
      const position = map.tokens[String(combatant.id)]
      return position && <Token key={combatant.id} assetScope={assetScope} assetContext={assetContext} combatant={combatant} position={position} map={map} selected={combatant.id === selectedId} active={combatant.id === activeId} showLabel={map.showLabels} onSelect={() => {if(tacticalInteraction.mode==='navigate'&&(!editor||editor.tool==='select'))onSelectToken(combatant.id)}} />
    })}
    {toolbar&&<ToolbarProjection target={toolbarRef} position={toolbar.position}/>}
    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={7} maxDistance={Math.max(35, Math.max(map.width, map.height) * 2)} maxPolarAngle={Math.PI / 2.08} target={[0, 0, 0]} touches={{ONE:editor||tacticalInteraction.mode!=='navigate'?undefined:TOUCH.ROTATE,TWO:TOUCH.DOLLY_PAN}} mouseButtons={{ LEFT: editor||tacticalInteraction.mode!=='navigate' ? undefined : 0, MIDDLE: editor||tacticalInteraction.mode!=='navigate' ? 0 : 2, RIGHT: 2 }} />
  </>
}

export default function BattleMap3D(props: BattleMap3DProps) {
  const tacticalDrawerRef=useRef<HTMLDetailsElement>(null)
  const tools=useTacticalTools({records:props.tactical??[],actor:props.actor??{id:'local',role:'dm'},send:props.onCommand,connected:props.connected??true,width:props.map.width,height:props.map.height,feet:props.map.gridSizeFeet,editorTool:`${props.assetContext?.encounterId??'local'}:${props.editor?.tool??'encounter'}:${props.editor?.activation??0}`})
  const toolbarRef=useRef<HTMLDivElement>(null),[dismissed,setDismissed]=useState<string|number|null>(null),[mapError,setMapError]=useState('')
  useEffect(()=>{const cancel=(e:KeyboardEvent)=>{if(e.key==='Escape')setDismissed(props.selectedId)};window.addEventListener('keydown',cancel);return()=>window.removeEventListener('keydown',cancel)},[props.selectedId])
  let toolbar:ObjectToolbarContext|undefined
  if(tools.current&&tools.mode==='navigate'){
    const item=tools.current,anchor=item.kind==='measurement'?item.end:item.position
    toolbar={title:item.kind==='measurement'?'Ruler':`${item.shape} template`,position:[anchor.x-props.map.width/2,.5,anchor.z-props.map.height/2],onDismiss:tools.cancel,actions:tools.canEdit?[
      {label:'Move',run:tools.move},{label:'Rotate',run:tools.rotate,disabled:item.kind==='measurement'},
      {label:'Resize / properties',run:()=>{if(tacticalDrawerRef.current){tacticalDrawerRef.current.open=true;tacticalDrawerRef.current.querySelector<HTMLElement>('input,select')?.focus()}}},
      {label:tools.selectedId?'Apply changes':'Share',run:()=>void tools.share(),disabled:props.connected===false||!props.onCommand},
      ...(tools.selectedId?[{label:'Unshare',run:()=>void tools.unshare(),disabled:props.connected===false}]:[]),{label:'Delete',run:()=>void tools.remove(),disabled:Boolean(tools.selectedId&&props.connected===false)}
    ]:[],properties:<p>{tools.selectedId?'Shared encounter overlay. Only its owner and the DM may edit.':'Local preview; not visible to other participants.'}</p>}
  }else if(tools.mode==='navigate'&&props.editor?.toolbar)toolbar=props.editor.toolbar
  else if(tools.mode==='navigate'&&!props.editor&&props.selectedId!==dismissed){
    const combatant=props.combatants.find(c=>c.id===props.selectedId),position=combatant?props.map.tokens[String(combatant.id)]:undefined
    if(combatant&&position)toolbar={title:combatant.name,position:[position.x-props.map.width/2+.5,1.3,position.z-props.map.height/2+.5],onDismiss:()=>setDismissed(combatant.id),actions:[{label:'Select',run:()=>props.onSelectToken(combatant.id)},{label:'Move token',disabled:props.canMove===false,run:()=>props.onSelectToken(combatant.id)},...(props.actor?.role!=='player'&&props.onAppearance?[{label:'Appearance',run:props.onAppearance}]:[])],properties:<p>{!props.playerId||combatant.ownerId===props.playerId||combatant.hpShown?`${combatant.hp}/${combatant.maxHp} HP · `:''}Initiative {combatant.initiative}. Select, then click a square to move if permitted.</p>}
  }
  const selectToken=(id:string|number)=>{setDismissed(null);tools.cancel();props.onSelectToken(id)}
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const [rosterExpanded,setRosterExpanded]=useState(props.actor?.role==='player')
  const resetCamera = () => controlsRef.current?.reset()

  return <section className="tabletop-shell" data-roster-expanded={rosterExpanded} aria-label={props.dungeonMap ? `Dungeon map: ${props.dungeonMap.name}` : 'Flat battlefield'}>
    {toolbar&&<FloatingObjectToolbar context={toolbar} target={toolbarRef}/>}
    <aside className="tabletop-panel tabletop-roster">
      <button className="roster-expand" aria-label={rosterExpanded?'Collapse roster':'Expand roster'} aria-expanded={rosterExpanded} onClick={()=>setRosterExpanded(v=>!v)}>{rosterExpanded?'«':'»'}</button><span className="eyebrow">INITIATIVE</span><h2>Round {props.round}</h2>
      <div className="map-initiative-list">{[...props.combatants].sort((a,b)=>b.initiative-a.initiative).map((combatant) => <button key={combatant.id} title={`${combatant.name} · Initiative ${combatant.initiative}`} aria-label={combatant.name} aria-pressed={combatant.id === props.selectedId} aria-current={combatant.id === props.activeId ? 'step' : undefined} className={`${combatant.id === props.selectedId ? 'selected' : ''} ${combatant.id === props.activeId ? 'active' : ''}`} onClick={() => selectToken(combatant.id)}><span className={`map-token-dot ${combatant.side}`}>{combatant.short==='?'?combatant.name.split(/\s+/).slice(0,2).map(w=>w[0]).join(''):combatant.short}</span><span><strong>{combatant.name}</strong>{combatant.id === props.selectedId && <small>◇ Selected</small>}{combatant.id === props.activeId && <small>▶ Active turn</small>}{combatant.conditions?.length ? <small>{combatant.conditions.join(', ')}</small> : null}<small>Initiative {combatant.initiative}</small></span>{(!props.playerId || combatant.ownerId === props.playerId || combatant.hpShown === true) && <em>{combatant.hp}/{combatant.maxHp} HP</em>}</button>)}</div>
      {!props.combatants.length && <p className="map-empty">Add combatants in the tracker to place tokens.</p>}
    </aside>
    <div className="battlefield-wrap">
      {props.canvasTools}
      <div className="battlefield-help"><LocateFixed size={15} /> {tools.mode!=='navigate'?'Tactical tool active · Left: target · Middle: rotate · Escape: cancel':props.editor ? `${props.editor.tool} · Left: edit · Middle: rotate · Right: pan · Esc: cancel` : props.canMove === false ? 'Select a token to inspect · camera remains available' : 'Select a token, then click a square to move'}</div>
      <Canvas frameloop="demand" shadows camera={{ position: [12, 14, 12], fov: 42, near: 0.1, far: 300 }}>
        <Suspense fallback={null}><BattlefieldScene {...props} onSelectToken={selectToken} tacticalDraft={tools.draft} tacticalSelected={tools.selectedId} tacticalInteraction={tools.interaction} onSelectTactical={tools.select} toolbar={toolbar} toolbarRef={toolbarRef} controlsRef={controlsRef} /></Suspense>
      </Canvas>
      <div className="camera-toolbar" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()} aria-label="Camera controls">      <button onClick={resetCamera}><RotateCcw size={16} /> Reset camera</button>
      {props.showSharedControls !== false && <><button disabled={props.connected === false} onClick={props.onToggleGrid}>{props.map.showGrid ? <EyeOff size={16} /> : <Eye size={16} />} {props.map.showGrid ? 'Hide grid' : 'Show grid'}</button>
      <button disabled={props.connected === false} onClick={props.onToggleLabels}>{props.map.showLabels ? <EyeOff size={16} /> : <Eye size={16} />} {props.map.showLabels ? 'Hide labels' : 'Show labels'}</button></>}
<button onClick={()=>{const c=controlsRef.current;if(c){c.object.position.set(c.target.x,1.5*Math.max(props.map.width,props.map.height),c.target.z+.001);c.update()}}}>Top-down</button><button aria-label="Zoom out" onClick={()=>{const c=controlsRef.current;if(c){c.object.position.sub(c.target).multiplyScalar(1.2).add(c.target);c.update()}}}>−</button><button aria-label="Zoom in" onClick={()=>{const c=controlsRef.current;if(c){c.object.position.sub(c.target).multiplyScalar(.8).add(c.target);c.update()}}}>+</button>{props.showSharedControls!==false&&<button onClick={props.onReturnToTracker}><ChevronLeft size={14}/>Encounter tracker</button>}</div>
      <div className="map-scale-readout" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><details><summary>1 sq = {props.map.gridSizeFeet} ft · {props.map.width} × {props.map.height} squares · Scale ▾</summary>      {props.actor?.role!=='player'&&props.onCommand&&<form className="grid-scale-control" onSubmit={e=>{e.preventDefault();const gridSizeFeet=Number(new FormData(e.currentTarget).get('feet'));setMapError('');void props.onCommand?.({type:'map.settings',showGrid:props.map.showGrid,showLabels:props.map.showLabels,gridSizeFeet}).catch(error=>setMapError(error.message))}}><label>Feet per square<input aria-label="Feet per square" name="feet" type="number" min={1} max={100} key={props.map.gridSizeFeet} defaultValue={props.map.gridSizeFeet} required disabled={props.connected===false}/></label><button disabled={props.connected===false}>Apply scale</button>{mapError&&<p role="alert">{mapError}</p>}</form>}
</details></div>
      <details ref={tacticalDrawerRef} className="tactical-drawer" onPointerDown={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><summary>Ruler &amp; tactical templates</summary>{tools.controls}</details>
    </div>

  </section>
}
