/** Inspect actual GLB meshes, fixed anchors, occlusion, reuse and camera framing. */
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import ts from 'typescript'
const root = new URL('../../', import.meta.url)
const read = p => readFileSync(new URL(p,root))
const cfg = JSON.parse(read('scripts/blender/monitoring.parameters.json'))
const report = JSON.parse(read('public/models/mine-monitoring.report.json'))
const baseline = JSON.parse(read('scripts/blender/monitoring.protected-baseline.json').toString().replace(/^\uFEFF/,''))
for (const item of baseline) assert.equal(createHash('sha256').update(read(item.path)).digest('hex').toUpperCase(),item.hash,item.path)
const compile = p => ts.transpileModule(read(p).toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const uri = code => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const threeUrl = new URL('node_modules/three/build/three.module.js',root).href
const { ASSETS, ROADS, SITE, isBuilding } = await import(uri(compile('src/features/mine-digital-twin/layout.ts')))
const environmentCode = compile('src/features/mine-digital-twin/siteEnvironment.ts')
  .replace("from 'three'",`from '${threeUrl}'`).replace("import { ASSETS, ROADS, SITE, isBuilding } from './layout';",`const ASSETS=${JSON.stringify(ASSETS)},ROADS=${JSON.stringify(ROADS)},SITE=${JSON.stringify(SITE)};const isBuilding=${isBuilding.toString()};`)
const { TREES, LAMPS } = await import(uri(environmentCode))
const interactionCode = compile('src/features/mine-digital-twin/monitoringScene.ts')
  .replace("from 'three'",`from '${threeUrl}'`)
  .replace("from 'three/addons/renderers/CSS2DRenderer.js'",`from '${new URL('node_modules/three/examples/jsm/renderers/CSS2DRenderer.js',root).href}'`)
  .replace("import { MONITORING_DEVICES } from './monitoringDevices';",`const MONITORING_DEVICES=${JSON.stringify(cfg.devices)};`)
const { createMonitoring } = await import(uri(interactionCode))
const { framePowerInspection } = await import(uri(compile('src/features/mine-digital-twin/powerInspection.ts').replace("from 'three'",`from '${threeUrl}'`)))
const loader = new GLTFLoader()
async function load(file, inspect = false) {
  const bytes=read('public/models/'+file)
  assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length)
  const n=bytes.readUInt32LE(12),json=JSON.parse(bytes.subarray(20,20+n)),binOffset=28+n
  if (inspect) {
    assert.ok(json.buffers.every(b=>!b.uri));assert.ok((json.images??[]).every(i=>i.bufferView!==undefined))
    let triangles=0
    for (const mesh of json.meshes) for (const p of mesh.primitives) {
      triangles += json.accessors[p.indices].count/3
      for (const semantic of ['POSITION','NORMAL','TEXCOORD_0']) {
        const a=json.accessors[p.attributes[semantic]],v=json.bufferViews[a.bufferView],dims={VEC2:2,VEC3:3}[a.type]
        assert.equal(a.componentType,5126)
        for(let i=0;i<a.count;i++) {
          let norm=0
          for(let j=0;j<dims;j++) {const f=bytes.readFloatLE(binOffset+(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??dims*4)+j*4);assert.ok(Number.isFinite(f));norm+=f*f}
          if(semantic==='NORMAL')assert.ok(Math.abs(norm-1)<.03)
        }
      }
    }
    const result=report.outputs.find(o=>o.file===file)
    assert.equal(triangles,result.triangles);assert.equal(bytes.length,result.bytes)
    assert.ok(triangles<cfg.maxTrianglesPerModel);assert.ok(bytes.length<cfg.maxBytesPerModel)
    assert.ok(json.materials.length<=7)
    assert.equal(json.nodes.filter(n=>n.extras?.schematic===true).length,1)
    for(const m of json.materials)for(const v of [m.pbrMetallicRoughness.metallicFactor??1,m.pbrMetallicRoughness.roughnessFactor??1])assert.ok(v>=0&&v<=1)
  }
  // Remove image references in memory only for Node geometry/raycast checks.
  delete json.images;delete json.textures;delete json.samplers
  for(const m of json.materials??[]) {
    delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture
    delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture
  }
  const text=Buffer.from(JSON.stringify(json)),padded=Buffer.alloc(Math.ceil(text.length/4)*4,0x20);text.copy(padded)
  const tail=bytes.subarray(20+n),modified=Buffer.alloc(20+padded.length+tail.length)
  modified.writeUInt32LE(0x46546c67);modified.writeUInt32LE(2,4);modified.writeUInt32LE(modified.length,8)
  modified.writeUInt32LE(padded.length,12);modified.writeUInt32LE(0x4e4f534a,16);padded.copy(modified,20);tail.copy(modified,20+padded.length)
  return (await loader.parseAsync(modified.buffer.slice(modified.byteOffset,modified.byteOffset+modified.length),'')).scene
}
const scene=new THREE.Group(),interaction=createMonitoring(scene,[]),results=[],cameraChecks=[]
const buildings=[]
const overlay={'transfer-01':'mine-transfer-station.glb','coal-silo-01':'mine-coal-silo-1.glb','coal-silo-02':'mine-coal-silo-2.glb','substation-01':'mine-substation.glb','distribution-01':'mine-distribution-shell.glb'}
for(const asset of ASSETS.filter(isBuilding)) {
  const path=overlay[asset.id]??asset.modelPath?.split('/').pop()
  let box
  if(path) {
    const model=await load(path),bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3())
    const scale=asset.modelScale??1
    model.scale.setScalar(scale)
    model.position.set(...asset.position)
    if(!asset.preserveModelOrigin&&!overlay[asset.id])model.position.add(new THREE.Vector3(-center.x*scale,-(asset.modelGroundY??bounds.min.y)*scale,-center.z*scale))
    model.updateMatrixWorld(true);box=new THREE.Box3().setFromObject(model,true)
  } else box=new THREE.Box3(new THREE.Vector3(asset.position[0]-asset.size[0]/2,0,asset.position[2]-asset.size[2]/2),new THREE.Vector3(asset.position[0]+asset.size[0]/2,asset.size[1],asset.position[2]+asset.size[2]/2))
  buildings.push({id:asset.id,box})
}
for(const file of ['mine-production-links.glb','mine-coal-conveyors.glb'])buildings.push({id:file,box:new THREE.Box3().setFromObject(await load(file),true)})
function rectGap(a,b) {return Math.hypot(Math.max(0,a.min.x-b.max.x,b.min.x-a.max.x),Math.max(0,a.min.z-b.max.z,b.min.z-a.max.z))}
assert.equal(new Set(cfg.devices.map(d=>d.id)).size,cfg.devices.length)
for(const device of cfg.devices) {
  assert.equal(device.monitoringData.source,'mock');assert.equal(device.schematic,true);assert.equal(device.status,'simulated-online')
  const previous=ASSETS.find(a=>a.id===device.id)
  assert.deepEqual([device.position[0],device.position[2]],[previous.position[0],previous.position[2]])
  const group=new THREE.Group();group.add(await load(device.modelPath.split('/').pop(),true));group.position.set(...device.position)
  scene.add(group);interaction.register(device,group);scene.updateMatrixWorld(true)
  const box=new THREE.Box3().setFromObject(group,true)
  assert.ok(Math.abs(box.min.y-.014)<.00001,'Foundation must touch monitoring zone surface')
  let roadClearance=Infinity
  for(const road of ROADS) {
    const horizontal=road.from[1]===road.to[1]
    const roadBox=new THREE.Box3(new THREE.Vector3(Math.min(road.from[0],road.to[0])-(horizontal?0:road.width/2),0,Math.min(road.from[1],road.to[1])-(horizontal?road.width/2:0)),new THREE.Vector3(Math.max(road.from[0],road.to[0])+(horizontal?0:road.width/2),1,Math.max(road.from[1],road.to[1])+(horizontal?road.width/2:0)))
    roadClearance=Math.min(roadClearance,rectGap(box,roadBox))
  }
  assert.ok(roadClearance>1)
  const buildingClearance=Math.min(...buildings.map(b=>rectGap(box,b.box)));assert.ok(buildingClearance>1)
  const wallClearance=Math.min(box.min.x+73,73-box.max.x,box.min.z+56,56-box.max.z);assert.ok(wallClearance>1)
  for(const [x,z] of TREES)assert.ok(rectGap(box,new THREE.Box3(new THREE.Vector3(x-1.6,0,z-1.6),new THREE.Vector3(x+1.6,5,z+1.6)))>1)
  for(const [x,z] of LAMPS)assert.ok(rectGap(box,new THREE.Box3(new THREE.Vector3(x-.6,0,z-.6),new THREE.Vector3(x+.6,5,z+.6)))>1)
  const camera=new THREE.PerspectiveCamera(40,1,.5,1600),target=new THREE.Vector3(device.position[0],device.position[1]+1.65,device.position[2]+.25)
  camera.position.copy(target).add(new THREE.Vector3(-2,1,4));camera.lookAt(target);camera.updateMatrixWorld(true)
  assert.equal(interaction.pick(new THREE.Vector2(0,0),camera)?.id,device.id)
  const blocker=new THREE.Mesh(new THREE.BoxGeometry(1,1,.1),new THREE.MeshBasicMaterial())
  blocker.position.copy(target).lerp(camera.position,.5);blocker.lookAt(camera.position);scene.add(blocker);scene.updateMatrixWorld(true)
  assert.equal(interaction.pick(new THREE.Vector2(0,0),camera),null,'Occluded device must not be selectable')
  scene.remove(blocker);blocker.geometry.dispose();blocker.material.dispose()
  for(const [width,height] of [[604,871],[1440,900],[390,844]]) {
    camera.aspect=width/height;camera.updateProjectionMatrix()
    const frame=framePowerInspection(camera,group,'monitoring',width,height)
    camera.position.copy(frame.position);camera.lookAt(frame.target);camera.setViewOffset(width,height,frame.offsetX,frame.offsetY,width,height);camera.updateMatrixWorld(true)
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
      const p=new THREE.Vector3(x,y,z).project(camera),sx=(p.x+1)*width/2,sy=(1-p.y)*height/2
      assert.ok(sx>=20&&sx<=width-20&&sy>=(width<500?290:220)&&sy<=height-40,'Device clipped or covered by toolbar')
    }
    cameraChecks.push({id:device.id,width,height,distance:frame.position.distanceTo(frame.target)})
    camera.clearViewOffset()
  }
  results.push({id:device.id,roadClearanceMeters:roadClearance,buildingClearanceMeters:buildingClearance,wallClearanceMeters:wallClearance,worldBounds:{min:box.min.toArray(),max:box.max.toArray()}})
}
// Reuse one resource under another configured identity, without changing GLB data.
const copy=interaction.object(cfg.devices[0].id).clone(true),copyDevice={...cfg.devices[0],id:'verification-copy'}
copy.position.x=-53;scene.add(copy);interaction.register(copyDevice,copy);scene.updateMatrixWorld(true)
assert.equal(interaction.select(copyDevice.id)?.id,copyDevice.id)
interaction.dispose()
const verification={result:'PASS',protectedFilesUnchanged:baseline.length,outputs:report.outputs,devices:results,cameraChecks,
  checks:{uniqueIds:true,actualMeshRaycasts:2,occlusionChecks:2,modelReuse:true,foundationContact:true,layoutUnchanged:true},
  scope:'Demonstration footprints and geometry only; no validated lightning deployment/performance.'}
writeFileSync(new URL('public/models/mine-monitoring.verification.json',root),JSON.stringify(verification,null,2))
console.log(JSON.stringify(verification,null,2))
