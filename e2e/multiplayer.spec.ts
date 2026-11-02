import {multiplayerMode,sessionAction,openSetup,closeSetup} from './shell-helpers'
import {expandEditor} from './workspace-helpers'
import { test, expect, type Page, type Locator } from '@playwright/test'
import { randomUUID } from 'node:crypto'
async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const { csrf } = await (await fetch('/api/session')).json()
    const r = await fetch(`/api${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) })
    if (!r.ok) throw new Error(await r.text())
    return r.json()
  }, { path, body })
}
// Compare rendered views with a small rasterisation/damping tolerance, without extra dependencies.
async function imageDifference(page: Page, before: Buffer, after: Buffer): Promise<number> {
  return page.evaluate(async ({ before, after }) => {
    const decode = async (value: string) => {
      const bytes = Uint8Array.from(atob(value), c => c.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(bitmap, 0, 0)
      bitmap.close()
      return ctx.getImageData(0, 0, canvas.width, canvas.height)
    }
    const a = await decode(before), b = await decode(after)
    if (a.width !== b.width || a.height !== b.height) return 255
    let difference = 0
    for (let i = 0; i < a.data.length; i++) difference += Math.abs(a.data[i] - b.data[i])
    return difference / a.data.length
  }, { before: before.toString('base64'), after: after.toString('base64') })
}
// Software WebGL can render slowly with several canvases; wait for actual damping
// convergence rather than assuming a fixed number of milliseconds means a settled view.
async function settledView(page: Page, canvas: Locator) {
  let previous = await canvas.screenshot(), stable = 0
  await expect.poll(async () => {
    const next = await canvas.screenshot()
    const difference = await imageDifference(page, previous, next)
    stable = difference < .05 ? stable + 1 : 0
    previous = next
    return stable
  }, { intervals: [500], timeout: 20000 }).toBeGreaterThanOrEqual(2)
  return previous
}
test('local ledger, DM and two browsers, camera isolation and offline camera', async ({ browser, page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await expect(page.getByText('Local encounter',{exact:true})).toBeVisible()
  await page.getByRole('button', { name: 'Damage', exact: true }).click() // empty amount does not change HP
  await page.getByLabel('Hit point amount').fill('2')
  await page.getByRole('button', { name: 'Damage', exact: true }).click()
  await expect(page.locator('.vitals-label')).toContainText('35')
  await page.getByRole('button', { name: 'Battle map', exact: true }).click()
  await expect(page.locator('canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Reset camera', exact: true }).click()
  await multiplayerMode(page)
  await page.getByLabel('Email', { exact: true }).fill(`dm-${randomUUID()}@example.test`)
  await page.getByLabel('Password (12+ characters)', { exact: true }).fill('Browser Test Password 2049!')
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Create account', exact: true }).click();await openSetup(page)
  await page.getByLabel('New campaign', { exact: true }).fill('Browser campaign')
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click()
  await expect(page.getByLabel('New encounter', { exact: true })).toBeEnabled()
  const fixture = { version: 1, round: 1, combatants: [
    { id: 1, name: 'Browser hero', short: 'BH', side: 'hero', hp: 10, maxHp: 10, ac: 15, initiative: 18, conditions: [], saves: [], actions: [] },
    { id: 2, name: 'Private monster', short: 'PM', side: 'enemy', hp: 20, maxHp: 20, ac: 18, initiative: 10, conditions: [], saves: [], actions: [], visible: false, privateNotes: 'Private browser secret' },
  ] }
  await page.getByLabel('New encounter', { exact: true }).fill('Browser encounter')
  await page.getByLabel('Optional encounter JSON').setInputFiles({ name: 'encounter.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(fixture)) })
  await page.getByRole('button', { name: 'Create / import encounter', exact: true }).click()
  await expect(page.getByRole('combobox',{name:'Encounter',exact:true}).locator('option:checked')).toHaveText('Browser encounter')
  await sessionAction(page,'Start multiplayer session')
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
    await openSetup(page);await page.getByRole('combobox', { name: /^Controlled by / }).first().selectOption({ label: 'Player 1' })
    await closeSetup(page);await expect(players[0].locator('.online-card').filter({ hasText: '10/10 HP · AC 15' })).toBeVisible()
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

test('waiting players see first activation and restart without refresh or camera reset', async ({ browser, page }) => {
  await page.goto('/')
  await multiplayerMode(page)
  await page.getByLabel('Email', { exact: true }).fill(`waiting-dm-${randomUUID()}@example.test`)
  await page.getByLabel('Password (12+ characters)', { exact: true }).fill('Waiting Room Password 2049!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click();await openSetup(page)
  await page.getByLabel('New campaign', { exact: true }).fill('Waiting campaign')
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click()
  await expect(page.getByLabel('New encounter', { exact: true })).toBeEnabled()
  const campaignId = await page.getByRole('combobox', { name: 'Campaign', exact: true }).inputValue()
  const contexts = [await browser.newContext(), await browser.newContext(), await browser.newContext()]
  const players: Page[] = []
  let apiRequests = 0, navigations = 0
  async function join(index: number) {
    const { url } = await api(page, `/campaigns/${campaignId}/invitations`, {})
    const player = await contexts[index].newPage(); players.push(player)
    await player.goto(url)
    await player.getByLabel('Display name').fill(`Waiting player ${index + 1}`)
    await player.getByRole('button', { name: 'Join campaign', exact: true }).click()
    await expect(player.locator('.connection')).toHaveText('Connected')
    return player
  }
  try {
    const early = await join(0) // before even creating an encounter
    await expect(early.getByText('Waiting for the DM to open and start an encounter.')).toBeVisible()
    await expect(early.locator('canvas')).toHaveCount(0)
    const file = { version: 1, round: 1, combatants: [
      { id: 1, name: 'Waiting hero', side: 'hero', hp: 10, maxHp: 10, ac: 15, initiative: 18, conditions: [], saves: [], actions: [] },
      { id: 2, name: 'Hidden waiting monster', side: 'enemy', hp: 20, maxHp: 20, ac: 18, initiative: 10, conditions: [], saves: [], actions: [], visible: false },
    ] }
    const encounter = await api(page, `/campaigns/${campaignId}/encounters`, { name: 'First activation', file })
    const waiting = await join(1) // encounter selected, but session inactive
    await expect(waiting.getByText('Waiting for the DM to open and start an encounter.')).toBeVisible()
    for (const player of [early, waiting]) {
      await expect(player.locator('canvas')).toHaveCount(0)
      player.on('request', req => { if (new URL(req.url()).pathname.startsWith('/api/')) apiRequests++ })
      player.on('framenavigated', frame => { if (frame === player.mainFrame()) navigations++ })
    }
    await sessionAction(page,'Start multiplayer session')
    for (const player of [early, waiting]) {
      await expect(player.locator('canvas')).toBeVisible({ timeout: 5000 })
      await expect(player.getByText('Hidden waiting monster', { exact: true })).toHaveCount(0)
    }
    const late = await join(2) // already-active session
    await expect(late.locator('canvas')).toBeVisible({ timeout: 5000 })
    const canvas = early.locator('canvas')
    await canvas.scrollIntoViewIfNeeded()
    const element = await canvas.elementHandle()
    const defaultView = await canvas.screenshot()
    const box = (await canvas.boundingBox())!
    await early.mouse.move(box.x + box.width * .5, box.y + box.height * .4)
    await early.mouse.down(); await early.mouse.move(box.x + box.width * .7, box.y + box.height * .5, { steps: 20 }); await early.mouse.up()
    // Wait for local OrbitControls damping to finish before comparing camera views.
    const cameraView = await settledView(early, canvas)
    expect(await imageDifference(early, defaultView, cameraView)).toBeGreaterThan(3)
    await sessionAction(page,'End session')
    await expect(canvas).toBeHidden({ timeout: 5000 })
    await expect(early.getByText('Waiting for the DM to open and start an encounter.')).toBeVisible()
    expect(await element!.evaluate(el => el.isConnected)).toBe(true)
    await expect(early.locator('.connection')).toHaveText('Connected')
    await sessionAction(page,'Start multiplayer session')
    await expect(canvas).toBeVisible({ timeout: 5000 })
    expect(await element!.evaluate(el => el.isConnected)).toBe(true)
    // ResizeObserver and the demand renderer settle after the hidden canvas becomes visible.
    await expect.poll(async () => imageDifference(early, cameraView, await canvas.screenshot())).toBeLessThan(2)
    // Rapid switches can lower the encounter revision, but never the campaign revision.
    await api(page, `/campaigns/${campaignId}/encounters`, { name: 'Temporary', file: { ...file, round: 2 } })
    await expect(early.getByRole('heading', { name: 'Round 2', exact: true })).toBeVisible({ timeout: 5000 })
    await api(page, `/campaigns/${campaignId}/open`, { encounterId: encounter.id })
    await expect(early.getByRole('heading', { name: 'Round 1', exact: true })).toBeVisible({ timeout: 5000 })
    expect(navigations).toBe(0)
    expect(apiRequests).toBe(0)
  } finally { for (const context of contexts) await context.close() }
})

test('DM paints and generates a reusable dungeon while two players see live read-only geometry', async ({ browser, page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await multiplayerMode(page)
  await page.getByLabel('Email', { exact: true }).fill(`builder-${randomUUID()}@example.test`)
  await page.getByLabel('Password (12+ characters)', { exact: true }).fill('Dungeon Builder Password 2049!')
  await page.getByRole('button', { name: 'Create account', exact: true }).click();await openSetup(page)
  await page.getByLabel('New campaign', { exact: true }).fill('Builder campaign')
  await page.getByRole('button', { name: 'Create campaign', exact: true }).click()
  await expect(page.getByLabel('New encounter', { exact: true })).toBeEnabled()
  const campaign = await page.getByRole('combobox', { name: 'Campaign', exact: true }).inputValue()
  const path = `/campaigns/${campaign}`
  const encounter = await api(page, `${path}/encounters`, { name: 'Builder encounter', file: { version: 1, round: 4, combatants: [
    { id: 1, name: 'Builder hero', side: 'hero', hp: 9, maxHp: 10, ac: 15, initiative: 15, conditions: [], saves: [], actions: [] },
  ] } })
  await sessionAction(page,'Start multiplayer session')
  const contexts = [await browser.newContext(), await browser.newContext()]
  const players: Page[] = []
  try {
    for (const [index, context] of contexts.entries()) {
      const invitation = await api(page, `${path}/invitations`, {})
      const player = await context.newPage(); players.push(player); player.on('pageerror', e => errors.push(e.message))
      await player.goto(invitation.url); await player.getByLabel('Display name').fill(`Builder player ${index + 1}`)
      await player.getByRole('button', { name: 'Join campaign', exact: true }).click()
      await expect(player.locator('.connection')).toHaveText('Connected')
      await expect(player.getByRole('button', { name: 'Map editor', exact: true })).toHaveCount(0)
    }
    await page.getByRole('button', { name: 'Map editor', exact: true }).click();await expandEditor(page)
    const tools = page.locator('.dungeon-builder:visible'), canvas = page.locator('canvas:visible')
    await tools.getByLabel('Map name', { exact: true }).fill('Hand-painted room')
    await tools.getByRole('button', { name: 'Create blank map', exact: true }).click()
    await expect(players[0].getByRole('region', { name: 'Dungeon map: Hand-painted room', exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Paint floor', exact: true }).click()
    await tools.getByLabel('Floor material', { exact: true }).selectOption('grass')
    await canvas.scrollIntoViewIfNeeded()
    let box = (await canvas.boundingBox())!
    await page.mouse.move(box.x + box.width * .45, box.y + box.height * .6)
    await page.mouse.down(); await page.mouse.move(box.x + box.width * .6, box.y + box.height * .6, { steps: 10 }); await page.mouse.up()
    await expect.poll(async () => (await api(page, `${path}/snapshot`)).state.dungeonMap.floors.length).toBeGreaterThan(1)
    const painted = await api(page, `${path}/snapshot`)
    expect(painted.state.combatants[0].hp).toBe(9)
    expect(painted.state.round).toBe(4)
    await tools.locator('.inspector summary').filter({hasText:'Generate dungeon'}).click()
    await tools.getByLabel('Random seed', { exact: true }).fill('browser-generator')
    await tools.getByLabel('Theme', { exact: true }).selectOption('mining-outpost')
    await tools.getByRole('button', { name: 'Preview dungeon', exact: true }).click()
    await expect(tools.getByText('Preview only — the encounter has not changed.')).toBeVisible()
    expect((await api(page, `${path}/snapshot`)).revision).toBe(painted.revision)
    await tools.getByRole('button', { name: 'Cancel generation', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Dungeon map: Hand-painted room', exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Preview dungeon', exact: true }).click()
    page.once('dialog', dialog => dialog.accept())
    await tools.getByRole('button', { name: 'Accept generated map', exact: true }).click()
    for (const player of players) await expect(player.getByRole('region', { name: 'Dungeon map: mining-outpost: browser-generator', exact: true })).toBeVisible()
    const generated = await api(page, `${path}/snapshot`)
    expect(generated.state.dungeonMap.walls.length).toBeGreaterThan(0)
    expect(generated.state.dungeonMap.props.length).toBeGreaterThan(0)
    expect(generated.state.combatants[0].hp).toBe(9)
    await tools.getByRole('button', { name: 'Undo map edit', exact: true }).click()
    await expect(players[1].getByRole('region', { name: 'Dungeon map: Hand-painted room', exact: true })).toBeVisible()
    await tools.getByRole('button', { name: 'Redo map edit', exact: true }).click()
    await expect(players[1].getByRole('region', { name: 'Dungeon map: mining-outpost: browser-generator', exact: true })).toBeVisible()
    await tools.getByLabel('Map name', { exact: true }).fill('Shared dungeon template')
    await tools.getByRole('button', { name: 'Save map', exact: true }).click()
    await expect(tools.getByRole('status')).toContainText('Map saved')
    await tools.getByLabel('Saved maps', { exact: true }).selectOption({ label: 'Shared dungeon template · v1' })
    page.once('dialog', dialog => dialog.accept())
    await tools.getByRole('button', { name: 'Open saved map', exact: true }).click()
    await expect(players[0].getByRole('region', { name: 'Dungeon map: Shared dungeon template', exact: true })).toBeVisible()
    const playerCanvas = players[0].locator('canvas')
    await playerCanvas.scrollIntoViewIfNeeded(); box = (await playerCanvas.boundingBox())!
    await players[0].mouse.move(box.x + box.width * .4, box.y + box.height * .4); await players[0].mouse.down(); await players[0].mouse.move(box.x + box.width * .65, box.y + box.height * .5, { steps: 20 }); await players[0].mouse.up()
    const view = await settledView(players[0], playerCanvas)
    // A combat-only server update must not rebuild/reset the map camera.
    await page.getByRole('button', { name: 'Tracker', exact: true }).click()
    await page.locator('main:visible').getByLabel('Hit point amount').fill('1'); await page.locator('main:visible').getByRole('button', { name: 'Damage', exact: true }).click()
    await expect.poll(async () => (await api(page, `${path}/snapshot`)).state.combatants[0].hp).toBe(8)
    expect(await imageDifference(players[0], view, await settledView(players[0], playerCanvas))).toBeLessThan(2)
    // Replacing the instance with the same template forces a full map snapshot;
    // geometry updates must preserve the already-rotated local camera too.
    const mapRevision = (await api(page, `${path}/snapshot`)).state.mapRevision
    await page.getByRole('button', { name: 'Map editor', exact: true }).click();await expandEditor(page)
    await tools.getByLabel('Saved maps', { exact: true }).selectOption({ label: 'Shared dungeon template · v1' })
    page.once('dialog', dialog => dialog.accept())
    await tools.getByRole('button', { name: 'Open saved map', exact: true }).click()
    await expect.poll(async () => (await api(page, `${path}/snapshot`)).state.mapRevision).toBeGreaterThan(mapRevision)
    expect(await imageDifference(players[0], view, await settledView(players[0], playerCanvas))).toBeLessThan(2)
    await contexts[0].setOffline(true); await expect(players[0].locator('.connection')).toHaveText('Reconnecting')
    await contexts[0].setOffline(false); await expect(players[0].locator('.connection')).toHaveText('Connected')
    await expect(players[0].getByRole('region', { name: 'Dungeon map: Shared dungeon template', exact: true })).toBeVisible()
    expect((await api(page, `${path}/snapshot`)).encounterId).toBe(encounter.id)
    expect(errors).toEqual([])
  } finally { for (const context of contexts) await context.close() }
})

test('local map editing, template recovery and encounter JSON stay compatible', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Map editor', exact: true }).click();await expandEditor(page)
  const tools = page.locator('.dungeon-builder:visible')
  await tools.getByLabel('Map name', { exact: true }).fill('Local reusable room')
  await tools.getByRole('button', { name: 'Create blank map', exact: true }).click()
  await tools.locator('.inspector summary').filter({hasText:'Generate dungeon'}).click()
  await tools.getByRole('button', { name: 'Preview dungeon', exact: true }).click()
  page.once('dialog', dialog => dialog.accept())
  await tools.getByRole('button', { name: 'Accept generated map', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: stone-dungeon: my-dungeon', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: 'Undo map edit', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: Local reusable room', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: 'Redo map edit', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: stone-dungeon: my-dungeon', exact: true })).toBeVisible()
  await tools.getByLabel('Map name', { exact: true }).fill('Local reusable room')
  await tools.getByRole('button', { name: 'Save map', exact: true }).click()
  await expect(tools.getByRole('status')).toContainText('Map saved')
  // Local export must retain the generated document and token placement.
  const downloadPromise = page.waitForEvent('download')
  await sessionAction(page,'Export encounter')
  const download = await downloadPromise
  const stream = await download.createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.dungeonMap.schemaVersion).toBe(1)
  expect(exported.dungeonMap.floors.length).toBeGreaterThan(0)
  expect(Object.keys(exported.battleMap.tokens).length).toBeGreaterThan(0)
  await page.reload()
  await page.getByRole('button', { name: 'Map editor', exact: true }).click();await expandEditor(page)
  await tools.getByLabel('Saved maps', { exact: true }).selectOption({ label: 'Local reusable room · v1' })
  await tools.getByRole('button', { name: 'Open saved map', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: Local reusable room', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: 'Undo map edit', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Flat battlefield', exact: true })).toBeVisible()
  await tools.getByRole('button', { name: 'Redo map edit', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: Local reusable room', exact: true })).toBeVisible()
  await page.screenshot({ path: '/tmp/dungeon-builder.png', fullPage: true })
})
