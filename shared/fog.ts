import {z} from 'zod'
export const fogResolution=4
const floorId=z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s=>!['__proto__','constructor','prototype'].includes(s))
export const fogSchema=z.object({version:z.literal(1),enabled:z.boolean(),appearance:z.object({colour:z.literal('#000000'),edgeSoftness:z.number().finite().min(0).max(1)}).strict(),floors:z.record(floorId,z.string().max(10000).regex(/^[0-9a-f]*$/)).refine(f=>Object.keys(f).length<=12),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)}).strict()
export type FogOfWar=z.infer<typeof fogSchema>
export const initialFog=():FogOfWar=>({version:1,enabled:true,appearance:{colour:'#000000',edgeSoftness:0},floors:{},revision:0})
export const maskLength=(width:number,height:number)=>Math.ceil(width*height*fogResolution*fogResolution/4)
export const fullMask=(width:number,height:number)=>'f'.repeat(maskLength(width,height))
export function sampleRevealed(fog:FogOfWar|undefined,floorId:string,width:number,height:number,x:number,z:number):boolean{
 if(!fog?.enabled)return true
 if(x<0||z<0||x>=width||z>=height)return false
 const mask=fog.floors[floorId];if(!mask)return false
 const index=Math.floor(z*fogResolution)*width*fogResolution+Math.floor(x*fogResolution)
 return Boolean(parseInt(mask[Math.floor(index/4)]??'0',16)&(1<<(index%4)))
}
export function floorRevealed(fog:FogOfWar|undefined,id:string,width:number,height:number){return !fog?.enabled||fog.floors[id]===fullMask(width,height)}
export function regionRevealed(fog:FogOfWar|undefined,id:string,width:number,height:number,minX:number,minZ:number,maxX:number,maxZ:number){
 if(!fog?.enabled)return true
 if(![minX,minZ,maxX,maxZ].every(Number.isFinite)||maxX<minX||maxZ<minZ)return false
 // Geometry may cross the map edge; the off-map extent has no concealed map content.
 const x0=Math.max(0,Math.floor(minX*fogResolution)),z0=Math.max(0,Math.floor(minZ*fogResolution)),x1=Math.min(width*fogResolution,Math.ceil(maxX*fogResolution)),z1=Math.min(height*fogResolution,Math.ceil(maxZ*fogResolution))
 if(x0>=x1||z0>=z1)return false
 for(let z=z0;z<z1;z++)for(let x=x0;x<x1;x++)if(!sampleRevealed(fog,id,width,height,(x+.5)/fogResolution,(z+.5)/fogResolution))return false
 return true
}
