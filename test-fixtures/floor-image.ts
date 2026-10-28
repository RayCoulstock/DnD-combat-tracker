import sharp from 'sharp'
// Distinct quadrants make rotations/mirroring visible without any external image.
export async function makeFloorImage(format:'png'|'jpeg'|'webp'='png',width=128,height=64){
  const pixels=Buffer.alloc(width*height*3)
  const colors=[[220,25,25],[25,200,25],[25,25,220],[220,200,25]]
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const color=colors[(y>=height/2?2:0)+(x>=width/2?1:0)]
    pixels.set(color,(y*width+x)*3)
  }
  return sharp(pixels,{raw:{width,height,channels:3}}).toFormat(format).toBuffer()
}
