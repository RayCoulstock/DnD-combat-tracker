import type {Page} from '@playwright/test'
export async function expandEditor(page:Page){const inspector=page.locator('.inspector:visible');for(const text of ['New blank map','Map file & templates','Floor']){const summary=inspector.locator('summary').filter({hasText:text==='Floor'?/^Floor\s+(stone|wood|dirt|grass|lava)$/:text});if(await summary.count()&&!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}}
export async function openTactical(page:Page){const summary=page.locator('.tactical-drawer:visible>summary');if(await summary.count()&&!(await summary.locator('..').evaluate(el=>(el as HTMLDetailsElement).open)))await summary.click()}
// UI panels resize the canvas and cameras remain independent. Project through the
// actual mounted camera, rather than reconstructing its initial pose in tests.
export async function projectBattlefield(page:Page,point:{x:number;y:number;z:number}){
 const canvas=page.locator('.battlefield-wrap canvas:visible');await canvas.scrollIntoViewIfNeeded()
 return canvas.evaluate(async(node,point)=>{
  const resource=performance.getEntriesByType('resource').find(e=>e.name.includes('/@react-three_fiber.js'))
  if(!resource)throw new Error('React Three Fiber module has not loaded')
  const module=await import(/* @vite-ignore */resource.name),state=module._roots.get(node)?.store.getState()
  if(!state)throw new Error('Battlefield root is not mounted')
  const camera=state.camera;camera.updateMatrixWorld();const view=camera.matrixWorldInverse.elements,projection=camera.projectionMatrix.elements
  const multiply=(m:number[],v:number[])=>[0,1,2,3].map(row=>m[row]*v[0]+m[row+4]*v[1]+m[row+8]*v[2]+m[row+12]*v[3])
  const clip=multiply(projection,multiply(view,[point.x,point.y,point.z,1])),box=node.getBoundingClientRect()
  return{x:box.x+(clip[0]/clip[3]+1)*box.width/2,y:box.y+(1-clip[1]/clip[3])*box.height/2}
 },point)
}
