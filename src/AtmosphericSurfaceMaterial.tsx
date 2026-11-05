import type {ColorRepresentation,Material,Texture} from 'three'
export default function AtmosphericSurfaceMaterial({lit=false,map,color='#ffffff',alphaMap,opacity=1,transparent=false,depthWrite=true,clip=false}:{lit?:boolean;map?:Texture|null;color?:ColorRepresentation;alphaMap?:Texture;opacity?:number;transparent?:boolean;depthWrite?:boolean;clip?:boolean}){
 const onBeforeCompile:Material['onBeforeCompile']=shader=>{if(clip)shader.fragmentShader=shader.fragmentShader.replace('#include <map_fragment>','#include <map_fragment>\nif (any(lessThan(vMapUv, vec2(0.0))) || any(greaterThan(vMapUv, vec2(1.0)))) discard;')}
 const common={map,color,alphaMap,opacity,transparent,depthWrite,onBeforeCompile,customProgramCacheKey:()=>`atmospheric-surface:${clip?'clip':'repeat'}:${lit?'lit':'unlit'}`}
 return lit?<meshStandardMaterial {...common} roughness={1} metalness={0} emissive={color} emissiveMap={map} emissiveIntensity={.12}/>:<meshBasicMaterial {...common} toneMapped={false}/>
}
