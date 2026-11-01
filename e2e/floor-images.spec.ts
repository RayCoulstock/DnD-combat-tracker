import {multiplayerMode,sessionAction,closeSetup,openSetup,chooseCampaign} from './shell-helpers'
import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {makeFloorImage} from '../test-fixtures/floor-image'
import {makeTexturedGlb} from '../test-fixtures/glb'
import {expandEditor,clickBattlefield} from './workspace-helpers'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{
  const {csrf}=await(await fetch('/api/session')).json(),response=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)})
  if(!response.ok)throw Error(await response.text());return response.json()
},{path,body})}
async function clickFloor(page:Page,x:number,z:number,width=20,height=10){await clickBattlefield(page,{x:x-width/2,y:.002,z:z-height/2})}
test('DM uploads and calibrates an image under walls, a GLB and a combatant; players, saved maps and history restore it',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  await page.goto('/');await multiplayerMode(page)
  await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Battle Map Images Password 2052!');await page.getByRole('button',{name:'Create account',exact:true}).click();await openSetup(page)
  await page.getByLabel('New campaign',{exact:true}).fill('Image campaign');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
  const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
  const file={version:1,round:1,combatants:[{id:1,name:'Image hero',side:'hero',hp:10,maxHp:10,ac:15,initiative:10,conditions:[],saves:[],actions:[]}],battleMap:{version:1,width:20,height:20,gridSizeFeet:5,showGrid:true,showLabels:true,tokens:{'1':{x:9,z:4}}}}
  await api(page,path+'/encounters',{name:'Image encounter',file});await sessionAction(page,'Start multiplayer session')
  const context=await browser.newContext(),player=await context.newPage();let imageRequests=0;player.on('request',request=>{if(new URL(request.url()).pathname.includes('/api/floor-images/')&&new URL(request.url()).pathname.endsWith('/file'))imageRequests++});player.on('pageerror',error=>errors.push(error.message))
  let resumeUpload=()=>{}
  try{
    const invite=await api(page,path+'/invitations',{});await player.goto(invite.url);await player.getByLabel('Display name').fill('Image player');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected')
    await openSetup(page);await page.getByRole('combobox',{name:'Controlled by Image hero',exact:true}).selectOption({label:'Image player'})
    await closeSetup(page);await page.getByRole('button',{name:'Map editor',exact:true}).click();await expandEditor(page)
    const editor=page.locator('.dungeon-builder:visible');await editor.getByLabel('Map name',{exact:true}).fill('Imported battle map');await editor.getByLabel('Map height',{exact:true}).fill('10');await editor.getByRole('button',{name:'Create blank map',exact:true}).click()
    await editor.locator('summary').filter({hasText:'Floor Image'}).click()
    const settings=editor.getByRole('region',{name:'Floor image settings'})
    let started!:()=>void
    const uploadStarted=new Promise<void>(resolve=>{started=resolve}),uploadResumed=new Promise<void>(resolve=>{resumeUpload=resolve})
    await page.route('**/api/floor-images',async route=>{if(route.request().method()==='POST'){started();await uploadResumed}await route.continue()})
    await settings.getByLabel('Floor image file',{exact:true}).setInputFiles({name:'corners.png',mimeType:'image/png',buffer:await makeFloorImage()})
    await uploadStarted
    await player.locator('.map-initiative-list button').filter({hasText:'Image hero'}).click()
    await clickFloor(player,15.5,7.5);await expect.poll(async()=>(await api(page,path+'/snapshot')).state.battleMap.tokens['1']).toEqual({x:15,z:7})
    await clickFloor(player,9.5,4.5);await expect.poll(async()=>(await api(page,path+'/snapshot')).state.battleMap.tokens['1']).toEqual({x:9,z:4})
    resumeUpload()
    await expect(settings.getByText('Image uploaded.',{exact:false})).toBeVisible()
    await page.unroute('**/api/floor-images')
    await settings.getByLabel('Image grid mode',{exact:true}).selectOption('gridded')
    await settings.getByLabel('Horizontal image offset',{exact:true}).fill('.25')
    await settings.getByLabel('Lock image transformations',{exact:true}).check()
    const revision=(await api(page,path+'/snapshot')).revision
    await settings.getByRole('button',{name:'Preview calibration',exact:true}).click();await expect(page.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    expect((await api(page,path+'/snapshot')).revision).toBe(revision);await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(0)
    await settings.getByRole('button',{name:'Apply floor image',exact:true}).click()
    await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    await expect(player.getByRole('region',{name:'Floor image settings'})).toHaveCount(0)
    let snapshot=await api(page,path+'/snapshot');const image=snapshot.state.dungeonMap.floorImage
    expect(image.offsetX).toBe(.25);expect(image.showGrid).toBe(false);expect(snapshot.state.battleMap.tokens['1']).toEqual({x:9,z:4})
    // Read actual rendered pixels: north-west red, north-east green,
    // south-west blue, south-east yellow. This catches texture/plane mirroring.
    await editor.getByRole('button',{name:'Top-down',exact:true}).click()
    const colors=await page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{
      const resource=performance.getEntriesByType('resource').find(item=>item.name.includes('/@react-three_fiber.js'))!
      const {_roots}=await import(/* @vite-ignore */resource.name),state=_roots.get(node).store.getState(),camera=state.camera
      camera.updateMatrixWorld();state.gl.render(state.scene,camera)
      const view=camera.matrixWorldInverse.elements,projection=camera.projectionMatrix.elements
      const multiply=(m:number[],v:number[])=>[0,1,2,3].map(row=>m[row]*v[0]+m[row+4]*v[1]+m[row+8]*v[2]+m[row+12]*v[3])
      const gl=state.gl.getContext(),canvas=node as HTMLCanvasElement
      return [[2,1],[17,1],[2,8],[17,8]].map(([x,z])=>{
        const clip=multiply(projection,multiply(view,[x-10,-.002,z-5,1])),pixel=new Uint8Array(4)
        gl.readPixels(Math.floor((clip[0]/clip[3]+1)*canvas.width/2),Math.floor((clip[1]/clip[3]+1)*canvas.height/2),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel)
        return Array.from(pixel)
      })
    })
    expect(colors[0][0]).toBeGreaterThan(150);expect(colors[0][1]).toBeLessThan(80)
    expect(colors[1][1]).toBeGreaterThan(150);expect(colors[1][0]).toBeLessThan(80)
    expect(colors[2][2]).toBeGreaterThan(150);expect(colors[2][0]).toBeLessThan(80)
    expect(colors[3][0]).toBeGreaterThan(150);expect(colors[3][1]).toBeGreaterThan(150)
    await editor.getByRole('button',{name:'Draw wall',exact:true}).click();await clickFloor(page,5.5,3.02)
    await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.walls.length).toBe(1)
    const asset=await page.evaluate(async bytes=>{const{csrf}=await(await fetch('/api/session')).json(),data=new FormData();data.set('metadata',JSON.stringify({name:'Image barrel',category:'furniture'}));data.set('file',new Blob([new Uint8Array(bytes)]),'barrel.glb');const result=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:data});if(!result.ok)throw Error(await result.text());return result.json()},Array.from(await makeTexturedGlb()))
    await editor.getByRole('button',{name:'Add Object',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add Object',exact:true});await dialog.locator('.asset-card').filter({hasText:'Image barrel'}).click();await dialog.getByRole('button',{name:'Use this model',exact:true}).click()
    await expect(dialog).toHaveCount(0)
    const placement=editor.getByRole('group',{name:'Object placement settings',exact:true})
    await expect(placement.getByText('Image barrel',{exact:true})).toBeVisible();await expect(placement).toBeEnabled()
    await expect(editor.getByRole('button',{name:'Add Object',exact:true})).toHaveAttribute('aria-pressed','true')
    await clickFloor(page,12.5,5.5)
    // Separate a missed placement/command from player-side model loading. Do not
    // retry the click: that could create duplicate scenery and conceal a failure.
    await expect.poll(async()=>{const state=(await api(page,path+'/snapshot')).state;return state.dungeonMap.props.map((prop:{assetId?:string;position:{x:number;z:number}})=>({assetId:prop.assetId,position:prop.position}))},{message:'Scenery placement must persist the selected asset at the clicked square'}).toEqual([{assetId:asset.id,position:{x:12,z:5}}])
    await expect(player.locator('[data-scenery-state=ready]')).toHaveCount(1)
    snapshot=await api(page,path+'/snapshot');expect(snapshot.state.dungeonMap.props[0].assetId).toBe(asset.id);expect(snapshot.state.dungeonMap.floorImage).toEqual(image)
    expect(imageRequests).toBe(1) // Walls/scenery and unrelated state never reload the texture.
    const wall=snapshot.state.dungeonMap.walls[0],prop=snapshot.state.dungeonMap.props[0]
    await editor.getByRole('button',{name:'Save map',exact:true}).click();await expect(editor.getByRole('status')).toContainText('Map saved')
    await expect(editor.getByLabel('Saved maps',{exact:true}).locator('option')).toHaveCount(2)
    await editor.getByLabel('Saved maps',{exact:true}).selectOption({label:'Imported battle map · v1'})
    page.once('dialog',dialog=>dialog.accept());await editor.getByRole('button',{name:'Open saved map',exact:true}).click();await expect(page.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    await page.reload();
    await closeSetup(page)
    await chooseCampaign(page,campaign);await expect(page.locator('.connection')).toHaveText('Connected')
    await page.getByRole('button',{name:'Map editor',exact:true}).click();await expect(page.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    snapshot=await api(page,path+'/snapshot');expect(snapshot.state.dungeonMap.floorImage).toEqual(image);expect(snapshot.state.dungeonMap.walls[0]).toEqual(wall);expect(snapshot.state.dungeonMap.props[0]).toEqual(prop);expect(snapshot.state.battleMap.tokens['1']).toEqual({x:9,z:4})
    await editor.locator('summary').filter({hasText:'Floor Image'}).click()
    await expect(settings.getByLabel('Horizontal image offset',{exact:true})).toBeDisabled()
    // Replace by drag-and-drop. A player-side download failure must keep the
    // floor, GLB and tokens usable, and recover through the existing retry UI.
    await player.route('**/api/floor-images/*/file?**',route=>route.fulfill({status:503,body:'temporary failure'}))
    const transfer=await page.evaluateHandle(bytes=>{const transfer=new DataTransfer();transfer.items.add(new File([new Uint8Array(bytes)],'replacement.webp',{type:'image/webp'}));return transfer},Array.from(await makeFloorImage('webp',64,128)))
    await settings.locator('.floor-image-drop').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose()
    await expect(settings.getByText('Image uploaded.',{exact:false})).toBeVisible()
    await settings.getByRole('button',{name:'Apply floor image',exact:true}).click()
    await expect(player.getByRole('alert').filter({hasText:'Floor image unavailable'})).toContainText('HTTP 503')
    await expect(player.locator('canvas')).toBeVisible();await expect(player.locator('[data-scenery-state=ready]')).toHaveCount(1)
    await player.unroute('**/api/floor-images/*/file?**');await player.getByRole('button',{name:'Retry floor image',exact:true}).click();await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    await editor.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.floorImage).toEqual(image)
    await editor.locator('summary').filter({hasText:'Floor Image'}).click()
    await settings.getByRole('button',{name:'Remove floor image / restore procedural floor',exact:true}).click();await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(0)
    await editor.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(1)
    await editor.getByRole('button',{name:'Redo map edit',exact:true}).click();await expect(player.locator('[data-floor-image-state=ready]')).toHaveCount(0)
    await page.setViewportSize({width:768,height:1024})
    await editor.locator('summary').filter({hasText:'Floor Image'}).click()
    expect(await settings.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    expect(errors).toEqual([])
  }finally{resumeUpload();await context.close()}
})
