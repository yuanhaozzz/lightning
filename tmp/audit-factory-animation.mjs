import {readFileSync,writeFileSync,readdirSync} from 'node:fs'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
const relevant=new Set(['mine-headframe.glb','mine-hoist-house.glb','mine-shaft-house.glb','mine-production-links.glb','mine-coal-conveyors.glb','mine-coal-silo-1.glb','mine-coal-silo-2.glb','mine-transfer-station.glb','mine-substation.glb','mine-distribution-shell.glb','mine-distribution-roof.glb','mine-distribution-equipment.glb','mine-spd.glb','mine-spd-cabinet-liner.glb'])
const assets=readdirSync('public/models').filter(f=>relevant.has(f)).map(file=>{
 const data=readFileSync('public/models/'+file);assert.equal(data.readUInt32LE(0),0x46546c67);assert.equal(data.readUInt32LE(8),data.length)
 const g=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)))
 const nodes=(g.nodes??[]).map((n,index)=>({index,name:n.name,mesh:n.mesh,children:n.children??[],translation:n.translation??[0,0,0],rotation:n.rotation??[0,0,0,1],scale:n.scale??[1,1,1],matrix:n.matrix,extras:n.extras??{}}))
 return {file,bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),animations:g.animations?.length??0,nodes,materials:(g.materials??[]).map(m=>m.name),triangles:(g.meshes??[]).flatMap(m=>m.primitives).reduce((sum,p)=>sum+(p.indices===undefined?g.accessors[p.attributes.POSITION].count:g.accessors[p.indices].count)/3,0)}
})
writeFileSync('tmp/mine-factory-animation-node-audit.json',JSON.stringify({scope:'Read-only GLB node and semantic audit; no model modifications',assets},null,2))
console.log(JSON.stringify(assets.map(a=>({file:a.file,bytes:a.bytes,triangles:a.triangles,animations:a.animations,nodes:a.nodes.length,semantic:a.nodes.filter(n=>Object.keys(n.extras).length).map(n=>({name:n.name,extras:n.extras,translation:n.translation,rotation:n.rotation,children:n.children.length})),meshNames:a.nodes.filter(n=>n.mesh!==undefined).map(n=>n.name)})),null,2))
