import {dungeonLevels,type DungeonMap} from '../shared/dungeon'
import type {FloorTransition} from '../shared/transitions'
export function newTransition(map:DungeonMap):FloorTransition{
 const levels=dungeonLevels(map)
 return {id:crypto.randomUUID(),type:'stairs',source:{floorId:levels[0].id,x:0,z:0},destination:{floorId:levels[1]?.id??levels[0].id,x:0,z:0},directionality:'two-way',movementCost:'normal'}
}
