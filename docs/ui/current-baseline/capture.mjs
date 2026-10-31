/* global document, performance, window */
import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']})
const observations=[]
try{
 for(const viewport of [{width:1440,height:1000},{width:1280,height:900},{width:768,height:1024},{width:390,height:844}]){
  const context=await browser.newContext({viewport}),page=await context.newPage()
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort())
  await page.goto('http://localhost:5173/')
  for(const view of ['tracker','battle-map','map-editor']){
   if(view!=='tracker'){
    await page.getByRole('button',{name:view==='battle-map'?'3D Map':'Map editor',exact:true}).click()
    if(view==='map-editor'){
     await page.locator('.inspector:visible summary').filter({hasText:'New blank map'}).click()
     await page.getByRole('button',{name:'Create blank map',exact:true}).click()
    }
    await page.waitForFunction(async()=>{
     const node=[...document.querySelectorAll('.battlefield-wrap canvas')].find(c=>c.getClientRects().length)
     if(!node)return false
     const resources=performance.getEntriesByType('resource').filter(r=>r.name.includes('/@react-three_fiber.js')).reverse()
     for(const resource of resources){const module=await import(resource.name),state=module._roots.get(node)?.store.getState();if(state?.internal.active&&state.controls)return true}
     return false
    })
   }
   const file=`${viewport.width}-${view}.png`
   // Return to the page top: captures show the space taken by existing chrome.
   await page.evaluate(()=>window.scrollTo(0,0))
   await page.screenshot({path:`docs/ui/current-baseline/${file}`})
   observations.push({file,viewport,view,...await page.evaluate(()=>{
    const canvas=[...document.querySelectorAll('.battlefield-wrap canvas')].find(c=>c.getClientRects().length),rect=canvas?.getBoundingClientRect()
    return{documentWidth:document.documentElement.scrollWidth,documentHeight:document.documentElement.scrollHeight,canvas:rect?{x:rect.x,y:rect.y,width:rect.width,height:rect.height}:null}
   })})
  }
  await context.close()
 }
 await writeFile('docs/ui/current-baseline/observations.json',JSON.stringify({date:'2026-10-31',sourceCommit:'0a2aedfb1c0b9965665740d20761d8351ce7ee8f',mode:'local demo; synthetic built-in combatants; no backend; external fonts blocked',observations},null,2)+'\n')
}finally{await browser.close()}
