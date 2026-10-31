import {test,expect,type Page} from '@playwright/test'
import {projectBattlefield} from './workspace-helpers'
const fixture='/e2e/fixtures/ui-foundations.html'
async function camera(page:Page){return page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{for(const resource of performance.getEntriesByType('resource').filter(r=>r.name.includes('/@react-three_fiber.js')).reverse()){const module=await import(resource.name),state=module._roots.get(node)?.store.getState();if(state?.controls)return{position:state.camera.position.toArray(),target:state.controls.target.toArray()}}throw new Error('No mounted camera')})}

test('action menu supports keyboard navigation, disabled entries, selection and focus return',async({page})=>{
 await page.goto(fixture)
 const trigger=page.getByRole('button',{name:'Example actions',exact:true})
 await trigger.focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Alpha action',exact:true})).toBeFocused()
 await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Beta action',exact:true})).toBeFocused()
 await page.keyboard.press('End');await expect(page.getByRole('menuitem',{name:'Remove sample',exact:true})).toBeFocused()
 await page.keyboard.press('Home');await expect(page.getByRole('menuitem',{name:'Alpha action',exact:true})).toBeFocused()
 await page.keyboard.press('b');await page.keyboard.press('Enter');await expect(page.getByLabel('Selected action',{exact:true})).toHaveText('Beta')
 await expect(trigger).toBeFocused();await expect(trigger).toHaveAttribute('aria-expanded','false')
 await page.keyboard.press('ArrowUp');await expect(page.getByRole('menuitem',{name:'Remove sample',exact:true})).toBeFocused()
 await page.keyboard.press('Tab');await expect(page.getByRole('menu',{name:'Example actions',exact:true})).toHaveCount(0)
 await trigger.click();await page.getByRole('button',{name:'Toggle menu availability',exact:true}).click();await expect(trigger).toHaveAttribute('aria-expanded','false');await expect(trigger).toBeEnabled();await page.getByRole('button',{name:'Toggle menu availability',exact:true}).click();await expect(trigger).toBeDisabled();await expect(trigger).toHaveAttribute('aria-expanded','false')
 await page.getByRole('button',{name:'Toggle menu availability',exact:true}).click();await expect(trigger).toHaveAttribute('aria-expanded','false')
})

test('split button keeps primary and menu actions separate and supports the non-native popover fallback',async({page})=>{
 await page.addInitScript(()=>{Object.defineProperty(HTMLElement.prototype,'showPopover',{configurable:true,value:undefined});Object.defineProperty(HTMLElement.prototype,'hidePopover',{configurable:true,value:undefined})})
 await page.goto(fixture)
 await page.getByRole('button',{name:'Run primary action',exact:true}).click();await expect(page.getByLabel('Primary actions',{exact:true})).toHaveText('1')
 await page.getByRole('button',{name:'More primary actions',exact:true}).click();await page.getByRole('menuitem',{name:'Beta action',exact:true}).click()
 await expect(page.getByLabel('Primary actions',{exact:true})).toHaveText('1');await expect(page.getByLabel('Selected action',{exact:true})).toHaveText('Beta')
 await page.getByRole('button',{name:'Example form',exact:true}).click();await expect(page.getByLabel('Popover name',{exact:true})).toBeFocused()
 await page.getByLabel('Popover name',{exact:true}).fill('Local form');await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Example form',exact:true})).toBeFocused()
 await page.getByRole('button',{name:'Example form',exact:true}).click();await page.getByRole('button',{name:'Run primary action',exact:true}).click();await expect(page.getByRole('dialog',{name:'Example form',exact:true})).toHaveCount(0)
})

test('drawer traps modal focus, preserves drafts and defaults buttons to non-submit; nested Escape closes only the top layer',async({page})=>{
 await page.goto(fixture);const trigger=page.getByRole('button',{name:'Open example drawer',exact:true});await trigger.click()
 const drawer=page.getByRole('dialog',{name:'Example drawer',exact:true})
 await drawer.getByLabel('Drawer notes',{exact:true}).fill('Unsaved local draft')
 await drawer.getByRole('button',{name:'Non-submit button',exact:true}).click();await expect(drawer.getByLabel('Submissions',{exact:true})).toHaveText('0')
 await drawer.getByRole('button',{name:'Submit example form',exact:true}).click();await expect(drawer.getByLabel('Submissions',{exact:true})).toHaveText('1')
 await drawer.getByRole('button',{name:'Drawer actions',exact:true}).click();await expect(page.getByRole('menu',{name:'Drawer actions',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(drawer).toBeVisible()
 await drawer.getByRole('button',{name:'Drawer form',exact:true}).click();await page.getByLabel('Drawer popover field',{exact:true}).fill('fwde');await page.keyboard.press('Escape');await expect(drawer).toBeVisible()
 await drawer.getByRole('button',{name:'Open nested picker',exact:true}).click();await expect(page.getByRole('dialog',{name:'Nested picker',exact:true})).toBeVisible();await page.keyboard.press('Escape')
 await expect(page.getByRole('dialog',{name:'Nested picker',exact:true})).toHaveCount(0);await expect(drawer).toBeVisible();await expect(drawer.getByRole('button',{name:'Open nested picker',exact:true})).toBeFocused()
 for(let i=0;i<10;i++){await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.activeElement?.closest('dialog[open]')?.getAttribute('aria-label'))).toBe('Example drawer')}
 await page.keyboard.press('Escape');await expect(drawer).not.toBeVisible();await expect(trigger).toBeFocused()
 await trigger.click();await expect(drawer.getByLabel('Drawer notes',{exact:true})).toHaveValue('Unsaved local draft')
})

test('inspector collapse keeps its form draft mounted',async({page})=>{
 await page.goto(fixture);await page.getByLabel('Inspector notes',{exact:true}).fill('Unapplied calibration')
 const summary=page.locator('summary').filter({hasText:'Example inspector'});await summary.click();await expect(page.getByLabel('Inspector notes',{exact:true})).not.toBeVisible();await summary.click();await expect(page.getByLabel('Inspector notes',{exact:true})).toHaveValue('Unapplied calibration')
})

test('foundation overlays do not change an existing canvas, camera, editor tool, revision or network state',async({page})=>{
 await page.goto(fixture);await page.getByRole('button',{name:'Map editor',exact:true}).click()
 await page.locator('.inspector summary').filter({hasText:'New blank map'}).click();await page.getByRole('button',{name:'Create blank map',exact:true}).click()
 await projectBattlefield(page,{x:0,y:0,z:0})
 const canvas=page.locator('.battlefield-wrap canvas:visible'),handle=await canvas.elementHandle(),pose=await camera(page),header=page.locator('.inspector-header p').last(),revision=await header.textContent()
 await page.getByRole('button',{name:'Paint floor',exact:true}).click()
 const writes:string[]=[],sockets:string[]=[];page.on('request',r=>{if(r.method()==='POST'&&r.url().includes('/api/'))writes.push(r.url())});page.on('websocket',socket=>sockets.push(socket.url()))
 await page.getByRole('button',{name:'Example actions',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Paint floor',exact:true})).toHaveAttribute('aria-pressed','true')
 await page.getByRole('button',{name:'Example actions',exact:true}).click()
 const square=await projectBattlefield(page,{x:2.5,y:0,z:2.5});await page.mouse.click(square.x,square.y);await expect(page.getByRole('menu',{name:'Example actions',exact:true})).toHaveCount(0)
 await page.getByRole('button',{name:'Open example drawer',exact:true}).click();await page.getByLabel('Drawer notes',{exact:true}).fill('No server command');await page.keyboard.press('Escape')
 await expect(header).toHaveText(revision!);expect(await canvas.evaluate((node,previous)=>node===previous,handle)).toBe(true);expect(await camera(page)).toEqual(pose);expect(writes).toEqual([]);expect(sockets).toEqual([])
})

test('adopted miniature surface fits responsive widths and content zoom with named, touch-sized controls',async({page})=>{
 await page.goto(fixture);await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Open miniature sample',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Miniature settings for Sample character',exact:true})
 for(const width of [1440,1280,768,390]){
  await page.setViewportSize({width,height:1000});await expect(dialog).toBeVisible()
  expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
  for(const button of await dialog.locator('.ledger-button').all()){const box=(await button.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(40);expect(box.width).toBeGreaterThanOrEqual(40)}
 }
 // CSS content zoom checks reflow; it is not claimed to replace browser-UI zoom.
 await page.setViewportSize({width:1280,height:1000});await page.evaluate(()=>{document.documentElement.style.zoom='2'})
 expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true)
 await expect(dialog.getByRole('button',{name:'Save miniature',exact:true})).toBeVisible();expect(await dialog.locator('.ledger-surface').evaluate(node=>getComputedStyle(node).color)).toBe('rgb(31, 29, 26)')
})
