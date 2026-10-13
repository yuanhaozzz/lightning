import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import ts from 'typescript'
import * as THREE from 'three'
const root=new URL('../../../',import.meta.url)
const three=new URL('node_modules/three/build/three.module.js',root).href
const urls=new Map()
const moduleUrl=name=>{if(urls.has(name))return urls.get(name);const code=ts.transpileModule(readFileSync(new URL(`src/features/mine-digital-twin/${name}.ts`,root),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace("from 'three'",`from '${three}'`).replace(/from '(\.\/\w+)'/g,(_all,path)=>`from '${moduleUrl(path.slice(2))}'`);const url=`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;urls.set(name,url);return url}
const {frameStormView}=await import(moduleUrl('stormView'))
const {generateCloudDensity,densitySilhouette}=await import(moduleUrl('stormCloudDensity'))
const {CLOUD_FROM,CLOUD_TO,CLOUD_SIZE}=await import(moduleUrl('stormCloudState'))
const {ASSETS,isBuilding}=await import(moduleUrl('layout'))
const park=[...[-76,76].flatMap(x=>[-59,59].map(z=>new THREE.Vector3(x,0,z))),...ASSETS.filter(isBuilding).flatMap(a=>[-1,1].flatMap(x=>[-1,1].flatMap(z=>[0,1].map(y=>new THREE.Vector3(a.position[0]+x*a.size[0]/2,a.position[1]+y*a.size[1],a.position[2]+z*a.size[2]/2)))))]
const silhouette=densitySilhouette(generateCloudDensity())
const cloud=[CLOUD_FROM,CLOUD_TO].flatMap(c=>silhouette.map(p=>new THREE.Vector3(...p.map((v,i)=>c[i]+v*CLOUD_SIZE[i]))))
const results=[]
for(const [width,height] of [[1440,900],[604,871],[390,844],[1920,1080]])for(const mode of ['demo','oblique']){
  const camera=new THREE.PerspectiveCamera(40,width/height,.3,5000)
  const view=frameStormView(camera,park,cloud,width,height,mode)
  camera.position.copy(view.position);camera.fov=view.fov;camera.lookAt(view.target)
  camera.setViewOffset(width,height,view.offsetX,view.offsetY,width,height);camera.updateMatrixWorld(true)
  const bounds=points=>{const projected=points.map(p=>p.clone().project(camera));return {left:Math.min(...projected.map(p=>(p.x+1)*width/2)),right:Math.max(...projected.map(p=>(p.x+1)*width/2)),top:Math.min(...projected.map(p=>(1-p.y)*height/2)),bottom:Math.max(...projected.map(p=>(1-p.y)*height/2))}}
  const cb=bounds(cloud),pb=bounds(park)
  if(mode==='demo')assert.ok(cb.left>0&&cb.right<width&&cb.top>40&&cb.bottom<height-80,`${mode} ${width}: complete cloud stays inside screen`)
  assert.ok(pb.left>0&&pb.right<width&&pb.bottom<height-85,'Park remains clear of toolbar')
  assert.ok((pb.right-pb.left)/width>(width>1000?(mode==='demo'?.35:.32):.39),`Park prominence ${mode} ${width}: ${(pb.right-pb.left)/width}`)
  results.push({width,height,mode,cloud:cb,park:pb,parkWidthPercent:+((pb.right-pb.left)/width*100).toFixed(1)})
}
const {createMineEnvironment}=await import(moduleUrl('mineEnvironment'))
const scene=new THREE.Scene(),originalFog=new THREE.Fog(0xffffff,10,20);scene.fog=originalFog
const environment=createMineEnvironment(scene),rootObject=scene.getObjectByName('mine-natural-surroundings')
const terrain=rootObject.children[1],positions=terrain.geometry.getAttribute('position')
for(let i=0;i<positions.count;i++)assert.ok(Math.abs(positions.getX(i))>=74-.001||Math.abs(positions.getZ(i))>=57-.001,'Terrain does not invade existing footprint')
assert.ok(environment.resourceInfo.terrainTriangles<16000)
const resources=[];rootObject.children.forEach(o=>{for(const r of [o.geometry,o.material]){const item={disposed:0};r.addEventListener('dispose',()=>item.disposed++);resources.push(item)}})
environment.update(1,CLOUD_TO,true);assert.equal(rootObject.children[2].visible,false,'Shade must not cover grounding cutaway')
environment.dispose();environment.dispose();assert.equal(scene.fog,originalFog);assert.ok(resources.every(r=>r.disposed===1))
const output={result:'PASS',profile:{size:CLOUD_SIZE,from:CLOUD_FROM,to:CLOUD_TO},cameraChecks:results,environment:environment.resourceInfo,checks:['occupied silhouette fit','trajectory endpoint envelope','park prominence','responsive fit','terrain footprint exclusion','cutaway preservation','resource release']}
writeFileSync(new URL('tmp/mine-storm-visual-validation.json',root),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2))
