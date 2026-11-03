/* global process, document, performance, innerWidth, innerHeight, URL, fetch, FormData, Blob */
// Synthetic accounts/data only. Run against a disposable development database.
import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {makeTexturedGlb} from '../../../test-fixtures/glb.ts'
import {multiplayerMode,library,openSetup,closeSetup} from '../../../e2e/shell-helpers.ts'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']})
const observations=[]
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},reducedMotion:'reduce'});page.setDefaultTimeout(15000)
 await page.route(/fonts\.(googleapis|gstatic)\.com/,route=>route.abort())
 async function capture(name,width){await page.setViewportSize({width,height:1000});await page.evaluate(()=>{document.querySelector('dialog.miniature-dialog')?.scrollTo({top:0});document.documentElement.scrollTo({top:0});return document.fonts.ready});const file=`${name}-${width}.png`;await page.screenshot({path:new URL(file,import.meta.url).pathname,fullPage:name==='asset-library'});observations.push({file,width,...await page.evaluate(()=>({documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,viewportHeight:innerHeight,horizontalOverflow:document.documentElement.scrollWidth>innerWidth}))})}
 await page.goto(process.env.APP_ORIGIN??'http://localhost:5173')
 for(const width of [1600,1280,768,390]){if(width===390)await page.getByRole('button',{name:'Collapse initiative roster',exact:true}).click();await capture('tracker',width)}
 await page.setViewportSize({width:1600,height:1000});await multiplayerMode(page);await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Synthetic Capture Password 2049!');await page.getByRole('button',{name:'Create account',exact:true}).click();await openSetup(page);await page.getByLabel('New campaign',{exact:true}).fill('The Amber Watch');await page.getByRole('button',{name:'Create campaign',exact:true}).click();await page.getByLabel('New encounter',{exact:true}).fill('The ruined watchtower');await page.getByRole('button',{name:'Create / import encounter',exact:true}).click();await closeSetup(page)
 await library(page);await page.getByRole('button',{name:'Create entry',exact:true}).click();await page.getByLabel('Import character or monster stat block',{exact:true}).fill('Kara Ember\nMedium humanoid AC 16 HP 24 Speed 30 ft STR 12 DEX 14 Actions Sword. Hit: 4 damage.');await page.getByRole('button',{name:'Parse import',exact:true}).click();await page.getByRole('button',{name:'Save library entry',exact:true}).click();await page.getByText('Library entry saved.',{exact:true}).waitFor()
 for(const width of [1600,768,390])await capture('combatant-library',width)
 await page.getByRole('button',{name:'Close library',exact:true}).click();await page.setViewportSize({width:1600,height:1000})
 await page.evaluate(async bytes=>{const {csrf}=await(await fetch('/api/session')).json(),data=new FormData();data.set('metadata',JSON.stringify({name:'Amber watch sentinel',category:'miniature',source:'Synthetic review fixture'}));data.set('file',new Blob([new Uint8Array(bytes)]),'sentinel.glb');const response=await fetch('/api/assets',{method:'POST',headers:{'X-CSRF-Token':csrf},body:data});if(!response.ok)throw Error(await response.text())},Array.from(await makeTexturedGlb()))
 await library(page,'3D Asset Library');await page.getByRole('button',{name:'Amber watch sentinel · miniature',exact:true}).click();await page.getByRole('region',{name:'3D asset preview',exact:true}).locator('canvas').waitFor();await page.waitForFunction(async()=>{const canvas=document.querySelector('.asset-preview canvas');if(!canvas)return false;for(const resource of performance.getEntriesByType('resource').filter(e=>e.name.includes('/@react-three_fiber.js'))){const {_roots}=await import(resource.name),state=_roots.get(canvas)?.store.getState();if(state?.gl.info.render.calls>0)return true}return false})
 for(const width of [1600,768,390])await capture('asset-library',width)
 await writeFile(new URL('observations.json',import.meta.url),JSON.stringify({date:new Date().toISOString().slice(0,10),mode:'Actual app; synthetic local/DM fixtures; external fonts blocked; reduced motion; no production data',observations},null,2)+'\n')
}finally{await browser.close()}
