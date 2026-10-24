import {propTypes} from './dungeon.ts'
export const builtinObjects=propTypes.map(type=>({type,name:type,category:type==='pillar'?'architecture':type==='rock'?'terrain':type==='torch'||type==='brazier'?'decoration':'furniture'}))
export const filterBuiltinObjects=(search:string,category:string)=>builtinObjects.filter(o=>o.name.includes(search.trim().toLowerCase())&&(!category||o.category===category))
