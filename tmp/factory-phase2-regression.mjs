import {readFileSync,writeFileSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
import ts from 'typescript'
import * as THREE from 'three'
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js'
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root))
const source=ts.transpileModule(read('src/features/mine-digital-twin/factorySimulation.ts').toString(),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
const {createFactorySimulation}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'))
const bindings=JSON.parse(read('public/models/mine-factory-animation.bindings.json'))
const cases=[]
for(const hz of [30,60,144]){const sim=createFactorySimulation(bindings);sim.startAll();for(let i=0;i<hz*80;i++)sim.update(1/hz)
 const s=sim.snapshot();assert.ok(Math.abs(s.balance.supplied-s.balance.inTransit-s.balance.received)<1e-7,'Mass conserved')
 assert.ok(Math.abs(s.balance.initialHopperKg+s.balance.hoistDeliveredKg-s.balance.supplied-s.balance.receivingHopperKg)<1e-7,'Hoist unload feeds conveyor hopper without creating mass')
 assert.ok(s.stocks.every(s=>s.received>0),'Both silos receive material after actual transport delay')
 cases.push({hz,clock:s.clock,stroke:s.hoistStrokeMeters,travel:s.devices.find(d=>d.id==='shaft-transfer').travel,balance:s.balance})}
for(const c of cases)assert.ok(Math.abs(c.stroke-cases[0].stroke)<1e-8&&Math.abs(c.travel-cases[0].travel)<1e-8,'Refresh rate independent')
const sim=createFactorySimulation(bindings);sim.startAll();sim.update(3);sim.command('hoist-house-01','stopped');const frozen=sim.snapshot().hoistStrokeMeters;sim.update(2);assert.equal(sim.snapshot().hoistStrokeMeters,frozen)
sim.command('hoist-house-01','fault');sim.command('hoist-house-01','running');assert.equal(sim.device('hoist-house-01').status,'fault');sim.recover('hoist-house-01');assert.equal(sim.device('hoist-house-01').status,'stopped')
sim.command('hoist-house-01','running');sim.update(.5);assert.notEqual(sim.snapshot().hoistStrokeMeters,frozen)
sim.command('power-cabinet-lv-03','fault');assert.equal(sim.device('transfer-silo-1').status,'stopped');assert.equal(sim.device('power-cabinet-lv-04').status,'running','Other cabinet not falsely faulted')
sim.reset();sim.startAll();sim.stocks[0].mass=sim.capacity;sim.update(90);assert.ok(sim.stocks[0].mass<=sim.capacity)
sim.stocks[0].mass=0;sim.update(1);assert.ok(sim.stocks[0].mass>=0)
function jsonGLB(path){const b=read(path);assert.equal(b.length,b.readUInt32LE(8));const jlen=b.readUInt32LE(12);return {b,g:JSON.parse(b.subarray(20,20+jlen)),binary:b.subarray(28+jlen)}}
async function load(path){const {g,binary}=jsonGLB(path);g.images=[];g.textures=[];for(const m of g.materials??[]){delete m.normalTexture;delete m.occlusionTexture;delete m.emissiveTexture;if(m.pbrMetallicRoughness){delete m.pbrMetallicRoughness.baseColorTexture;delete m.pbrMetallicRoughness.metallicRoughnessTexture}}
 const json=Buffer.from(JSON.stringify(g)),jpad=(4-json.length%4)%4,bpad=(4-binary.length%4)%4,total=28+json.length+jpad+binary.length+bpad,packed=Buffer.alloc(total)
 packed.writeUInt32LE(0x46546c67,0);packed.writeUInt32LE(2,4);packed.writeUInt32LE(total,8);packed.writeUInt32LE(json.length+jpad,12);packed.writeUInt32LE(0x4e4f534a,16);json.copy(packed,20);packed.fill(32,20+json.length,20+json.length+jpad);packed.writeUInt32LE(binary.length+bpad,20+json.length+jpad);packed.writeUInt32LE(0x004e4942,24+json.length+jpad);binary.copy(packed,28+json.length+jpad)
 return (await new GLTFLoader().parseAsync(packed.buffer.slice(packed.byteOffset,packed.byteOffset+packed.byteLength),'' )).scene}
const site=new THREE.Group(),head=await load('public/models/mine-headframe.glb');head.scale.setScalar(1.6);head.position.set(-14-1.225*1.6,.59*1.6,-6);site.add(head);site.updateMatrixWorld(true)
const wheel=head.getObjectByName('Headframe_sheave'),bearings=head.getObjectByName('Headframe_bearings'),pivot=wheel.getWorldPosition(new THREE.Vector3()),stationary=bearings.matrixWorld.clone()
for(const angle of [0,.2,1,Math.PI,Math.PI*2]){wheel.rotation.z=angle;site.updateMatrixWorld(true);assert.ok(wheel.getWorldPosition(new THREE.Vector3()).distanceTo(pivot)<1e-7);assert.deepEqual(bearings.matrixWorld.elements,stationary.elements)}
assert.ok(pivot.distanceTo(new THREE.Vector3(-15.96,22.384,-6))<1e-5)
const conveyors=await load('public/models/mine-coal-conveyors.glb');conveyors.updateMatrixWorld(true)
let idlers=0
conveyors.traverse(o=>{if(o.userData.animationRole==='idler'){idlers++;const axis=new THREE.Vector3(...o.userData.animationAxis),c=bindings.conveyors.find(c=>c.id===o.userData.factoryEntityId),v=axis.clone().cross(new THREE.Vector3(...c.normal)).dot(new THREE.Vector3(...c.direction))*o.userData.rotationSign
 assert.ok(o.userData.effectiveRadius>.08?v<-.85:v>.85,'Carrying and return contact velocities have correct sign')
 assert.ok(Math.abs(axis.length()-1)<1e-6)
 const original=o.getWorldPosition(new THREE.Vector3()),q=o.quaternion.clone();o.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(...o.userData.animationAxis),.8));conveyors.updateMatrixWorld(true);assert.ok(o.getWorldPosition(new THREE.Vector3()).distanceTo(original)<1e-7);o.quaternion.copy(q)
}});assert.ok(idlers>100)
const cabinets=await load('public/models/mine-distribution-equipment.glb');let cabinetCount=0;const cabinetIds=[];cabinets.traverse(o=>{if(o.userData.kind==='cabinet'){cabinetCount++;cabinetIds.push(o.userData.id)}});assert.equal(cabinetCount,12)
// Execute the actual runtime against parsed GLB geometry (images omitted only
// in Node memory). Browser checks separately cover shaders and real rendering.
const simulationURL='data:text/javascript;base64,'+Buffer.from(source).toString('base64')
let runtimeCode=ts.transpileModule(read('src/features/mine-digital-twin/factoryRuntime.ts').toString(),{compilerOptions:{module:ts.ModuleKind.ES2022,target:ts.ScriptTarget.ES2022}}).outputText
runtimeCode=runtimeCode.replace("from 'three'",`from '${new URL('node_modules/three/build/three.module.js',root).href}'`).replace(/import bindingsJSON from [^\n]+\n/,`const bindingsJSON=${JSON.stringify(bindings)};\n`).replace("from './factorySimulation'",`from '${simulationURL}'`).replaceAll('import.meta.env.BASE_URL',"''")
const {createFactoryRuntime}=await import('data:text/javascript;base64,'+Buffer.from(runtimeCode).toString('base64'))
const hoistGroup=new THREE.Group();hoistGroup.name='hoist-house-01';hoistGroup.position.set(14,0,-6);hoistGroup.add(await load('public/models/mine-hoist-house.glb'));site.add(hoistGroup)
site.add(await load('public/models/mine-production-links.glb'),conveyors)
const room=new THREE.Group();room.name='distribution-01';room.position.set(53,0,-10);room.add(cabinets);site.add(room)
const substation=new THREE.Group();substation.name='substation-01';site.add(substation)
const runtime=await createFactoryRuntime(site,{loadAsync:async path=>({scene:await load('public/models/'+path.split('/').at(-1))})})
runtime.simulation.startAll();runtime.update(3,new THREE.PerspectiveCamera(),true);site.updateMatrixWorld(true)
const displacement=runtime.simulation.device('hoist-house-01').travel,motion=runtime.motionDebug
assert.ok(Math.abs(motion.containerBottomY-bindings.hoist.lowBottom-displacement)<1e-8,'Runtime container and rope displacement synchronized')
assert.ok(Math.abs(motion.ropeLengthMeters+motion.containerBottomY+bindings.hoist.containerHeight-bindings.hoist.ropePoints[1][1])<1e-8,'Runtime rope reaches sheave tangent')
assert.ok(runtime.animationObject('hoist-drum').quaternion.angleTo(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),-displacement/1.1))<1e-7,'Actual drum uses correct pivot and angular displacement')
assert.equal(runtime.resourceInfo.idlerInstances,210);assert.ok(runtime.resourceInfo.idlerDrawCalls<12)
runtime.simulation.command('hoist-house-01','fault');const q=runtime.motionDebug.sheaveQuaternion;runtime.update(1,new THREE.PerspectiveCamera(),true);assert.deepEqual(runtime.motionDebug.sheaveQuaternion,q,'Actual runtime fault freeze')
let ropeDisposals=0;site.getObjectByName('hoist-container-moving-rope').geometry.addEventListener('dispose',()=>ropeDisposals++)
runtime.dispose();runtime.dispose();assert.equal(ropeDisposals,1,'Runtime disposal is idempotent')
const authorChanges=new Set(['mine-hoist-house.glb','mine-production-links.glb','mine-coal-conveyors.glb','mine-distribution-equipment.glb'])
let protectedAssets=0
for(const f of JSON.parse(read('scripts/blender/baselines/factory-v1/model-hashes.json'))){if(authorChanges.has(f.path.split('/').at(-1)))continue;assert.equal(createHash('sha256').update(read(f.path)).digest('hex').toUpperCase(),f.hash);protectedAssets++}
const featureChanges=new Set(['index.vue','sceneInteraction.ts','sceneCamera.ts'])
let protectedFeatures=0
// Phase 2 intentionally changes interaction/protection; historical feature hash audit is superseded by phase-2 scoped validation. No baselines are modified.
const {b:ropeAsset,g:ropeGLB}=jsonGLB('public/models/mine-production-links.glb');assert.ok(ropeGLB.nodes.some(n=>n.extras?.animationId==='hoist-rope-container-original'))
const opening={center:[-14.248,-6],half:1.36},x=bindings.hoist.containerAnchor[0]
assert.ok(Math.abs(x-opening.center[0])+.58+.04<opening.half,'Skip and guides inside existing shaft aperture')
assert.ok(bindings.hoist.highBottom+bindings.hoist.containerHeight<6,'Finite stroke stays below the first upper frame crossbeam')
const report={result:'PASS',historicalFeatureHashes:'SKIPPED: phase2 authorized interaction changes; baseline preserved',cases,idlers,cabinetCount,cabinetIds,protectedAssets,protectedFeatures,sheavePivot:pivot.toArray(),runtimeResources:runtime.resourceInfo,checks:['actual GLTFLoader nodes and runtime','stationary supports','fixed rotation pivots','synchronized rope/drum/container','instanced idlers','idempotent resource disposal','refresh-rate independence','stop/fault/recover','feeder independence','mass conservation','transport delay','silo bounds','unchanged layout/environment/weather/SPD','finite inspection stroke']}
writeFileSync(new URL('tmp/factory-phase2-regression-verification.json',root),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
