import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import {maskedFloorImage} from './fog-image.ts'
import {initialFog,fullMask} from '../shared/fog.ts'
import {floorImageSchema} from '../shared/floor-image.ts'
test('masked battle-map raster contains no concealed pixels and respects calibrated UVs',async()=>{
 const source=await sharp({create:{width:64,height:64,channels:4,background:'#ff3300'}}).png().toBuffer(),image=floorImageSchema.parse({imageId:'00000000-0000-4000-8000-000000000001'}),fog=initialFog()
 const hidden=await sharp(await maskedFloorImage(source,image,fog,'ground',4,4)).raw().toBuffer();assert.ok(hidden.every(b=>b===0))
 fog.floors.ground=fullMask(4,4)
 const revealed=await sharp(await maskedFloorImage(source,image,fog,'ground',4,4)).raw().toBuffer();assert.equal(revealed[0],255);assert.equal(revealed[1],51);assert.equal(revealed[3],255)
 const digits=fullMask(4,4).split('');for(let row=0;row<16;row++)for(let col=2;col<4;col++)digits[row*4+col]='0';fog.floors.ground=digits.join('')
 const partial=await sharp(await maskedFloorImage(source,image,fog,'ground',4,4)).raw().toBuffer()
 for(let z=0;z<64;z++)for(let x=0;x<64;x++){const offset=(z*64+x)*4;assert.equal(partial[offset+3],x<32?255:0);if(x>=32)assert.equal(partial[offset],0)}
 const offset=await sharp(await maskedFloorImage(source,{...image,offsetX:20},fog,'ground',4,4)).raw().toBuffer();assert.ok(offset.every(b=>b===0))
})
