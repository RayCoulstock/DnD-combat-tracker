import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { projectBattlefield } from './workspace-helpers'
import { makeTexturedGlb } from '../test-fixtures/glb'
async function api(page:Page,path:string,body?:unknown){
  return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const res=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!res.ok)throw new Error(await res.text());return res.json()},{path,body})
}
async function square(page:Page,x:number,z:number,width:number,height:number){
  const point=await projectBattlefield(page,{x:x-width/2+.5,y:0,z:z-height/2+.5})
  await page.mouse.click(point.x,point.y)
}
test.use({actionTimeout:15000})
test('DM imports once, assigns a default model, reuses independent monsters and reloads the library',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/');await page.getByRole('button',{name:'Multiplayer',exact:true}).click()
  await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Library Browser Password 2049!');await page.getByRole('button',{name:'Create account',exact:true}).click()
  // General library is usable before creating a campaign or opening an encounter.
  await page.getByRole('button',{name:'Combatant Library',exact:true}).click();await page.getByRole('button',{name:'Create entry',exact:true}).click()
  await page.getByLabel('Entry type',{exact:true}).selectOption('monster-template')
  await page.getByLabel('Import character or monster stat block',{exact:true}).fill('Library Goblin\nSmall humanoid AC 15 HP 12 Speed 30 ft STR 8 DEX 14 Actions Scimitar. Hit: 5 slashing damage.')
  await page.getByRole('button',{name:'Parse import',exact:true}).click();await page.getByRole('button',{name:'Save library entry',exact:true}).click();await expect(page.getByRole('dialog',{name:'Combatant Library',exact:true}).getByRole('status')).toHaveText('Library entry saved.')
  await page.getByRole('button',{name:'Close library',exact:true}).click()
  await page.getByLabel('New campaign',{exact:true}).fill('Library browser campaign');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(page.getByLabel('New encounter',{exact:true})).toBeEnabled()
  const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
  await api(page,path+'/encounters',{name:'Library encounter'})
  await expect(page.locator('.app-shell:visible').getByRole('button',{name:'Add combatant',exact:true}).first()).toBeVisible()
  const asset=await page.evaluate(async bytes=>{const{csrf}=await(await fetch('/api/session')).json();const data=new FormData();data.set('metadata',JSON.stringify({name:'Library skeleton',category:'monster'}));data.set('file',new Blob([new Uint8Array(bytes)]),'library.glb');const res=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:data});if(!res.ok)throw new Error(await res.text());return res.json()},Array.from(await makeTexturedGlb()))
  await page.locator('.app-shell:visible').getByRole('button',{name:'Add combatant',exact:true}).first().click();await page.getByRole('button',{name:'Choose from Combatant Library',exact:true}).click();await page.getByLabel('Search library',{exact:true}).fill('Library Goblin');await page.getByRole('button',{name:'Library Goblin · Monster Template',exact:true}).click()
  await page.getByRole('button',{name:'Assign / change default model',exact:true}).click();await page.getByRole('button',{name:'Browse Asset Library',exact:true}).click()
  await page.getByRole('button',{name:/Library skeleton.*monster/}).click();await page.getByRole('button',{name:'Use this model',exact:true}).click()
  await page.getByLabel('Miniature scale',{exact:true}).fill('1.5');await page.getByRole('button',{name:'Save miniature',exact:true}).click()
  await page.getByRole('button',{name:'Save library entry',exact:true}).click();await expect(page.getByRole('dialog',{name:'Combatant Library',exact:true}).getByRole('status')).toHaveText('Library entry saved.')
  await page.getByRole('button',{name:'Add to tracker only',exact:true}).click()
  let snapshot=await api(page,path+'/snapshot');expect(snapshot.state.combatants).toHaveLength(1);expect(snapshot.state.combatants[0].unplaced).toBe(true)
  await page.getByRole('button',{name:'Combatant Library',exact:true}).click();await page.getByRole('button',{name:'Library Goblin · Monster Template',exact:true}).click();await page.getByRole('button',{name:'Add to Encounter — choose square',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Click a square'})).toBeVisible();await expect(page.locator('canvas:visible')).toBeVisible()
  await square(page,8,9,snapshot.state.battleMap.width,snapshot.state.battleMap.height)
  await expect.poll(async()=>(await api(page,path+'/snapshot')).state.combatants.length).toBe(2)
  snapshot=await api(page,path+'/snapshot');const placed=snapshot.state.combatants.find((c:{unplaced:boolean})=>!c.unplaced)
  expect(snapshot.state.battleMap.tokens[placed.id]).toEqual({x:8,z:9});expect(placed.miniature.assetId).toBe(asset.id);expect(placed.miniature.scale).toBe(1.5)
  await page.reload();await page.getByRole('button',{name:'Combatant Library',exact:true}).click();await page.getByRole('button',{name:'Library Goblin · Monster Template',exact:true}).click();await expect(page.getByText(`Current model: ${asset.id}`,{exact:false})).toBeVisible()
  await page.getByRole('button',{name:'Duplicate entry',exact:true}).click();await page.getByRole('button',{name:'Save library entry',exact:true}).click();await expect(page.getByRole('button',{name:'Library Goblin Copy · Monster Template',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Archive entry',exact:true}).click();await expect(page.getByRole('button',{name:'Library Goblin Copy · Monster Template',exact:true})).toHaveCount(0)
  expect(errors).toEqual([])
})
