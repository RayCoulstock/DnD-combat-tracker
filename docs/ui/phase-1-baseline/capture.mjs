import {chromium} from 'playwright'
import {writeFile} from 'node:fs/promises'
import process from 'node:process'
import {URL} from 'node:url'
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH??'/usr/bin/chromium',args:['--no-sandbox','--enable-unsafe-swiftshader']})
const observations=[]
try{
 for(const viewport of [{width:1440,height:1000},{width:1280,height:900},{width:768,height:1024},{width:390,height:844}]){
  const context=await browser.newContext({viewport,reducedMotion:'reduce'}),page=await context.newPage()
  await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.abort())
  await page.goto(`${process.env.APP_ORIGIN??'http://localhost:5173'}/e2e/fixtures/ui-foundations.html`)
  await page.getByRole('button',{name:'Open miniature sample',exact:true}).click()
  const dialog=page.getByRole('dialog',{name:/Miniature settings/})
  await dialog.waitFor()
  const file=`${viewport.width}-miniature-settings.png`
  await page.screenshot({path:new URL(file,import.meta.url).pathname})
  observations.push({file,viewport,dialog:await dialog.boundingBox(),horizontalOverflow:await dialog.evaluate(node=>node.scrollWidth>node.clientWidth)})
  await context.close()
 }
 await writeFile(new URL('observations.json',import.meta.url),JSON.stringify({date:'2026-10-31',mode:'existing MiniatureSettings component in dev-only synthetic fixture; no model assigned; external fonts blocked; reduced motion',observations},null,2)+'\n')
}finally{await browser.close()}
