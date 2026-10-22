import { z } from 'zod'
import { useEffect, useState } from 'react'
import BattleMap3D, { type BattleMap3DProps } from './BattleMap3D'
import { floorTypes, propTypes, themes, dungeonSchema, readDungeon, type DungeonMap } from '../shared/dungeon'
import { generateDungeon, type GenerationOptions } from '../shared/generator'
import { reconcileBattleMap } from './mapState'
import type { EncounterState, GameCommand } from '../shared/domain'
import type { EditorHit, EditorInteraction } from './DungeonScene'
import './dungeon-builder.css'
export interface MapLibrary { campaignId: string; api: (path: string, body?: unknown) => Promise<unknown>; encounterId: string; revision: number }
interface SavedMap { id: string; name: string; revision: number; document?: DungeonMap; width?: number; height?: number }
const localTemplates = z.array(z.object({ id: z.uuid(), name: z.string().min(1).max(150), revision: z.number().int().positive(), document: dungeonSchema }).strict()).max(100)
const localKey = 'ledger.dungeon.templates.v1'
export default function DungeonBuilder({ state, editing, send, connected, library, battlefield }: {
  state: EncounterState; editing: boolean; send: (command: GameCommand) => Promise<void>; connected: boolean; library?: MapLibrary
  battlefield: Omit<BattleMap3DProps, 'map' | 'dungeonMap' | 'editor'>
}) {
  const [tool, setTool] = useState<EditorInteraction['tool']>('select')
  const [floor, setFloor] = useState<DungeonMap['floors'][number]['type']>('stone')
  const [wallMaterial, setWallMaterial] = useState<'stone' | 'wood'>('stone')
  const [propType, setPropType] = useState<DungeonMap['props'][number]['type']>('crate')
  const [rotation, setRotation] = useState<0 | 90 | 180 | 270>(0)
  const [doorState, setDoorState] = useState<'open' | 'closed' | 'locked'>('closed')
  const [selected, setSelected] = useState<EditorHit | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [maps, setMaps] = useState<SavedMap[]>([])
  const [templateId, setTemplateId] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [name, setName] = useState('New dungeon')
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
    setMessage('Map saved. Encounter copies remain independent.')
  })
  const loadTemplate = () => run(async () => {
    if (!selectedTemplate) return
    if (document && !confirm('Replace the encounter map with a copy of this template? Combat statistics are preserved.')) return
    await send(library ? { type: 'map.template.load', templateId } : { type: 'map.load', document: readDungeon(selectedTemplate.document) }); setName(selectedTemplate.name)
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
    if (tool === 'select') {
      // Sparse furniture geometry leaves gaps in its occupied cell. Preserve direct
      // wall/door/prop hits, but let a floor hit select the prop on that square.
      const occupant = !value.objectId && document?.props.find(p => p.position.x === value.cell.x && p.position.z === value.cell.z)
      setSelected(occupant ? { ...value, kind: 'prop', objectId: occupant.id } : value)
      return
    }
    if (tool === 'floor') { void dispatch({ type: 'map.floor.paint', cells: [value.cell], material: floor }); return }
    if (tool === 'wall' && (value.kind === 'wall' || value.kind === 'door')) { setSelected(value); return }
    if (tool === 'wall') void dispatch({ type: 'map.wall.place', wall: { ...value.wall, material: wallMaterial } })
    else if (tool === 'door') {
      const wall = document?.walls.find(w => w.id === value.wall.id)
      if (!wall) { setMessage('Place a wall on this edge first.'); return }
      const existing = document?.doors.find(d => d.wallId === wall.id)
      void dispatch(existing ? { type: 'map.door.update', doorId: existing.id, state: doorState } : { type: 'map.door.place', door: { id: crypto.randomUUID(), wallId: wall.id, state: doorState } })
    } else if (tool === 'object') void dispatch({ type: 'map.prop.place', prop: { id: crypto.randomUUID(), type: propType, position: value.cell, rotation } })
    else if (tool === 'erase') {
      if (value.kind === 'prop') void dispatch({ type: 'map.prop.remove', propId: value.objectId! })
      else if (value.kind === 'door') void dispatch({ type: 'map.door.remove', doorId: value.objectId! })
      else if (value.kind === 'wall') void dispatch({ type: 'map.wall.remove', wallId: value.objectId! })
      else void dispatch({ type: 'map.floor.paint', cells: [value.cell], material: null })
    }
  }
  const prop = document?.props.find(p => p.id === selected?.objectId), door = document?.doors.find(d => d.id === selected?.objectId)
  const editor: EditorInteraction = { tool, selectedId: selected?.objectId, previewRotation: rotation, onHit: hit, onPaint: cells => { void dispatch({ type: 'map.floor.paint', cells, material: floor }) } }
  return <section className="dungeon-builder" data-editing={editing}>
    <div className="builder-tools" hidden={!editing}>
      <h2>Dungeon builder</h2><button onClick={() => setShowGenerator(value => !value)}>Generate dungeon</button><p>{document ? `${document.name} · ${document.width} × ${document.height} · map revision ${state.mapRevision ?? 0}` : 'Flat battlefield · create or load a dungeon to edit geometry.'}</p>
      <fieldset disabled={!connected || busy || Boolean(preview)}><legend>Map tools</legend><div className="builder-row">{(['select', 'floor', 'wall', 'door', 'object', 'erase'] as const).map(t => <button key={t} aria-pressed={tool === t} onClick={() => setTool(t)}>{({ select: 'Select', floor: 'Paint floor', wall: 'Draw wall', door: 'Place door', object: 'Place object', erase: 'Erase' })[t]}</button>)}<button disabled={!state.mapUndoDepth} onClick={() => void dispatch({ type: 'map.undo' })}>Undo map edit</button><button disabled={!state.mapRedoDepth} onClick={() => void dispatch({ type: 'map.redo' })}>Redo map edit</button></div>
        <aside className="builder-properties" aria-label="Tool properties">
          <label>Floor material<select aria-label="Floor material" value={floor} onChange={e => setFloor(e.target.value as typeof floor)}>{floorTypes.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Wall material<select aria-label="Wall material" value={wallMaterial} onChange={e => setWallMaterial(e.target.value as typeof wallMaterial)}><option>stone</option><option>wood</option></select></label>
          <label>Door state<select aria-label="Door state" value={doorState} onChange={e => setDoorState(e.target.value as typeof doorState)}><option>closed</option><option>open</option><option>locked</option></select></label>
          <label>Object palette<select aria-label="Object palette" value={propType} onChange={e => setPropType(e.target.value as typeof propType)}>{propTypes.map(t => <option key={t}>{t}</option>)}</select></label>
          <label>Object rotation<select aria-label="Object rotation" value={rotation} onChange={e => setRotation(Number(e.target.value) as typeof rotation)}>{[0,90,180,270].map(n => <option key={n} value={n}>{n}°</option>)}</select></label>
        </aside>
        {selected?.objectId && <div className="builder-row"><strong>Selected {selected.kind}: {selected.objectId}</strong>{prop && <button onClick={() => void dispatch({ type: 'map.prop.rotate', propId: prop.id, rotation: ((prop.rotation + 90) % 360) as typeof rotation })}>Rotate selected object</button>}{door && <button onClick={() => void dispatch({ type: 'map.door.update', doorId: door.id, state: doorState })}>Apply selected door state</button>}<button onClick={() => void dispatch(selected.kind === 'prop' ? { type: 'map.prop.remove', propId: selected.objectId! } : selected.kind === 'door' ? { type: 'map.door.remove', doorId: selected.objectId! } : { type: 'map.wall.remove', wallId: selected.objectId! })}>Remove selected</button></div>}
        <div className="builder-row"><label>Map name<input value={name} onChange={e => setName(e.target.value)} maxLength={150} /></label><label>Map width<input type="number" min={4} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Map height<input type="number" min={4} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><button onClick={() => { if (!document || confirm('Replace the current environment with a blank map? Combatants are preserved; invalid token positions relocate deterministically.')) void dispatch({ type: 'map.blank', id: crypto.randomUUID(), name, width, height }) }}>Create blank map</button></div>
        <div className="builder-row"><button onClick={() => void save(false)}>Save map</button><label>Saved maps<select aria-label="Saved maps" value={templateId} onChange={e => setTemplateId(e.target.value)}><option value="">Choose a template</option>{maps.map(m => <option key={m.id} value={m.id}>{m.name} · v{m.revision}</option>)}</select></label><button disabled={!selectedTemplate} onClick={loadTemplate}>Open saved map</button><button disabled={!selectedTemplate} onClick={() => void save(true)}>Overwrite selected template</button>{(['rename', 'duplicate', 'delete'] as const).map(action => <button key={action} disabled={!selectedTemplate} onClick={() => void manageTemplate(action)}>{action[0].toUpperCase() + action.slice(1)} template</button>)}</div>
      </fieldset>
      {showGenerator && <div className="builder-preview"><h3>Dungeon generation</h3><div className="builder-row"><label>Theme<select aria-label="Theme" value={theme} onChange={e => setTheme(e.target.value as typeof theme)}>{themes.map(t => <option key={t}>{t}</option>)}</select></label><label>Generation width<input type="number" min={6} max={50} value={width} onChange={e => setWidth(Number(e.target.value))} /></label><label>Generation height<input type="number" min={6} max={50} value={height} onChange={e => setHeight(Number(e.target.value))} /></label><label>Rooms<input type="number" min={1} max={25} value={roomCount} onChange={e => setRoomCount(Number(e.target.value))} /></label><label>Minimum room size<input type="number" min={3} max={20} value={minRoomSize} onChange={e => setMinRoomSize(Number(e.target.value))} /></label><label>Maximum room size<input type="number" min={3} max={30} value={maxRoomSize} onChange={e => setMaxRoomSize(Number(e.target.value))} /></label><label>Random seed<input value={seed} onChange={e => setSeed(e.target.value)} maxLength={100} /></label><button disabled={busy} onClick={() => previewGeneration()}>Preview dungeon</button><button disabled={busy} onClick={() => previewGeneration(crypto.randomUUID())}>Regenerate with new seed</button></div>
        {preview && <div className="builder-row"><strong>Preview only — the encounter has not changed.</strong><button disabled={!connected || busy} onClick={() => void run(async () => { if (state.dungeonMap && !confirm('Replace the encounter environment with this generated map? Saved templates and combat statistics stay unchanged.')) return; await send({ type: 'map.generate', options: preview.options }); setName(preview.document.name); setPreview(null) })}>Accept generated map</button><button onClick={() => setPreview(null)}>Cancel generation</button></div>}</div>}
      {message && <p role="status">{message}</p>}
    </div>
    <BattleMap3D {...battlefield} map={preview ? reconcileBattleMap({ ...state.battleMap, width: document!.width, height: document!.height }, state.combatants.map(c => c.id)) : state.battleMap} dungeonMap={document} editor={editing && connected && !preview && document ? editor : undefined} canMove={!editing && battlefield.canMove} />
  </section>
}
