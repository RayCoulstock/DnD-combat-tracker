import test from 'node:test'
import assert from 'node:assert/strict'
import { Bone, Box3, BoxGeometry, Float32BufferAttribute, Group, Mesh, MeshStandardMaterial, Skeleton, SkinnedMesh, Uint16BufferAttribute, Vector3 } from 'three'
import { cloneMiniature, disposeInstance, cloneModelInstance } from '../src/modelResources.ts'
import { AssetResourceCache } from '../src/assetResourceCache.ts'
test('normalisation grounds/centres tiny, large, flat and multi-mesh models with independent clones', () => {
  for (const size of [1e-12, 2, 1e12]) {
    const source = new Group(); source.add(new Mesh(new BoxGeometry(size, size * 3, size * 2), new MeshStandardMaterial())); source.position.set(size*8, -size*5, size*4); const second = new Mesh(new BoxGeometry(size, size, size)); second.position.set(size*2,size,0); source.add(second)
    const a = cloneMiniature(source), b = cloneMiniature(source)
    const bounds = new Box3().setFromObject(a), dims = bounds.getSize(new Vector3()), centre = bounds.getCenter(new Vector3())
    assert.ok(Math.abs(bounds.min.y) < 1e-6); assert.ok(Math.abs(dims.y - 1) < 1e-6); assert.ok(Math.abs(centre.x) < 1e-6); assert.ok(Math.abs(centre.z) < 1e-6)
    a.rotation.y = 1; a.scale.setScalar(2); assert.equal(b.rotation.y, 0); assert.notEqual(b.scale.x, a.scale.x)
  }
  const flat = new Group(); flat.add(new Mesh(new BoxGeometry(2, 0, 4)))
  assert.ok(new Box3().setFromObject(cloneMiniature(flat)).getSize(new Vector3()).z <= 1.001)
  assert.throws(() => cloneMiniature(new Group()), /bounds/)
})
test('cache shares fetch/parse, bounds distinct models and retains resources until last release', async () => {
  let loads = 0, disposed = 0
  const cache = new AssetResourceCache(async key => { loads++; return { value: key, bytes: 8, dispose() { disposed++ } } }, 1, 10, 5)
  const first = cache.acquire('same'), second = cache.acquire('same')
  assert.equal(await first.promise, await second.promise); assert.equal(loads, 1)
  first.release(); await new Promise(r => setTimeout(r, 10)); assert.equal(disposed, 0)
  await assert.rejects(cache.acquire('other').promise, /budget/)
  second.release(); await new Promise(r => setTimeout(r, 10)); assert.equal(disposed, 1)
  const next = cache.acquire('other'); assert.equal(await next.promise, 'other'); next.release()
  const huge = new AssetResourceCache(async () => ({ value: 1, bytes: 20, dispose() { disposed++ } }), 2, 10, 1)
  const failed = huge.acquire('large'); await assert.rejects(failed.promise, /memory budget/); failed.release()
})

test('skinned instances have independent bones and releasing one never disposes shared geometry', () => {
  const geometry = new BoxGeometry(1,2,1), count = geometry.attributes.position.count
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(new Uint16Array(count*4),4))
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(Array.from({length:count*4},(_,i)=>i%4===0?1:0),4))
  const mesh = new SkinnedMesh(geometry,new MeshStandardMaterial()), bone = new Bone()
  mesh.add(bone); mesh.bind(new Skeleton([bone])); const source = new Group(); source.add(mesh)
  const first = cloneMiniature(source), second = cloneMiniature(source)
  const skins: SkinnedMesh[] = []; for(const root of[first,second]) root.traverse(o=>{if(o instanceof SkinnedMesh)skins.push(o)})
  assert.notEqual(skins[0].skeleton, skins[1].skeleton)
  skins[0].skeleton.bones[0].position.x=3
  assert.equal(skins[1].skeleton.bones[0].position.x,0);assert.equal(bone.position.x,0)
  let disposed=0;geometry.addEventListener('dispose',()=>disposed++)
  disposeInstance(first);assert.equal(disposed,0);assert.equal(skins[1].geometry,geometry)
  disposeInstance(second);geometry.dispose()
})

test('translucent placement ghosts never mutate or dispose shared model materials', () => {
  const material=new MeshStandardMaterial(),geometry=new BoxGeometry(1,2,1),source=new Group();source.add(new Mesh(geometry,material))
  const preview=cloneModelInstance(source,true),placed=cloneModelInstance(source)
  let ghost:Mesh|undefined,normal:Mesh|undefined;preview.root.traverse(o=>{if(o instanceof Mesh)ghost=o});placed.root.traverse(o=>{if(o instanceof Mesh)normal=o})
  assert.equal((ghost!.material as MeshStandardMaterial).opacity,.35);assert.equal((normal!.material as MeshStandardMaterial).opacity,1)
  assert.notEqual(ghost!.material,material);assert.equal(normal!.material,material);assert.equal(ghost!.geometry,geometry)
  let disposed=0;material.addEventListener('dispose',()=>disposed++);preview.dispose();assert.equal(disposed,0);placed.dispose();geometry.dispose();material.dispose()
})

test('architectural normalization fits corrected width, grounding and endpoint alignment without modifying shared resources', async () => {
  const {cloneArchitecture}=await import('../src/modelResources.ts'),{calibrationSchema}=await import('../shared/architecture.ts')
  for(const size of[1e-9,1,1e9]){
    const source=new Group(),mesh=new Mesh(new BoxGeometry(size*4,size*6,size*.4));mesh.position.set(20*size,-3*size,8*size);source.add(mesh)
    const model=cloneArchitecture(source,calibrationSchema.parse({})),bounds=new Box3().setFromObject(model),dims=bounds.getSize(new Vector3())
    assert.ok(Math.abs(dims.x-1)<1e-6);assert.ok(Math.abs(bounds.min.y)<1e-6);assert.ok(Math.abs(bounds.getCenter(new Vector3()).x)<1e-6)
    const other=cloneArchitecture(source,calibrationSchema.parse({scale:2,alignment:'start',verticalOffset:.2,horizontalOffset:.1}))
    const b=new Box3().setFromObject(other);assert.ok(Math.abs(b.min.x+.4)<1e-6);assert.ok(Math.abs(b.min.y-.2)<1e-6)
    assert.equal(mesh.position.x,20*size);assert.notEqual(other,model)
  }
  const source=new Group();source.add(new Mesh(new BoxGeometry(.2,2,4)))
  const turned=new Box3().setFromObject(cloneArchitecture(source,calibrationSchema.parse({facing:'+X'}))).getSize(new Vector3())
  assert.ok(Math.abs(turned.x-1)<1e-6);assert.ok(Math.abs(turned.y-.5)<1e-6)
  assert.throws(()=>cloneArchitecture(new Group(),calibrationSchema.parse({})),/safely/)
})
