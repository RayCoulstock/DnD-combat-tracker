import {expect,type Page} from '@playwright/test'
export async function expandEditor(page:Page){const inspector=page.locator('.inspector:visible');for(const text of ['New blank map','Map file & templates','Floor']){const summary=inspector.locator('summary').filter({hasText:text==='Floor'?/^Floor\s+(stone|wood|dirt|grass|lava)$/:text});if(await summary.count()&&!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}}
export async function openTactical(page:Page){const summary=page.locator('.tactical-drawer:visible>summary');if(await summary.count()&&!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}
// UI panels resize the canvas and cameras remain independent. Project through the
// actual mounted camera, rather than reconstructing its initial pose in tests.
export async function projectBattlefield(page:Page,point:{x:number;y:number;z:number}):Promise<{x:number;y:number}>{
 const canvas=page.locator('.battlefield-wrap canvas:visible');await canvas.scrollIntoViewIfNeeded()
 let projected:{x:number;y:number}|null=null
 await expect.poll(async()=>{
  projected=await canvas.evaluate(async(node,point)=>{
   // Canvas visibility precedes asynchronous renderer/root initialization. Vite
   // can also retain resource entries for older optimized module instances.
   const resources=[...new Set(performance.getEntriesByType('resource').map(e=>e.name).filter(name=>name.includes('/@react-three_fiber.js')))].reverse()
   for(const resource of resources){
    const module=await import(/* @vite-ignore */resource),state=module._roots.get(node)?.store.getState()
    const box=node.getBoundingClientRect()
    if(!node.isConnected||!state?.internal.active||!state.controls||!box.width||!box.height||Math.abs(state.size.width-box.width)>1||Math.abs(state.size.height-box.height)>1)continue
    const camera=state.camera;camera.updateMatrixWorld();const view=camera.matrixWorldInverse.elements,projection=camera.projectionMatrix.elements
    const multiply=(m:number[],v:number[])=>[0,1,2,3].map(row=>m[row]*v[0]+m[row+4]*v[1]+m[row+8]*v[2]+m[row+12]*v[3])
    const clip=multiply(projection,multiply(view,[point.x,point.y,point.z,1]))
    return{x:box.x+(clip[0]/clip[3]+1)*box.width/2,y:box.y+(1-clip[1]/clip[3])*box.height/2}
   }
   return null
  },point)
  return projected!==null
 },{message:'Wait for the visible battlefield renderer, controls and canvas size to be ready',timeout:15000}).toBe(true)
 return projected!
}
