import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {io} from 'socket.io-client'
import {blankDungeon,editMap,emptyHistory} from '../shared/dungeon'
import {initialFog,fullMask} from '../shared/fog'
import {multiplayerMode,sessionAction} from './shell-helpers'
import {battlefieldView,projectBattlefield} from './workspace-helpers'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()},{path,body})}
async function fogView(page:Page){return page.locator('canvas:visible').evaluate(async node=>{
 for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){
  const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue
  let result:null|{revision:number;progress:number;texture:string;hidden:number;opacity:number[];textures:number;root:string;camera:string}=null
  s.scene.traverse((o:{name:string;userData:{fogRevision:number};material?:{uniforms?:{progress:{value:number};mask:{value:{uuid:string;image:{data:Uint8Array}}}}}})=>{if(o.name!=='fog-of-war'||!o.material?.uniforms)return;const u=o.material.uniforms,data=u.mask.value.image.data;let hidden=0;for(let i=0;i<data.length;i+=4)if(data[i]===255)hidden++;result={revision:o.userData.fogRevision,progress:u.progress.value,texture:u.mask.value.uuid,hidden,opacity:[...data.slice(0,4)],textures:s.gl.info.memory.textures,root:s.scene.uuid,camera:s.camera.uuid}})
  return result
 }return null
})}
test('cinematic masks reuse textures, animate authorized reveals, immediately conceal and snap on refresh/reduced motion',async({page,browser})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1600,height:1000});await page.goto('/')
 await api(page,'/auth/register',{email:randomUUID()+'@example.test',password:'Fog Cinematic Browser Password 2054!'})
 const campaign=await api(page,'/campaigns',{name:'Cinematic warehouse'}),path='/campaigns/'+campaign.id
 const base={...blankDungeon('warehouse','Warehouse',12,8),fogOfWar:initialFog()}
 let map=editMap({document:base,width:12,height:8},emptyHistory(),{type:'map.level.add',id:'office',name:'Office',elevationFeet:15,width:8,height:6}).frame.document!
 map=editMap({document:map,width:12,height:8},emptyHistory(),{type:'map.level.update',id:'office',name:'Office',elevationFeet:15,playerVisible:true}).frame.document!
 await api(page,path+'/encounters',{name:'Warehouse',file:{version:1,round:3,dungeonMap:map,combatants:[{id:'hero',name:'Warehouse hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],battleMap:{width:12,height:8,tokens:{hero:{x:3,z:3}}}}});await api(page,path+'/session',{active:true});const invite=await api(page,path+'/invitations',{})
 await multiplayerMode(page);await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(campaign.id);await expect(page.locator('.connection')).toHaveText('Connected');await page.getByRole('button',{name:'Map editor',exact:true}).click()
 await page.getByLabel('Fog edge softness',{exact:true}).selectOption('1');await page.getByLabel('Fog reveal duration (seconds)',{exact:true}).fill('2');await page.getByRole('button',{name:'Apply fog appearance',exact:true}).click();await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.fogOfWar.cinematic.durationMs).toBe(2000)
 await page.getByRole('group',{name:'Appearance and reveal animation',exact:true}).screenshot({path:test.info().outputPath('fog-cinematic-controls.png')})
 const context=await browser.newContext(),player=await context.newPage();player.on('pageerror',e=>errors.push(e.message));let socket:ReturnType<typeof io>|undefined
 try{
  await player.goto(invite.url);await player.getByLabel('Display name').fill('Cinematic explorer');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect.poll(()=>fogView(player)).not.toBeNull()
  const initial=(await fogView(player))!,camera=await battlefieldView(player),state=await api(page,path+'/snapshot'),session=await api(page,'/session'),cookies=(await page.context().cookies()).map(c=>c.name+'='+c.value).join('; ')
  socket=io('http://localhost:5173',{transports:['websocket'],extraHeaders:{Cookie:cookies,Origin:'http://localhost:5173'},auth:{csrf:session.csrf},reconnection:false})
  await new Promise<void>((resolve,reject)=>{socket!.on('connect',()=>socket!.emit('campaign.join',campaign.id,(r:{ok:boolean})=>r.ok?resolve():reject(Error('Join failed'))));socket!.on('connect_error',reject)})
  async function command(mask:string){const current=await api(page,path+'/snapshot');await new Promise<void>((resolve,reject)=>socket!.emit('game.command',{commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command:{type:'map.fog.mask',levelId:'ground',mask,expectedMask:current.state.dungeonMap.fogOfWar.floors.ground??'',expectedMapRevision:current.state.mapRevision}},(r:{ok:boolean})=>r.ok?resolve():reject(Error('Mask failed'))));return current.state.dungeonMap.fogOfWar.revision+1}
  const revision=await command(fullMask(12,8));await expect.poll(()=>fogView(player)).toMatchObject({revision,hidden:0,texture:initial.texture});const during=(await fogView(player))!;expect(during.progress).toBeLessThan(1)
  await expect.poll(async()=>(await fogView(player))?.progress).toBe(1);expect((await fogView(player))!.opacity.slice(0,2)).toEqual([0,0]);expect(await battlefieldView(player)).toEqual(camera)
  await command('0'.repeat(384));await expect.poll(()=>fogView(player)).toMatchObject({hidden:1536,opacity:[255,255,255,255],texture:initial.texture});await expect(player.locator('.map-initiative-list button')).toHaveCount(0)
  await command(fullMask(12,8));await command('0'.repeat(384));await command(fullMask(12,8));await expect.poll(async()=>(await fogView(player))?.hidden).toBe(0)
  await player.getByLabel('Active level',{exact:true}).selectOption('office');await expect.poll(()=>fogView(player)).toMatchObject({progress:1,hidden:768});await player.getByLabel('Active level',{exact:true}).selectOption('ground');await expect.poll(()=>fogView(player)).toMatchObject({progress:1,hidden:0})
  await command('0'.repeat(384));await command(fullMask(12,8))
  await player.reload();await expect.poll(()=>fogView(player)).toMatchObject({progress:1,hidden:0});expect((await api(player,path+'/snapshot')).state.dungeonMap.fogOfWar.cinematic.durationMs).toBe(2000)
  await player.emulateMedia({reducedMotion:'reduce'});await command('0'.repeat(384));const reducedRevision=await command(fullMask(12,8));await expect.poll(()=>fogView(player)).toMatchObject({revision:reducedRevision,progress:1,hidden:0})
  await page.getByLabel('Fog reveal duration (seconds)',{exact:true}).fill('0');await page.getByRole('button',{name:'Apply fog appearance',exact:true}).click();await expect.poll(async()=>(await api(player,path+'/snapshot')).state.dungeonMap.fogOfWar.cinematic.durationMs).toBe(0)
  await player.emulateMedia({reducedMotion:'no-preference'});await command('0'.repeat(384));const zero=await command(fullMask(12,8));await expect.poll(()=>fogView(player)).toMatchObject({revision:zero,progress:1,hidden:0})
  expect((await api(page,path+'/snapshot')).state.battleMap.tokens).toEqual(state.state.battleMap.tokens);expect(errors).toEqual([])
 }finally{socket?.disconnect();await context.close()}
})


test('soft boundaries darken the revealed side while bright lighting leaves unexplored pixels black at every quality',async({page})=>{
 const {FogMaskDraft}=await import('../shared/fogEditing'),{lightingTemplates,pointLightSchema}=await import('../shared/lighting'),{default:sharp}=await import('sharp')
 const draft=new FogMaskDraft(12,8,'');draft.rectangle({x:0,z:0},{x:6,z:8},'reveal')
 const fog={...initialFog(),appearance:{colour:'#000000' as const,edgeSoftness:1},floors:{ground:draft.serialize()}}
 const map={...blankDungeon('soft','Soft boundary',12,8),fogOfWar:fog,floorSurface:{mode:'solid',solidColor:'#ffffff'},lighting:{environment:lightingTemplates.Daylight,sources:[pointLightSchema.parse({id:'hidden-light',name:'Secret glow',floorId:'ground',position:{x:8,z:4,heightFeet:5},intensity:10,radius:30,castShadow:true})]}}
 await page.goto('/');const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'soft.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:1,combatants:[],dungeonMap:map}))})
 await page.getByRole('button',{name:'Map editor',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click();await page.getByRole('button',{name:'Top-down',exact:true}).click();await expect.poll(()=>fogView(page)).toMatchObject({hidden:768,progress:1})
 const baseline=(await fogView(page))!
 for(const quality of ['Low','Medium','High']){
  await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:quality+' quality',exact:true}).click()
  if(quality==='Medium'){const point=await projectBattlefield(page,{x:-3,y:.026,z:-1});await page.mouse.move(point.x,point.y);await page.mouse.down();await page.mouse.move(point.x+35,point.y+12,{steps:6});await page.mouse.up()}
  const far=await projectBattlefield(page,{x:-4.125,y:.026,z:1.375}),edge=await projectBattlefield(page,{x:-.125,y:.026,z:1.375}),hidden=await projectBattlefield(page,{x:1.125,y:.026,z:1.375})
  const screenshot=await page.screenshot(),pixel=async(p:{x:number;y:number})=>[...await sharp(screenshot).extract({left:Math.round(p.x),top:Math.round(p.y),width:1,height:1}).removeAlpha().raw().toBuffer()]
  expect(await pixel(hidden)).toEqual([0,0,0]);expect((await pixel(far))[0]).toBeGreaterThan((await pixel(edge))[0]+20)
  const current=(await fogView(page))!;expect(current.texture).toBe(baseline.texture);expect(current.root).toBe(baseline.root);expect(current.camera).toBe(baseline.camera)
 }
 await page.screenshot({path:test.info().outputPath('soft-fog-player-preview.png')})
})
