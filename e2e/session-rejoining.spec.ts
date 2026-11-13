import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
import {io} from 'socket.io-client'
import pg from 'pg'
import {blankDungeon} from '../shared/dungeon'
import {initialFog,fullMask} from '../shared/fog'
import {lightingTemplates} from '../shared/lighting'
import {battlefieldView} from './workspace-helpers'
test.use({actionTimeout:15000})
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw Error('API '+r.status);return r.json()},{path,body})}
const password='Session Return Browser Password 2057!'
const file=(id:string)=>({version:1,round:3,combatants:[{id:'hero',name:'Returning hero',side:'hero',hp:9,maxHp:10,ac:12,initiative:14,conditions:[],saves:[],actions:[]}],dungeonMap:{...blankDungeon(id.replaceAll(' ','-'),id,12,8),fogOfWar:{...initialFog(),floors:{ground:fullMask(12,8)}},lighting:{environment:lightingTemplates.Night}}})
async function fixture(dm:Page){await dm.goto('/');await api(dm,'/auth/register',{email:randomUUID()+'@example.test',password});const c=await api(dm,'/campaigns',{name:'Return fixture'}),path='/campaigns/'+c.id,encounter=await api(dm,path+'/encounters',{name:'First session',file:file('First map')});await api(dm,path+'/session',{active:true});const invite=await api(dm,path+'/invitations',{});return{c,path,encounter,invite}}
async function register(p:Page,url:string){const email=randomUUID()+'@example.test';await p.goto(url);await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password (12+ characters)',{exact:true}).fill(password);await p.getByLabel('Account nickname',{exact:true}).fill('Returning explorer');await p.getByRole('button',{name:'Create player account',exact:true}).click();await expect(p.locator('.connection')).toHaveText('Connected');return email}
async function signIn(p:Page,email:string,campaignName='Return fixture'){await p.getByLabel('Email',{exact:true}).fill(email);await p.getByLabel('Password (12+ characters)',{exact:true}).fill(password);await p.getByRole('button',{name:'Sign in',exact:true}).click();const panel=p.getByRole('region',{name:'My Campaigns',exact:true});await expect(panel).toBeVisible();await panel.getByRole('button',{name:'Join '+campaignName,exact:true}).click();await expect(p.locator('.connection')).toHaveText('Connected')}
async function command(dm:Page,path:string,command:unknown){const snap=await api(dm,path+'/snapshot'),session=await api(dm,'/session'),cookies=(await dm.context().cookies()).map(c=>c.name+'='+c.value).join('; '),socket=io('http://localhost:5173',{transports:['websocket'],extraHeaders:{Cookie:cookies,Origin:'http://localhost:5173'},auth:{csrf:session.csrf},reconnection:false});try{await new Promise<void>((r,j)=>{socket.on('connect',()=>socket.emit('campaign.join',snap.campaignId,(ack:{ok:boolean})=>ack.ok?r():j(Error('Join failed'))));socket.on('connect_error',j)});await new Promise<void>((r,j)=>socket.emit('game.command',{commandId:randomUUID(),encounterId:snap.encounterId,revision:snap.revision,command},(ack:{ok:boolean})=>ack.ok?r():j(Error('Command failed'))))}finally{socket.disconnect()}}
test('two sessions and offline return recover the current map, fog, lighting and original ownership without reinvitation',async({page,browser})=>{
 const f=await fixture(page),context=await browser.newContext(),p=await context.newPage(),errors:string[]=[];p.on('pageerror',e=>errors.push(e.message))
 try{
  const email=await register(p,f.invite.url),identity=await api(p,'/session');await command(page,f.path,{type:'token.assign',combatantId:'hero',playerId:identity.actor.id});await p.getByRole('button',{name:'Top-down',exact:true}).click();await p.getByRole('button',{name:'Zoom in',exact:true}).click();const camera=await battlefieldView(p),canvas=await p.locator('canvas:visible').elementHandle()
  await api(page,f.path+'/session',{active:false});await expect(p.getByText('Waiting for the DM to open and start an encounter.',{exact:true})).toBeVisible();expect(await canvas!.evaluate(n=>n.isConnected)).toBe(true)
  await context.setOffline(true);const second=await api(page,f.path+'/encounters',{name:'Second session',file:file('Second map')});await command(page,f.path,{type:'token.assign',combatantId:'hero',playerId:identity.actor.id});await api(page,f.path+'/session',{active:true});await context.setOffline(false)
  await expect(p.getByRole('region',{name:'Dungeon map: Second map',exact:true})).toBeVisible();await expect(p.locator('.connection')).toHaveText('Connected');expect(await battlefieldView(p)).toEqual(camera)
  const state=await api(p,f.path+'/snapshot');expect(state.encounterId).toBe(second.id);expect(state.state.dungeonMap.fogOfWar.floors.ground).toBe(fullMask(12,8));expect(state.state.dungeonMap.lighting.environment).toEqual(lightingTemplates.Night);expect(state.state.combatants[0].ownerId).toBe(identity.actor.id)
  await context.clearCookies();await p.reload();await expect(p.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await signIn(p,email);expect((await api(p,'/session')).actor.id).toBe(identity.actor.id);expect((await api(page,f.path)).invitations).toHaveLength(1);expect(errors).toEqual([])
 }finally{await context.close()}
})
test('a delayed old-campaign authentication error cannot clear a newer campaign or its map',async({page,browser})=>{
 const f=await fixture(page),context=await browser.newContext(),p=await context.newPage()
 try{
  await register(p,f.invite.url);const b=await api(page,'/campaigns',{name:'Second campaign'});await api(page,'/campaigns/'+b.id+'/encounters',{name:'Second',file:file('Second campaign map')});await api(page,'/campaigns/'+b.id+'/session',{active:true});const i=await api(page,'/campaigns/'+b.id+'/invitations',{});await p.goto(i.url);await p.getByRole('button',{name:'Accept invitation',exact:true}).click();await expect(p.locator('.connection')).toHaveText('Connected')
  let release!:()=>void,seen!:()=>void;const held=new Promise<void>(r=>release=r),intercepted=new Promise<void>(r=>seen=r)
  await p.route('**/api/campaigns/'+f.c.id,route=>route.fulfill({status:401,json:{error:{code:'UNAUTHENTICATED',message:'Old context expired'}}}))
  await p.route('**/api/session',async route=>{seen();await held;await route.fulfill({json:{csrf:'old-context-csrf',actor:null,account:null,campaignId:null,allowDMRegistration:false}})})
  await p.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(f.c.id);await intercepted;await p.getByRole('combobox',{name:'Campaign',exact:true}).selectOption(b.id);await expect(p.getByRole('region',{name:'Dungeon map: Second campaign map',exact:true})).toBeVisible();release();await p.unrouteAll({behavior:'wait'})
  await expect(p.locator('.connection')).toHaveText('Connected');await expect(p.getByRole('combobox',{name:'Campaign',exact:true})).toHaveValue(b.id);await expect(p.getByRole('heading',{name:'Sign in',exact:true})).toHaveCount(0);await expect(p.getByRole('region',{name:'Dungeon map: Second campaign map',exact:true})).toBeVisible()
 }finally{await context.close()}
})
test('expired browser authentication asks for login; same-account login in another tab renews the old subscription',async({page,browser})=>{
 const f=await fixture(page),context=await browser.newContext(),p=await context.newPage()
 try{
  const email=await register(p,f.invite.url),identity=(await api(p,'/session')).actor.id;await context.clearCookies();await context.setOffline(true);await context.setOffline(false);await expect(p.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible();await expect(p.getByRole('alert')).toContainText('Authentication expired');await signIn(p,email)
  const other=await context.newPage();await other.goto('/');await expect(other.locator('.connection')).toHaveText('Connected');const camera=await battlefieldView(p)
  await api(other,'/auth/login',{email,password});await api(page,f.path+'/session',{active:false});await expect(p.getByText('Waiting for the DM to open and start an encounter.',{exact:true})).toBeVisible();await api(page,f.path+'/session',{active:true});await expect(p.locator('.connection')).toHaveText('Connected');await expect(other.locator('.connection')).toHaveText('Connected');await expect(p.locator('canvas:visible')).toHaveCount(1);expect(await battlefieldView(p)).toEqual(camera);expect((await api(p,'/session')).actor.id).toBe(identity)
  await api(page,f.path+'/members/'+identity+'/revoke',{});await expect(p.getByRole('alert')).toContainText('Membership revoked');await expect(p.getByRole('region',{name:'My Campaigns',exact:true})).toBeVisible();await expect(p.locator('canvas:visible')).toHaveCount(0);expect((await api(p,'/session')).account).not.toBeNull()
 }finally{await context.close()}
})
test('an unavailable active encounter offers a useful retry and repairs without losing the account',async({page,browser})=>{
 const database=process.env.DATABASE_URL;expect(database&&['127.0.0.1','localhost'].includes(new URL(database).hostname),'Requires the isolated loopback PostgreSQL fixture').toBeTruthy()
 const f=await fixture(page),context=await browser.newContext(),p=await context.newPage(),pool=new pg.Pool({connectionString:database})
 try{
  await register(p,f.invite.url);await pool.query('UPDATE campaigns SET active_encounter_id=$1,state_revision=state_revision+1 WHERE id=$2',[randomUUID(),f.c.id]);await p.getByRole('button',{name:'Account',exact:true}).click();await p.getByRole('menuitem',{name:'Refresh / rejoin',exact:true}).click();await expect(p.getByRole('heading',{name:'Unable to load map',exact:true})).toBeVisible();await expect(p.getByRole('button',{name:'Retry connection',exact:true})).toBeVisible();await expect(p.locator('canvas:visible')).toHaveCount(0)
  await api(page,f.path+'/open',{encounterId:f.encounter.id});await expect(p.getByRole('region',{name:'Dungeon map: First map',exact:true})).toBeVisible();await expect(p.locator('.connection')).toHaveText('Connected');expect((await api(p,'/session')).account).not.toBeNull()
 }finally{await pool.end();await context.close()}
})

test('returning from local mode verifies the cookie account before exposing any previous campaign',async({page,browser})=>{
 const f=await fixture(page),context=await browser.newContext(),otherContext=await browser.newContext(),p=await context.newPage(),q=await otherContext.newPage()
 try{
  await register(p,f.invite.url);const second=await api(page,'/campaigns',{name:'Other account campaign'});await api(page,'/campaigns/'+second.id+'/encounters',{name:'Private second',file:file('Other account map')});await api(page,'/campaigns/'+second.id+'/session',{active:true});const invite=await api(page,'/campaigns/'+second.id+'/invitations',{}),email=await register(q,invite.url)
  await p.getByRole('button',{name:'Account',exact:true}).click();await p.getByRole('menuitem',{name:'Local tracker',exact:true}).click();await api(p,'/auth/login',{email,password})
  let release!:()=>void,seen!:()=>void;const wait=new Promise<void>(r=>release=r),held=new Promise<void>(r=>seen=r)
  await p.route('**/api/session',async route=>{seen();await wait;await route.continue()})
  await p.getByRole('button',{name:'Account',exact:true}).click();await p.getByRole('menuitem',{name:'Multiplayer',exact:true}).click();await held
  await expect(p.getByText('Checking authentication…',{exact:true})).toBeVisible();await expect(p.getByRole('region',{name:'Dungeon map: First map',exact:true})).toHaveCount(0);release();await p.unrouteAll({behavior:'wait'})
  await expect(p.getByRole('region',{name:'Dungeon map: Other account map',exact:true})).toBeVisible();await expect(p.getByRole('combobox',{name:'Campaign',exact:true})).toHaveValue(second.id);await expect(p.getByRole('combobox',{name:'Campaign',exact:true}).getByRole('option',{name:f.c.name,exact:true})).toHaveCount(0)
 }finally{await context.close();await otherContext.close()}
})

test('another tab cannot bootstrap an anonymous cookie while a credential response is pending',async({page,browser})=>{
 const f=await fixture(page),context=await browser.newContext(),p=await context.newPage(),other=await context.newPage()
 try{
  await other.goto('/');await other.getByRole('button',{name:'Table mode',exact:true}).click();await other.getByRole('menuitem',{name:'Multiplayer',exact:true}).click();await expect(other.getByRole('heading',{name:'Sign in',exact:true})).toBeVisible()
  const email=await register(p,f.invite.url),member=(await api(p,'/session')).actor.id;let release!:()=>void,seen!:()=>void;const gate=new Promise<void>(r=>release=r),received=new Promise<void>(r=>seen=r)
  await other.route('**/api/auth/login',async route=>{const response=await route.fetch();seen();await gate;await route.fulfill({response})})
  await other.getByLabel('Email',{exact:true}).fill(email);await other.getByLabel('Password (12+ characters)',{exact:true}).fill(password);await other.getByRole('button',{name:'Sign in',exact:true}).click();await received
  let probes=0;p.on('request',r=>{if(new URL(r.url()).pathname==='/api/session')probes++})
  await api(page,f.path+'/session',{active:false});await expect(p.getByRole('heading',{name:'Reconnecting',exact:true})).toBeVisible();await p.evaluate(()=>new Promise<void>(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r()))));expect(probes).toBe(0)
  release();await other.unrouteAll({behavior:'wait'});await expect(p.getByText('Waiting for the DM to open and start an encounter.',{exact:true})).toBeVisible();await expect(other.getByRole('region',{name:'My Campaigns',exact:true})).toBeVisible();await api(page,f.path+'/session',{active:true});await expect(p.locator('.connection')).toHaveText('Connected');expect((await api(p,'/session')).actor.id).toBe(member);expect((await api(page,f.path)).invitations).toHaveLength(1)
 }finally{await context.close()}
})
