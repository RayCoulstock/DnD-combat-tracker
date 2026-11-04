import {Color,PlaneGeometry,RepeatWrapping,type Texture} from 'three'
import {repeatingTextureUv,type RepeatingTexture} from '../shared/floor-surface'
export function repeatingTextureView(source:Texture){const copy=source.clone();copy.wrapS=copy.wrapT=RepeatWrapping;copy.needsUpdate=true;return copy}
export function repeatingFloorGeometry(width:number,height:number,pixels:{width:number;height:number},texture:RepeatingTexture){
 const plane=new PlaneGeometry(width,height),positions=plane.attributes.position,uv=plane.attributes.uv
 for(let i=0;i<uv.count;i++){const [u,v]=repeatingTextureUv(positions.getX(i)+width/2,height/2-positions.getY(i),pixels.width,pixels.height,texture);uv.setXY(i,u,v)}return plane
}
export const floorTextureColor=(tint:string,brightness:number)=>new Color(tint).multiplyScalar(brightness)
