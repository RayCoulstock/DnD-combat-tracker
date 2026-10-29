import { useEffect, useRef, useState, type DragEvent } from 'react'
import { floorImageSchema, type FloorImage, type FloorImageAsset } from '../shared/floor-image'
import { readDungeon, type DungeonMap } from '../shared/dungeon'
import type { GameCommand } from '../shared/domain'
interface Props {
  levelId?:string; document?:DungeonMap; api?: (path:string,body?:unknown)=>Promise<unknown>
  disabled:boolean; send:(command:GameCommand)=>Promise<void>
  onPreview:(command:Extract<GameCommand,{type:'map.floorImage.set'}>|null)=>void
}
export default function FloorImagePanel({levelId,document,api,disabled,send,onPreview}:Props){
  const [image,setImage]=useState<FloorImage|null>(document?.floorImage??null)
  const [width,setWidth]=useState(document?.width??20),[height,setHeight]=useState(document?.height??20)
  const [progress,setProgress]=useState<number|null>(null),[message,setMessage]=useState(''),[images,setImages]=useState<FloorImageAsset[]>([]),[selected,setSelected]=useState(''),[maxBytes,setMaxBytes]=useState(15*1024*1024)
  const xhr=useRef<XMLHttpRequest|null>(null),stopped=useRef(false),fileInput=useRef<HTMLInputElement>(null)
  useEffect(()=>{stopped.current=false;return()=>{stopped.current=true;xhr.current?.abort();onPreview(null)}},[onPreview])
  useEffect(()=>{
    let stale=false
    if(api)void api('/floor-images').then(value=>{if(!stale){const result=value as {images:FloorImageAsset[];limits:{maxBytes:number}};setImages(result.images);setMaxBytes(result.limits.maxBytes)}}).catch(()=>{})
    return()=>{stale=true}
  },[api])
  const edit=<K extends keyof FloorImage>(key:K,value:FloorImage[K])=>setImage(current=>current?{...current,[key]:value}:current)
  const chooseImage=(asset:FloorImageAsset)=>{setImage(floorImageSchema.parse({imageId:asset.id,locked:false}));setMessage('Image uploaded. Preview calibration, then apply it to the shared map.');onPreview(null)}
  const upload=async(file?:File)=>{
    if(!file||!api||!document||disabled||progress!==null)return
    if(file.size>maxBytes){setMessage(`Image exceeds the ${(maxBytes/1024/1024).toFixed(1)} MiB upload limit.`);return}
    setMessage('');setProgress(0)
    try{
      const session=await(await fetch('/api/session',{credentials:'same-origin'})).json()
      if(stopped.current)return
      const request=new XMLHttpRequest();xhr.current=request
      request.open('POST','/api/floor-images');request.timeout=180000;request.setRequestHeader('X-CSRF-Token',session.csrf)
      request.upload.onprogress=event=>{if(!stopped.current&&event.lengthComputable)setProgress(Math.round(event.loaded/event.total*100))}
      const done=(error?:string)=>{if(!stopped.current){setProgress(null);if(error)setMessage(error)}xhr.current=null}
      request.ontimeout=()=>done('Image upload timed out. Check the connection and retry.')
      request.onerror=()=>done('Upload failed. Check the connection and retry.')
      request.onabort=()=>done('Image upload cancelled.')
      request.onload=()=>{
        if(stopped.current)return
        let result
        try{result=JSON.parse(request.responseText)}catch{done('Upload failed. Check the backend and retry.');return}
        if(request.status!==201){done(result.error?.message??'Image upload failed.');return}
        chooseImage(result);setImages(prior=>[result,...prior.filter(item=>item.id!==result.id)]);done()
      }
      const data=new FormData();data.set('metadata','{}');data.set('file',file);request.send(data)
    }catch(error){if(!stopped.current){setProgress(null);setMessage(error instanceof Error?error.message:'Image upload failed.')}}
  }
  const drop=(event:DragEvent)=>{event.preventDefault();event.stopPropagation();if(event.dataTransfer.files.length!==1){setMessage('Drop one image at a time.');return}void upload(event.dataTransfer.files[0])}
  const command=()=>{
    if(!document)throw new Error('Create a blank map before adding a floor image.')
    const parsed=readDungeon({...document,width,height,...(image?{floorImage:floorImageSchema.parse(image),schemaVersion:Math.max(4,document.schemaVersion)}:{floorImage:undefined})})
    return {type:'map.floorImage.set' as const,levelId,image:parsed.floorImage??null,width:parsed.width,height:parsed.height}
  }
  const preview=()=>{try{onPreview(command());setMessage('Local calibration preview. Other players see the saved version until you apply.')}catch(error){setMessage((error as Error).message)}}
  const apply=async(remove=false)=>{
    try{
      await send(remove?{type:'map.floorImage.set',levelId,image:null,width:document!.width,height:document!.height}:command())
      if(!stopped.current){onPreview(null);setMessage('Floor image settings saved.')}
    }catch(error){if(!stopped.current)setMessage((error as Error).message)}
  }
  return <details><summary>Floor Image <small>{document?.floorImage?'Configured':'Procedural'}</small></summary>
    <section className="floor-image-panel" aria-label="Floor image settings">
      {!document&&<p>Create or load a dungeon map first.</p>}
      {!api&&<p>Sign in to a multiplayer DM encounter to upload persistent floor images.</p>}
      <fieldset disabled={disabled||!document||progress!==null}>
        <div className="floor-image-drop" onDragOver={event=>{event.preventDefault();event.stopPropagation()}} onDrop={drop}>
          <label>Upload or replace floor image<input ref={fileInput} aria-label="Floor image file" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" disabled={!api} onChange={event=>{void upload(event.target.files?.[0]);event.target.value=''}}/></label>
          <p>Drop one PNG, JPEG or WebP here. Up to {(maxBytes/1024/1024).toFixed(1)} MiB; no SVG or animation.</p>
        </div>
        {images.length>0&&<><label>Uploaded floor images<select aria-label="Uploaded floor images" value={selected} onChange={event=>{setSelected(event.target.value);const asset=images.find(item=>item.id===event.target.value);if(asset)chooseImage(asset)}}><option value="">Choose an uploaded image</option>{images.map((asset,index)=><option key={asset.id} value={asset.id}>{asset.width} × {asset.height} · image {index+1} · {asset.id.slice(0,8)}</option>)}</select></label>{selected&&<button type="button" onClick={()=>{const asset=images.find(item=>item.id===selected);if(asset&&api)void api(`/floor-images/${asset.id}/delete`,{revision:asset.revision}).then(()=>{if(!stopped.current){setImages(items=>items.filter(item=>item.id!==asset.id));setSelected('');setMessage('Unreferenced image deleted.')}}).catch(error=>{if(!stopped.current)setMessage(error.message)})}}>Delete unreferenced image</button>}</>}
        {image&&<><img loading="lazy" className="floor-image-preview" src={`/api/floor-images/${image.imageId}/file`} alt="Floor image preview"/>
          <label>Image grid mode<select aria-label="Image grid mode" value={image.mode} onChange={event=>setImage({...image,mode:event.target.value as FloorImage['mode'],showGrid:event.target.value==='gridless'})}><option value="gridded">Gridded image (printed grid)</option><option value="gridless">Gridless image</option></select></label>
          <label><input type="checkbox" checked={image.locked} onChange={event=>edit('locked',event.target.checked)}/>Lock image transformations</label>
        </>}
        <form onSubmit={event=>{event.preventDefault();void apply()}}>
          <fieldset disabled={image?.locked??false}><legend>Grid dimensions and calibration</legend>
            <p>1 square = 5 feet. Existing coordinates stay fixed; shrinking past placements is rejected. Offsets are in squares; positive X is right, positive Z is down.</p>
            <label>Image map width (squares)<input aria-label="Image map width (squares)" type="number" min={4} max={50} required value={width} onChange={event=>setWidth(Number(event.target.value))}/></label>
            <label>Image map height (squares)<input aria-label="Image map height (squares)" type="number" min={4} max={50} required value={height} onChange={event=>setHeight(Number(event.target.value))}/></label>
            {image&&<>
              <label>Image fit<select aria-label="Image fit" value={image.fit} onChange={event=>edit('fit',event.target.value as FloorImage['fit'])}><option value="contain">Fit inside (letterbox)</option><option value="cover">Fill map (crop)</option></select></label>
              <label>Image alignment<select aria-label="Image alignment" value={image.alignment} onChange={event=>edit('alignment',event.target.value as FloorImage['alignment'])}><option value="center">Centre</option><option value="top-left">Top left</option></select></label>
              {(['offsetX','offsetZ','scale'] as const).map(key=><label key={key}>{key==='offsetX'?'Horizontal image offset':key==='offsetZ'?'Vertical image offset':'Image scale'}<input aria-label={key==='offsetX'?'Horizontal image offset':key==='offsetZ'?'Vertical image offset':'Image scale'} type="number" step={.01} min={key==='scale'?.01:-100} max={key==='scale'?20:100} required value={image[key]} onChange={event=>edit(key,Number(event.target.value))}/></label>)}
              <label>Image rotation<select aria-label="Image rotation" value={image.rotation} onChange={event=>edit('rotation',Number(event.target.value) as FloorImage['rotation'])}>{[0,90,180,270].map(rotation=><option key={rotation} value={rotation}>{rotation}° clockwise</option>)}</select></label>
              <button type="button" onClick={()=>setImage(floorImageSchema.parse({imageId:image.imageId,mode:image.mode,showGrid:image.mode==='gridless',locked:false}))}>Reset calibration</button>
            </>}
          </fieldset>
          {image&&<><label>Image opacity<input aria-label="Image opacity" type="number" min={0} max={1} step={.01} required value={image.opacity} onChange={event=>edit('opacity',Number(event.target.value))}/></label><label><input type="checkbox" checked={image.showGrid} onChange={event=>edit('showGrid',event.target.checked)}/>Show tactical grid over image</label></>}
          <div className="builder-row"><button type="button" onClick={preview}>Preview calibration</button><button type="button" onClick={()=>{onPreview(null);setImage(document?.floorImage??null);setWidth(document?.width??20);setHeight(document?.height??20);setMessage('Calibration preview cancelled.')}}>Cancel calibration</button><button type="submit">Apply floor image</button></div>
        </form>
        {document?.floorImage&&<button type="button" onClick={()=>void apply(true)}>Remove floor image / restore procedural floor</button>}
      </fieldset>
      {progress!==null&&<div role="status"><progress max={100} value={progress}/>{progress<100?`Uploading ${progress}%`:'Processing image…'}<button type="button" onClick={()=>xhr.current?.abort()}>Cancel image upload</button></div>}
      {message&&<p role="status">{message}</p>}
    </section>
  </details>
}
