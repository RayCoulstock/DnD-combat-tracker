import test from 'node:test'
import assert from 'node:assert/strict'
import {Texture,ClampToEdgeWrapping,RepeatWrapping,SRGBColorSpace} from 'three'
import {repeatingTextureView,repeatingFloorGeometry,floorTextureColor} from '../src/repeatingTextureResources.ts'
import {repeatingTextureSchema} from '../shared/floor-surface.ts'
import {AssetResourceCache} from '../src/assetResourceCache.ts'
test('repeating floor views share decoded source, preserve sRGB and isolate cached transforms/disposal',()=>{
 const source=new Texture({width:128,height:128});source.colorSpace=SRGBColorSpace
 const first=repeatingTextureView(source),second=repeatingTextureView(source);assert.equal(first.source,second.source);assert.equal(first.source,source.source);assert.equal(first.colorSpace,SRGBColorSpace);assert.equal(first.wrapS,RepeatWrapping);assert.equal(source.wrapS,ClampToEdgeWrapping)
 first.repeat.set(4,5);first.rotation=Math.PI/2;assert.equal(second.repeat.x,1);assert.equal(source.rotation,0)
 let sourceDisposals=0,viewDisposals=0;source.addEventListener('dispose',()=>sourceDisposals++);first.addEventListener('dispose',()=>viewDisposals++);first.dispose();assert.equal(sourceDisposals,0);assert.equal(viewDisposals,1);second.dispose();source.dispose()
})
test('floor plane UVs use physical square coordinates, rectangular aspect, tint and brightness',()=>{
 const settings=repeatingTextureSchema.parse({assetId:'builtin:stone'}),plane=repeatingFloorGeometry(30,10,{width:128,height:128},settings),uv=plane.attributes.uv
 assert.equal(uv.getX(0),0);assert.equal(uv.getY(0),1);assert.equal(uv.getX(1),15);assert.equal(uv.getY(3),-4)
 const rotated=repeatingFloorGeometry(30,10,{width:256,height:128},{...settings,rotation:90});assert.ok(Math.abs(rotated.attributes.uv.getY(1)-31)<1e-6)
 assert.deepEqual(floorTextureColor('#ffffff',.5).toArray(),[.5,.5,.5]);const tint=floorTextureColor('#ff0000',.7);assert.ok(Math.abs(tint.r-.7)<1e-9);assert.equal(tint.g,0)
 plane.dispose();rotated.dispose()
})
test('repeated material switches reuse decoded image leases and evict/dispose bounded idle resources',async()=>{
 let loads=0,disposals=0;const cache=new AssetResourceCache<Texture>(async()=>{loads++;const texture=new Texture({width:128,height:128});return {value:texture,bytes:65536,dispose:()=>{disposals++;texture.dispose()}}},2,131072,1)
 const keeper=cache.acquire('shared');await keeper.promise
 for(let i=0;i<40;i++){const lease=cache.acquire('shared'),source=await lease.promise,view=repeatingTextureView(source);view.dispose();lease.release()}
 assert.equal(loads,1);assert.equal(disposals,0);keeper.release();await new Promise(r=>setTimeout(r,20));assert.equal(disposals,1)
 for(let i=0;i<5;i++){const lease=cache.acquire('other'+i);await lease.promise;lease.release()}await new Promise(r=>setTimeout(r,20));assert.equal(loads,6);assert.equal(disposals,6)
})
