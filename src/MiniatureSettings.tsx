import { useEffect, useState } from 'react'
import AssetLibrary from './AssetLibrary'
import AssetPreview3D from './AssetPreview3D'
import { appearanceFromAsset, inferBaseSize, miniatureSchema, miniatureSizes, type MiniatureAppearance } from '../shared/miniatures'
import type { Combatant, GameCommand } from '../shared/domain'
import type { Asset3D } from '../shared/assets'
export default function MiniatureSettings({ combatant, api, csrf, send, onClose, connected }: {
  combatant: Combatant; api: (path: string, body?: unknown) => Promise<unknown>; csrf: string; send: (command: GameCommand) => Promise<void>; onClose: () => void; connected: boolean
}) {
  const [draft, setDraft] = useState<MiniatureAppearance>(() => combatant.miniature ?? miniatureSchema.parse({ baseSize: inferBaseSize(combatant.role, combatant.size) }))
  const [asset, setAsset] = useState<Asset3D | null>(null), [picking, setPicking] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  useEffect(() => {
    let disposed = false
    if (draft.assetId) void api(`/assets/${draft.assetId}`).then(a => { if (!disposed) setAsset(a as Asset3D) }).catch(() => { if (!disposed) setMessage('Assigned model is unavailable. Choose another model or restore the placeholder.') })
    return () => { disposed = true }
  }, [api, draft.assetId])
  const save = async (appearance = draft) => {
    setBusy(true); setMessage('')
    try { await send({ type: 'combatant.miniature.update', combatantId: combatant.id, miniature: miniatureSchema.parse(appearance) }); onClose() }
    catch (e) { setMessage((e as Error).message) } finally { setBusy(false) }
  }
  return <div className="miniature-dialog" role="dialog" aria-modal="true" aria-label={`Miniature settings for ${combatant.name}`}>
    {picking ? <AssetLibrary api={api} csrf={csrf} onClose={() => setPicking(false)} onPick={chosen => { setAsset(chosen); setDraft(appearanceFromAsset(chosen, draft.baseSize)); setPicking(false); setMessage('') }} /> : <section className="miniature-settings">
      <h2>3D miniature — {combatant.name}</h2><p>Currently assigned: {asset?.id === draft.assetId ? asset.name : draft.assetId ?? 'Original placeholder'}</p>
      <button onClick={() => setPicking(true)} disabled={!connected || busy}>Browse Asset Library</button><button onClick={onClose}>Close miniature settings</button>
      {asset?.id === draft.assetId && <AssetPreview3D key={asset.id} normalize asset={{ ...asset, presentation: { ...asset.presentation, defaultScale: draft.scale, defaultRotation: draft.rotation, verticalOffset: draft.verticalOffset } }} />}
      <form onSubmit={e => { e.preventDefault(); void save() }}><fieldset disabled={!connected || busy}><legend>Combatant appearance</legend>
        <label>Miniature scale<input type="number" step="any" min={.0001} max={10000} required value={draft.scale} onChange={e => setDraft({ ...draft, scale: Number(e.target.value) })} /></label>
        <label>Miniature rotation (degrees)<input type="number" min={0} max={360} step="any" required value={draft.rotation} onChange={e => setDraft({ ...draft, rotation: Number(e.target.value) })} /></label>
        <label>Miniature vertical offset<input type="number" min={-10000} max={10000} step="any" required value={draft.verticalOffset} onChange={e => setDraft({ ...draft, verticalOffset: Number(e.target.value) })} /></label>
        <label>Miniature base size<select aria-label="Miniature base size" value={draft.baseSize} onChange={e => setDraft({ ...draft, baseSize: e.target.value as MiniatureAppearance['baseSize'] })}>{miniatureSizes.map(s => <option key={s}>{s}</option>)}</select></label>
        <label><input type="checkbox" checked={draft.showBase} onChange={e => setDraft({ ...draft, showBase: e.target.checked })} />Show miniature base</label>
        <p>Models are normalised to one square tall before scale is applied. Bases are visual; movement still uses one anchor cell.</p>
        <button>Save miniature</button><button type="button" onClick={() => void save({ ...draft, assetId: null })}>Restore placeholder token</button>
      </fieldset></form>{message && <p role="alert">{message}</p>}
    </section>}
  </div>
}
