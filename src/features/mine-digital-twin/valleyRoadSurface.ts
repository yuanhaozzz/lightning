import { VALLEY_ROADS, type ValleyRoadSample } from './valleyTerrain'
type Vertex=[number,number,number]
interface Surface {positions:number[];indices:number[]}

/** Clip road ribbons to the actual terrain faces. Interpolating all three
 * coordinates keeps every road fragment on its supporting triangle, including
 * road cuts, bends and changes in tessellation. No floating flat ribbons. */
export function drapeValleyRoads(surface:Surface){
  const faces:Vertex[][]=[],cells=new Map<string,number[]>(),cellSize=80
  for(let i=0;i<surface.indices.length;i+=3){const face=surface.indices.slice(i,i+3).map(index=>surface.positions.slice(index*3,index*3+3) as Vertex)
    const id=faces.length;faces.push(face)
    const xs=face.map(p=>p[0]),zs=face.map(p=>p[2])
    for(let x=Math.floor(Math.min(...xs)/cellSize);x<=Math.floor(Math.max(...xs)/cellSize);x++)
      for(let z=Math.floor(Math.min(...zs)/cellSize);z<=Math.floor(Math.max(...zs)/cellSize);z++){
        const key=`${x},${z}`;if(!cells.has(key))cells.set(key,[]);cells.get(key)!.push(id)}
  }
  function clip(face:Vertex[],boundary:Vertex[]){let polygon=face
    const area=boundary.reduce((sum,a,i)=>{const b=boundary[(i+1)%boundary.length]!;return sum+a[0]*b[2]-b[0]*a[2]},0)
    const orientation=Math.sign(area)
    for(let i=0;i<boundary.length;i++){
      const a=boundary[i]!,b=boundary[(i+1)%boundary.length]!,dx=b[0]-a[0],dz=b[2]-a[2]
      const distance=(p:Vertex)=>orientation*(dx*(p[2]-a[2])-dz*(p[0]-a[0]))
      const output:Vertex[]=[]
      for(let j=0;j<polygon.length;j++){
        const previous=polygon[(j+polygon.length-1)%polygon.length]!,current=polygon[j]!,d0=distance(previous),d1=distance(current)
        if((d0>=-1e-8)!==(d1>=-1e-8)){const t=d0/(d0-d1)
          output.push(previous.map((v,k)=>v+(current[k]!-v)*t) as Vertex)}
        if(d1>=-1e-8)output.push(current)
      }
      polygon=output;if(polygon.length<3)return []
    }
    return polygon
  }
  const buffers:[number[],number[],number[]]=[[],[],[]]
  function edge(road:ValleyRoadSample[],i:number,width:number):[Vertex,Vertex]{
    const a=road[Math.max(0,i-1)]!,b=road[Math.min(road.length-1,i+1)]!,p=road[i]!,dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz)
    return [[p.x-dz/length*width,0,p.z+dx/length*width],[p.x+dz/length*width,0,p.z-dx/length*width]]
  }
  function strip(road:ValleyRoadSample[],i:number,width:number,buffer:number[],lift:number){
    const [a,b]=edge(road,i,width),[c,d]=edge(road,i+1,width),boundary=[a,c,d,b]
    const xs=boundary.map(p=>p[0]),zs=boundary.map(p=>p[2]),xmin=Math.min(...xs),xmax=Math.max(...xs),zmin=Math.min(...zs),zmax=Math.max(...zs)
    const candidates=new Set<number>()
    for(let x=Math.floor(xmin/cellSize);x<=Math.floor(xmax/cellSize);x++)for(let z=Math.floor(zmin/cellSize);z<=Math.floor(zmax/cellSize);z++)
      for(const id of cells.get(`${x},${z}`)??[])candidates.add(id)
    for(const id of candidates){const polygon=clip(faces[id]!,boundary)
      for(let n=1;n<polygon.length-1;n++)for(const vertex of [polygon[0]!,polygon[n]!,polygon[n+1]!])buffer.push(vertex[0],vertex[1]+lift,vertex[2])}
  }
  for(const road of VALLEY_ROADS)for(let i=0;i<road.length-1;i++){
    strip(road,i,5.6,buffers[0],.022);strip(road,i,3.8,buffers[1],.035)
    if(i%3===0)strip(road,i,.065,buffers[2],.048)
  }
  return buffers
}
