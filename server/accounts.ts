import type {Express,Request,RequestHandler} from 'express'
import {randomBytes,randomUUID} from 'node:crypto'
import argon2 from 'argon2'
import {z} from 'zod'
import {transaction,type Pool} from './db.ts'
import {hashSecret} from './sessions.ts'
import {DomainError,type Actor} from '../shared/domain.ts'
export const credentials=z.object({email:z.string().trim().max(254).pipe(z.email()).transform(s=>s.toLowerCase()),password:z.string().min(12).max(128)}).strict()
const displayName=z.string().trim().min(1).max(80),tokenSchema=z.string().min(40).max(100)
const dummyHash=await argon2.hash(randomBytes(32),{type:argon2.argon2id})
export const requestActors=new WeakMap<Request,Actor>()
export const accountId=(req:Request)=>req.session.accountId??(req.session.actor?.role==='dm'?req.session.actor.id:undefined)
export async function authenticateAccount(pool:Pool,email:string,password:string){
 const user=(await pool.query('SELECT id,password_hash FROM users WHERE email=$1 AND disabled_at IS NULL',[email.trim().toLowerCase()])).rows[0]
 const valid=await argon2.verify(user?.password_hash??dummyHash,password)
 return valid&&user?{id:user.id as string}:false
}
export async function actorForCampaign(pool:Pick<Pool,'query'>,req:Request,campaignId?:string):Promise<Actor>{
 const id=accountId(req)
 if(id){
  if(!(await pool.query('SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL',[id])).rowCount)throw new DomainError('UNAUTHENTICATED','Authentication expired. Sign in again.')
  if(!campaignId)return{role:'dm',id}
  if((await pool.query('SELECT 1 FROM campaigns WHERE id=$1 AND owner_id=$2',[campaignId,id])).rowCount)return{role:'dm',id}
  const m=(await pool.query('SELECT id FROM memberships WHERE campaign_id=$1 AND account_id=$2 AND revoked_at IS NULL',[campaignId,id])).rows[0]
  if(m)return{role:'player',id:m.id}
  throw new DomainError('FORBIDDEN','Campaign membership is unavailable or revoked.')
 }
 const actor=req.session.actor
 if(!actor)throw new DomainError('UNAUTHENTICATED','Authentication expired. Sign in again.')
 const member=(await pool.query('SELECT campaign_id FROM memberships WHERE id=$1 AND revoked_at IS NULL AND account_id IS NULL',[actor.id])).rows[0]
 if(!member||campaignId&&member.campaign_id!==campaignId)throw new DomainError('FORBIDDEN','Campaign membership is unavailable or revoked.')
 return actor
}
export async function sessionView(pool:Pool,req:Request){
 const id=accountId(req),account=id?(await pool.query('SELECT id,email,display_name AS "displayName" FROM users WHERE id=$1 AND disabled_at IS NULL',[id])).rows[0]??null:null
 let actor:Actor|null=null,campaignId=req.session.campaignId??null
 try{actor=await actorForCampaign(pool,req,campaignId??undefined)}catch{campaignId=null;if(account)actor={role:'dm',id:account.id}}
 return{account,actor,campaignId}
}
export async function beginAccountSession(pool:Pool,req:Request,id:string,campaignId?:string){
 if(!campaignId){const c=(await pool.query(`SELECT c.id FROM campaigns c LEFT JOIN memberships m ON m.campaign_id=c.id AND m.account_id=$1 AND m.revoked_at IS NULL WHERE c.owner_id=$1 OR m.id IS NOT NULL ORDER BY (c.owner_id=$1) DESC,c.created_at LIMIT 1`,[id])).rows[0];campaignId=c?.id}
 await new Promise<void>((resolve,reject)=>req.session.regenerate(e=>e?reject(e):resolve()))
 req.session.accountId=id;req.session.actor={role:'dm',id};req.session.campaignId=campaignId;req.session.csrf=randomBytes(32).toString('base64url')
 await new Promise<void>((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()))
 return{...await sessionView(pool,req),csrf:req.session.csrf}
}
export function registerAccountRoutes(app:Express,pool:Pool,limit:RequestHandler,invitationLimit:RequestHandler){
 // POST bodies keep raw invitation tokens out of URL/access logs.
 app.post('/api/invitations/inspect',invitationLimit,async(req,res)=>{
  const token=tokenSchema.parse(req.body?.token),i=(await pool.query('SELECT c.name,i.membership_id FROM invitations i JOIN campaigns c ON c.id=i.campaign_id WHERE token_hash=$1 AND i.revoked_at IS NULL AND i.redeemed_at IS NULL AND i.expires_at>now()',[hashSecret(token)])).rows[0]
  if(!i)throw new DomainError('FORBIDDEN','Invitation is invalid or expired.')
  res.json({campaignName:i.name,claim:Boolean(i.membership_id)})
 })
 async function join(req:Request,newAccount:boolean,legacyLogin=false){
  const data=z.object({token:tokenSchema.optional(),email:z.string().optional(),password:z.string().optional(),displayName:displayName.optional(),claimLegacy:z.literal(true).optional()}).strict().parse(req.body)
  const legacy=Boolean(data.claimLegacy)&&!accountId(req)&&req.session.actor?.role==='player'?req.session.actor.id:undefined
  if(!data.token&&!legacy)throw new DomainError('FORBIDDEN','A valid invitation or authenticated legacy membership is required.')
  const authenticatedId=accountId(req)
  let id=authenticatedId,hash:string|undefined
  if(newAccount){if(id)throw new DomainError('INVALID','Sign out before creating another account.');
   // Cheap proof check before password hashing; locked validation below remains authoritative.
   const proof=data.token?await pool.query('SELECT 1 FROM invitations WHERE token_hash=$1 AND revoked_at IS NULL AND redeemed_at IS NULL AND expires_at>now()',[hashSecret(data.token)]):await pool.query('SELECT 1 FROM memberships WHERE id=$1 AND account_id IS NULL AND revoked_at IS NULL',[legacy])
   if(!proof.rowCount)throw new DomainError('FORBIDDEN','Invitation is invalid or expired.')
   const c=credentials.parse({email:data.email,password:data.password});hash=await argon2.hash(c.password,{type:argon2.argon2id});data.email=c.email;data.password=undefined;id=randomUUID();displayName.parse(data.displayName)}
  else if(legacyLogin){const c=credentials.safeParse({email:data.email,password:data.password});if(!c.success)throw new DomainError('UNAUTHENTICATED','Invalid email or password.');const user=await authenticateAccount(pool,c.data.email,c.data.password);if(!user)throw new DomainError('UNAUTHENTICATED','Invalid email or password.');id=user.id}
  else if(!id)throw new DomainError('UNAUTHENTICATED','Sign in before accepting this invitation.')
  const account=id!
  try{
   const result=await transaction(pool,async db=>{
    const hint=data.token?(await db.query('SELECT campaign_id FROM invitations WHERE token_hash=$1',[hashSecret(data.token)])).rows[0]:(await db.query('SELECT campaign_id FROM memberships WHERE id=$1',[legacy])).rows[0]
    if(!hint)throw new DomainError('FORBIDDEN','Invitation is invalid or expired.')
    await db.query('SELECT id FROM campaigns WHERE id=$1 FOR UPDATE',[hint.campaign_id])
    const invitation=data.token?(await db.query('SELECT * FROM invitations WHERE token_hash=$1 FOR UPDATE',[hashSecret(data.token)])).rows[0]:undefined
    if(data.token&&(!invitation||invitation.revoked_at||invitation.redeemed_at||new Date(invitation.expires_at).getTime()<=Date.now()))throw new DomainError('FORBIDDEN','Invitation is invalid or expired.')
    const target=invitation?.membership_id??legacy
    if(hash)await db.query('INSERT INTO users(id,email,password_hash,display_name) VALUES($1,$2,$3,$4)',[account,data.email,hash,data.displayName])
    if(!(await db.query('SELECT 1 FROM users WHERE id=$1 AND disabled_at IS NULL',[account])).rowCount)throw new DomainError('UNAUTHENTICATED','Sign in again.')
    const existing=(await db.query('SELECT * FROM memberships WHERE campaign_id=$1 AND account_id=$2 FOR UPDATE',[hint.campaign_id,account])).rows[0]
    let memberId=existing?.id as string|undefined
    if(target){
     const m=(await db.query('SELECT * FROM memberships WHERE id=$1 AND campaign_id=$2 FOR UPDATE',[target,hint.campaign_id])).rows[0]
     if(!m||m.revoked_at||m.account_id&&m.account_id!==account)throw new DomainError('FORBIDDEN','Membership cannot be claimed.')
     if(existing&&existing.id!==target)throw new DomainError('CONFLICT','This account already has a membership. Ask the DM to review assignments; memberships are never merged automatically.')
     await db.query('UPDATE memberships SET account_id=$1 WHERE id=$2',[account,target]);memberId=target
     // Retire every legacy credential for this membership; ownership IDs stay intact.
     await db.query("DELETE FROM auth_sessions WHERE data->'actor'->>'id'=$1",[target])
    }else if(existing?.revoked_at)throw new DomainError('FORBIDDEN','Membership was revoked. Contact the DM.')
    else if(!memberId){memberId=randomUUID();const name=data.displayName??(await db.query('SELECT display_name FROM users WHERE id=$1',[account])).rows[0].display_name;await db.query('INSERT INTO memberships(id,campaign_id,display_name,account_id) VALUES($1,$2,$3,$4)',[memberId,hint.campaign_id,name,account])}
    if(invitation)await db.query('UPDATE invitations SET redeemed_at=now() WHERE id=$1',[invitation.id])
    return{campaignId:hint.campaign_id,memberId}
   })
   if(authenticatedId===account&&!newAccount&&!legacyLogin){
    // Campaign acceptance does not change identity. Preserve other tabs' SID/CSRF.
    req.session.campaignId=result.campaignId;await new Promise<void>((resolve,reject)=>req.session.save(e=>e?reject(e):resolve()))
    return{...await sessionView(pool,req),csrf:req.session.csrf,membershipId:result.memberId}
   }
   return{...await beginAccountSession(pool,req,account,result.campaignId),membershipId:result.memberId}
  }catch(error){if((error as{code?:string}).code==='23505')throw new DomainError('INVALID','Unable to create this account. Try signing in.');throw error}
 }
 app.post('/api/auth/player-register',limit,async(req,res)=>res.status(201).json(await join(req,true)))
 app.post('/api/invitations/accept',limit,async(req,res)=>res.json(await join(req,false)))
 app.post('/api/accounts/claim',limit,async(req,res)=>res.json(await join(req,false,true)))
}
