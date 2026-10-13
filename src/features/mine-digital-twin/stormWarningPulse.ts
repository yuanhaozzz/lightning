import * as THREE from 'three'
import type { MonitoringDevice } from './monitoringDevices'
import type { DemoDeviceReading } from './stormDemoData'
import type { StormAtmosphere } from './stormAtmosphereState'

/** A low, narrow ring outside the sensor foundation; no box or body overlay.
 * Separate presentation root prevents the pulse from becoming a pick target. */
export function createStormWarningPulse(scene:THREE.Scene,devices:readonly MonitoringDevice[]){
  const root=new THREE.Group();root.name='demo-warning-pulses'
  const geometry=new THREE.RingGeometry(1.85,2.06,64)
  const material=new THREE.MeshBasicMaterial({color:'#d49b43',transparent:true,opacity:0,
    depthWrite:false,side:THREE.DoubleSide,toneMapped:false})
  for(const device of devices.filter(d=>d.type==='storm-warning')){
    const ring=new THREE.Mesh(geometry,material);ring.name=`demo-pulse-${device.id}`
    ring.userData.deviceId=device.id;ring.position.set(device.position[0],device.position[1]+.018,device.position[2])
    ring.rotation.x=-Math.PI/2;ring.raycast=()=>{};root.add(ring)
  }
  root.visible=false;scene.add(root)
  let previous='',disposed=false
  return {
    resourceInfo:{drawCalls:root.children.length,triangles:geometry.index!.count/3,materials:1,textures:0},
    update(atmosphere:StormAtmosphere,readings:readonly DemoDeviceReading[],layerVisible:boolean){
      if(disposed)return false
      const phase=atmosphere.pulsePhase,opacity=.30*Math.sin(Math.PI*phase)**2
      material.opacity=opacity
      root.visible=atmosphere.active&&layerVisible
      for(const ring of root.children){ring.visible=readings.some(d=>d.id===ring.userData.deviceId&&d.status==='warning')
        ring.scale.setScalar(1+.22*phase)}
      const next=`${root.visible},${opacity},${phase}`
      const changed=next!==previous;previous=next;return changed
    },
    dispose(){if(disposed)return;disposed=true;scene.remove(root);geometry.dispose();material.dispose()},
  }
}
