import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {blankDungeon} from '../shared/dungeon'
import {initialFog,fullMask} from '../shared/fog'
import {lightingTemplates} from '../shared/lighting'
import {battlefieldView} from './workspace-helpers'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error('API '+r.status);return r.json()},{path,body})}
async function campaign(page:Page){await page.goto('/');await api(page,'/auth/register',{email:randomUUID()+'@example.test',password:'Player Accounts Browser Fixture 2055!'});const c=await api(page,'/campaigns',{name:'Returning players'}),path='/campaigns/'+c.id;const map={...blankDungeon('warehouse','Warehouse',8,8),fogOfWar:{...initialFog(),floors:{ground:fullMask(8,8)}},lighting:{environment:lightingTemplates.Night}};await api(page,path+'/encounters',{name:'Warehouse',file:{version:1,round:3,combatants:[],dungeonMap:map}});await api(page,path+'/session',{active:true});const invitation=await api(page,path+'/invitations',{});return{path,c,invitation}}
test('invited player registers, signs out and returns through normal login without another invitation',async({page,browser})=>{
 const f=await campaign(page),context=await browser.newContext({viewport:{width:768,height:1000}}),p=await context.newPage(),email=randomUUID()+'@example.test',password='Returning Player Browser Password 2055!',errors:string[]=[];p.on('pageerror',e=>errors.push(e.message))
 try{
  await p.goto(f.invitation.url);await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password (12+ characters)',{exact:true}).fill(password);await p.getByLabel('Account nickname',{exact:true}).fill('Returning explorer');await p.getByRole('button',{name:'Create player account',exact:true}).click()
  await expect(p.locator('.connection')).toHaveText('Connected');await expect(p.locator('canvas:visible')).toHaveCount(1);const identity=await api(p,'/session');expect(identity.account.email).toBe(email);expect(identity.actor.role).toBe('player')
  await p.getByRole('button',{name:'Account',exact:true}).click();await p.getByRole('menuitem',{name:'Sign out',exact:true}).click();await expect(p.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible()
  await p.goto('/');await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password (12+ characters)',{exact:true}).fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();await expect(p.locator('.connection')).toHaveText('Connected');expect((await api(p,'/session')).actor.id).toBe(identity.actor.id)
  const snapshot=await api(p,f.path+'/snapshot');expect(snapshot.state.dungeonMap.fogOfWar.floors.ground).toBe(fullMask(8,8));expect(snapshot.state.dungeonMap.lighting.environment).toEqual(lightingTemplates.Night)
  expect((await api(page,f.path)).invitations).toHaveLength(1);await p.screenshot({path:test.info().outputPath('returning-player-tablet.png')});expect(errors).toEqual([])
 }finally{await context.close()}
})
test('authenticated legacy membership links an account without replacing membership or camera',async({page,browser})=>{
 const f=await campaign(page),context=await browser.newContext(),p=await context.newPage()
 try{
  await p.goto(f.invitation.url);await p.getByLabel('Display name',{exact:true}).fill('Legacy explorer');await p.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(p.locator('.connection')).toHaveText('Connected');const original=await api(p,'/session'),view=await battlefieldView(p)
  await p.getByRole('button',{name:'Account',exact:true}).click();await p.getByRole('menuitem',{name:'Link player account',exact:true}).click();const dialog=p.getByRole('dialog',{name:'Link player account',exact:true});await expect(dialog).toBeVisible()
  await dialog.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await dialog.getByLabel('Password (12+ characters)',{exact:true}).fill('Claimed Player Browser Password 2055!');await dialog.getByLabel('Account nickname',{exact:true}).fill('Persistent explorer');await dialog.getByRole('button',{name:'Link player account',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(p.locator('.connection')).toHaveText('Connected')
  const linked=await api(p,'/session');expect(linked.actor.id).toBe(original.actor.id);expect(linked.account).not.toBeNull();expect(await battlefieldView(p)).toEqual(view);await p.reload();await expect(p.locator('.connection')).toHaveText('Connected');expect((await api(p,'/session')).actor.id).toBe(original.actor.id)
 }finally{await context.close()}
})
