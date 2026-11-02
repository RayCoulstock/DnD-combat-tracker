import {multiplayerMode} from './shell-helpers'
import {test,expect} from '@playwright/test'
test('closed registration is reflected in the sign-in screen without removing player invitation access',async({page})=>{
  // UI contract only; server-side denial and existing identity flows use real PostgreSQL integration tests.
  await page.route('**/api/session',route=>route.fulfill({json:{csrf:'test-csrf',actor:null,campaignId:null,allowDMRegistration:false}}))
  await page.goto('/');await multiplayerMode(page)
  await expect(page.getByText('DM registration is closed for the private beta.',{exact:false})).toBeVisible()
  await expect(page.getByRole('button',{name:'Create account',exact:true})).toHaveCount(0)
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled()
  await page.goto('/?beta-invite#invite='+'a'.repeat(43))
  await expect(page.getByLabel('Display name',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Join campaign',exact:true})).toBeEnabled()
})
