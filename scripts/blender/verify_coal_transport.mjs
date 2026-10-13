/** Phase-4 resource, preservation, interface and access verification. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
const root=new URL('../../',import.meta.url)
const read=p=>readFileSync(new URL(p,root))
const config=JSON.parse(read('scripts/blender/coal_transport.parameters.json'))
const report=JSON.parse(read('public/models/mine-coal-transport.report.json'))
for(const file of JSON.parse(read('scripts/blender/coal_transport.protected-baseline.json').toString().replace(/^\uFEFF/,'')))
 assert.equal(createHash('sha256').update(read(file.path)).digest('hex').toUpperCase(),file.hash,`Protected file changed: ${file.path}`)
const compiled=ts.transpileModule(read('src/features/mine-digital-twin/layout.ts').toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const {ASSETS,CONVEYORS,ROADS}=await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
for(const item of [...config.silos,config.station]) {
 const asset=ASSETS.find(a=>a.id===item.id)
 assert.deepEqual(asset.position,item.position)
 assert.deepEqual(asset.size,item.size)
}
for(const item of config.conveyors) {
 const previous=CONVEYORS.find(c=>c.id===item.id)
 for(const key of ['from','to','width','supports'])assert.deepEqual(item[key],previous[key])
}
assert.deepEqual(report.clearance.stationaryStructureHits,[])
assert.ok(report.clearance.triangleRayQueries>10000)
const rectangles=ROADS.map(r=>({id:r.id,kind:r.kind,
 xmin:r.from[1]===r.to[1]?Math.min(r.from[0],r.to[0]):r.from[0]-r.width/2,
 xmax:r.from[1]===r.to[1]?Math.max(r.from[0],r.to[0]):r.from[0]+r.width/2,
 zmin:r.from[1]===r.to[1]?r.from[1]-r.width/2:Math.min(r.from[1],r.to[1]),
 zmax:r.from[1]===r.to[1]?r.from[1]+r.width/2:Math.max(r.from[1],r.to[1]),
}))
for(const s of report.supports)for(const [x,z] of s.feet) {
 const half=s.padSize/2
 assert.ok(!rectangles.some(r=>x+half>r.xmin&&x-half<r.xmax&&z+half>r.zmin&&z-half<r.zmax),`Foundation enters road: ${s.id} ${x},${z}`)
 assert.ok(!ASSETS.filter(a=>['transfer-station','coal-silo'].includes(a.type)).some(a=>Math.abs(x-a.position[0])<a.size[0]/2+half&&Math.abs(z-a.position[2])<a.size[2]/2+half),`Foundation enters building: ${s.id}`)
}
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`)
for(const path of report.paths) {
 const c=config.conveyors.find(c=>c.id===path.id)
 const a=[...c.from],b=[...c.to];a[1]+=c.beltOffsets[0];b[1]+=c.beltOffsets[1]
 for(const [name,t] of [['beltStart',c.trim[0]],['beltEnd',c.trim[1]]])for(let i=0;i<3;i++)close(path[name][i],a[i]+(b[i]-a[i])*t)
 assert.ok(path.gradeDegrees>0&&path.gradeDegrees<18,`Excessive grade: ${path.id}`)
}
for(const port of report.interfaces.filter(i=>i.id.startsWith('station-'))) {
 assert.ok(port.gravitySlopeDegrees>42)
 assert.ok(port.mouth[1]-port.beltY>.1&&port.mouth[1]-port.beltY<.2)
 const tail=report.paths.find(p=>p.id===`transfer-silo-${port.id==='station--1'?1:2}`).beltStart
 close(tail[0],port.mouth[0]);close(tail[2],port.mouth[2]);close(tail[1],port.beltY)
}
for(const port of report.interfaces.filter(i=>i.id.startsWith('coal-silo'))) {
 const head=report.paths.find(p=>p.id===`transfer-silo-${port.id.endsWith('01')?1:2}`).beltEnd
 head.forEach((n,i)=>close(n,port.headBelt[i]))
 assert.ok(port.headBelt[1]>port.socket[1]+2)
}
// Conservative 3.3 m gallery envelope, -1.05 m lowest structural allowance.
// Sample all existing road surfaces: vehicular clearance >=5.5 m, footpath >=2.5.
const crossings=[]
for(const path of report.paths)for(const road of rectangles) {
 let min=Infinity
 for(let i=0;i<=1200;i++) {
  const t=i/1200,p=path.beltStart.map((a,j)=>a+(path.beltEnd[j]-a)*t)
  if(p[0]>road.xmin-1.65&&p[0]<road.xmax+1.65&&p[2]>road.zmin-1.65&&p[2]<road.zmax+1.65)min=Math.min(min,p[1]-1.05-.08)
 }
 if(min<Infinity){assert.ok(min>=(road.kind==='walkway'?2.5:5.5),`Clearance failure ${path.id} / ${road.id}: ${min}`);crossings.push({conveyor:path.id,road:road.id,conservativeClearanceMeters:min})}
}
const models=[]
for(const output of report.outputs) {
 const bytes=read('public/models/'+output.file)
 assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(4),2)
 assert.equal(bytes.readUInt32LE(8),bytes.length)
 const length=bytes.readUInt32LE(12),gltf=JSON.parse(bytes.subarray(20,20+length)),binOffset=28+length
 assert.equal(bytes.readUInt32LE(16),0x4e4f534a);assert.equal(bytes.readUInt32LE(24+length),0x004e4942)
 assert.ok(gltf.buffers.every(b=>!b.uri))
 assert.ok((gltf.images??[]).every(i=>!i.uri&&i.bufferView!==undefined))
 let triangles=0,vertices=0
 for(const mesh of gltf.meshes)for(const primitive of mesh.primitives) {
  assert.equal(primitive.mode??4,4)
  triangles+=gltf.accessors[primitive.indices].count/3
  vertices+=gltf.accessors[primitive.attributes.POSITION].count
  for(const semantic of ['POSITION','NORMAL','TEXCOORD_0']) {
   const a=gltf.accessors[primitive.attributes[semantic]],v=gltf.bufferViews[a.bufferView]
   assert.equal(a.componentType,5126)
   const n={VEC2:2,VEC3:3}[a.type],stride=v.byteStride??n*4
   for(let i=0;i<a.count;i++) {
    let norm=0
    for(let j=0;j<n;j++) {
     const value=bytes.readFloatLE(binOffset+(v.byteOffset??0)+(a.byteOffset??0)+i*stride+j*4)
     assert.ok(Number.isFinite(value));norm+=value*value
    }
    if(semantic==='NORMAL')assert.ok(Math.abs(norm-1)<.03)
   }
  }
 }
 for(const m of gltf.materials)for(const value of [m.pbrMetallicRoughness.metallicFactor??1,m.pbrMetallicRoughness.roughnessFactor??1])assert.ok(value>=0&&value<=1)
 assert.equal(triangles,output.triangles);assert.equal(output.bytes,bytes.length)
 assert.ok(gltf.materials.length<=9)
 models.push({...output,vertices,materials:gltf.materials.length,embeddedImages:gltf.images?.length??0})
}
const result={result:'PASS',protectedFilesUnchanged:true,layoutUnchanged:true,foundationRoadOverlaps:0,
 actualGeometryPassages:report.clearance,gravityTransfersChecked:true,headInterfacesChecked:true,crossings,models,
 totalTriangles:models.reduce((n,m)=>n+m.triangles,0),totalBytes:models.reduce((n,m)=>n+m.bytes,0)}
assert.ok(result.totalTriangles<config.maximumTotalTriangles)
writeFileSync(new URL('public/models/mine-coal-transport.verification.json',root),JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
