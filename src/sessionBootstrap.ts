import type {Actor} from '../shared/domain'
export interface SessionBootstrap {
  account?:{id:string;email:string;displayName:string}|null
  csrf:string
  actor:Actor|null
  campaignId?:string|null
  allowDMRegistration:boolean
}
// Cookie-writing requests share an origin-wide browser lock, not another auth store.
// Older browsers retain the per-page in-flight guard and bounded retry fallback.
export function withSessionLock<T>(work:()=>Promise<T>,signal?:AbortSignal):Promise<T>{
  const locks=globalThis.navigator?.locks
  return locks?locks.request('encounter-ledger.session',{signal},work):work()
}
export async function readSession(signal?:AbortSignal):Promise<SessionBootstrap>{
  const response=await fetch('/api/session',{credentials:'same-origin',signal})
  if(!response.ok)throw new Error('Server unavailable. Retry when the connection returns.')
  return response.json()
}
async function fetchSession():Promise<SessionBootstrap>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
  try{return await withSessionLock(()=>readSession(controller.signal),controller.signal)}finally{clearTimeout(timer)}
}
// Share only an in-flight bootstrap, not a permanently cached identity. Strict
// Mode replay and credential transitions must not race anonymous Set-Cookie replies.
export function createSessionBootstrap(load:()=>Promise<SessionBootstrap>=fetchSession){
  let pending:Promise<SessionBootstrap>|null=null
  return()=>{
    if(pending)return pending
    const request=Promise.resolve().then(load)
    pending=request
    const clear=()=>{if(pending===request)pending=null}
    void request.then(clear,clear)
    return request
  }
}
