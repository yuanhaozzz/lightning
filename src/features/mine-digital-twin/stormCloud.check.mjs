import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import ts from 'typescript'
const root = new URL('../../../', import.meta.url)
const read = name => readFileSync(new URL(`src/features/mine-digital-twin/${name}`, root), 'utf8')
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const densityUrl = uri(compile(read('stormCloudDensity.ts'))), motionUrl = uri(compile(read('stormCloudState.ts')))
const atmosphereUrl=uri(compile(read('stormAtmosphereState.ts')))
const { CLOUD_GRID, generateCloudDensity } = await import(densityUrl)
const { createCloudMotion, CLOUD_SIZE, CLOUD_FROM, CLOUD_FADE_OUT_MS } = await import(motionUrl)
const { createStormCloud } = await import(uri(compile(read('stormCloud.ts')).replace("from 'three'", `from '${new URL('node_modules/three/build/three.module.js', root).href}'`).replace("from './stormCloudDensity'", `from '${densityUrl}'`).replace("from './stormCloudState'", `from '${motionUrl}'`).replace("from './stormAtmosphereState'",`from '${atmosphereUrl}'`)))
const normal = { playback:'playing',phase:'normal',runId:'test-1',elapsedMs:4900,durationMs:45000 }
const motion = createCloudMotion()
motion.update(normal,16)
assert.equal(motion.frame.visible,false)
motion.update({...normal,phase:'warning',elapsedMs:5000},100)
assert.equal(motion.frame.opacity,0,'Warning boundary begins at zero opacity')
motion.update({...normal,phase:'warning',elapsedMs:7000},100)
assert.equal(motion.frame.opacity,.5)
const paused = {...normal,phase:'warning',playback:'paused',elapsedMs:7000}
motion.update(paused,5000)
const frozen = motion.frame
assert.equal(motion.update(paused,5000),false)
assert.deepEqual(motion.frame,frozen,'Pause preserves position and fade amount')
motion.update({...normal,phase:'warning',elapsedMs:7100},100)
assert.ok(Math.abs(motion.frame.position[0]-frozen.position[0])<.4,'Motion resumes continuously, without wall time catchup')
motion.update({...normal,phase:'warning',elapsedMs:19000},100)
const atExit = motion.frame
const idle = {playback:'idle',phase:'normal',elapsedMs:0,runId:null,durationMs:45000}
motion.update(idle,100)
assert.ok(motion.frame.opacity>0&&motion.frame.opacity<atExit.opacity,'Exit fades rather than disappears')
assert.deepEqual(motion.frame.position,atExit.position,'Exit preserves last location while fading')
motion.update(idle,CLOUD_FADE_OUT_MS)
assert.equal(motion.frame.visible,false)
motion.update({...normal,phase:'warning',elapsedMs:10000,runId:'test-2'},16)
motion.update({...normal,elapsedMs:0,runId:'test-3'},16)
assert.equal(motion.frame.opacity,0,'Replay clears old cloud and starts at origin')

const data = generateCloudDensity(), {width,height,depth} = CLOUD_GRID
assert.deepEqual(data,generateCloudDensity(),'Deterministic density avoids temporal flicker')
const index=(x,y,z)=>x+width*(y+height*z)
const bottoms=[],tops=[],coreBottoms=[]
for(let z=0;z<depth;z++)for(let x=0;x<width;x++){
  const occupied=[]
  for(let y=0;y<height;y++)if(data[index(x,y,z)]>20)occupied.push(y)
  if(occupied.length>8){bottoms.push(occupied[0]);tops.push(occupied.at(-1));if(Math.abs(x/(width-1)*2-1)<.35&&Math.abs(z/(depth-1)*2-1)<.35)coreBottoms.push(occupied[0])}
  assert.equal(data[index(x,0,z)],0)
  assert.equal(data[index(x,height-1,z)],0)
}
assert.ok(bottoms.length>500,'Density is a substantial connected volume')
assert.ok(Math.max(...coreBottoms)-Math.min(...coreBottoms)<=3,'Main cloud base is relatively flat; upper anvil edges overhang it')
assert.ok(Math.max(...tops)-Math.min(...tops)>10,'Cloud top has substantial non-flat rise')
assert.ok(new Set(data).size>150,'Continuous density variation creates layered, soft edges')
for(let y=0;y<height;y++)for(let z=0;z<depth;z++){assert.equal(data[index(0,y,z)],0);assert.equal(data[index(width-1,y,z)],0)}
const cloudBaseMin=CLOUD_FROM[1]-CLOUD_SIZE[1]/2+Math.min(...bottoms)/(height-1)*CLOUD_SIZE[1]
assert.ok(cloudBaseMin>35,'Cloud clears the existing 25m headframe and its demonstration rod')

const scene = new THREE.Scene(); scene.background=new THREE.Color('#e3e7e3');scene.environmentIntensity=.35
const sun = new THREE.DirectionalLight(0xffffff,2.4), ambient = new THREE.HemisphereLight(0xffffff,0x777777,.65)
const cloud=createStormCloud(scene,{sun,ambient}),mesh=scene.getObjectByName('demo-storm-volume')
assert.equal(cloud.resourceInfo.drawCalls,1)
assert.equal(mesh.material.depthWrite,false)
assert.equal(mesh.material.transparent,true)
assert.equal(mesh.raycast(new THREE.Raycaster(),[]),undefined,'Cloud cannot become a business pick target')
const disposeCount={geometry:0,material:0,texture:0}
mesh.geometry.addEventListener('dispose',()=>disposeCount.geometry++)
mesh.material.addEventListener('dispose',()=>disposeCount.material++)
mesh.material.uniforms.uDensity.value.addEventListener('dispose',()=>disposeCount.texture++)
cloud.update({...normal,phase:'warning',elapsedMs:12000},16)
assert.ok(sun.intensity<2.4&&sun.intensity>1.8)
assert.ok(scene.environmentIntensity>.28)
cloud.update(idle,CLOUD_FADE_OUT_MS)
assert.equal(sun.intensity,2.4);assert.equal(ambient.intensity,.65);assert.equal(scene.environmentIntensity,.35)
assert.equal(scene.background.getHexString(),'e3e7e3')
cloud.dispose();cloud.dispose()
assert.deepEqual(disposeCount,{geometry:1,material:1,texture:1},'Dispose every cloud resource once')
assert.equal(scene.children.length,0)
assert.equal(cloud.update(normal,16),false)
const result={result:'PASS',densityBytes:data.byteLength,occupiedColumns:bottoms.length,cloudBaseMinMeters:cloudBaseMin,
  baseVariationVoxels:Math.max(...coreBottoms)-Math.min(...coreBottoms),topVariationVoxels:Math.max(...tops)-Math.min(...tops),
  resources:cloud.resourceInfo,checks:['timeline','pause/resume','exit fade','replay','deterministic volume','shape/base/height','lighting restore','non-pickable','resource disposal']}
writeFileSync(new URL('tmp/mine-cloud-validation.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2))
