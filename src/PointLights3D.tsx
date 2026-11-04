import {useEffect,useRef} from 'react'
import {useFrame,useThree} from '@react-three/fiber'
import {PointLight} from 'three'
import {qualityProfiles,flickerFactor,type LightingQuality,type PointLightSource} from '../shared/lighting'
import {resolveLight} from '../shared/lightingState'
import type {EncounterState} from '../shared/domain'
import type {DungeonMap} from '../shared/dungeon'
function Emitter({source,position,shadow,quality,flicker,revision}:{source:PointLightSource;position:[number,number,number];shadow:boolean;quality:LightingQuality;flicker:boolean;revision:string}){
 const [x,y,z]=position
 const ref=useRef<PointLight>(null),invalidate=useThree(s=>s.invalidate),limit=useThree(s=>s.gl.capabilities.maxTextureSize),size=Math.min(qualityProfiles[quality].pointSize,Math.floor(limit/4))
 useEffect(()=>{const light=ref.current;if(!light)return;const s=light.shadow;s.map?.dispose();s.map=null;s.mapPass?.dispose();s.mapPass=null;s.needsUpdate=true;invalidate();return()=>{s.map?.dispose();s.mapPass?.dispose()}},[size,shadow,invalidate])
 useEffect(()=>{if(ref.current){ref.current.shadow.needsUpdate=true;invalidate()}},[x,y,z,revision,source.radius,invalidate])
 const animate=source.enabled&&source.flicker.enabled&&flicker&&qualityProfiles[quality].flicker
 useEffect(()=>{invalidate()},[animate,source.intensity,source.enabled,invalidate])
 useFrame(state=>{const light=ref.current;if(!light)return;light.intensity=source.enabled?source.intensity*(animate?flickerFactor(source.id,state.clock.elapsedTime,source.flicker.strength,source.flicker.speed):1):0;if(animate)state.invalidate()})
 return <pointLight ref={ref} name={`atmosphere-point:${source.id}`} position={position} color={source.color} intensity={source.enabled?source.intensity:0} distance={source.radius} decay={2} castShadow={shadow} shadow-mapSize={[size,size]} shadow-bias={-.0005} shadow-normalBias={.02} shadow-autoUpdate={true}/>
}
export default function PointLights3D({document,combatants,tokens,activeId,width,height,quality='medium',flicker=true,shadows,editor,pickable,onSelect}:{document:DungeonMap;combatants:Parameters<typeof resolveLight>[1]['combatants'];tokens:EncounterState['battleMap']['tokens'];activeId:string;width:number;height:number;quality?:LightingQuality;flicker?:boolean;shadows:boolean;editor:boolean;pickable:boolean;onSelect?:(id:string)=>void}){
 const state={dungeonMap:document,combatants,battleMap:{tokens}},profile=qualityProfiles[quality],sources=(document.lighting?.sources??[]).map(source=>({source,resolved:resolveLight(source,state)})).filter(l=>l.resolved.floorId===activeId&&l.resolved.placed).sort((a,b)=>Number(b.source.enabled)-Number(a.source.enabled)||a.source.id.localeCompare(b.source.id)),rendered=sources.slice(0,profile.points),revision=JSON.stringify([document.floors,document.walls,document.doors,document.props,document.levels,tokens,combatants.map(c=>[c.id,c.miniature])])
 let shadowCount=0
 return <>{rendered.map(({source,resolved})=>{const level=document.level?.id===activeId||!document.level?document:document.levels?.find(l=>l.id===activeId),y=(level&&'elevationFeet'in level?level.elevationFeet:document.level?.elevationFeet??0)/5,position:[number,number,number]=[resolved.position.x+.5-width/2,y+resolved.position.heightFeet/5,resolved.position.z+.5-height/2],shadow=shadows&&source.enabled&&source.castShadow&&shadowCount++<profile.pointShadows;return <Emitter key={source.id} source={source} position={position} quality={quality} flicker={flicker} shadow={shadow} revision={revision}/>})}{editor&&sources.map(({source,resolved})=>{const level=document.level?.id===activeId||!document.level?document:document.levels?.find(l=>l.id===activeId),y=(level&&'elevationFeet'in level?level.elevationFeet:document.level?.elevationFeet??0)/5;return <mesh key={source.id} name={`light-gizmo:${source.id}`} position={[resolved.position.x+.5-width/2,y+resolved.position.heightFeet/5,resolved.position.z+.5-height/2]} onPointerUp={e=>{if(pickable&&e.button===0&&e.delta<=3){e.stopPropagation();onSelect?.(source.id)}}}><sphereGeometry args={[.16,12,8]}/><meshBasicMaterial color={source.enabled?source.color:'#777777'} wireframe={!source.enabled} depthTest={false}/></mesh>})}</>
}
