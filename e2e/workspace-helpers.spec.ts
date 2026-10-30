import {test,expect} from '@playwright/test'
import {projectBattlefield} from './workspace-helpers'

test('battlefield projection waits for a visible canvas to acquire its live renderer and controls',async({page})=>{
 await page.route('**/renderer-readiness',route=>route.fulfill({contentType:'text/html',body:'<div class="battlefield-wrap"><canvas width="320" height="240" style="display:block"></canvas></div>'}))
 await page.route('**/fixtures/@react-three_fiber.js*',route=>route.fulfill({contentType:'text/javascript',body:`export const _roots=new(class extends Map{get(node){window.battlefieldLookups=(window.battlefieldLookups||0)+1;return super.get(node)}})()`}))
 await page.goto('/renderer-readiness')
 // Leave an older module in the performance log, as Vite optimization can do.
 await page.evaluate(async()=>{for(const resource of ['/fixtures/@react-three_fiber.js?v=old','/fixtures/@react-three_fiber.js?v=current'])await import(resource)})
 const lookups=()=>page.evaluate(()=>Number(Reflect.get(window,'battlefieldLookups')??0))
 let resolved=false
 const projection=projectBattlefield(page,{x:0,y:0,z:0}).then(point=>{resolved=true;return point})
 await expect.poll(lookups).toBeGreaterThan(0)
 expect(resolved).toBe(false)
 const previous=await lookups()
 await page.evaluate(async()=>{
  const resource='/fixtures/@react-three_fiber.js?v=current',module=await import(resource)
  const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
  const state={internal:{active:true},controls:null,size:{width:320,height:240},camera:{updateMatrixWorld(){},matrixWorldInverse:{elements:identity},projectionMatrix:{elements:identity}}}
  Reflect.set(window,'battlefieldState',state)
  module._roots.set(document.querySelector('canvas'),{store:{getState:()=>state}})
 })
 await expect.poll(lookups).toBeGreaterThan(previous)
 expect(resolved).toBe(false)
 const beforeResize=await lookups()
 await page.evaluate(()=>{const state=Reflect.get(window,'battlefieldState');state.controls={};state.size={width:0,height:0}})
 await expect.poll(lookups).toBeGreaterThan(beforeResize)
 expect(resolved).toBe(false)
 await page.evaluate(()=>{Reflect.get(window,'battlefieldState').size={width:320,height:240}})
 const point=await projection,box=(await page.locator('canvas').boundingBox())!
 expect(point).toEqual({x:box.x+box.width/2,y:box.y+box.height/2})
})
