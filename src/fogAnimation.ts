import {fogResolution,type FogOfWar,fogCinematicDefaults} from '../shared/fog'

// One bounded field, retargeted from its current appearance. No retained masks or queue.
export class FogAnimation {
 readonly pixels:Uint8Array
 private readonly distances:Float32Array
 private target:Uint8Array
 private from:Uint8Array
 private encoded?:string
 private softness=-1
 private revision=-1
 private started=0
 private duration=0
 constructor(readonly width:number,readonly height:number){
  const n=width*height*fogResolution*fogResolution
  this.pixels=new Uint8Array(n*4);this.target=new Uint8Array(n);this.from=new Uint8Array(n);this.distances=new Float32Array(n)
 }
 progress(now:number){const t=this.duration?Math.max(0,Math.min(1,(now-this.started)/this.duration)):1;return t*t*(3-2*t)}
 update(fog:FogOfWar,id:string,reduced:boolean,overlay:boolean,now=Date.now()){
  const encoded=fog.floors[id]??'',softness=fog.appearance.edgeSoftness,settings=fog.cinematic??fogCinematicDefaults
  const changed=encoded!==this.encoded||softness!==this.softness,first=this.revision===-1
  const animate=!first&&!overlay&&!reduced&&settings.enabled&&settings.durationMs>0&&fog.revision!==this.revision&&Boolean(fog.transition)
  if(!changed){if(reduced||overlay||!settings.enabled||!settings.durationMs){this.duration=0}this.revision=fog.revision;return false}
  const progress=this.progress(now)
  for(let i=0;i<this.from.length;i++)this.from[i]=Math.round(this.from[i]+(this.target[i]-this.from[i])*progress)
  const w=this.width*fogResolution,h=this.height*fogResolution,n=w*h,dist=this.distances
  // Chamfer distance is computed only at commits/settings changes, never per frame.
  for(let i=0;i<n;i++){const revealed=Boolean(parseInt(encoded[Math.floor(i/4)]??'0',16)&(1<<(i%4)));this.pixels[i*4]=revealed?0:255;dist[i]=revealed?1e6:0}
  const diagonal=Math.SQRT2
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=y*w+x;let d=dist[i];if(x)d=Math.min(d,dist[i-1]+1);if(y)d=Math.min(d,dist[i-w]+1);if(x&&y)d=Math.min(d,dist[i-w-1]+diagonal);if(y&&x<w-1)d=Math.min(d,dist[i-w+1]+diagonal);dist[i]=d}
  for(let y=h-1;y>=0;y--)for(let x=w-1;x>=0;x--){const i=y*w+x;let d=dist[i];if(x<w-1)d=Math.min(d,dist[i+1]+1);if(y<h-1)d=Math.min(d,dist[i+w]+1);if(x<w-1&&y<h-1)d=Math.min(d,dist[i+w+1]+diagonal);if(x&&y<h-1)d=Math.min(d,dist[i+w-1]+diagonal);dist[i]=d}
  this.duration=animate?Math.max(0,Math.min(settings.durationMs,(fog.transition?.startedAt??now)+settings.durationMs-now)):0;this.started=now
  for(let i=0;i<n;i++){
   const hidden=this.pixels[i*4]===255
   this.target[i]=hidden?255:softness?Math.round(255*Math.max(0,1-(dist[i]-.5)/(softness*3))):0
   // Concealment is immediate. Softness is presentation only and cannot authorize pixels.
   if(hidden||!this.duration)this.from[i]=this.target[i]
   this.pixels[i*4+1]=this.target[i];this.pixels[i*4+2]=this.from[i];this.pixels[i*4+3]=255
  }
  this.encoded=encoded;this.softness=softness;this.revision=fog.revision;return true
 }
}
