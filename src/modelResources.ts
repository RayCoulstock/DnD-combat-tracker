import { Box3, Group, LoadingManager, Mesh, MeshStandardMaterial, SkinnedMesh, Texture, Vector3, type Material, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { facingRotation, type Calibration } from '../shared/architecture.ts'
import { AssetResourceCache } from './assetResourceCache'
export function disposeModel(root: Object3D) {
  const geometries = new Set<Mesh['geometry']>(), materials = new Set<Material>(), textures = new Set<Texture>()
  root.traverse(object => {
    const mesh = object as Mesh
    if (mesh instanceof SkinnedMesh) mesh.skeleton.dispose()
    if (mesh.geometry) geometries.add(mesh.geometry)
    for (const material of mesh.material ? Array.isArray(mesh.material) ? mesh.material : [mesh.material] : []) { materials.add(material); for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value) }
  })
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose())
  textures.forEach(t => { (t.image as { close?: () => void } | undefined)?.close?.(); t.dispose() })
}
export async function loadGlb(url: string, signal: AbortSignal) {
  const response = await fetch(url, { credentials: 'same-origin', signal })
  if (!response.ok) throw new Error(`Model request failed (HTTP ${response.status}). ${response.status === 401 || response.status === 403 ? 'Sign in or rejoin the encounter, then retry.' : 'Check asset access and storage, then retry.'}`)
  const buffer = await response.arrayBuffer()
  signal.throwIfAborted()
  const manager = new LoadingManager()
  manager.setURLModifier(resource => { if (!resource.startsWith('blob:')) throw new Error('External model resources are disabled.'); return resource })
  let gltf
  try { gltf = await new GLTFLoader(manager).parseAsync(buffer, '') }
  catch (error) { throw Object.assign(new Error(`Unable to parse GLB: ${error instanceof Error ? error.message : String(error)}`), { cause: error }) }
  const resources = new Group(); gltf.scenes.forEach(scene => resources.add(scene))
  gltf.scenes.forEach(scene => scene.traverse(object => { if (object instanceof Mesh && !object.material) object.material = new MeshStandardMaterial({ color: '#aaa99f' }) }))
  const geometries = new Set<Mesh['geometry']>(), textures = new Set<Texture>()
  resources.traverse(object => { if (object instanceof Mesh) {
    geometries.add(object.geometry)
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) for (const value of Object.values(material)) if (value instanceof Texture) textures.add(value)
  } })
  let bytes = buffer.byteLength
  geometries.forEach(g => { Object.values(g.attributes).forEach(a => { bytes += a.array.byteLength }); bytes += g.index?.array.byteLength ?? 0 })
  textures.forEach(t => { const image = t.image as { width?: number; height?: number }; bytes += (image?.width ?? 0) * (image?.height ?? 0) * 6 })
  if (signal.aborted) { disposeModel(resources); signal.throwIfAborted() }
  return { value: gltf.scene, bytes, dispose: () => disposeModel(resources) }
}
export function normalization(root: Object3D) {
  root.updateMatrixWorld(true)
  const bounds = new Box3().setFromObject(root), dimensions = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3())
  if (bounds.isEmpty() || ![...bounds.min.toArray(), ...bounds.max.toArray(), ...dimensions.toArray()].every(Number.isFinite)) throw new Error('Model has invalid bounds.')
  const largest = Math.max(...dimensions.toArray())
  if (!(largest > 0)) throw new Error('Model has no usable dimensions.')
  // Relative threshold handles tiny/large exports without assuming a unit height.
  const extent = dimensions.y > largest * .000001 ? dimensions.y : largest
  const factor = 1 / extent
  if (!Number.isFinite(factor)) throw new Error('Model dimensions cannot be normalised safely.')
  return { factor, centreX: centre.x, centreZ: centre.z, minY: bounds.min.y }
}
export function cloneMiniature(source: Group) {
  const n = normalization(source), model = clone(source) as Group, centred = new Group(), root = new Group()
  centred.position.set(-n.centreX, -n.minY, -n.centreZ); centred.add(model); root.scale.setScalar(n.factor); root.add(centred)
  return root
}
export function disposeInstance(root: Object3D) { root.traverse(o => { if (o instanceof SkinnedMesh) o.skeleton.dispose() }) }
export const miniatureModels = new AssetResourceCache<Group>(loadGlb)

export function cloneArchitecture(source:Group,calibration:Calibration){
  const model=clone(source) as Group, corrected=new Group(),root=new Group()
  corrected.rotation.y=facingRotation(calibration);corrected.add(model);corrected.updateMatrixWorld(true)
  const bounds=new Box3().setFromObject(corrected),size=bounds.getSize(new Vector3()),centre=bounds.getCenter(new Vector3())
  if(bounds.isEmpty()||![...bounds.min.toArray(),...bounds.max.toArray()].every(Number.isFinite)||size.x<=0||size.y/size.x>50||size.z/size.x>50)throw new Error('Model cannot be fitted safely to one grid edge. Check facing and calibration.')
  const factor=calibration.scale/size.x
  corrected.scale.setScalar(factor)
  const alignment=calibration.alignment==='start'?(calibration.scale-1)/2:calibration.alignment==='end'?(1-calibration.scale)/2:0
  corrected.position.set(-centre.x*factor+alignment+calibration.horizontalOffset,-bounds.min.y*factor+calibration.verticalOffset,-centre.z*factor)
  root.add(corrected);root.updateMatrixWorld(true);return root
}
export function cloneModelInstance(source: Group, ghost = false, architecture?:Calibration) {
  const root = architecture ? cloneArchitecture(source,architecture) : cloneMiniature(source), owned: Material[] = []
  if (ghost) root.traverse(object => { if (object instanceof Mesh) {
    const copy = (material: Material) => { const m = material.clone(); m.transparent = true; m.opacity = .35; m.depthWrite = false; owned.push(m); return m }
    object.material = Array.isArray(object.material) ? object.material.map(copy) : copy(object.material)
  } })
  return { root, dispose: () => { disposeInstance(root); owned.forEach(m => m.dispose()) } }
}
