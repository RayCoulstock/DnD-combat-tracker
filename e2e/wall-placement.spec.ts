import { randomUUID } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import { blankDungeon, canonicalWall } from '../shared/dungeon'
import { multiplayerMode } from './shell-helpers'
import { mapAction, projectBattlefield } from './workspace-helpers'

async function wallScene(page: Page) {
  return page.locator('.battlefield-wrap canvas:visible').evaluate(async node => {
    const resources = performance.getEntriesByType('resource').filter(entry => entry.name.includes('/@react-three_fiber.js')).reverse()
    for (const resource of resources) {
      const { _roots } = await import(/* @vite-ignore */resource.name)
      const scene = _roots.get(node)?.store.getState().scene
      if (!scene) continue
      const walls: number[][] = [], previews: number[][] = []
      scene.traverse((object: {
        isInstancedMesh?: boolean; count: number; instanceMatrix: { array: Float32Array };
        material?: { color?: { getHexString(): string } };
        position: { x: number; y: number; z: number };
      }) => {
        const color = object.material?.color?.getHexString()
        if (object.isInstancedMesh && color === '666c6b') {
          for (let i = 0; i < object.count; i++) {
            walls.push(Array.from(object.instanceMatrix.array.slice(i * 16 + 12, i * 16 + 15)))
          }
        }
        if (color === '70c8ff' && object.position.y === .1) previews.push([object.position.x, object.position.z])
      })
      return { walls, previews }
    }
    return { walls: [], previews: [] }
  })
}

test('the previewed edge can be drawn behind an existing wall', async ({ page }) => {
  const existing = canonicalWall(11, 11, 'north')
  const map = { ...blankDungeon('wall-placement', 'Wall placement', 20, 20), walls: [existing] }
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({
    name: 'walls.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ version: 1, round: 1, combatants: [], dungeonMap: map })),
  })
  await page.getByRole('button', { name: 'Map editor', exact: true }).click()
  await mapAction(page, 'Draw wall')
  const point = await projectBattlefield(page, { x: .5, y: .002, z: .07 }, { editorTool: 'wall' })
  await page.mouse.move(point.x, point.y)
  await expect.poll(async () => (await wallScene(page)).previews).toEqual([[.5, 0]])
  await expect.poll(async () => (await wallScene(page)).walls).toEqual([[1.5, expect.closeTo(.8), 1]])
  await page.mouse.click(point.x, point.y)
  await expect.poll(async () => (await wallScene(page)).walls).toEqual([[1.5, expect.closeTo(.8), 1], [.5, expect.closeTo(.8), 0]])

  await page.mouse.click(point.x, point.y)
  await expect(page.getByRole('toolbar', { name: 'Logical wall controls' })).toBeVisible()
  await expect.poll(async () => (await wallScene(page)).walls.length).toBe(2)

  await mapAction(page, 'Wall line')
  const vertex = await projectBattlefield(page, { x: -2, y: .025, z: -2 }, { editorTool: 'wall-line' })
  await page.mouse.click(vertex.x, vertex.y)
  await expect(page.getByRole('alert')).toHaveText('Drag at least one grid edge.')
  await expect.poll(async () => (await wallScene(page)).walls.length).toBe(2)
})

async function api(page: Page, path: string, body?: unknown) {
  return page.evaluate(async ({ path, body }) => {
    const { csrf } = await (await fetch('/api/session')).json()
    const response = await fetch('/api' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(await response.text())
    return response.json()
  }, { path, body })
}

test('built-in wall commits, history, persistence and player rendering through 1,000 walls', async ({ page, browser }) => {
  test.setTimeout(240_000)
  const checkpoints = [25, 50, 100, 250, 500, 1000]
  const base = blankDungeon('wall-scale', 'Wall scale', 50, 50)
  const terrain = { id: randomUUID(), kind: 'paint', points: [{ x: 25, z: 25 }], brush: { size: 2, opacity: 1, softness: .5 }, texture: { assetId: 'builtin:stone', repeatEverySquares: 1, rotation: 0 } }
  const lower = {
    ...base, id: 'basement', name: 'Basement', elevationFeet: -10, playerVisible: true,
    props: [{ id: 'crate', type: 'crate', position: { x: 25, z: 26 }, rotation: 0 }],
    terrainPaint: [terrain], floorSurface: { mode: 'texture', texture: terrain.texture }, walls: [canonicalWall(26, 26, 'north')],
  }
  const { schemaVersion: version, ...basement } = lower
  void version
  const map = {
    ...base, schemaVersion: 5, level: { id: 'ground', name: 'Ground', elevationFeet: 0, playerVisible: true },
    levels: [basement],
  }
  const target = canonicalWall(25, 25, 'north')
  const candidates = Array.from({ length: 1000 }, (_, i) => canonicalWall(i % 50, Math.floor(i / 50), 'north'))
  await page.goto('/')
  await api(page, '/auth/register', { email: randomUUID() + '@example.test', password: 'Wall Placement Browser Test 2049!' })
  const campaign = await api(page, '/campaigns', { name: 'Wall placement' })
  const path = '/campaigns/' + campaign.id
  await api(page, path + '/encounters', { name: 'Wall scale', file: { version: 1, round: 1, combatants: [], dungeonMap: map } })
  await api(page, path + '/session', { active: true })
  const invite = await api(page, path + '/invitations', {})
  await multiplayerMode(page)
  await page.getByRole('combobox', { name: 'Campaign', exact: true }).selectOption(campaign.id)
  await expect(page.locator('.connection')).toHaveText('Connected')
  await page.getByRole('button', { name: 'Map editor', exact: true }).click()

  const playerContext = await browser.newContext()
  try {
    const player = await playerContext.newPage()
    await player.goto(invite.url)
    await player.getByLabel('Display name').fill('Dungeon explorer')
    await player.getByRole('button', { name: 'Join campaign', exact: true }).click()
    await expect(player.locator('.connection')).toHaveText('Connected')

    for (const count of checkpoints) {
      await test.step(`${count} wall segments`, async () => {
        // Seed each checkpoint one wall short. The final segment is always added in the editor.
        const walls = [...basement.walls, ...candidates.slice(0, count - 2)]
        const encounter = await api(page, path + '/encounters', {
          name: `Walls ${count}`, file: { version: 1, round: 1, combatants: [], dungeonMap: { ...map, levels: [{ ...basement, walls }] } },
        })
        const selectBasement = (viewer: Page) => viewer.getByLabel('Active level', { exact: true }).selectOption('basement')
        await selectBasement(page)
        await selectBasement(player)
        await mapAction(page, 'Draw wall')
        const point = await projectBattlefield(page, { x: .5, y: -1.998, z: .07 }, { editorTool: 'wall' })
        await page.mouse.move(point.x, point.y)
        await expect.poll(async () => (await wallScene(page)).previews).toEqual([[.5, 0]])

        const verify = async (expected: typeof walls) => {
          const snapshot = await api(page, path + '/snapshot')
          expect(snapshot.encounterId).toBe(encounter.id)
          expect(snapshot.state.dungeonMap.walls).toEqual([])
          expect(snapshot.state.dungeonMap.levels[0].walls).toEqual(expected)
          expect(snapshot.state.dungeonMap.levels[0].props).toEqual(basement.props)
          await expect.poll(async () => (await wallScene(page)).walls.length).toBe(expected.length)
          await expect.poll(async () => (await wallScene(player)).walls.length).toBe(expected.length)
        }
        await page.mouse.click(point.x, point.y)
        await expect.poll(async () => (await api(page, path + '/snapshot')).state.dungeonMap.levels[0].walls.length).toBe(count)
        await verify([...walls, target])
        expect((await wallScene(page)).walls).toContainEqual([.5, expect.closeTo(.8), 0])
        await page.getByRole('button', { name: 'Undo map edit', exact: true }).click()
        await expect.poll(async () => (await wallScene(player)).walls.length).toBe(count - 1)
        await verify(walls)
        await page.getByRole('button', { name: 'Redo map edit', exact: true }).click()
        await expect.poll(async () => (await wallScene(player)).walls.length).toBe(count)
        await verify([...walls, target])
        await player.reload()
        await expect(player.locator('.connection')).toHaveText('Connected')
        await selectBasement(player)
        await verify([...walls, target])
      })
    }
  } finally {
    await playerContext.close()
  }
})
