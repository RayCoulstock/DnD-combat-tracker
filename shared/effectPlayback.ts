import {z} from 'zod'
const stamp=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
export const effectPlaybackSettingsSchema=z.object({mode:z.enum(['loop','manual','once']),durationMs:z.number().int().min(250).max(30000),transition:z.object({kind:z.enum(['immediate','fade','scale','pulse']),durationMs:z.number().int().min(0).max(5000)}).strict()}).strict()
export const effectPlaybackSchema=effectPlaybackSettingsSchema.extend({state:z.enum(['inactive','active','paused']),revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER-1),elapsedMs:z.number().int().min(0).max(Number.MAX_SAFE_INTEGER-1),startedAt:stamp.optional(),stoppedAt:stamp.optional(),stopWeight:z.number().finite().min(0).max(1).optional()}).strict().superRefine((p,ctx)=>{if(p.state==='active'&&p.startedAt===undefined)ctx.addIssue({code:'custom',message:'Active playback requires a start time.'});if(p.state!=='active'&&p.startedAt!==undefined)ctx.addIssue({code:'custom',message:'Only active playback has a running start time.'})})
export type EffectPlayback=z.infer<typeof effectPlaybackSchema>
export type EffectPlaybackSettings=z.infer<typeof effectPlaybackSettingsSchema>
export const defaultPlaybackSettings=():EffectPlaybackSettings=>({mode:'loop',durationMs:3000,transition:{kind:'fade',durationMs:500}})
export function playbackElapsed(p:EffectPlayback,now:number){return Math.min(Number.MAX_SAFE_INTEGER-1,p.elapsedMs+(p.state==='active'?Math.max(0,now-(p.startedAt??now)):0))}
export function samplePlayback(p:EffectPlayback|undefined,now=Date.now(),reduced=false){
 if(!p)return{time:undefined,opacity:1,scale:1,moving:true,visible:true,finished:false}
 const elapsed=playbackElapsed(p,now),duration=p.transition.kind==='immediate'||reduced?0:p.transition.durationMs,finished=p.mode==='once'&&elapsed>=p.durationMs
 let weight=p.state==='inactive'?(duration&&p.stoppedAt!==undefined?(p.stopWeight??1)*Math.min(1,Math.max(0,1-(now-p.stoppedAt)/duration)):0):1
 if(p.state!=='inactive'&&duration){weight=Math.min(1,elapsed/(p.mode==='once'?Math.min(duration,p.durationMs/2):duration));if(p.mode==='once')weight*=Math.min(1,Math.max(0,(p.durationMs-elapsed)/Math.min(duration,p.durationMs/2)))}
 if(finished)weight=0
 const scale=p.transition.kind==='scale'?.1+.9*weight:p.transition.kind==='pulse'?1-.15*Math.sin(Math.PI*weight):1
 return{time:elapsed/1000,opacity:weight,scale,moving:(p.state==='active'&&!finished)||p.state==='inactive'&&weight>0,visible:weight>0||p.state==='active'&&!finished,finished}
}
export function configurePlayback(current:EffectPlayback|undefined,settings:EffectPlaybackSettings,expectedRevision:number,at:number):EffectPlayback{
 if((current?.revision??0)!==expectedRevision)throw new Error('Effect playback changed. Reload the current effect before trying again.')
 const base=current??{...defaultPlaybackSettings(),state:'active' as const,revision:0,elapsedMs:0,startedAt:at}
 if(base.mode!==settings.mode||!current)return effectPlaybackSchema.parse({...settings,state:settings.mode==='loop'?'active':'inactive',revision:base.revision+1,elapsedMs:0,...(settings.mode==='loop'?{startedAt:at}:{})})
 return effectPlaybackSchema.parse({...base,...settings,revision:base.revision+1})
}
export function controlPlayback(current:EffectPlayback|undefined,action:'activate'|'deactivate'|'restart'|'pause'|'resume',expectedRevision:number,at:number):EffectPlayback{
 if((current?.revision??0)!==expectedRevision)throw new Error('Effect playback changed. Reload the current effect before trying again.')
 const p=current??{...defaultPlaybackSettings(),state:'active' as const,revision:0,elapsedMs:0,startedAt:at},elapsed=Math.floor(playbackElapsed(p,at)),sample=samplePlayback(p,at)
 if(current&&(action==='activate'&&p.state==='active'&&!sample.finished||action==='deactivate'&&p.state==='inactive'||action==='pause'&&p.state==='paused'))return p
 const {startedAt,stoppedAt,stopWeight,...plain}=p;void startedAt;void stoppedAt;void stopWeight
 const next={...plain,revision:p.revision+1}
 if(action==='activate'||action==='restart')return effectPlaybackSchema.parse({...next,state:'active',elapsedMs:0,startedAt:at})
 if(action==='deactivate')return effectPlaybackSchema.parse({...next,state:'inactive',elapsedMs:elapsed,stoppedAt:at,stopWeight:sample.opacity})
 if(action==='pause'){if(p.state!=='active'||sample.finished)throw new Error('Only a playing effect can be paused.');return effectPlaybackSchema.parse({...next,state:'paused',elapsedMs:elapsed})}
 if(p.state!=='paused')throw new Error('Only a paused effect can be resumed.')
 return effectPlaybackSchema.parse({...next,state:'active',elapsedMs:elapsed,startedAt:at})
}
