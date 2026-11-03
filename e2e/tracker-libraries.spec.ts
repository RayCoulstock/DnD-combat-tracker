import {test,expect} from '@playwright/test'
import {combatantAction} from './shell-helpers'
test.use({actionTimeout:15000})
test('tracker editing, contextual actions, round progression, confirmation focus and responsive roster',async({page})=>{
 await page.goto('/');const tracker=page.locator('.tracker-workspace:visible'),roster=tracker.getByRole('complementary',{name:'Initiative roster',exact:true})
 await expect(tracker).toHaveAttribute('data-roster-expanded','true');await expect(roster.getByRole('button',{name:'Fenra Ashwood · Initiative 18',exact:true})).toHaveAttribute('aria-current','step')
 await page.getByLabel('Hit point amount',{exact:true}).fill('3');await page.getByRole('button',{name:'Damage',exact:true}).click();await expect(page.locator('.vitals-label')).toContainText('34')
 await page.getByRole('button',{name:'Add condition',exact:true}).click();await page.getByRole('dialog',{name:'Add condition',exact:true}).getByRole('button',{name:'Blinded',exact:true}).click();await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Add condition',exact:true})).toBeFocused()
 await tracker.locator('.action').first().click();await expect(tracker.locator('.action').first()).toHaveAttribute('aria-pressed','true')
 await combatantAction(page,'Edit combatant');const edit=page.getByRole('dialog',{name:'Edit combatant',exact:true});await edit.getByLabel('Name',{exact:true}).fill('Fenra Bright');await edit.getByLabel('Initiative',{exact:true}).fill('20');await edit.getByLabel('Max HP',{exact:true}).fill('50');await edit.getByLabel('DM notes',{exact:true}).fill('Private tracker note');await edit.getByRole('button',{name:'Update combatant',exact:true}).click();await expect(edit).not.toBeVisible();await expect(tracker.getByRole('heading',{name:'Fenra Bright',exact:true})).toBeVisible()
 await combatantAction(page,'Remove combatant');const confirmation=page.getByRole('dialog',{name:'Remove combatant',exact:true});await expect(confirmation.getByRole('button',{name:'Cancel',exact:true})).toBeFocused();await page.keyboard.press('Escape');await expect(confirmation).toHaveCount(0);await expect(tracker.getByRole('heading',{name:'Fenra Bright',exact:true})).toBeVisible()
 for(let i=0;i<5;i++)await page.getByRole('button',{name:'Next turn',exact:true}).click();await expect(page.locator('[data-ui-zone=B2]:visible .ledger-round')).toHaveText('Round 4')
 for(const width of [1600,1280,1024,768,390,320]){await page.setViewportSize({width,height:900});const hide=page.getByRole('button',{name:'Collapse initiative roster',exact:true});if(await hide.isVisible())await hide.click();await expect(tracker).toHaveAttribute('data-roster-expanded','false');await expect(page.getByRole('button',{name:'Show initiative roster',exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(await page.evaluate(()=>document.documentElement.scrollHeight<=innerHeight)).toBe(true)}
 await page.reload();await expect(page.locator('.tracker-workspace:visible')).toHaveAttribute('data-roster-expanded','false')
})

