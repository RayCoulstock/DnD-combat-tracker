import {multiplayerMode,sessionAction,openSetup} from './shell-helpers'
import {expandEditor} from './workspace-helpers'
import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {PerspectiveCamera,Vector3} from 'three'
import {makeTexturedGlb} from '../test-fixtures/glb'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json()},{path,body})}
async function point(page:Page,x:number,z:number,click=true){const canvas=page.locator('canvas:visible');await canvas.scrollIntoViewIfNeeded();const b=(await canvas.boundingBox())!,camera=new PerspectiveCamera(42,b.width/b.height,.1,300);camera.position.set(12,14,12);camera.lookAt(0,0,0);camera.updateMatrixWorld();const p=new Vector3(x-9.5,.002,z-9.5).project(camera);await page.mouse.move(b.x+(p.x+1)*b.width/2,b.y+(1-p.y)*b.height/2);if(click)await page.mouse.click(b.x+(p.x+1)*b.width/2,b.y+(1-p.y)*b.height/2)}
test('DM places and edits shared GLB scenery with preview, history, templates and two live players',async({page,browser})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/');await multiplayerMode(page);await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Scenery Browser Password 2049!');await page.getByRole('button',{name:'Create account',exact:true}).click();await openSetup(page)
  await page.getByLabel('New campaign',{exact:true}).fill('Scenery campaign');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
  const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
  const asset=await page.evaluate(async bytes=>{const{csrf}=await(await fetch('/api/session')).json();const d=new FormData();d.set('metadata',JSON.stringify({name:'Meshy barrel',category:'furniture'}));d.set('file',new Blob([new Uint8Array(bytes)]),'barrel.glb');const r=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:d});if(!r.ok)throw new Error(await r.text());return r.json()},Array.from(await makeTexturedGlb()))
  const file={version:1,round:4,combatants:[{id:1,name:'Scenery hero',side:'hero',hp:9,maxHp:10,ac:15,initiative:15,conditions:[],saves:[],actions:[],miniature:{assetId:asset.id}}]}
  await api(page,path+'/encounters',{name:'Scenery encounter',file});await sessionAction(page,'Start multiplayer session')
  const contexts=[await browser.newContext(),await browser.newContext()],players:Page[]=[];let downloads=0
  try{
    for(const[index,context]of contexts.entries()){const invite=await api(page,path+'/invitations',{}),player=await context.newPage();players.push(player);player.on('pageerror',e=>errors.push(e.message));if(index===0)player.on('request',r=>{if(new URL(r.url()).pathname===`/api/assets/${asset.id}/file`)downloads++});await player.goto(invite.url);await player.getByLabel('Display name').fill('Scenery player '+index);await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected');await expect(player.getByRole('button',{name:'Add Object',exact:true})).toHaveCount(0)}
    await page.getByRole('button',{name:'Map editor',exact:true}).click();await expandEditor(page);const tools=page.locator('.dungeon-builder:visible')
    await tools.getByLabel('Map name',{exact:true}).fill('Furnished room');await tools.getByRole('button',{name:'Create blank map',exact:true}).click()
    await tools.getByRole('button',{name:'Add Object',exact:true}).click();const picker=page.getByRole('dialog',{name:'Add Object',exact:true})
    await picker.getByLabel('Search assets',{exact:true}).fill('barrel');await picker.getByRole('button',{name:'Search library',exact:true}).click();await picker.getByLabel('Filter category',{exact:true}).selectOption('furniture');await picker.locator('.asset-card').click();await expect(picker.locator('canvas')).toBeVisible();await picker.getByRole('button',{name:'Use this model',exact:true}).click();await expect(picker).toHaveCount(0)
    const prior=(await api(page,path+'/snapshot')).revision
    await point(page,5,5,false);expect((await api(page,path+'/snapshot')).revision).toBe(prior)
    await point(page,5,5);await point(page,8,5);await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(2);await expect(players[0].locator('[data-miniature-state=ready]')).toHaveCount(1);expect(downloads).toBe(1)
    // Escape must cancel placement even when a focused inspector control consumes
    // the bubbling key event (as embedded inspector controls can do).
    const snapControl=tools.getByLabel('Snap scenery to grid',{exact:true})
    await expect(snapControl).toBeEnabled()
    await snapControl.evaluate(node=>node.addEventListener('keydown',event=>event.stopPropagation(),{once:true}))
    await snapControl.focus();await expect(snapControl).toBeFocused()
    await page.keyboard.press('Escape');await expect(tools.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true')
    await point(page,5,5);const props=tools.getByRole('region',{name:'Selected scenery properties',exact:true})
    await props.getByLabel('Scenery X',{exact:true}).fill('7.25');await props.getByLabel('Scenery Z',{exact:true}).fill('8.5');await props.getByLabel('Scenery rotation (degrees)',{exact:true}).fill('45');await props.getByLabel('Scenery scale',{exact:true}).fill('2');await props.getByLabel('Scenery vertical offset',{exact:true}).fill('.25');await props.getByRole('button',{name:'Apply scenery transform',exact:true}).click()
    await expect.poll(async()=>(await api(page,path+'/snapshot')).state.dungeonMap.props[0].position.x).toBe(7.25)
    await tools.getByLabel('Snap scenery to grid',{exact:true}).uncheck();await props.getByRole('button',{name:'Move scenery on map',exact:true}).click();await point(page,10.3,11.2)
    await expect.poll(async()=>Math.abs((await api(page,path+'/snapshot')).state.dungeonMap.props[0].position.x-10.3)).toBeLessThan(.03)
    await props.getByLabel('Visible to players',{exact:true}).uncheck();await props.getByRole('button',{name:'Apply scenery transform',exact:true}).click();await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(1)
    await props.getByLabel('Visible to players',{exact:true}).check();await props.getByRole('button',{name:'Apply scenery transform',exact:true}).click();await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(2)
    await props.getByRole('button',{name:'Duplicate scenery',exact:true}).click();await expect(players[1].locator('[data-scenery-state=ready]')).toHaveCount(3)
    const changed=await api(page,path+'/snapshot');expect(changed.state.dungeonMap.props[1].scale).toBe(1);expect(changed.state.dungeonMap.props[0].scale).toBe(2);expect(changed.state.round).toBe(4);expect(changed.state.combatants[0].hp).toBe(9)
    await props.getByRole('button',{name:'Delete scenery',exact:true}).click();await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(2)
    await tools.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(3);await tools.getByRole('button',{name:'Redo map edit',exact:true}).click();await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(2)
    await tools.getByLabel('Map name',{exact:true}).fill('Reusable furnished room');await tools.getByRole('button',{name:'Save map',exact:true}).click();await expect(tools.getByRole('status')).toContainText('Map saved')
    await tools.getByLabel('Saved maps',{exact:true}).selectOption({label:'Reusable furnished room · v1'});page.once('dialog',d=>d.accept());await tools.getByRole('button',{name:'Open saved map',exact:true}).click();await expect(players[0].getByRole('region',{name:'Dungeon map: Reusable furnished room',exact:true})).toBeVisible();expect(downloads).toBe(1)
    await contexts[0].setOffline(true);await expect(players[0].locator('.connection')).toHaveText('Reconnecting');await contexts[0].setOffline(false);await expect(players[0].locator('.connection')).toHaveText('Connected');await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(2)
    // A furnished import exercises 25 instances sharing the same parsed/downloaded GLB.
    const current=await api(page,path+'/snapshot'),source=current.state.dungeonMap.props[0]
    const furnished={...current.state,dungeonMap:{...current.state.dungeonMap,props:Array.from({length:25},(_,i)=>({...source,id:'barrel-'+i,position:{x:2+i%5*3,z:2+Math.floor(i/5)*3},scale:1,verticalOffset:0}))}}
    await api(page,path+'/encounters',{name:'Twenty-five barrels',file:furnished});await expect(players[0].locator('[data-scenery-state=ready]')).toHaveCount(25);expect(downloads).toBe(2) // New encounter has a new authorisation/cache scope.
    await page.getByRole('button',{name:'Battle map',exact:true}).click();await expect(page.locator('main:visible [data-scenery-state=ready]')).toHaveCount(25);await page.screenshot({path:'/tmp/custom-scenery.png',fullPage:true})
    await api(page,path+'/encounters',{name:'Missing scenery',file:{...file,dungeonMap:{...current.state.dungeonMap,props:[{...source,assetId:randomUUID()}]}}})
    await expect(players[0].getByText('Model unavailable',{exact:true})).toBeVisible();await expect(players[0].locator('canvas')).toBeVisible();await expect(players[0].locator('.connection')).toHaveText('Connected')
    expect(errors).toEqual([])
  }finally{for(const context of contexts)await context.close()}
})
