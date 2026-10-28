import test from 'node:test'
import assert from 'node:assert/strict'
import { loadFloorTexture, floorImageUrl } from '../src/floorImageResources.ts'
test('floor texture loads use session cookies, respect GPU limits, and release decoded/GPU resources',async t=>{
  let closed=0,decoded=0,credentials:RequestCredentials|undefined
  const previous=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap')
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async(_blob:Blob,options:ImageBitmapOptions)=>{decoded++;assert.equal(options.imageOrientation,'flipY');return {width:options.resizeWidth??4096,height:options.resizeHeight??2048,close(){closed++}}}})
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'createImageBitmap',previous);else Reflect.deleteProperty(globalThis,'createImageBitmap')})
  t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{credentials=options.credentials;return new Response(new Blob(['pixels']))})
  const url=floorImageUrl('image','dm',{campaignId:'campaign',encounterId:'encounter'})
  assert.match(url,/campaignId=campaign&encounterId=encounter#dm/)
  const resource=await loadFloorTexture(JSON.stringify([url,2048]),new AbortController().signal)
  assert.equal(credentials,'same-origin');assert.equal(decoded,2);assert.equal(closed,1)
  assert.equal(resource.value.image.width,2048);assert.equal(resource.value.image.height,1024)
  assert.equal(resource.value.flipY,false);assert.equal(resource.value.generateMipmaps,false)
  let disposed=0;resource.value.addEventListener('dispose',()=>disposed++)
  resource.dispose();assert.equal(disposed,1);assert.equal(closed,2)
})
test('texture failures are actionable and aborted decodes close their bitmap',async t=>{
  t.mock.method(globalThis,'fetch',async()=>new Response('',{status:503}))
  await assert.rejects(loadFloorTexture(JSON.stringify(['/file',4096]),new AbortController().signal),/HTTP 503/)
  t.mock.method(globalThis,'fetch',async()=>new Response(new Blob(['pixels'])))
  const controller=new AbortController();let closed=0
  const previous=Object.getOwnPropertyDescriptor(globalThis,'createImageBitmap')
  Object.defineProperty(globalThis,'createImageBitmap',{configurable:true,value:async()=>{controller.abort();return {width:8,height:8,close(){closed++}}}})
  t.after(()=>{if(previous)Object.defineProperty(globalThis,'createImageBitmap',previous);else Reflect.deleteProperty(globalThis,'createImageBitmap')})
  await assert.rejects(loadFloorTexture(JSON.stringify(['/file',4096]),controller.signal),{name:'AbortError'})
  assert.equal(closed,1)
})
