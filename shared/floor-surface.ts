import {z} from 'zod'
export const starterTextures=[{id:'builtin:stone',name:'Stone floor'},{id:'builtin:wood',name:'Wooden plank floor'},{id:'builtin:grass',name:'Grass ground'},{id:'builtin:mud',name:'Mud'},{id:'builtin:sand',name:'Sand'},{id:'builtin:water',name:'Shallow water'}] as const
export const textureAssetId=z.union([z.uuid(),z.enum(['builtin:stone','builtin:wood','builtin:grass','builtin:mud','builtin:sand','builtin:water'])])
export const hexColor=z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const repeatingTextureSchema=z.object({assetId:textureAssetId,repeatEverySquares:z.number().finite().min(.25).max(50).default(2),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),brightness:z.number().finite().min(.1).max(2).default(1),tint:hexColor.default('#ffffff'),offsetX:z.number().finite().min(-100).max(100).default(0),offsetZ:z.number().finite().min(-100).max(100).default(0)}).strict()
export const floorSurfaceSchema=z.object({mode:z.enum(['solid','image','texture']),solidColor:hexColor.optional(),texture:repeatingTextureSchema.optional()}).strict().refine(s=>s.mode!=='texture'||Boolean(s.texture),'Choose a texture.')
export type FloorSurface=z.infer<typeof floorSurfaceSchema>
export type RepeatingTexture=z.infer<typeof repeatingTextureSchema>
export interface TextureAsset{id:string;name:string;kind:'texture';width:number;height:number;fileSize:number;revision:number;references?:number}
export function surfaceMode(level:{floorSurface?:FloorSurface;floorImage?:unknown}){return level.floorSurface?.mode??(level.floorImage?'image':'solid')}
// x east, z south. Inverse clockwise rotation; offsets in squares. v=1 is north.
export function repeatingTextureUv(x:number,z:number,pixelWidth:number,pixelHeight:number,texture:RepeatingTexture):[number,number]{
 const a=texture.rotation*Math.PI/180,dx=x-texture.offsetX,dz=z-texture.offsetZ
 return [(dx*Math.cos(a)+dz*Math.sin(a))/texture.repeatEverySquares,1-(-dx*Math.sin(a)+dz*Math.cos(a))/(texture.repeatEverySquares*pixelHeight/pixelWidth)]
}
export const customTextureIds=(surface?:FloorSurface)=>surface?.texture&&!surface.texture.assetId.startsWith('builtin:')?[surface.texture.assetId]:[]
