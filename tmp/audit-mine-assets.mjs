import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import * as THREE from 'three'

const models = 'public/models/'
const counts = { SCALAR:1,VEC2:2,VEC3:3,VEC4:4,MAT4:16 }
function audit(file) {
  const b = readFileSync(models+file)
  assert.equal(b.readUInt32LE(0),0x46546c67)
  assert.equal(b.readUInt32LE(4),2)
  assert.equal(b.readUInt32LE(8),b.length)
  const len = b.readUInt32LE(12), g = JSON.parse(b.subarray(20,20+len)), bin=28+len
  const p=[]
  for(const [i,m] of (g.meshes??[]).entries()) for(const prim of m.primitives) {
    assert.equal(prim.mode??4,4)
    const a=g.accessors[prim.attributes.POSITION]
    p.push({mesh:i,name:m.name,material:prim.material,vertices:a.count,triangles:(prim.indices!==undefined?g.accessors[prim.indices].count:a.count)/3,attributes:Object.keys(prim.attributes)})
  }
  const images=(g.images??[]).map(im=>{
    const v=g.bufferViews[im.bufferView], raw=b.subarray(bin+(v.byteOffset??0),bin+(v.byteOffset??0)+v.byteLength)
    const png=raw.subarray(1,4).toString()==='PNG'
    return {name:im.name,mimeType:im.mimeType,bytes:v.byteLength,width:png?raw.readUInt32BE(16):null,height:png?raw.readUInt32BE(20):null,sha256:createHash('sha256').update(raw).digest('hex')}
  })
  const bounds=new THREE.Box3()
  function visit(i,parent) {
    const n=g.nodes[i],matrix=n.matrix?new THREE.Matrix4().fromArray(n.matrix):new THREE.Matrix4().compose(new THREE.Vector3().fromArray(n.translation??[0,0,0]),new THREE.Quaternion().fromArray(n.rotation??[0,0,0,1]),new THREE.Vector3().fromArray(n.scale??[1,1,1]))
    matrix.premultiply(parent)
    if(n.mesh!==undefined) for(const prim of g.meshes[n.mesh].primitives) {
      const a=g.accessors[prim.attributes.POSITION]
      const view=g.bufferViews[a.bufferView],size=counts[a.type],stride=view.byteStride??size*4
      assert.equal(a.componentType,5126)
      for(let j=0;j<a.count;j++) {
        const off=bin+(view.byteOffset??0)+(a.byteOffset??0)+j*stride
        const pos=new THREE.Vector3(b.readFloatLE(off),b.readFloatLE(off+4),b.readFloatLE(off+8)).applyMatrix4(matrix)
        assert.ok(pos.toArray().every(Number.isFinite));bounds.expandByPoint(pos)
      }
    }
    for(const child of n.children??[])visit(child,matrix)
  }
  for(const n of g.scenes[g.scene??0].nodes) visit(n,new THREE.Matrix4())
  const materials=(g.materials??[]).map((m,i)=>({name:m.name,metallic:m.pbrMetallicRoughness?.metallicFactor??1,roughness:m.pbrMetallicRoughness?.roughnessFactor??1,baseColor:m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],baseTexture:m.pbrMetallicRoughness?.baseColorTexture?.index,roughMetalTexture:m.pbrMetallicRoughness?.metallicRoughnessTexture?.index,normalTexture:m.normalTexture?.index,aoTexture:m.occlusionTexture?.index,alphaMode:m.alphaMode??'OPAQUE',triangles:p.filter(x=>x.material===i).reduce((s,x)=>s+x.triangles,0)}))
  return {file,sha256:createHash('sha256').update(b).digest('hex'),bytes:b.length,triangles:p.reduce((s,x)=>s+x.triangles,0),vertices:p.reduce((s,x)=>s+x.vertices,0),meshCount:g.meshes?.length??0,primitiveCount:p.length,nodeCount:g.nodes?.length??0,materialCount:materials.length,imageCount:images.length,embeddedImageBytes:images.reduce((s,x)=>s+x.bytes,0),rgbaMipEstimateBytes:Math.round(images.reduce((s,x)=>s+(x.width??0)*(x.height??0)*4*4/3,0)),bounds:{min:bounds.min.toArray(),max:bounds.max.toArray(),size:bounds.getSize(new THREE.Vector3()).toArray(),center:bounds.getCenter(new THREE.Vector3()).toArray()},extensionsUsed:g.extensionsUsed??[],selfContained:(g.images??[]).every(x=>x.bufferView!==undefined&&!x.uri)&&(g.buffers??[]).every(x=>!x.uri),primitives:p,materials,images,nodes:(g.nodes??[]).map(n=>({name:n.name,mesh:n.mesh,extras:n.extras}))}
}
const assets=readdirSync(models).filter(n=>n.startsWith('mine-')&&n.endsWith('.glb')).map(audit)
const protectedRefs=[]
for(const name of readdirSync('scripts/blender').filter(n=>n.endsWith('protected-baseline.json'))) {
  const list=JSON.parse(readFileSync('scripts/blender/'+name,'utf8').replace(/^\uFEFF/,''))
  for(const item of list)if(/headframe/.test(item.path))protectedRefs.push({baseline:name,path:item.path,matches:createHash('sha256').update(readFileSync(item.path)).digest('hex').toUpperCase()===item.hash.toUpperCase()})
}
const baselineHashes={}
for(const folder of ['scripts/blender','public/models','src/features/mine-digital-twin'])for(const file of readdirSync(folder,{withFileTypes:true}).filter(x=>x.isFile()))baselineHashes[folder+'/'+file.name]=createHash('sha256').update(readFileSync(folder+'/'+file.name)).digest('hex')
const report={date:new Date().toISOString(),scope:'READ-ONLY asset audit; estimates do not include render-target/GPU-driver overhead',assets,totals:{files:assets.length,bytes:assets.reduce((s,x)=>s+x.bytes,0),triangles:assets.reduce((s,x)=>s+x.triangles,0),materials:assets.reduce((s,x)=>s+x.materialCount,0),images:assets.reduce((s,x)=>s+x.imageCount,0)},protectedRefs,baselineHashes}
writeFileSync('tmp/mine-art-quality-audit.json',JSON.stringify(report,null,2))
console.log(JSON.stringify({totals:report.totals,headframe:assets.find(x=>x.file==='mine-headframe.glb'),protectedRefs,assets:assets.map(({file,bytes,triangles,meshCount,materialCount,imageCount})=>({file,bytes,triangles,meshCount,materialCount,imageCount}))},null,2))
