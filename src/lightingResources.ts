import type {WebGLRenderer} from 'three'
// R3F's renderer is an imperative resource. Keep its scoped mutation outside
// React component state and restore the previous settings on cleanup.
export function configureLightingRenderer(renderer:WebGLRenderer,exposure:number,shadows:boolean){
 const prior={exposure:renderer.toneMappingExposure,shadows:renderer.shadowMap.enabled};renderer.toneMappingExposure=exposure;renderer.shadowMap.enabled=shadows
 return()=>{renderer.toneMappingExposure=prior.exposure;renderer.shadowMap.enabled=prior.shadows}
}
