import {test,expect,type Page} from '@playwright/test'
import {blankDungeon} from '../shared/dungeon'
import {initialFog,fullMask,sampleRevealed} from '../shared/fog'
import {sessionAction} from './shell-helpers'
import {projectBattlefield,clickBattlefield,battlefieldView} from './workspace-helpers'
async function exported(page:Page){const pending=page.waitForEvent('download');await sessionAction(page,'Export encounter');const stream=await(await pending).createReadStream(),chunks:Buffer[]=[];for await(const c of stream)chunks.push(Buffer.from(c));return JSON.parse(Buffer.concat(chunks).toString())}
async function load(page:Page){
 await page.setViewportSize({width:1600,height:1000});await page.goto('/')
 const base=blankDungeon('warehouse','Warehouse',30,20),{schemaVersion,...office}=blankDungeon('office','Office',10,8);void schemaVersion
 const file={version:1,round:3,combatants:[],dungeonMap:{...base,schemaVersion:5,level:{id:'ground',name:'Ground Floor',elevationFeet:0,playerVisible:true},levels:[{...office,elevationFeet:15,playerVisible:true}],fogOfWar:initialFog()}}
 const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'warehouse.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))});await page.getByRole('button',{name:'Map editor',exact:true}).click()
 return page.getByRole('region',{name:'Fog of War settings',exact:true})
}
async function fogTool(page:Page,name:string){await page.getByRole('button',{name:'Fog tools',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();await projectBattlefield(page,{x:0,y:.002,z:0},{editorTool:'fog'})}
async function point(page:Page,x:number,z:number){return projectBattlefield(page,{x:x-15,y:.002,z:z-10},{editorTool:'fog'})}
async function drag(page:Page,a:{x:number;z:number},b:{x:number;z:number}){const start=await point(page,a.x,a.z),end=await point(page,b.x,b.z);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:4});await page.mouse.up()}
async function textures(page:Page){return page.locator('canvas:visible').evaluate(async node=>{for(const url of [...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()){const module=await import(/* @vite-ignore */url),state=module._roots.get(node)?.store.getState();if(state?.internal.active)return state.gl.info.memory.textures}throw Error('Renderer not ready')})}
const revealed=(file:Awaited<ReturnType<typeof exported>>,x:number,z:number)=>sampleRevealed(file.dungeonMap.fogOfWar,'ground',30,20,x,z)
test('D4/C3 brush reveal, conceal and radius use one exact undo entry per continuous stroke',async({page})=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));const panel=await load(page),before=await battlefieldView(page)
 await expect(page.locator('[data-ui-zone=D4]').getByRole('button',{name:'Fog tools',exact:true})).toBeVisible();await expect(page.locator('[data-ui-zone=C3]').getByRole('region',{name:'Fog of War settings',exact:true})).toBeVisible()
 await fogTool(page,'Reveal Brush');await panel.getByLabel('Fog brush radius (squares)',{exact:true}).fill('.75');await panel.getByLabel('Fog brush radius (squares)',{exact:true}).blur()
 const a=await point(page,8,8);await page.mouse.move(a.x,a.y);await page.mouse.down();const b=await point(page,14,8);await page.mouse.move(b.x,b.y,{steps:6})
 await expect(page.getByRole('button',{name:'Undo map edit',exact:true})).toBeDisabled()
 await page.mouse.up();let file=await exported(page);expect(file.mapUndoDepth).toBe(1);for(let x=8;x<=14;x+=.5)expect(revealed(file,x,8)).toBe(true);expect(revealed(file,11,10)).toBe(false)
 const mask=file.dungeonMap.fogOfWar.floors.ground
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect((await exported(page)).dungeonMap.fogOfWar.floors).toEqual({});await page.getByRole('button',{name:'Redo map edit',exact:true}).click();expect((await exported(page)).dungeonMap.fogOfWar.floors.ground).toBe(mask)
 await fogTool(page,'Conceal Brush');await drag(page,{x:11,z:8},{x:12,z:8});file=await exported(page);expect(revealed(file,11.5,8)).toBe(false);expect(revealed(file,8.5,8)).toBe(true);expect(file.mapUndoDepth).toBe(2)
 await fogTool(page,'Reveal Brush');await panel.getByLabel('Fog brush radius (squares)',{exact:true}).fill('2');await clickBattlefield(page,{x:5,y:.002,z:2},{editorTool:'fog'});file=await exported(page);expect(revealed(file,21,12)).toBe(true);expect(revealed(file,23,12)).toBe(false)
 const baseline=await textures(page);for(let i=0;i<4;i++){await page.getByRole('button',{name:'Undo map edit',exact:true}).click();await page.getByRole('button',{name:'Redo map edit',exact:true}).click()}await expect.poll(()=>textures(page)).toBeLessThanOrEqual(baseline+2)
 expect(await battlefieldView(page)).toEqual(before);expect(errors).toEqual([])
})
test('rectangles normalise reverse drags; floor actions and reset are independent with exact history',async({page})=>{
 const panel=await load(page);await fogTool(page,'Rectangle');await panel.getByLabel('Snap fog shapes to grid',{exact:true}).check();await drag(page,{x:14,z:12},{x:8,z:7});let file=await exported(page);expect(revealed(file,10,9)).toBe(true);expect(revealed(file,15,9)).toBe(false)
 await panel.getByLabel('Fog operation',{exact:true}).selectOption('conceal');await drag(page,{x:9,z:8},{x:12,z:10});file=await exported(page);expect(revealed(file,10,9)).toBe(false);expect(revealed(file,13,11)).toBe(true)
 const ground=file.dungeonMap.fogOfWar.floors.ground
 await page.getByLabel('Active level',{exact:true}).selectOption('office');await panel.getByRole('button',{name:'Reveal entire floor',exact:true}).click();file=await exported(page);expect(file.dungeonMap.fogOfWar.floors.office).toBe(fullMask(10,8));expect(file.dungeonMap.fogOfWar.floors.ground).toBe(ground)
 page.once('dialog',d=>d.dismiss());await panel.getByRole('button',{name:'Reset current floor',exact:true}).click();expect((await exported(page)).dungeonMap.fogOfWar.floors.office).toBe(fullMask(10,8))
 page.once('dialog',d=>d.accept());await panel.getByRole('button',{name:'Reset current floor',exact:true}).click();file=await exported(page);expect(file.dungeonMap.fogOfWar.floors.office).toBeUndefined();expect(file.dungeonMap.fogOfWar.floors.ground).toBe(ground)
 await page.getByRole('button',{name:'Undo map edit',exact:true}).click();expect((await exported(page)).dungeonMap.fogOfWar.floors.office).toBe(fullMask(10,8));await panel.getByRole('button',{name:'Conceal entire floor',exact:true}).click();expect((await exported(page)).dungeonMap.fogOfWar.floors.office).toBeUndefined()
 await panel.getByLabel('Fog operation',{exact:true}).selectOption('reveal');await page.getByRole('button',{name:'Top-down',exact:true}).click()
 const a=await projectBattlefield(page,{x:-13,y:3.002,z:-8},{editorTool:'fog'}),b=await projectBattlefield(page,{x:-9,y:3.002,z:-4},{editorTool:'fog'});await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.mouse.up();file=await exported(page);expect(sampleRevealed(file.dungeonMap.fogOfWar,'office',10,8,4,4)).toBe(true);expect(sampleRevealed(file.dungeonMap.fogOfWar,'office',10,8,8,7)).toBe(false)
 await page.getByLabel('Active level',{exact:true}).selectOption('ground');expect((await exported(page)).dungeonMap.fogOfWar.floors.ground).toBe(ground)
})
test('polygon explicit finish, invalid outline repair, conceal and Escape keep unfinished operations local',async({page})=>{
 const panel=await load(page);await fogTool(page,'Polygon');await expect(panel.getByRole('button',{name:'Finish polygon',exact:true})).toBeDisabled()
 for(const p of [{x:8,z:7},{x:14,z:7},{x:14,z:9},{x:10,z:9},{x:10,z:13},{x:8,z:13}])await clickBattlefield(page,{x:p.x-15,y:.002,z:p.z-10},{editorTool:'fog'})
 expect((await exported(page)).dungeonMap.fogOfWar.floors).toEqual({});await panel.getByRole('button',{name:'Finish polygon',exact:true}).click();let file=await exported(page);expect(revealed(file,9,12)).toBe(true);expect(revealed(file,12,12)).toBe(false);expect(file.mapUndoDepth).toBe(1)
 await panel.getByLabel('Fog operation',{exact:true}).selectOption('conceal');for(const p of [{x:8,z:7},{x:10,z:7},{x:10,z:9},{x:8,z:9}])await clickBattlefield(page,{x:p.x-15,y:.002,z:p.z-10},{editorTool:'fog'});await panel.getByRole('button',{name:'Finish polygon',exact:true}).click();file=await exported(page);expect(revealed(file,9,8)).toBe(false);expect(revealed(file,9,11)).toBe(true)
 for(const p of [{x:8,z:7},{x:14,z:13},{x:8,z:13},{x:14,z:7}])await clickBattlefield(page,{x:p.x-15,y:.002,z:p.z-10},{editorTool:'fog'});await panel.getByRole('button',{name:'Finish polygon',exact:true}).click();await expect(panel.getByRole('alert')).toContainText('must not cross');expect((await exported(page)).mapUndoDepth).toBe(2)
 await panel.getByRole('button',{name:'Undo vertex',exact:true}).click();await expect(panel.getByRole('button',{name:'Finish polygon',exact:true})).toBeEnabled();await panel.getByRole('button',{name:'Finish polygon',exact:true}).click();expect((await exported(page)).mapUndoDepth).toBe(3);await clickBattlefield(page,{x:-7,y:.002,z:-3},{editorTool:'fog'});await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true');expect((await exported(page)).mapUndoDepth).toBe(3)
})

test('touch and pen gestures commit once; two-touch, cancellation, camera and preview remain safe',async({page})=>{
 const panel=await load(page);await fogTool(page,'Reveal Brush');const cdp=await page.context().newCDPSession(page)
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})
 const a=await point(page,8,8),b=await point(page,12,8)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:a.x,y:a.y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:b.x,y:b.y,id:1}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]})
 let file=await exported(page);expect(file.mapUndoDepth).toBe(1);expect(revealed(file,10,8)).toBe(true)
 const before=file.dungeonMap.fogOfWar
 const c=await point(page,14,10),d=await point(page,16,10)
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:c.x,y:c.y,id:2}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:c.x,y:c.y,id:2},{x:d.x,y:d.y,id:3}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});expect((await exported(page)).dungeonMap.fogOfWar).toEqual(before)
 await cdp.send('Emulation.setTouchEmulationEnabled',{enabled:false})
 const p=await point(page,18,12),q=await point(page,20,12)
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,pointerType:'pen',x:p.x,y:p.y});await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',buttons:1,pointerType:'pen',x:q.x,y:q.y});await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,pointerType:'pen',x:q.x,y:q.y})
 file=await exported(page);expect(file.mapUndoDepth).toBe(2);expect(revealed(file,19,12)).toBe(true)
 const mask=file.dungeonMap.fogOfWar
 const start=await point(page,10,12);await page.mouse.move(start.x,start.y);await page.mouse.down();await page.keyboard.press('Escape');await page.mouse.up();expect((await exported(page)).dungeonMap.fogOfWar).toEqual(mask)
 await fogTool(page,'Rectangle');const r=await point(page,9,9),s=await point(page,13,12);await page.mouse.move(r.x,r.y);await page.mouse.down();await page.mouse.move(s.x,s.y);await page.keyboard.press('Escape');await page.mouse.up();expect((await exported(page)).dungeonMap.fogOfWar).toEqual(mask)
 await fogTool(page,'Reveal Brush');const view=await battlefieldView(page),pan=await point(page,12,10);await page.mouse.move(pan.x,pan.y);await page.mouse.down({button:'right'});await page.mouse.move(pan.x+30,pan.y+15,{steps:4});await page.mouse.up({button:'right'});expect((await exported(page)).dungeonMap.fogOfWar).toEqual(mask);expect((await battlefieldView(page)).position).not.toEqual(view.position)
 await panel.getByRole('button',{name:'Player Preview',exact:true}).click();await expect(page.getByText('Player Preview · Read only',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Fog tools',exact:true})).toHaveCount(0);expect((await exported(page)).dungeonMap.fogOfWar).toEqual(mask)
 await page.getByRole('button',{name:'Exit Player Preview',exact:true}).click();await page.setViewportSize({width:768,height:1024});await expect(panel).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 await panel.getByLabel('Fog shape',{exact:true}).selectOption('brush');const radius=panel.getByLabel('Fog brush radius (squares)',{exact:true});await radius.focus();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.type('0.5');await radius.blur();await expect(radius).toHaveValue('0.5')
 const bounds=await radius.boundingBox(),host=await panel.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(host!.width);await panel.getByRole('button',{name:'Activate Fog tool',exact:true}).focus();await page.keyboard.press('Space');await expect(panel.getByRole('button',{name:'Activate Fog tool',exact:true})).toHaveAttribute('aria-pressed','true')
})

test('floor/tool changes, explicit cancellation and blur discard drafts without changing fog or terrain',async({page})=>{
 const panel=await load(page);await fogTool(page,'Polygon')
 for(const p of [{x:8,z:7},{x:13,z:7},{x:10,z:11}])await clickBattlefield(page,{x:p.x-15,y:.002,z:p.z-10},{editorTool:'fog'})
 await page.getByLabel('Active level',{exact:true}).selectOption('office');await expect(page.getByRole('button',{name:'Select',exact:true})).toHaveAttribute('aria-pressed','true');await fogTool(page,'Polygon');await expect(panel.getByRole('button',{name:'Finish polygon',exact:true})).toBeDisabled();expect((await exported(page)).dungeonMap.fogOfWar.floors).toEqual({})
 await page.getByLabel('Active level',{exact:true}).selectOption('ground');await fogTool(page,'Polygon');await clickBattlefield(page,{x:-7,y:.002,z:-3},{editorTool:'fog'});await panel.getByRole('button',{name:'Cancel polygon',exact:true}).click();await expect(panel.getByRole('button',{name:'Finish polygon',exact:true})).toBeDisabled()
 await fogTool(page,'Reveal Brush');const a=await point(page,8,8),b=await point(page,11,8);await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:4});await page.evaluate(()=>window.dispatchEvent(new Event('blur')));await page.mouse.up();expect((await exported(page)).dungeonMap.fogOfWar.floors).toEqual({})
 await fogTool(page,'Polygon');await clickBattlefield(page,{x:-7,y:.002,z:-3},{editorTool:'fog'});await page.getByRole('button',{name:'Paint floor',exact:true}).click();await clickBattlefield(page,{x:-3.5,y:.002,z:-.5},{editorTool:'floor'});const file=await exported(page);expect(file.dungeonMap.floors).toHaveLength(1);expect(file.dungeonMap.fogOfWar.floors).toEqual({});expect(file.mapUndoDepth).toBe(1)
})
