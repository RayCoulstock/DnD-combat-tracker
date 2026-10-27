import type {Actor} from '../shared/domain'
export interface SessionBootstrap {
  csrf:string
  actor:Actor|null
  campaignId?:string|null
  allowDMRegistration:boolean
}
async function fetchSession():Promise<SessionBootstrap>{
  const response=await fetch('/api/session',{credentials:'same-origin'})
  if(!response.ok)throw new Error('Server unavailable.')
  return response.json()
}
// Share only an in-flight bootstrap, not a permanently cached identity. Strict
// Mode effect replay must not create competing anonymous Set-Cookie responses.
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
