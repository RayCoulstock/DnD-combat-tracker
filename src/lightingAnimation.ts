import {Color,MathUtils} from 'three'
import type {LightingTransition} from '../shared/lighting'
// One mutable animation per emitter/environment. A first mount always shows the
// authoritative target; only a newly received activation animates an existing view.
export class LightingAnimation<T>{
 current:T;private from:T;private target:T;private transitionId?:string;private context:string;private start=0;private duration=0
 constructor(value:T,context:string,transition?:LightingTransition){this.current=value;this.from=value;this.target=value;this.context=context;this.transitionId=transition?.id}
 update(value:T,context:string,transition:LightingTransition|undefined,reduced:boolean,now=Date.now()){
  if(context===this.context&&transition?.id===this.transitionId&&!reduced&&JSON.stringify(value)===JSON.stringify(this.target))return
  const changed=Boolean(transition&&transition.id!==this.transitionId),remaining=transition?transition.startedAt+transition.durationMs-now:0
  this.from=this.current;this.target=value;this.start=now;this.duration=changed&&context===this.context&&!reduced?Math.max(0,Math.min(transition!.durationMs,remaining)):0;this.context=context;this.transitionId=transition?.id
  if(!this.duration)this.current=value
 }
 sample(blend:(a:T,b:T,t:number)=>T,now=Date.now()){const t=this.duration?Math.min(1,Math.max(0,(now-this.start)/this.duration)):1;this.current=t===1?this.target:blend(this.from,this.target,t);return{value:this.current,active:t<1}}
}
const a=new Color(),b=new Color()
export const blendColour=(from:string,to:string,t:number)=>'#'+a.set(from).lerp(b.set(to),t).getHexString()
export const blendNumber=MathUtils.lerp
