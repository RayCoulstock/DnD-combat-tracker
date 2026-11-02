import {expect,type Page} from '@playwright/test'
import {projectBattlefield} from './workspace-helpers'
async function api(page:Page,path:string){return page.evaluate(async path=>{const r=await fetch('/api'+path);if(!r.ok)throw Error(await r.text());return r.json()},path)}
async function cameraState(page:Page){return page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{
 const resource=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))!,{_roots}=await import(/* @vite-ignore */resource.name),state=_roots.get(node).store.getState()
 return {camera:state.camera.uuid,scene:state.scene.uuid,position:state.camera.position.toArray(),target:state.controls.target.toArray(),zoom:state.camera.zoom}
})}
// Reuse the existing authenticated multi-floor fixture; production authentication
// rate limits remain enabled for the full browser suite.
export async function exerciseVerticalNavigation(page:Page,player:Page,path:string,towerId:string){
 const editor=page.locator('.dungeon-builder:visible'),canvas=await page.locator('.battlefield-wrap canvas:visible').elementHandle()
 await page.getByLabel('Active level',{exact:true}).selectOption('ground')
 const summary=editor.locator('div:not([hidden]) > details > summary').filter({hasText:/^Floor Image/});if(!await summary.locator('..').evaluate(node=>(node as HTMLDetailsElement).open))await summary.click()
 const image=editor.getByRole('region',{name:'Floor image settings'}).filter({visible:true});await image.getByLabel('Lock image transformations',{exact:true}).uncheck();await image.getByLabel('Horizontal image offset',{exact:true}).fill('2.75')
 const before=await cameraState(page),revision=(await api(page,path+'/snapshot')).revision,normal=await page.locator('.battlefield-wrap canvas:visible').boundingBox()
 await page.getByRole('button',{name:'Expand Map',exact:true}).click();await expect(editor).toHaveAttribute('data-map-expanded','true');await expect(editor.locator('.inspector')).toBeHidden()
 expect(await canvas!.evaluate(node=>node.isConnected&&node===document.querySelector('.battlefield-wrap canvas'))).toBe(true)
 await expect.poll(async()=>Math.round((await editor.boundingBox())!.height)).toBe(page.viewportSize()!.height)
 expect((await page.locator('.battlefield-wrap canvas:visible').boundingBox())!.width).toBeGreaterThan(normal!.width)
 expect(await cameraState(page)).toEqual(before)
 await page.getByRole('button',{name:'Show map inspector',exact:true}).click();await expect(image.getByLabel('Horizontal image offset',{exact:true})).toHaveValue('2.75')
 await page.getByRole('button',{name:'Restore View',exact:true}).click();expect(await cameraState(page)).toEqual(before)
 expect((await api(page,path+'/snapshot')).revision).toBe(revision)
 await page.evaluate(()=>{const target=document.documentElement as HTMLElement&{savedRequest?:()=>Promise<void>};target.savedRequest=target.requestFullscreen;target.requestFullscreen=()=>Promise.reject(new Error('Test denied'))})
 await page.getByRole('button',{name:'Browser fullscreen',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'Browser fullscreen was not permitted'})).toBeVisible();await expect(editor).toHaveAttribute('data-map-expanded','true')
 await page.evaluate(()=>{const target=document.documentElement as HTMLElement&{savedRequest?:()=>Promise<void>};target.requestFullscreen=target.savedRequest!;delete target.savedRequest})
 await page.getByRole('button',{name:'Restore View',exact:true}).click()
 await page.getByRole('button',{name:'Browser fullscreen',exact:true}).click();await expect(page.getByRole('button',{name:'Exit browser fullscreen',exact:true})).toBeVisible()
 await page.evaluate(()=>document.exitFullscreen());await expect(page.getByRole('button',{name:'Browser fullscreen',exact:true})).toBeVisible();await expect(editor).toHaveAttribute('data-map-expanded','true')
 // Inspector state and DOM survive; native dialogs remain in the browser top layer.
 if(await page.getByRole('button',{name:'Show map inspector',exact:true}).isVisible())await page.getByRole('button',{name:'Show map inspector',exact:true}).click()
 await page.getByRole('button',{name:'Map mode',exact:true}).click();expect(await cameraState(page)).toEqual(before);await page.getByRole('button',{name:'Editor mode',exact:true}).click();await expect(image.getByLabel('Horizontal image offset',{exact:true})).toHaveValue('2.75')
 await editor.getByRole('button',{name:'Draw wall',exact:true}).click();await page.keyboard.press('Escape');await expect(editor.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true')
 await editor.getByRole('button',{name:'Add Object',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add Object',exact:true});await expect(dialog).toBeVisible();expect(await dialog.evaluate(node=>node.matches(':modal'))).toBe(true)
 await page.keyboard.press('w');await expect(editor.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0)
 // Select the actual GLB through the resized canvas, using a triangle interior.
 const modelPoint=await page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{
  const resource=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))!,{_roots}=await import(/* @vite-ignore */resource.name),state=_roots.get(node).store.getState();state.scene.updateMatrixWorld(true)
  let point:{x:number;y:number;z:number}|null=null
  state.scene.traverse((group:{name:string;traverse:(fn:(mesh:{isMesh?:boolean;geometry?:{attributes:{position:{count:number;getX:(i:number)=>number;getY:(i:number)=>number;getZ:(i:number)=>number}}};position:{clone:()=>{set:(x:number,y:number,z:number)=>{applyMatrix4:(m:unknown)=>{x:number;y:number;z:number}}}};matrixWorld:unknown})=>void)=>void})=>{if(group.name==='scenery-placement-transform'&&!point)group.traverse(mesh=>{const a=mesh.geometry?.attributes.position;if(mesh.isMesh&&a&&a.count>=3&&!point){const p=mesh.position.clone().set((a.getX(0)+a.getX(1)+a.getX(2))/3,(a.getY(0)+a.getY(1)+a.getY(2))/3,(a.getZ(0)+a.getZ(1)+a.getZ(2))/3).applyMatrix4(mesh.matrixWorld);point={x:p.x,y:p.y,z:p.z}}})});return point!
 })
 const modelPixel=await projectBattlefield(page,modelPoint);await page.mouse.click(modelPixel.x,modelPixel.y)
 await expect(editor.getByRole('region',{name:'Selected scenery properties',exact:true})).toBeVisible();await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Restore View',exact:true}).click();await expect(image.getByLabel('Horizontal image offset',{exact:true})).toHaveValue('2.75')
 // Create a usable link by picking squares through the existing editor surface.
 await editor.getByRole('button',{name:'Transitions',exact:true}).click();const transitions=editor.getByRole('region',{name:'Transition editor',exact:true})
 await transitions.getByLabel('Transition name',{exact:true}).fill('Warehouse office stairs');await transitions.getByLabel('destination floor',{exact:true}).selectOption(towerId)
 await transitions.getByRole('button',{name:'Pick source square on map',exact:true}).click();await page.keyboard.press('Escape');await expect(editor.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true')
 await transitions.getByRole('button',{name:'Pick source square on map',exact:true}).click();let point=await projectBattlefield(page,{x:-7.5,y:.002,z:-7.5});await page.mouse.click(point.x,point.y)
 await expect(transitions.getByLabel('source X',{exact:true})).toHaveValue('2');await expect(transitions.getByLabel('source Z',{exact:true})).toHaveValue('2')
 await transitions.getByRole('button',{name:'Pick destination square on map',exact:true}).click();point=await projectBattlefield(page,{x:-9.5,y:2.002,z:-9.5});await page.mouse.click(point.x,point.y)
 await expect(transitions.getByLabel('destination X',{exact:true})).toHaveValue('0');await expect(transitions.getByLabel('destination Z',{exact:true})).toHaveValue('0')
 const retainedView=await cameraState(page)
 await page.getByRole('button',{name:'Tracker',exact:true}).click();await page.getByRole('button',{name:'Map editor',exact:true}).click()
 await expect(page.getByLabel('Active level',{exact:true})).toHaveValue(towerId);await expect(transitions.getByLabel('Transition name',{exact:true})).toHaveValue('Warehouse office stairs');expect(await cameraState(page)).toEqual(retainedView)
 await transitions.getByLabel('Transition DM notes',{exact:true}).fill('Secret office key')
 await transitions.getByRole('button',{name:'Save transition',exact:true}).click();await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.transitions?.length).toBe(1)
 const link=(await api(page,path+'/snapshot')).state.dungeonMap.transitions[0]
 await expect(player.locator('[data-transition-marker]')).toHaveCount(1)
 const publicState=await api(player,path+'/snapshot');expect(publicState.state.dungeonMap.transitions[0].dmNotes).toBeUndefined()
 // Hide the destination while the DM still inspects it. The player's route disappears.
 const tower=editor.getByRole('region',{name:'Level: Tower',exact:true});await tower.getByLabel('Tower player visibility',{exact:true}).uncheck();await tower.getByRole('button',{name:'Apply level settings',exact:true}).click();await expect(player.locator('[data-transition-marker]')).toHaveCount(0)
 await page.getByLabel('Active level',{exact:true}).selectOption('ground')
 await page.getByRole('button',{name:'Battle map',exact:true}).click();await page.locator('.map-initiative-list button').filter({hasText:'Hero 1'}).click()
 await page.locator('.transition-travel-tools > summary').click();await page.getByRole('button',{name:'Move through Warehouse office stairs',exact:true}).click()
 const travel=page.getByRole('dialog',{name:'Move through transition',exact:true});await expect(travel).toContainText('Tower');await expect(travel).toContainText('destination is hidden')
 await expect(travel.getByRole('button',{name:'Confirm transfer',exact:true})).toBeDisabled();await travel.getByLabel('Combatant is not on the source square. Allow this transfer.',{exact:true}).check();await travel.getByLabel('Destination is occupied. Allow tokens to stack.',{exact:true}).check()
 const hero=(await api(page,path+'/snapshot')).state.combatants.find((c:{id:number})=>c.id===1)
 await travel.getByRole('button',{name:'Confirm transfer',exact:true}).click();await expect(travel).toHaveCount(0);await expect(page.getByLabel('Active level',{exact:true})).toHaveValue(towerId)
 let snapshot=await api(page,path+'/snapshot');expect(snapshot.state.combatants.find((c:{id:number})=>c.id===1)).toEqual({...hero,floorId:towerId});expect(snapshot.state.battleMap.tokens['1']).toEqual({x:0,z:0})
 expect(snapshot.state.dungeonMap.levels.find((l:{id:string})=>l.id===towerId).playerVisible).toBe(false);await expect(player.locator('.map-initiative-list button')).toHaveCount(0)
 // Reveal remains a separate DM decision through level settings.
 await page.getByRole('button',{name:'Map editor',exact:true}).click();const towerPanel=editor.getByRole('region',{name:'Level: Tower',exact:true});await towerPanel.getByLabel('Tower player visibility',{exact:true}).check();await towerPanel.getByRole('button',{name:'Apply level settings',exact:true}).click()
 await player.getByLabel('Active level',{exact:true}).selectOption(towerId);await expect(player.locator('.map-initiative-list button')).toHaveCount(2)
 const playerCamera=await cameraState(player),playerRevision=(await api(page,path+'/snapshot')).revision;await player.getByRole('button',{name:'Expand Map',exact:true}).click();await expect(player.getByRole('button',{name:'Restore View',exact:true})).toBeVisible();expect(await cameraState(player)).toEqual(playerCamera)
 await expect(player.getByRole('button',{name:'Editor mode',exact:true})).toHaveCount(0);await expect(player.getByRole('button',{name:/Move through Warehouse/})).toHaveCount(0);expect(await editor.getAttribute('data-map-expanded')).toBeNull()
 await player.setViewportSize({width:768,height:1024});expect(await player.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await player.getByRole('button',{name:'Restore View',exact:true}).click();await expect(player.getByLabel('Active level',{exact:true})).toHaveValue(towerId);expect((await api(page,path+'/snapshot')).revision).toBe(playerRevision)
 await player.reload();await player.getByLabel('Active level',{exact:true}).selectOption(towerId);await expect(player.locator('.map-initiative-list button')).toHaveCount(2)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await page.getByRole('button',{name:'Redo map edit',exact:true}).click();snapshot=await api(page,path+'/snapshot');expect(snapshot.state.dungeonMap.transitions[0]).toEqual(link)
}
