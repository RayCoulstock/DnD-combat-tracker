import {z} from 'zod'
import {repeatingTextureSchema,type RepeatingTexture} from './floor-surface.ts'
export const terrainLimits={strokes:128,points:256,layers:4,pixelsPerSquare:8} as const
export const terrainBrushSchema=z.object({size:z.number().finite().min(.5).max(12).default(2),opacity:z.number().finite().min(.05).max(1).default(1),softness:z.number().finite().min(0).max(1).default(.5)}).strict()
const common={id:z.uuid(),points:z.array(z.object({x:z.number().finite().min(0).max(50),z:z.number().finite().min(0).max(50)}).strict()).min(1).max(terrainLimits.points),brush:terrainBrushSchema}
export const terrainStrokeSchema=z.discriminatedUnion('kind',[z.object({...common,kind:z.literal('paint'),texture:repeatingTextureSchema}).strict(),z.object({...common,kind:z.literal('erase')}).strict()])
export type TerrainStroke=z.infer<typeof terrainStrokeSchema>
export type TerrainBrush=z.infer<typeof terrainBrushSchema>
export const terrainTextureKey=(texture:RepeatingTexture)=>JSON.stringify(texture)
export const terrainPaintSchema=z.array(terrainStrokeSchema).max(terrainLimits.strokes).superRefine((strokes,ctx)=>{
 if(new Set(strokes.map(s=>s.id)).size!==strokes.length)ctx.addIssue({code:'custom',message:'Terrain stroke IDs must be unique.'})
 if(new Set(strokes.flatMap(s=>s.kind==='paint'?[terrainTextureKey(s.texture)]:[])).size>terrainLimits.layers)ctx.addIssue({code:'custom',message:'A floor supports at most four terrain texture settings. Clear terrain to change its palette.'})
})
export const terrainImageIds=(strokes?:TerrainStroke[])=>[...new Set((strokes??[]).flatMap(s=>s.kind==='paint'&&!s.texture.assetId.startsWith('builtin:')?[s.texture.assetId]:[]))]
export function brushCoverage(distance:number,brush:TerrainBrush){const radius=brush.size/2;if(distance>radius)return 0;if(!brush.softness)return 1;const t=Math.min(1,Math.max(0,(radius-distance)/(radius*brush.softness)));return t*t*(3-2*t)}
// CPU masks are bounded by map dimensions, not image resolution. No per-pointer raster work.
export class TerrainRaster {
 readonly width:number;readonly height:number
 private keys:string[]=[]
 private weights=new Map<string,{texture:RepeatingTexture;weight:Float32Array}>()
 constructor(readonly squaresWide:number,readonly squaresHigh:number){this.width=squaresWide*terrainLimits.pixelsPerSquare;this.height=squaresHigh*terrainLimits.pixelsPerSquare}
 update(strokes:TerrainStroke[]){
  const keys=strokes.map(s=>JSON.stringify(s)),append=this.keys.length<=keys.length&&this.keys.every((k,i)=>k===keys[i]),start=append?this.keys.length:0
  if(!append)this.weights.clear()
  const resolution=terrainLimits.pixelsPerSquare,pixels=this.width*this.height
  for(const stroke of strokes.slice(start)){
   const coverage=new Float32Array(pixels),radius=stroke.brush.size/2
   for(let i=0;i<stroke.points.length;i++){
    const a=stroke.points[Math.max(0,i-1)],b=stroke.points[i],dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz
    const minX=Math.max(0,Math.floor((Math.min(a.x,b.x)-radius)*resolution)),maxX=Math.min(this.width-1,Math.ceil((Math.max(a.x,b.x)+radius)*resolution)),minZ=Math.max(0,Math.floor((Math.min(a.z,b.z)-radius)*resolution)),maxZ=Math.min(this.height-1,Math.ceil((Math.max(a.z,b.z)+radius)*resolution))
    for(let z=minZ;z<=maxZ;z++)for(let x=minX;x<=maxX;x++){const px=(x+.5)/resolution,pz=(z+.5)/resolution,t=length?Math.max(0,Math.min(1,((px-a.x)*dx+(pz-a.z)*dz)/length)):0,distance=Math.hypot(px-a.x-t*dx,pz-a.z-t*dz),index=z*this.width+x;coverage[index]=Math.max(coverage[index],brushCoverage(distance,stroke.brush)*stroke.brush.opacity)}
   }
   let target:Float32Array|undefined
   if(stroke.kind==='paint'){const key=terrainTextureKey(stroke.texture);if(!this.weights.has(key))this.weights.set(key,{texture:stroke.texture,weight:new Float32Array(pixels)});target=this.weights.get(key)!.weight}
   for(let i=0;i<pixels;i++){const alpha=coverage[i];if(!alpha)continue;for(const layer of this.weights.values())layer.weight[i]*=1-alpha;if(target)target[i]+=alpha}
  }
  this.keys=keys
  const layers=[...this.weights.values()]
  return layers.map((layer,index)=>{
   const rgba=new Uint8Array(pixels*4)
   for(let p=0;p<pixels;p++){let denominator=1;for(let j=index+1;j<layers.length;j++)denominator-=layers[j].weight[p];const alpha=denominator>1e-7?Math.min(1,layer.weight[p]/denominator):0;rgba[p*4]=255;rgba[p*4+1]=Math.round(alpha*255);rgba[p*4+2]=255;rgba[p*4+3]=255}
   return {texture:layer.texture,rgba,weight:layer.weight}
  })
 }
}
