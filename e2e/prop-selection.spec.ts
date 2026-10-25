import { test, expect } from '@playwright/test'
import { PerspectiveCamera, Vector3 } from 'three'

test('placed chairs and tables can be selected and rotated', async ({ page }) => {
  await page.goto('/')
  const file = { version: 1, round: 1, combatants: [], dungeonMap: {
    schemaVersion: 1, id: 'selection', name: 'Furniture selection', width: 20, height: 20, theme: 'stone-dungeon', floors: [], walls: [], doors: [], props: [
      { id: 'chair', type: 'chair', position: { x: 8, z: 10 }, rotation: 0 },
      { id: 'table', type: 'table', position: { x: 12, z: 10 }, rotation: 0 },
    ],
  } }
  await page.locator('input[type=file]').first().setInputFiles({ name: 'furniture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) })
  await page.getByRole('button', { name: 'Map editor', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Dungeon map: Furniture selection', exact: true })).toBeVisible()
  const canvas = page.locator('canvas:visible')
  const tools = page.locator('.builder-tools:visible')
  for (const prop of file.dungeonMap.props) {
    // Click the occupied cell outside the thin seat/tabletop geometry.
    await canvas.scrollIntoViewIfNeeded()
    const box = (await canvas.boundingBox())!
    const camera = new PerspectiveCamera(42, box.width / box.height, .1, 300)
    camera.position.set(12, 14, 12); camera.lookAt(0, 0, 0); camera.updateMatrixWorld()
    const point = new Vector3(prop.position.x - 9.1, 0, prop.position.z - 9.1).project(camera)
    await page.mouse.click(box.x + (point.x + 1) * box.width / 2, box.y + (1 - point.y) * box.height / 2)
    await expect(tools.getByText(`Selected prop: ${prop.id}`, { exact: true })).toBeVisible()
    const floating=page.getByRole('toolbar',{name:prop.type+' controls',exact:true});await expect(floating).toBeVisible();for(const name of ['Move','Rotate','Scale','Duplicate','Delete','Properties'])await expect(floating.getByRole('button',{name,exact:true})).toBeEnabled()
    await tools.getByRole('button', { name: 'Rotate selected object', exact: true }).click()
  }
  // Verify rotation changes domain state, rather than merely displaying controls.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const stream = await (await downloadPromise).createReadStream(), chunks: Buffer[] = []
  for await (const chunk of stream) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.dungeonMap.props.map((p: { id: string; rotation: number }) => [p.id, p.rotation])).toEqual([['chair', 90], ['table', 90]])
})
