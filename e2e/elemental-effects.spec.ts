import {initialFog} from '../shared/fog'
import {lightAppearanceSchema} from '../shared/lighting'
import {test,expect,type Page} from '@playwright/test'
import {blankDungeon} from '../shared/dungeon'
import {createEffect,effectPresetIds,magicalEffectPresetIds,effectPreset} from '../shared/environmentalEffects'
import {sessionAction} from './shell-helpers'
import {clickBattlefield} from './workspace-helpers'
async function scene(page:Page){return page.locator('canvas:visible').evaluate(async node=>{
 for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){
 const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue
 const list:{name:string;count:number;particles:number;style?:string;layers?:number;scale:number;time?:number;alpha?:number;height?:number;speed?:number}[]=[],lights:{name:string;intensity:number}[]=[]
 s.scene.traverse((o:{name:string;isPointLight?:boolean;intensity:number;isMesh?:boolean;isPoints?:boolean;userData:{effectParticles?:number;style?:string;layers?:number};geometry:{instanceCount?:number;attributes:{position:{count:number}}};parent:{scale:{x:number}};material:{uniforms:{time?:{value:number};alpha?:{value:number};height?:{value:number}}}})=>{if(o.name.startsWith('environmental-effect:')||o.name.startsWith('effect-secondary:'))list.push({name:o.name,count:o.geometry.instanceCount??o.geometry.attributes.position.count,particles:o.userData.effectParticles??o.geometry.attributes.position.count,style:o.userData.style,layers:o.userData.layers,scale:o.parent.scale.x,time:o.material.uniforms.time?.value,alpha:o.material.uniforms.alpha?.value,height:o.material.uniforms.height?.value});if(o.isPointLight)lights.push({name:o.name,intensity:o.intensity})})
 return {list,lights,memory:s.gl.info.memory,render:s.gl.info.render,uuid:s.scene.uuid}
 }return {list:[],lights:[],memory:{geometries:0,textures:0},render:{calls:0,triangles:0,points:0},uuid:''}
})}
async function load(page:Page,map:unknown){await page.goto('/');const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'elemental.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:4,combatants:[],dungeonMap:map}))});await page.getByRole('button',{name:'Map editor',exact:true}).click()}
test('all elemental and atmospheric adapters render, scale quality and dispose when disabled',{timeout:120000},async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&/THREE.WebGLProgram|VALIDATE_STATUS|shader error/i.test(m.text()))errors.push(m.text())})
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'})
 const effects=effectPresetIds.filter(id=>!magicalEffectPresetIds.includes(id)).map((id,i)=>createEffect(id,id,'ground',{x:4+(i%5)*5,z:4+Math.floor(i/5)*6,heightFeet:effectPreset(id).renderer==='motes'?2.5:0}))
 await load(page,{...blankDungeon('elemental','Elemental',30,30),environmentalEffects:{version:1,effects}})
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(17)
 expect((await scene(page)).list.filter(e=>e.layers===3).length).toBe(4)
 const base=await scene(page),cloud=base.list.find(e=>e.name==='environmental-effect:smoke-column')!;expect(cloud.style).toBe('smoke');expect(cloud.particles).toBeGreaterThan(6)
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'Low quality',exact:true}).click()
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('effect-secondary:')).length).toBe(0)
 expect((await scene(page)).list.find(e=>e.name==='environmental-effect:smoke-column')!.particles).toBeLessThan(cloud.particles)
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'High quality',exact:true}).click()
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('effect-secondary:')).length).toBe(4)
 console.log('Effects gallery High',JSON.stringify({render:(await scene(page)).render,memory:(await scene(page)).memory,particles:(await scene(page)).list.reduce((n,e)=>n+e.particles,0)}))
 const time=(await scene(page)).list.find(e=>e.name==='environmental-effect:smoke-column')!.time;await page.getByRole('button',{name:'Zoom in',exact:true}).click();expect((await scene(page)).list.find(e=>e.name==='environmental-effect:smoke-column')!.time).toBe(time)
 await page.getByRole('button',{name:'Effects tool',exact:true}).click();const library=page.getByRole('region',{name:'Effects library',exact:true});await library.getByRole('button',{name:'Smoke column · Enabled',exact:true}).click()
 const props=page.getByRole('region',{name:'Effect properties',exact:true});await props.getByLabel('Effect particle height',{exact:true}).fill('5');await props.getByLabel('Effect scale',{exact:true}).fill('1.5');await props.getByLabel('Effect speed',{exact:true}).fill('2');await props.getByRole('button',{name:'Apply effect',exact:true}).click()
 await expect.poll(async()=>(await scene(page)).list.find(e=>e.name==='environmental-effect:smoke-column')).toMatchObject({height:5,scale:1.5})
 expect(await page.getByRole('region',{name:'Effect lighting',exact:true}).count()).toBe(0)
 const enabledGeometries=(await scene(page)).memory.geometries
 await props.getByLabel('Effect enabled',{exact:true}).uncheck();await props.getByRole('button',{name:'Apply effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name==='environmental-effect:smoke-column').length).toBe(0);await expect.poll(async()=>(await scene(page)).memory.geometries).toBeLessThan(enabledGeometries)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name==='environmental-effect:smoke-column').length).toBe(1)
 expect((await scene(page)).uuid).toBe(base.uuid);expect(errors).toEqual([])
 await page.getByRole('button',{name:'Hide map inspector',exact:true}).click();await page.screenshot({path:'work/6.3b-preset-gallery.png'})
})
test('fire placement, independent light settings, disable, duplication and history use existing emitters',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await load(page,blankDungeon('fire','Fire',20,20))
 await page.getByRole('button',{name:'Effects tool',exact:true}).click();const library=page.getByRole('region',{name:'Effects library',exact:true})
 await library.getByLabel('Effect category',{exact:true}).selectOption('Elemental');await library.getByLabel('Effect preset',{exact:true}).selectOption('campfire');await library.getByRole('button',{name:'Place Campfire',exact:true}).click();await clickBattlefield(page,{x:.5,y:.01,z:.5})
 await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(1)
 const light=page.getByRole('region',{name:'Effect lighting',exact:true});await light.getByLabel('Emit light',{exact:true}).check();await light.getByLabel('Effect light intensity',{exact:true}).fill('9');await light.getByLabel('Light flicker',{exact:true}).uncheck();await light.getByRole('button',{name:'Apply effect light',exact:true}).click()
 await expect.poll(async()=>(await scene(page)).lights.filter(l=>l.name.startsWith('atmosphere-point:')).map(l=>l.intensity)).toEqual([9])
 const props=page.getByRole('region',{name:'Effect properties',exact:true});await props.getByLabel('Effect intensity',{exact:true}).fill('.4');await props.getByRole('button',{name:'Apply effect',exact:true}).click();expect((await scene(page)).lights.find(l=>l.name.startsWith('atmosphere-point:'))!.intensity).toBe(9)
 await props.getByLabel('Effect enabled',{exact:true}).uncheck();await props.getByRole('button',{name:'Apply effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.find(l=>l.name.startsWith('atmosphere-point:'))?.intensity).toBe(0)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.find(l=>l.name.startsWith('atmosphere-point:'))?.intensity).toBe(9)
 await props.getByRole('button',{name:'Duplicate effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.filter(l=>l.name.startsWith('atmosphere-point:')).length).toBe(2)
 await props.getByRole('button',{name:'Delete effect',exact:true}).click();await page.getByRole('dialog',{name:'Delete effect',exact:true}).getByRole('button',{name:'Delete effect',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.filter(l=>l.name.startsWith('atmosphere-point:')).length).toBe(1)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect.poll(async()=>(await scene(page)).lights.filter(l=>l.name.startsWith('atmosphere-point:')).length).toBe(2)
 await library.getByRole('button',{name:'Campfire · Enabled',exact:true}).last().click();await page.setViewportSize({width:1024,height:768});await page.getByRole('region',{name:'Effect lighting',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'work/6.3b-fire-tablet.png'})
})

test('fog preview removes concealed tall particles and their owned light before rendering',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1600,height:1000})
 const fire={...createEffect('secret-fire','campfire','ground',{x:10,z:10,heightFeet:0}),light:{emitterId:'secret-emitter'}},smoke=createEffect('secret-smoke','smoke-column','ground',{x:10,z:10,heightFeet:25}),sparks=createEffect('secret-sparks','electrical-sparks','ground',{x:10,z:10,heightFeet:10})
 const map={...blankDungeon('concealed','Concealed',30,30),environmentalEffects:{version:1 as const,effects:[fire,smoke,sparks]},fogOfWar:initialFog(),lighting:{environment:{ambientColor:'#ffffff',ambientIntensity:1.05,directionalColor:'#ffffff',directionalIntensity:2.1,directionalPosition:[8,14,6],shadows:true,shadowQuality:'medium',exposure:1},sources:[{...lightAppearanceSchema.parse({intensity:10,radius:4}),id:'secret-emitter',name:'Campfire',floorId:'ground',position:fire.position}]}}
 await load(page,map);await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(3)
 const root=(await scene(page)).uuid
 await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.length).toBe(0);await expect.poll(async()=>(await scene(page)).lights.filter(l=>l.name.startsWith('atmosphere-point:')).length).toBe(0)
 expect((await scene(page)).uuid).toBe(root)
 await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click()
 // Reveal through the existing floor action; both geometry and light become eligible.
 await page.getByRole('button',{name:'Reveal entire floor',exact:true}).click()
 await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(async()=>(await scene(page)).list.filter(e=>e.name.startsWith('environmental-effect:')).length).toBe(3);await expect.poll(async()=>(await scene(page)).lights.find(l=>l.name==='atmosphere-point:secret-emitter')?.intensity).toBe(10)
 expect((await scene(page)).uuid).toBe(root)
})
