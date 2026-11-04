import {configureLightingRenderer} from './lightingResources'
import {useEffect,useRef} from 'react'
import {useThree} from '@react-three/fiber'
import {DirectionalLight} from 'three'
import {qualityProfiles,type LightingEnvironment,type LightingQuality} from '../shared/lighting'
export default function LightingEnvironment3D({environment,configured,quality='medium',offset=[0,0,0],width=20,height=20}:{environment:LightingEnvironment;configured:boolean;quality?:LightingQuality;offset?:[number,number,number];width?:number;height?:number}){
 const gl=useThree(s=>s.gl),invalidate=useThree(s=>s.invalidate),direction=useRef<DirectionalLight>(null),profile=qualityProfiles[quality]
 const [x,y,z]=configured?offset:[0,0,0]
 const size=Math.min(profile.directionalSize,qualityProfiles[environment.shadowQuality].directionalSize,gl.capabilities.maxTextureSize),shadows=environment.shadows&&quality!=='low'
 useEffect(()=>{const restore=configureLightingRenderer(gl,configured?environment.exposure:1,shadows);invalidate();return restore},[gl,invalidate,configured,environment.exposure,shadows])
 useEffect(()=>{const light=direction.current;if(!light)return;const shadow=light.shadow;shadow.map?.dispose();shadow.map=null;shadow.mapPass?.dispose();shadow.mapPass=null;shadow.needsUpdate=true;invalidate();return()=>{shadow.map?.dispose();shadow.mapPass?.dispose()}},[size,shadows,invalidate])
 useEffect(()=>{const light=direction.current;if(light){light.target.position.set(x,y,z);light.target.updateMatrixWorld();light.shadow.camera.updateProjectionMatrix();light.shadow.needsUpdate=true;invalidate()}},[x,y,z,width,height,configured,invalidate])
 return <><ambientLight name="atmosphere-ambient" color={environment.ambientColor} intensity={environment.ambientIntensity}/>{configured&&<ambientLight name="tabletop-visibility-fill" color="#ffffff" intensity={.18}/>}<directionalLight ref={direction} name="atmosphere-directional" color={environment.directionalColor} position={environment.directionalPosition.map((p,i)=>p+([x,y,z][i])) as [number,number,number]} intensity={environment.directionalIntensity} castShadow={shadows} shadow-mapSize={[size,size]} shadow-camera-left={configured?-width/2:-5} shadow-camera-right={configured?width/2:5} shadow-camera-top={configured?height/2:5} shadow-camera-bottom={configured?-height/2:-5} shadow-camera-far={configured?300:500} shadow-bias={configured?-.0005:0} shadow-normalBias={configured?.02:0}/></>
}
