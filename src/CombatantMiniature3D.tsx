import { Component, memo, useEffect, useState, type ReactNode } from 'react'
import { Html } from '@react-three/drei'
import type { Group } from 'three'
import { cloneMiniature, disposeInstance, miniatureModels } from './modelResources'
import { baseFootprint, type MiniatureAppearance } from '../shared/miniatures'
class ModelBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}
const LoadedMiniature = memo(function LoadedMiniature({ url, appearance, fallback }: { url: string; appearance: MiniatureAppearance; fallback: ReactNode }) {
  const [result, setResult] = useState<{ url: string; model?: Group; error?: string } | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let stopped = false, instance: Group | undefined
    const lease = miniatureModels.acquire(url)
    void lease.promise.then(source => { if (stopped) return; instance = cloneMiniature(source); setResult({ url, model: instance }) }).catch(error => { if (!stopped) setResult({ url, error: error.message }) })
    return () => { stopped = true; if (instance) disposeInstance(instance); lease.release() }
  }, [url, retry])
  const model = result?.url === url ? result.model : undefined, error = result?.url === url ? result.error : undefined
  return <>
    {model ? <group rotation={[0, appearance.rotation * Math.PI / 180, 0]} scale={appearance.scale} position={[0, appearance.verticalOffset + (appearance.showBase ? .12 : 0), 0]}><primitive object={model} dispose={null} /></group> : fallback}
    {model && <Html style={{ pointerEvents: 'none' }}><span className="visually-hidden" data-miniature-state="ready">3D miniature ready</span></Html>}
    {!model && <Html position={[0, .8, 0]} center><span className="token-label" role={error ? 'alert' : 'status'}><span>{error ? 'Model unavailable' : 'Loading miniature…'}</span>{error && <button onClick={e => { e.stopPropagation(); setResult(null); setRetry(n => n + 1) }}>Retry model</button>}</span></Html>}
  </>
})
export default function CombatantMiniature3D({ appearance, url, unavailable, fallback, color }: { appearance: MiniatureAppearance; url: string; unavailable: boolean; fallback: ReactNode; color: string }) {
  const footprint = baseFootprint(appearance.baseSize)
  return <>
    {appearance.showBase && <mesh position={[0, .06, 0]} receiveShadow><cylinderGeometry args={[footprint * .47, footprint * .49, .12, 32]} /><meshStandardMaterial color={color} roughness={.8} /></mesh>}
    {unavailable ? <>{fallback}<Html position={[0, .8, 0]} center style={{ pointerEvents: 'none' }}><span role="status" className="token-label">Model unavailable</span></Html></> : <ModelBoundary key={url} fallback={fallback}><LoadedMiniature url={url} appearance={appearance} fallback={fallback} /></ModelBoundary>}
  </>
}
