import { Canvas, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import { Component, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Box3, Group, LoadingManager, Mesh, SkinnedMesh, Texture, Vector3, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib'
import type { Asset3D } from '../shared/assets'
function disposeModel(root: Object3D) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>()
  root.traverse(object => {
    const mesh = object as Mesh
    if (mesh instanceof SkinnedMesh) mesh.skeleton.dispose()
    if (mesh.geometry) geometries.add(mesh.geometry)
    for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
    }
  })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
  textures.forEach(texture => { const image = texture.image as { close?: () => void } | undefined; image?.close?.(); texture.dispose() })
}
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
export default function AssetPreview3D({ asset }: { asset: Asset3D }) {
  const [loaded, setLoaded] = useState<{ key: string; root: Group } | null>(null), [error, setError] = useState<{ key: string; message: string } | null>(null), [reset, setReset] = useState(0)
  const p = asset.presentation
  const loadKey = `${asset.id}:${p.defaultScale}:${p.defaultRotation}:${p.verticalOffset}`
  useEffect(() => {
    const controller = new AbortController(); let disposed = false, root: Group | undefined, resources: Group | undefined
    const load = async () => {
      const response = await fetch(`/api/assets/${asset.id}/file`, { credentials: 'same-origin', signal: controller.signal })
      if (!response.ok) throw new Error('Model is unavailable or you no longer have access. Refresh the library and retry.')
      const bytes = await response.arrayBuffer()
      const manager = new LoadingManager()
      manager.setURLModifier(url => { if (!url.startsWith('blob:')) throw new Error('External model resources are disabled.'); return url })
      const gltf = await new GLTFLoader(manager).parseAsync(bytes, '')
      resources = new Group(); gltf.scenes.forEach(scene => resources!.add(scene))
      root = new Group(); root.add(gltf.scene)
      root.scale.setScalar(p.defaultScale); root.rotation.y = p.defaultRotation * Math.PI / 180; root.updateMatrixWorld(true)
      const bounds = new Box3().setFromObject(root)
      if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)) { disposeModel(root); root = undefined; throw new Error('Model has no usable preview bounds.') }
      const centre = bounds.getCenter(new Vector3())
      root.position.set(-centre.x, -bounds.min.y + p.verticalOffset, -centre.z); root.updateMatrixWorld(true)
      // No loader cache: every preview owns and disposes its GPU resources.
      if (disposed) { disposeModel(root); if (resources) disposeModel(resources); return }
      setLoaded({ key: loadKey, root })
    }
    void load().catch(e => { if (!disposed) setError({ key: loadKey, message: e.message || 'Unable to load model.' }) })
    return () => { disposed = true; controller.abort(); if (root) disposeModel(root); if (resources) disposeModel(resources) }
  }, [asset.id, p.defaultScale, p.defaultRotation, p.verticalOffset, loadKey])
  if (error?.key === loadKey) return <p role="alert">Preview failed: {error.message}</p>
  if (loaded?.key !== loadKey) return <p role="status">Loading model preview…</p>
  return <section className="asset-preview" aria-label="3D asset preview"><p>Drag to orbit · wheel to zoom · right-drag to pan</p><button onClick={() => setReset(n => n + 1)}>Reset preview camera</button><PreviewBoundary><div className="asset-preview-viewport"><Canvas frameloop="demand" camera={{ fov: 40 }}><PreviewScene model={loaded.root} reset={reset} /></Canvas></div></PreviewBoundary></section>
}
