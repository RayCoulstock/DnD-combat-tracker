import { useEffect, useMemo, useState } from 'react'
import { dungeonLevels, type DungeonMap } from '../../shared/dungeon'
import { generationOptionsSchema, type GenerationOptions } from '../../shared/generator'
import { sceneGenerationSpecSchema, type SceneGenerationResult } from '../../shared/sceneGeneration'
import { seededProposal } from './presets'
import { SceneProposalWorkflow, type SceneProposalAuthority } from './workflow'

export default function SceneProposalPanel({ options, authority, onPreview, source }: {
  options: GenerationOptions
  authority?: SceneProposalAuthority
  onPreview: (result: SceneGenerationResult | null) => void
  source?: { id: string; revision: number; name: string; load: () => Promise<DungeonMap> }
}) {
  const workflow = useMemo(() => authority ? new SceneProposalWorkflow(authority) : null, [authority])
  useEffect(() => () => workflow?.cancel(), [workflow])
  const [accepting, setAccepting] = useState(false)
  const [draft, setDraft] = useState(''), [message, setMessage] = useState(''), [busy, setBusy] = useState(false)
  const [hasPreview, setHasPreview] = useState(false), [variantName, setVariantName] = useState('')
  const [variant, setVariant] = useState(false)
  const cancel = () => { workflow?.cancel(); setHasPreview(false); onPreview(null) }
  const update = (value: string) => { cancel(); setDraft(value); setMessage('') }
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action() } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) }
  }
  return <details className="scene-proposal-panel"><summary>Scene proposal</summary>
    <p>Review the structured options before previewing. Variants preserve the saved source and create a new template on acceptance.</p>
    <fieldset disabled={busy}>
      <button type="button" onClick={() => { try { update(JSON.stringify(seededProposal(generationOptionsSchema.parse(options)), null, 2)); setVariant(false) } catch (e) { setMessage((e as Error).message) } }}>Use current generation options</button>
      <button type="button" disabled={!source} onClick={() => void run(async () => {
        const document = await source!.load(), floors = dungeonLevels(document)
        const proposal = sceneGenerationSpecSchema.parse({ ...seededProposal({ ...options, width: document.width, height: document.height }),
          source: { kind: 'variant', templateId: source!.id, revision: source!.revision },
          floors: floors.map(f => ({ id: f.id, elevationFeet: f.elevationFeet })), transitions: document.transitions ?? [], fog: 'preserve' })
        update(JSON.stringify(proposal, null, 2)); setVariant(true); setVariantName(`${source!.name} variant`.slice(0, 150))
      })}>Use selected template as variant</button>
      <label>Structured scene proposal<textarea aria-label="Structured scene proposal" rows={12} value={draft} onChange={e => update(e.target.value)} /></label>
      <label>New variant name<input value={variantName} maxLength={150} onChange={e => setVariantName(e.target.value)} /></label>
      <button type="button" disabled={!draft} onClick={() => { try { const spec = sceneGenerationSpecSchema.parse(JSON.parse(draft)); setVariant(spec.source.kind === 'variant'); setMessage('Proposal is valid. Preview is required before acceptance.') } catch (e) { setMessage((e as Error).message) } }}>Validate proposal</button>
      <button type="button" disabled={!workflow || !draft} onClick={() => void run(async () => {
        // Clear the old canvas even if validation or realization fails.
        cancel()
        const input = sceneGenerationSpecSchema.parse(JSON.parse(draft))
        setVariant(input.source.kind === 'variant')
        const preview = await workflow!.generate(input)
        if (preview) { onPreview(preview.result); setHasPreview(true); setMessage(preview.result.diagnostics.map(d => `${d.code}${d.zoneId ? ` (${d.zoneId})` : ''}`).join('; ') || 'Preview ready. The encounter has not changed.') }
      })}>Preview scene</button>
      {hasPreview && <button type="button" disabled={!workflow || variant && !variantName.trim()} onClick={() => void run(async () => {
        setAccepting(true)
        try { await workflow!.accept(variantName); setHasPreview(false); onPreview(null); setMessage(variant ? 'Variant saved as a new template.' : 'Scene accepted.') } finally { setAccepting(false) }
      })}>{variant ? 'Accept and save new variant' : 'Accept scene'}</button>}
    </fieldset>
    {(hasPreview || busy) && <button type="button" disabled={accepting} onClick={cancel}>Cancel scene preview</button>}
    {!authority && <p>Scene preview and saving variants are not available yet. You can edit and validate proposals now, or use dungeon generation below.</p>}
    {message && <p role="status">{message}</p>}
  </details>
}
