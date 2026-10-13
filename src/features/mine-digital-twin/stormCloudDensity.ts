export const CLOUD_GRID = { width: 144, height: 64, depth: 104 } as const
const clamp = (value: number) => Math.max(0, Math.min(1, value))
function smooth(a: number, b: number, value: number) {
  const t = clamp((value - a) / (b - a)); return t * t * (3 - 2 * t)
}
function hash(x: number, y: number, z: number) {
  let n = Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791) ^ 17483
  n = Math.imul(n ^ (n >>> 13), 1274126177)
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295
}
function noise(x: number, y: number, z: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z)
  const fx = smooth(0, 1, x - ix), fy = smooth(0, 1, y - iy), fz = smooth(0, 1, z - iz)
  const mix = (a: number, b: number, t: number) => a + (b - a) * t
  return mix(mix(mix(hash(ix, iy, iz), hash(ix + 1, iy, iz), fx),
    mix(hash(ix, iy + 1, iz), hash(ix + 1, iy + 1, iz), fx), fy),
    mix(mix(hash(ix, iy, iz + 1), hash(ix + 1, iy, iz + 1), fx),
      mix(hash(ix, iy + 1, iz + 1), hash(ix + 1, iy + 1, iz + 1), fx), fy), fz)
}
function fbm(x: number, y: number, z: number) {
  return noise(x, y, z) * .57 + noise(x * 2.1 + 17, y * 2.1, z * 2.1) * .29 + noise(x * 4.3, y * 4.3 + 29, z * 4.3) * .14
}
/** Continuous height/footprint fields, not overlapping spherical puffs. */
export function cloudDensity(x: number, y: number, z: number) {
  const broad = noise(x * 4.5 + 9, .4, z * 4.5 + 13)
  const ridge = Math.exp(-((x + .13) ** 2 / .57 + (z - .02) ** 2 / .52))
  const towers = smooth(.28,.72,noise(x * 5.2 + 3, .8, z * 5.6 + 19))
  const top = .28 + ridge * (.18 + .52 * towers) + .06 * (broad - .5)
  const bottom = .07 + .010 * (broad - .5)
  // A broad upper shoulder/anvil surrounds the upward convective column.
  const shoulder = .79 + .12 * smooth(.24, .55, y)
  const radius = Math.sqrt((x / shoulder) ** 2 + (z / (shoulder * .91)) ** 2)
  const footprint = 1 - smooth(.82 + .10 * broad, 1.01 + .08 * broad, radius)
  const detail = fbm(x*15+23,y*18+11,z*15+7)
  const sculptedTop=top + .08*(detail-.5)
  const envelope = footprint * smooth(bottom, bottom + .022, y) * (1 - smooth(sculptedTop - .025, sculptedTop, y))
  if (envelope < .002) return 0
  const turbulence = fbm(x * 10.5 + 23, y * 13.2 + 11, z * 10.5 + 7)
  const eroded = Math.max(0, envelope - .12 - .65 * (1 - turbulence))
  return clamp(eroded * 2.4 * (.45 + .55 * turbulence))
}
export function generateCloudDensity() {
  const { width, height, depth } = CLOUD_GRID
  const data = new Uint8Array(width * height * depth)
  for (let z = 0; z < depth; z++) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data[x + width * (y + height * z)] = Math.round(255 * cloudDensity(x / (width - 1) * 2 - 1, y / (height - 1), z / (depth - 1) * 2 - 1))
  }
  return data
}

/** Bake a bounded light trace once. The renderer needs one RG sample per ray step. */
export function bakeCloudLighting(data: Uint8Array) {
  const { width, height, depth } = CLOUD_GRID
  const field = new Uint8Array(data.length * 2)
  for (let z=0; z<depth; z++) for (let y=0; y<height; y++) for (let x=0; x<width; x++) {
    const index=x+width*(y+height*z)
    field[index*2]=data[index]!
    if (!data[index]) { field[index*2+1]=255; continue }
    let optical=0
    for (let step=1; step<=8; step++) {
      const sx=x-step*2, sy=y+step*3, sz=z+step
      if(sx<0||sy>=height||sz>=depth)break
      optical+=data[sx+width*(sy+height*sz)]!/255
    }
    const at=(xx:number,yy:number,zz:number)=>data[Math.max(0,Math.min(width-1,xx))+width*(Math.max(0,Math.min(height-1,yy))+height*Math.max(0,Math.min(depth-1,zz)))]!/255
    const dx=at(x-1,y,z)-at(x+1,y,z),dy=at(x,y-1,z)-at(x,y+1,z),dz=at(x,y,z-1)-at(x,y,z+1)
    const length=Math.hypot(dx,dy,dz)
    const facing=length>.01?Math.max(0,(-dx*.5+dy*.8+dz*.3)/length):.5
    field[index*2+1]=Math.round(255*Math.exp(-optical*.35)*(.60+.40*facing))
  }
  const lighting=field.slice()
  for(let z=1;z<depth-1;z++)for(let y=1;y<height-1;y++)for(let x=1;x<width-1;x++){
    const index=x+width*(y+height*z)
    if(!data[index])continue
    field[index*2+1]=Math.round((lighting[index*2+1]!*2+
      lighting[(index-1)*2+1]!+lighting[(index+1)*2+1]!+
      lighting[(index-width)*2+1]!+lighting[(index+width)*2+1]!+
      lighting[(index-width*height)*2+1]!+lighting[(index+width*height)*2+1]!)/8)
  }
  return field
}

/** Occupied column silhouettes avoid framing empty upper corners of the volume box. */
export function densitySilhouette(data: Uint8Array): [number,number,number][] {
  const { width,height,depth }=CLOUD_GRID, points: [number,number,number][]=[]
  for(let z=0;z<depth;z+=5)for(let x=0;x<width;x+=5){
    let first=-1,last=-1
    for(let y=0;y<height;y++)if(data[x+width*(y+height*z)]!>12){if(first<0)first=y;last=y}
    if(first>=0)for(const y of [first,last])points.push([x/(width-1)-.5,y/(height-1)-.5,z/(depth-1)-.5])
  }
  return points
}

/** Crop only empty voxels; retain the full density field and its world mapping. */
export function densityBounds(data:Uint8Array){
  const {width,height,depth}=CLOUD_GRID
  const min:number[]=[width,height,depth],max:number[]=[0,0,0]
  for(let z=0;z<depth;z++)for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    if(data[x+width*(y+height*z)]!<2)continue
    for(const [axis,value] of [x,y,z].entries()){min[axis]=Math.min(min[axis]!,value);max[axis]=Math.max(max[axis]!,value)}
  }
  return {min:min.map((v,i)=>Math.max(-.5,(v-1)/([width,height,depth][i]!-1)-.5)),max:max.map((v,i)=>Math.min(.5,(v+1)/([width,height,depth][i]!-1)-.5))}
}
