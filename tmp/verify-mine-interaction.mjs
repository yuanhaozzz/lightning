import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import ts from 'typescript'
const root=new URL('../',import.meta.url),read=p=>readFileSync(new URL(p,root)),uri=code=>`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
const compile=p=>ts.transpileModule(read(p).toString(),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
const threeUrl=new URL('node_modules/three/build/three.module.js',root).href
const cfg=JSON.parse(read('scripts/blender/protection.parameters.json')),report=JSON.parse(read('public/models/mine-protection.report.json'))
const baseline=JSON.parse(read('tmp/mine-interaction-protected-baseline.json').toString().replace(/^\uFEFF/,''))
for(const entry of baseline)assert.equal(createHash('sha256').update(read(entry.path)).digest('hex').toUpperCase(),entry.hash,entry.path)
const {ASSETS,isBuilding}=await import(uri(compile('src/features/mine-digital-twin/layout.ts')))
const importCode=(path)=>compile('src/features/mine-digital-twin/'+path).replace("from 'three'",`from '${threeUrl}'`)
const {createSceneInteraction,DEFAULT_LAYERS,isSelectionClick}=await import(uri(importCode('sceneInteraction.ts').replace("import { isBuilding } from './layout';",`const isBuilding=${isBuilding.toString()};`)))
const protectionModule=importCode('protectionScene.ts').replace("import { PROTECTION_FACILITIES, CABINET_INSPECTION, GROUND_WINDOW } from './protectionFacilities';",`const PROTECTION_FACILITIES=${JSON.stringify(cfg.facilities)},CABINET_INSPECTION=${JSON.stringify(cfg.cabinetInspection)},GROUND_WINDOW=${JSON.stringify(cfg.groundWindow)};`).replaceAll('import.meta.env.BASE_URL',"''")
const {createProtection}=await import(uri(protectionModule))
const pcam=uri(importCode('protectionInspection.ts')),powercam=uri(importCode('powerInspection.ts'))
const {frameSceneEntity}=await import(uri(importCode('sceneCamera.ts').replace("from './protectionInspection'",`from '${pcam}'`).replace("from './powerInspection'",`from '${powercam}'`)))
const {protectionInspectionBounds}=await import(pcam)
// Existing parser strips textures only in memory for geometry/raycast tests.
const verifier=read('scripts/blender/verify_protection_facilities.mjs').toString(),loader=new GLTFLoader(),resourceChecks=[]
const parser=verifier.slice(verifier.indexOf('async function load('),verifier.indexOf('\nfor (const output'))
const load=eval('('+parser.replace('async function load(', 'async function(')+')')
const scene=new THREE.Group(),resources=new Map()
const overlay={'transfer-01':'mine-transfer-station.glb','coal-silo-01':'mine-coal-silo-1.glb','coal-silo-02':'mine-coal-silo-2.glb','substation-01':'mine-substation.glb','distribution-01':'mine-distribution-shell.glb'}
for(const asset of ASSETS.filter(isBuilding)) {
  const group=new THREE.Group();group.name=asset.id;group.userData.asset=asset;group.position.set(...asset.position);scene.add(group)
  const path=overlay[asset.id]??asset.modelPath?.split('/').pop()
  if(path) {
    const model=await load(path),bounds=new THREE.Box3().setFromObject(model),center=bounds.getCenter(new THREE.Vector3()),factor=asset.modelScale??1
    model.scale.setScalar(factor)
    if(!asset.preserveModelOrigin&&!overlay[asset.id])model.position.set(-center.x*factor,-(asset.modelGroundY??bounds.min.y)*factor,-center.z*factor)
    group.add(model)
  } else {const mesh=new THREE.Mesh(new THREE.BoxGeometry(...asset.size),new THREE.MeshStandardMaterial());mesh.position.y=asset.size[1]/2;group.add(mesh)}
}
const room=scene.getObjectByName('distribution-01')
for(const file of ['mine-distribution-roof.glb','mine-distribution-equipment.glb'])room.add(await load(file))
for(const device of JSON.parse(read('scripts/blender/monitoring.parameters.json')).devices) {
  const group=new THREE.Group();group.userData.device=device;group.userData.deviceId=device.id;group.position.set(...device.position);group.add(await load(device.modelPath.split('/').pop()));scene.add(group)
}
for(const output of report.outputs)resources.set('models/'+output.file,await load(output.file))
const terrain=new THREE.Mesh(new THREE.BoxGeometry(150,.35,120),new THREE.MeshStandardMaterial());terrain.name='mine-site-ground';terrain.position.y=-.175;scene.add(terrain)
const patch=new THREE.Mesh(new THREE.PlaneGeometry(25,40),new THREE.MeshStandardMaterial());patch.name='power';patch.rotation.x=-Math.PI/2;patch.position.set(53,.014,-20);scene.add(patch)
const protection=createProtection(scene)
await protection.load({loadAsync:async path=>({scene:resources.get(path).clone(true)})},()=>false,()=>{})
const interaction=createSceneInteraction(scene,hit=>protection.ignoresGroundHit(hit));interaction.initialize()
const entityCount=interaction.list.length
assert.equal(new Set(interaction.list.map(e=>e.id)).size,entityCount)
function roof(visible) {protection.setRoofVisible(visible);scene.traverse(n=>{if(n.userData.id==='distribution-roof')n.visible=visible})}
const picks=[],cameraChecks=[]
for(const id of ['headframe-01','hoist-house-01','substation-01','distribution-01','lightning-location-01','storm-warning-01','air-terminal-production','spd-lv-01','power-cabinet-lv-01','ground-monitor-01','earth-section-01']) {
  const entity=interaction.entity(id),object=interaction.object(id);assert.ok(entity&&object)
  roof(!['spd-lv-01','power-cabinet-lv-01'].includes(id));protection.setEarthInspection(id==='earth-section-01');scene.updateMatrixWorld(true)
  for(const [width,height] of [[604,871],[1440,900],[390,844]]) {
    const camera=new THREE.PerspectiveCamera(40,width/height,.5,1600),frame=frameSceneEntity(camera,object,entity,width,height)
    camera.near=frame.nearPlane;camera.position.copy(frame.position);camera.lookAt(frame.target);camera.setViewOffset(width,height,frame.offsetX,frame.offsetY,width,height);camera.updateMatrixWorld(true)
    assert.ok(Number.isFinite(frame.position.length())&&frame.position.distanceTo(frame.target)>=frame.minDistance)
    const box=entity.facility?protectionInspectionBounds(object,entity.facility):new THREE.Box3().setFromObject(object,true)
    for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
      const p=new THREE.Vector3(x,y,z).project(camera),sx=(p.x+1)*width/2,sy=(1-p.y)*height/2
      assert.ok(sx>=20&&sx<=width-20&&sy>=85&&sy<=height-(width<500?275:225),id+' intersects UI or viewport edge')
    }
    cameraChecks.push({id,width,height,distance:frame.position.distanceTo(frame.target)})
    if(width!==604)continue
    let picked=false
    object.traverse(node=>{
      if(picked||!(node instanceof THREE.Mesh))return
      for(let parent=node;parent;parent=parent.parent)if(!parent.visible)return
      const geometry=node.geometry,position=geometry.attributes.position,index=geometry.index
      for(let i=0;i<(index?.count??position.count)-2&&!picked;i+=Math.max(3,Math.floor((index?.count??position.count)/120/3)*3)) {
        const center=new THREE.Vector3()
        for(let k=0;k<3;k++)center.add(new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i+k):i+k))
        center.divideScalar(3).applyMatrix4(node.matrixWorld).project(camera)
        if(Math.abs(center.x)>1||Math.abs(center.y)>1)continue
        if(interaction.pick(new THREE.Vector2(center.x,center.y),camera)?.id===id)picked=true
      }
    })
    assert.ok(picked,'Cannot raycast visible surface: '+id);picks.push(id)
    assert.equal(interaction.select(id)?.id,id)
    assert.equal(scene.getObjectByName('power-selection-outline'),undefined)
    interaction.setLayers({...DEFAULT_LAYERS,[entity.layer]:false});assert.equal(interaction.selected,null);assert.equal(interaction.select(id),null)
    interaction.setLayers(DEFAULT_LAYERS)
  }
}
const start={x:100,y:100,time:0,travel:0,pointerId:1},end={x:101,y:101,time:180,pointerId:1,button:0}
roof(false);interaction.setLayers({...DEFAULT_LAYERS,buildings:false});interaction.setLayers(DEFAULT_LAYERS)
assert.equal(interaction.object('spd-lv-01').visible,true,'Layer restore must preserve indoor inspection visibility')
roof(true);assert.equal(interaction.object('spd-lv-01').visible,false)
assert.equal(isSelectionClick(start,end),true)
assert.equal(isSelectionClick({...start,travel:30},end),false,'Out-and-back drag cannot select')
assert.equal(isSelectionClick(start,{...end,button:2}),false,'Pan cannot select')
assert.equal(isSelectionClick(start,{...end,pointerId:2}),false,'Other touch cannot select')
assert.equal(isSelectionClick(start,{...end,time:900}),false,'Long gesture cannot select')
interaction.clearSelection();assert.equal(interaction.selected,null)
interaction.dispose();protection.dispose()
const result={result:'PASS',protectedModelAndBlenderFilesUnchanged:baseline.length,registeredEntities:entityCount,raycastEntities:picks,cameraChecks,checks:{semanticRegistry:true,softHighlight:true,layerSelectionCleared:true,nestedVisibilityPreserved:true,dragPanTouchRejected:true,noNewModels:true}}
writeFileSync(new URL('tmp/mine-interaction-validation.json',root),JSON.stringify(result,null,2));console.log(JSON.stringify(result))
