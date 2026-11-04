import {DataTexture,LinearFilter,RGBAFormat} from 'three'
export function terrainMaskTexture(bytes:Uint8Array,width:number,height:number){const mask=new DataTexture(bytes,width,height,RGBAFormat);mask.flipY=false;mask.channel=1;mask.minFilter=mask.magFilter=LinearFilter;mask.generateMipmaps=false;mask.needsUpdate=true;return mask}
