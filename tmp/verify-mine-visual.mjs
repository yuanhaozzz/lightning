import assert from 'node:assert/strict'
import {readFileSync,writeFileSync} from 'node:fs'
import {pathToFileURL} from 'node:url'
import ts from 'typescript'
import * as THREE from 'three'
const base = 'F:/code/lightning/'
const threeURL = pathToFileURL(base+'node_modules/three/build/three.module.js').href
function moduleURL(file, dependencies = {}) {
  let code = ts.transpileModule(readFileSync(base+file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText
  for (const [key,value] of Object.entries({'three':threeURL,...dependencies})) code=code.replaceAll(`from '${key}'`,`from '${value}'`)
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
}
const layoutURL=moduleURL('src/features/mine-digital-twin/layout.ts')
const {ASSETS,SITE,isBuilding}=await import(layoutURL)
const {buildSiteEnvironment,TREES,LAMPS,inRoad}=await import(moduleURL('src/features/mine-digital-twin/siteEnvironment.ts',{'./layout':layoutURL}))
const {frameOverview}=await import(moduleURL('src/features/mine-digital-twin/overviewCamera.ts'))
const root=new THREE.Group()
const environment=buildSiteEnvironment(root,new THREE.MeshStandardMaterial())
for(const [x,z] of [...TREES,...LAMPS]) {
  assert.ok(!inRoad(x,z),`Prop inside road: ${x},${z}`)
  assert.ok(!ASSETS.filter(isBuilding).some(a=>Math.abs(x-a.position[0])<a.size[0]/2+.4&&Math.abs(z-a.position[2])<a.size[2]/2+.4),`Prop inside building: ${x},${z}`)
}
const bounds=new THREE.Box3().setFromObject(environment)
assert.ok(bounds.min.x>=-SITE.width/2&&bounds.max.x<=SITE.width/2&&bounds.min.z>=-SITE.depth/2&&bounds.max.z<=SITE.depth/2,'Environment outside site')
const points=[...[-76,76].flatMap(x=>[-59,59].map(z=>new THREE.Vector3(x,0,z))),...ASSETS.filter(isBuilding).flatMap(a=>[-1,1].flatMap(sx=>[-1,1].flatMap(sz=>[0,1].map(sy=>new THREE.Vector3(a.position[0]+sx*a.size[0]/2,a.position[1]+sy*a.size[1],a.position[2]+sz*a.size[2]/2)))))]
const viewports=[]
for(const [width,height] of [[1280,720],[1366,768],[1920,1080],[604,871],[390,844]]) {
 const camera=new THREE.PerspectiveCamera(40,width/height,.5,1600)
 const config=frameOverview(camera,points,width,height)
 camera.updateMatrixWorld(true)
 const projected=points.map(p=>p.clone().project(camera))
 const xs=projected.map(p=>(p.x+1)*width/2),ys=projected.map(p=>(1-p.y)*height/2)
 const rect={left:Math.min(...xs),right:Math.max(...xs),top:Math.min(...ys),bottom:Math.max(...ys)}
 assert.ok(rect.left>=22&&rect.right<=width-22&&rect.top>=(width<500?132:88)&&rect.bottom<=height-40,`Clipped overview ${width}x${height}`)
 viewports.push({width,height,elevation:config.elevation,distance:config.distance,rect})
}
const report={result:'PASS',trees:TREES.length,lamps:LAMPS.length,environmentBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},propsOutsideRoadsAndBuildings:true,viewports}
writeFileSync(base+'tmp/mine-visual-geometry-check.json',JSON.stringify(report,null,2))
console.log(JSON.stringify(report,null,2))
