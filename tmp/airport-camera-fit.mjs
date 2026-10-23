import{readFile}from'node:fs/promises';import ts from'typescript';import{PerspectiveCamera,Vector3}from'three';
const url=s=>`data:text/javascript;base64,${Buffer.from(s).toString('base64')}`;const o={compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}};
const cfg=url(ts.transpileModule(await readFile('src/config/airportTask.ts','utf8'),o).outputText);
const src=ts.transpileModule(await readFile('src/three/airport/simulation.ts','utf8'),o).outputText;
const{createAirportSimulation,vehicleFootprints}=await import(url(src.replaceAll('../../config/airportTask',cfg)));
const s=createAirportSimulation();s.start();const pts=[];
while(s.getSnapshot().phase!=='completed'){s.update(1/30);for(const f of vehicleFootprints(s.getSnapshot()))for(const p of f.polygon){pts.push([p.x,0,p.z],[p.x,2.4,p.z]);}}
pts.push([-1.675,3.06,8.6]);
for(const a of [[-44,28,44,-14,2,16],[-60,35,38,-15,1.5,19],[-60,40,20,-15,1.5,20],[-55,36,20,-15,1.5,20],[-60,38,28,-15,1.5,20]]){const c=new PerspectiveCamera(36,1366/704,.15,1200);c.position.set(...a.slice(0,3));c.lookAt(...a.slice(3));c.updateMatrixWorld();let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;for(const p of pts){const v=new Vector3(...p).project(c);minX=Math.min(minX,v.x);minY=Math.min(minY,v.y);maxX=Math.max(maxX,v.x);maxY=Math.max(maxY,v.y)}console.log(a,{minX,minY,maxX,maxY});}
