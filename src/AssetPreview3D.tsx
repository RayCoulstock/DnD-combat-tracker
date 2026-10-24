import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Component, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Box3, Group, Vector3 } from 'three'
import { loadGlb, cloneArchitecture, cloneMiniature, disposeInstance } from './modelResources'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Asset3D } from '../shared/assets'
class PreviewBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError() { return { error: true } }
  render() { return this.state.error ? <p role="alert">Unable to render this model. Try re-exporting it as a standard GLB.</p> : this.props.children }
}
function PreviewScene({ model, reset }: { model: Group; reset: number }) {
  const controls = useRef<OrbitControlsImpl>(null), { camera, size, invalidate } = useThree()
  useLayoutEffect(() => {
    const bounds = new Box3().setFromObject(model), centre = bounds.getCenter(new Vector3()), dimensions = bounds.getSize(new Vector3())
    const radius = Math.max(dimensions.length() / 2, .001)
    const fov = 40 * Math.PI / 180, aspect = size.width / Math.max(size.height, 1)
    const angle = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * aspect))
    const distance = radius / Math.sin(angle / 2) * 1.2
    camera.position.copy(centre).add(new Vector3(1, .65, 1).normalize().multiplyScalar(distance))
    camera.near = Math.max(distance / 10000, .00001); camera.far = Math.max(distance * 20, 100); camera.updateProjectionMatrix(); camera.lookAt(centre)
    if (controls.current) { controls.current.target.copy(centre); controls.current.minDistance = radius * .2; controls.current.maxDistance = distance * 10; controls.current.update(); controls.current.saveState() }
    invalidate()
  }, [model, reset, camera, size.width, size.height, invalidate])
  const bounds = new Box3().setFromObject(model), span = Math.max(bounds.getSize(new Vector3()).length(), 1)
  return <>
    <color attach="background" args={['#303635']} /><ambientLight intensity={1.7} /><directionalLight position={[span, span * 2, span]} intensity={2.5} />
    <primitive object={model} dispose={null} />
    <gridHelper args={[span * 2, 20, '#78817d', '#454f49']} position={[0, -.001, 0]} />
    <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={.1} />
  </>
}
export default function AssetPreview3D({ asset, normalize = false, architecturalPreview = false }: { asset: Asset3D; normalize?: boolean; architecturalPreview?: boolean }) {
  const [loaded, setLoaded] = useState<{ id: string; source: Group } | null>(null), [error, setError] = useState<{ id: string; message: string } | null>(null), [reset, setReset] = useState(0)
  const p = asset.presentation, architecture=architecturalPreview && p.architecture && ['wall','door'].includes(p.architecture.role) ? p.architecture : undefined
  useEffect(() => {
    const controller = new AbortController(); let disposed = false, release: (() => void) | undefined
    void loadGlb(`/api/assets/${asset.id}/file`, controller.signal).then(resource => {
      release = resource.dispose
      if (disposed) { release(); return }
      setLoaded({ id: asset.id, source: resource.value })
    }).catch(e => { if (!disposed) setError({ id: asset.id, message: e.message || 'Unable to load model.' }) })
    return () => { disposed = true; controller.abort(); release?.() }
  }, [asset.id])
  const prepared = useMemo(() => {
    if (loaded?.id !== asset.id) return null
    try {
      const root = new Group(); root.add(architecture ? cloneArchitecture(loaded.source,architecture) : normalize ? cloneMiniature(loaded.source) : clone(loaded.source))
      root.scale.setScalar(architecture ? 1 : p.defaultScale); root.rotation.y = architecture ? 0 : p.defaultRotation * Math.PI / 180; root.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(root)
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) throw new Error('Model has no usable preview bounds.')
      const centre = bounds.getCenter(new Vector3()); if(!architecture)root.position.set(-centre.x, -bounds.min.y + p.verticalOffset, -centre.z); root.updateMatrixWorld(true)
      return { model: root }
    } catch { return { error: 'Model has no usable preview bounds.' } }
  }, [loaded, asset.id, normalize, p.defaultScale, p.defaultRotation, p.verticalOffset, architecture])
  useEffect(() => () => { if (prepared?.model) disposeInstance(prepared.model) }, [prepared])
  if (error?.id === asset.id || prepared?.error) return <p role="alert">Preview failed: {error?.id === asset.id ? error.message : prepared?.error}</p>
  if (!prepared?.model) return <p role="status">Loading model preview…</p>
  return <section className="asset-preview" aria-label="3D asset preview"><p>Drag to orbit · wheel to zoom · right-drag to pan</p><button onClick={() => setReset(n => n + 1)}>Reset preview camera</button><PreviewBoundary><div className="asset-preview-viewport"><Canvas frameloop="demand" camera={{ fov: 40 }}><PreviewScene model={prepared.model} reset={reset} /></Canvas></div></PreviewBoundary></section>
}
