import {expect,type Page} from '@playwright/test'
export async function expandEditor(page:Page){const inspector=page.locator('.inspector:visible');for(const text of ['New blank map','Map file & templates','Floor']){const summary=inspector.locator('summary').filter({hasText:text==='Floor'?/^Floor\s*(stone|wood|dirt|grass|lava)$/:text});if(await summary.count()&&!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}}
export async function openInspectorSection(page:Page,title:string){
 if(title==='Floor Image'){
  // Creating a server-backed map returns before its inspector mounts. Wait for
  // that surface before changing mode; skipping a missing control leaves the
  // image section permanently hidden rather than merely slow to appear.
  const floor=page.locator('.inspector:visible [data-floor-image]:visible')
  await expect(floor).toBeVisible()
  const parent=floor.locator('summary').filter({hasText:/^Floor Surface/})
  await expect(parent).toBeVisible()
  if(!await parent.locator('..').evaluate(el=>(el as HTMLDetailsElement).open))await parent.click()
  const surface=floor.getByLabel('Surface mode',{exact:true})
  await expect(surface).toBeVisible()
  if(await surface.inputValue()!=='image')await surface.selectOption('image')
 }
 const summary=page.locator('.inspector:visible summary:visible').filter({hasText:title})
 await expect(summary).toBeVisible()
 if(!await summary.locator('..').evaluate(node=>(node as HTMLDetailsElement).open))await summary.click()
}

export async function mapAction(page:Page,name:string){
 if(['Draw wall','Wall line','Rectangle room','Corridor'].includes(name)){await page.getByRole('button',{name:'Wall tools',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();return}
 if(['Expand Map','Browser fullscreen','Exit browser fullscreen','Show map inspector','Hide map inspector'].includes(name)){await page.getByRole('button',{name:'Map view',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();return}
 if(name==='Ruler'||/^(20 ft sphere|15 ft cone|30 ft cone|15 ft cube|60 × 5 ft line)$/.test(name)){const ruler=page.getByRole('button',{name:'Ruler',exact:true});if(name==='Ruler'&&await ruler.isVisible()){await ruler.click();return}await page.getByRole('button',{name:await page.getByRole('button',{name:'Template tools',exact:true}).isVisible()?'Template tools':'Tactical tools',exact:true}).click();await page.getByRole('menuitem',{name,exact:true}).click();return}
 await page.getByRole('button',{name,exact:true}).click()
}
export async function openTactical(page:Page){const panel=page.getByRole('complementary',{name:'Contextual inspector',exact:true});if(!await panel.isVisible())await page.getByRole('button',{name:'Show inspector «',exact:true}).click();const summary=panel.locator('.ledger-inspector-section>summary').filter({hasText:'Tactical tools'});if(!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}
// UI panels resize the canvas and cameras remain independent. Project through the
// actual mounted camera, rather than reconstructing its initial pose in tests.
export interface BattlefieldReadiness {editorTool?:string;mapRevision?:number}
export async function projectBattlefield(page:Page,point:{x:number;y:number;z:number},ready:BattlefieldReadiness={}):Promise<{x:number;y:number}>{
 const canvas=page.locator('.battlefield-wrap canvas:visible');await canvas.scrollIntoViewIfNeeded()
 let projected:{x:number;y:number}|null=null
 await expect.poll(async()=>{
  projected=await canvas.evaluate(async(node,{point,ready})=>{
   // Canvas visibility precedes asynchronous renderer/root initialization. Vite
   // can also retain resource entries for older optimized module instances.
   const resources=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(name=>name.includes('/@react-three_fiber.js')))].reverse()
   for(const resource of resources){
    const module=await import(/* @vite-ignore */resource),state=module._roots.get(node)?.store.getState()
    const box=node.getBoundingClientRect()
    if(!node.isConnected||!state?.internal.active||!state.controls||!box.width||!box.height||Math.abs(state.size.width-box.width)>1||Math.abs(state.size.height-box.height)>1)continue
    // The DOM tool button and server snapshot can update before Fiber commits
    // the matching handlers/geometry. Read metadata from that same scene commit.
    if(ready.editorTool!==undefined||ready.mapRevision!==undefined){
     const level=state.scene?.children.find((child:{userData:Record<string,unknown>})=>child.userData.levelInteractive===true)
     if(!level||ready.editorTool!==undefined&&level.userData.editorTool!==ready.editorTool||ready.mapRevision!==undefined&&level.userData.mapRevision!==ready.mapRevision)continue
    }
    state.scene?.updateMatrixWorld?.(true)
    const camera=state.camera;camera.updateMatrixWorld();const view=camera.matrixWorldInverse.elements,projection=camera.projectionMatrix.elements
    const multiply=(m:number[],v:number[])=>[0,1,2,3].map(row=>m[row]*v[0]+m[row+4]*v[1]+m[row+8]*v[2]+m[row+12]*v[3])
    const clip=multiply(projection,multiply(view,[point.x,point.y,point.z,1]))
    return{x:box.x+(clip[0]/clip[3]+1)*box.width/2,y:box.y+(1-clip[1]/clip[3])*box.height/2}
   }
   return null
  },{point,ready})
  return projected!==null
 },{message:'Wait for the visible battlefield renderer, controls, canvas size and requested scene commit',timeout:15000}).toBe(true)
 return projected!
}

// Unlike page.mouse.click, a locator click checks that the projected point really
// receives input (no picker/backdrop or workspace overlay in front of the map).
// Keep the position relative to the canvas so Playwright's scroll handling cannot
// turn a correct projection into an unrelated viewport click.
export async function clickBattlefield(page:Page,point:{x:number;y:number;z:number},ready:BattlefieldReadiness={}){
 const position=await projectBattlefield(page,point,ready),canvas=page.locator('.battlefield-wrap canvas:visible'),box=(await canvas.boundingBox())!
 await canvas.click({position:{x:position.x-box.x,y:position.y-box.y}})
}

export async function battlefieldView(page:Page){
 await projectBattlefield(page,{x:0,y:0,z:0})
 return page.locator('.battlefield-wrap canvas:visible').evaluate(async node=>{
  for(const resource of performance.getEntriesByType('resource').filter(e=>e.name.includes('/@react-three_fiber.js')).reverse()){
   const module=await import(resource.name),state=module._roots.get(node)?.store.getState()
   if(state?.controls)return{camera:state.camera.uuid,scene:state.scene.uuid,position:state.camera.position.toArray(),target:state.controls.target.toArray(),zoom:state.camera.zoom}
  }
  throw Error('No mounted battlefield camera')
 })
}

// GLB fixtures can be a single upright triangle: the floor anchor lies on its
// edge, not a reliable visible hit. Select an interior point of the live mesh,
// including its instance transform and active-floor elevation.
export async function clickSceneryTriangle(page:Page){
 const canvas=page.locator('.battlefield-wrap canvas:visible')
 let point:{x:number;y:number;z:number}|null=null
 await expect.poll(async()=>{
  point=await canvas.evaluate(async node=>{
   const urls=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(n=>n.includes('/@react-three_fiber.js')))].reverse()
   for(const url of urls){
    const module=await import(/* @vite-ignore */url),state=module._roots.get(node)?.store.getState();if(!state?.internal.active)continue
    state.scene.updateMatrixWorld(true)
    let result:{x:number;y:number;z:number}|null=null
    state.scene.traverse((group:import('three').Object3D)=>{
     if(result||group.name!=='scenery-placement-transform')return
     let level:import('three').Object3D|null=group;while(level&&!level.userData.levelId)level=level.parent
     if(!level?.userData.levelInteractive)return
     group.traverse(child=>{
      if(result)return;const mesh=child as import('three').Mesh,position=mesh.geometry?.attributes.position,index=mesh.geometry?.index
      if(!mesh.isMesh||!mesh.visible||!position||position.count<3)return
      const a=index?.getX(0)??0,b=index?.getX(1)??1,c=index?.getX(2)??2
      const p=mesh.position.clone().set((position.getX(a)+position.getX(b)+position.getX(c))/3,(position.getY(a)+position.getY(b)+position.getY(c))/3,(position.getZ(a)+position.getZ(b)+position.getZ(c))/3).applyMatrix4(mesh.matrixWorld)
      result={x:p.x,y:p.y,z:p.z}
     })
    })
    return result
   }
   return null
  })
  return point!==null
 },{message:'Wait for a rendered scenery triangle on the interactive floor'}).toBe(true)
 await clickBattlefield(page,point!)
}
