export const identityKey=(accountId?:string|null,actorId?:string|null)=>accountId?'account:'+accountId:actorId?'legacy:'+actorId:null
export const contextChanged=()=>new DOMException('The account or campaign changed.','AbortError')
// Client request cancellation only; authority and revision ordering remain on the server.
export class RequestLifetime {
 private revision=0
 private readonly requests=new Set<AbortController>()
 current(){return this.revision}
 valid(revision:number){return revision===this.revision}
 advance(){this.revision++;for(const request of this.requests)request.abort();this.requests.clear();return this.revision}
 start(revision=this.revision,external?:AbortSignal){
  if(!this.valid(revision))throw contextChanged()
  const controller=new AbortController(),abort=()=>controller.abort(),timer=setTimeout(abort,10000)
  this.requests.add(controller);if(external?.aborted)abort();external?.addEventListener('abort',abort,{once:true})
  return{signal:controller.signal,finish:()=>{clearTimeout(timer);external?.removeEventListener('abort',abort);this.requests.delete(controller)}}
 }
}
