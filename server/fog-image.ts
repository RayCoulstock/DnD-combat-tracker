import sharp from 'sharp'
import {floorImageUv,type FloorImage} from '../shared/floor-image.ts'
import {sampleRevealed,type FogOfWar} from '../shared/fog.ts'
// Bounded map-coordinate raster. Never encode an original concealed pixel in the result.
export async function maskedFloorImage(input:Buffer,image:FloorImage,fog:FogOfWar,floorId:string,width:number,height:number){
 const source=await sharp(input).ensureAlpha().raw().toBuffer({resolveWithObject:true})
 const w=width*16,h=height*16,out=Buffer.alloc(w*h*4)
 for(let z=0;z<h;z++)for(let x=0;x<w;x++){
  const gx=(x+.5)/16,gz=(z+.5)/16
  if(!sampleRevealed(fog,floorId,width,height,gx,gz))continue
  const[u,v]=floorImageUv(gx,gz,width,height,source.info.width,source.info.height,image)
  if(u<0||u>=1||v<0||v>=1)continue
  const sx=Math.min(source.info.width-1,Math.floor(u*source.info.width)),sy=Math.min(source.info.height-1,Math.floor((1-v)*source.info.height))
  source.data.copy(out,(z*w+x)*4,(sy*source.info.width+sx)*4,(sy*source.info.width+sx)*4+4)
 }
 return sharp(out,{raw:{width:w,height:h,channels:4}}).png().toBuffer()
}
