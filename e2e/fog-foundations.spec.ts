import {test,expect,type Page} from '@playwright/test'
import {blankDungeon} from '../shared/dungeon'
import {initialFog,fullMask} from '../shared/fog'
import {sessionAction} from './shell-helpers'
import {projectBattlefield,battlefieldView} from './workspace-helpers'
async function scene(page:Page){return page.locator('canvas:visible').evaluate(async node=>{for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue;const tokens:string[]=[],fog:string[]=[];s.scene.traverse((o:{name:string;uuid:string})=>{if(o.name==='combatant-token')tokens.push(o.uuid);if(o.name==='fog-of-war')fog.push(o.uuid)});return{tokens:tokens.length,fog:fog.length,root:s.scene.uuid,camera:s.camera.uuid}}return null})}
async function load(page:Page,withFog=false){
 const map=blankDungeon('warehouse','Warehouse',12,8)
 if(withFog)map.fogOfWar={...initialFog(),floors:{ground:fullMask(12,8)}}
 const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'warehouse.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:3,combatants:[{id:1,name:'Warehouse hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],dungeonMap:map}))})
 await page.getByRole('button',{name:'Map editor',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:0})
}
test('DM editing remains clear; preview shares the player projection, keeps renderer/camera and blocks editing',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width:1600,height:1000});await page.goto('/');await load(page)
 const before=await battlefieldView(page)
 await page.getByLabel('Enable Fog of War',{exact:true}).check();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:0});expect(await battlefieldView(page)).toEqual(before)
 await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect(page.getByText('Player Preview · Read only',{exact:true})).toBeVisible();await expect.poll(()=>scene(page)).toMatchObject({tokens:0,fog:1})
 const point=await projectBattlefield(page,{x:0,y:.026,z:0}),{default:sharp}=await import('sharp'),pixel=await sharp(await page.screenshot()).extract({left:Math.round(point.x),top:Math.round(point.y),width:1,height:1}).raw().toBuffer();expect([...pixel.subarray(0,3)]).toEqual([0,0,0])
 await expect(page.getByRole('button',{name:'Warehouse hero',exact:true})).toHaveCount(0);await expect(page.getByLabel('Enable Fog of War',{exact:true})).toHaveCount(0)
 await page.keyboard.press('o');await expect(page.getByRole('dialog',{name:'Add Object',exact:true})).toHaveCount(0)
 expect(await battlefieldView(page)).toEqual(before)
 await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:0})
 await page.getByLabel('Show fog editing overlay',{exact:true}).check();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:1})
 await page.getByLabel('Enable Fog of War',{exact:true}).uncheck();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:0});expect(errors).toEqual([])
})
test('reset confirmation cancels safely, confirmed reset is undoable and imported masks round trip',async({page})=>{
 await page.goto('/');await load(page,true)
 await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:1,fog:1});await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click()
 page.once('dialog',d=>d.dismiss());await page.getByRole('button',{name:'Reset Fog',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:1});await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click()
 page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'Reset Fog',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:0});await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click()
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await page.getByRole('button',{name:'Player Preview',exact:true}).click();await expect.poll(()=>scene(page)).toMatchObject({tokens:1});await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click()
 const pending=page.waitForEvent('download');await sessionAction(page,'Export encounter');const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];for await(const chunk of stream)chunks.push(Buffer.from(chunk));expect(JSON.parse(Buffer.concat(chunks).toString()).dungeonMap.fogOfWar.floors.ground).toBe(fullMask(12,8))
})

test('separate DM and player browsers share authoritative reveals, hidden GLBs and reconnect state',async({page,browser})=>{
 const {randomUUID}=await import('node:crypto'),{io}=await import('socket.io-client'),{makeTexturedGlb}=await import('../test-fixtures/glb'),{multiplayerMode}=await import('./shell-helpers')
 async function api(target:Page,path:string,body?:unknown){return target.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()},{path,body})}
 await page.goto('/');await api(page,'/auth/register',{email:randomUUID()+'@example.test',password:'Fog Browser Test Password 2049!'})
 const{csrf}=await api(page,'/session'),upload=await page.request.post('/api/assets',{headers:{Origin:'http://localhost:5173','X-CSRF-Token':csrf},multipart:{metadata:JSON.stringify({name:'Tall warehouse scenery',category:'decoration'}),file:{name:'tall.glb',mimeType:'model/gltf-binary',buffer:Buffer.from(await makeTexturedGlb())}}});expect(upload.status()).toBe(201);const model=await upload.json()
 const map={...blankDungeon('warehouse','Warehouse',12,8),schemaVersion:2 as const,fogOfWar:initialFog(),props:[{id:'hidden-tall',type:'asset' as const,assetId:model.id,label:'Hidden tall scenery',category:'decoration' as const,position:{x:5,z:5},scale:5,rotation:0,verticalOffset:0,visible:true}]}
 const campaign=await api(page,'/campaigns',{name:'Fog browser warehouse'}),path='/campaigns/'+campaign.id
 await api(page,path+'/encounters',{name:'Warehouse',file:{version:1,round:3,dungeonMap:map,combatants:[{id:'hero',name:'Warehouse hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}]}});await api(page,path+'/session',{active:true})
 const invite=await api(page,path+'/invitations',{})
 await multiplayerMode(page);await expect(page.getByRole('combobox',{name:'Campaign',exact:true})).toBeEnabled();await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(campaign.id);await page.getByRole('button',{name:'Map editor',exact:true}).click();await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(1)
 const context=await browser.newContext(),player=await context.newPage()
 try{
  await player.goto(invite.url);await player.getByLabel('Display name').fill('Warehouse player');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect.poll(()=>scene(player)).toMatchObject({tokens:0,fog:1});await expect(player.locator('[data-scenery-state=ready]')).toHaveCount(0)
  const initial=await battlefieldView(player),before=await api(player,path+'/snapshot');expect(before.state.combatants[0].name).toBe('Warehouse hero');expect(before.state.battleMap.tokens).toEqual({});expect(JSON.stringify(before)).not.toContain('Hidden tall scenery')
  async function mask(value:string){const current=await api(page,path+'/snapshot'),session=await api(page,'/session'),cookies=(await page.context().cookies()).map(c=>c.name+'='+c.value).join('; '),socket=io('http://localhost:5173',{transports:['websocket'],extraHeaders:{Cookie:cookies,Origin:'http://localhost:5173'},auth:{csrf:session.csrf},reconnection:false});try{await new Promise<void>((resolve,reject)=>{socket.on('connect',()=>socket.emit('campaign.join',campaign.id,(result:{ok:boolean})=>result.ok?resolve():reject(Error('Join failed'))));socket.on('connect_error',reject)});await new Promise<void>((resolve,reject)=>socket.emit('game.command',{commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command:{type:'map.fog.mask',levelId:'ground',mask:value}},(result:{ok:boolean})=>result.ok?resolve():reject(Error('Fog command failed'))))}finally{socket.disconnect()}}
  await mask(fullMask(12,8));await expect.poll(()=>scene(player)).toMatchObject({tokens:1});await expect(player.locator('[data-scenery-state=ready]')).toHaveCount(1);expect(await battlefieldView(player)).toEqual(initial)
  await mask('0'.repeat(12*8*4));await expect.poll(()=>scene(player)).toMatchObject({tokens:0});await expect(player.locator('[data-scenery-state=ready]')).toHaveCount(0);await player.reload();await expect.poll(()=>scene(player)).toMatchObject({tokens:0,fog:1})
  await expect(player.getByLabel('Enable Fog of War',{exact:true})).toHaveCount(0)
 }finally{await context.close()}
})
