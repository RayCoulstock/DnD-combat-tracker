import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {AddressInfo} from 'node:net'
import pg from 'pg'
import {io,type Socket} from 'socket.io-client'
import {createApplication} from '../app.ts'
import {migrate} from '../migrate.ts'
import {FilesystemAssetStorage} from '../asset-storage.ts'
import {recoverFloorImages} from '../floor-images.ts'
import {floorImageSchema} from '../../shared/floor-image.ts'
import {mergeMapSnapshot,type GameCommand,type Snapshot,type CommandResult,type ClientEvents,type ServerEvents} from '../../shared/domain.ts'
import {makeFloorImage} from '../../test-fixtures/floor-image.ts'
const origin='http://localhost:5173'
async function waitFor(condition:()=>boolean){const end=Date.now()+8000;while(!condition()){if(Date.now()>end)throw Error('Image snapshot did not converge');await new Promise(resolve=>setTimeout(resolve,20))}}
class Client{
  cookie='';csrf='';snapshot:Snapshot|null=null;socket?:Socket<ServerEvents,ClientEvents>
  constructor(public base:string){}
  async api(path:string,body?:unknown,status=200){
    const response=await fetch(this.base+'/api'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:this.cookie,Origin:origin,'Content-Type':'application/json','X-CSRF-Token':this.csrf},body:body===undefined?undefined:JSON.stringify(body)})
    const cookies=response.headers.getSetCookie();if(cookies.length)this.cookie=cookies.map(c=>c.split(';')[0]).join('; ')
    const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));if(data.csrf)this.csrf=data.csrf;return data
  }
  async upload(bytes:Uint8Array,filename='map.png',status=201,csrf=this.csrf){
    const data=new FormData();data.set('metadata','{}');data.set('file',new Blob([new Uint8Array(bytes)]),filename)
    const response=await fetch(this.base+'/api/floor-images',{method:'POST',headers:{Cookie:this.cookie,Origin:origin,'X-CSRF-Token':csrf},body:data})
    const image=await response.json();assert.equal(response.status,status,JSON.stringify(image));return image
  }
  async file(imageId:string,campaignId?:string,encounterId?:string,status=200){
    const query=campaignId?`?campaignId=${campaignId}&encounterId=${encounterId}`:''
    const response=await fetch(this.base+`/api/floor-images/${imageId}/file${query}`,{headers:{Cookie:this.cookie}})
    assert.equal(response.status,status);return response
  }
  async connect(campaignId:string){
    this.snapshot=null
    this.socket=io(this.base,{transports:['websocket'],extraHeaders:{Cookie:this.cookie,Origin:origin},auth:{csrf:this.csrf},reconnection:false})
    this.socket.on('session.state',state=>{if(state.snapshot)this.snapshot=mergeMapSnapshot(this.snapshot,state.snapshot)})
    this.socket.on('connect',()=>this.socket!.emit('campaign.join',campaignId,()=>{}));await waitFor(()=>Boolean(this.snapshot))
  }
  async command(command:GameCommand,accepted=true){
    const current=this.snapshot!
    const result=await new Promise<CommandResult>(resolve=>this.socket!.emit('game.command',{commandId:randomUUID(),encounterId:current.encounterId,revision:current.revision,command},resolve))
    assert.equal(result.ok,accepted,JSON.stringify(result));if(result.ok)await waitFor(()=>this.snapshot!.revision>=result.revision);return result
  }
}
test('floor images use private persistent assets, transactional map revisions, history and shared snapshots',{timeout:90000},async t=>{
  const admin=new pg.Pool({connectionString:process.env.DATABASE_URL}),schema='floor_'+randomUUID().replaceAll('-',''),directory=await mkdtemp(join(tmpdir(),'ledger-floor-'))
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`}),storage=new FilesystemAssetStorage(directory),options={pool,assetStorage:storage,origin,secret:'floor-image-integration-secret-'.repeat(3)}
  let app=createApplication(options);const clients:Client[]=[]
  try{
    await migrate(pool);await new Promise<void>(resolve=>app.http.listen(0,'127.0.0.1',resolve))
    const port=(app.http.address() as AddressInfo).port,base=`http://127.0.0.1:${port}`
    for(let index=0;index<6;index++){const client=new Client(base);await client.api('/session');clients.push(client)}
    const[dm,p1,p2,other,late,anonymous]=clients
    for(const client of [dm,other])await client.api('/auth/register',{email:randomUUID()+'@example.test',password:'Floor Images Secure Password 2049!'},201)
    const campaign=await dm.api('/campaigns',{name:'Images'},201),path='/campaigns/'+campaign.id
    for(const client of [p1,p2]){const invite=await dm.api(path+'/invitations',{},201);await client.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Floor player'},201)}
    const encounter=await dm.api(path+'/encounters',{name:'Floor image',file:{version:1,round:1,combatants:[]}},201)
    await dm.api(path+'/session',{active:true});await Promise.all([dm.connect(campaign.id),p1.connect(campaign.id),p2.connect(campaign.id)])
    const png=await makeFloorImage(),asset=await dm.upload(png),replacement=await dm.upload(await makeFloorImage('png',64,128)),foreign=await other.upload(png)
    await t.test('formats, duplicate retry, content validation, auth, CSRF, size and traversal',async()=>{
      assert.equal((await dm.upload(png)).id,asset.id)
      await dm.upload(await makeFloorImage('jpeg'),'map.jpg');await dm.upload(await makeFloorImage('webp'),'map.webp')
      await dm.upload(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),'fake.png',400)
      await dm.upload(Buffer.from('not an image'),'fake.webp',400)
      await dm.upload(png,'map.svg',400);await dm.upload(png,'../map.png',400)
      await dm.upload(png,'csrf.png',403,'invalid')
      await p1.upload(png,'map.png',403);await anonymous.upload(png,'map.png',401)
      await dm.upload(Buffer.alloc(15*1024*1024+1),'huge.png',413)
      await other.file(asset.id,undefined,undefined,404);await anonymous.file(asset.id,undefined,undefined,401)
      const file=await dm.file(asset.id);assert.equal(file.headers.get('content-type'),'image/webp');assert.equal(file.headers.get('cache-control'),'private, no-store')
    })
    await dm.command({type:'map.blank',id:'image-map',name:'Image map',width:20,height:20})
    const image=floorImageSchema.parse({imageId:asset.id,mode:'gridded',showGrid:false,offsetX:.25,offsetZ:-.5,rotation:90,scale:1.2,opacity:.8,locked:true})
    const command={type:'map.floorImage.set' as const,image,width:20,height:20}
    await t.test('shared edits authorize owners and players fetch only current encounter image',async()=>{
      await dm.command({...command,image:{...image,imageId:foreign.id}},false)
      await p1.command(command,false)
      await p1.file(asset.id,campaign.id,encounter.id,404)
      await dm.command(command);await waitFor(()=>p1.snapshot!.revision===dm.snapshot!.revision&&p2.snapshot!.revision===dm.snapshot!.revision)
      assert.deepEqual(p2.snapshot!.state.dungeonMap!.floorImage,image)
      await p1.file(asset.id,campaign.id,encounter.id)
      await p1.file(foreign.id,campaign.id,encounter.id,404)
      const stale=await new Promise<CommandResult>(resolve=>dm.socket!.emit('game.command',{commandId:randomUUID(),encounterId:encounter.id,revision:0,command},resolve));assert.equal(stale.ok,false)
    })
    let template:{id:string;revision:number}
    await t.test('templates, replacement/removal, undo/redo retain files without granting historical access',async()=>{
      template=await dm.api(path+'/maps',{name:'Floor template',encounterId:encounter.id,encounterRevision:dm.snapshot!.revision},201)
      await dm.command({...command,image:{...image,imageId:replacement.id,opacity:.3}})
      await waitFor(()=>p1.snapshot!.state.dungeonMap!.floorImage?.imageId===replacement.id)
      await p1.file(asset.id,campaign.id,encounter.id,404);await p1.file(replacement.id,campaign.id,encounter.id)
      await dm.api(`/floor-images/${asset.id}/delete`,{revision:asset.revision},409)
      await dm.command({...command,image:null});assert.equal(dm.snapshot!.state.dungeonMap!.floorImage,undefined)
      await dm.command({type:'map.undo'});assert.equal(dm.snapshot!.state.dungeonMap!.floorImage!.imageId,replacement.id)
      await dm.command({type:'map.undo'});assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image)
      await dm.command({type:'map.redo'});assert.equal(dm.snapshot!.state.dungeonMap!.floorImage!.opacity,.3)
      await dm.command({type:'map.template.load',templateId:template.id});assert.deepEqual(dm.snapshot!.state.dungeonMap!.floorImage,image)
      assert.deepEqual((await dm.api(path+`/maps/${template.id}`)).document.floorImage,image)
    })
    await t.test('late join and backend restart reload the same persistent image and calibration',async()=>{
      const invite=await dm.api(path+'/invitations',{},201);await late.api('/invitations/redeem',{token:invite.url.split('#invite=')[1],displayName:'Late floor player'},201);await late.connect(campaign.id)
      assert.deepEqual(late.snapshot!.state.dungeonMap!.floorImage,image);await late.file(asset.id,campaign.id,encounter.id)
      for(const client of clients)client.socket?.disconnect()
      await app.close();await recoverFloorImages(pool,storage);app=createApplication(options);await new Promise<void>(resolve=>app.http.listen(port,'127.0.0.1',resolve))
      await Promise.all([dm.connect(campaign.id),p1.connect(campaign.id)])
      assert.deepEqual(p1.snapshot!.state.dungeonMap!.floorImage,image);await p1.file(asset.id,campaign.id,encounter.id)
    })
    await t.test('all shared references must be removed before file deletion',async()=>{
      await dm.command({...command,image:null});await dm.command({type:'map.history.clear'})
      await dm.api(`/floor-images/${asset.id}/delete`,{revision:asset.revision},409)
      await dm.api(path+`/maps/${template.id}/delete`,{revision:template.revision})
      await dm.api(`/floor-images/${asset.id}/delete`,{revision:asset.revision})
      await dm.file(asset.id,undefined,undefined,404)
      await dm.api(path+'/session',{active:false});await p1.file(replacement.id,campaign.id,encounter.id,404)
    })
  }finally{
    for(const client of clients)client.socket?.disconnect()
    await app.close();await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();await rm(directory,{recursive:true,force:true})
  }
})
