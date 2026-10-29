import {useEffect,useState} from 'react'
import CalibrationFields from './CalibrationFields'
import AssetPreview3D from './AssetPreview3D'
import type {Asset3D} from '../shared/assets'
import type {ArchitecturalVisual,Calibration} from '../shared/architecture'
export default function ArchitectureProperties({visual,asset,kind,onApply,onChoose,api,draftStore,draftKey}:{draftStore?:Map<string,Calibration>;draftKey?:string;visual?:ArchitecturalVisual;asset?:Asset3D;kind:'wall'|'door';onApply:(visual:ArchitecturalVisual|null)=>void;onChoose:()=>void;api?:(path:string)=>Promise<unknown>}){
  const [draft,setDraftValue]=useState(()=>draftKey?draftStore?.get(draftKey)??visual?.calibration:visual?.calibration)
  const setDraft=(value:Calibration)=>{setDraftValue(value);if(draftStore&&draftKey){if(draftStore.size>100)draftStore.clear();draftStore.set(draftKey,value)}}
  const [resolved,setResolved]=useState<Asset3D|null>(null)
  useEffect(()=>{let stopped=false;if(visual&&!asset&&api)void api(`/assets/${visual.assetId}`).then(result=>{if(!stopped)setResolved(result as Asset3D)}).catch(()=>{});return()=>{stopped=true}},[visual,asset,api])
  const previewAsset=asset??(resolved?.id===visual?.assetId?resolved:undefined)
  return <section aria-label={`Selected ${kind} appearance`}><h3>Selected {kind} appearance</h3><p>{visual?`Asset ${visual.assetId}`:'Built-in appearance'}</p><button onClick={onChoose}>Choose selected {kind} asset</button><button disabled={!visual} onClick={()=>onApply(null)}>Use built-in {kind}</button>
    {visual&&draft&&<><CalibrationFields prefix={`Selected ${kind}`} value={draft} onChange={setDraft}/>{previewAsset&&<AssetPreview3D architecturalPreview asset={{...previewAsset,presentation:{...previewAsset.presentation,architecture:{...draft,role:kind}}}} normalize/>}<button onClick={()=>onApply({...visual,calibration:draft})}>Apply selected {kind} calibration</button></>}
  </section>
}
