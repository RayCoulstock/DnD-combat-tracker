import { Component, memo, useEffect, useState, type ReactNode } from 'react'
import { Html } from '@react-three/drei'
import { Box3, Vector3, type Group } from 'three'
import type { Calibration } from '../shared/architecture'
import { cloneModelInstance, miniatureModels } from './modelResources'
interface Transform { scale:number; rotation:number; verticalOffset:number }
class ModelBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
  state={failed:false}
  static getDerivedStateFromError(){return{failed:true}}
  render(){return this.state.failed?this.props.fallback:this.props.children}
}
const LoadedModel=memo(function LoadedModel({url,transform,fallback,kind,ghost,selected,architecture}:{url:string;transform:Transform;fallback:ReactNode;kind:'miniature'|'scenery'|'wall'|'door';ghost:boolean;selected:boolean;architecture?:Calibration}){
  const[result,setResult]=useState<{url:string;model?:Group;error?:string;centre?:[number,number,number];size?:[number,number,number]}|null>(null),[retry,setRetry]=useState(0)
  const calibrationKey=JSON.stringify(architecture)
  useEffect(()=>{
    let stopped=false,instance:Group|undefined,dispose:(()=>void)|undefined
    const lease=miniatureModels.acquire(url)
    void lease.promise.then(source=>{
      if(stopped)return
      const cloned=cloneModelInstance(source,ghost,calibrationKey ? JSON.parse(calibrationKey) : undefined);instance=cloned.root;dispose=cloned.dispose
      const bounds=new Box3().setFromObject(instance),size=bounds.getSize(new Vector3()).toArray(),centre=bounds.getCenter(new Vector3()).toArray()
      setResult({url,model:instance,size,centre})
    }).catch(error=>{if(!stopped)setResult({url,error:error.message})})
    return()=>{stopped=true;dispose?.();lease.release()}
  },[url,retry,ghost,calibrationKey])
  const model=result?.url===url?result.model:undefined,error=result?.url===url?result.error:undefined
  return <>
    {model?<group rotation={[0,transform.rotation*Math.PI/180,0]} scale={transform.scale} position={[0,transform.verticalOffset,0]}><primitive object={model} dispose={null}/>{selected&&<mesh position={result!.centre} scale={result!.size}><boxGeometry/><meshBasicMaterial color="#70c8ff" wireframe depthTest={false}/></mesh>}</group>:fallback}
    {model&&!ghost&&<Html style={{pointerEvents:'none'}}><span className="visually-hidden" {...{[`data-${kind}-state`]:'ready'}}>3D {kind} ready</span></Html>}
    {!model&&<Html position={[0,.8,0]} center style={ghost?{pointerEvents:'none'}:undefined}><span className="token-label" role={error?'alert':'status'} title={error}><span>{error?'Model unavailable':`Loading ${kind}…`}</span>{error&&<span className="model-error-detail">{error}</span>}{error&&!ghost&&<button onClick={e=>{e.stopPropagation();setResult(null);setRetry(n=>n+1)}}>Retry model</button>}</span></Html>}
  </>
})
export default function SharedModel3D({url,transform,fallback,unavailable=false,kind='scenery',ghost=false,selected=false,architecture}:{url:string;transform:Transform;fallback:ReactNode;unavailable?:boolean;kind?:'miniature'|'scenery'|'wall'|'door';ghost?:boolean;selected?:boolean;architecture?:Calibration}){
  const failed=<>{fallback}<Html position={[0,.8,0]} center style={{pointerEvents:'none'}}><span className="token-label" role="status">Model unavailable</span></Html></>
  return unavailable?failed:<ModelBoundary key={url} fallback={failed}><LoadedModel url={url} transform={transform} fallback={fallback} kind={kind} ghost={ghost} selected={selected} architecture={architecture}/></ModelBoundary>
}
