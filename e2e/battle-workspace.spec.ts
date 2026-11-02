import {test,expect} from '@playwright/test'
import {battlefieldView,mapAction} from './workspace-helpers'

test('six dock ownership, collapse preferences and retained renderer across responsive/fullscreen changes',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());await page.goto('/');await page.getByRole('button',{name:'Map editor',exact:true}).click()
 const workspace=page.locator('.dungeon-builder:visible'),shell=workspace.locator('.tabletop-shell'),canvas=shell.locator('canvas'),inspector=page.getByRole('complementary',{name:'Contextual inspector',exact:true})
 await expect(canvas).toBeVisible();const original=await canvas.elementHandle(),view=await battlefieldView(page)
 await expect(shell).toHaveAttribute('data-roster-expanded','false');await expect(inspector).toBeVisible()
 await expect(shell.locator('[data-ui-zone^=D]')).toHaveCount(6)
 for(const width of [1600,1280,1024,768]){await page.setViewportSize({width,height:1000});await battlefieldView(page);await shell.locator('[data-ui-zone=D6] summary').click({trial:true});await shell.getByRole('button',{name:'History',exact:true}).click({trial:true});await shell.getByRole('button',{name:'Map view',exact:true}).click({trial:true});await shell.getByRole('button',{name:'Reset camera',exact:true}).click({trial:true})}
 await page.setViewportSize({width:1600,height:1000})
 await page.getByRole('button',{name:'Wall tools',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Rectangle room',exact:true})).toBeVisible();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Wall tools',exact:true})).toBeFocused()
 await page.getByRole('button',{name:'Encounter Ledger — Table',exact:true}).focus();await page.keyboard.press('[');await expect(shell).toHaveAttribute('data-roster-expanded','true');await page.keyboard.press('[');await expect(shell).toHaveAttribute('data-roster-expanded','false')
 await inspector.getByRole('button',{name:'Hide panel »',exact:true}).click();await expect(inspector).toBeHidden()
 for(const width of [1600,1280,1024,768,390]){
  await page.setViewportSize({width,height:1000});await battlefieldView(page)
  const rects=await shell.locator('[data-ui-zone^=D]').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return{zone:node.getAttribute('data-ui-zone'),x:r.x,y:r.y,right:r.right,bottom:r.bottom}}))
  for(const r of rects){expect(r.x,r.zone!).toBeGreaterThanOrEqual(0);expect(r.right,r.zone!).toBeLessThanOrEqual(width);expect(r.y,r.zone!).toBeGreaterThanOrEqual(120);expect(r.bottom,r.zone!).toBeLessThanOrEqual(1000)}
  for(let i=0;i<rects.length;i++)for(let j=i+1;j<rects.length;j++){const a=rects[i],b=rects[j];expect(Math.min(a.right,b.right)>Math.max(a.x,b.x)&&Math.min(a.bottom,b.bottom)>Math.max(a.y,b.y),`${width}: ${a.zone}/${b.zone} overlap`).toBe(false)}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
 }
 await page.setViewportSize({width:1600,height:1000});await mapAction(page,'Expand Map');await expect(workspace).toHaveAttribute('data-map-expanded','true');await expect(inspector).toBeHidden();await page.getByRole('button',{name:'Show inspector «',exact:true}).click();await expect(inspector).toBeVisible();await page.getByRole('button',{name:'Restore View',exact:true}).click()
 expect(await canvas.evaluate((node,previous)=>node===previous,original)).toBe(true);expect(await battlefieldView(page)).toEqual(view)
 await page.getByRole('button',{name:'Expand roster',exact:true}).click();await page.reload();await page.getByRole('button',{name:'Map editor',exact:true}).click();await expect(page.locator('.tabletop-shell:visible')).toHaveAttribute('data-roster-expanded','true')
})

test('combatant inspector reuses HP and conditions handlers; panels preserve form drafts',async({page})=>{
 await page.setViewportSize({width:1600,height:1000});await page.emulateMedia({reducedMotion:'reduce'});await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort());await page.goto('/');await page.getByRole('button',{name:'Battle map',exact:true}).click()
 const roster=page.getByRole('complementary',{name:'Combatant roster',exact:true}),inspector=page.getByRole('complementary',{name:'Contextual inspector',exact:true})
 await roster.getByRole('button',{name:'Fenra Ashwood',exact:true}).click();await expect(inspector).toBeVisible();await inspector.getByLabel('Map hit point amount',{exact:true}).fill('3');await inspector.getByRole('button',{name:'Damage',exact:true}).click();await expect(inspector).toContainText('34/45 HP')
 await inspector.getByRole('button',{name:'Add condition',exact:true}).click();await inspector.getByRole('button',{name:'Blinded',exact:true}).click();await expect(inspector.locator('.chips')).toContainText('Blinded')
 await page.getByRole('button',{name:'Map editor',exact:true}).click();const templates=page.locator('.inspector [data-ui-section=map-templates]');await templates.locator('summary').click();await templates.getByLabel('Template name',{exact:true}).fill('Unsaved workspace draft')
 await page.getByRole('button',{name:'Battle map',exact:true}).click();await page.getByRole('button',{name:'Map editor',exact:true}).click();await inspector.getByRole('button',{name:'Hide panel »',exact:true}).click();await page.getByRole('button',{name:'Show inspector «',exact:true}).click();await expect(templates.getByLabel('Template name',{exact:true})).toHaveValue('Unsaved workspace draft')
 await expect(page.locator('.inspector')).toContainText('Editing');await expect(page.locator('.inspector')).toContainText('This level');await expect(page.locator('.inspector')).toContainText('Map')
})
