import * as THREE from 'three'
export type StormView = 'demo' | 'ground' | 'oblique'

/** Frame the park first. The distant storm is background, never a reason to
 * shrink equipment. This composition is fixed for the entire storm trajectory. */
export function frameStormView(source: THREE.PerspectiveCamera, park: THREE.Vector3[], cloud: THREE.Vector3[], width:number,height:number,mode:StormView){
  const camera=source.clone();camera.clearViewOffset();camera.fov=38;camera.aspect=width/height;camera.updateProjectionMatrix()
  if(mode==='ground')return {position:new THREE.Vector3(66,3.2,16),target:new THREE.Vector3(-24,48,-20),fov:54,offsetX:0,offsetY:0}
  const portrait=width/height<1
  const elevation=THREE.MathUtils.degToRad(mode==='oblique'?30:portrait?25:18)
  const azimuth=THREE.MathUtils.degToRad(mode==='oblique'?50:portrait?43:24)
  const direction=new THREE.Vector3(Math.sin(azimuth)*Math.cos(elevation),Math.sin(elevation),Math.cos(azimuth)*Math.cos(elevation))
  const target=new THREE.Vector3(0,12,-3)
  // The wide view includes the cloud at both endpoints. The oblique inspection
  // view deliberately concentrates on buildings, with the canopy as background.
  const all=mode==='oblique'?park:[...park,...cloud]
  const top=mode==='oblique'?(portrait?160:190):50,bottom=width<500?155:95,pad=width<500?15:48
  const availableW=width-pad*2,availableH=Math.max(100,height-top-bottom)
  function bounds(distance:number){
    camera.position.copy(target).addScaledVector(direction,distance);camera.lookAt(target);camera.updateMatrixWorld(true)
    const screen=all.map(p=>p.clone().project(camera))
    const x=screen.map(p=>(p.x+1)*width/2),y=screen.map(p=>(1-p.y)*height/2)
    return {left:Math.min(...x),right:Math.max(...x),top:Math.min(...y),bottom:Math.max(...y)}
  }
  let low=180,high=1600
  for(let i=0;i<32;i++){const mid=(low+high)/2,b=bounds(mid)
    if(b.right-b.left>availableW||b.bottom-b.top>availableH)low=mid;else high=mid}
  const b=bounds(high*1.025)
  return {position:camera.position.clone(),target,fov:38,
    offsetX:(b.left+b.right)/2-width/2,offsetY:(b.top+b.bottom)/2-(top+availableH/2)}
}
