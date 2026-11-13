import EffectsPanel from './EffectsPanel'
import {createEffect,effectPreset as presetMetadata,type EffectPresetId} from '../shared/environmentalEffects'
import {sameFogMask} from '../shared/fogEditing'
import FogOfWarPanel from './FogOfWarPanel'
import {fullMask} from '../shared/fog'
import type {FogToolSettings,FogController,FogPolygonState} from './fogEditor'
import LightingScenesPanel from './LightingScenesPanel'
import LightingSourcesPanel from './LightingSourcesPanel'
import {lightTemplates,pointLightSchema} from '../shared/lighting'
import LightingEnvironmentPanel from './LightingEnvironmentPanel'
import TerrainPaintingPanel,{type TerrainSettings} from './TerrainPaintingPanel'
import {terrainBrushSchema} from '../shared/terrain'
import {repeatingTextureSchema} from '../shared/floor-surface'
import TransitionsPanel from './TransitionsPanel'
import {newTransition} from './newTransition'
import type {FloorTransition} from '../shared/transitions'
import DungeonLevelsPanel,{type LevelView} from './DungeonLevelsPanel'
import {dungeonLevels,levelDocument,primaryLevelId} from '../shared/dungeon'
import FloorSurfacePanel from './FloorSurfacePanel'
import { projectEncounter,applyMapEdit } from '../shared/domain'
import Modal from './Modal'
import { isModalOpen } from './modalState'
import { z } from 'zod'
import { useCallback, useEffect, useRef, useState } from 'react'
import type {ObjectToolbarContext} from './FloatingObjectToolbar'
import {edgePose} from '../shared/architecture'
import ArchitectureProperties from './ArchitectureProperties'
import { calibrationSchema, type ArchitecturalVisual, type Calibration } from '../shared/architecture'
import AssetLibrary from './AssetLibrary'
import SceneryProperties from './SceneryProperties'
import { isScenery, scenerySchema, sceneryLimits, type SceneryProp } from '../shared/scenery'
import type { Asset3D } from '../shared/assets'
import BattleMap3D, { type BattleMap3DProps } from './BattleMap3D'
import { emptyHistory, floorTypes, themes, dungeonSchema, readDungeon, type DungeonMap, type ProceduralProp } from '../shared/dungeon'
import { generateDungeon, type GenerationOptions } from '../shared/generator'
import { reconcileBattleMap } from './mapState'
import type { EncounterState, GameCommand } from '../shared/domain'
import type { EditorHit, EditorInteraction } from './DungeonScene'
import './dungeon-builder.css'
import './editor-workspace.css'
import {Button,InspectorSection,Menu,StatusPill} from './ui'
import {useWorkspacePreference} from './workspacePreferences'
export interface MapLibrary { campaignId: string; api: (path: string, body?: unknown) => Promise<unknown>; encounterId: string; revision: number }
interface SavedMap { id: string; name: string; revision: number; document?: DungeonMap; width?: number; height?: number }
const localTemplates = z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(150), revision: z.number().int().positive(), document: dungeonSchema }).strict()).max(100)
const localKey = 'ledger.dungeon.templates.v1'
export default function DungeonBuilder({ state, editing, send, connected, library, battlefield, templatesRequest=0, visible=true }: {
  visible?:boolean; templatesRequest?:number; state: EncounterState; editing: boolean; send: (command: GameCommand) => Promise<void>; connected: boolean; library?: MapLibrary
  battlefield: Omit<BattleMap3DProps, 'map' | 'dungeonMap' | 'editor'>
}) {
  const [fogSettings,setFogSettings]=useState<FogToolSettings>({shape:'brush',mode:'reveal',radius:1.5,snap:false})
  const [fogPolygon,setFogPolygon]=useState<FogPolygonState>({count:0,error:''}),fogController=useRef<FogController|null>(null)
  const [fogPreview,setFogPreview]=useState(false),[fogOverlay,setFogOverlay]=useState(false)
  const workspaceRef=useRef<HTMLElement>(null)
  useEffect(()=>{if(!visible)return;let frame=0;const resize=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{const el=workspaceRef.current;if(el)el.style.setProperty('--workspace-height',`${Math.max(300,window.innerHeight-(el.getBoundingClientRect().top+window.scrollY)-14)}px`)})};const observer=new ResizeObserver(resize);observer.observe(window.document.body);window.addEventListener('resize',resize);resize();return()=>{cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',resize)}},[visible])
  const [inspectorHidden,setInspectorHidden]=useWorkspacePreference('map.inspectorHidden',false)
  const[seenTemplates,setSeenTemplates]=useState(0)
  if(templatesRequest!==seenTemplates){setSeenTemplates(templatesRequest);if(templatesRequest)setInspectorHidden(false)}
  useEffect(()=>{if(templatesRequest){const panel=workspaceRef.current?.querySelector<HTMLDetailsElement>('[data-ui-section=map-templates]');if(panel){panel.open=true;panel.querySelector('summary')?.focus()}}},[templatesRequest])
  const [savedDocument,setSavedDocument]=useState<string|null>(null)
  const baselineAfterLoad=useRef<{revision:number;name:string}|null>(null)
  useEffect(()=>{const pending=baselineAfterLoad.current;if(pending&&state.dungeonMap&&(state.mapRevision??0)!==pending.revision){setSavedDocument(JSON.stringify({document:state.dungeonMap,name:pending.name}));baselineAfterLoad.current=null}},[state.mapRevision,state.dungeonMap])
  const [accordionEpoch,setAccordionEpoch]=useState(0)
  useEffect(()=>{if(accordionEpoch)workspaceRef.current?.querySelectorAll<HTMLDetailsElement>('[data-section]').forEach(panel=>{panel.open=true})},[accordionEpoch])
  const [architecturalPicker,setArchitecturalPicker]=useState<{kind:'wall'|'door';selected:boolean}|null>(null)
  const [wallAsset,setWallAsset]=useState<Asset3D|null>(null),[doorAsset,setDoorAsset]=useState<Asset3D|null>(null)
  const [knownAssets,setKnownAssets]=useState<Record<string,Asset3D>>({})
  const visualFor=(asset:Asset3D|null):ArchitecturalVisual|undefined=>asset?{assetId:asset.id,calibration:calibrationSchema.strip().parse(asset.presentation.architecture??{})}:undefined
  const [sceneryAsset, setSceneryAsset] = useState<SceneryProp | null>(null), [pickingScenery, setPickingScenery] = useState(false), [snap, setSnap] = useState(true)
  const [selectionByLevel]=useState(()=>new Map<string,EditorHit|null>()),[sceneryDrafts]=useState(()=>new Map<string,SceneryProp>()),[architectureDrafts]=useState(()=>new Map<string,Calibration>())
  const [transitionDraft,setTransitionDraft]=useState<FloorTransition|null>(null),[transitionPick,setTransitionPick]=useState<'source'|'destination'|null>(null),[transitionAssetPicker,setTransitionAssetPicker]=useState(false)
  const [selected, setSelected] = useState<EditorHit | null>(null)
  const [tool,setToolValue]=useState<EditorInteraction['tool']>('select'),[toolEpoch,setToolEpoch]=useState(0)
  const setTool=useCallback((next:EditorInteraction['tool'])=>{setToolValue(next);setInspectorHidden(false);setToolEpoch(n=>n+1);if(!['select','sceneryMove','objectMove'].includes(next))setSelected(null)},[setInspectorHidden])
  useEffect(()=>{const panel=workspaceRef.current?.querySelector<HTMLDetailsElement>('[data-section=active-tool]');if(panel)panel.open=true},[toolEpoch])
  useEffect(()=>{if(selected?.objectId){setInspectorHidden(false);const panel=workspaceRef.current?.querySelector<HTMLDetailsElement>('[data-section=selection]');if(panel)panel.open=true}},[selected?.objectId,setInspectorHidden])
  const[terrainSettings,setTerrainSettings]=useState<TerrainSettings>({mode:'cells',brush:terrainBrushSchema.parse({}),texture:repeatingTextureSchema.parse({assetId:'builtin:mud'})})
  const[selectedEffect,setSelectedEffect]=useState<string|null>(null),[effectPreset,setEffectPreset]=useState<EffectPresetId|null>(null)
  const[selectedLight,setSelectedLight]=useState<string|null>(null),[lightAction,setLightAction]=useState<'select'|'place'|'move'>('select'),[lightTemplate,setLightTemplate]=useState('Torch'),[lightView,setLightView]=useState('')
  const [floor, setFloor] = useState<DungeonMap['floors'][number]['type']>('stone')
  const [corridorWidth,setCorridorWidth]=useState(2),[wallsOnly,setWallsOnly]=useState(false)
  const [wallMaterial, setWallMaterial] = useState<'stone' | 'wood'>('stone')
  const [propType, setPropType] = useState<ProceduralProp['type']>('crate')
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const [doorState, setDoorState] = useState<'open' | 'closed' | 'locked'>('closed')
  const [message, setMessage] = useState(''),[failed,setFailed]=useState(false)
  const [messageScope,setMessageScope]=useState<'map'|'fog'>('map')
  const [busy, setBusy] = useState(false)
  const [maps, setMaps] = useState<SavedMap[]>([])
  const [templateId, setTemplateId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [name, setName] = useState(state.dungeonMap?.name??'New dungeon')
  const [width, setWidth] = useState(20), [height, setHeight] = useState(20)
  const [seed, setSeed] = useState('my-dungeon')
  const [theme, setTheme] = useState<GenerationOptions['theme']>('stone-dungeon')
  const [roomCount, setRoomCount] = useState(4), [minRoomSize, setMinRoomSize] = useState(3), [maxRoomSize, setMaxRoomSize] = useState(6)
  const [preview, setPreview] = useState<{ document: DungeonMap; options: GenerationOptions } | null>(null)
  const [floorPreview,setFloorPreview]=useState<DungeonMap|null>(null)
  const previewState=useRef(state)
  useEffect(()=>{previewState.current=state},[state])
  const showFloorPreview=useCallback((command:Extract<GameCommand,{type:'map.floorImage.set'}>|null)=>{
    if(!command){setFloorPreview(null);return}
    const next=applyMapEdit(previewState.current,{id:'local',role:'dm'},command,emptyHistory()).state
    setFloorPreview(next.dungeonMap??null)
  },[])
  const [chosenLevel,setChosenLevel]=useState(primaryLevelId(state.dungeonMap)),[levelMode,setLevelMode]=useState<LevelView['mode']>('single'),[hiddenLevels,setHiddenLevels]=useState<string[]>([])
  const fullDocument=preview?.document??floorPreview??state.dungeonMap
  const allLevels=fullDocument?dungeonLevels(fullDocument):[]
  const activeLevel=allLevels.find(l=>l.id===chosenLevel)??allLevels[0]
  const activeId=activeLevel?.id??primaryLevelId(fullDocument)
  const document=activeLevel?levelDocument(activeLevel):undefined
  const lightViewKey=String(fullDocument?.id)+':'+activeId
  if(lightView!==lightViewKey){setLightView(lightViewKey);setSelectedLight(null);setLightAction('select');setSelectedEffect(null);setEffectPreset(null)}
  const levelRevision=JSON.stringify(activeLevel)
  const onActiveLevelChange=battlefield.onActiveLevelChange
  useEffect(()=>{onActiveLevelChange?.(activeId)},[activeId,onActiveLevelChange])
  const levelView:LevelView={activeId,mode:levelMode,hiddenIds:hiddenLevels,select:id=>{selectionByLevel.set(activeId,selected);setChosenLevel(id);setSelected(selectionByLevel.get(id)??null);setTool('select');setFloorPreview(null);setHiddenLevels(previous=>previous.filter(value=>value!==id))},setMode:setLevelMode,toggle:id=>setHiddenLevels(previous=>previous.includes(id)?previous.filter(value=>value!==id):[...previous,id])}
  const sendToLevel=(command:GameCommand)=>send('levelId' in command||command.type.startsWith('map.')&&!['map.blank','map.load','map.generate','map.template.load','map.undo','map.redo','map.history.clear'].includes(command.type)&&!command.type.startsWith('map.fog.')&&!command.type.startsWith('map.level.')&&!command.type.startsWith('map.transition.')?{...command,levelId:activeId} as GameCommand:command)
  const previewGeneration = (newSeed = seed) => {
    setMessageScope('map')
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
  const run = async (fn: () => Promise<unknown>,scope:'map'|'fog'='map') => {
    if (!connected || busy||fogPreview) return
    setMessageScope(scope);setBusy(true);setFailed(false); setMessage('')
    try { await fn(); setRefresh(n => n + 1) } catch (error) {setFailed(true); setMessage((error as Error).message) } finally { setBusy(false) }
  }
  const dispatch = (command: GameCommand) => run(async() => {await sendToLevel(command);if(command.type==='map.terrain.stroke')setMessage('Terrain stroke saved.');if(command.type.startsWith('map.fog.'))setMessage(library?'Fog synced to encounter.':'Fog applied. Save a map template or export to keep a local copy.')},command.type.startsWith('map.fog.')?'fog':'map')
  const selectedTemplate = maps.find(m => m.id === templateId)
  const localSave = (list: SavedMap[]) => { localStorage.setItem(localKey, JSON.stringify(localTemplates.parse(list))); setMaps(list) }
  const save = (overwrite: boolean) => run(async () => {
    if (!document) throw new Error('Create or generate a map first.')
    if (overwrite && (!selectedTemplate || !confirm('Overwrite the selected saved template? Existing encounters remain unchanged.'))) return
    if (library) await request(overwrite ? `/${templateId}/save` : '', { name, encounterId: library.encounterId, encounterRevision: library.revision, ...(overwrite ? { revision: selectedTemplate!.revision } : {}) })
    else {
      const saved = { id: overwrite ? templateId : crypto.randomUUID(), name, revision: overwrite ? selectedTemplate!.revision + 1 : 1, document: readDungeon({ ...fullDocument, name }) }
      localSave([...maps.filter(m => m.id !== saved.id), saved]); setTemplateId(saved.id)
    }
    setSavedDocument(JSON.stringify({document:fullDocument,name})); setMessage('Map saved. Encounter copies remain independent.')
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
  const selectTransition=(transition:FloorTransition)=>{setTransitionDraft(transition);setTransitionPick(null);setTool('transition')}
  const pickTransition=(end:'source'|'destination')=>{if(transitionDraft){levelView.select(transitionDraft[end].floorId);setTool('transition');setTransitionPick(end)}}
  const hit = (value: EditorHit) => {
    setMessageScope('map')
    if(tool==='effects'){if(effectPreset){const id=crypto.randomUUID();void dispatch({type:'map.effect.set',effect:createEffect(id,effectPreset,activeId,{...(value.position??value.cell),heightFeet:presetMetadata(effectPreset).renderer==='motes'?2.5:0})});setSelectedEffect(id);setEffectPreset(null)}return}
    if(tool==='lighting'){if(lightAction==='place'){const id=crypto.randomUUID();void dispatch({type:'map.lighting.source.set',source:pointLightSchema.parse({...lightTemplates[lightTemplate],id,name:lightTemplate,floorId:activeId,position:{...(value.position??value.cell),heightFeet:5}})});setSelectedLight(id);setLightAction('select')}else if(lightAction==='move'){const source=state.dungeonMap?.lighting?.sources?.find(s=>s.id===selectedLight);if(source&&!source.attachment)void dispatch({type:'map.lighting.source.set',source:{...source,floorId:activeId,position:{...source.position,...(value.position??value.cell)}}});setLightAction('select')}return}

    if(tool==='transition'){
      if(transitionDraft&&transitionPick){setTransitionDraft({...transitionDraft,[transitionPick]:{floorId:activeId,...value.cell}});setTransitionPick(null);setMessage(`${transitionPick} square selected. Configure both endpoints, then save the transition.`)}
      return
    }
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
    if (!editing||fogPreview) return
    const cancel = (event: KeyboardEvent) => {
      if (!workspaceRef.current?.getClientRects().length || isModalOpen() || event.key !== 'Escape') return
      setTool('select'); setTransitionPick(null); setSelected(null); setPickingScenery(false); setArchitecturalPicker(null)
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [editing,fogPreview, setTool])
  useEffect(() => {
    if (!editing||fogPreview) return
    const key = (e: KeyboardEvent) => {
      if (!workspaceRef.current?.getClientRects().length || isModalOpen() || e.isComposing || e.defaultPrevented) return
      if (!e.ctrlKey&&!e.metaKey&&!e.altKey&&!e.shiftKey&&!e.repeat&&connected&&!busy&&!preview&&!pickingScenery&&!architecturalPicker&&!(e.target instanceof HTMLElement&&(e.target.isContentEditable||e.target.closest('input,textarea,select,[role=dialog]')))) {const next=({v:'select',f:'floor',w:'wall',d:'door',o:'object',e:'erase'} as const)[e.key.toLowerCase() as 'v'|'f'|'w'|'d'|'o'|'e'];if(next){e.preventDefault();if(next==='object')setPickingScenery(true);else setTool(next);return}}
      if (!connected || busy || preview || pickingScenery || architecturalPicker || e.repeat || !prop || !isScenery(prop) || (e.target instanceof HTMLElement && (e.target.isContentEditable || e.target.closest('input,textarea,select')))) return
      const command: GameCommand | null = e.key === 'Delete' ? { type:'map.scenery.remove', propId:prop.id } : e.shiftKey && e.key.toLowerCase() === 'd' ? { type:'map.scenery.duplicate', propId:prop.id, newId:crypto.randomUUID(), position:{x:Math.min(document!.width-1,prop.position.x+1),z:Math.min(document!.height-1,prop.position.z+1)} } : null
      if (command) { e.preventDefault(); setBusy(true); void send(command).catch(error => setMessage(error.message)).finally(() => setBusy(false)) }
    }
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key)
  }, [editing,fogPreview, connected, busy, preview, pickingScenery, architecturalPicker, prop, document, send,setTool])
  const chooseScenery = (asset: Asset3D) => {
    const role=asset.presentation.architecture?.role
    if(role==='wall'||role==='door'){setKnownAssets(previous=>({...previous,[asset.id]:asset}));if(role==='wall')setWallAsset(asset);else setDoorAsset(asset);setPickingScenery(false);setTool(role);return}

    setSceneryAsset(scenerySchema.parse({ id: 'placement-preview', type: 'asset', assetId: asset.id, label: asset.presentation.displayName || asset.name, category: asset.category, position: {x:0,z:0}, rotation: asset.presentation.defaultRotation, scale: Math.max(sceneryLimits.minScale, Math.min(sceneryLimits.maxScale, asset.presentation.defaultScale)), verticalOffset: Math.max(sceneryLimits.minOffset, Math.min(sceneryLimits.maxOffset, asset.presentation.verticalOffset)), visible: true })); setPickingScenery(false); setTool('scenery')
  }
  const activateEffects=(id?:string)=>{setTool('effects');setEffectPreset(null);setSelected(null);if(id)setSelectedEffect(id);setInspectorHidden(false);requestAnimationFrame(()=>workspaceRef.current?.querySelector<HTMLElement>('select[aria-label="Effect category"]')?.focus())}
  const activateLighting=(id?:string)=>{
    setTool('lighting');setLightAction('select');setSelected(null);setInspectorHidden(false)
    if(id)setSelectedLight(id)
    requestAnimationFrame(()=>{const panel=workspaceRef.current?.querySelector<HTMLElement>('section[aria-label="Lighting tool"]');panel?.scrollIntoView({block:'nearest'});panel?.querySelector<HTMLElement>(id?'input[aria-label="Light name"]':'select[aria-label="Light preset"]')?.focus()})
  }
  const focusProperties=()=>{setInspectorHidden(false);setAccordionEpoch(n=>n+1);window.setTimeout(()=>{const panel=Array.from(window.document.querySelectorAll('.inspector details[open]:nth-of-type(2) .builder-properties')).find(panel=>panel.getClientRects().length>0);panel?.scrollIntoView({block:'nearest',behavior:'auto'});(panel?.querySelector<HTMLElement>('input[aria-label="Scenery scale"]')??panel?.querySelector<HTMLElement>('input[aria-label="Selected object scale"]')??panel?.querySelector<HTMLElement>('button,input,select'))?.focus()},0)}
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
  const openFog=()=>{setInspectorHidden(false);requestAnimationFrame(()=>{const panel=workspaceRef.current?.querySelector<HTMLDetailsElement>('[data-ui-section=fog]');if(panel){panel.open=true;panel.scrollIntoView({block:'nearest'})}})}
  const activateFog=(next=fogSettings)=>{setFogSettings(next);if(tool!=='fog')setFogOverlay(true);setTool('fog');openFog()}
  const fogMask=state.dungeonMap?.fogOfWar?.floors[activeId]??''
  const saveFogMask=(mask:string,expectedMask:string,expectedMapRevision=state.mapRevision??0)=>{if(sameFogMask(mask,expectedMask))return;void dispatch({type:'map.fog.mask',levelId:activeId,mask,expectedMask,expectedMapRevision})}
  const resetFog=(all:boolean)=>{if(confirm(all?'Reset Fog on every floor? All revealed areas will be concealed. This can be undone.':`Reset Fog on ${activeLevel?.name}? This can be undone.`))void dispatch({type:'map.fog.reset',confirmed:true,...(all?{}:{levelId:activeId})})}
  const editor: EditorInteraction = {fog:{...fogSettings,edgeSoftness:state.dungeonMap?.fogOfWar?.appearance.edgeSoftness??0,floorId:activeId,revision:state.mapRevision??0,mask:fogMask,disabled:busy||!connected||!state.dungeonMap?.fogOfWar?.enabled||!visible,overlay:fogOverlay&&Boolean(state.dungeonMap?.fogOfWar?.enabled),controller:fogController,onPolygonState:setFogPolygon,onCommit:saveFogMask},...(terrainSettings.mode!=='cells'?{terrain:{disabled:busy,mode:terrainSettings.mode,brush:terrainSettings.brush,texture:terrainSettings.texture,onStroke:stroke=>{void dispatch({type:'map.terrain.stroke',stroke})}}}:{}), transitionPicking:Boolean(transitionPick), activation:toolEpoch, document:document??undefined, toolbar:objectToolbar, drawing: ['wall-line','room','corridor'].includes(tool)?{kind:tool as 'wall-line'|'room'|'corridor',width:corridorWidth,wallsOnly,floor,material:wallMaterial,visual:visualFor(wallAsset)}:undefined,onDraw:command=>{void dispatch(command)}, wallVisual:visualFor(wallAsset),doorVisual:visualFor(doorAsset), snap, scenery: tool === 'sceneryMove' && prop && isScenery(prop) ? prop : sceneryAsset ?? undefined, assetScope: battlefield.assetScope, assetContext: battlefield.assetContext, tool, selectedId: selected?.objectId, previewRotation: tool==='objectMove'&&prop&&!isScenery(prop)?prop.rotation:rotation, onHit: hit, onPaint: cells => { void dispatch({ type: 'map.floor.paint', cells, material: floor }) } }
  const playerView=fogPreview?projectEncounter(state,{id:'fog-preview',role:'player'}):undefined
  const inspector=<>
    <aside className="builder-tools inspector" hidden={!editing} aria-label="Map inspector">
      <header className="inspector-header"><span className="eyebrow">MAP EDITOR</span><h2>{fullDocument?.name??'Flat battlefield'}</h2><p>Editing: {activeLevel?.name??'Ground Floor'} · {activeLevel?.elevationFeet??0} ft</p><p><StatusPill tone={failed?'danger':busy?'neutral':document&&JSON.stringify({document:fullDocument,name})!==savedDocument?'warning':'success'}>{busy?'Saving / applying…':failed?'Save / edit failed':!document?'No map template':JSON.stringify({document:fullDocument,name})!==savedDocument?'Unsaved template changes':'Saved template'}</StatusPill> · {state.mapRevision??0} revisions</p><button disabled={!connected||busy||Boolean(preview)} onClick={()=>void save(false)}>Save map</button><button onClick={()=>{workspaceRef.current?.querySelectorAll('.inspector details').forEach(d=>d.removeAttribute('open'))}}>Collapse all</button></header>
      <div className="inspector-scroll">{state.dungeonMap&&<InspectorSection title="Fog of War" sectionId="fog" defaultOpen>
       <FogOfWarPanel key={state.dungeonMap.id} onAppearance={(edgeSoftness,cinematic)=>{void dispatch({type:'map.fog.settings',edgeSoftness,cinematic})}} fog={state.dungeonMap.fogOfWar} floorName={activeLevel?.name??'Ground Floor'} settings={fogSettings} active={tool==='fog'} disabled={!connected||busy||Boolean(preview)||Boolean(floorPreview)} busy={busy&&messageScope==='fog'} failed={failed&&messageScope==='fog'} message={messageScope==='fog'?message:''} local={!library} polygon={fogPolygon} controller={fogController} onSettings={next=>{setFogSettings(next);if(tool!=='fog')activateFog(next)}} onEnable={enabled=>{if(!enabled)setTool('select');void dispatch({type:'map.fog.enabled',enabled})}} onActivate={()=>activateFog()} onOverlay={setFogOverlay} overlay={fogOverlay} onPreview={()=>{fogController.current?.cancel();setFogPreview(true)}} onReset={resetFog} onFloor={reveal=>saveFogMask(reveal?fullMask(activeLevel!.width,activeLevel!.height):'0'.repeat(activeLevel!.width*activeLevel!.height*4),fogMask)}/>
      </InspectorSection>}<fieldset disabled={!connected||busy||Boolean(preview)} className="inspector-fields"><legend className="visually-hidden">Map tools</legend><h3 className="inspector-group-label">Editing</h3>
      <InspectorSection title="Active tool" sectionId="active-tool" persistenceKey="active-tool" description={tool} defaultOpen><div className="builder-properties" aria-label="Tool properties">          <label><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)} />Snap scenery to grid</label>

          {tool==='scenery'&&sceneryAsset&&<fieldset><legend>Object placement settings</legend><p>{sceneryAsset.label}</p>{(['rotation','scale','verticalOffset'] as const).map(key=><label key={key}>Placement {key}<input type="number" step="any" min={key==='rotation'?0:key==='scale'?sceneryLimits.minScale:sceneryLimits.minOffset} max={key==='rotation'?360:key==='scale'?sceneryLimits.maxScale:sceneryLimits.maxOffset} value={sceneryAsset[key]} onChange={e=>{const result=scenerySchema.safeParse({...sceneryAsset,[key]:Number(e.target.value)});if(result.success)setSceneryAsset(result.data)}}/></label>)}</fieldset>}
          {(tool === 'scenery' || tool === 'sceneryMove') && <p>Click the floor to {tool === 'sceneryMove' ? 'move' : 'place'} scenery. Escape cancels. Middle-drag rotates; right-drag pans.</p>}
          {['wall-line','room','corridor'].includes(tool)&&<p>Left-drag snapped grid vertices to preview; release commits one edit. Escape cancels. Blue adds geometry; red marks corridor openings. Middle-drag rotates.</p>}
          {tool==='room'&&<label><input type="checkbox" checked={wallsOnly} onChange={e=>setWallsOnly(e.target.checked)}/>Walls only</label>}
          {tool==='corridor'&&<label>Corridor width<input aria-label="Corridor width" type="number" min={1} max={10} value={corridorWidth} onChange={e=>setCorridorWidth(Math.max(1,Math.min(10,Number(e.target.value))))}/></label>}
          {(['room','corridor'].includes(tool)||tool==='floor'&&terrainSettings.mode==='cells')&&<div className="material-segments floor-segments" role="group" aria-label="Paint material">{floorTypes.map(m=><button key={m} aria-pressed={floor===m} onClick={()=>setFloor(m)}>{m}</button>)}</div>}
          {['object','scenery'].includes(tool)&&<div className="object-choice"><p>{tool==='scenery'?sceneryAsset?.label:propType} · {tool==='scenery'?'Asset Library · GLB':'Built-in object'}</p><button onClick={()=>setPickingScenery(true)}>Change object</button></div>}
          {['wall','wall-line','room','corridor'].includes(tool)&&<>          <p>Wall visual: {wallAsset?.name ?? `Built-in ${wallMaterial}`}</p><button disabled={!library} onClick={()=>setArchitecturalPicker({kind:'wall',selected:false})}>Choose wall visual</button><button onClick={()=>setWallAsset(null)}>Built-in wall visual</button>
</>}
          {tool==='door'&&<>          <p>Door visual: {doorAsset?.name ?? 'Built-in door'}</p><button disabled={!library} onClick={()=>setArchitecturalPicker({kind:'door',selected:false})}>Choose door visual</button><button onClick={()=>setDoorAsset(null)}>Built-in door visual</button></>}
          {['wall','wall-line','room','corridor'].includes(tool)&&<div className="material-segments" role="group" aria-label="Wall material">{(['stone','wood']as const).map(m=><button key={m} aria-pressed={wallMaterial===m} onClick={()=>setWallMaterial(m)}>{m}</button>)}<label className="visually-hidden">Wall material<select aria-label="Wall material" value={wallMaterial} onChange={e => setWallMaterial(e.target.value as typeof wallMaterial)}><option>stone</option><option>wood</option></select></label></div>}
          {tool==='door'&&<label>Door state<select aria-label="Door state" value={doorState} onChange={e => setDoorState(e.target.value as typeof doorState)}><option>closed</option><option>open</option><option>locked</option></select></label>}
          {tool==='object'&&<label>Object rotation<select aria-label="Object rotation" value={rotation} onChange={e => setRotation(Number(e.target.value) as typeof rotation)}>{[0,90,180,270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label>}</div></InspectorSection>
      <InspectorSection title="Selection" sectionId="selection" persistenceKey="selection" open={['lighting','effects'].includes(tool)?true:undefined} description={tool==='effects'?'Effects':tool==='lighting'?'Lighting':selected?.kind??'None'}>{tool==='effects'&&<EffectsPanel state={state} sources={state.dungeonMap?.lighting?.sources} effects={state.dungeonMap?.environmentalEffects?.effects??[]} activeId={activeId} selectedId={selectedEffect} onSelect={setSelectedEffect} onPlace={(preset,centre)=>{if(centre){const id=crypto.randomUUID();void dispatch({type:'map.effect.set',effect:createEffect(id,preset,activeId,{x:Math.floor((activeLevel?.width??20)/2),z:Math.floor((activeLevel?.height??20)/2),heightFeet:presetMetadata(preset).renderer==='motes'?2.5:0})});setSelectedEffect(id);setEffectPreset(null)}else setEffectPreset(preset)}} send={send} disabled={!connected||busy}/>}{tool==='lighting'&&<LightingSourcesPanel state={state} activeId={activeId} selectedId={selectedLight} onSelect={setSelectedLight} onPlace={(name,atCentre)=>{if(atCentre){const id=crypto.randomUUID();void dispatch({type:'map.lighting.source.set',source:pointLightSchema.parse({...lightTemplates[name],id,name,floorId:activeId,position:{x:Math.floor((activeLevel?.width??20)/2),z:Math.floor((activeLevel?.height??20)/2),heightFeet:5}})});setSelectedLight(id);setLightAction('select')}else{setLightTemplate(name);setLightAction('place')}}} onMove={()=>setLightAction('move')} send={send} disabled={!connected||busy}/>}<div className="builder-properties">{door&&<div className="material-segments" role="group" aria-label="Selected door state">{(['open','closed','locked']as const).map(value=><button key={value} aria-pressed={door.state===value} onClick={()=>void dispatch({type:'map.door.update',doorId:door.id,state:value})}>{value}</button>)}</div>}          {prop && isScenery(prop) && <SceneryProperties draftStore={sceneryDrafts} draftKey={`${activeId}:${prop.id}:${levelRevision}`} key={`${activeId}:${prop.id}:${levelRevision}`} prop={prop} width={document!.width} height={document!.height} send={command => { void dispatch(command) }} onMove={() => setTool('sceneryMove')} />}
          {prop&&!isScenery(prop)&&<form key={`${activeId}:${prop.id}:${levelRevision}`} onSubmit={e=>{e.preventDefault();const scale=Number(new FormData(e.currentTarget).get('scale'));void dispatch({type:'map.prop.transform',propId:prop.id,position:prop.position,rotation:prop.rotation,scale})}}><label>Selected object scale<input aria-label="Selected object scale" name="scale" type="number" min={.1} max={10} step={.1} defaultValue={prop.scale??1} required/></label><button>Apply object scale</button></form>}
          {selectedWall&&<button onClick={()=>void dispatch({type:'map.wall.place',wall:{...selectedWall,material:wallMaterial,visual:visualFor(wallAsset)}})}>Apply wall visual choice to selected wall</button>}
          {selectedWall&&<ArchitectureProperties draftStore={architectureDrafts} draftKey={`${activeId}:${selectedWall?.id??door?.id}:${levelRevision}`} api={library?.api} key={`${activeId}:wall:${selectedWall.id}:${levelRevision}`} kind="wall" visual={selectedWall.visual} asset={selectedWall.visual?knownAssets[selectedWall.visual.assetId]:undefined} onChoose={()=>setArchitecturalPicker({kind:'wall',selected:true})} onApply={visual=>void dispatch({type:'map.wall.visual',wallId:selectedWall.id,visual})}/>}
          {door&&<ArchitectureProperties draftStore={architectureDrafts} draftKey={`${activeId}:${selectedWall?.id??door?.id}:${levelRevision}`} api={library?.api} key={`${activeId}:door:${door.id}:${levelRevision}`} kind="door" visual={door.visual} asset={door.visual?knownAssets[door.visual.assetId]:undefined} onChoose={()=>setArchitecturalPicker({kind:'door',selected:true})} onApply={visual=>void dispatch({type:'map.door.visual',doorId:door.id,visual})}/>}        {selected?.objectId && <div className="builder-row"><strong>Selected {selected.kind}: {selected.objectId}</strong>{prop && !isScenery(prop) && <button onClick={() => void dispatch({ type: 'map.prop.rotate', propId: prop.id, rotation: ((prop.rotation + 90) % 360) as typeof rotation })}>Rotate selected object</button>}{door && <button onClick={() => void dispatch({ type: 'map.door.update', doorId: door.id, state: doorState })}>Apply selected door state</button>}<button onClick={() => void dispatch(selected.kind === 'prop' ? { type: 'map.prop.remove', propId: selected.objectId! } : selected.kind === 'door' ? { type: 'map.door.remove', doorId: selected.objectId! } : { type: 'map.wall.remove', wallId: selected.objectId! })}>Remove selected</button></div>}</div></InspectorSection>
      <InspectorSection title="Floor" sectionId="floor" persistenceKey="floor" description={floor}><label className="floor-choice">Floor material<select aria-label="Floor material" value={floor} onChange={e=>setFloor(e.target.value as typeof floor)}>{floorTypes.map(t=><option key={t}>{t}</option>)}</select></label><p>{document?.floors.length??0} painted squares · {state.battleMap.gridSizeFeet} feet per square</p></InspectorSection>
<h3 className="inspector-group-label">This level</h3>      {state.dungeonMap&&<DungeonLevelsPanel map={state.dungeonMap} view={levelView} send={dispatch} disabled={!connected||busy||Boolean(preview)}/>}
      {state.dungeonMap&&dungeonLevels(state.dungeonMap).map(level=><div data-floor-image key={level.id} hidden={level.id!==activeId}><FloorSurfacePanel key={`${state.dungeonMap?.id}:${level.id}`} levelId={level.id} document={levelDocument(level)} api={library?.api} disabled={!connected||busy||Boolean(preview)} send={async command=>{setMessageScope('map');await send(command);setMessage(command.type==='map.floorSurface.set'?'Floor surface saved.':'Floor image settings saved.')}} onPreview={showFloorPreview}/></div>)}
{document&&<LightingEnvironmentPanel key={`override:${activeId}`} document={{...document,...(state.dungeonMap?.lighting?{lighting:state.dungeonMap.lighting}:{})}} levelId={activeId} override send={send} disabled={!connected||busy}/>}
<TerrainPaintingPanel saveStatus={tool==='floor'&&terrainSettings.mode!=='cells'&&messageScope==='map'?{saving:busy,error:failed,message}:undefined} value={terrainSettings} onChange={setTerrainSettings} api={library?.api} disabled={!connected||busy||Boolean(preview)||Boolean(floorPreview)||!document} count={document?.terrainPaint?.length??0} onActivate={()=>{setTool('floor');setInspectorHidden(false)}} onClear={()=>send({type:'map.terrain.clear',levelId:activeId})}/>
<InspectorSection title="Scenery" description={`${document?.props.length??0} placed`} sectionId="scenery" persistenceKey="scenery"><ul className="inspector-scenery">{document?.props.map(item=><li key={item.id}><button onClick={()=>{setTool('select');setSelected({cell:{x:Math.floor(item.position.x),z:Math.floor(item.position.z)},wall:{id:'H:0:0',x:0,z:0,axis:'H',material:'stone'},kind:'prop',objectId:item.id})}}>{isScenery(item)?item.label:item.type}</button></li>)}</ul></InspectorSection>
      {state.dungeonMap&&<TransitionsPanel map={state.dungeonMap} draft={transitionDraft} onDraft={setTransitionDraft} onNew={()=>{setTransitionDraft(newTransition(state.dungeonMap!));setTool('transition')}} onPick={pickTransition} onSelect={selectTransition} send={async command=>{setMessageScope('map');await send(command);setMessage('Transition saved.')}} disabled={!connected||busy||Boolean(preview)||Boolean(floorPreview)} onChooseAsset={library?()=>setTransitionAssetPicker(true):undefined}/>}
      {transitionPick&&<p role="status">Click the {transitionPick} square on {activeLevel?.name}.</p>}
      <h3 className="inspector-group-label">Map</h3>{state.dungeonMap&&<LightingScenesPanel document={state.dungeonMap} send={send} disabled={!connected||busy}/>}{state.dungeonMap&&<LightingEnvironmentPanel key={`global:${state.dungeonMap.id}`} document={state.dungeonMap} send={send} disabled={!connected||busy}/>}<InspectorSection title="Map file & templates" description={`${maps.length} saved`} sectionId="map-templates" persistenceKey="map-templates"><label className="template-name">Template name<input aria-label="Template name" value={name} maxLength={150} onChange={e=>setName(e.target.value)}/></label>        <div className="builder-row"><label>Saved maps<select aria-label="Saved maps" value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Choose a template</option>{maps.map(m => <option key={m.id} value={m.id}>{m.name} · v{m.revision}</option>)}</select></label><button disabled={!selectedTemplate} onClick={loadTemplate}>Open saved map</button><button disabled={!selectedTemplate} onClick={() => void save(true)}>Overwrite selected template</button>{(['rename', 'duplicate', 'delete'] as const).map(action => <button key={action} disabled={!selectedTemplate} onClick={() => void manageTemplate(action)}>{action[0].toUpperCase() + action.slice(1)} template</button>)}</div></InspectorSection>
      </fieldset><InspectorSection title="Generate dungeon" sectionId="generate-dungeon" persistenceKey="generate-dungeon" description={theme}>      {<div className="builder-preview"><h3>Dungeon generation</h3><div className="builder-row"><label>Theme<select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value as typeof theme)}>{themes.map(t => <option key={t}>{t}</option>)}</select></label><label>Generation width<input type="number" min={6} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Generation height<input type="number" min={6} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><label>Rooms<input type="number" min={1} max={25} value={roomCount} onChange={e => setRoomCount(Number(e.target.value))} /></label><label>Minimum room size<input type="number" min={3} max={20} value={minRoomSize} onChange={e => setMinRoomSize(Number(e.target.value))} /></label><label>Maximum room size<input type="number" min={3} max={30} value={maxRoomSize} onChange={e => setMaxRoomSize(Number(e.target.value))} /></label><label>Random seed<input value={seed} onChange={e => setSeed(e.target.value)} maxLength={100} /></label><button disabled={busy} onClick={() => previewGeneration()}>Preview dungeon</button><button disabled={busy} onClick={() => previewGeneration(crypto.randomUUID())}>Regenerate with new seed</button></div>
        {preview && <div className="builder-row"><strong>Preview only — the encounter has not changed.</strong><button disabled={!connected || busy} onClick={() => void run(async () => { if (state.dungeonMap && !confirm('Replace the encounter environment with this generated map? Saved templates and combat statistics stay unchanged.')) return; await send({ type: 'map.generate', options: preview.options }); setName(preview.document.name); setPreview(null) })}>Accept generated map</button><button onClick={() => setPreview(null)}>Cancel generation</button></div>}</div>}
</InspectorSection>
      <fieldset disabled={!connected||busy||Boolean(preview)} className="inspector-fields"><InspectorSection title="New blank map" description={`${width} × ${height}`} sectionId="new-blank-map" persistenceKey="new-blank-map">        <div className="builder-row"><label>Map name<input value={name} onChange={e => setName(e.target.value)} maxLength={150} /></label><label>Map width<input type="number" min={4} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Map height<input type="number" min={4} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><button onClick={() => { if (!document || confirm('Replace the current environment with a blank map? Combatants are preserved; invalid token positions relocate deterministically.')) void dispatch({ type: 'map.blank', id: crypto.randomUUID(), name, width, height }) }}>Create blank map</button></div></InspectorSection></fieldset>
      {message&&messageScope!=='fog'&&<p role={failed?"alert":"status"}>{message}</p>}</div>
    </aside>
  </>
  return <section ref={workspaceRef} className="dungeon-builder" data-editing={editing} data-inspector-hidden={inspectorHidden}>
    {transitionAssetPicker&&library&&<Modal label="Choose transition model" onClose={()=>setTransitionAssetPicker(false)}><AssetLibrary api={library.api} csrf="" onClose={()=>setTransitionAssetPicker(false)} onPick={asset=>{if(transitionDraft)setTransitionDraft({...transitionDraft,assetId:asset.id});setTransitionAssetPicker(false)}}/></Modal>}
    {architecturalPicker && library && <Modal label={`Choose ${architecturalPicker.kind} visual`} onClose={()=>setArchitecturalPicker(null)}><AssetLibrary api={library.api} csrf="" pickerTitle={`Choose ${architecturalPicker.kind} visual`} architecturalRole={architecturalPicker.kind} onClose={()=>setArchitecturalPicker(null)} onPick={asset=>{
      setKnownAssets(previous=>({...previous,[asset.id]:asset}))
      const visual=visualFor(asset)!
      if(architecturalPicker.selected){if(architecturalPicker.kind==='wall'&&selectedWall)void dispatch({type:'map.wall.visual',wallId:selectedWall.id,visual});if(architecturalPicker.kind==='door'&&door)void dispatch({type:'map.door.visual',doorId:door.id,visual})}
      else if(architecturalPicker.kind==='wall'){setWallAsset(asset);setTool('wall')}else{setDoorAsset(asset);setTool('door')}
      setArchitecturalPicker(null)
    }}/></Modal>}
    {pickingScenery && <Modal label="Add Object" onClose={()=>setPickingScenery(false)}><AssetLibrary api={library?.api ?? (async () => ({assets:[],total:0,maxBytes:25*1024*1024}))} pickerTitle="Add Object" onPickBuiltin={type => { setPropType(type); setSceneryAsset(null); setPickingScenery(false); setTool('object') }} csrf="" onClose={() => setPickingScenery(false)} onPick={chooseScenery} /></Modal>}
    <BattleMap3D {...battlefield} onSelectEffect={activateEffects} onSelectLight={activateLighting} onSelectTransition={id=>{const transition=state.dungeonMap?.transitions?.find(t=>t.id===id);if(transition)selectTransition(transition)}} showSharedControls={floorPreview ? false : battlefield.showSharedControls} editorInspector={inspector} inspectorOpen={!inspectorHidden} onInspectorOpen={open=>setInspectorHidden(!open)} toolHint={editing&&tool==='effects'?`Effects · ${effectPreset?'Click or tap a square to place '+presetMetadata(effectPreset).name:'Select a gizmo or use the effects list'} · Escape cancels · Visual only`:editing&&tool==='fog'?`${fogSettings.mode==='reveal'?'Reveal':'Conceal'} ${fogSettings.shape} · ${fogSettings.shape==='polygon'?'Tap vertices, then Finish polygon in the inspector':'Left mouse, pen or one finger edits'} · Escape cancels`:editing&&tool==='lighting'?`Lighting · ${lightAction==='place'?'Click a square to add '+lightTemplate:lightAction==='move'?'Click a square to move the light':'Select a gizmo or use the light list'} · Visual only`:editing&&tool==='floor'&&terrainSettings.mode!=='cells'?`${terrainSettings.mode==='paint'?'Terrain brush':'Terrain eraser'} · Left: paint · Middle: orbit · Right: pan · Escape: cancel`:editing&&transitionPick?`Click the ${transitionPick} square on ${activeLevel?.name}.`:undefined} historyControls={editing?<div className="editor-history-controls"><Button disabled={!connected||busy||Boolean(preview)||!state.mapUndoDepth} onClick={()=>void dispatch({type:'map.undo'})}>Undo map edit</Button><Button disabled={!connected||busy||Boolean(preview)||!state.mapRedoDepth} onClick={()=>void dispatch({type:'map.redo'})}>Redo map edit</Button><Menu label="History" items={[{id:'undo',label:'Undo map edit',onSelect:()=>void dispatch({type:'map.undo'}),disabled:!connected||busy||Boolean(preview)||!state.mapUndoDepth},{id:'redo',label:'Redo map edit',onSelect:()=>void dispatch({type:'map.redo'}),disabled:!connected||busy||Boolean(preview)||!state.mapRedoDepth},{id:'clear',label:'Clear map history',danger:true,onSelect:()=>{if(confirm('Clear map undo and redo history? This cannot be undone.'))void dispatch({type:'map.history.clear'})},disabled:!connected||busy||Boolean(preview)}]}/></div>:undefined} canvasTools={editing?<fieldset disabled={!connected||busy||Boolean(preview)||Boolean(floorPreview)} className="editor-palette" aria-label="Editor tools">
      <Button aria-label="Select" aria-pressed={tool==='select'} onClick={()=>setTool('select')}>⌖<span>Select</span></Button>
      <div className="terrain-floor-tools"><Button aria-label="Paint floor" aria-pressed={tool==='floor'} onClick={()=>setTool('floor')}>▦<span>Floor</span></Button><Menu side="right" pressed={tool==='floor'} label="Floor tools" triggerContent={<>▦<span>Floor ▸</span></>} items={[{id:'paint',label:'Paint terrain',onSelect:()=>{setTerrainSettings(s=>({...s,mode:'paint'}));setTool('floor')}},{id:'erase',label:'Erase terrain',onSelect:()=>{setTerrainSettings(s=>({...s,mode:'erase'}));setTool('floor')}},{id:'cells',label:'Paint floor cells',onSelect:()=>{setTerrainSettings(s=>({...s,mode:'cells'}));setTool('floor')}}]}/></div>
      <Menu side="right" pressed={['wall','wall-line','room','corridor'].includes(tool)} label="Wall tools" triggerContent={<>━<span>Wall ▸</span></>} items={(['wall','wall-line','room','corridor'] as const).map((t,i)=>({id:t,label:['Draw wall','Wall line','Rectangle room','Corridor'][i],onSelect:()=>setTool(t)}))}/>
      <Button aria-label="Place door" aria-pressed={tool==='door'} onClick={()=>setTool('door')}>Π<span>Door</span></Button>
      <Button aria-label="Add Object" aria-pressed={tool==='object'||tool==='scenery'} onClick={()=>setPickingScenery(true)}>❖<span>Object</span></Button>
      <Menu side="right" pressed={tool==='fog'} label="Fog tools" triggerContent={<>◒<span>Fog ▸</span></>} items={[{id:'reveal',label:'Reveal Brush',onSelect:()=>activateFog({...fogSettings,shape:'brush',mode:'reveal'})},{id:'conceal',label:'Conceal Brush',onSelect:()=>activateFog({...fogSettings,shape:'brush',mode:'conceal'})},{id:'rectangle',label:'Rectangle',onSelect:()=>activateFog({...fogSettings,shape:'rectangle'})},{id:'polygon',label:'Polygon',onSelect:()=>activateFog({...fogSettings,shape:'polygon'})},{id:'preview',label:'Player Preview',onSelect:()=>{fogController.current?.cancel();setFogPreview(true)}},{id:'settings',label:'Fog of War settings',onSelect:openFog}]}/>

      <Button aria-label="Effects tool" aria-pressed={tool==='effects'} onClick={()=>activateEffects()}>✦<span>Effects</span></Button>
      <Button aria-label="Lighting tool" aria-pressed={tool==='lighting'} onClick={()=>activateLighting()}>☀<span>Lighting</span></Button>
      <Button aria-label="Transitions" aria-pressed={tool==='transition'} onClick={()=>{setTool('transition');if(!transitionDraft&&state.dungeonMap)setTransitionDraft(newTransition(state.dungeonMap));requestAnimationFrame(()=>{const panel=workspaceRef.current?.querySelector<HTMLDetailsElement>('.transitions-panel');if(panel)panel.open=true})}}>⇅<span>Link</span></Button>
      <Button aria-label="Floor image tool" onClick={()=>{setInspectorHidden(false);requestAnimationFrame(()=>{const host=workspaceRef.current?.querySelector('[data-floor-image]:not([hidden]) > div');host?.dispatchEvent(new Event('floor-image-open'));const panel=host?.querySelector<HTMLDetailsElement>('details');if(panel){panel.open=true;panel.scrollIntoView({block:'nearest'})}})}}>▣<span>Image</span></Button>
      <Button aria-label="Erase" aria-pressed={tool==='erase'} onClick={()=>setTool('erase')}>⌫<span>Erase</span></Button>
    </fieldset>:undefined} fogOverlay={fogOverlay} map={preview || floorPreview ? reconcileBattleMap({ ...state.battleMap, width: Math.max(...allLevels.map(l=>l.width)), height: Math.max(...allLevels.map(l=>l.height)) }, state.combatants.map(c => c.id)) : state.battleMap} dungeonMap={fullDocument} levelView={levelView} editor={editing && connected && !preview && !floorPreview && document ? editor : undefined} canMove={!editing && battlefield.canMove} {...(playerView?{levelView:{...levelView,activeId:playerView.dungeonMap&&dungeonLevels(playerView.dungeonMap).some(l=>l.id===activeId)?activeId:primaryLevelId(playerView.dungeonMap),hiddenIds:[]},dungeonMap:playerView.dungeonMap,map:playerView.battleMap,combatants:playerView.combatants,tactical:playerView.tactical,levelsHidden:playerView.levelsHidden,actor:{id:'fog-preview',role:'player' as const},editor:undefined,editing:false,canvasTools:undefined,editorInspector:undefined,historyControls:undefined,combatantDetails:undefined,combatantActions:undefined,onAppearance:undefined,onToggleEditorMode:undefined,combatControlState:undefined,selectedId:null,onCommand:undefined,canMove:false,onPlaceSquare:undefined,onSelectToken:()=>{},onMoveToken:()=>{},showSharedControls:false,fogPreview:true,onExitFogPreview:()=>setFogPreview(false)}:{})} />
  </section>
}
