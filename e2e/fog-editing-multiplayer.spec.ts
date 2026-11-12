import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {blankDungeon} from '../shared/dungeon'
import {initialFog} from '../shared/fog'
import {multiplayerMode} from './shell-helpers'
import {projectBattlefield,battlefieldView} from './workspace-helpers'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error(await r.text());return r.json()},{path,body})}
test('DM gestures send one mask command, synchronize reveal/conceal, and preview stays read-only',async({page,browser})=>{
 const commands:string[]=[],errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('websocket',s=>s.on('framesent',e=>{const frame=String(e.payload);if(frame.includes('game.command')&&frame.includes('map.fog.mask'))commands.push(frame)}))
 await page.setViewportSize({width:1600,height:1000});await page.goto('/');await api(page,'/auth/register',{email:randomUUID()+'@example.test',password:'Fog Editing Browser Password 2053!'})
 const campaign=await api(page,'/campaigns',{name:'Fog editing'}),path='/campaigns/'+campaign.id,map={...blankDungeon('warehouse','Warehouse',30,20),fogOfWar:initialFog()}
 await api(page,path+'/encounters',{name:'Warehouse',file:{version:1,round:3,dungeonMap:map,combatants:[{id:'hero',name:'Loading area hero',side:'hero',hp:10,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],battleMap:{width:30,height:20,tokens:{hero:{x:10,z:8}}}}});await api(page,path+'/session',{active:true});const invite=await api(page,path+'/invitations',{})
 await multiplayerMode(page);await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(campaign.id);await expect(page.locator('.connection')).toHaveText('Connected');await page.getByRole('button',{name:'Map editor',exact:true}).click()
 const context=await browser.newContext(),player=await context.newPage();player.on('pageerror',e=>errors.push(e.message))
 try{
  await player.goto(invite.url);await player.getByLabel('Display name').fill('Warehouse explorer');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected');await expect(player.locator('.map-initiative-list button')).toHaveCount(0)
  const before=await api(page,path+'/snapshot'),camera=await battlefieldView(page),playerCamera=await battlefieldView(player)
  async function tool(name:string){await page.getByRole('button',{name:'Fog tools',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();await projectBattlefield(page,{x:0,y:.002,z:0},{editorTool:'fog'})}
  async function stroke(){const a=await projectBattlefield(page,{x:-7,y:.002,z:-1.5},{editorTool:'fog'}),b=await projectBattlefield(page,{x:-1,y:.002,z:-1.5},{editorTool:'fog'});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12})}
  await tool('Reveal Brush');await stroke();expect(commands).toHaveLength(0);await page.mouse.up();await expect.poll(()=>commands.length).toBe(1)
  await expect.poll(async()=>Boolean((await api(player,path+'/snapshot')).state.battleMap.tokens.hero)).toBe(true);await expect(player.locator('.map-initiative-list button')).toHaveCount(1)
  const revealed=await api(page,path+'/snapshot');expect(revealed.state.mapRevision).toBe(before.state.mapRevision+1);expect(revealed.state.mapUndoDepth).toBe(1);expect(JSON.parse(commands[0].slice(commands[0].indexOf('[')))[1].command.expectedMask).toBe('');expect(JSON.parse(commands[0].slice(commands[0].indexOf('[')))[1].command.expectedMapRevision).toBe(before.state.mapRevision)
  expect(await battlefieldView(page)).toEqual(camera);expect(await battlefieldView(player)).toEqual(playerCamera)
  await tool('Conceal Brush');await stroke();expect(commands).toHaveLength(1);await page.mouse.up();await expect.poll(()=>commands.length).toBe(2);await expect(player.locator('.map-initiative-list button')).toHaveCount(0)
  await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect(player.locator('.map-initiative-list button')).toHaveCount(1);await page.getByRole('button',{name:'Redo map edit',exact:true}).click();await expect(player.locator('.map-initiative-list button')).toHaveCount(0)
  const current=await api(page,path+'/snapshot');await page.getByRole('button',{name:'Fog tools',exact:true}).click();await page.getByRole('menuitem',{name:'Player Preview',exact:true}).click();await expect(page.getByText('Player Preview · Read only',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Fog tools',exact:true})).toHaveCount(0)
  const a=await projectBattlefield(page,{x:0,y:.002,z:0}),b=await projectBattlefield(page,{x:1,y:.002,z:1});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();expect((await api(page,path+'/snapshot')).state.mapRevision).toBe(current.state.mapRevision);expect(commands).toHaveLength(2)
  await player.reload();await expect(player.locator('.connection')).toHaveText('Connected');await expect(player.locator('.map-initiative-list button')).toHaveCount(0);expect((await api(player,path+'/snapshot')).state.dungeonMap.fogOfWar).toEqual(current.state.dungeonMap.fogOfWar)
  expect(errors).toEqual([])
 }finally{await context.close()}
})
