import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { PerspectiveCamera, Vector3 } from 'three'
import { makeTexturedGlb } from '../test-fixtures/glb'
async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json()},{path,body})
}
async function floorClick(page: Page, x: number, z: number) {
  const canvas=page.locator('canvas:visible');await canvas.scrollIntoViewIfNeeded();const box=(await canvas.boundingBox())!
  const camera=new PerspectiveCamera(42,box.width/box.height,.1,300);camera.position.set(12,14,12);camera.lookAt(0,0,0);camera.updateMatrixWorld()
  const p=new Vector3(x-9.5,0,z-9.5).project(camera);await page.mouse.click(box.x+(p.x+1)*box.width/2,box.y+(1-p.y)*box.height/2)
}
test('DM assigns shared miniatures live; two players retain movement, fallback and independent cameras', async ({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/');await page.getByRole('button',{name:'Multiplayer',exact:true}).click()
  await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Miniature Browser Password 2049!');await page.getByRole('button',{name:'Create account',exact:true}).click()
  await page.getByLabel('New campaign',{exact:true}).fill('Miniature campaign');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
  const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
  const asset=await page.evaluate(async bytes=>{const{csrf}=await(await fetch('/api/session')).json();const data=new FormData();data.set('metadata',JSON.stringify({name:'Shared skeleton',category:'monster'}));data.set('file',new Blob([new Uint8Array(bytes)]),'skeleton.glb');const r=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:data});if(!r.ok)throw new Error(await r.text());return r.json()},Array.from(await makeTexturedGlb()))
  const file={version:1,round:1,combatants:[1,2].map(id=>({id,name:'Hero '+id,side:'hero',hp:10,maxHp:10,ac:15,initiative:20-id,conditions:[],saves:[],actions:[]})),battleMap:{width:20,height:20,tokens:{'1':{x:8,z:9},'2':{x:11,z:9}}}}
  await api(page,path+'/encounters',{name:'Miniature encounter',file});await page.getByRole('button',{name:'Start multiplayer session',exact:true}).click()
  const contexts=[await browser.newContext(),await browser.newContext()],players:Page[]=[];let modelRequests=0
  try{
    for(const[index,context]of contexts.entries()){
      const invitation=await api(page,path+'/invitations',{}),player=await context.newPage();players.push(player);player.on('pageerror',e=>errors.push(e.message))
      if(index===0)player.on('request',r=>{if(new URL(r.url()).pathname===`/api/assets/${asset.id}/file`)modelRequests++})
      else await player.route('**/api/assets/*/file?**',route=>route.fulfill({status:503,body:'Temporary storage failure'}))
      await player.goto(invitation.url);await player.getByLabel('Display name').fill('Player '+(index+1));await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected')
      await expect(player.getByRole('button',{name:'Assign 3D Miniature',exact:true})).toHaveCount(0)
    }
    await page.getByRole('combobox',{name:/^Controlled by /}).nth(0).selectOption({label:'Player 1'});await page.getByRole('combobox',{name:/^Controlled by /}).nth(1).selectOption({label:'Player 2'})
    for(const[id,scale,rotation,size]of[[1,'1.5','90','Large'],[2,'.75','180','Small']]as const){
      await page.locator('.initiative-item:visible').filter({hasText:'Hero '+id}).click()
      await page.getByRole('button',{name:'Assign 3D Miniature',exact:true}).click();const dialog=page.getByRole('dialog')
      await dialog.getByRole('button',{name:'Browse Asset Library',exact:true}).click();await dialog.getByLabel('Filter category',{exact:true}).selectOption('monster')
      await dialog.locator('.asset-card').filter({hasText:'Shared skeleton'}).click();await expect(dialog.getByRole('region',{name:'3D asset preview',exact:true}).locator('canvas')).toBeVisible()
      await dialog.getByRole('button',{name:'Use this model',exact:true}).click()
      await dialog.getByLabel('Miniature scale',{exact:true}).fill(scale);await dialog.getByLabel('Miniature rotation (degrees)',{exact:true}).fill(rotation);await dialog.getByLabel('Miniature base size',{exact:true}).selectOption(size)
      if(id===2)await dialog.getByLabel('Show miniature base',{exact:true}).uncheck()
      await dialog.getByRole('button',{name:'Save miniature',exact:true}).click();await expect(dialog).toHaveCount(0)
    }
    await expect(players[0].locator('[data-miniature-state=ready]')).toHaveCount(2);expect(modelRequests).toBe(1)
    // A hit on the GLB selects the existing combatant, rather than moving it.
    await players[0].locator('.map-initiative-list button').filter({hasText:'Hero 2'}).click()
    const selectionCanvas=players[0].locator('canvas');await selectionCanvas.scrollIntoViewIfNeeded();const selectionBox=(await selectionCanvas.boundingBox())!
    const selectionCamera=new PerspectiveCamera(42,selectionBox.width/selectionBox.height,.1,300);selectionCamera.position.set(12,14,12);selectionCamera.lookAt(0,0,0);selectionCamera.updateMatrixWorld()
    const meshPoint=new Vector3(-1.5,.62,-.25).project(selectionCamera)
    await players[0].mouse.click(selectionBox.x+(meshPoint.x+1)*selectionBox.width/2,selectionBox.y+(1-meshPoint.y)*selectionBox.height/2)
    await expect(players[0].locator('.map-initiative-list button').filter({hasText:'Hero 1'})).toHaveAttribute('aria-pressed','true')
    await expect(players[1].getByText('Model unavailable',{exact:true})).toHaveCount(2)
    await players[1].locator('.map-initiative-list button').filter({hasText:'Hero 2'}).click();await floorClick(players[1],10,14)
    await expect.poll(async()=>(await api(page,path+'/snapshot')).state.battleMap.tokens['2']).toEqual({x:10,z:14})
    await floorClick(players[0],14,14);await expect.poll(async()=>(await api(page,path+'/snapshot')).state.battleMap.tokens['1']).toEqual({x:14,z:14})
    const snapshot=await api(page,path+'/snapshot');expect(snapshot.state.combatants[0].miniature.rotation).toBe(90);expect(snapshot.state.combatants[1].miniature.scale).toBe(.75)
    await players[1].unroute('**/api/assets/*/file?**')
    for(let i=2;i>0;i--){await players[1].getByRole('button',{name:'Retry model',exact:true}).first().click({force:true});await expect(players[1].getByRole('button',{name:'Retry model',exact:true})).toHaveCount(i-1)}
    await expect(players[1].locator('[data-miniature-state=ready]')).toHaveCount(2)
    const otherView=await players[1].locator('canvas').screenshot(),canvas=players[0].locator('canvas'),box=(await canvas.boundingBox())!
    await players[0].mouse.move(box.x+box.width*.4,box.y+box.height*.4);await players[0].mouse.down();await players[0].mouse.move(box.x+box.width*.65,box.y+box.height*.5,{steps:15});await players[0].mouse.up();await players[0].waitForTimeout(1500)
    expect((await players[1].locator('canvas').screenshot()).equals(otherView)).toBe(true)
    await contexts[0].setOffline(true);await expect(players[0].locator('.connection')).toHaveText('Reconnecting');await contexts[0].setOffline(false);await expect(players[0].locator('.connection')).toHaveText('Connected');await expect(players[0].locator('[data-miniature-state=ready]')).toHaveCount(2);expect(modelRequests).toBe(1)
    await page.locator('.initiative-item:visible').filter({hasText:'Hero 2'}).click();await page.getByRole('button',{name:'Assign 3D Miniature',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Restore placeholder token',exact:true}).click();await expect(players[0].locator('[data-miniature-state=ready]')).toHaveCount(1)
    await page.getByRole('button',{name:'3D Map',exact:true}).click();await expect(page.locator('main:visible [data-miniature-state=ready]')).toHaveCount(1);await page.screenshot({path:'/tmp/playable-miniatures.png',fullPage:true})
    const unknown=randomUUID();await api(page,path+'/encounters',{name:'Unknown miniature',file:{...file,combatants:[{...file.combatants[0],miniature:{assetId:unknown}}]}})
    await expect(players[0].getByText('Model unavailable',{exact:true})).toBeVisible();await expect(players[0].locator('canvas')).toBeVisible();expect(errors).toEqual([])
  }finally{for(const context of contexts)await context.close()}
})
