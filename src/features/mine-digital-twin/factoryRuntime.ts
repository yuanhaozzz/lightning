import * as THREE from 'three'
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import bindingsJSON from '../../../public/models/mine-factory-animation.bindings.json'
import { createFactorySimulation, type FactoryBindings } from './factorySimulation'

export const FACTORY_BINDINGS=bindingsJSON as unknown as FactoryBindings
export async function createFactoryRuntime(root:THREE.Group,loader:GLTFLoader){
  const simulation=createFactorySimulation(FACTORY_BINDINGS),bindings=FACTORY_BINDINGS
  const layer=root.getObjectByName('mine-layer-buildings')??root
  const loaded=await Promise.all(['mine-hoist-container.glb','mine-coal-material.glb','mine-power-indicators.glb'].map(p=>loader.loadAsync(`${import.meta.env.BASE_URL}models/${p}`)))
  const container=loaded[0]!.scene,prototype=loaded[1]!.scene,indicator=loaded[2]!.scene
  const room=root.getObjectByName('distribution-01')!
  layer.add(container,prototype);room.add(indicator);prototype.visible=false
  container.userData.factoryEntityId='hoist-house-01'
  container.position.set(...bindings.hoist.containerAnchor as [number,number,number]);container.position.y=bindings.hoist.lowBottom
  root.updateMatrixWorld(true)
  const nodes=new Map<string,THREE.Object3D>()
  root.traverse(o=>{if(typeof o.userData.animationId==='string')nodes.set(o.userData.animationId,o)})
  nodes.get('hoist-container')!.userData.motionEnvelopeY=[bindings.hoist.lowBottom,bindings.hoist.highBottom+bindings.hoist.containerHeight]
  const sheave=root.getObjectByName('Headframe_sheave')
  if(!sheave||!nodes.has('hoist-drum')||!nodes.has('hoist-guide-1')||!nodes.has('hoist-guide-2'))throw new Error('缺少提升系统活动节点，禁止启动')
  const originalQuaternion=new Map<THREE.Object3D,THREE.Quaternion>()
  for(const o of [sheave,...nodes.values()])originalQuaternion.set(o,o.quaternion.clone())
  const hiddenRope=nodes.get('hoist-rope-container-original')!;hiddenRope.visible=false
  const ropeMaterial=new THREE.MeshStandardMaterial({color:'#434846',roughness:.72,metalness:.4})
  const ropeGeometry=new THREE.CylinderGeometry(.022,.022,1,8)
  const rope=new THREE.Mesh(ropeGeometry,ropeMaterial);rope.name='hoist-container-moving-rope';rope.userData.factoryEntityId='hoist-house-01';rope.raycast=()=>{}
  layer.add(rope)
  // Real guides restrain the finite inspection skip; rooted on the existing collar.
  const guideGeometry=new THREE.BoxGeometry(.035,3.45,.065),guideMaterial=new THREE.MeshStandardMaterial({color:'#596764',metalness:.7,roughness:.5})
  const guides=new THREE.Group();guides.name='hoist-inspection-guides'
  for(const sign of [-1,1]){const g=new THREE.Mesh(guideGeometry,guideMaterial);g.position.set(bindings.hoist.containerAnchor[0]!+sign*.58,1.82,-6);guides.add(g)}
  guides.userData.factoryEntityId='hoist-house-01';layer.add(guides)
  const ownedMaterials=new Set<THREE.Material>(),ownedGeometry=new Set<THREE.BufferGeometry>(),restores:(()=>void)[]=[]
  const travelUniforms=new Map<string,{value:number}>()
  const baseCompile=new Map<THREE.Material,{compile:THREE.Material['onBeforeCompile'];key:THREE.Material['customProgramCacheKey']}>()
  for(const c of bindings.conveyors){
    const uniform={value:0};travelUniforms.set(c.id,uniform)
    for(const role of ['belt','return-belt']){
      const node=nodes.get(c.id+'/'+role);if(!node)throw new Error('缺少独立带面：'+c.id)
      node.traverse(o=>{if(!(o instanceof THREE.Mesh))return
        const source=o.material as THREE.MeshStandardMaterial,material=source.clone();ownedMaterials.add(material)
        baseCompile.set(material,{compile:source.onBeforeCompile,key:source.customProgramCacheKey})
        material.onBeforeCompile=shader=>{
          shader.uniforms.uBeltTravel=uniform
          shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vBeltMeters;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBeltMeters=uv;')
          shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vBeltMeters;uniform float uBeltTravel;')
            .replace('#include <color_fragment>',`#include <color_fragment>
              float seam=1.0-smoothstep(.018,.045,abs(fract((vBeltMeters.x-uBeltTravel)/2.4)-.5));
              float grain=.5+.5*sin((vBeltMeters.x-uBeltTravel)*31.0+vBeltMeters.y*7.0);
              diffuseColor.rgb*=.86+.20*grain;diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.055,.06,.052),seam*.55);`)
        }
        material.customProgramCacheKey=()=> 'factory-belt-arclength-v1'
        o.material=material;restores.push(()=>{o.material=source})
      })
    }
  }
  // Repeated idlers retain exported pivots/axes but share instanced drawing.
  type Roller={node:THREE.Object3D;base:THREE.Matrix4;pivot:THREE.Vector3;axis:THREE.Vector3;radius:number;sign:number;entity:string;index:number;mesh:THREE.InstancedMesh}
  const rollers:Roller[]=[],buckets=new Map<string,{objects:{node:THREE.Object3D;mesh:THREE.Mesh}[];geometry:THREE.BufferGeometry;material:THREE.Material;entity:string}>()
  for(const node of nodes.values())if(node.userData.animationRole==='idler'){
    const mesh=node.children.find(o=>o instanceof THREE.Mesh) as THREE.Mesh
    const size=mesh.geometry.boundingBox??(mesh.geometry.computeBoundingBox(),mesh.geometry.boundingBox!)
    const extent=size.getSize(new THREE.Vector3()).toArray().map(v=>v.toFixed(4)).join(',')
    const key=node.userData.factoryEntityId+extent
    if(!buckets.has(key))buckets.set(key,{objects:[],geometry:mesh.geometry,material:mesh.material as THREE.Material,entity:node.userData.factoryEntityId})
    buckets.get(key)!.objects.push({node,mesh})
  }
  const instances:THREE.InstancedMesh[]=[]
  for(const bucket of buckets.values()){
    const instance=new THREE.InstancedMesh(bucket.geometry,bucket.material,bucket.objects.length);instance.name='factory-idler-instances';instance.userData.factoryEntityId=bucket.entity
    instance.instanceMatrix.setUsage(THREE.DynamicDrawUsage);instance.castShadow=false;layer.add(instance);instances.push(instance)
    bucket.objects.forEach(({node,mesh},index)=>{
      const base=mesh.matrixWorld.clone();instance.setMatrixAt(index,base)
      rollers.push({node,base,pivot:node.getWorldPosition(new THREE.Vector3()),axis:new THREE.Vector3(...node.userData.animationAxis),radius:node.userData.effectiveRadius,sign:node.userData.rotationSign,entity:bucket.entity,index,mesh:instance})
      node.remove(mesh);restores.push(()=>node.add(mesh))
    });instance.computeBoundingSphere()
  }
  let coalMesh:THREE.Mesh|undefined;prototype.traverse(o=>{if(o instanceof THREE.Mesh&&!coalMesh)coalMesh=o})
  if(!coalMesh)throw new Error('煤料原型为空')
  const coalFlows=new Map<string,THREE.InstancedMesh>()
  for(const c of bindings.conveyors){const mesh=new THREE.InstancedMesh(coalMesh.geometry,coalMesh.material,512);mesh.name=c.id+'/coal-flow';mesh.count=0;mesh.userData.factoryEntityId=c.id;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.boundingSphere=new THREE.Sphere(new THREE.Vector3().fromArray(c.start).add(new THREE.Vector3().fromArray(c.end)).multiplyScalar(.5),c.length/2+2);layer.add(mesh);coalFlows.set(c.id,mesh);instances.push(mesh)}
  const levels=new Map<string,THREE.Mesh>()
  const hoppers=new Map<string,THREE.Mesh>()
  const levelGeometry=new THREE.CylinderGeometry(1,1,1,48),hopperGeometry=new THREE.CylinderGeometry(4.07,.51,2.2,48);ownedGeometry.add(levelGeometry);ownedGeometry.add(hopperGeometry)
  for(const s of bindings.silos){
    const surface=new THREE.Mesh(levelGeometry,coalMesh.material);surface.name=s.id+'/coal-level';surface.userData.factoryEntityId=s.id;surface.position.set(s.position[0]!,0,s.position[2]!);layer.add(surface);levels.set(s.id,surface)
    const geometry=hopperGeometry.clone();ownedGeometry.add(geometry)
    const hopper=new THREE.Mesh(geometry,coalMesh.material);hopper.name=s.id+'/hopper-fill';hopper.userData.factoryEntityId=s.id;hopper.position.set(s.position[0]!,3.15,s.position[2]!);layer.add(hopper);hoppers.set(s.id,hopper)
  }
  // Tiny electrical indicators: update only these surfaces, not cabinet bodies.
  const lamps:THREE.Mesh[]=[];indicator.traverse(o=>{if(o instanceof THREE.Mesh){const parent=o.parent!;o.userData.factoryEntityId=parent.userData.factoryEntityId;o.userData.lampIndex=parent.userData.lampIndex;const old=o.material;const mat=new THREE.MeshBasicMaterial({color:'#303936',toneMapped:false});o.material=mat;ownedMaterials.add(mat);restores.push(()=>{o.material=old});lamps.push(o)}})
  const transformerLampMaterial=new THREE.MeshBasicMaterial({color:'#38433d',toneMapped:false});ownedMaterials.add(transformerLampMaterial)
  const transformerLampGeometry=new THREE.SphereGeometry(.035,8,6);ownedGeometry.add(transformerLampGeometry)
  const transformerLamp=new THREE.Mesh(transformerLampGeometry,transformerLampMaterial);transformerLamp.position.set(3.0,2.6,4.22);transformerLamp.userData.factoryEntityId='power-transformer-01';transformerLamp.userData.lampIndex=0
  root.getObjectByName('substation-01')!.add(transformerLamp);lamps.push(transformerLamp)
  let lastVersion=-1,disposed=false,inspection:string|null=null,lastPose=-1
  const matrix=new THREE.Matrix4(),rotation=new THREE.Matrix4(),translation=new THREE.Matrix4(),point=new THREE.Vector3(),quaternion=new THREE.Quaternion(),scale=new THREE.Vector3()
  const clipped=new Map<THREE.Material,THREE.Plane[]|null>()
  function restoreInspection(){
    for(const node of nodes.values())if(['inspection-cover','inspection-roof'].includes(node.userData.animationRole))node.visible=true
    for(const [m,planes] of clipped)m.clippingPlanes=planes
    clipped.clear();inspection=null
  }
  function inspect(id:string){restoreInspection();inspection=id
    for(const node of nodes.values())if(node.userData.factoryEntityId===id&&['inspection-roof','inspection-cover'].includes(node.userData.animationRole))node.visible=false
    if(id.startsWith('coal-silo')){
      const s=bindings.silos.find(s=>s.id===id)!
      root.getObjectByName(id)?.traverse(o=>{if(o instanceof THREE.Mesh){const list=Array.isArray(o.material)?o.material:[o.material];for(const m of list){clipped.set(m,m.clippingPlanes);m.clippingPlanes=[new THREE.Plane(new THREE.Vector3(0,0,-1),s.position[2]!)];m.needsUpdate=true}}})
    }
    lastPose=-1
  }
  function pose(camera?:THREE.Camera){
    const s=simulation.device('hoist-house-01')!.travel
    for(const [id,radius] of [['headframe-01/sheave',bindings.hoist.sheaveRadius],['hoist-drum',bindings.hoist.drumRadius],['hoist-guide-1',bindings.hoist.guideRadius],['hoist-guide-2',bindings.hoist.guideRadius]] as const){
      const o=id.startsWith('headframe')?sheave!:nodes.get(id)!,sign=id.startsWith('headframe')?1:bindings.hoist.signs[id]!
      o.quaternion.copy(originalQuaternion.get(o)!).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,0,1),s/radius*sign))
    }
    container.position.y=bindings.hoist.lowBottom+s
    const top=container.position.y+bindings.hoist.containerHeight,upper=bindings.hoist.ropePoints[1]![1]!
    rope.position.set(bindings.hoist.containerAnchor[0]!, (top+upper)/2,-6);rope.scale.y=upper-top
    for(const c of bindings.conveyors){
      const d=simulation.device(c.id)!;travelUniforms.get(c.id)!.value=d.travel
      for(const which of ['head','tail']){
        const o=nodes.get(c.id+'/'+which+'-pulley')!;o.quaternion.copy(originalQuaternion.get(o)!).multiply(quaternion.setFromAxisAngle(new THREE.Vector3(...o.userData.animationAxis),d.travel/.26))
      }
      const flow=coalFlows.get(c.id)!,packets=simulation.queues.get(c.id)!,across=new THREE.Vector3(...c.across as [number,number,number]),normal=new THREE.Vector3(...c.normal as [number,number,number])
      let count=0
      const perParcel=camera&&camera.position.distanceTo(new THREE.Vector3().fromArray(c.start).add(new THREE.Vector3().fromArray(c.end)).multiplyScalar(.5))>160?1:3
      for(const p of packets){for(let k=0;k<perParcel&&count<512;k++){
        const distance=Math.min(c.length-.12,Math.max(.12,p.distance+k*.085))
        point.fromArray(c.start).addScaledVector(new THREE.Vector3(...c.direction as [number,number,number]),distance).addScaledVector(across,p.lane+(k-1)*.09)
        const trough=Math.max(0,Math.abs(p.lane+(k-1)*.09)-c.width/6)*.12/(c.width/3)*Math.min(1,distance/1.1,(c.length-distance)/1.1)
        point.addScaledVector(normal,.075+trough)
        quaternion.setFromAxisAngle(normal,(p.serial*1.618+k)*2);scale.setScalar(.9+(p.serial%4)*.09)
        matrix.compose(point,quaternion,scale);flow.setMatrixAt(count++,matrix)
      }}flow.count=count;flow.instanceMatrix.needsUpdate=true
    }
    for(const r of rollers){
      if(camera&&camera.position.distanceTo(r.pivot)>110)continue
      const d=simulation.device(r.entity)!
      rotation.makeRotationAxis(r.axis,d.travel/r.radius*r.sign);translation.makeTranslation(-r.pivot.x,-r.pivot.y,-r.pivot.z)
      matrix.makeTranslation(r.pivot.x,r.pivot.y,r.pivot.z).multiply(rotation).multiply(translation).multiply(r.base)
      r.mesh.setMatrixAt(r.index,matrix);r.mesh.instanceMatrix.needsUpdate=true
    }
    for(const s of bindings.silos){const level=simulation.level(s.id),mesh=levels.get(s.id)!,above=Math.max(0,level.height-4.25)
      mesh.visible=above>.001;mesh.position.y=4.25+above/2;mesh.scale.set(level.radius,Math.max(.001,above),level.radius)
      const hopper=hoppers.get(s.id)!,height=Math.min(2.2,Math.max(.001,level.height-2.05)),radius=Math.min(4.07,level.radius),positions=hopper.geometry.getAttribute('position'),original=hopperGeometry.getAttribute('position')
      hopper.visible=simulation.stocks.find(stock=>stock.id===s.id)!.mass>1e-6
      for(let i=0;i<positions.count;i++){const y=original.getY(i),top=y>0,r=top?radius/4.07:1;positions.setXYZ(i,original.getX(i)*r,y*height/2.2,original.getZ(i)*r)}
      positions.needsUpdate=true;hopper.position.y=2.05+height/2
    }
    if(lastVersion!==simulation.version){
      for(const lamp of lamps){const d=simulation.device(lamp.userData.factoryEntityId);if(!d)continue
        const mat=lamp.material as THREE.MeshBasicMaterial,index=lamp.userData.lampIndex
        const activeIndex=d.status==='running'?0:d.status==='stopped'?1:2
        mat.color.set(index===activeIndex?(d.status==='running'?'#6eac79':d.status==='stopped'?'#bf9551':'#c45f50'):'#303936')
        if(lamp===transformerLamp)mat.color.set(d.status==='running'?'#6eac79':d.status==='fault'?'#c45f50':'#bf9551')
      }lastVersion=simulation.version
    }
  }
  pose()
  return {simulation,inspect,restoreInspection,get inspection(){return inspection},
    animationObject:(id:string)=>nodes.get(id),
    get snapshot(){return simulation.snapshot()},
    get motionDebug(){return {sheaveQuaternion:sheave!.quaternion.toArray(),sheavePivot:sheave!.getWorldPosition(new THREE.Vector3()).toArray(),
      drumQuaternion:nodes.get('hoist-drum')!.quaternion.toArray(),containerBottomY:container.position.y,ropeLengthMeters:rope.scale.y,
      beltTravel:bindings.conveyors.map(c=>({id:c.id,meters:travelUniforms.get(c.id)!.value,coalInstances:coalFlows.get(c.id)!.count})),
      idlers:rollers.length,inspection}},
    get resourceInfo(){return {idlerInstances:rollers.length,idlerDrawCalls:buckets.size,coalDrawCalls:coalFlows.size,maxCoalInstancesPerSegment:512,addedModels:3,finiteHoistStroke:bindings.hoist.highBottom-bindings.hoist.lowBottom}},
    update(dt:number,camera:THREE.Camera,visible:boolean){
      if(disposed)return false
      simulation.update(dt)
      const mechanical=simulation.devices.some(d=>d.status==='running'&&!d.id.startsWith('power-'))
      const changed=lastVersion!==simulation.version||lastPose<0||mechanical
      if(visible&&changed){pose(camera);lastPose=simulation.clock;return true}
      if(!visible)lastPose=-1
      return false
    },
    dispose(){if(disposed)return;disposed=true;restoreInspection();simulation.stopAll()
      for(const [o,q] of originalQuaternion)o.quaternion.copy(q)
      hiddenRope.visible=true;instances.forEach(i=>{i.removeFromParent();i.dispose()});levels.forEach(m=>m.removeFromParent());hoppers.forEach(m=>m.removeFromParent());transformerLamp.removeFromParent()
      restores.forEach(fn=>fn());ownedMaterials.forEach(m=>m.dispose());ownedGeometry.forEach(g=>g.dispose())
      rope.removeFromParent();ropeGeometry.dispose();ropeMaterial.dispose();guides.removeFromParent();guideGeometry.dispose();guideMaterial.dispose()
    },
  }
}
