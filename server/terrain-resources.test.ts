import test from 'node:test'
import assert from 'node:assert/strict'
import {ClampToEdgeWrapping,LinearFilter,NoColorSpace} from 'three'
import {terrainMaskTexture} from '../src/terrainResources.ts'
test('terrain masks use independent south-growing UV1, linear non-colour data and deterministic disposal',()=>{
 const bytes=new Uint8Array(32*16*4);bytes[1]=128;const mask=terrainMaskTexture(bytes,32,16);assert.equal(mask.channel,1);assert.equal(mask.flipY,false);assert.equal(mask.wrapS,ClampToEdgeWrapping);assert.equal(mask.minFilter,LinearFilter);assert.equal(mask.generateMipmaps,false);assert.equal(mask.colorSpace,NoColorSpace);assert.equal(mask.image.width,32);assert.equal(mask.image.height,16);assert.equal(mask.image.data[1],128);let disposed=0;mask.addEventListener('dispose',()=>disposed++);mask.dispose();assert.equal(disposed,1)
 let allocations=0,disposals=0;for(let i=0;i<50;i++){const current=terrainMaskTexture(new Uint8Array(400*400*4),400,400);allocations++;current.addEventListener('dispose',()=>disposals++);current.dispose()}assert.equal(allocations,disposals)
})
