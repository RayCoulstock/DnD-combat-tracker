import {fogResolution,maskLength} from './fog.ts'
export interface FogPoint {x:number;z:number}
export type FogMode='reveal'|'conceal'
export type FogShape='brush'|'rectangle'|'polygon'
const cross=(a:FogPoint,b:FogPoint,c:FogPoint)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x)
const onSegment=(a:FogPoint,b:FogPoint,p:FogPoint)=>Math.abs(cross(a,b,p))<1e-8&&p.x>=Math.min(a.x,b.x)-1e-8&&p.x<=Math.max(a.x,b.x)+1e-8&&p.z>=Math.min(a.z,b.z)-1e-8&&p.z<=Math.max(a.z,b.z)+1e-8
function intersects(a:FogPoint,b:FogPoint,c:FogPoint,d:FogPoint){return cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0||onSegment(a,b,c)||onSegment(a,b,d)||onSegment(c,d,a)||onSegment(c,d,b)}
export function validateFogPolygon(points:FogPoint[],width:number,height:number){
 if(points.length<3||points.length>64)throw new Error('Use between 3 and 64 polygon vertices.')
 if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)||p.x<0||p.z<0||p.x>width||p.z>height))throw new Error('Keep polygon vertices inside the floor.')
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[(i+1)%points.length]
  if(Math.hypot(a.x-b.x,a.z-b.z)<1e-6)throw new Error('Polygon vertices must be distinct.')
  for(let j=i+1;j<points.length;j++){if(j===i+1||i===0&&j===points.length-1)continue;if(intersects(a,b,points[j],points[(j+1)%points.length]))throw new Error('Polygon edges must not cross or touch. Undo a vertex to correct the outline.')}
 }
 const area=points.reduce((sum,p,i)=>sum+p.x*points[(i+1)%points.length].z-p.z*points[(i+1)%points.length].x,0)
 if(Math.abs(area)<1e-6)throw new Error('Polygon must enclose an area.')
}
export function insideFogPolygon(p:FogPoint,points:FogPoint[]){
 let inside=false
 for(let i=0,j=points.length-1;i<points.length;j=i++){
  const a=points[i],b=points[j];if(onSegment(a,b,p))return true
  if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside
 }
 return inside
}
// A draft is bounded by floor size, regardless of gesture duration or sample count.
export class FogMaskDraft{
 private readonly digits:Uint8Array
 constructor(readonly width:number,readonly height:number,mask=''){
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<4||width>50||height<4||height>50)throw new Error('Invalid fog floor dimensions.')
  if(mask&&(mask.length!==maskLength(width,height)||!/^[0-9a-f]+$/.test(mask)))throw new Error('Invalid fog mask.')
  this.digits=Uint8Array.from({length:maskLength(width,height)},(_,i)=>parseInt(mask[i]??'0',16))
 }
 private paint(minX:number,minZ:number,maxX:number,maxZ:number,mode:FogMode,contains:(p:FogPoint)=>boolean){
  if(![minX,minZ,maxX,maxZ].every(Number.isFinite))throw new Error('Invalid fog coordinates.')
  const r=fogResolution,stride=this.width*r
  for(let z=Math.max(0,Math.floor(minZ*r));z<Math.min(this.height*r,Math.ceil(maxZ*r));z++)for(let x=Math.max(0,Math.floor(minX*r));x<Math.min(stride,Math.ceil(maxX*r));x++){
   if(!contains({x:(x+.5)/r,z:(z+.5)/r}))continue
   const index=z*stride+x,digit=Math.floor(index/4),bit=1<<(index%4)
   this.digits[digit]=mode==='reveal'?this.digits[digit]|bit:this.digits[digit]&~bit
  }
 }
 brush(a:FogPoint,b:FogPoint,radius:number,mode:FogMode){
  if(!Number.isFinite(radius)||radius<.25||radius>12)throw new Error('Brush radius must be between 0.25 and 12 squares.')
  const dx=b.x-a.x,dz=b.z-a.z,length=dx*dx+dz*dz
  this.paint(Math.min(a.x,b.x)-radius,Math.min(a.z,b.z)-radius,Math.max(a.x,b.x)+radius,Math.max(a.z,b.z)+radius,mode,p=>{const t=length?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/length)):0;return (p.x-a.x-t*dx)**2+(p.z-a.z-t*dz)**2<=radius**2})
 }
 rectangle(a:FogPoint,b:FogPoint,mode:FogMode){const x=Math.min(a.x,b.x),z=Math.min(a.z,b.z),x1=Math.max(a.x,b.x),z1=Math.max(a.z,b.z);this.paint(x,z,x1,z1,mode,p=>p.x>=x&&p.x<x1&&p.z>=z&&p.z<z1)}
 polygon(points:FogPoint[],mode:FogMode){validateFogPolygon(points,this.width,this.height);this.paint(Math.min(...points.map(p=>p.x)),Math.min(...points.map(p=>p.z)),Math.max(...points.map(p=>p.x)),Math.max(...points.map(p=>p.z)),mode,p=>insideFogPolygon(p,points))}
 serialize(){return Array.from(this.digits,n=>n.toString(16)).join('')}
}
export const sameFogMask=(a:string,b:string)=>(/^0*$/.test(a)?'':a)===(/^0*$/.test(b)?'':b)
