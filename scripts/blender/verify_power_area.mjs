/** Validate exported GLB geometry/IDs and actual Three.js semantic raycasting. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
import ts from 'typescript'
const root=new URL('../../',import.meta.url)
const read=p=>readFileSync(new URL(p,root))
const config=JSON.parse(read('scripts/blender/power_area.parameters.json'))
const report=JSON.parse(read('public/models/mine-power-area.report.json'))
const baseline=JSON.parse(read('scripts/blender/power_area.protected-baseline.json').toString().replace(/^\uFEFF/,''))
for(const item of baseline)assert.equal(createHash('sha256').update(read(item.path)).digest('hex').toUpperCase(),item.hash,item.path)
const compile=p=>ts.transpileModule(read(p).toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {ASSETS,ROADS}=await import(`data:text/javascript;base64,${Buffer.from(compile('src/features/mine-digital-twin/layout.ts')).toString('base64')}`)
for(const item of [config.substation,config.distribution]) {
 const previous=ASSETS.find(a=>a.id===item.id)
 assert.deepEqual(previous.position,item.position);assert.deepEqual(previous.size,item.size)
}
const module=compile('src/features/mine-digital-twin/powerInteraction.ts').replace("from 'three'",`from '${new URL('node_modules/three/build/three.module.js',root).href}'`)
const {createPowerInteraction}=await import(`data:text/javascript;base64,${Buffer.from(module).toString('base64')}`)
const scene=new THREE.Group(),room=new THREE.Group();room.position.set(...config.distribution.position);scene.add(room)
const interaction=createPowerInteraction(scene),models=[]
const semanticIds=[]
for(const output of report.outputs) {
 const bytes=read('public/models/'+output.file)
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2);assert.equal(bytes.readUInt32LE(8),bytes.length)
 const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length)),binOffset=28+length
 assert.equal(bytes.readUInt32LE(16),0x4e4f534a);assert.equal(bytes.readUInt32LE(24+length),0x004e4942)
 assert.ok(gltf.buffers.every(b=>!b.uri));assert.ok((gltf.images??[]).every(i=>i.bufferView!==undefined&&!i.uri))
 let triangles=0
 for(const mesh of gltf.meshes)for(const primitive of mesh.primitives) {
  triangles+=gltf.accessors[primitive.indices].count/3
  for(const semantic of ['POSITION','NORMAL','TEXCOORD_0']) {
   const accessor=gltf.accessors[primitive.attributes[semantic]],view=gltf.bufferViews[accessor.bufferView]
   assert.equal(accessor.componentType,5126)
   const n={VEC2:2,VEC3:3}[accessor.type],stride=view.byteStride??n*4
   for(let i=0;i<accessor.count;i++) {
    let norm=0
    for(let j=0;j<n;j++) {
     const v=bytes.readFloatLE(binOffset+(view.byteOffset??0)+(accessor.byteOffset??0)+i*stride+j*4)
     assert.ok(Number.isFinite(v));norm+=v*v
    }
    if(semantic==='NORMAL')assert.ok(Math.abs(norm-1)<.03)
   }
  }
 }
 const ids=gltf.nodes.filter(n=>n.extras?.id).map(n=>n.extras.id).sort()
 assert.deepEqual(ids,output.entityIds);semanticIds.push(...ids)
 assert.equal(triangles,output.triangles);assert.equal(output.bytes,bytes.length)
 assert.ok(gltf.materials.length<=11)
 for(const m of gltf.materials)for(const v of [m.pbrMetallicRoughness.metallicFactor??1,m.pbrMetallicRoughness.roughnessFactor??1])assert.ok(v>=0&&v<=1)
 models.push({...output,materials:gltf.materials.length,embeddedImages:gltf.images?.length??0})
 // Keep actual geometry/transforms/extras, remove image references only for a
 // headless Node raycast. Browser separately verifies the original PBR images.
 delete gltf.images;delete gltf.textures;delete gltf.samplers
 for(const m of gltf.materials) {
  delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture
  delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture
 }
 const json=Buffer.from(JSON.stringify(gltf)),padded=Buffer.alloc(Math.ceil(json.length/4)*4,0x20);json.copy(padded)
 const binary=bytes.subarray(20+length),modified=Buffer.alloc(20+padded.length+binary.length)
 modified.writeUInt32LE(0x46546c67,0);modified.writeUInt32LE(2,4);modified.writeUInt32LE(modified.length,8)
 modified.writeUInt32LE(padded.length,12);modified.writeUInt32LE(0x4e4f534a,16);padded.copy(modified,20);binary.copy(modified,20+padded.length)
 const loaded=await new GLTFLoader().parseAsync(modified.buffer.slice(modified.byteOffset,modified.byteOffset+modified.length),'')
 if(output.file==='mine-substation.glb') {loaded.scene.position.set(...config.substation.position);scene.add(loaded.scene)}
 else room.add(loaded.scene)
 interaction.register(loaded.scene)
}
assert.equal(new Set(semanticIds).size,semanticIds.length)
assert.equal(interaction.count,16)
assert.equal(report.entities.filter(e=>e.kind==='cabinet').length,12)
assert.ok(report.totalTriangles<=config.maxTriangles);assert.ok(report.totalBytes<=config.maxBytes)
assert.ok(report.geometryChecks.bareConductorToGroundedStructureMeters>.20)
assert.ok(report.geometryChecks.triangleDistanceQueries>10000)
scene.updateMatrixWorld(true)
const cabinetIds=report.entities.filter(e=>e.kind==='cabinet').map(e=>e.id)
const cabinetBoxes=cabinetIds.map(id=>{
 const node=room.getObjectByName(id);assert.ok(node)
 const box=new THREE.Box3().setFromObject(node,true)
 assert.ok(box.min.y>=.309 && box.max.y<3)
 assert.ok(box.min.x>44.2 && box.max.x<61.8)
 assert.ok(box.min.z> -14.3 && box.max.z< -5.7)
 // Check actual meshes against a central clear operating aisle, below trays.
 assert.ok(box.max.z<=-11.25||box.min.z>=-8.75,id+' enters operating aisle')
 return {id,box}
})
for(let i=0;i<cabinetBoxes.length;i++)for(let j=i+1;j<cabinetBoxes.length;j++)
 assert.ok(!cabinetBoxes[i].box.intersectsBox(cabinetBoxes[j].box),'Cabinet overlap')
const actualFrontClearMeters=Math.min(...cabinetBoxes.filter(c=>c.id.includes('-lv-')).map(c=>c.box.min.z))-
 Math.max(...cabinetBoxes.filter(c=>c.id.includes('-mv-')).map(c=>c.box.max.z))
assert.ok(actualFrontClearMeters>=2.6)
const selected=[]
function aim(point) {
 const camera=new THREE.PerspectiveCamera(40,1,.1,100)
 camera.position.set(point.x,8,-10);camera.lookAt(point);camera.updateMatrixWorld(true)
 return camera
}
for(const id of cabinetIds) {
 const e=report.entities.find(e=>e.id===id),sign=e.position[2]<0?-1:1
 const target=new THREE.Vector3(53+e.position[0],1.5,-10+e.position[2]-sign*.62)
 const camera=aim(target)
 interaction.setRoofVisible(true);scene.updateMatrixWorld(true)
 assert.equal(interaction.pick(new THREE.Vector2(0,0),camera),null,'Roof must occlude cabinets')
 interaction.setRoofVisible(false);scene.updateMatrixWorld(true)
 const picked=interaction.pick(new THREE.Vector2(0,0),camera)
 assert.equal(picked?.id,id);selected.push(picked.id)
}
// Installation reserves are separate identities, checked against real meshes.
for(const e of report.entities.filter(e=>e.kind.endsWith('reserve')||e.kind==='grounding-interface')) {
 const node=room.getObjectByName(e.id);assert.ok(node)
 assert.equal(node.userData.id,e.id);assert.equal(node.userData.kind,e.kind)
 assert.ok(!new THREE.Box3().setFromObject(node,true).isEmpty())
}
const reserveRaycasts=[]
for(const reserve of config.reserves) {
 const node=room.getObjectByName(reserve.id)
 const target=new THREE.Box3().setFromObject(node,true).getCenter(new THREE.Vector3())
 const camera=reserve.kind==='spd-reserve'?aim(target):new THREE.PerspectiveCamera(40,1,.1,100)
 if(reserve.kind!=='spd-reserve') {camera.position.set(40,target.y+1,target.z);camera.lookAt(target);camera.updateMatrixWorld(true)}
 interaction.setRoofVisible(false);scene.updateMatrixWorld(true)
 const picked=interaction.pick(new THREE.Vector2(0,0),camera)
 assert.equal(picked?.id,reserve.id);reserveRaycasts.push(picked.id)
}
for(const e of config.reserves.filter(e=>e.kind.startsWith('grounding'))) {
 const [x,,z]=e.position.map((n,i)=>n+config.distribution.position[i])
 assert.ok(x<44,'Grounding reserves must be outside room')
 for(const road of ROADS) {
  const horizontal=road.from[1]===road.to[1]
  const xmin=horizontal?Math.min(road.from[0],road.to[0]):road.from[0]-road.width/2
  const xmax=horizontal?Math.max(road.from[0],road.to[0]):road.from[0]+road.width/2
  const zmin=horizontal?road.from[1]-road.width/2:Math.min(road.from[1],road.to[1])
  const zmax=horizontal?road.from[1]+road.width/2:Math.max(road.from[1],road.to[1])
  assert.ok(!(x+e.size[0]/2>xmin&&x-e.size[0]/2<xmax&&z+e.size[2]/2>zmin&&z-e.size[2]/2<zmax),e.id+' enters road')
 }
}
interaction.dispose()
const verification={result:'PASS',protectedFilesUnchanged:baseline.length,layoutUnchanged:true,models,
 totalTriangles:report.totalTriangles,totalBytes:report.totalBytes,selectableEntities:16,
 cabinetRaycastIds:selected,reserveRaycastIds:reserveRaycasts,roofOcclusionChecks:12,cabinetOverlaps:0,groundingRoadOverlaps:0,
 checks:{...report.checks,actualFrontClearMeters},geometryChecks:report.geometryChecks,
 limits:'Visual model and maintenance-space checks; not electrical design certification.'}
writeFileSync(new URL('public/models/mine-power-area.verification.json',root),JSON.stringify(verification,null,2))
console.log(JSON.stringify(verification,null,2))
