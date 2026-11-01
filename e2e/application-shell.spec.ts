import {test,expect} from '@playwright/test'
import {projectBattlefield,battlefieldView} from './workspace-helpers'
import {multiplayerMode,sessionAction,library} from './shell-helpers'

test('local two-row shell preserves encounter and canvas through menus, help and responsive layout',async({page})=>{
 await page.goto('/')
 await expect(page.getByRole('banner',{name:'Application bar',exact:true})).toHaveCount(1)
 await expect(page.getByRole('region',{name:'Session bar',exact:true})).toHaveCount(1)
 await expect(page.locator('.ledger-round')).toHaveText('Round 3')
 await page.getByRole('button',{name:'Next turn',exact:true}).click();await expect(page.locator('.initiative-item.selected')).toContainText('Goblin Boss')
 for(let turn=0;turn<4;turn++)await page.getByRole('button',{name:'Next turn',exact:true}).click();await expect(page.locator('.ledger-round')).toHaveText('Round 4')
 await page.getByRole('button',{name:'Battle map',exact:true}).click();await projectBattlefield(page,{x:0,y:0,z:0})
 const canvas=page.locator('.battlefield-wrap canvas:visible'),handle=await canvas.elementHandle()
 await page.getByRole('button',{name:'Top-down',exact:true}).click();const pose=await battlefieldView(page)
 await page.getByRole('button',{name:'Tracker',exact:true}).click();await expect(page.locator('.ledger-retained-map')).toBeHidden();await page.getByRole('button',{name:'Battle map',exact:true}).click();expect(await canvas.evaluate((node,previous)=>node===previous,handle)).toBe(true);expect(await battlefieldView(page)).toEqual(pose)
 await page.getByRole('button',{name:'Session',exact:true}).focus();await page.keyboard.press('ArrowDown');await expect(page.getByRole('menuitem',{name:'Import encounter',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Session',exact:true})).toBeFocused()
 await page.getByRole('button',{name:'Help and keyboard shortcuts',exact:true}).click();await expect(page.getByRole('dialog',{name:'Help and keyboard shortcuts',exact:true})).toContainText('V / F / W / D / O / E');await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Expand Map',exact:true}).click();await page.getByRole('button',{name:'Encounter tracker',exact:true}).click();await expect(page.locator('body')).not.toHaveClass(/map-viewport-expanded/);await page.getByRole('button',{name:'Battle map',exact:true}).click();expect(await canvas.evaluate((node,previous)=>node===previous,handle)).toBe(true)
 for(const width of [1440,1280,1024,768,390,320]){
  await page.setViewportSize({width,height:1000});await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  const bars=await page.locator('[data-ui-zone=A], [data-ui-zone=B]:visible').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().height));expect(bars).toEqual([56,64])
  await expect(page.getByRole('button',{name:'Next turn',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Session',exact:true}).click();await expect(page.getByRole('menuitem',{name:'Export encounter',exact:true})).toBeVisible();await page.keyboard.press('Escape')
 }
 await page.setViewportSize({width:1280,height:900});await library(page,'Map templates · current table');await expect(page.locator('[data-ui-section=map-templates]')).toHaveAttribute('open','');await page.getByRole('button',{name:'Draw wall',exact:true}).click();await multiplayerMode(page);await page.getByRole('button',{name:'Sign in',exact:true}).focus();await page.keyboard.press('e');await page.getByRole('button',{name:'Table mode',exact:true}).click();await page.getByRole('menuitem',{name:'Local tracker',exact:true}).click();await expect(page.getByRole('button',{name:'Draw wall',exact:true})).toHaveAttribute('aria-pressed','true');expect(await canvas.evaluate((node,previous)=>node===previous,handle)).toBe(true);await page.getByRole('button',{name:'Battle map',exact:true}).click();await page.screenshot({path:'/tmp/shell-local-1280.png'})
})

test('mode navigation retains the local encounter; session import and export keep their existing file paths',async({page})=>{
 await page.goto('/');await page.getByLabel('Hit point amount',{exact:true}).fill('2');await page.getByRole('button',{name:'Damage',exact:true}).click()
 const hp=await page.locator('.vitals-label').textContent()
 await multiplayerMode(page);await expect(page.getByLabel('Email',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Table mode',exact:true}).click();await page.getByRole('menuitem',{name:'Local tracker',exact:true}).click();await expect(page.locator('.vitals-label')).toHaveText(hp!)
 const download=page.waitForEvent('download');await sessionAction(page,'Export encounter');expect((await download).suggestedFilename()).toBe('encounter-ledger-round-3.json')
 const chooser=page.waitForEvent('filechooser');await sessionAction(page,'Import encounter');await(await chooser).setFiles({name:'shell.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({version:1,round:7,combatants:[]}))});await expect(page.locator('.ledger-round')).toHaveText('Round 7')
 await expect(page.getByRole('button',{name:'Next turn',exact:true})).toBeDisabled()
})
