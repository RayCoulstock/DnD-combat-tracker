import {exerciseVerticalNavigation} from './vertical-navigation-acceptance'
import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {makeFloorImage} from '../test-fixtures/floor-image'
import {makeTexturedGlb} from '../test-fixtures/glb'
import {expandEditor,projectBattlefield} from './workspace-helpers'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{
 const{csrf}=await(await fetch('/api/session')).json();const result=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!result.ok)throw Error(await result.text());return result.json()
},{path,body})}
async function clickCell(page:Page,x:number,z:number,y=0){const point=await projectBattlefield(page,{x:x-10,y:y+.002,z:z-10});await page.mouse.click(point.x,point.y)}
async function sceneLevels(page:Page){return page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{
 const resource=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))!,{_roots}=await import(/* @vite-ignore */resource.name),state=_roots.get(node).store.getState(),result:{id:string;y:number;interactive:boolean;images:number;models:number;transforms:{y:number;scale:number;rotation:number}[];tokens:number[]}[]=[]
 state.scene.traverse((object:{userData:{levelId?:string;levelInteractive?:boolean};position:{y:number};traverse:(fn:(child:{name:string;type:string;matrixWorld:{elements:number[]};scale:{x:number};rotation:{y:number}})=>void)=>void})=>{if(object.userData.levelId){let images=0,models=0;const transforms:{y:number;scale:number;rotation:number}[]=[],tokens:number[]=[];object.traverse(child=>{if(child.name==='floor-image')images++;if(child.type==='Mesh')models++;if(child.name==='scenery-placement-transform')transforms.push({y:child.matrixWorld.elements[13],scale:child.scale.x,rotation:child.rotation.y});if(child.name==='combatant-token')tokens.push(child.matrixWorld.elements[13])});result.push({id:object.userData.levelId,y:object.position.y,interactive:object.userData.levelInteractive===true,images,models,transforms,tokens})}});return result
})}
test('three populated levels retain images, geometry, transforms, tokens, drafts and player visibility through save/reload, transitions and fullscreen',async({page,browser})=>{
 const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
 await page.goto('/');await page.getByRole('button',{name:'Multiplayer',exact:true}).click()
 await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Multi Level Maps Password 2053!');await page.getByRole('button',{name:'Create account',exact:true}).click()
 await page.getByLabel('New campaign',{exact:true}).fill('Three storeys');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
 const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
 const file={version:1,round:1,combatants:[1,2,3].map(id=>({id,name:`Hero ${id}`,side:'hero',hp:10,maxHp:12,ac:15,initiative:20-id,conditions:[],saves:[],actions:[]}))}
 await api(page,path+'/encounters',{name:'Three levels',file});await page.getByRole('button',{name:'Start multiplayer session',exact:true}).click()
 const context=await browser.newContext(),player=await context.newPage();player.on('pageerror',error=>errors.push(error.message))
 try{
  const invite=await api(page,path+'/invitations',{});await player.goto(invite.url);await player.getByLabel('Display name').fill('Level player');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected')
  await page.getByRole('button',{name:'Map editor',exact:true}).click();await expandEditor(page);const editor=page.locator('.dungeon-builder:visible')
  await editor.getByLabel('Map name',{exact:true}).fill('Three level keep');await editor.getByRole('button',{name:'Create blank map',exact:true}).click()
  const settings=editor.getByRole('region',{name:'Floor image settings'});await editor.locator('summary').filter({hasText:/^Floor Image/}).click()
  await settings.getByLabel('Floor image file',{exact:true}).setInputFiles({name:'map.png',mimeType:'image/png',buffer:await makeFloorImage()});await expect(settings.getByText('Image uploaded.',{exact:false})).toBeVisible();await settings.getByRole('button',{name:'Apply floor image',exact:true}).click();await expect(page.locator('[data-floor-image-state=ready]')).toHaveCount(1)
  await editor.getByRole('button',{name:'Draw wall',exact:true}).click();await clickCell(page,4.5,4.02)
  await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.walls.length).toBe(1)
  await editor.getByRole('button',{name:'Place door',exact:true}).click();await clickCell(page,4.5,4.02)
  await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.doors.length).toBe(1)
  const asset=await page.evaluate(async bytes=>{const{csrf}=await(await fetch('/api/session')).json(),form=new FormData();form.set('metadata',JSON.stringify({name:'Level barrel',category:'furniture'}));form.set('file',new Blob([new Uint8Array(bytes)]),'barrel.glb');const result=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:form});if(!result.ok)throw Error(await result.text());return result.json()},Array.from(await makeTexturedGlb()))
  await editor.getByRole('button',{name:'Add Object',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add Object',exact:true});await dialog.locator('.asset-card').filter({hasText:'Level barrel'}).click();await dialog.getByRole('button',{name:'Use this model',exact:true}).click();await clickCell(page,12.5,6.5)
  await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(1)
  await editor.getByRole('button',{name:'Select',exact:true}).click();await clickCell(page,12.5,6.5)
  const properties=editor.getByRole('region',{name:'Selected scenery properties',exact:true});await properties.getByLabel('Scenery rotation (degrees)',{exact:true}).fill('45');await properties.getByLabel('Scenery scale',{exact:true}).fill('2');await properties.getByLabel('Scenery vertical offset',{exact:true}).fill('1.25');await properties.getByRole('button',{name:'Apply scenery transform',exact:true}).click()
  await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.props[0].scale).toBe(2)
  await editor.getByRole('button',{name:'Duplicate Ground Floor',exact:true}).click()
  const copy=editor.getByRole('region',{name:'Level: Ground Floor copy',exact:true});await copy.getByLabel('Ground Floor copy name',{exact:true}).fill('Cellar');await copy.getByLabel('Ground Floor copy elevation',{exact:true}).fill('-10');await copy.getByRole('button',{name:'Apply level settings',exact:true}).click()
  await expect(editor.getByRole('region',{name:'Level: Cellar',exact:true})).toBeVisible()
  await editor.getByRole('button',{name:'Duplicate Ground Floor',exact:true}).click();await copy.getByLabel('Ground Floor copy name',{exact:true}).fill('Tower');await copy.getByRole('button',{name:'Apply level settings',exact:true}).click()
  let snapshot=await api(page,path+'/snapshot');const levels=snapshot.state.dungeonMap.levels;const cellar=levels.find((l:{name:string})=>l.name==='Cellar'),tower=levels.find((l:{name:string})=>l.name==='Tower')
  expect(levels).toHaveLength(2);expect(cellar.floorImage).toEqual(snapshot.state.dungeonMap.floorImage);expect(cellar.props[0].id).not.toBe(tower.props[0].id);expect(cellar.props[0].assetId).toBe(asset.id)
  // Uncommitted image calibration survives switching floors, and switching is local.
  const active=page.getByLabel('Active level',{exact:true});await active.selectOption(tower.id)
  const towerSettings=editor.getByRole('region',{name:'Floor image settings'}).filter({visible:true});await editor.locator('div:not([hidden]) > details > summary').filter({hasText:/^Floor Image/}).click()
  await towerSettings.getByLabel('Horizontal image offset',{exact:true}).fill('1.25')
  const revision=(await api(page,path+'/snapshot')).revision;await active.selectOption(cellar.id);await active.selectOption(tower.id)
  await expect(towerSettings.getByLabel('Horizontal image offset',{exact:true})).toHaveValue('1.25');expect((await api(page,path+'/snapshot')).revision).toBe(revision)
  await towerSettings.getByRole('button',{name:'Apply floor image',exact:true}).click()
  await page.getByLabel('Battlefield level view',{exact:true}).selectOption('stacked');await expect(page.locator('[data-floor-image-state=ready]')).toHaveCount(3);await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(3)
  expect((await sceneLevels(page)).map(l=>l.y).sort()).toEqual([-2,0,2]);expect((await sceneLevels(page)).filter(l=>l.interactive).map(l=>l.id)).toEqual([tower.id]);for(const level of await sceneLevels(page)){expect(level.transforms).toHaveLength(1);expect(level.transforms[0].y).toBeCloseTo(level.y+1.25);expect(level.transforms[0].scale).toBe(2);expect(level.transforms[0].rotation).toBeCloseTo(Math.PI/4)}
  // Click through the display-only upper floor to edit a lower active level.
  await active.selectOption(cellar.id);await editor.getByRole('button',{name:'Draw wall',exact:true}).click();await clickCell(page,8.5,8.02,-2)
  await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.levels.find((l:{id:string})=>l.id===cellar.id).walls.length).toBe(2)
  expect((await api(page,path+'/snapshot')).state.dungeonMap.levels.find((l:{id:string})=>l.id===tower.id).walls).toHaveLength(1)
  const transfer=page.locator('.combatant-transfer');await page.getByRole('button',{name:'Expand roster',exact:true}).click()
  for(const [id,floorId] of [['2',cellar.id],['3',tower.id]]){await transfer.getByLabel('Transfer combatant',{exact:true}).selectOption(id);await transfer.getByLabel('Transfer destination level',{exact:true}).selectOption(floorId);await transfer.getByRole('button',{name:'Transfer to level',exact:true}).click();await expect.poll(async()=>(await api(page,path+'/snapshot')).state.combatants.find((c:{id:number})=>String(c.id)===id).floorId).toBe(floorId)}
  for(const level of await sceneLevels(page)){expect(level.tokens).toHaveLength(1);expect(level.tokens[0]).toBeCloseTo(level.y)}
  await expect(player.getByLabel('Active level',{exact:true}).locator('option')).toHaveCount(1);await expect(player.locator('.map-initiative-list button')).toHaveCount(1)
  const towerPanel=editor.getByRole('region',{name:'Level: Tower',exact:true});await towerPanel.getByLabel('Tower player visibility',{exact:true}).check();await towerPanel.getByRole('button',{name:'Apply level settings',exact:true}).click()
  await expect(player.getByLabel('Active level',{exact:true}).locator('option')).toHaveCount(2);await player.getByLabel('Active level',{exact:true}).selectOption(tower.id);await expect(player.locator('.map-initiative-list button')).toHaveCount(1);await expect(player.locator('.map-initiative-list button')).toContainText('Hero 3')
  await editor.getByRole('button',{name:'Save map',exact:true}).click();await expect(editor.getByRole('status')).toContainText('Map saved');snapshot=await api(page,path+'/snapshot');const document=snapshot.state.dungeonMap
  await editor.getByRole('button',{name:'Undo map edit',exact:true}).click();await editor.getByRole('button',{name:'Redo map edit',exact:true}).click();await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap).toEqual(document)
  const exported=await api(page,path+'/export');expect(exported.dungeonMap).toEqual(document)
  await page.reload();await page.getByRole('button',{name:'Expand setup',exact:true}).click();await page.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(campaign);await expect(page.locator('.connection')).toHaveText('Connected');await page.getByRole('button',{name:'Map editor',exact:true}).click()
  expect((await api(page,path+'/snapshot')).state.dungeonMap).toEqual(document)
  await expandEditor(page)
  for(const name of ['Ground Floor','Tower']){const panel=page.getByRole('region',{name:`Level: ${name}`,exact:true});await panel.getByLabel(`${name} player visibility`,{exact:true}).uncheck();await panel.getByRole('button',{name:'Apply level settings',exact:true}).click()}
  await expect(player.getByRole('status').filter({hasText:'The DM has not revealed a level.'})).toBeVisible();expect(await sceneLevels(player)).toEqual([])
  for(const name of ['Ground Floor','Tower']){const panel=page.getByRole('region',{name:`Level: ${name}`,exact:true});await panel.getByLabel(`${name} player visibility`,{exact:true}).check();await panel.getByRole('button',{name:'Apply level settings',exact:true}).click()}
  await player.reload();await expect(player.getByLabel('Active level',{exact:true}).locator('option')).toHaveCount(2)
  await exerciseVerticalNavigation(page,player,path,tower.id)
  expect(errors).toEqual([])
 }finally{await context.close()}
})
