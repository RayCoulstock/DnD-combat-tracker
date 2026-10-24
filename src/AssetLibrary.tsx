import { useEffect, useRef, useState, type FormEvent } from 'react'
import { assetCategories, assetMetadataSchema, type Asset3D, type AssetMetadata } from '../shared/assets'
import CalibrationFields from './CalibrationFields'
import { architecturalMetadataSchema, architectureRoles, type Calibration } from '../shared/architecture'
import AssetPreview3D from './AssetPreview3D'
import './asset-library.css'
import { blankDungeon, type ProceduralProp } from '../shared/dungeon'
import {filterBuiltinObjects} from '../shared/objectPalette'
import { Canvas } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { DungeonScene } from './DungeonScene'
// The initial name may be empty in the form; schema validation happens on submit.
const initialMetadata: AssetMetadata = { name: '', description: '', category: 'miniature', tags: [], source: 'Meshy AI', presentation: { defaultScale: 1, defaultRotation: 0, verticalOffset: 0, displayName: '' } }
function MetadataFields({ value, onChange, prefix }: { value: AssetMetadata; onChange: (v: AssetMetadata) => void; prefix: string }) {
  const patch = (p: Partial<AssetMetadata>) => onChange({ ...value, ...p })
  return <>
    <label>{prefix} name<input required maxLength={150} value={value.name} onChange={e => patch({ name: e.target.value })} /></label>
    <label>{prefix} category<select aria-label={`${prefix} category`} value={value.category} onChange={e => patch({ category: e.target.value as AssetMetadata['category'] })}>{assetCategories.map(c => <option key={c}>{c}</option>)}</select></label>
    <label>{prefix} description<textarea maxLength={2000} value={value.description} onChange={e => patch({ description: e.target.value })} /></label>
    <label>{prefix} tags (comma separated)<input maxLength={1000} value={value.tags.join(',')} onChange={e => patch({ tags: e.target.value.split(',').map(s => s.trim()) })} /></label>
    <label>{prefix} source<input maxLength={150} value={value.source} onChange={e => patch({ source: e.target.value })} /></label>
  </>
}
const validated = (value: AssetMetadata) => assetMetadataSchema.parse({ ...value, tags: value.tags.filter(Boolean) })
function AssetDetails({ asset, api, onChange, onDelete }: { asset: Asset3D; api: Api; onChange: (asset: Asset3D) => void; onDelete: () => void }) {
  const [metadata, setMetadata] = useState<AssetMetadata>(() => ({ name: asset.name, description: asset.description, category: asset.category, tags: asset.tags, source: asset.source, presentation: asset.presentation })), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true); setMessage('')
    try { const value = validated(metadata); onChange(await api(`/assets/${asset.id}/update`, { revision: asset.revision, metadata: value }) as Asset3D); setMessage('Asset metadata saved.') }
    catch (e) { setMessage((e as Error).message) } finally { setBusy(false) }
  }
  return <section className="asset-details" aria-label="Asset details"><h2>{asset.name}</h2>
    <dl><dt>Original file</dt><dd>{asset.fileName} · {(asset.fileSize / 1024 / 1024).toFixed(2)} MiB · GLB 2</dd><dt>Status</dt><dd>{asset.uploadStatus} · validation {asset.validationStatus}</dd><dt>Geometry</dt><dd>{asset.metrics.vertices.toLocaleString()} vertices · {asset.metrics.triangles.toLocaleString()} triangles</dd><dt>Uploaded</dt><dd>{new Date(asset.createdAt).toLocaleString()}</dd></dl>
    {asset.uploadStatus === 'ready' && <AssetPreview3D architecturalPreview key={`${asset.id}:${asset.revision}`} asset={{...asset,presentation:metadata.presentation}} />}
    <form onSubmit={event => void save(event)}><fieldset disabled={busy || asset.uploadStatus !== 'ready'}><legend>Asset metadata</legend><MetadataFields prefix="Edit asset" value={metadata} onChange={setMetadata} />
      <h3>Presentation defaults</h3><p>Uniform scale, Y rotation in degrees; offset above the grounded model. The original GLB stays unchanged.</p>
      {(['defaultScale', 'defaultRotation', 'verticalOffset'] as const).map(key => <label key={key}>{({ defaultScale: 'Default scale', defaultRotation: 'Default rotation (degrees)', verticalOffset: 'Vertical offset' })[key]}<input type="number" step="any" min={key === 'defaultScale' ? .0001 : key === 'defaultRotation' ? 0 : -10000} max={key === 'defaultRotation' ? 360 : 10000} required value={metadata.presentation[key]} onChange={e => setMetadata({ ...metadata, presentation: { ...metadata.presentation, [key]: Number(e.target.value) } })} /></label>)}
      <label>Display name<input maxLength={150} value={metadata.presentation.displayName} onChange={e => setMetadata({ ...metadata, presentation: { ...metadata.presentation, displayName: e.target.value } })} /></label>
      <label>Architectural role<select aria-label="Architectural role" value={metadata.presentation.architecture?.role ?? 'scenery'} onChange={e=>setMetadata({...metadata,presentation:{...metadata.presentation,architecture:architecturalMetadataSchema.parse({...metadata.presentation.architecture,role:e.target.value})}})}>{architectureRoles.map(role=><option key={role}>{role}</option>)}</select></label>
      {metadata.presentation.architecture && <CalibrationFields value={metadata.presentation.architecture} onChange={value=>setMetadata({...metadata,presentation:{...metadata.presentation,architecture:{...value,role:metadata.presentation.architecture!.role}}})}/>}
      <button>Save asset metadata</button></fieldset></form>
    <button disabled={busy} onClick={() => { if (!confirm('Delete this asset and its GLB file? This cannot be undone.')) return; setBusy(true); void api(`/assets/${asset.id}/delete`, { revision: asset.revision }).then(onDelete).catch(e => { setMessage(e.message); setBusy(false) }) }}>Delete asset</button>
    {message && <p role="status">{message}</p>}
  </section>
}
type Api = (path: string, body?: unknown) => Promise<unknown>
export default function AssetLibrary({ api, csrf, onClose, onPick, onPickBuiltin, pickerTitle, architecturalRole }: { api: Api; csrf: string; onClose: () => void; onPick?: (asset: Asset3D) => void; onPickBuiltin?: (type: ProceduralProp['type']) => void; pickerTitle?: string; architecturalRole?: 'wall'|'door' }) {
  const [calibration,setCalibration]=useState<Calibration | null>(null)
  const [source, setSource] = useState('all'), [builtin, setBuiltin] = useState<ProceduralProp['type'] | null>(null)
  const [assets, setAssets] = useState<Asset3D[]>([]), [selected, setSelected] = useState<Asset3D | null>(null)
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [category, setCategory] = useState(''), [offset, setOffset] = useState(0), [total, setTotal] = useState(0)
  const [maxBytes, setMaxBytes] = useState(25 * 1024 * 1024), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [message, setMessage] = useState('')
  const [metadata, setMetadata] = useState<AssetMetadata>(initialMetadata), [file, setFile] = useState<File | null>(null), [progress, setProgress] = useState<number | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null), fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let disposed = false
    void api(`/assets?q=${encodeURIComponent(search)}${category ? `&category=${category}` : ''}${architecturalRole ? `&role=${architecturalRole}` : ''}&offset=${offset}`).then(value => {
      const data = value as { assets: Asset3D[]; total: number; maxBytes: number }
      if (!disposed) { setAssets(data.assets); setTotal(data.total); setMaxBytes(data.maxBytes); setLoading(false) }
    }).catch(e => { if (!disposed) { setMessage(e.message); setLoading(false) } })
    return () => { disposed = true }
  }, [api, search, category, offset, refresh, architecturalRole])
  useEffect(() => () => { xhrRef.current?.abort() }, [])
  const upload = (event: FormEvent) => {
    event.preventDefault(); setMessage('')
    try {
      if (!file || !file.name.toLowerCase().endsWith('.glb')) throw new Error('Choose a .glb file.')
      if (!file.size || file.size > maxBytes) throw new Error(`Choose a non-empty GLB up to ${(maxBytes / 1024 / 1024).toFixed(1)} MiB.`)
      const data = new FormData(); data.set('metadata', JSON.stringify(validated(metadata))); data.set('file', file)
      const xhr = new XMLHttpRequest(); xhrRef.current = xhr; xhr.open('POST', '/api/assets'); xhr.setRequestHeader('X-CSRF-Token', csrf); xhr.timeout = 120000; setProgress(0)
      xhr.upload.onprogress = e => { if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100)) }
      const failed = (text: string) => { setMessage(text); setProgress(null); xhrRef.current = null }
      xhr.onerror = () => failed('Upload failed. Check your connection and retry.'); xhr.ontimeout = () => failed('Upload timed out. Reduce model size and retry.'); xhr.onabort = () => failed('Upload cancelled.')
      xhr.onload = () => {
        let value
        try { value = JSON.parse(xhr.responseText) } catch { failed('Upload failed. Check the backend and retry.'); return }
        if (xhr.status !== 201) { failed(value.error?.message ?? 'Upload failed.'); return }
        setSelected(value); setRefresh(n => n + 1); setProgress(null); setMessage('Model validated and uploaded.'); setFile(null); if (fileRef.current) fileRef.current.value = ''; xhrRef.current = null
      }
      xhr.send(data)
    } catch (error) { setMessage((error as Error).message) }
  }
  return <main className="asset-library"><header><div><span className="eyebrow">DM ACCOUNT LIBRARY</span><h1>{onPick ? pickerTitle ?? 'Choose a 3D miniature' : '3D Asset Library'}</h1><p>Reusable models with independent appearance settings for each placement.</p></div><button onClick={onClose}>{onPick ? 'Cancel selection' : 'Return to encounter'}</button></header>
    {!onPick && <form className="asset-upload" onSubmit={upload}><h2>Upload GLB</h2><fieldset disabled={progress !== null}><legend>New asset</legend><label>GLB file (up to {(maxBytes / 1024 / 1024).toFixed(1)} MiB)<input ref={fileRef} type="file" accept=".glb,model/gltf-binary" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><MetadataFields prefix="Upload asset" value={metadata} onChange={setMetadata} /><button>Upload model</button></fieldset>{progress !== null && <div role="status"><progress max={100} value={progress} />{progress < 100 ? `Uploading ${progress}%` : 'Validating model…'}<button type="button" onClick={() => xhrRef.current?.abort()}>Cancel upload</button></div>}</form>}
    {message && <p role="status">{message}</p>}
    <form className="asset-search" onSubmit={e => { e.preventDefault(); setSearch(q); setOffset(0) }}>{onPickBuiltin && <label>Object source<select aria-label="Object source" value={source} onChange={e => setSource(e.target.value)}><option value="all">All objects</option><option value="builtin">Built-in objects</option><option value="uploaded">Uploaded assets</option></select></label>}<label>Search assets<input value={q} onChange={e => setQ(e.target.value)} maxLength={150} /></label><label>Filter category<select aria-label="Filter category" value={category} onChange={e => { setCategory(e.target.value); setOffset(0) }}><option value="">All categories</option>{assetCategories.map(c => <option key={c}>{c}</option>)}</select></label><button>Search library</button><button type="button" onClick={() => { setRefresh(n => n + 1); if (selected) void api(`/assets/${selected.id}`).then(a => setSelected(a as Asset3D)).catch(e => setMessage(e.message)) }}>Refresh library</button></form>
    {onPickBuiltin && source !== 'uploaded' && <section aria-label="Built-in objects"><h2>Built-in objects</h2><div className="asset-grid">{filterBuiltinObjects(search,category).map(({type:t}) => <button key={t} aria-pressed={builtin === t} onClick={() => { setBuiltin(t); setSelected(null) }}>{t}</button>)}</div>{builtin && <section aria-label="Built-in object preview"><h3>{builtin}</h3><div className="asset-preview-viewport"><Canvas camera={{position:[2,2,2],fov:40}}><ambientLight intensity={2}/><directionalLight position={[3,5,2]}/><DungeonScene map={{...blankDungeon('preview','Preview',4,4),props:[{id:'preview',type:builtin,position:{x:1,z:1},rotation:0}]}}/><OrbitControls target={[-.5,.5,-.5]}/></Canvas></div><button onClick={() => onPickBuiltin(builtin)}>Use built-in object</button></section>}</section>}
    <div className="asset-workspace" hidden={Boolean(onPickBuiltin && source === 'builtin')}><section aria-label="Asset grid">{loading ? <p role="status">Loading assets…</p> : !assets.length ? <p>{search || category ? 'No matching assets.' : 'No assets yet. Upload your first GLB model.'}</p> : <div className="asset-grid">{assets.map(asset => <button className="asset-card" key={asset.id} aria-pressed={selected?.id === asset.id} onClick={() => { setSelected(asset); setBuiltin(null); setCalibration(architecturalMetadataSchema.parse(asset.presentation.architecture ?? {})) }}><span className="asset-placeholder" aria-hidden="true">◇</span><strong>{asset.name}</strong><span>{asset.category} · {(asset.fileSize / 1024 / 1024).toFixed(2)} MiB</span><span>{asset.source || 'Source unspecified'}</span><span>{new Date(asset.createdAt).toLocaleDateString()} · {asset.uploadStatus}</span></button>)}</div>}<p>{total} assets</p><button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 50))}>Previous assets</button><button disabled={offset + 50 >= total} onClick={() => setOffset(n => n + 50)}>Next assets</button></section>
      {selected && onPick && <section className="asset-details" aria-label="Miniature asset preview"><h2>{selected.name}</h2><AssetPreview3D architecturalPreview={Boolean(architecturalRole || onPickBuiltin)} asset={architecturalRole && calibration ? {...selected,presentation:{...selected.presentation,architecture:{...calibration,role:architecturalRole}}} : selected} normalize />{architecturalRole && calibration && <CalibrationFields value={calibration} onChange={setCalibration} prefix="Placement"/>}<button disabled={selected.uploadStatus !== 'ready'} onClick={() => onPick(architecturalRole && calibration ? {...selected,presentation:{...selected.presentation,architecture:{...calibration,role:architecturalRole}}} : selected)}>Use this model</button></section>}
      {selected && !onPick && <AssetDetails key={`${selected.id}:${selected.revision}`} asset={selected} api={api} onChange={asset => { setSelected(asset); setRefresh(n => n + 1); setMessage('Asset metadata saved.') }} onDelete={() => { setSelected(null); setRefresh(n => n + 1); setMessage('Asset deleted.') }} />}</div>
  </main>
}
