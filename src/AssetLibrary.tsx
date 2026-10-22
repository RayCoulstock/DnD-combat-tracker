import { useEffect, useRef, useState, type FormEvent } from 'react'
import { assetCategories, assetMetadataSchema, type Asset3D, type AssetMetadata } from '../shared/assets'
import AssetPreview3D from './AssetPreview3D'
import './asset-library.css'
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
    {asset.uploadStatus === 'ready' && <AssetPreview3D key={`${asset.id}:${asset.revision}`} asset={asset} />}
    <form onSubmit={event => void save(event)}><fieldset disabled={busy || asset.uploadStatus !== 'ready'}><legend>Asset metadata</legend><MetadataFields prefix="Edit asset" value={metadata} onChange={setMetadata} />
      <h3>Presentation defaults</h3><p>Uniform scale, Y rotation in degrees; offset above the grounded model. The original GLB stays unchanged.</p>
      {(['defaultScale', 'defaultRotation', 'verticalOffset'] as const).map(key => <label key={key}>{({ defaultScale: 'Default scale', defaultRotation: 'Default rotation (degrees)', verticalOffset: 'Vertical offset' })[key]}<input type="number" step="any" min={key === 'defaultScale' ? .0001 : key === 'defaultRotation' ? 0 : -10000} max={key === 'defaultRotation' ? 360 : 10000} required value={metadata.presentation[key]} onChange={e => setMetadata({ ...metadata, presentation: { ...metadata.presentation, [key]: Number(e.target.value) } })} /></label>)}
      <label>Display name<input maxLength={150} value={metadata.presentation.displayName} onChange={e => setMetadata({ ...metadata, presentation: { ...metadata.presentation, displayName: e.target.value } })} /></label>
      <button>Save asset metadata</button></fieldset></form>
    <button disabled={busy} onClick={() => { if (!confirm('Delete this asset and its GLB file? This cannot be undone.')) return; setBusy(true); void api(`/assets/${asset.id}/delete`, { revision: asset.revision }).then(onDelete).catch(e => { setMessage(e.message); setBusy(false) }) }}>Delete asset</button>
    {message && <p role="status">{message}</p>}
  </section>
}
type Api = (path: string, body?: unknown) => Promise<unknown>
export default function AssetLibrary({ api, csrf, onClose }: { api: Api; csrf: string; onClose: () => void }) {
  const [assets, setAssets] = useState<Asset3D[]>([]), [selected, setSelected] = useState<Asset3D | null>(null)
  const [q, setQ] = useState(''), [search, setSearch] = useState(''), [category, setCategory] = useState(''), [offset, setOffset] = useState(0), [total, setTotal] = useState(0)
  const [maxBytes, setMaxBytes] = useState(25 * 1024 * 1024), [refresh, setRefresh] = useState(0), [loading, setLoading] = useState(true), [message, setMessage] = useState('')
  const [metadata, setMetadata] = useState<AssetMetadata>(initialMetadata), [file, setFile] = useState<File | null>(null), [progress, setProgress] = useState<number | null>(null)
  const xhrRef = useRef<XMLHttpRequest | null>(null), fileRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    let disposed = false
    void api(`/assets?q=${encodeURIComponent(search)}${category ? `&category=${category}` : ''}&offset=${offset}`).then(value => {
      const data = value as { assets: Asset3D[]; total: number; maxBytes: number }
      if (!disposed) { setAssets(data.assets); setTotal(data.total); setMaxBytes(data.maxBytes); setLoading(false) }
    }).catch(e => { if (!disposed) { setMessage(e.message); setLoading(false) } })
    return () => { disposed = true }
  }, [api, search, category, offset, refresh])
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
  return <main className="asset-library"><header><div><span className="eyebrow">DM ACCOUNT LIBRARY</span><h1>3D Asset Library</h1><p>Private reusable models. Assignment and placement will come in a later milestone.</p></div><button onClick={onClose}>Return to encounter</button></header>
    <form className="asset-upload" onSubmit={upload}><h2>Upload GLB</h2><fieldset disabled={progress !== null}><legend>New asset</legend><label>GLB file (up to {(maxBytes / 1024 / 1024).toFixed(1)} MiB)<input ref={fileRef} type="file" accept=".glb,model/gltf-binary" required onChange={e => setFile(e.target.files?.[0] ?? null)} /></label><MetadataFields prefix="Upload asset" value={metadata} onChange={setMetadata} /><button>Upload model</button></fieldset>{progress !== null && <div role="status"><progress max={100} value={progress} />{progress < 100 ? `Uploading ${progress}%` : 'Validating model…'}<button type="button" onClick={() => xhrRef.current?.abort()}>Cancel upload</button></div>}</form>
    {message && <p role="status">{message}</p>}
    <form className="asset-search" onSubmit={e => { e.preventDefault(); setSearch(q); setOffset(0) }}><label>Search assets<input value={q} onChange={e => setQ(e.target.value)} maxLength={150} /></label><label>Filter category<select aria-label="Filter category" value={category} onChange={e => { setCategory(e.target.value); setOffset(0) }}><option value="">All categories</option>{assetCategories.map(c => <option key={c}>{c}</option>)}</select></label><button>Search library</button><button type="button" onClick={() => { setRefresh(n => n + 1); if (selected) void api(`/assets/${selected.id}`).then(a => setSelected(a as Asset3D)).catch(e => setMessage(e.message)) }}>Refresh library</button></form>
    <div className="asset-workspace"><section aria-label="Asset grid">{loading ? <p role="status">Loading assets…</p> : !assets.length ? <p>{search || category ? 'No matching assets.' : 'No assets yet. Upload your first GLB model.'}</p> : <div className="asset-grid">{assets.map(asset => <button className="asset-card" key={asset.id} aria-pressed={selected?.id === asset.id} onClick={() => setSelected(asset)}><span className="asset-placeholder" aria-hidden="true">◇</span><strong>{asset.name}</strong><span>{asset.category} · {(asset.fileSize / 1024 / 1024).toFixed(2)} MiB</span><span>{asset.source || 'Source unspecified'}</span><span>{new Date(asset.createdAt).toLocaleDateString()} · {asset.uploadStatus}</span></button>)}</div>}<p>{total} assets</p><button disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 50))}>Previous assets</button><button disabled={offset + 50 >= total} onClick={() => setOffset(n => n + 50)}>Next assets</button></section>
      {selected && <AssetDetails key={`${selected.id}:${selected.revision}`} asset={selected} api={api} onChange={asset => { setSelected(asset); setRefresh(n => n + 1); setMessage('Asset metadata saved.') }} onDelete={() => { setSelected(null); setRefresh(n => n + 1); setMessage('Asset deleted.') }} />}</div>
  </main>
}
