import {multiplayerMode,openSetup,closeSetup,sessionAction} from './shell-helpers'
import {test,expect,type Page} from '@playwright/test'
import {randomUUID} from 'node:crypto'
async function api(page:Page,path:string,body?:unknown){return page.evaluate(async({path,body})=>{const{csrf}=await(await fetch('/api/session')).json();const r=await fetch('/api'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},body:body===undefined?undefined:JSON.stringify(body)});if(!r.ok)throw new Error(await r.text());return r.json()},{path,body})}
test('light DM setup supports JSON drop, player ownership, visibility, HP sharing and collapse',async({page,browser})=>{
  await page.setViewportSize({width:1856,height:1340});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/');await multiplayerMode(page);await page.getByLabel('Email',{exact:true}).fill(randomUUID()+'@example.test');await page.getByLabel('Password (12+ characters)',{exact:true}).fill('Setup Browser Password 2049!');await page.getByRole('button',{name:'Create account',exact:true}).click();await openSetup(page)
  const setup=page.getByRole('region',{name:'Dungeon Master session setup',exact:true})
  await setup.getByLabel('New campaign',{exact:true}).fill('When the Mountain Weeps');await setup.getByRole('button',{name:'Create campaign',exact:true}).click();await expect(setup.getByLabel('New encounter',{exact:true})).toBeEnabled()
  const campaign=await page.getByRole('combobox',{name:'Campaign',exact:true}).inputValue(),path='/campaigns/'+campaign
  const file={version:1,round:4,combatants:[{id:1,name:'Fenra Ashwood',short:'FA',role:'Ranger',side:'hero',hp:37,maxHp:45,ac:15,initiative:18,conditions:[],saves:[],actions:[]},{id:2,name:'Tomlin Brack',short:'TB',role:'Cleric',side:'hero',hp:29,maxHp:38,ac:18,initiative:15,conditions:[],saves:[],actions:[]},{id:3,name:'Myconid Sovereign',short:'MS',role:'Boss',side:'enemy',hp:60,maxHp:60,ac:13,initiative:12,conditions:[],saves:[],actions:[],privateNotes:'Never send this note'}]}
  // The drop zone uses the same validated encounter endpoint as the file picker.
  await setup.locator('.dm-dropzone').evaluate((element,content)=>{const transfer=new DataTransfer();transfer.items.add(new File([content],'myconid-cavern.json',{type:'application/json'}));element.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:transfer}))},JSON.stringify(file))
  await expect(setup.getByRole('button',{name:'Import JSON',exact:true})).toHaveAttribute('aria-pressed','true');await expect(setup.getByText('myconid-cavern.json',{exact:true})).toBeVisible()
  await setup.getByLabel('New encounter',{exact:true}).fill('Myconid Cavern');await setup.getByRole('button',{name:'Create / import encounter',exact:true}).click();await openSetup(page);await expect(setup.getByRole('row')).toHaveCount(4)
  await setup.getByRole('button',{name:'Start multiplayer session',exact:true}).click();await expect(setup.getByText('● Session live · Round 4',{exact:true})).toBeVisible()
  await setup.getByRole('button',{name:'Invite player',exact:true}).click();await expect(setup.getByText('Pending',{exact:true})).toBeVisible();const invitation=await setup.getByLabel('Invitation link',{exact:true}).inputValue();await page.context().grantPermissions(['clipboard-read','clipboard-write']);await setup.getByRole('button',{name:'Copy',exact:true}).click();await expect(setup.getByRole('button',{name:'Copied',exact:true})).toBeVisible();expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(invitation)
  const context=await browser.newContext();const player=await context.newPage()
  try{
    await player.goto(invitation);await player.getByLabel('Display name').fill('Krelmos');await player.getByRole('button',{name:'Join campaign',exact:true}).click();await expect(player.locator('.connection')).toHaveText('Connected')
    await expect(setup.getByText('● Online',{exact:true})).toBeVisible();await setup.getByRole('combobox',{name:'Controlled by Fenra Ashwood',exact:true}).selectOption({label:'Krelmos'});await expect(setup.getByText('Plays Fenra Ashwood',{exact:true})).toBeVisible()
    await setup.getByRole('button',{name:'Enemies (1)',exact:true}).click();await expect(setup.getByRole('row')).toHaveCount(2);await expect(setup.getByRole('row').filter({hasText:'Myconid Sovereign'})).toBeVisible();await setup.getByRole('button',{name:'All (3)',exact:true}).click()
    await setup.getByRole('switch',{name:'Show HP to players: Myconid Sovereign',exact:true}).check();await expect(player.locator('.map-initiative-list button').filter({hasText:'Myconid Sovereign'})).toContainText('60/60 HP')
    const playerState=await api(player,path+'/snapshot');expect(playerState.state.combatants.find((c:{id:number})=>c.id===3).hp).toBe(60);expect(JSON.stringify(playerState)).not.toContain('Never send this note')
    await setup.getByRole('switch',{name:'Show HP to players: Myconid Sovereign',exact:true}).uncheck();await expect(player.locator('.map-initiative-list button').filter({hasText:'Myconid Sovereign'})).not.toContainText('60/60 HP')
    await setup.getByRole('switch',{name:'Visible to players: Myconid Sovereign',exact:true}).uncheck();await expect(player.locator('.map-initiative-list button').filter({hasText:'Myconid Sovereign'})).toHaveCount(0);await setup.getByRole('switch',{name:'Visible to players: Myconid Sovereign',exact:true}).check()
    await setup.getByRole('button',{name:'Save session',exact:true}).click();await expect(setup.getByText('Saved sessions (1)',{exact:true})).toBeVisible();await expect(setup.getByText('Past invitations (1)',{exact:true})).toBeVisible()
    await expect(setup.getByText('● Online',{exact:true})).toBeVisible();await setup.screenshot({path:'/tmp/dm-setup-desktop.png'})
    // Setup is a retained overlay; its draft and the live canvas survive closure.
    await closeSetup(page);await page.getByRole('button',{name:'Battle map',exact:true}).click()
    const canvas=page.locator('main:visible .battlefield-wrap canvas'),handle=await canvas.elementHandle(),revision=(await api(page,path+'/snapshot')).revision
    const sockets:string[]=[];page.on('websocket',socket=>sockets.push(socket.url()))
    await openSetup(page);await setup.getByLabel('Campaign name',{exact:true}).fill('Unapplied campaign draft');await page.keyboard.press('Escape')
    await expect(page.getByRole('button',{name:'Session',exact:true})).toBeFocused()
    await openSetup(page);await expect(setup.getByLabel('Campaign name',{exact:true})).toHaveValue('Unapplied campaign draft')
    expect(await canvas.evaluate((node,previous)=>node===previous,handle)).toBe(true);expect((await api(page,path+'/snapshot')).revision).toBe(revision);expect(sockets).toEqual([])
    await page.setViewportSize({width:390,height:844});await expect(setup.getByRole('heading',{name:'Players',exact:true})).toBeAttached();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:'/tmp/dm-setup-mobile.png'})
    await closeSetup(page);await expect(page.getByRole('button',{name:'Account',exact:true})).toBeInViewport();await expect(page.locator('.ledger-connection')).toBeInViewport()
    await expect(player.getByRole('button',{name:'Libraries',exact:true})).toHaveCount(0);await expect(player.getByRole('button',{name:'Session',exact:true})).toHaveCount(0);await expect(player.getByRole('button',{name:'Map editor',exact:true})).toHaveCount(0)
    await expect(player.locator('[data-ui-zone=A]')).toHaveCount(1);await expect(player.locator('[data-ui-zone=B]:visible')).toHaveCount(1)
    await player.getByRole('button',{name:'Players',exact:true}).click();await expect(player.getByRole('dialog',{name:'Players',exact:true})).toContainText('Krelmos');await player.keyboard.press('Escape')
    await player.locator('.tactical-drawer > summary').click();await player.getByRole('button',{name:'20 ft sphere',exact:true}).click()
    const playerCanvas=player.locator('.battlefield-wrap canvas'),playerHandle=await playerCanvas.elementHandle()
    await player.getByRole('button',{name:'Tracker',exact:true}).click();await expect(playerCanvas).toBeHidden();await player.keyboard.press('Escape');await expect(player.locator('.player-artwork')).toHaveCount(0)
    await player.getByRole('button',{name:'Battle map',exact:true}).click();await expect(playerCanvas).toBeVisible();await expect(player.getByRole('combobox',{name:'Template shape',exact:true})).toHaveValue('sphere');expect(await playerCanvas.evaluate((node,previous)=>node===previous,playerHandle)).toBe(true)
    await player.getByRole('button',{name:'Expand Map',exact:true}).click();await sessionAction(page,'End session');await expect(player.locator('body')).not.toHaveClass(/map-viewport-expanded/);await expect(player.getByText('Waiting for the DM to open and start an encounter.',{exact:true})).toBeVisible();expect(await playerHandle!.evaluate(node=>node.isConnected)).toBe(true);await sessionAction(page,'Start multiplayer session');await expect(playerCanvas).toBeVisible()
    expect(errors).toEqual([])
  }finally{await context.close()}
})
