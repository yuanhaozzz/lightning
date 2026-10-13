/** Meter-scale, deterministic height field. +Z is the open southern approach;
 * northern and lateral ridges leave a broad industrial valley, not a closed bowl. */
export type ValleyPoint=[number,number]
export const VALLEY_SITE={halfWidth:74,halfDepth:57}
const clamp=(t:number)=>Math.max(0,Math.min(1,t))
const smooth=(a:number,b:number,t:number)=>{const v=clamp((t-a)/(b-a));return v*v*(3-2*v)}
const mix=(a:number,b:number,t:number)=>a+(b-a)*t
const hash=(x:number,z:number)=>{const n=Math.sin(x*127.1+z*311.7)*43758.5453123;return n-Math.floor(n)}
export function valleyNoise(x:number,z:number){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz
  return mix(mix(hash(ix,iz),hash(ix+1,iz),smooth(0,1,fx)),mix(hash(ix,iz+1),hash(ix+1,iz+1),smooth(0,1,fx)),smooth(0,1,fz))}
function fbm(x:number,z:number){return .57*valleyNoise(x,z)+.28*valleyNoise(x*2.13+8.7,z*2.13-4.2)+.15*valleyNoise(x*4.67-3.1,z*4.67+9.6)}
export function siteDistance(x:number,z:number){return Math.hypot(Math.max(0,Math.abs(x)-74),Math.max(0,Math.abs(z)-57))}
export function valleyBaseHeight(x:number,z:number){
  const distance=siteDistance(x,z),skirt=smooth(8,35,distance)
  if(distance<8)return -.07
  const warpX=x+45*(valleyNoise(x*.002-7,z*.002+9)-.5)
  const warpZ=z+65*(valleyNoise(x*.002+3,z*.002-5)-.5)
  const field=fbm(warpX*.0042+4.5,warpZ*.0033-7.1)
  const ridges=1-Math.abs(2*fbm(warpX*.006,warpZ*.0039+5.8)-1)
  const north=smooth(-10,170,-z)
  const openSouth=1-smooth(20,290,z)
  const axis=20+48*Math.sin(z*.0024)+24*Math.sin(z*.0061)
  const sides=smooth(70,280,Math.abs(x-axis))
  const valleyWalls=sides*(.28+.72*north)*openSouth
  const foothills=55*smooth(12,190,distance)*(.35+.65*field)*valleyWalls
  const middle=80*smooth(180,650,distance)*(.3+.7*ridges*ridges)*valleyWalls
  const far=180*smooth(800,2200,distance)*(.25+.75*field)*valleyWalls
  const small=skirt*(.65*(fbm(x*.018,z*.018)-.5)+2*smooth(40,160,distance)*(field-.4))
  const valleyRise=42*smooth(800,2400,-z)*(.7+.3*fbm(x*.0008-2,z*.0008+3))
  return -.07+skirt*(foothills+middle+far+valleyRise)+small
}

// Extend only the existing main and coal gates. Broad bends follow open valley
// corridors; long ends disappear in distance fog rather than terminate nearby.
export const VALLEY_ROAD_CONTROL_POINTS:readonly (readonly ValleyPoint[])[]=[
  [[56,57],[56,76],[57,105],[65,153],[83,215],[101,292],[111,390],[94,520],[57,680],[8,880],[-27,1150],[-48,1530],[-65,2200],[-83,2800]],
  [[-74,22],[-88,22],[-100,16],[-107,-2],[-106,-30],[-100,-60],[-88,-96],[-70,-150],[-47,-260],[-32,-390],[-24,-570],[-14,-810],[2,-1110],[27,-1540],[42,-2400],[58,-3000]],
]
export interface ValleyRoadSample { x:number;z:number;height:number;distance:number }
function roadSamples(points:readonly ValleyPoint[]):ValleyRoadSample[]{
  const result:ValleyRoadSample[]=[]
  for(let i=0;i<points.length-1;i++){
    const p0=points[Math.max(0,i-1)]!,p1=points[i]!,p2=points[i+1]!,p3=points[Math.min(points.length-1,i+2)]!
    const count=Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/8)
    for(let step=0;step<count;step++){const t=step/count
      const coordinate=(axis:0|1)=>.5*(2*p1[axis]+(-p0[axis]+p2[axis])*t+(2*p0[axis]-5*p1[axis]+4*p2[axis]-p3[axis])*t*t+(-p0[axis]+3*p1[axis]-3*p2[axis]+p3[axis])*t*t*t)
      // Keep the first gate section straight and outside the existing site.
      result.push({x:i===0?mix(p1[0],p2[0],t):coordinate(0),z:i===0?mix(p1[1],p2[1],t):coordinate(1),height:0,distance:0})
    }
  }
  const end=points.at(-1)!;result.push({x:end[0],z:end[1],height:0,distance:0})
  let previous=result[0]!;previous.height=-.07
  for(let i=1;i<result.length;i++){const point=result[i]!,length=Math.hypot(point.x-previous.x,point.z-previous.z)
    point.distance=previous.distance+length
    point.height=valleyBaseHeight(point.x,point.z)
    previous=point
  }
  return result
}
export const VALLEY_ROADS=VALLEY_ROAD_CONTROL_POINTS.map(roadSamples)
export function valleyHeight(x:number,z:number){
  return valleyBaseHeight(x,z)
}

/** Angular/radial density decreases with distance. Uniform samples avoid skinny
 * shading fans. Every unequal ring is stitched without gaps. */
export function buildValleySurface(){
  const rings=[0,3,8,14,22,32,44,60,80,100,120,140,160,180,200,225,250,275,300,330,360,390,420,450,480,520,560,600,650,700,760,820,900,1000,1100,1200,1350,1500,1700,1900,2200,2600,3200,4000]
  const positions:number[]=[],indices:number[]=[],ringStarts:number[]=[],ringAngles:number[][]=[]
  const corner=Math.atan2(57,74),tau=Math.PI*2
  for(let r=0;r<rings.length;r++){
    const distance=rings[r]!,resolution=distance<=360?192:distance<=1200?128:64
    const angles=new Set(Array.from({length:resolution},(_,i)=>i*tau/resolution))
    for(const a of [corner,Math.PI-corner,Math.PI+corner,tau-corner])angles.add(a)
    const ordered=[...angles].sort((a,b)=>a-b)
    ringStarts.push(positions.length/3);ringAngles.push(ordered)
    for(const angle of ordered){const c=Math.cos(angle),s=Math.sin(angle),inner=1/Math.max(Math.abs(c)/74,Math.abs(s)/57)
      const x=c*(inner+distance),z=s*(inner+distance);positions.push(x,valleyHeight(x,z),z)}
  }
  for(let r=0;r<rings.length-1;r++){
    const a=ringAngles[r]!,b=ringAngles[r+1]!,startA=ringStarts[r]!,startB=ringStarts[r+1]!
    let i=0,j=0
    while(i<a.length||j<b.length){const nextA=i+1<a.length?a[i+1]!:tau,nextB=j+1<b.length?b[j+1]!:tau
      if(i<a.length&&(j===b.length||nextA<=nextB)){indices.push(startA+i%a.length,startA+(i+1)%a.length,startB+j%b.length);i++}
      else{indices.push(startA+i%a.length,startB+(j+1)%b.length,startB+j%b.length);j++}
    }
  }
  return {positions,indices,rings:ringAngles.map((angles,i)=>({distance:rings[i],samples:angles.length}))}
}
