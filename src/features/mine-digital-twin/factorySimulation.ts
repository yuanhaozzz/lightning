export type FactoryStatus = 'running' | 'stopped' | 'fault'
export interface FactoryDevice { id:string; name:string; status:FactoryStatus; speed:number; direction:1|-1; travel:number; fault:string|null }
export interface ConveyorBinding {id:string;start:number[];end:number[];direction:number[];across:number[];normal:number[];length:number;width:number;from:string;to:string}
export interface FactoryBindings {
  hoist:{sheaveRadius:number;drumRadius:number;guideRadius:number;ropePoints:number[][];containerAnchor:number[];containerHeight:number;lowBottom:number;highBottom:number;signs:Record<string,number>}
  conveyors:ConveyorBinding[];silos:{id:string;position:number[];size:number[]}[]
}
export interface CoalParcel {distance:number;mass:number;lane:number;serial:number}
export function createFactorySimulation(bindings:FactoryBindings){
  const devices:FactoryDevice[]=[{id:'hoist-house-01',name:'井架提升系统',speed:.35},
    ...bindings.conveyors.map(c=>({id:c.id,name:c.id==='shaft-transfer'?'井口 → 转载站':c.id.endsWith('1')?'转载站 → 煤仓 1':'转载站 → 煤仓 2',speed:1})),
    ...bindings.silos.map((s,i)=>({id:s.id,name:`煤仓 ${i+1}`,speed:1})),
    {id:'power-transformer-01',name:'变压器',speed:1},
    ...['mv','lv'].flatMap(row=>Array.from({length:6},(_,i)=>({id:`power-cabinet-${row}-${String(i+1).padStart(2,'0')}`,name:`${row==='mv'?'高压':'低压'}柜 ${i+1}`,speed:1})))
  ].map(d=>({...d,status:'stopped',direction:1,travel:0,fault:null})) as FactoryDevice[]
  const byId=new Map(devices.map(d=>[d.id,d])),queues=new Map(bindings.conveyors.map(c=>[c.id,[] as CoalParcel[]]))
  const density=800,hopperVolume=Math.PI*2.2*(4.07**2+4.07*.51+.51**2)/3
  const capacity=(hopperVolume+Math.PI*4.07**2*5.37)*density
  const stocks=bindings.silos.map((s,i)=>({id:s.id,mass:capacity*(i?.42:.28),capacity,initial:capacity*(i?.42:.28),received:0,discharged:0}))
  let accumulator=0,clock=0,phase=0,feedClock=0,serial=0,supplied=0,version=0,receivingHopperKg=40,hoistDeliveredKg=0
  let active=false
  const binding=(id:string)=>bindings.conveyors.find(c=>c.id===id)!
  function faultUpstream(id:string){
    for(const c of bindings.conveyors)if(c.to===id){const d=byId.get(c.id)!;if(d.status==='running'){d.status='stopped';faultUpstream(c.from)}}
  }
  function command(id:string,status:FactoryStatus){
    const d=byId.get(id);if(!d)return
    if(status==='running'&&d.status==='fault')return
    if(status==='running'&&!id.startsWith('power-')&&(byId.get('power-transformer-01')!.status==='fault'||byId.get('power-cabinet-mv-01')!.status==='fault'))return
    d.status=status;d.fault=status==='fault'?'人工模拟故障':null;version++
    if(status!=='running'){
      if(id==='power-transformer-01'||id==='power-cabinet-mv-01')for(const e of devices)if(!e.id.startsWith('power-'))e.status='stopped'
      const feeder:Record<string,string>={'power-cabinet-lv-01':'hoist-house-01','power-cabinet-lv-02':'shaft-transfer','power-cabinet-lv-03':'transfer-silo-1','power-cabinet-lv-04':'transfer-silo-2'}
      if(feeder[id]){byId.get(feeder[id]!)!.status='stopped';faultUpstream(feeder[id]!)}
      faultUpstream(id)
    }
    active=devices.some(d=>d.status==='running')
  }
  function startAll(){for(const d of devices)if(d.status!=='fault')d.status='running';
    for(const d of devices.filter(d=>d.id.startsWith('power-')&&d.status==='fault'))command(d.id,'fault')
    active=devices.some(d=>d.status==='running');version++}
  function stopAll(){for(const d of devices)if(d.status!=='fault')d.status='stopped';active=false;version++}
  function reset(){stopAll();for(const d of devices){d.status='stopped';d.fault=null;d.travel=0;d.direction=1}queues.forEach(q=>q.length=0);stocks.forEach(s=>{s.mass=s.initial;s.received=s.discharged=0});clock=phase=feedClock=accumulator=supplied=serial=hoistDeliveredKg=0;receivingHopperKg=40;version++}
  function step(dt:number){
    clock+=dt
    const hoist=byId.get('hoist-house-01')!,stroke=bindings.hoist.highBottom-bindings.hoist.lowBottom
    const beforeTop=Math.floor((phase+Math.PI)/(Math.PI*2))
    if(hoist.status==='running')phase+=hoist.speed*hoist.direction*dt*2/stroke
    const unloaded=Math.abs(Math.floor((phase+Math.PI)/(Math.PI*2))-beforeTop)*65
    if(unloaded){receivingHopperKg+=unloaded;hoistDeliveredKg+=unloaded;if(receivingHopperKg>200)command(hoist.id,'stopped')}
    hoist.travel=stroke*(1-Math.cos(phase))/2
    for(const c of bindings.conveyors){const d=byId.get(c.id)!;if(d.status==='running')d.travel+=d.speed*d.direction*dt}
    const first=bindings.conveyors[0]!,source=byId.get(first.id)!
    if(source.status==='running'&&source.direction===1){
      feedClock+=dt
      while(feedClock>=.25-1e-9){feedClock-=.25;const mass=Math.min(2.5*source.speed,receivingHopperKg);if(mass>1e-8){receivingHopperKg-=mass;queues.get(first.id)!.push({distance:0,mass,lane:(serial%3-1)*.18,serial:serial++});supplied+=mass}}
    }
    for(const c of bindings.conveyors){
      const d=byId.get(c.id)!,queue=queues.get(c.id)!
      if(d.status!=='running')continue
      for(let i=queue.length-1;i>=0;i--){const p=queue[i]!;p.distance+=d.speed*d.direction*dt
        if(p.distance<0){p.distance=0;command(c.id,'stopped');continue}
        if(p.distance<c.length)continue
        if(c.to==='transfer-01'){
          const options=bindings.conveyors.filter(n=>n.from===c.to&&byId.get(n.id)!.status==='running'&&byId.get(n.id)!.direction===1&&byId.get(n.to)?.status==='running')
          const next=options[p.serial%Math.max(1,options.length)]
          if(!next){p.distance=c.length;command(c.id,'stopped');continue}
          queues.get(next.id)!.push({...p,distance:0});queue.splice(i,1)
        }else{
          const stock=stocks.find(s=>s.id===c.to)!
          if(byId.get(c.to)?.status!=='running'||stock.mass+p.mass>stock.capacity){p.distance=c.length;command(c.id,'stopped');continue}
          stock.mass+=p.mass;stock.received+=p.mass;queue.splice(i,1)
        }
      }
    }
    for(const s of stocks)if(byId.get(s.id)!.status==='running'){
      const amount=Math.min(s.mass,1.5*dt);s.mass-=amount;s.discharged+=amount
    }
  }
  return {devices,queues,stocks,capacity,hopperVolume,density,
    get clock(){return clock},get phase(){return phase},get active(){return active},get version(){return version},
    get balance(){return {supplied,receivingHopperKg,hoistDeliveredKg,initialHopperKg:40,inTransit:[...queues.values()].flat().reduce((s,p)=>s+p.mass,0),received:stocks.reduce((s,p)=>s+p.received,0),discharged:stocks.reduce((s,p)=>s+p.discharged,0)}},
    command,startAll,stopAll,reset,
    recover(id:string){const d=byId.get(id);if(d){d.status='stopped';d.fault=null;version++}},
    setSpeed(id:string,value:number){const d=byId.get(id);if(d&&Number.isFinite(value)){d.speed=Math.max(.05,Math.min(id==='hoist-house-01'?.6:2,value));version++}},
    reverse(id:string){const d=byId.get(id);if(d){d.direction=d.direction===1?-1:1;version++}},
    device:(id:string)=>byId.get(id),
    update(dt:number){if(!Number.isFinite(dt)||dt<=0||!devices.some(d=>d.status==='running'))return false
      accumulator+=dt;let steps=0
      while(accumulator>=.05-1e-9&&steps<2400){step(.05);accumulator-=.05;steps++}
      active=devices.some(d=>d.status==='running');return steps>0},
    level(id:string){const stock=stocks.find(s=>s.id===id)!,volume=stock.mass/density
      if(volume>=hopperVolume)return {height:4.25+(volume-hopperVolume)/(Math.PI*4.07**2),radius:4.07,fraction:stock.mass/capacity}
      let lo=0,hi=2.2
      for(let i=0;i<25;i++){const h=(lo+hi)/2,r=.51+(4.07-.51)*h/2.2,v=Math.PI*h*(r*r+r*.51+.51**2)/3;if(v<volume)lo=h;else hi=h}
      const h=(lo+hi)/2;return {height:2.05+h,radius:.51+(4.07-.51)*h/2.2,fraction:stock.mass/capacity}},
    snapshot(){return {source:'演示数据',devices:devices.map(d=>({...d})),stocks:stocks.map(s=>({...s,level:s.mass/capacity})),hoistStrokeMeters:strokeValue(),clock,balance:this.balance}},
  }
  function strokeValue(){return byId.get('hoist-house-01')!.travel}
}
