import { sceneGenerationSpecSchema, type SceneGenerationSpec, type SceneGenerationResult } from '../../shared/sceneGeneration'

// UI dependency ports, not wire contracts. Authority must resolve revisions and commit atomically.
export interface SceneProposalAuthority {
  preview: (spec: SceneGenerationSpec) => Promise<SceneGenerationResult>
  accept: (spec: SceneGenerationSpec, preview: SceneGenerationResult, variantName?: string) => Promise<void>
}
export class SceneProposalWorkflow {
  private epoch = 0
  private pendingAccept = false
  private value: { spec: SceneGenerationSpec; result: SceneGenerationResult } | null = null
  constructor(private readonly authority: SceneProposalAuthority) {}
  get preview() { return this.value ? structuredClone(this.value) : null }
  cancel() { if (this.pendingAccept) return; this.epoch++; this.value = null }
  async generate(input: unknown) {
    if (this.pendingAccept) throw new Error('Wait for acceptance to finish.')
    const epoch = ++this.epoch
    this.value = null
    const spec = sceneGenerationSpecSchema.parse(input)
    const result = await this.authority.preview(structuredClone(spec))
    if (epoch !== this.epoch) return null
    this.value = { spec, result: structuredClone(result) }
    return this.preview
  }
  async accept(variantName?: string) {
    if (!this.value || this.pendingAccept) throw new Error('Preview the proposal before accepting.')
    const snapshot = structuredClone(this.value)
    if (snapshot.spec.source.kind === 'variant' && (!variantName?.trim() || variantName.trim().length > 150)) throw new Error('Name the new variant (1–150 characters).')
    this.pendingAccept = true
    try {
      await this.authority.accept(snapshot.spec, snapshot.result, snapshot.spec.source.kind === 'variant' ? variantName!.trim() : undefined)
      this.value = null
      this.epoch++
    } finally { this.pendingAccept = false }
  }
}
