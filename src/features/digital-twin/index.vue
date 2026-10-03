<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as maplibregl from 'maplibre-gl'
import type { Map } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'
import { createThreeDistrictLayer } from './threeDistrictLayer'

maplibregl.setWorkerUrl(workerUrl)
const host = ref<HTMLDivElement>()
const ready = ref(false)
let map: Map | undefined
let animation = 0

let ring: [number, number][] = [
  [106.04,30.04],[106.00,29.91],[106.06,29.78],[106.02,29.63],[106.10,29.51],[106.04,29.36],[106.12,29.23],[106.27,29.16],
  [106.39,29.04],[106.57,29.01],[106.70,29.08],[106.84,29.04],[106.97,29.13],[107.13,29.10],[107.27,29.20],[107.34,29.34],
  [107.45,29.47],[107.40,29.62],[107.48,29.75],[107.43,29.91],[107.51,30.03],[107.40,30.14],[107.25,30.18],[107.13,30.30],
  [106.97,30.29],[106.84,30.42],[106.68,30.39],[106.54,30.45],[106.40,30.35],[106.24,30.33],[106.17,30.18],[106.04,30.04],
]
const fc = (features: any[]) => ({ type: 'FeatureCollection', features } as any)
let region = fc([{ type:'Feature', properties:{}, geometry:{ type:'Polygon', coordinates:[ring] } }])
let outside = fc([{ type:'Feature', properties:{}, geometry:{ type:'Polygon', coordinates:[
  [[-180,-80],[180,-80],[180,80],[-180,80],[-180,-80]], [...ring].reverse(),
] } }])
const rivers = fc([
  { type:'Feature', properties:{level:1}, geometry:{type:'LineString',coordinates:[[106.12,31.10],[106.42,30.92],[106.68,30.70],[106.91,30.42],[107.15,30.18],[107.46,29.96],[107.73,29.67],[108.04,29.42],[108.34,29.18],[108.66,28.89]]}},
  { type:'Feature', properties:{level:2}, geometry:{type:'LineString',coordinates:[[106.54,31.62],[106.80,31.34],[106.96,31.02],[106.91,30.68],[107.15,30.18]]}},
  { type:'Feature', properties:{level:2}, geometry:{type:'LineString',coordinates:[[109.23,31.30],[108.93,31.02],[108.64,30.74],[108.24,30.45],[107.86,30.17],[107.46,29.96]]}},
])
const routeData = fc([{type:'Feature',properties:{},geometry:{type:'LineString',coordinates:[[106.24,29.42],[106.76,29.58],[107.18,29.76],[107.58,29.96],[108.02,30.21],[108.50,30.48],[109.02,30.72]]}}])
const divisions = fc([
  [[106.18,31.30],[106.66,30.96],[107.04,30.37],[106.92,29.78],[106.55,29.24]],
  [[107.03,31.78],[107.32,31.20],[107.52,30.62],[107.48,30.04],[107.82,29.52],[108.05,28.92]],
  [[108.15,31.82],[108.04,31.25],[108.45,30.51],[108.83,29.96],[108.72,29.30]],
  [[109.30,31.44],[108.92,30.94],[109.02,30.25],[109.44,29.68]],
].map((coordinates)=>({type:'Feature',properties:{},geometry:{type:'LineString',coordinates}})))
const stationRows: [string, number, number, number][] = [
  ['嘉陵江水文站',106.55,30.78,0],['双江水库',107.04,30.37,1],['长江监测站',107.52,29.91,0],
  ['乌江水文站',108.17,29.42,0],['龙门水库',108.45,30.51,1],['东岭雨量站',109.02,30.73,0],['临江监测站',106.73,29.55,0],
]
const stations = fc(stationRows.map(([name,lng,lat,focus]) => ({type:'Feature',properties:{name,focus},geometry:{type:'Point',coordinates:[lng,lat]}})))

function line(id:string, source:string, color:string, width:number, opacity:number, blur=0, dash?:number[]) {
  map!.addLayer({id,type:'line',source,paint:{'line-color':color,'line-width':width,'line-opacity':opacity,'line-blur':blur,...(dash?{'line-dasharray':dash}:{})}})
}

function addScene() {
  if (!map || map.getSource('region')) return
  map.addSource('region',{type:'geojson',data:region})
  map.addSource('outside',{type:'geojson',data:outside})
  map.addSource('rivers',{type:'geojson',data:rivers})
  map.addSource('route',{type:'geojson',data:routeData})
  map.addSource('divisions',{type:'geojson',data:divisions})
  map.addSource('stations',{type:'geojson',data:stations})

  map.addLayer({id:'bright-imagery',type:'raster',source:'satellite',paint:{'raster-opacity':.92,'raster-saturation':.14,'raster-contrast':.18,'raster-brightness-min':.08,'raster-brightness-max':1}})
  map.addLayer({id:'outside-mask',type:'fill',source:'outside',paint:{'fill-color':'#010916','fill-opacity':.69}})
  map.addLayer({id:'contact-shadow',type:'line',source:'region',paint:{'line-color':'#000814','line-width':17,'line-opacity':.48,'line-blur':6,'line-translate':[0,9]}})
  map.addLayer(createThreeDistrictLayer(ring))
  line('edge-glow-wide','region','#008dff',12,.14,6)
  line('edge-glow','region','#00cfff',5,.42,2)
  line('edge-core','region','#43dcff',2.2,.98,.15)
  line('edge-highlight','region','#efffff',.75,.92)
  line('division-glow','divisions','#008cff',5,.2,2)
  line('division','divisions','#1aa8ff',1.3,.74)
  line('river-glow','rivers','#00aaff',9,.2,4)
  map.addLayer({id:'river',type:'line',source:'rivers',paint:{'line-color':['match',['get','level'],1,'#32d7ff','#148cff'],'line-width':['match',['get','level'],1,4.2,1.8],'line-opacity':.92}})
  line('route-glow','route','#00eaff',14,.3,5)
  line('route-base','route','#002d4e',8,.95)
  line('route-highlight','route','#ffe45f',3.5,1)
  line('route-flow','route','#eaffff',1.4,.95,0,[1.2,2.2])
  map.addLayer({id:'pulse',type:'circle',source:'stations',filter:['==',['get','focus'],1],paint:{'circle-radius':22,'circle-color':'#00c8ff','circle-opacity':.18,'circle-stroke-color':'#5be8ff','circle-stroke-width':2,'circle-stroke-opacity':.55}})
  map.addLayer({id:'station-ring',type:'circle',source:'stations',paint:{'circle-radius':8,'circle-color':'#06243b','circle-stroke-color':'#edffff','circle-stroke-width':2.5}})
  map.addLayer({id:'station-core',type:'circle',source:'stations',paint:{'circle-radius':3.2,'circle-color':['match',['get','focus'],1,'#ffe16b','#43dbff']}})
  map.addLayer({id:'station-label',type:'symbol',source:'stations',layout:{'text-field':['get','name'],'text-size':13,'text-offset':[0,-1.55],'text-anchor':'bottom','text-allow-overlap':true},paint:{'text-color':'#ecffff','text-halo-color':'#031225','text-halo-width':2}})
  const pulse = (time:number) => {
    if (!map) return
    const wave=(Math.sin(time/520)+1)/2
    map!.setPaintProperty('pulse','circle-radius',17+wave*13)
    map!.setPaintProperty('pulse','circle-opacity',.08+(1-wave)*.24)
    animation=requestAnimationFrame(pulse)
  }
  animation=requestAnimationFrame(pulse)
  ready.value=true
}

onMounted(async () => {
  try {
    const china = await fetch('/china.geojson').then((response) => response.json())
    const feature = china.features.find((item:any) => item.properties?.name === '重庆市')
    const polygons = feature?.geometry?.coordinates ?? []
    const largest = polygons.sort((a:number[][][],b:number[][][]) => (b[0]?.length ?? 0)-(a[0]?.length ?? 0))[0]?.[0]
    if (largest?.length) {
      const stride = Math.max(1, Math.floor(largest.length / 280))
      ring = largest.filter((_point:[number,number],index:number) => index % stride === 0) as [number,number][]
      if (ring[0] && ring.at(-1)?.join() !== ring[0].join()) ring.push([...ring[0]] as [number,number])
      region = fc([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[ring]}}])
      outside = fc([{type:'Feature',properties:{},geometry:{type:'Polygon',coordinates:[[[-180,-80],[180,-80],[180,80],[-180,80],[-180,-80]],[...ring].reverse()]}}])
    }
  } catch (error) { console.warn('[digital-twin] real boundary unavailable, using demo geometry', error) }
  const token=import.meta.env.VITE_TDT_KEY?.trim()
  const tiles=token?[`https://t0.tianditu.gov.cn/img_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=img&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&tk=${token}`]:['https://tile.openstreetmap.org/{z}/{x}/{y}.png']
  map=new maplibregl.Map({container:host.value!,center:[107.85,30.15],zoom:7.65,pitch:42,bearing:-7,attributionControl:false,maxPitch:68,style:{version:8,sources:{satellite:{type:'raster',tiles,tileSize:256,maxzoom:18}},layers:[
    {id:'background',type:'background',paint:{'background-color':'#020916'}},
    {id:'satellite',type:'raster',source:'satellite',paint:{'raster-opacity':.9,'raster-saturation':-.62,'raster-contrast':.15,'raster-brightness-min':.02,'raster-brightness-max':.58}},
  ]}})
  map.addControl(new maplibregl.NavigationControl({showCompass:true}),'bottom-right')
  // style.load does not wait for third-party raster responses, so the complete
  // vector/extrusion scene also works when an imagery service is temporarily offline.
  map.on('styledata',addScene)
})
onBeforeUnmount(()=>{cancelAnimationFrame(animation);map?.remove();map=undefined})
</script>

<template>
  <main class="twin-page">
    <div ref="host" class="map-host"></div><div class="atmosphere"></div>
    <header class="hud-header"><RouterLink class="back" to="/">‹ 返回原页面</RouterLink><div><small>SMART WATER CONSERVANCY · ONE MAP</small><h1>全域水利系统</h1></div><span><i></i>空天地一体化感知</span></header>
    <section class="status-card"><small>水利态势总览 / OVERVIEW</small><strong>雨情 · 水情 · 工情 · 险情</strong><div><span><b>1,286</b> 河流 km</span><span><b>348</b> 监测站点</span></div><footer><i></i> 当前超警事件 <b>12</b> 起</footer></section>
    <aside class="legend"><strong>图层图例</strong><span><i class="river"></i>主要河流</span><span><i class="route"></i>重点巡检线路</span><span><i class="point"></i>监测站点</span></aside>
    <div v-if="!ready" class="loading">正在构建 2.5D 地图场景…</div>
  </main>
</template>

<style scoped>
.twin-page,.map-host,.atmosphere{position:fixed;inset:0}.twin-page{overflow:hidden;background:#020916;color:#eafaff;font-family:"Microsoft YaHei",system-ui,sans-serif}.map-host{z-index:0}.atmosphere{z-index:1;pointer-events:none;background:radial-gradient(circle at 54% 46%,transparent 20%,rgba(1,10,25,.08) 50%,rgba(0,5,17,.76) 100%),linear-gradient(180deg,rgba(2,15,35,.58),transparent 18%,transparent 76%,rgba(0,8,24,.7));box-shadow:inset 0 0 120px #020817}.hud-header{position:fixed;z-index:3;top:0;left:0;right:0;height:104px;display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,rgba(3,18,40,.96),rgba(3,20,44,.55),transparent);border-top:2px solid rgba(42,201,255,.25)}.hud-header:after{content:"";position:absolute;bottom:5px;width:560px;height:2px;background:linear-gradient(90deg,transparent,#20d5ff,white,#20d5ff,transparent);box-shadow:0 0 14px #00bfff}.hud-header h1{margin:2px 0;font-size:28px;letter-spacing:8px;text-shadow:0 0 18px #008bd4}.hud-header small{display:block;text-align:center;color:#56bde0;letter-spacing:4px;font-size:10px}.hud-header>span{position:absolute;right:28px;top:30px;padding:9px 15px;border:1px solid rgba(75,210,255,.25);background:rgba(4,28,55,.72);font-size:12px;color:#8bdfff}.hud-header>span i{display:inline-block;width:7px;height:7px;margin-right:8px;border-radius:50%;background:#31eaff;box-shadow:0 0 10px #31eaff}.back{position:absolute;left:26px;top:27px;color:#9feaff;text-decoration:none;padding:9px 14px;border:1px solid rgba(67,202,255,.32);background:rgba(4,27,55,.72);font-size:13px}.status-card,.legend{position:fixed;z-index:3;background:linear-gradient(135deg,rgba(5,31,60,.9),rgba(2,17,39,.72));border:1px solid rgba(48,189,242,.3);box-shadow:0 15px 50px rgba(0,0,0,.25),inset 3px 0 #20cfff;backdrop-filter:blur(8px)}.status-card{left:28px;top:132px;width:270px;padding:18px 20px}.status-card small{color:#45b9df;font-size:10px;letter-spacing:1px}.status-card>strong{display:block;margin:8px 0 17px;font-size:18px}.status-card div{display:flex;gap:24px;color:#8daec1;font-size:12px}.status-card b{display:block;color:#52dcff;font-size:25px}.legend{left:28px;bottom:34px;width:185px;padding:14px 18px}.legend strong,.legend span{display:block;margin:5px 0;font-size:12px}.legend strong{margin-bottom:10px;color:#64dfff}.legend i{display:inline-block;width:28px;height:3px;margin-right:8px;vertical-align:middle}.legend .river{background:#21c8ff;box-shadow:0 0 7px #00aaff}.legend .route{background:#ffe25b;box-shadow:0 0 6px #00eaff}.legend .point{width:9px;height:9px;border:2px solid white;border-radius:50%;background:#23ccff}.loading{position:fixed;z-index:4;left:50%;top:50%;transform:translate(-50%,-50%);padding:13px 20px;background:rgba(2,17,36,.88);border:1px solid #20cfff;color:#83e8ff}:deep(.maplibregl-ctrl-bottom-right){right:18px;bottom:20px}:deep(.maplibregl-ctrl-group){background:rgba(3,22,45,.84);border:1px solid rgba(68,198,240,.35)}:deep(.maplibregl-ctrl button .maplibregl-ctrl-icon){filter:invert(1) sepia(1) saturate(2) hue-rotate(155deg)}
.status-card footer{margin:15px -20px -18px;padding:10px 20px;border-top:1px solid rgba(45,181,229,.2);color:#8faebf;font-size:11px}.status-card footer i{display:inline-block;width:6px;height:6px;margin-right:7px;border-radius:50%;background:#ffb544;box-shadow:0 0 9px #ff7b32}.status-card footer b{display:inline;font-size:16px;color:#ffbe55}
@media(max-width:700px){.hud-header h1{font-size:20px;letter-spacing:3px}.hud-header small,.hud-header>span{display:none}.status-card{top:112px;left:12px;transform:scale(.88);transform-origin:top left}.legend{left:12px;bottom:18px}.back{left:10px;top:20px;padding:8px}}
</style>
