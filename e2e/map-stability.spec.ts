import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('native modal covers depth labels and blocks pointer, focus and map shortcuts', async ({page}) => {
  await page.goto('/')
  const file = {version:1,round:1,battleMap:{version:1,width:20,height:20,gridSizeFeet:5,showGrid:true,showLabels:true,tokens:{"1":{x:8,z:8}}},combatants:[{id:1,name:'Label regression',side:'hero',hp:10,maxHp:10,ac:10,initiative:10,conditions:[],saves:[],actions:[]}],dungeonMap:{schemaVersion:2,id:'stability',name:'Stability',width:20,height:20,theme:'stone-dungeon',floors:[],walls:[{id:'H:9:9',x:9,z:9,axis:'H',material:'stone'}],doors:[{id:'door',wallId:'H:9:9',state:'locked'}],props:[{id:randomUUID(),type:'asset',assetId:randomUUID(),position:{x:10,z:10},scale:1,rotation:0,verticalOffset:0,visible:true}]}}
  await page.locator('input[type=file]').first().setInputFiles({name:'stability.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(file))})
  await page.getByRole('button',{name:'Map editor',exact:true}).click()
  await expect(page.locator('.token-label').filter({hasText:'Label regression'})).toBeVisible()
  await expect(page.locator('[data-door-state=locked]')).toBeVisible()
  await expect(page.locator('.token-label').filter({hasText:'Model unavailable'})).toBeVisible()
  const button=page.getByRole('button',{name:'Add Object',exact:true}),canvas=page.locator('.battlefield-wrap canvas:visible')
  const original=await canvas.elementHandle()
  await button.click()
  const modal=page.getByRole('dialog',{name:'Add Object',exact:true})
  await expect(modal).toBeVisible()
  expect(await modal.evaluate(node=>node.matches(':modal'))).toBe(true)
  // Hit-test at every map label: the browser top layer must own those pixels.
  expect(await page.locator('.token-label').evaluateAll(labels=>labels.every(label=>{const r=label.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return Boolean(hit?.closest('dialog'))}))).toBe(true)
  const topDown=page.getByRole('button',{name:'Top-down',exact:true}),box=(await topDown.boundingBox())!
  await topDown.evaluate(node=>node.addEventListener('click',()=>{node.setAttribute('data-activated','true')}))
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2)
  await expect(topDown).not.toHaveAttribute('data-activated','true')
  await topDown.evaluate(node=>node.focus());expect(await modal.evaluate(node=>node.contains(document.activeElement))).toBe(true)
  await page.keyboard.press('w');await page.keyboard.press('Delete')
  await expect(modal).toBeVisible()
  await page.keyboard.press('Escape');await expect(modal).toHaveCount(0)
  expect(await original!.evaluate(node=>node===document.querySelector('.battlefield-wrap canvas'))).toBe(true)
  await topDown.click();await expect(topDown).toHaveAttribute('data-activated','true')
  await expect(page.locator('[data-door-state=locked]')).toBeVisible()
})

test('preview and map support a valid three-4K-texture GLB, independent transforms, request retry and unmount', async ({page}) => {
  const {makeTexturedGlb} = await import('../test-fixtures/glb')
  const bytes = await makeTexturedGlb(4096,3)
  const {validateGlb}=await import('../server/asset-glb')
  const {assetLimits}=await import('../server/asset-config')
  await validateGlb(bytes,assetLimits({}))
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message))
  let downloads=0, fail=false
  await page.route('**/api/assets/00000000-0000-4000-8000-000000000051/file*', async route=>{
    downloads++
    if(fail){fail=false;await route.fulfill({status:503,body:'temporarily unavailable'});return}
    await route.fulfill({status:200,contentType:'model/gltf-binary',body:bytes})
  })
  await page.goto('/')
  await page.evaluate(async()=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default,{createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,{Canvas}=await import('/node_modules/.vite/deps/@react-three_fiber.js')
    const {default:Model}=await import('/src/SharedModel3D.tsx'),{default:Preview}=await import('/src/AssetPreview3D.tsx')
    const el=React.createElement,container=document.createElement('div');container.style.cssText='position:fixed;inset:0;background:white;z-index:99';document.body.append(container)
    const root=createRoot(container)
    const asset={id:'00000000-0000-4000-8000-000000000051',presentation:{defaultScale:1,defaultRotation:0,verticalOffset:0}}
    const render=(preview:boolean)=>root.render(preview?el(Preview,{asset}):el(Canvas,{camera:{position:[3,3,3]}},el('ambientLight',{intensity:2}),...[1,2].map(n=>el('group',{key:n,name:`placement-${n}`,position:[n-1,0,0]},el(Model,{url:'/api/assets/00000000-0000-4000-8000-000000000051/file#test-user',transform:{scale:n,rotation:45*n,verticalOffset:n/4},fallback:null})))) )
    Object.assign(window,{stabilityRender:render,stabilityUnmount:()=>root.unmount()});render(true)
  })
  await expect(page.getByRole('region',{name:'3D asset preview'})).toBeVisible()
  await page.evaluate(()=>window.stabilityRender(false))
  await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(2)
  expect(downloads).toBe(2) // One preview lease, one map lease for both placements.
  const transforms=await page.locator('canvas').last().evaluate(async node=>{
    const {_roots}=await import('/node_modules/.vite/deps/@react-three_fiber.js'),scene=_roots.get(node).store.getState().scene
    return [1,2].map(n=>{const transform=scene.getObjectByName(`placement-${n}`).children[0];return{scale:transform.scale.x,rotation:transform.rotation.y,offset:transform.position.y}})
  })
  expect(transforms).toEqual([{scale:1,rotation:Math.PI/4,offset:.25},{scale:2,rotation:Math.PI/2,offset:.5}])
  await page.evaluate(()=>window.stabilityUnmount())
  // Oversized idle entries are released immediately, so a remount exercises retry.
  fail=true
  await page.evaluate(async()=>{
    const React=(await import('/node_modules/.vite/deps/react.js')).default,{createRoot}=(await import('/node_modules/.vite/deps/react-dom_client.js')).default,{Canvas}=await import('/node_modules/.vite/deps/@react-three_fiber.js'),{default:Model}=await import('/src/SharedModel3D.tsx')
    const container=document.createElement('div');container.style.height='500px';document.body.replaceChildren(container);const root=createRoot(container)
    root.render(React.createElement(Canvas,{},React.createElement(Model,{url:'/api/assets/00000000-0000-4000-8000-000000000051/file#test-user',transform:{scale:1,rotation:0,verticalOffset:0},fallback:null})))
  })
  await expect(page.getByRole('alert')).toHaveAttribute('title',/HTTP 503/)
  await page.getByRole('button',{name:'Retry model'}).click()
  await expect(page.locator('[data-scenery-state=ready]')).toHaveCount(1)
  expect(downloads).toBe(4)
  expect(errors).toEqual([])
})
