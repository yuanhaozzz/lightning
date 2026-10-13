import * as THREE from 'three'
import { ASSETS, ROADS, SITE, isBuilding } from './layout'
import type { PointXZ } from './layout'

// Explicit service-strip positions, rather than random props scattered over roads.
export const TREES: PointXZ[] = [
  [-58,-43],[-40,-43],[42,-43],[59,-43],
  [-53,45.2],[-40,45.2],[-21,45.2],[1,45.2],[24,45.2],[45,45.2],
  [-62,-16],[-62,9],[62,7],[62,-17],
]
export const LAMPS: PointXZ[] = [[-60,16.6],[-28,16.6],[0,16.6],[30,16.6],[61,16.6],[-63,-44.5],[-28.5,-44.5],[32,-44.5],[63,-44.5],[-58,44.4],[10,44.4],[42,44.4]]
export const GATES = [
  { id: 'main', axis: 'x' as const, fixed: 56, from: 51, to: 61 },
  { id: 'coal', axis: 'z' as const, fixed: -73, from: 17, to: 27 },
]

export const roadRects = ROADS.map((r) => {
  const horizontal = r.from[1] === r.to[1]
  return { ...r, horizontal,
    xmin: horizontal ? Math.min(r.from[0],r.to[0]) : r.from[0]-r.width/2,
    xmax: horizontal ? Math.max(r.from[0],r.to[0]) : r.from[0]+r.width/2,
    zmin: horizontal ? r.from[1]-r.width/2 : Math.min(r.from[1],r.to[1]),
    zmax: horizontal ? r.from[1]+r.width/2 : Math.max(r.from[1],r.to[1]),
  }
})
export function inRoad(x: number,z: number,except = '') {
  return roadRects.some((r) => r.id !== except && x > r.xmin-.001 && x < r.xmax+.001 && z > r.zmin-.001 && z < r.zmax+.001)
}

export function buildSiteEnvironment(root: THREE.Group, concrete: THREE.Material) {
  const group = new THREE.Group()
  group.name = 'industrial-site-environment'
  root.add(group)
  const materials = {
    concrete,
    wall: new THREE.MeshStandardMaterial({color:'#a6ada8',roughness:.94}),
    cap: new THREE.MeshStandardMaterial({color:'#8e9895',roughness:.87}),
    steel: new THREE.MeshStandardMaterial({color:'#657470',metalness:.65,roughness:.48}),
    dark: new THREE.MeshStandardMaterial({color:'#485659',metalness:.5,roughness:.55}),
    paint: new THREE.MeshStandardMaterial({color:'#dfddca',roughness:.88}),
    yellow: new THREE.MeshStandardMaterial({color:'#bfa344',roughness:.7,metalness:.1}),
    bark: new THREE.MeshStandardMaterial({color:'#756b58',roughness:1}),
    foliage: new THREE.MeshStandardMaterial({color:'#657c54',roughness:1}),
    foliageLight: new THREE.MeshStandardMaterial({color:'#7e8d62',roughness:1}),
    soil: new THREE.MeshStandardMaterial({color:'#888c76',roughness:1}),
    lamp: new THREE.MeshStandardMaterial({color:'#d3d8cb',roughness:.5}),
  }
  type Batch = {geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], shadows: boolean}
  const batches = new Map<string,Batch>()
  const cube = new THREE.BoxGeometry(1,1,1)
  const cylinder = new THREE.CylinderGeometry(1,1,1,8)
  const leaf = new THREE.IcosahedronGeometry(1,1)
  const transform = new THREE.Object3D()
  function instance(key: keyof typeof materials, shape: 'box'|'rod'|'leaf', position: number[], size: number[], yaw = 0, shadows = true) {
    const name = `${key}-${shape}`
    if (!batches.has(name)) batches.set(name,{geometry:shape==='box'?cube:shape==='rod'?cylinder:leaf,material:materials[key],matrices:[],shadows:shadows&&key!=='paint'})
    transform.position.set(position[0]!,position[1]!,position[2]!)
    transform.scale.set(size[0]!,size[1]!,size[2]!)
    transform.rotation.set(0,yaw,0)
    transform.updateMatrix()
    batches.get(name)!.matrices.push(transform.matrix.clone())
  }
  function segment(key: keyof typeof materials,a: PointXZ,b: PointXZ,width: number,height: number,y: number,shadows=true) {
    const dx=b[0]-a[0],dz=b[1]-a[1]
    instance(key,'box',[(a[0]+b[0])/2,y,(a[1]+b[1])/2],[width,height,Math.hypot(dx,dz)],Math.atan2(dx,dz),shadows)
  }
  function wall(a: PointXZ,b: PointXZ) {
    const length=Math.hypot(b[0]-a[0],b[1]-a[1])
    segment('wall',a,b,.25,1.65,.87)
    segment('cap',a,b,.33,.12,1.76)
    const count=Math.ceil(length/3.5)
    for(let i=0;i<=count;i++) {
      const t=i/count
      instance('wall','box',[a[0]+(b[0]-a[0])*t,1,a[1]+(b[1]-a[1])*t],[.38,2,.38])
    }
  }
  const x=SITE.width/2-1,z=SITE.depth/2-1
  wall([-x,-z],[x,-z]);wall([x,-z],[x,z])
  wall([-x,-z],[-x,17]);wall([-x,27],[-x,z])
  wall([-x,z],[51,z]);wall([61,z],[x,z])
  for(const gate of GATES) {
    const p=(along:number): PointXZ => gate.axis==='x'?[along,gate.fixed]:[gate.fixed,along]
    for(const along of [gate.from,gate.to]) {
      const pt=p(along)
      instance('concrete','box',[pt[0],.08,pt[1]],[1,.16,1])
      instance('cap','box',[pt[0],1.35,pt[1]],[.58,2.7,.58])
      instance('lamp','box',[pt[0],2.78,pt[1]],[.66,.12,.66])
    }
    // Sliding gate stays retracted along the wall; no arch blocks truck height.
    for(const [a,b] of [[gate.from-4.4,gate.from-.7],[gate.to+.7,gate.to+4.4]]) {
      segment('steel',p(a!),p(b!),.12,1.65,1.1)
      for(let t=a!;t<=b!;t+=.34) {
        const pt=p(t)
        instance('cap','box',[pt[0],1.13,pt[1]],[.055,1.8,.055])
      }
    }
    if(gate.id==='main') {
      for(const gx of [51.7,60.3]) {
        instance('yellow','box',[gx,.53,54.6],[.30,.9,.32])
        instance('paint','box',[gx,2.4,54.6],[.055,3,.07]) // raised barrier
      }
      for(let i=0;i<6;i++) segment('paint',[52.7,53+i*.24],[59.3,53+i*.24],.1,.008,.093,false)
    }
  }
  // Curbs and edge lines follow exposed longitudinal edges of the road union.
  // Other road rectangles cut openings at junctions and building access points.
  const emitted=new Set<string>()
  for(const r of roadRects.filter((r)=>r.kind!=='walkway')) {
    const lo=r.horizontal?r.xmin:r.zmin,hi=r.horizontal?r.xmax:r.zmax
    const cuts=[lo,hi,...roadRects.flatMap((v)=>r.horizontal?[v.xmin,v.xmax]:[v.zmin,v.zmax])].filter((v)=>v>=lo&&v<=hi)
    const sorted=[...new Set(cuts)].sort((a,b)=>a-b)
    for(const side of [-1,1]) {
      const edge=(r.horizontal?r.from[1]:r.from[0])+side*r.width/2
      for(let i=0;i<sorted.length-1;i++) {
        const a=sorted[i]!,b=sorted[i+1]!,mid=(a+b)/2
        if (!r.horizontal && r.id==='hoist-access' && mid<4.5) continue // open paved maintenance forecourt
        const outside=r.horizontal?[mid,edge+side*.04]:[edge+side*.04,mid]
        if(inRoad(outside[0]!,outside[1]!,r.id))continue
        const key=[r.horizontal,a,b,edge].join(',')
        if(emitted.has(key))continue
        emitted.add(key)
        const p=(t:number,offset:number):PointXZ=>r.horizontal?[t,edge+side*offset]:[edge+side*offset,t]
        segment('cap',p(a,.07),p(b,.07),.12,.11,.135)
        segment('paint',p(a,-.20),p(b,-.20),.085,.006,.087,false)
      }
    }
    if(r.kind==='main') {
      for(let t=lo+2;t+2.7<hi-1;t+=6) {
        const middle=t+1.35
        const pt=r.horizontal?[middle,r.from[1]]:[r.from[0],middle]
        const crossing=roadRects.some((v)=>v.horizontal!==r.horizontal&&pt[0]!>v.xmin-1&&pt[0]!<v.xmax+1&&pt[1]!>v.zmin-1&&pt[1]!<v.zmax+1)
        if(crossing)continue
        const a:PointXZ=r.horizontal?[t,r.from[1]]:[r.from[0],t]
        const b:PointXZ=r.horizontal?[t+2.7,r.from[1]]:[r.from[0],t+2.7]
        segment('paint',a,b,.12,.006,.087,false)
      }
    }
  }
  instance('concrete','box',[14,.065,2.25],[20,.10,4.5])
  // Aprons give the remaining massing blocks contact with the site, without
  // adding architectural detail or changing their positions or dimensions.
  for(const asset of ASSETS.filter(isBuilding)) {
    if(['headframe','shaft-house','hoist-house'].includes(asset.type))continue
    const [w,,d]=asset.size,[ax,,az]=asset.position
    for(const sign of [-1,1]) {
      instance('concrete','box',[ax+sign*(w/2+.45),.06,az],[.9,.09,d+1.8])
      instance('concrete','box',[ax,.06,az+sign*(d/2+.45)],[w,.09,.9])
    }
  }
  for(const asset of ASSETS.filter((a)=>a.type.endsWith('-reserve')&&a.type!=='spd-reserve')) {
    instance('concrete','box',[asset.position[0],.015,asset.position[2]],[asset.size[0]+.8,.07,asset.size[2]+.8])
  }
  // Power precinct isolation has openings aligned with both service branches.
  const fenceLines: [PointXZ,PointXZ][] = [
    [[41.6,-38.5],[64.5,-38.5]],[[64.5,-38.5],[64.5,-3.9]],[[64.5,-3.9],[41.6,-3.9]],
    [[41.6,-38.5],[41.6,-28.5]],[[41.6,-23.5],[41.6,-12.5]],[[41.6,-7.5],[41.6,-3.9]],
  ]
  const wire:number[]=[]
  for(const [a,b] of fenceLines) {
    for(const y of [.22,1.25])segment('steel',a,b,.025,.04,y)
    const length=Math.hypot(b[0]-a[0],b[1]-a[1]),count=Math.ceil(length/2.4)
    for(let i=0;i<=count;i++) {
      const t=i/count
      instance('steel','box',[a[0]+(b[0]-a[0])*t,.67,a[1]+(b[1]-a[1])*t],[.055,1.35,.055])
    }
    for(let y=.3;y<1.25;y+=.16)wire.push(a[0],y,a[1],b[0],y,b[1])
    for(let t=0;t<=length;t+=.18) {
      const u=t/length,xx=a[0]+(b[0]-a[0])*u,zz=a[1]+(b[1]-a[1])*u
      wire.push(xx,.25,zz,xx,1.23,zz)
    }
  }
  const fence=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(wire,3)),new THREE.LineBasicMaterial({color:'#7b8981',transparent:true,opacity:.45}))
  fence.name='power-safety-mesh';group.add(fence)
  for(const [tx,tz] of TREES) {
    instance('soil','box',[tx,.035,tz],[.72,.055,.72])
    instance('bark','rod',[tx,1.45,tz],[.12,2.8,.12])
    instance('foliage','leaf',[tx,3.15,tz],[1.12,1.38,1.02])
    instance('foliageLight','leaf',[tx+.36,3.7,tz-.2],[.85,.92,.78])
  }
  for(const [lx,lz] of LAMPS) {
    const direction=lz < -40 ? -1 : 1
    instance('concrete','box',[lx,.12,lz],[.42,.22,.42])
    instance('dark','rod',[lx,3.5,lz],[.06,6.8,.06])
    instance('dark','box',[lx,6.9,lz+direction*.55],[.065,.07,1.1])
    instance('lamp','box',[lx,6.88,lz+direction*1.07],[.28,.12,.55])
  }
  for(const [name,batch] of batches) {
    const instanced=new THREE.InstancedMesh(batch.geometry,batch.material,batch.matrices.length)
    instanced.name=`site-${name}`
    batch.matrices.forEach((matrix,i)=>instanced.setMatrixAt(i,matrix))
    instanced.castShadow=batch.shadows;instanced.receiveShadow=true
    instanced.computeBoundingBox();instanced.computeBoundingSphere()
    group.add(instanced)
  }
  console.info('[mine-digital-twin] environment ready',JSON.stringify({trees:TREES.length,lamps:LAMPS.length,instanceBatches:batches.size,gates:GATES.length,roadBoundarySegments:emitted.size}))
  return group
}
