import {test,expect} from '@playwright/test'
import {blankDungeon,composeLevels,dungeonLevels} from '../shared/dungeon'
import {createEffect,type EffectPresetId} from '../shared/environmentalEffects'
import {initialFog,fullMask} from '../shared/fog'
import {legacyEnvironment,lightAppearanceSchema} from '../shared/lighting'
import {sessionAction} from './shell-helpers'
const scenes=[{name:'small',size:12,count:5},{name:'medium',size:30,count:15},{name:'large',size:50,count:30},{name:'warehouse',size:30,count:15},{name:'cavern',size:30,count:15}]
const presets:EffectPresetId[]=['campfire','smoke-column','rising-embers','ground-mist','fey-portal','ritual-circle','poison-pool','electrical-arcs']
for(const viewport of [{name:'desktop',width:1600,height:1000},{name:'tablet-viewport',width:1024,height:768}])for(const fixture of scenes)test(`effect workload ${fixture.name} ${viewport.name}`,async({page})=>{
 await page.setViewportSize(viewport);await page.emulateMedia({reducedMotion:'no-preference'});await page.goto('/')
 let map=blankDungeon('profile','Profile',fixture.size,fixture.size)
 const effects=Array.from({length:fixture.count},(_,i)=>createEffect('profile-'+i,presets[i%presets.length],'ground',{x:Math.min(fixture.size-2,2+(i%5)*(fixture.size-4)/5),z:Math.min(fixture.size-2,2+Math.floor(i/5)*(fixture.size-4)/Math.max(1,Math.ceil(fixture.count/5))),heightFeet:0}))
 if(fixture.name==='cavern')effects.forEach((e,i)=>{e.position={x:7+(i%5)*4,z:7+Math.floor(i/5)*8,heightFeet:0}})
 if(fixture.name==='warehouse'){
  map.props=[{id:'brazier',type:'brazier',position:{x:10,z:10},rotation:90,scale:1.5}];effects[0]={...effects[0],attachment:{kind:'scenery',id:'brazier',floorId:'ground',offset:{x:0,z:0,heightFeet:4}}}
  const levels=dungeonLevels(map);map=composeLevels(map,[...levels,{...levels[0],id:'office',name:'Office',elevationFeet:15,playerVisible:true,props:[]}])
 }
 if(fixture.name==='cavern')map.fogOfWar={...initialFog(),floors:{ground:fullMask(fixture.size,fixture.size)}}
 effects[0]={...effects[0],light:{emitterId:'profile-light'}}
 map={...map,environmentalEffects:{version:1,effects},lighting:{environment:legacyEnvironment,sources:[{...lightAppearanceSchema.parse({intensity:8,radius:4}),id:'profile-light',name:'Profile light',floorId:'ground',position:effects[0].position}]}}
 const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'profile.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:1,combatants:[],dungeonMap:map}))});if(fixture.name==='cavern'){await page.getByRole('button',{name:'Map editor',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click()}else await page.getByRole('button',{name:'Battle map',exact:true}).click();if(fixture.name==='warehouse')await page.getByLabel('Battlefield level view',{exact:true}).selectOption('stacked')
 // A visible canvas can precede Fiber mounting its scene; sample only a ready workload.
 await expect.poll(()=>page.locator('canvas:visible').evaluate(async node=>{for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active||!s.gl.info.render.frame)continue;let count=0;s.scene.traverse((o:{name:string})=>{if(o.name.startsWith('environmental-effect:'))count++});return count}return 0})).toBe(fixture.count)
 const result=await page.locator('canvas:visible').evaluate(async node=>{
  for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){
   const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue;s.invalidate()
   const samples:number[]=[],start=performance.now();let last=start,frame=s.gl.info.render.frame
   await new Promise<void>(resolve=>{const sample=(now:number)=>{if(s.gl.info.render.frame!==frame){if(now-start>250)samples.push(now-last);last=now;frame=s.gl.info.render.frame}if(now-start<2000)requestAnimationFrame(sample);else resolve()};requestAnimationFrame(sample)})
   samples.sort((a,b)=>a-b);let particles=0,instantiatedEffects=0;s.scene.traverse((o:{userData:{effectParticles?:number};name:string;geometry?:{attributes?:{position?:{count:number}}}})=>{if(o.name.startsWith('environmental-effect:'))instantiatedEffects++;if(o.name.startsWith('environmental-effect:')||o.name.startsWith('effect-secondary:'))particles+=o.userData.effectParticles??o.geometry?.attributes?.position?.count??0})
   return{samples:samples.length,averageMs:samples.length?samples.reduce((a,b)=>a+b,0)/samples.length:null,p95Ms:samples[Math.floor(samples.length*.95)]??null,render:{calls:s.gl.info.render.calls,triangles:s.gl.info.render.triangles,points:s.gl.info.render.points},particles,instantiatedEffects,memory:{...s.gl.info.memory},renderer:s.gl.getContext().getParameter(s.gl.getContext().getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL??s.gl.getContext().RENDERER)}
  }return null
 })
 expect(result).not.toBeNull();expect(result!.samples).toBeGreaterThan(0)
 const empty=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await empty).setFiles({name:'empty.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:1,combatants:[],dungeonMap:blankDungeon('empty','Empty',fixture.size,fixture.size)}))})
 const memory=()=>page.locator('canvas:visible').evaluate(async node=>{for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue;s.invalidate();return{...s.gl.info.memory}}return{geometries:Infinity,textures:Infinity}})
 await expect.poll(async()=>(await memory()).geometries).toBeLessThan(result!.memory.geometries)
 const afterCleanup=await memory()

 console.log('EFFECT_PROFILE '+JSON.stringify({scene:fixture.name,viewport:viewport.name,effects:fixture.count,quality:'medium',...result,afterCleanup}))
})
