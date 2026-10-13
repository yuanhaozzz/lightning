/** Actual exported hierarchy, assembly transforms, picking, visibility and dimensions. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import ts from 'typescript'
const root=new URL('../../',import.meta.url),read=p=>readFileSync(new URL(p,root))
const cfg=JSON.parse(read('scripts/blender/headframe.parameters.json'))
const candidate=process.argv[2]??'public/models/mine-headframe.glb'
const bytes=read(candidate)
assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length)
const n=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+n)),bin=bytes.subarray(28+n)
let triangles=0,vertices=0
for(const mesh of g.meshes)for(const p of mesh.primitives){
  assert.equal(p.mode??4,4);triangles+=g.accessors[p.indices].count/3
  vertices+=g.accessors[p.attributes.POSITION].count
  for(const semantic of ['POSITION','NORMAL','TEXCOORD_0']){
    const a=g.accessors[p.attributes[semantic]];assert.ok(a)
    assert.equal(a.componentType,5126)
    const v=g.bufferViews[a.bufferView],components=semantic==='TEXCOORD_0'?2:3,stride=v.byteStride??components*4
    for(let i=0;i<a.count;i++){
      let normalLength=0
      for(let j=0;j<components;j++){
        const value=bin.readFloatLE((v.byteOffset??0)+(a.byteOffset??0)+stride*i+j*4)
        assert.ok(Number.isFinite(value));normalLength+=value*value
      }
      if(semantic==='NORMAL')assert.ok(Math.abs(normalLength-1)<.03)
    }
  }
}
assert.ok(triangles<cfg.budget.maxTriangles);assert.ok(bytes.length<cfg.budget.maxBytes)
assert.ok(g.meshes.length<=cfg.budget.maxPrimitives);assert.equal(g.materials.length,9)
assert.ok(g.images.every(i=>i.bufferView!==undefined&&!i.uri))
const stripped=structuredClone(g)
for(const m of stripped.materials){
  delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture
  delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture
}
delete stripped.images;delete stripped.textures
const json=Buffer.from(JSON.stringify(stripped).padEnd(Math.ceil(Buffer.byteLength(JSON.stringify(stripped))/4)*4))
const parsed=Buffer.alloc(28+json.length+bin.length)
parsed.writeUInt32LE(0x46546c67,0);parsed.writeUInt32LE(2,4);parsed.writeUInt32LE(parsed.length,8)
parsed.writeUInt32LE(json.length,12);parsed.writeUInt32LE(0x4e4f534a,16);json.copy(parsed,20)
parsed.writeUInt32LE(bin.length,20+json.length);parsed.writeUInt32LE(0x004e4942,24+json.length);bin.copy(parsed,28+json.length)
const model=(await new GLTFLoader().parseAsync(parsed.buffer,'')).scene
const threeUrl=new URL('node_modules/three/build/three.module.js',root).href
const uri=code=>'data:text/javascript;base64,'+Buffer.from(code).toString('base64')
const compile=p=>ts.transpileModule(read('src/features/mine-digital-twin/'+p).toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replaceAll("from 'three'",'from '+JSON.stringify(threeUrl))
const {placeHeadframe,HEADFRAME_SPACE}=await import(uri(compile('headframeModel.ts')))
const {isBuilding,ASSETS}=await import(uri(compile('layout.ts')))
const {createSceneInteraction,DEFAULT_LAYERS,isSelectionClick}=await import(uri(compile('sceneInteraction.ts').replace("import { isBuilding } from './layout';",'const isBuilding='+isBuilding.toString()+';')))
assert.deepEqual(HEADFRAME_SPACE.sourceOffset,cfg.placement.sourceOffset)
const site=new THREE.Group(),assembly=new THREE.Group()
assembly.userData.asset=ASSETS.find(a=>a.id==='headframe-01');assembly.position.set(...cfg.placement.worldPosition)
site.add(assembly);assembly.add(model);placeHeadframe(model);site.updateMatrixWorld(true)
const bounds=new THREE.Box3().setFromObject(model,true)
const expectedMin=[-21.32,-.968,-11.36],expectedMax=[-6.68,24.24,-.64]
for(let i=0;i<3;i++){assert.ok(Math.abs(bounds.min.getComponent(i)-expectedMin[i])<.002,'Assembly minimum drift '+bounds.min.toArray());assert.ok(Math.abs(bounds.max.getComponent(i)-expectedMax[i])<.002,'Assembly maximum drift '+bounds.max.toArray())}
const interaction=createSceneInteraction(site,()=>false);interaction.initialize()
const parts=interaction.list.filter(e=>e.kind==='component')
assert.equal(parts.length,6)
assert.equal(new Set(parts.map(p=>p.id)).size,6)
const sheave=interaction.object('headframe-01/sheave')
const pivot=sheave.getWorldPosition(new THREE.Vector3())
assert.ok(pivot.distanceTo(new THREE.Vector3(-15.96,22.384,-6))<.00001,'Sheave pivot drift '+pivot.toArray())
const originalBounds=new THREE.Box3().setFromObject(sheave,true)
sheave.rotation.z=Math.PI/4;site.updateMatrixWorld(true)
assert.ok(sheave.getWorldPosition(new THREE.Vector3()).distanceTo(pivot)<.000001)
assert.ok(new THREE.Box3().setFromObject(sheave,true).getCenter(new THREE.Vector3()).distanceTo(pivot)<.03,'Rotation does not use axle center')
sheave.rotation.z=0;site.updateMatrixWorld(true)
const pcam=uri(compile('protectionInspection.ts')),powercam=uri(compile('powerInspection.ts'))
const {frameSceneEntity}=await import(uri(compile('sceneCamera.ts').replace("from './protectionInspection'",'from '+JSON.stringify(pcam)).replace("from './powerInspection'",'from '+JSON.stringify(powercam))))
const checks=[]
for(const part of parts){
  const object=interaction.object(part.id),box=new THREE.Box3().setFromObject(object,true)
  assert.ok(!box.isEmpty());assert.equal(part.parentEntityId,'headframe-01')
  for(const [w,h]of [[1440,900],[390,844]]){
    const camera=new THREE.PerspectiveCamera(40,w/h,.3,5000),frame=frameSceneEntity(camera,object,part,w,h)
    assert.ok(frame.position.toArray().every(Number.isFinite));assert.ok(frame.minDistance<=1.2)
  }
  assert.equal(interaction.select(part.id).id,part.id)
  const raycaster=new THREE.Raycaster(),targets=[]
  object.traverse(n=>{if(n instanceof THREE.Mesh){const pos=n.geometry.getAttribute('position'),i=n.geometry.index;for(let j=0;j<Math.min(i.count,1200);j+=15){const k=[i.getX(j),i.getX(j+1),i.getX(j+2)];targets.push(k.reduce((v,x)=>v.add(new THREE.Vector3().fromBufferAttribute(pos,x)),new THREE.Vector3()).multiplyScalar(1/3).applyMatrix4(n.matrixWorld))}}})
  let picked=false
  for(const point of targets){for(const direction of [new THREE.Vector3(-1,.5,1),new THREE.Vector3(1,.5,1),new THREE.Vector3(0,1,0)]){const camera=new THREE.PerspectiveCamera(40,1,.01,1000);camera.position.copy(point).addScaledVector(direction,4);camera.lookAt(point);camera.updateMatrixWorld(true);const hit=interaction.pick(new THREE.Vector2(0,0),camera);if(hit?.id===part.id){picked=true;break}}if(picked)break}
  assert.ok(picked,'No actual raycast for '+part.id)
  assert.ok(interaction.setEntityVisible(part.id,false));assert.equal(interaction.select(part.id),null)
  assert.ok(interaction.setEntityVisible(part.id,true));assert.equal(interaction.select(part.id).id,part.id)
  checks.push({id:part.id,picked,visibilityRoundtrip:true,cameraChecks:2})
}
interaction.setLayers({...DEFAULT_LAYERS,buildings:false});assert.equal(interaction.select(parts[0].id),null)
interaction.setLayers(DEFAULT_LAYERS);interaction.setEntityVisible(parts[0].id,false);interaction.restoreEntityVisibility();assert.ok(interaction.select(parts[0].id))
assert.equal(isSelectionClick({x:0,y:0,time:0,travel:8,pointerId:1},{x:0,y:0,time:10,pointerId:1,button:0}),false)
const generator=read('scripts/blender/generate_mine_headframe.py').toString().replaceAll('\r\n','\n')
const previous=read('scripts/blender/baselines/headframe-v1/generate_mine_headframe.py').toString().replaceAll('\r\n','\n')
assert.equal(generator.slice(0,generator.indexOf('def build(')),previous.slice(0,previous.indexOf('def build(')),'Shared primitive defaults changed')
let preserved=0
for(const {path,hash} of JSON.parse(read('scripts/blender/headframe.protected-baseline.json'))){
  assert.equal(createHash('sha256').update(read(path)).digest('hex').toUpperCase(),hash,path);preserved++
}
interaction.dispose()
const result={result:'PASS',candidate,bytes:bytes.length,triangles,vertices,meshes:g.meshes.length,materials:g.materials.length,semanticParts:checks,worldBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},worldSheavePivot:pivot.toArray(),rotationReady:true,sharedPrimitiveDefaultsUnchanged:true,unrelatedFilesPreserved:preserved,baselineGlbSha256:createHash('sha256').update(read('scripts/blender/baselines/headframe-v1/mine-headframe.glb')).digest('hex')}
writeFileSync(new URL('tmp/mine-headframe-stage1.verification.json',root),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
