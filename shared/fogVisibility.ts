import {dungeonLevels,primaryLevelId,type DungeonMap,type DungeonLevel} from './dungeon.ts'
import {floorRevealed,regionRevealed} from './fog.ts'
import {isScenery} from './scenery.ts'
export function visibleFogLevel(map:DungeonMap,level:DungeonLevel):DungeonLevel{
 const fog=map.fogOfWar,full=floorRevealed(fog,level.id,level.width,level.height)
 if(!fog?.enabled)return {...level,props:level.props.filter(p=>!isScenery(p)||p.visible)}
 const region=(x:number,z:number,x1:number,z1:number)=>regionRevealed(fog,level.id,level.width,level.height,x,z,x1,z1)
 const walls=level.walls.filter(w=>w.visual?full:region(w.x-(w.axis==='V'?.08:.02),w.z-(w.axis==='H'?.08:.02),w.x+(w.axis==='H'?1.02:.08),w.z+(w.axis==='V'?1.02:.08)))
 const ids=new Set(walls.map(w=>w.id))
 return {...level,
  floors:level.floors.filter(f=>region(f.x,f.z,f.x+1,f.z+1)),walls,
  doors:level.doors.filter(d=>{const w=level.walls.find(w=>w.id===d.wallId);return w&&ids.has(d.wallId)&&(!d.visual||full)&&region(w.x-.2,w.z-.2,w.x+1,w.z+1)}),
  props:level.props.filter(p=>isScenery(p)?p.visible&&full:region(p.position.x+.5-(p.scale??1)*.75,p.position.z+.5-(p.scale??1)*.75,p.position.x+.5+(p.scale??1)*.75,p.position.z+.5+(p.scale??1)*.75)),
  terrainPaint:full?level.terrainPaint:level.terrainPaint?.filter(s=>{const r=s.brush.size/2;return region(Math.min(...s.points.map(p=>p.x))-r,Math.min(...s.points.map(p=>p.z))-r,Math.max(...s.points.map(p=>p.x))+r,Math.max(...s.points.map(p=>p.z))+r)}),
  floorImage:level.floorImage&&!full?{...level.floorImage,fit:'contain',alignment:'center',scale:1,rotation:0,offsetX:0,offsetZ:0,fogView:{floorId:level.id,revision:fog.revision}}:level.floorImage,
 }
}
export function fogTokenVisible(map:DungeonMap|undefined,c:{floorId?:string;unplaced?:boolean;miniature?:{assetId?:string|null}},position?:{x:number;z:number}){
 if(!map?.fogOfWar?.enabled)return true
 if(c.unplaced||!position)return false
 const level=dungeonLevels(map).find(l=>l.id===(c.floorId??primaryLevelId(map)))
 if(!level||!level.playerVisible)return false
 if(c.miniature?.assetId)return floorRevealed(map.fogOfWar,level.id,level.width,level.height)
 return regionRevealed(map.fogOfWar,level.id,level.width,level.height,position.x,position.z,position.x+1,position.z+1)
}
export function fogFloorFull(map:DungeonMap|undefined,id?:string){
 if(!map?.fogOfWar?.enabled)return true
 const level=dungeonLevels(map).find(l=>l.id===(id??primaryLevelId(map)))
 return Boolean(level&&floorRevealed(map.fogOfWar,level.id,level.width,level.height))
}
