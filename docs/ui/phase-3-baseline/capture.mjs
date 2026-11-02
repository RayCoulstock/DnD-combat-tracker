/* global process, document, performance, URL */
// Real local-only UI; synthetic demo combatants, deterministic generated dungeon.
// Run with the development app at APP_ORIGIN. No account or server writes.
import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']})
const observations=[]
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'})
 await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort())
 await page.goto(process.env.APP_ORIGIN??'http://localhost:5173')
 await page.getByRole('button',{name:'Map editor',exact:true}).click()
 const generator=page.locator('[data-ui-section=generate-dungeon]');await generator.locator('summary').click();await generator.getByLabel('Random seed',{exact:true}).fill('phase-three-watchtower');await generator.getByRole('button',{name:'Preview dungeon',exact:true}).click();await generator.getByRole('button',{name:'Accept generated map',exact:true}).click();await generator.locator('summary').click()
 await page.getByRole('button',{name:'Wall tools',exact:true}).click();await page.getByRole('menuitem',{name:'Draw wall',exact:true}).click()
 const ready=()=>page.waitForFunction(async()=>{const canvas=document.querySelector('.battlefield-wrap canvas');if(!canvas)return false;for(const resource of performance.getEntriesByType('resource').filter(e=>e.name.includes('/@react-three_fiber.js')).reverse()){const {_roots}=await import(resource.name),state=_roots.get(canvas)?.store.getState(),r=canvas.getBoundingClientRect();if(state?.controls&&Math.abs(state.size.width-r.width)<1&&Math.abs(state.size.height-r.height)<1)return true}return false})
 async function capture(name,width){await page.setViewportSize({width,height:1000});await ready();await page.evaluate(()=>{document.querySelector('.workspace-inspector')?.scrollTo({top:0});return document.fonts.ready});const file=`${name}-${width}.png`;await page.screenshot({path:new URL(file,import.meta.url).pathname});observations.push({file,width,documentWidth:await page.evaluate(()=>document.documentElement.scrollWidth),docks:await page.locator('[data-ui-zone^=D]').evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return{zone:n.dataset.uiZone,x:r.x,y:r.y,width:r.width,height:r.height}}))})}
 for(const width of [1600,1280,768])await capture('editor',width)
 await page.setViewportSize({width:1600,height:1000});await page.getByRole('button',{name:'Wall tools',exact:true}).click();await capture('wall-flyout',1600);await page.keyboard.press('Escape')
 await page.getByRole('button',{name:'Battle map',exact:true}).click()
 for(const width of [1600,1280,768,390])await capture('battle-map',width)
 await page.setViewportSize({width:1600,height:1000});await page.getByRole('complementary',{name:'Combatant roster',exact:true}).getByRole('button',{name:'Fenra Ashwood',exact:true}).click();await capture('combatant-inspector',1600)
 await writeFile(new URL('observations.json',import.meta.url),JSON.stringify({date:'2026-11-02',mode:'Local only; actual Three.js scene; deterministic procedural dungeon; external fonts blocked; reduced motion',observations},null,2)+'\n')
}finally{await browser.close()}
