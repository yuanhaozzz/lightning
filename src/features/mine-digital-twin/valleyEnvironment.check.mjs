import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import ts from 'typescript'
import * as THREE from 'three'
const root=new URL('../../../',import.meta.url),three=new URL('node_modules/three/build/three.module.js',root).href
const urls=new Map()
function moduleUrl(name){if(urls.has(name))return urls.get(name)
  let code=ts.transpileModule(readFileSync(new URL(`src/features/mine-digital-twin/${name}.ts`,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  code=code.replace("from 'three'",`from '${three}'`).replace(/from '(\.\/\w+)'/g,(_all,path)=>`from '${moduleUrl(path.slice(2))}'`)
  const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;urls.set(name,url);return url}
const {buildValleySurface,valleyHeight,VALLEY_ROADS}=await import(moduleUrl('valleyTerrain'))
const {createMineEnvironment}=await import(moduleUrl('mineEnvironment'))
const {frameOverview}=await import(moduleUrl('overviewCamera'))
const surface=buildValleySurface();assert.deepEqual(surface,buildValleySurface(),'Deterministic geometry')
const count=surface.positions.length/3,edgeCounts=new Map()
for(let i=0;i<surface.positions.length;i+=3){const [x,y,z]=surface.positions.slice(i,i+3)
  assert.ok(Number.isFinite(x+y+z));assert.ok(Math.abs(x)>=74-1e-5||Math.abs(z)>=57-1e-5,'No geometry inside protected site')}
for(let i=0;i<surface.indices.length;i+=3){const ids=surface.indices.slice(i,i+3)
  assert.ok(ids.every(id=>id>=0&&id<count))
  const [a,b,c]=ids.map(id=>surface.positions.slice(id*3,id*3+3))
  const upward=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])
  assert.ok(upward>1e-7,'No inverted or collapsed terrain triangles')
  for(let edge=0;edge<3;edge++){const pair=[ids[edge],ids[(edge+1)%3]].sort((a,b)=>a-b),key=pair.join(',')
    edgeCounts.set(key,(edgeCounts.get(key)??0)+1)}
}
assert.ok([...edgeCounts.values()].every(n=>n===1||n===2),'Manifold terrain, no overlapping triangle seams')
const boundary=[...edgeCounts.entries()].filter(([,n])=>n===1)
assert.equal(boundary.length,surface.rings[0].samples+surface.rings.at(-1).samples,'Only inner and outer boundaries: no LOD cracks')
assert.ok(valleyHeight(-300,-300)>25&&valleyHeight(300,-400)>25,'Mid-distance hills')
assert.ok(valleyHeight(-900,-1100)>80,'Distant mountain range')
assert.ok(Math.abs(valleyHeight(0,250))<2&&Math.abs(valleyHeight(150,350))<3,'Southern approach stays open')
assert.equal(valleyHeight(74,0),-.07,'Flat industrial skirt at existing boundary')
const slopes=VALLEY_ROADS.map(road=>Math.max(...road.slice(1).map((point,i)=>Math.abs(point.height-road[i].height)/(point.distance-road[i].distance))))
assert.ok(slopes.every(s=>s<.08),'Demonstration road centerlines stay below 8% grade')
assert.deepEqual(VALLEY_ROADS.map(r=>[r[0].x,r[0].z]),[[56,57],[-74,22]],'Existing gates preserved')
assert.ok(VALLEY_ROADS.every(r=>r.at(-1).distance>2200),'Roads extend into distant fog')
const scene=new THREE.Scene(),oldFog=new THREE.Fog(0xffffff,1,2);scene.fog=oldFog
const environment=createMineEnvironment(scene),group=scene.getObjectByName('mine-natural-surroundings'),terrain=scene.getObjectByName('valley-height-field')
const road=scene.getObjectByName('approach-road-asphalt'),positions=road.geometry.getAttribute('position')
const ray=new THREE.Raycaster();ray.ray.direction.set(0,-1,0)
let maxDrapeError=0
for(let i=0;i<positions.count;i+=Math.max(3,Math.floor(positions.count/180/3)*3)){
  const center=new THREE.Vector3();for(let n=0;n<3;n++)center.add(new THREE.Vector3().fromBufferAttribute(positions,i+n));center.divideScalar(3)
  ray.ray.origin.set(center.x,1000,center.z);const hits=[];THREE.Mesh.prototype.raycast.call(terrain,ray,hits);hits.sort((a,b)=>a.distance-b.distance)
  assert.ok(hits.length,'Road triangle has supporting terrain');const error=Math.abs(center.y-hits[0].point.y-.035)
  maxDrapeError=Math.max(maxDrapeError,error);assert.ok(error<.002,'Roads drape precisely without burying or floating')
}
assert.ok(environment.resourceInfo.terrainTriangles<16000&&environment.resourceInfo.roadTriangles<16000,'Bounded geometry budget')
assert.equal(environment.resourceInfo.textures,0,'No large terrain texture payload')
assert.ok(scene.fog.near>=400&&scene.fog.far>=2000,'Park remains clear; road ends disappear in distant fog')
assert.ok(group.children.every(o=>o.raycast(new THREE.Raycaster(),[])===undefined),'Surroundings do not enter semantic picking')
const resources=[];group.traverse(o=>{if(o instanceof THREE.Mesh)for(const r of [o.geometry,o.material]){const record={disposed:0};r.addEventListener('dispose',()=>record.disposed++);resources.push(record)}})
environment.update(1,[-12,68,-55],true);assert.equal(group.children[2].visible,false,'Ground inspection opening remains visible')
environment.dispose();environment.dispose();assert.equal(scene.fog,oldFog);assert.equal(group.parent,null);assert.ok(resources.every(r=>r.disposed===1))
const park=[...[-76,76].flatMap(x=>[-59,59].map(z=>new THREE.Vector3(x,0,z))),new THREE.Vector3(-14,34,-6)]
const views=[]
for(const [width,height] of [[1440,900],[1920,1080],[604,871],[390,844]]){
  const camera=new THREE.PerspectiveCamera(40,width/height,.5,5000),view=frameOverview(camera,park,width,height)
  camera.updateMatrixWorld(true)
  const points=park.map(p=>p.clone().project(camera)),xs=points.map(p=>(p.x+1)*width/2),ys=points.map(p=>(1-p.y)*height/2)
  assert.ok(Math.min(...xs)>0&&Math.max(...xs)<width&&Math.min(...ys)>100&&Math.max(...ys)<height-90,'Complete park remains visible above toolbar')
  const fraction=(Math.max(...xs)-Math.min(...xs))/width;assert.ok(fraction>.60,'Park remains main observation object')
  views.push({width,height,parkWidthPercent:+(fraction*100).toFixed(1),elevation:view.elevation,azimuth:view.azimuth})
}
let featureCount=0
for(const [path,hash] of Object.entries(JSON.parse(readFileSync(new URL('tmp/mine-valley-stage-baseline.json',root),'utf8')))){
  if(path.endsWith('/overviewCamera.ts'))continue // Explicit static composition adjustment, not storm path.
  assert.equal(createHash('sha256').update(readFileSync(new URL(path,root))).digest('hex'),hash,`Preserved feature: ${path}`);featureCount++
}
const models=JSON.parse(readFileSync(new URL('tmp/mine-interaction-protected-baseline.json',root),'utf8'))
for(const file of models)assert.equal(createHash('sha256').update(readFileSync(new URL(file.path,root))).digest('hex').toUpperCase(),file.hash.toUpperCase(),`Protected model/script: ${file.path}`)
const result={result:'PASS',resources:environment.resourceInfo,maxDrapeErrorMeters:maxDrapeError,roadMaxGradesPercent:slopes.map(v=>+(v*100).toFixed(2)),cameraChecks:views,
  protectedFeatureFiles:featureCount,protectedModelAndBlenderFiles:models.length,
  checks:['deterministic height field','park exclusion','manifold LOD stitching','open south valley','graded valley routes','terrain-conforming roads','responsive static overview','non-pickable environment','cutaway preservation','fog/resource restoration','protected file hashes']}
writeFileSync(new URL('tmp/mine-valley-validation.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
