import {readFileSync,writeFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import * as T from 'three'
function read(path){const bytes=readFileSync(path);assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.length,bytes.readUInt32LE(8));const length=bytes.readUInt32LE(12),g=JSON.parse(bytes.subarray(20,20+length)),offset=28+length,bounds=new T.Box3();let triangles=0
 const visit=(id,parent)=>{const n=g.nodes[id],m=n.matrix?new T.Matrix4().fromArray(n.matrix):new T.Matrix4().compose(new T.Vector3().fromArray(n.translation??[0,0,0]),new T.Quaternion().fromArray(n.rotation??[0,0,0,1]),new T.Vector3().fromArray(n.scale??[1,1,1]));m.premultiply(parent)
  if(n.mesh!==undefined)for(const p of g.meshes[n.mesh].primitives){const a=g.accessors[p.attributes.POSITION],v=g.bufferViews[a.bufferView];triangles+=(p.indices===undefined?a.count:g.accessors[p.indices].count)/3
   for(let i=0;i<a.count;i++){const x=offset+(v.byteOffset??0)+(a.byteOffset??0)+i*(v.byteStride??12);const point=new T.Vector3(bytes.readFloatLE(x),bytes.readFloatLE(x+4),bytes.readFloatLE(x+8)).applyMatrix4(m);assert.ok(point.toArray().every(Number.isFinite));bounds.expandByPoint(point)}}
  for(const c of n.children??[])visit(c,m)}
 for(const id of g.scenes[g.scene??0].nodes)visit(id,new T.Matrix4())
 return {g,bounds,triangles,bytes:bytes.length}}
const changed=['mine-hoist-house.glb','mine-production-links.glb','mine-coal-conveyors.glb','mine-distribution-equipment.glb'],results=[]
for(const file of changed){const a=read('scripts/blender/baselines/factory-v1/'+file),b=read('tmp/factory-candidate/'+file)
 const error=Math.max(a.bounds.min.distanceTo(b.bounds.min),a.bounds.max.distanceTo(b.bounds.max));assert.ok(error<.0002,file+' placement drift '+error)
 assert.ok(b.triangles<=a.triangles+.01,'No unrelated geometric expansion '+file)
 const ids=b.g.nodes.filter(n=>n.extras?.animationId).map(n=>n.extras.animationId);assert.equal(new Set(ids).size,ids.length,'Unique animation groups')
 results.push({file,beforeBytes:a.bytes,afterBytes:b.bytes,beforeTriangles:a.triangles,afterTriangles:b.triangles,boundsErrorMeters:error,animationGroups:ids.length})}
for(const file of ['mine-hoist-container.glb','mine-coal-material.glb','mine-power-indicators.glb']){const a=read('tmp/factory-candidate/'+file);results.push({file,bytes:a.bytes,triangles:a.triangles})}
const g=read('tmp/factory-candidate/mine-distribution-equipment.glb').g
assert.equal(g.nodes.filter(n=>n.extras?.kind==='cabinet').length,12)
assert.ok(g.nodes.some(n=>n.extras?.id==='spd-distribution'))
const belt=read('tmp/factory-candidate/mine-coal-conveyors.glb').g
for(const id of ['shaft-transfer','transfer-silo-1','transfer-silo-2'])for(const part of ['belt','return-belt','head-pulley','tail-pulley','static'])assert.ok(belt.nodes.some(n=>n.extras?.animationId===id+'/'+part),id+'/'+part)
const result={result:'PASS',results,cabinetIdsPreserved:12,SPDReservePreserved:true};writeFileSync('tmp/factory-candidate-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
