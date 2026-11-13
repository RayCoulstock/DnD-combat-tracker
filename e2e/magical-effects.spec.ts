import {test,expect,type Page} from '@playwright/test'
import {blankDungeon} from '../shared/dungeon'
import {createEffect,magicalEffectPresetIds} from '../shared/environmentalEffects'
import {initialFog} from '../shared/fog'
import {lightAppearanceSchema,legacyEnvironment} from '../shared/lighting'
import {randomUUID} from 'node:crypto'
import {makeTexturedGlb} from '../test-fixtures/glb'
import {multiplayerMode,openSetup,sessionAction} from './shell-helpers'
import {mapAction} from './workspace-helpers'
async function scene(page:Page){return page.locator('canvas:visible').evaluate(async node=>{
 for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){
 const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue
 const list:{name:string;kind:string;style:string;radius?:number;time?:number;alpha?:number;pulse?:number;secondary?:number;segments?:number;ribbons?:number;depthTest:boolean;depthWrite:boolean}[]=[],lights:{name:string;intensity:number}[]=[]
 s.scene.traverse((o:{name:string;isPointLight?:boolean;intensity:number;userData:{renderer:string;style:string;segments?:number;ribbons?:number};material:{depthTest:boolean;depthWrite:boolean;uniforms?:Record<string,{value:number}>}})=>{if(o.name.startsWith('environmental-effect:')||o.name.startsWith('effect-secondary:')){const u=o.material.uniforms??{};list.push({name:o.name,kind:o.userData.renderer,style:o.userData.style,radius:u.radius?.value,time:u.time?.value,alpha:u.alpha?.value,pulse:u.pulse?.value,secondary:u.secondary?.value,segments:o.userData.segments,ribbons:o.userData.ribbons,depthTest:o.material.depthTest,depthWrite:o.material.depthWrite})}if(o.isPointLight)lights.push({name:o.name,intensity:o.intensity})})
 return {list,lights,memory:s.gl.info.memory,render:s.gl.info.render,uuid:s.scene.uuid,camera:s.camera.uuid}
 }return {list:[],lights:[],memory:{geometries:0,textures:0},render:{calls:0,triangles:0,points:0},uuid:'',camera:''}
})}
async function load(page:Page,map:unknown){await page.goto('/');const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'magic.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:3,combatants:[],dungeonMap:map}))});await page.getByRole('button',{name:'Map editor',exact:true}).click()}
test('all magical adapters render at bounded quality with no shader errors and stable reduced-motion samples',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(m.text()))errors.push(m.text())})
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'})
 const effects=magicalEffectPresetIds.map((id,i)=>createEffect(id,id,'ground',{x:4+(i%5)*5,z:4+Math.floor(i/5)*6,heightFeet:0}))
 await load(page,{...blankDungeon('gallery','Magical gallery',30,30),environmentalEffects:{version:1,effects}})
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(18)
 const base=await scene(page);expect(base.list.filter(e=>e.kind==='portal'&&e.name.startsWith('environmental-effect:')).length).toBe(3);expect(base.list.filter(e=>e.kind==='liquid').length).toBe(4);expect(base.list.every(e=>e.depthTest&&!e.depthWrite)).toBe(true)
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'Low quality',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('effect-secondary:')).length).toBe(0)
 expect((await scene(page)).list.find(e=>e.style==='arcs')).toMatchObject({segments:16,ribbons:2})
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'High quality',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('effect-secondary:')).length).toBe(5)
 expect((await scene(page)).list.find(e=>e.style==='arcs')).toMatchObject({segments:48,ribbons:7})
 const time=(await scene(page)).list.find(e=>e.name==='environmental-effect:fey-portal')!.time;await page.getByRole('button',{name:'Zoom in',exact:true}).click();expect((await scene(page)).list.find(e=>e.name==='environmental-effect:fey-portal')!.time).toBe(time)
 const staticResources=(await scene(page)).memory.geometries
 await page.emulateMedia({reducedMotion:'no-preference'});await expect.poll(async()=>(await scene(page)).list.find(e=>e.name==='environmental-effect:fey-portal')!.time).toBeGreaterThan(0)
 expect((await scene(page)).memory.geometries).toBe(staticResources);expect((await scene(page)).list.find(e=>e.name==='environmental-effect:fey-portal')!.radius).toBe(1.2)
 await page.emulateMedia({reducedMotion:'reduce'});await expect.poll(async()=>(await scene(page)).list.find(e=>e.name==='environmental-effect:fey-portal')!.time).toBe(0)
 await page.getByRole('button',{name:'Top-down',exact:true}).click();expect((await scene(page)).uuid).toBe(base.uuid)
 await page.getByRole('button',{name:'Reset camera',exact:true}).click();await page.getByRole('button',{name:'Hide map inspector',exact:true}).click()
 console.log('Magical gallery High',JSON.stringify({render:(await scene(page)).render,memory:(await scene(page)).memory}))
 await page.screenshot({path:'work/6.3c-gallery.png'});expect(errors).toEqual([])
})
test('portal surface inspector, linked light, duplication, cleanup and fullscreen preserve the live scene',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await load(page,blankDungeon('portal','Portal',20,20))
 await page.getByRole('button',{name:'Effects tool',exact:true}).click();const library=page.getByRole('region',{name:'Effects library',exact:true});await library.getByLabel('Effect category',{exact:true}).selectOption('Magical');await library.getByLabel('Effect preset',{exact:true}).selectOption('fey-portal');await library.getByRole('button',{name:'Add Fey portal at level centre',exact:true}).click()
 const props=page.getByRole('region',{name:'Effect properties',exact:true});await props.getByLabel('Effect surface radius',{exact:true}).fill('2');await props.getByLabel('Effect pulse',{exact:true}).fill('.6');await props.getByLabel('Effect opacity',{exact:true}).fill('.5');await props.getByLabel('Effect secondary colour',{exact:true}).fill('#ff77cc');await props.getByRole('button',{name:'Apply effect',exact:true}).click()
 await expect.poll(async()=>(await scene(page)).list.find(e=>e.kind==='portal'&&e.name.startsWith('environmental-effect:'))).toMatchObject({radius:2,pulse:.6,alpha:.5})
 const light=page.getByRole('region',{name:'Effect lighting',exact:true});await light.getByLabel('Emit light',{exact:true}).check();await light.getByLabel('Effect light intensity',{exact:true}).fill('7');await light.getByRole('button',{name:'Apply effect light',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.find(l=>l.name.startsWith('atmosphere-point:'))?.intensity).toBe(7)
 const base=await scene(page);await props.getByRole('button',{name:'Duplicate effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.kind==='portal'&&e.name.startsWith('environmental-effect:')).length).toBe(2)
 await props.getByRole('button',{name:'Delete effect',exact:true}).click();await page.getByRole('dialog',{name:'Delete effect',exact:true}).getByRole('button',{name:'Delete effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.kind==='portal'&&e.name.startsWith('environmental-effect:')).length).toBe(1);await expect.poll(async()=>(await scene(page)).memory.geometries).toBeLessThanOrEqual(base.memory.geometries)
 await mapAction(page,'Browser fullscreen');await expect.poll(()=>page.evaluate(()=>Boolean(document.fullscreenElement))).toBe(true);expect((await scene(page)).uuid).toBe(base.uuid);await page.evaluate(()=>document.exitFullscreen())
 await library.getByRole('button',{name:'Fey portal · Enabled',exact:true}).click();await page.setViewportSize({width:1024,height:768});await props.getByLabel('Effect surface radius',{exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'work/6.3c-inspector-tablet.png'})
})
test('fog preview excludes all magical geometry and linked glow before reveal',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'})
 const effects=magicalEffectPresetIds.map(id=>createEffect(id,id,'ground',{x:10,z:10,heightFeet:0}));effects[0]={...effects[0],light:{emitterId:'secret-portal-light'}}
 await load(page,{...blankDungeon('concealed','Concealed',30,30),environmentalEffects:{version:1,effects},fogOfWar:initialFog(),lighting:{environment:legacyEnvironment,sources:[{...lightAppearanceSchema.parse({intensity:8,radius:4}),id:'secret-portal-light',name:'Fey portal',floorId:'ground',position:effects[0].position}]}})
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(18)
 const base=await scene(page);await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.length).toBe(0);await expect.poll(async()=>(await scene(page)).lights.length).toBe(0)
 await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click();await page.getByRole('button',{name:'Reveal entire floor',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(18);await expect.poll(async()=>(await scene(page)).lights.find(l=>l.name==='atmosphere-point:secret-portal-light')?.intensity).toBe(8)
 expect((await scene(page)).uuid).toBe(base.uuid)
})

async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const {csrf}=await(await fetch('/api/session')).json();const response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!response.ok)throw Error(await response.text());return response.json()},{path,body})}
test('magical surfaces coexist with a real GLB at angled/top-down cameras and preserve encounter state',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/');await multiplayerMode(page)
 await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Magical Effects GLB Password 2056!');await page.getByRole('button',{name:'Create account',exact:true}).click();await openSetup(page)
 await page.getByLabel('New campaign',{exact:true}).fill('Arcane laboratory');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
 const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
 const asset=await page.evaluate(async bytes=>{const {csrf}=await(await fetch('/api/session')).json(),form=new FormData();form.set('metadata',JSON.stringify({name:'Arcane machine',category:'decoration'}));form.set('file',new Blob([new Uint8Array(bytes)]),'machine.glb');const r=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:form});if(!r.ok)throw Error(await r.text());return r.json()},Array.from(await makeTexturedGlb()))
 const map={...blankDungeon('lab','Laboratory',20,20),schemaVersion:2,props:[{id:'machine',type:'asset',assetId:asset.id,label:'Arcane machine',category:'decoration',position:{x:10,z:10},rotation:0,scale:1,verticalOffset:0,visible:true}],environmentalEffects:{version:1,effects:[createEffect('runes','glowing-runes','ground',{x:10,z:10,heightFeet:0}),createEffect('portal','fey-portal','ground',{x:10,z:11,heightFeet:0}),createEffect('pool','magical-liquid','ground',{x:11,z:10,heightFeet:0}),createEffect('arc','electrical-arcs','ground',{x:10,z:10,heightFeet:0})]}}
 await api(page,path+'/encounters',{name:'Laboratory',file:{version:1,round:7,combatants:[],dungeonMap:map}});await sessionAction(page,'Start multiplayer session');await page.getByRole('button',{name:'Map editor',exact:true}).click()
 await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(1);await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(4)
 const before=await api(page,path+'/snapshot'),base=await scene(page)
 await page.locator('canvas:visible').evaluate(async node=>{for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue;s.camera.position.set(12,5,16);s.controls?.target.set(0,0,0);s.controls?.update();s.invalidate();break}})
 await page.getByRole('button',{name:'Hide map inspector',exact:true}).click();await page.screenshot({path:'work/6.3c-glb-overlap.png'})
 await page.getByRole('button',{name:'Top-down',exact:true}).click();await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(1);expect((await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(4)
 const after=await api(page,path+'/snapshot');expect(after.revision).toBe(before.revision);expect(after.state.round).toBe(7);expect(after.state.dungeonMap).toEqual(before.state.dungeonMap);expect((await scene(page)).uuid).toBe(base.uuid);expect(errors).toEqual([])
})
