import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const css=readFileSync(new URL('../src/ui/tokens.css',import.meta.url),'utf8')
const tokens=Object.fromEntries([...css.matchAll(/--ledger-([\w-]+):\s*(#[\da-f]{6})\s*;/gi)].map(m=>[m[1],m[2]]))
function luminance(hex){const values=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return values.reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0)}
function contrast(a,b){const values=[luminance(tokens[a]),luminance(tokens[b])].sort((a,b)=>a-b);return(values[1]+.05)/(values[0]+.05)}
test('foundation normal text tokens meet 4.5:1 on their supported opaque surfaces',()=>{
 for(const [ink,bg]of[['ink','card'],['ink','surface'],['muted','well'],['muted','surface'],['card','accent'],['card','accent-hover'],['accent','card'],['accent','accent-soft'],['ok','ok-soft'],['warn','warn-soft'],['party','party-soft']])assert.ok(contrast(ink,bg)>=4.5,`${ink} on ${bg}: ${contrast(ink,bg).toFixed(2)}`)
})
test('foundation control boundary and focus ring meet 3:1 on supported surfaces',()=>{
 for(const [ink,bg]of[['control-line','card'],['focus','card'],['focus','surface'],['focus','well']])assert.ok(contrast(ink,bg)>=3,`${ink} on ${bg}: ${contrast(ink,bg).toFixed(2)}`)
})
