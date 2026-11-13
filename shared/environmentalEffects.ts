import {z} from 'zod'
export const effectIdSchema=z.string().min(1).max(100).regex(/^[A-Za-z0-9_:-]+$/).refine(s=>!['__proto__','constructor','prototype'].includes(s))
export const effectCategories=['Elemental','Atmospheric','Magical','Environmental','Energy'] as const
export const effectParametersSchema=z.object({
 scale:z.number().finite().min(.1).max(5),intensity:z.number().finite().min(0).max(2),speed:z.number().finite().min(0).max(4),
 color:z.string().regex(/^#[0-9a-fA-F]{6}$/),opacity:z.number().finite().min(0).max(1),
}).strict()
export const particleParametersSchema=z.object({density:z.number().finite().min(.1).max(1),lifetime:z.number().finite().min(.25).max(10),spread:z.number().finite().min(.1).max(4),height:z.number().finite().min(.1).max(8),direction:z.object({x:z.number().finite().min(-1).max(1),z:z.number().finite().min(-1).max(1)}).strict(),embers:z.boolean()}).strict()
export const surfaceParametersSchema=z.object({radius:z.number().finite().min(.25).max(4),pulse:z.number().finite().min(0).max(1),secondaryColor:z.string().regex(/^#[0-9a-fA-F]{6}$/),particles:z.boolean()}).strict()
export type SurfaceParameters=z.infer<typeof surfaceParametersSchema>
export type ParticleParameters=z.infer<typeof particleParametersSchema>
const particleDefaults:ParticleParameters={density:.7,lifetime:3,spread:.5,height:1.5,direction:{x:0,z:0},embers:false}
interface Preset {
 id:string;name:string;category:typeof effectCategories[number];icon:string;description:string;
 defaults:z.infer<typeof effectParametersSchema>;parameters:typeof effectParametersSchema;
 renderer:'motes'|'fire'|'atmosphere'|'sparks'|'portal'|'circle'|'corruption'|'liquid'|'energy';style:'motes'|'fire'|'smoke'|'steam'|'burst'|'mist'|'embers'|'falling'|'electrical'|'fey'|'arcane'|'dark'|'runes'|'ritual'|'summoning'|'corruption'|'dark-energy'|'cracks'|'poison'|'acid'|'lava'|'liquid'|'arcs'|'lightning'|'unstable';
 resources:{geometry:string;textures:number};quality:{low:number;medium:number;high:number};radius:number;lighting:boolean;attachments:boolean;
 surface?:SurfaceParameters;secondary?:'motes'|'bubbles';particles?:ParticleParameters
}
const make=(id:string,name:string,category:Preset['category'],renderer:Preset['renderer'],style:Preset['style'],color:string,description:string,particles:Partial<ParticleParameters>={},lighting=false):Preset=>({id,name,category,renderer,style,description,icon:renderer==='fire'?'♨':renderer==='sparks'?'✧':'≋',
 defaults:{scale:1,intensity:1,speed:1,color,opacity:renderer==='atmosphere'?.45:.85},parameters:effectParametersSchema,
 resources:{geometry:renderer==='fire'?'crossed-flames-and-billboards':'instanced-billboards',textures:0},quality:renderer==='atmosphere'?{low:6,medium:14,high:24}:{low:12,medium:32,high:64},radius:1.5,lighting,attachments:false,particles:{...particleDefaults,...particles}} as Preset)
const surface=(id:string,name:string,renderer:'portal'|'circle'|'corruption'|'liquid'|'energy',style:Preset['style'],color:string,secondaryColor:string,description:string,lighting=true,secondary?:'motes'|'bubbles'):Preset=>({
 id,name,category:renderer==='liquid'||renderer==='corruption'?'Environmental':renderer==='energy'?'Energy':'Magical',icon:renderer==='portal'?'◉':renderer==='energy'?'ϟ':'◎',description,
 defaults:{scale:1,intensity:1,speed:1,color,opacity:renderer==='liquid'?.85:.8},parameters:effectParametersSchema,renderer,style,
 resources:{geometry:renderer==='energy'?'bounded-ribbons':'procedural-surface',textures:0},quality:{low:12,medium:24,high:48},radius:1.5,lighting,attachments:false,
 surface:{radius:renderer==='portal'?1.2:renderer==='circle'?1.5:1.3,pulse:.25,secondaryColor,particles:Boolean(secondary)},secondary,
})
export const effectRegistry={
 'magical-motes':{id:'magical-motes',name:'Magical motes',category:'Magical',icon:'✦',description:'A bounded cloud of softly drifting magical lights.',defaults:{scale:1,intensity:1,speed:1,color:'#97e8ce',opacity:.7},parameters:effectParametersSchema,renderer:'motes',style:'motes',resources:{geometry:'seeded-points',textures:0},quality:{low:12,medium:32,high:64},radius:1.5,lighting:false,attachments:false},
 'small-flame':make('small-flame','Small flame','Elemental','fire','fire','#ff8736','A small licking flame for a candle or burning object.',{spread:.25,height:.7,embers:true},true),
 'campfire':make('campfire','Campfire','Elemental','fire','fire','#ff9d42','Layered warm flames with optional rising embers.',{spread:.6,height:1.5,embers:true},true),
 'brazier-flame':make('brazier-flame','Brazier flame','Elemental','fire','fire','#ffb34d','A compact, bright flame for a brazier or forge.',{spread:.4,height:1.1,embers:true},true),
 'large-fire':make('large-fire','Large fire','Elemental','fire','fire','#ff722b','Tall turbulent flames for burning crates or a large blaze.',{spread:1,height:3,embers:true},true),
 'rising-embers':make('rising-embers','Rising embers','Elemental','sparks','embers','#ffad44','Small glowing embers rising and fading.',{spread:.7,height:2,lifetime:4}),
 'falling-sparks':make('falling-sparks','Falling sparks','Energy','sparks','falling','#ffd373','A shower of sparks falling from a forge.',{spread:.7,height:2,lifetime:1.5}),
 'electrical-sparks':make('electrical-sparks','Electrical sparks','Energy','sparks','electrical','#8ecfff','Short outward electrical sparks around machinery.',{spread:1,height:1,lifetime:.6}),
 'smoke-column':make('smoke-column','Smoke column','Atmospheric','atmosphere','smoke','#77736d','Layered smoke billows rising in a column.',{spread:.6,height:3,lifetime:5}),
 'drifting-smoke':make('drifting-smoke','Drifting smoke','Atmospheric','atmosphere','smoke','#9c9994','A drifting smoke plume with adjustable direction.',{spread:1,height:2,lifetime:6,direction:{x:.7,z:0}}),
 'thick-smoke':make('thick-smoke','Thick smoke cloud','Atmospheric','atmosphere','smoke','#55535a','Dense, slow billows for a smoke-filled space.',{spread:1.4,height:2,lifetime:8,density:1}),
 'steam-vent':make('steam-vent','Steam vent','Atmospheric','atmosphere','steam','#e4f1f4','A narrow pale jet of rapidly rising steam.',{spread:.4,height:2,lifetime:2}),
 'steam-burst':make('steam-burst','Steam short burst','Atmospheric','atmosphere','burst','#e8f6ff','A repeating short puff of steam from a vent.',{spread:.8,height:1.5,lifetime:2}),
 'steam-plume':make('steam-plume','Steam plume','Atmospheric','atmosphere','steam','#d6e7eb','A continuous broad plume of cooling steam.',{spread:.8,height:3,lifetime:4}),
 'ground-mist':make('ground-mist','Ground mist','Atmospheric','atmosphere','mist','#b7c9ca','Slow mist hugging the floor.',{spread:1.5,height:.2,lifetime:8,direction:{x:.2,z:0}}),
 'cavern-mist':make('cavern-mist','Cavern mist','Atmospheric','atmosphere','mist','#93b5bc','Cool low mist drifting across a cavern.',{spread:2,height:.35,lifetime:10,direction:{x:.1,z:.1}}),
 'magical-mist':make('magical-mist','Magical mist','Atmospheric','atmosphere','mist','#a7a0e8','Soft violet ground mist for enchanted places.',{spread:1.5,height:.3,lifetime:8}),
 'fey-portal':surface('fey-portal','Fey portal','portal','fey','#7be3a3','#b18cff','A swirling green and violet gateway; visual only.',true,'motes'),
 'arcane-portal':surface('arcane-portal','Arcane portal','portal','arcane','#73caff','#e9f5ff','A luminous blue vortex edged with rotating arcane marks.',true,'motes'),
 'dark-portal':surface('dark-portal','Dark portal','portal','dark','#9b65d9','#ed78d4','A dark swirling surface with a violet energy rim.',true,'motes'),
 'glowing-runes':surface('glowing-runes','Glowing runes','circle','runes','#88ddff','#e5faff','Rotating luminous runes drawn above the floor.'),
 'ritual-circle':surface('ritual-circle','Ritual circle','circle','ritual','#ed8168','#ffd4a0','Layered ritual rings and pulsing angular glyphs.'),
 'summoning-circle':surface('summoning-circle','Summoning circle','circle','summoning','#c68fff','#7bd6ef','A glowing star and concentric summoning seals.'),
 'magical-corruption':surface('magical-corruption','Magical corruption','corruption','corruption','#8a4fb0','#d5a5ff','Pulsing tendrils give an impression of spread within a fixed patch.',true,'motes'),
 'dark-energy':surface('dark-energy','Pulsing dark energy','corruption','dark-energy','#61368b','#ed73d5','A dark pulsing field threaded with glowing veins.',true,'motes'),
 'glowing-cracks':surface('glowing-cracks','Glowing cracks','corruption','cracks','#f5a054','#fff1ac','Animated glowing fractures painted visually above the floor.'),
 'floating-motes':make('floating-motes','Floating magical motes','Magical','sparks','embers','#bda0ff','Soft drifting magical motes over enchanted ground.',{spread:.8,height:1.5,lifetime:6}),
 'poison-pool':surface('poison-pool','Poison pool','liquid','poison','#76ac46','#d8ff85','An animated green pool with optional bubbles; no damage.',true,'bubbles'),
 'acid-pool':surface('acid-pool','Acid pool','liquid','acid','#b4d945','#f5ffbd','Bright acid ripples and optional surface bubbles; visual only.',true,'bubbles'),
 'lava-pool':surface('lava-pool','Lava pool','liquid','lava','#f16b27','#ffe28a','Molten currents between dark crusts, with optional bubbles.',true,'bubbles'),
 'magical-liquid':surface('magical-liquid','Magical liquid','liquid','liquid','#58bfc5','#c5a0ff','Shimmering magical liquid with colourful ripples.',true,'bubbles'),
 'electrical-arcs':surface('electrical-arcs','Electrical arcs','energy','arcs','#9cd8ff','#f0fbff','Bounded electrical ribbons between fixed local endpoints.'),
 'lightning-burst':surface('lightning-burst','Lightning bursts','energy','lightning','#b7c5ff','#ffffff','Repeating flashes of branching lightning; visual only.'),
 'unstable-energy':surface('unstable-energy','Unstable energy','energy','unstable','#cb7ee7','#8ddcff','Twisting energetic filaments that stay inside their placed extent.'),
 'magical-sparks':make('magical-sparks','Magical sparks','Energy','sparks','electrical','#db9dff','A bounded shower of violet magical sparks.',{spread:1,height:1.2,lifetime:1},true),
} satisfies Record<string,Preset>
export type EffectPresetId=keyof typeof effectRegistry
export const magicalEffectPresetIds:EffectPresetId[]=['fey-portal','arcane-portal','dark-portal','glowing-runes','ritual-circle','summoning-circle','magical-corruption','dark-energy','glowing-cracks','floating-motes','poison-pool','acid-pool','lava-pool','magical-liquid','electrical-arcs','lightning-burst','unstable-energy','magical-sparks']
export function effectPreset(id:EffectPresetId):Preset{return effectRegistry[id]}
export const effectPresetIds=Object.keys(effectRegistry) as [EffectPresetId,...EffectPresetId[]]
export const effectLightSchema=z.object({emitterId:effectIdSchema}).strict()
export const effectSchema=effectParametersSchema.extend({id:effectIdSchema,presetId:z.enum(effectPresetIds),floorId:effectIdSchema,
 position:z.object({x:z.number().finite().min(0).max(50),z:z.number().finite().min(0).max(50),heightFeet:z.number().finite().min(0).max(500)}).strict(),
 rotation:z.number().finite().min(0).max(360),enabled:z.boolean(),parameters:particleParametersSchema.optional(),surface:surfaceParametersSchema.optional(),light:effectLightSchema.optional(),
}).strict().superRefine((e,ctx)=>{const p=effectPreset(e.presetId);if(e.surface&&!p.surface)ctx.addIssue({code:'custom',message:'This preset does not support surface controls.'});if(e.surface?.particles&&!p.secondary)ctx.addIssue({code:'custom',message:'This preset does not support secondary detail.'});if(e.parameters&&!p.particles)ctx.addIssue({code:'custom',message:'This preset does not support particle controls.'});if(e.light&&!p.lighting)ctx.addIssue({code:'custom',message:'This preset does not support a linked light.'});if(e.parameters?.embers&&p.renderer!=='fire')ctx.addIssue({code:'custom',message:'Secondary embers require a fire preset.'})})
export const environmentalEffectsSchema=z.object({version:z.literal(1),effects:z.array(effectSchema).max(64).refine(a=>new Set(a.map(e=>e.id)).size===a.length,'Effect IDs must be unique.')}).strict()
export type EnvironmentalEffect=z.infer<typeof effectSchema>
export function effectParticles(e:EnvironmentalEffect):ParticleParameters{return e.parameters??effectPreset(e.presetId).particles??particleDefaults}
// Conservative horizontal support for every shader displacement and billboard corner, at every yaw.
export function effectSurface(e:EnvironmentalEffect):SurfaceParameters{return e.surface??effectPreset(e.presetId).surface??{radius:1,pulse:0,secondaryColor:e.color,particles:false}}
export function effectRadius(e:EnvironmentalEffect){if(effectPreset(e.presetId).surface)return 1.5*effectSurface(e).radius*e.scale;return effectPreset(e.presetId).renderer==='motes'?1.5*e.scale:4*effectParticles(e).spread*e.scale}
export function effectParticleCount(e:EnvironmentalEffect,quality:'low'|'medium'|'high'){return Math.max(1,Math.ceil(effectPreset(e.presetId).quality[quality]*(effectPreset(e.presetId).renderer==='motes'?1:effectParticles(e).density)))}
export function createEffect(id:string,presetId:EffectPresetId,floorId:string,position:EnvironmentalEffect['position']):EnvironmentalEffect{
 const preset=effectPreset(presetId)
 return effectSchema.parse({...preset.defaults,id,presetId,floorId,position,rotation:0,enabled:true,...(preset.particles?{parameters:structuredClone(preset.particles)}:{}),...(preset.surface?{surface:structuredClone(preset.surface)}:{})})
}
