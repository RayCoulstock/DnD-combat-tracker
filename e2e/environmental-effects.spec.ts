import {test,expect,type Page} from '@playwright/test'
import {blankDungeon} from '../shared/dungeon'
import {sessionAction} from './shell-helpers'
import {clickBattlefield} from './workspace-helpers'
async function effects(page:Page){return page.locator('canvas:visible').evaluate(async node=>{
 for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){
 const m=await import(/* @vite-ignore */url),s=m._roots.get(node)?.store.getState();if(!s?.internal.active)continue
 const list:{name:string;count:number;scale:number;alpha:number}[]=[];s.scene.traverse((o:{name:string;isPoints?:boolean;geometry:{attributes:{position:{count:number}}};parent:{scale:{x:number}};material:{uniforms:{alpha:{value:number}}}})=>{if(o.isPoints&&o.name.startsWith('environmental-effect:'))list.push({name:o.name,count:o.geometry.attributes.position.count,scale:o.parent.scale.x,alpha:o.material.uniforms.alpha.value})});return {list,memory:s.gl.info.memory,uuid:s.scene.uuid}
 }return {list:[],memory:{geometries:0,textures:0},uuid:''}
})}
test('effects placement, appearance, history, reduced-motion and resource cleanup',async({page})=>{
 await page.emulateMedia({reducedMotion:'reduce'});await page.setViewportSize({width:1600,height:1000});await page.goto('/')
 const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'effects.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:4,combatants:[],dungeonMap:blankDungeon('effects','Effects')}))})
 await page.getByRole('button',{name:'Map editor',exact:true}).click();await page.getByRole('button',{name:'Effects tool',exact:true}).click()
 const library=page.getByRole('region',{name:'Effects library',exact:true});await expect(library.getByLabel('Effect category')).toBeFocused()
 const before=await effects(page)
 await library.getByRole('button',{name:'Place Magical motes',exact:true}).click();await clickBattlefield(page,{x:-4.5,y:.01,z:-3.5})
 await expect.poll(async()=>(await effects(page)).list.length).toBe(1)
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'Low quality',exact:true}).click();await expect.poll(async()=>(await effects(page)).list[0]?.count).toBe(12)
 await page.getByRole('button',{name:'Rendering quality',exact:true}).click();await page.getByRole('menuitem',{name:'High quality',exact:true}).click();await expect.poll(async()=>(await effects(page)).list[0]?.count).toBe(64)
 const props=page.getByRole('region',{name:'Effect properties',exact:true});await props.getByLabel('Effect scale',{exact:true}).fill('2');await props.getByLabel('Effect opacity',{exact:true}).fill('.4');await props.getByRole('button',{name:'Apply effect',exact:true}).click()
 await expect.poll(async()=>(await effects(page)).list[0]).toMatchObject({scale:2,alpha:.4})
 await props.getByRole('button',{name:'Duplicate effect',exact:true}).click();await expect.poll(async()=>(await effects(page)).list.length).toBe(2)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await expect.poll(async()=>(await effects(page)).list.length).toBe(1)
 await page.getByRole('button',{name:'Redo map edit',exact:true}).click();await expect.poll(async()=>(await effects(page)).list.length).toBe(2)
 await props.getByRole('button',{name:'Delete effect',exact:true}).click();await page.getByRole('dialog',{name:'Delete effect',exact:true}).getByRole('button',{name:'Delete effect',exact:true}).click();await expect.poll(async()=>(await effects(page)).list.length).toBe(1)
 await library.getByRole('button',{name:'Place Magical motes',exact:true}).click();await page.keyboard.press('Escape');await clickBattlefield(page,{x:1.5,y:.01,z:1.5});await expect.poll(async()=>(await effects(page)).list.length).toBe(1)
 // Removing the final effect returns the owned geometry count to the baseline.
 await page.getByRole('button',{name:'Effects tool',exact:true}).click()
 await library.getByRole('button',{name:'Magical motes · Enabled',exact:true}).click()
 await props.getByRole('button',{name:'Delete effect',exact:true}).click();await page.getByRole('dialog',{name:'Delete effect',exact:true}).getByRole('button',{name:'Delete effect',exact:true}).click()
 await expect.poll(async()=>(await effects(page)).list.length).toBe(0)
 await expect.poll(async()=>(await effects(page)).memory.geometries).toBeLessThanOrEqual(before.memory.geometries)
 expect((await effects(page)).uuid).toBe(before.uuid)
 await page.setViewportSize({width:1024,height:768});await page.getByRole('button',{name:'Effects tool',exact:true}).click();await expect(library.getByLabel('Effect category')).toBeVisible()
 await page.screenshot({path:'work/effects-tablet.png'})
})
