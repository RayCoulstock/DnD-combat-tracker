import { test, expect, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const { csrf } = await (await fetch('/api/session')).json()
    const r = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }, { path, body })
}
test('local ledger, DM and two browsers, camera isolation and offline camera', async ({ browser, page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Goblin Ambush' })).toBeVisible()
  await page.getByRole('button', { name: 'Damage', exact: true }).click() // empty amount does not change HP
  await page.getByLabel('Hit point amount').fill('2')
  await page.getByRole('button', { name: 'Damage', exact: true }).click()
  await expect(page.locator('.vitals-label')).toContainText('35')
  await page.getByRole('button', { name: '3D Map', exact: true }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await page.getByRole('button', { name: 'Multiplayer', exact: true }).click()
  await page.getByLabel('Email', { exact: true }).fill(`dm-${randomUUID()}@example.test`)
  await page.getByLabel('Password (12+ characters)', { exact: true }).fill('Browser Test Password 2049!')
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await page.getByLabel('New campaign', { exact: true }).fill('Browser campaign')
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click()
  await expect(page.getByLabel('New encounter', { exact: true })).toBeVisible()
  const fixture = { version: 1, round: 1, combatants: [
    { id: 1, name: 'Browser hero', short: 'BH', side: 'hero', hp: 10, maxHp: 10, ac: 15, initiative: 18, conditions: [], saves: [], actions: [] },
    { id: 2, name: 'Private monster', short: 'PM', side: 'enemy', hp: 20, maxHp: 20, ac: 18, initiative: 10, conditions: [], saves: [], actions: [], visible: false, privateNotes: 'Private browser secret' },
  ] }
  await page.getByLabel('New encounter', { exact: true }).fill('Browser encounter')
  await page.getByLabel('Optional encounter JSON').setInputFiles({ name: 'encounter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await page.getByRole('button', { name: 'Create / import encounter', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Browser encounter', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Start multiplayer session', exact: true }).click()
  await expect(page.locator('.connection')).toHaveText('Connected')
  const campaignId = await page.getByRole('combobox', { name: 'Campaign', exact: true }).inputValue()
  const contexts = [await browser.newContext(), await browser.newContext()]
  const players: Page[] = []
  try {
    for (const [index, context] of contexts.entries()) {
      const invitation = await api(page, `/campaigns/${campaignId}/invitations`, {})
      const player = await context.newPage(); players.push(player)
      player.on('pageerror', e => errors.push(e.message))
      await player.goto(invitation.url)
      await player.getByLabel('Display name').fill(`Player ${index + 1}`)
      await expect(player.getByRole('button', { name: 'Join campaign', exact: true })).toBeEnabled()
      await player.getByRole('button', { name: 'Join campaign', exact: true }).click()
      await expect(player.locator('.connection')).toHaveText('Connected')
      await expect(player.locator('canvas')).toBeVisible()
      await expect(player.getByText('Private monster', { exact: true })).toHaveCount(0)
      await expect(player.getByRole('button', { name: 'Next turn' })).toHaveCount(0)
      await expect(player.getByRole('button', { name: 'Invite player' })).toHaveCount(0)
    }
    await page.getByText('Token ownership, visibility and combatant settings', { exact: true }).click()
    await page.getByRole('combobox', { name: 'Owner', exact: true }).first().selectOption({ label: 'Player 1' })
    await expect(players[0].locator('.online-card').filter({ hasText: '10/10 HP · AC 15' })).toBeVisible()
    // A real floor click moves the assigned token, and all authorised views receive it.
    const canvas = players[0].locator('canvas')
    const box = await canvas.boundingBox(); expect(box).not.toBeNull()
    await players[0].mouse.click(box!.x + box!.width * 0.55, box!.y + box!.height * 0.65)
    await expect.poll(async () => (await api(page, `/campaigns/${campaignId}/snapshot`)).revision).toBeGreaterThan(1)
    const before0 = await canvas.screenshot()
    const before1 = await players[1].locator('canvas').screenshot()
    await players[0].mouse.move(box!.x + box!.width * 0.6, box!.y + box!.height * 0.4)
    await players[0].mouse.down(); await players[0].mouse.move(box!.x + box!.width * 0.8, box!.y + box!.height * 0.5, { steps: 20 }); await players[0].mouse.up()
    await players[0].waitForTimeout(600) // allow OrbitControls damping to settle
    expect((await canvas.screenshot()).equals(before0)).toBe(false)
    expect((await players[1].locator('canvas').screenshot()).equals(before1)).toBe(true)
    const rotated = await canvas.screenshot()
    await contexts[0].setOffline(true)
    await expect(players[0].locator('.connection')).toHaveText('Reconnecting')
    await players[0].getByRole('button', { name: 'Reset camera', exact: true }).click()
    expect((await canvas.screenshot()).equals(rotated)).toBe(false) // camera reset works without a connection
    await contexts[0].setOffline(false)
    await expect(players[0].locator('.connection')).toHaveText('Connected')
    expect(errors).toEqual([])
  } catch (error) { for (const player of players) console.log((await player.locator('body').innerText()).slice(0,2500)); throw error } finally { for (const c of contexts) await c.close() }
})
