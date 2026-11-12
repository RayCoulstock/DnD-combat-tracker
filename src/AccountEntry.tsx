import {useEffect,useState,type FormEvent} from 'react'
import {Button} from './ui'
import './accounts.css'
export interface Account {id:string;displayName:string;email:string}
interface AuthResult {actor:{id:string;role:'dm'|'player'};account?:Account|null;campaignId?:string;csrf?:string}
export default function AccountEntry({token,account,legacyClaim=false,allowDMRegistration,csrf,busy,api,onAuthenticated,onCancel}:{token:string;account:Account|null;legacyClaim?:boolean;allowDMRegistration:boolean|null;csrf:string;busy:boolean;api:(path:string,body?:unknown)=>Promise<AuthResult&{campaignName?:string}>;onAuthenticated:(result:AuthResult)=>void;onCancel?:()=>void}){
 const[create,setCreate]=useState(Boolean(token||legacyClaim)),[name,setName]=useState(''),[error,setError]=useState(''),[pending,setPending]=useState(false),[valid,setValid]=useState(!token)
 useEffect(()=>{if(!token||!csrf)return;let active=true;api('/invitations/inspect',{token}).then(data=>{if(active){setName(data.campaignName??'');setValid(true)}}).catch(e=>{if(active){setError(e.message);setValid(false)}});return()=>{active=false}},[api,token,csrf])
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();setPending(true);setError('');const form=new FormData(event.currentTarget)
  try{let result:AuthResult
   if(account)result=await api('/invitations/accept',{token})
   else if(create&&(token||legacyClaim))result=await api('/auth/player-register',{...(token?{token}:{claimLegacy:true}),email:form.get('email'),password:form.get('password'),displayName:form.get('displayName')})
   else if(token||legacyClaim)result=await api('/accounts/claim',{...(token?{token}:{claimLegacy:true}),email:form.get('email'),password:form.get('password')})
   else{const action=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value')??'login';result=await api('/auth/'+action,{email:form.get('email'),password:form.get('password')})}
   onAuthenticated(result)
  }catch(e){setError((e as Error).message)}finally{setPending(false)}
 }
 const disabled=busy||pending||!csrf||!valid
 return <section className="online-card account-entry" aria-label="Account access"><h1>{legacyClaim?'Keep your player identity':token?'Join a campaign':'Sign in'}</h1>
  {name&&<p>Campaign: <strong>{name}</strong></p>}{error&&<p role="alert">{error}</p>}
  {(token||legacyClaim)&&!account&&<div className="account-actions"><Button aria-pressed={create} onClick={()=>setCreate(true)}>Create Account</Button><Button aria-pressed={!create} onClick={()=>setCreate(false)}>Sign In</Button></div>}
  <form onSubmit={submit} aria-label={legacyClaim?'Claim player membership':'Account credentials'}>
   {!account&&<><label>Email<input name="email" type="email" required maxLength={254} autoComplete="username"/></label><label>Password (12+ characters)<input name="password" type="password" required minLength={12} maxLength={128} autoComplete={create&&(token||legacyClaim)?'new-password':'current-password'}/></label>
   {create&&(token||legacyClaim)&&<label>Account nickname<input name="displayName" required maxLength={80} autoComplete="nickname"/></label>}</>}
   <Button type="submit" disabled={disabled}>{account?'Accept invitation':legacyClaim?'Link player account':token&&create?'Create player account':'Sign in'}</Button>
   {!token&&!legacyClaim&&allowDMRegistration&&<Button type="submit" value="register" disabled={disabled}>Create account</Button>}
  </form>
  {legacyClaim&&<p>Your existing membership and character assignments stay intact. No matching by display name.</p>}
  {!token&&!legacyClaim&&!allowDMRegistration&&<p>DM registration is closed for the private beta. Player registration requires an invitation. Existing accounts can sign in without another invitation.</p>}
  <p>Password recovery is unavailable until email delivery is configured. Contact your campaign host if you need help.</p>
  {token&&!account&&!legacyClaim&&<form aria-label="Legacy browser access" onSubmit={event=>{event.preventDefault();const displayName=new FormData(event.currentTarget).get('displayName');setPending(true);void api('/invitations/redeem',{token,displayName}).then(onAuthenticated).catch(e=>setError(e.message)).finally(()=>setPending(false))}}><h2>Legacy browser access</h2><label>Display name<input name="displayName" required maxLength={80} autoComplete="nickname"/></label><Button type="submit" disabled={disabled}>Join campaign</Button><p>Browser-only access expires after seven days. Link an account from the Account menu to return without another invitation.</p></form>}
  {onCancel&&<Button onClick={onCancel}>Cancel account setup</Button>}
 </section>
}
