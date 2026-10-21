import { Canvas, ThreeEvent } from '@react-three/fiber'
import { Html, OrbitControls } from '@react-three/drei'
import { ChevronLeft, Eye, EyeOff, LocateFixed, RotateCcw } from 'lucide-react'
import { Suspense, useMemo, useRef } from 'react'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { BattleMapState, GridPosition } from './mapState'

interface Combatant {
  id: string | number
  name: string
  short: string
  side: string
  hp: number
  maxHp: number
  initiative: number
  ownerId?: string | null
}

interface BattleMap3DProps {
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

function Token({ combatant, position, map, selected, active, showLabel, onSelect }: {
  combatant: Combatant
  position: GridPosition
  map: BattleMapState
  selected: boolean
  active: boolean
  showLabel: boolean
  onSelect: () => void
}) {
  const color = combatant.side === 'hero' ? '#3c8465' : combatant.side === 'enemy' ? '#a84338' : '#777b7c'
  return <group position={toWorld(position, map)} onClick={(event) => { event.stopPropagation(); onSelect() }}>
    {active && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.24, 0]}><torusGeometry args={[0.42, 0.055, 10, 32]} /><meshStandardMaterial color="#efb83f" emissive="#a56a00" emissiveIntensity={0.45} /></mesh>}
    {selected && <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.21, 0]}><torusGeometry args={[0.51, 0.035, 10, 32]} /><meshStandardMaterial color="#70c8ff" emissive="#2584ba" emissiveIntensity={0.5} /></mesh>}
    <mesh castShadow position={[0, 0.1, 0]}>
      <cylinderGeometry args={[0.32, 0.4, 0.55, 24]} />
      <meshStandardMaterial color={color} roughness={0.56} metalness={0.08} />
    </mesh>
    {showLabel && <Html center position={[0, 1.05, 0]} distanceFactor={11} style={{ pointerEvents: 'none' }}><span className="token-label">{combatant.name}</span></Html>}
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

function BattlefieldScene({ combatants, map, selectedId, activeId, onSelectToken, onMoveToken, controlsRef, canMove }: Omit<BattleMap3DProps, 'round' | 'onToggleGrid' | 'onToggleLabels' | 'onReturnToTracker'> & { controlsRef: React.RefObject<OrbitControlsImpl | null> }) {
  const handleFloorClick = (event: ThreeEvent<MouseEvent>) => {
    if (canMove === false || selectedId === null || event.delta > 3) return
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
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow onClick={handleFloorClick}>
      <planeGeometry args={[map.width, map.height]} />
      <meshStandardMaterial color="#666760" roughness={0.92} metalness={0.02} />
    </mesh>
    {map.showGrid && <BattlefieldGrid width={map.width} height={map.height} />}
    <group>
      <mesh position={[0, 0.75, -map.height / 2]} castShadow receiveShadow><boxGeometry args={[map.width + 0.3, 1.5, 0.3]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
      <mesh position={[-map.width / 2, 0.75, -map.height / 4]} castShadow receiveShadow><boxGeometry args={[0.3, 1.5, map.height / 2]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
      <mesh position={[map.width / 2, 0.75, map.height / 4]} castShadow receiveShadow><boxGeometry args={[0.3, 1.5, map.height / 2]} /><meshStandardMaterial color="#4a4943" roughness={0.88} /></mesh>
    </group>
    {combatants.map((combatant) => {
      const position = map.tokens[String(combatant.id)]
      return position && <Token key={combatant.id} combatant={combatant} position={position} map={map} selected={combatant.id === selectedId} active={combatant.id === activeId} showLabel={map.showLabels} onSelect={() => onSelectToken(combatant.id)} />
    })}
    <OrbitControls ref={controlsRef} makeDefault enableDamping dampingFactor={0.08} minDistance={7} maxDistance={35} maxPolarAngle={Math.PI / 2.08} target={[0, 0, 0]} mouseButtons={{ LEFT: 0, MIDDLE: 2, RIGHT: 2 }} />
  </>
}

export default function BattleMap3D(props: BattleMap3DProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null)
  const resetCamera = () => controlsRef.current?.reset()

  return <section className="tabletop-shell">
    <aside className="tabletop-panel tabletop-roster">
      <span className="eyebrow">CURRENT ENCOUNTER</span><h2>Round {props.round}</h2>
      <div className="map-initiative-list">{props.combatants.map((combatant) => <button key={combatant.id} className={`${combatant.id === props.selectedId ? 'selected' : ''} ${combatant.id === props.activeId ? 'active' : ''}`} onClick={() => props.onSelectToken(combatant.id)}><span className={`map-token-dot ${combatant.side}`} /><span><strong>{combatant.name}</strong><small>Initiative {combatant.initiative}</small></span>{(!props.playerId || combatant.ownerId === props.playerId) && <em>{combatant.hp}/{combatant.maxHp} HP</em>}</button>)}</div>
      {!props.combatants.length && <p className="map-empty">Add combatants in the tracker to place tokens.</p>}
    </aside>
    <div className="battlefield-wrap">
      <div className="battlefield-help"><LocateFixed size={15} /> {props.canMove === false ? 'Select a token to inspect · camera remains available' : 'Select a token, then click a square to move'}</div>
      <Canvas frameloop="demand" shadows camera={{ position: [12, 14, 12], fov: 42, near: 0.1, far: 100 }}>
        <Suspense fallback={null}><BattlefieldScene {...props} controlsRef={controlsRef} /></Suspense>
      </Canvas>
    </div>
    <aside className="tabletop-panel tabletop-controls">
      <span className="eyebrow">MAP CONTROLS</span><h2>Battlefield</h2>
      <button onClick={resetCamera}><RotateCcw size={16} /> Reset camera</button>
      {props.showSharedControls !== false && <><button disabled={props.canMove === false} onClick={props.onToggleGrid}>{props.map.showGrid ? <EyeOff size={16} /> : <Eye size={16} />} {props.map.showGrid ? 'Hide grid' : 'Show grid'}</button>
      <button disabled={props.canMove === false} onClick={props.onToggleLabels}>{props.map.showLabels ? <EyeOff size={16} /> : <Eye size={16} />} {props.map.showLabels ? 'Hide labels' : 'Show labels'}</button></>}
      <div className="map-guide"><strong>Camera</strong><span>Drag to rotate</span><span>Right-drag to pan</span><span>Scroll to zoom</span><strong>Scale</strong><span>1 square = {props.map.gridSizeFeet} feet</span><span>{props.map.width} × {props.map.height} squares</span></div>
      {props.showSharedControls !== false && <button className="return-button" onClick={props.onReturnToTracker}><ChevronLeft size={16} /> Encounter tracker</button>}
    </aside>
  </section>
}
