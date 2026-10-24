import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { InstancedMesh, Object3D } from 'three'
import type { ThreeEvent } from '@react-three/fiber'
import { Scenery3D } from './Scenery3D'
import { isScenery, sceneryAtPoint, type SceneryProp } from '../shared/scenery'
import { canonicalWall, type Cell, type DungeonMap, type ProceduralProp, type Wall } from '../shared/dungeon'
export interface EditorHit { position?: Cell; cell: Cell; wall: Wall; objectId?: string; kind?: 'prop' | 'wall' | 'door' }
export interface EditorInteraction {
  tool: 'select' | 'floor' | 'wall' | 'door' | 'object' | 'erase' | 'scenery' | 'sceneryMove'
  selectedId?: string
  onHit: (hit: EditorHit) => void
  onPaint: (cells: Cell[]) => void
  previewRotation?: number
  scenery?: SceneryProp
  snap?: boolean
  assetScope?: string
  assetContext?: { campaignId: string; encounterId: string }
}
interface Transform { position: [number, number, number]; rotation?: number; scale?: [number, number, number] }
function Instances({ transforms, color, shape = 'box', emissive = false, onHit }: { transforms: Transform[]; color: string; shape?: 'box' | 'cylinder' | 'sphere'; emissive?: boolean; onHit?: (index: number) => void }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    if (!ref.current) return
    const object = new Object3D()
    transforms.forEach((t, i) => {
      object.position.set(...t.position); object.rotation.set(0, t.rotation ?? 0, 0); object.scale.set(...(t.scale ?? [1, 1, 1])); object.updateMatrix()
      ref.current!.setMatrixAt(i, object.matrix)
    })
    ref.current!.instanceMatrix.needsUpdate = true; ref.current!.computeBoundingSphere()
  }, [transforms])
  if (!transforms.length) return null
  return <instancedMesh ref={ref} args={[undefined, undefined, transforms.length]} castShadow receiveShadow onPointerUp={e => { if (onHit && e.button === 0) { e.stopPropagation(); onHit(e.instanceId!) } }}>
    {shape === 'box' ? <boxGeometry /> : shape === 'cylinder' ? <cylinderGeometry args={[.5, .5, 1, 12]} /> : <sphereGeometry args={[.5, 10, 8]} />}
    <meshStandardMaterial color={color} roughness={.85} emissive={emissive ? color : '#000'} emissiveIntensity={emissive ? .7 : 0} />
  </instancedMesh>
}
const colors = { stone: '#74766b', wood: '#79563a', dirt: '#705642', grass: '#426e43', lava: '#e44a14' }
function wallTransform(wall: Wall, map: DungeonMap): Transform {
  return { position: [wall.x - map.width / 2 + (wall.axis === 'H' ? .5 : 0), .8, wall.z - map.height / 2 + (wall.axis === 'V' ? .5 : 0)], scale: wall.axis === 'H' ? [1.04, 1.6, .16] : [.16, 1.6, 1.04] }
}
// The registry is deliberately data-oriented so a later asset adapter can replace a type.
const propParts: Record<ProceduralProp['type'], { color: string; shape?: 'box' | 'cylinder' | 'sphere'; offset: [number, number, number]; scale: [number, number, number]; glow?: boolean }[]> = {
  crate: [{ color: '#916b40', offset: [0, .35, 0], scale: [.7, .7, .7] }, { color: '#342a21', offset: [0, .55, 0], scale: [.74, .07, .74] }],
  barrel: [{ color: '#8b6033', shape: 'cylinder', offset: [0, .4, 0], scale: [.65, .8, .65] }, { color: '#343639', shape: 'cylinder', offset: [0, .65, 0], scale: [.68, .09, .68] }],
  chest: [{ color: '#674428', offset: [0, .28, 0], scale: [.85, .55, .55] }, { color: '#d8b65a', offset: [0, .35, .29], scale: [.1, .2, .04] }],
  table: [{ color: '#825d39', offset: [0, .65, 0], scale: [.95, .12, .7] }, { color: '#624327', offset: [-.35, .3, 0], scale: [.12, .6, .6] }, { color: '#624327', offset: [.35, .3, 0], scale: [.12, .6, .6] }],
  chair: [{ color: '#896844', offset: [0, .35, 0], scale: [.5, .12, .5] }, { color: '#896844', offset: [0, .65, -.23], scale: [.5, .6, .09] }, { color: '#59432c', offset: [0, .17, 0], scale: [.32, .35, .32] }],
  pillar: [{ color: '#9c9a90', shape: 'cylinder', offset: [0, 1, 0], scale: [.6, 2, .6] }, { color: '#72746e', offset: [0, .1, 0], scale: [.8, .2, .8] }],
  torch: [{ color: '#553c23', shape: 'cylinder', offset: [0, .6, 0], scale: [.12, 1.2, .12] }, { color: '#ffb13a', shape: 'sphere', offset: [0, 1.3, 0], scale: [.3, .5, .3], glow: true }],
  rock: [{ color: '#676a68', shape: 'sphere', offset: [0, .27, 0], scale: [.9, .65, .7] }],
  anvil: [{ color: '#3b454b', offset: [0, .25, 0], scale: [.4, .5, .5] }, { color: '#626f74', offset: [0, .55, 0], scale: [.9, .2, .4] }],
  brazier: [{ color: '#394047', shape: 'cylinder', offset: [0, .3, 0], scale: [.4, .6, .4] }, { color: '#b44321', shape: 'sphere', offset: [0, .7, 0], scale: [.65, .4, .65], glow: true }],
}
export const DungeonScene = memo(function DungeonScene({ map, editor, assetScope, assetContext }: { map: DungeonMap; editor?: EditorInteraction; assetScope?: string; assetContext?: {campaignId:string;encounterId:string} }) {
  const groups = useMemo(() => {
    const floors = Object.entries(colors).map(([type, color]) => ({ color, type, transforms: map.floors.filter(f => f.type === type).map(f => ({ position: [f.x - map.width / 2 + .5, -.045, f.z - map.height / 2 + .5] as [number, number, number], scale: [.99, .08, .99] as [number, number, number] })) }))
    const openings = new Set(map.doors.map(d => d.wallId))
    const walls = (['stone', 'wood'] as const).map(material => ({ material, walls: map.walls.filter(w => w.material === material && !openings.has(w.id)) }))
    return { floors, walls }
  }, [map])
  const hitWall = (w: Wall): EditorHit => ({ cell: { x: Math.min(w.x, map.width - 1), z: Math.min(w.z, map.height - 1) }, wall: w, objectId: w.id, kind: 'wall' })
  return <>
    {map.props.filter(isScenery).map(prop => <Scenery3D key={prop.id} prop={prop} width={map.width} height={map.height} editor={editor} scope={assetScope} context={assetContext} />)}
    {groups.floors.map(g => <Instances key={g.type} color={g.color} emissive={g.type === 'lava'} transforms={g.transforms} />)}
    {groups.walls.map(g => <Instances key={g.material} color={g.material === 'stone' ? '#666c6b' : '#775235'} transforms={g.walls.map(w => wallTransform(w, map))} onHit={editor && ['select', 'erase', 'wall', 'door'].includes(editor.tool) ? i => editor.onHit(hitWall(g.walls[i])) : undefined} />)}
    {map.doors.map(door => {
      const wall = map.walls.find(w => w.id === door.wallId)!, t = wallTransform(wall, map)
      return <group key={door.id} position={[t.position[0], 0, t.position[2]]} rotation={[0, wall.axis === 'V' ? Math.PI / 2 : 0, 0]} onPointerUp={e => { if (editor && ['select', 'erase', 'wall', 'door'].includes(editor.tool) && e.button === 0) { e.stopPropagation(); editor.onHit({ ...hitWall(wall), kind: 'door', objectId: door.id }) } }}>
        {[-.44, .44].map(x => <mesh key={x} position={[x, .8, 0]} castShadow><boxGeometry args={[.12, 1.6, .19]} /><meshStandardMaterial color="#646b67" /></mesh>)}
        <group position={[-.38, 0, 0]} rotation={[0, door.state === 'open' ? -Math.PI / 2 : 0, 0]}>
          <mesh position={[.38, .65, 0]} castShadow><boxGeometry args={[.76, 1.3, .09]} /><meshStandardMaterial color={door.state === 'locked' ? '#bd913c' : '#81522e'} /></mesh>
          <mesh position={[.65, .68, .08]}><sphereGeometry args={[.06, 8, 8]} /><meshStandardMaterial color="#e9c369" /></mesh>
        </group>
      </group>
    })}
    {(Object.keys(propParts) as Array<keyof typeof propParts>).map(type => {
      const props = map.props.filter((p): p is ProceduralProp => p.type === type)
      return propParts[type].map((part, i) => <Instances key={`${type}:${i}`} color={part.color} shape={part.shape} emissive={part.glow} transforms={props.map(p => {
        const a = p.rotation * Math.PI / 180
        return { position: [p.position.x - map.width / 2 + .5 + part.offset[0] * Math.cos(a) + part.offset[2] * Math.sin(a), part.offset[1], p.position.z - map.height / 2 + .5 + part.offset[2] * Math.cos(a) - part.offset[0] * Math.sin(a)], rotation: a, scale: part.scale }
      })} onHit={editor && ['select', 'erase'].includes(editor.tool) ? index => editor.onHit({ cell: props[index].position, wall: canonicalWall(props[index].position.x, props[index].position.z, 'north'), kind: 'prop', objectId: props[index].id }) : undefined} />)
    })}
    {editor?.selectedId && map.walls.filter(w => w.id === editor.selectedId || map.doors.some(d => d.id === editor.selectedId && d.wallId === w.id)).map(w => { const t = wallTransform(w, map); return <mesh key={w.id} position={t.position} scale={t.scale}><boxGeometry /><meshBasicMaterial color="#70c8ff" wireframe /></mesh> })}
    {editor?.selectedId && map.props.filter(p => p.id === editor.selectedId).map(p => <mesh key={p.id} position={[p.position.x - map.width / 2 + .5, .03, p.position.z - map.height / 2 + .5]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.46, .51, 24]} /><meshBasicMaterial color="#70c8ff" /></mesh>)}
  </>
})
export function EditorSurface({ width, height, editor }: { width: number; height: number; editor: EditorInteraction }) {
  const [painted, setPainted] = useState<Cell[]>([])
  const [hover, setHover] = useState<EditorHit | null>(null)
  const stroke = useRef<Map<string, Cell> | null>(null)
  const getHit = (event: ThreeEvent<PointerEvent>): EditorHit | null => {
    const x = event.point.x + width / 2, z = event.point.z + height / 2
    if (x < 0 || x >= width || z < 0 || z >= height) return null
    const cell = { x: Math.floor(x), z: Math.floor(z) }, fx = x - cell.x, fz = z - cell.z
    const distances = [fz, 1 - fx, 1 - fz, fx], edges = ['north', 'east', 'south', 'west'] as const
    return { position: sceneryAtPoint(x,z,width,height,editor.snap ?? true), cell, wall: canonicalWall(cell.x, cell.z, edges[distances.indexOf(Math.min(...distances))]) }
  }
  const add = (hit: EditorHit | null) => { if (hit && stroke.current) { stroke.current.set(`${hit.cell.x}:${hit.cell.z}`, hit.cell); setPainted([...stroke.current.values()]) } }
  return <>
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, .002, 0]} onPointerMove={e => { const h = getHit(e); setHover(h); if (e.buttons & 1) add(h) }} onPointerLeave={() => setHover(null)}
      onPointerDown={e => { if (e.button !== 0) return; e.stopPropagation(); if (editor.tool === 'floor') { stroke.current = new Map(); add(getHit(e)); (e.target as unknown as { setPointerCapture: (id: number) => void }).setPointerCapture(e.pointerId) } }}
      onPointerUp={e => { if (e.button !== 0 || e.delta > 3) return; e.stopPropagation(); const h = getHit(e); if (stroke.current) { add(h); const cells = [...stroke.current.values()]; stroke.current = null; setPainted([]); if (cells.length) editor.onPaint(cells) } else if (h) editor.onHit(h) }}>
      <planeGeometry args={[width, height]} /><meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
    {hover && editor.scenery && (editor.tool === 'scenery' || editor.tool === 'sceneryMove') && <Scenery3D prop={{ ...editor.scenery, position: hover.position! }} width={width} height={height} scope={editor.assetScope} context={editor.assetContext} preview />}
    {painted.map(cell => <mesh key={`${cell.x}:${cell.z}`} rotation={[-Math.PI / 2, 0, 0]} position={[cell.x - width / 2 + .5, .013, cell.z - height / 2 + .5]}><planeGeometry args={[.98,.98]} /><meshBasicMaterial color="#70c8ff" transparent opacity={.3} depthWrite={false} /></mesh>)}
    {hover && editor.tool === 'object' && <mesh position={[hover.cell.x - width / 2 + .5, .35, hover.cell.z - height / 2 + .5]} rotation={[0, (editor.previewRotation ?? 0) * Math.PI / 180, 0]}><boxGeometry args={[.7,.7,.7]} /><meshBasicMaterial color="#70c8ff" transparent opacity={.35} depthWrite={false} /></mesh>}
    {hover && (editor.tool === 'wall' || editor.tool === 'door' ? <mesh position={[hover.wall.x - width / 2 + (hover.wall.axis === 'H' ? .5 : 0), .1, hover.wall.z - height / 2 + (hover.wall.axis === 'V' ? .5 : 0)]}><boxGeometry args={hover.wall.axis === 'H' ? [1, .12, .18] : [.18, .12, 1]} /><meshBasicMaterial color="#70c8ff" transparent opacity={.6} depthWrite={false} /></mesh> : <mesh rotation={[-Math.PI / 2, 0, 0]} position={[hover.cell.x - width / 2 + .5, .012, hover.cell.z - height / 2 + .5]}><planeGeometry args={[.98, .98]} /><meshBasicMaterial color="#70c8ff" transparent opacity={.35} depthWrite={false} /></mesh>)}
  </>
}
