<script setup lang="ts">
import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref } from 'vue'
import type { createFactorySimulation } from './factorySimulation'
import type { DemoSnapshot } from './stormDemo'
import './visualTheme.css'

type FactorySnapshot = ReturnType<ReturnType<typeof createFactorySimulation>['snapshot']>
const props = withDefaults(defineProps<{factory: FactorySnapshot|null; storm:DemoSnapshot; ready:boolean; compact?:boolean; selectedId?:string|null; logoUrl?:string}>(),{compact:false,selectedId:null,logoUrl:''})
const emit = defineEmits<{overview:[];locate:[id:string];factory:[];storm:[];layers:[];find:[];views:[];fullscreen:[]}>()
const paths: Record<string,string> = {
  park:'M3 21V9l5-3v15M8 10l7-4v15M15 11l6-3v13M2 21h20M5 12v2m0 3v1m6-7v2m0 3v2m7-6v2m0 3v1',
  hoist:'M5 22 9 5h6l4 17M7 16h10M8 11h8M9 5V2h6v3M5 22l12-11M19 22 7 11M6 2h12M12 5v17',
  belt:'M2 14 18 6l4 4-16 8-4-4Zm4 4v4m12-10v6M6 13l2 2m3-5 2 2m3-5 2 2',
  power:'m13 2-8 12h6l-1 8 9-13h-6l0-7Z',
  cabinet:'M5 2h14v20H5V2Zm0 7h14M9 5h6m-2 8h3m-3 3h3m-8-4v6',
  shield:'M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Zm-4 10 3 3 5-6',
  warning:'m12 3 10 18H2L12 3Zm0 6v5m0 3v1',
  sensor:'M12 10v12m-4 0h8M8 13a5 5 0 1 1 8 0M5 16a9 9 0 1 1 14 0M12 9v1',
  cloud:'M7 18a5 5 0 1 1 1-10 6 6 0 0 1 11 3 3.5 3.5 0 1 1-1 7H7Z',
  temperature:'M10 4a2 2 0 0 1 4 0v11a4 4 0 1 1-4 0V4Zm2 5v9m6-13h3m-3 4h3',
  drop:'M12 2S5 10 5 15a7 7 0 0 0 14 0c0-5-7-13-7-13Zm-4 13a4 4 0 0 0 4 4',
  wind:'M2 8h13a3 3 0 1 0-3-3M2 12h18a2 2 0 1 1-2 2M2 16h9a3 3 0 1 1-3 3',
  eye:'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
  layers:'m12 2 10 6-10 6L2 8l10-6Zm-10 10 10 6 10-6M2 16l10 6 10-6',
  full:'M3 9V3h6m6 0h6v6m0 6v6h-6m-6 0H3v-6',
  bell:'M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3Zm5 3h4M12 2v2',
  user:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 22v-3a8 8 0 0 1 16 0v3',
  arrow:'m9 5 7 7-7 7',
  gauge:'M3 18a10 10 0 1 1 18 0M5 9l2 1m5-5v2m7 2-2 1M8 20h8m-4-4 4-5',
}
const Icon = defineComponent({props:{name:{type:String,required:true}},setup(p){return()=>h('svg',{viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':1.55,'stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'},[h('path',{d:paths[p.name]??paths.park})])}})
const time = ref(new Date())
let timer: ReturnType<typeof setInterval>|undefined
onMounted(()=>{timer=setInterval(()=>{time.value=new Date()},1000)})
onBeforeUnmount(()=>{if(timer)clearInterval(timer)})
const dateText=computed(()=>time.value.toLocaleDateString('zh-CN').replaceAll('/','.'))
const timeText=computed(()=>time.value.toLocaleTimeString('zh-CN',{hour12:false}))
const activeNav=ref('园区总览'), profile=ref(false), alertsOnly=ref(false)
const tabs=['园区总览','生产运行','安全监测','能源管理','设备运维','应急指挥']
function navigate(tab:string){activeNav.value=tab;profile.value=false
  if(tab==='园区总览')emit('overview')
  else if(tab==='生产运行')emit('factory')
  else if(tab==='安全监测')emit('locate','storm-warning-01')
  else if(tab==='能源管理')emit('locate','substation-01')
  else if(tab==='设备运维')emit('find')
  else emit('storm')
}
const allDevices=computed(()=>{
  const devices=new Map<string,{id:string;name:string;status:string}>()
  for(const d of props.storm.devices)devices.set(d.id,d)
  for(const d of props.factory?.devices??[])devices.set(d.id,d)
  return [...devices.values()]
})
const counts=computed(()=>({total:allDevices.value.length,normal:allDevices.value.filter(d=>d.status==='normal'||d.status==='running').length,stopped:allDevices.value.filter(d=>d.status==='stopped').length,warning:allDevices.value.filter(d=>d.status==='warning').length,fault:allDevices.value.filter(d=>d.status==='fault').length}))
const ringStyle=computed(()=>{const n=Math.max(1,counts.value.total),a=counts.value.normal/n*100,b=a+counts.value.stopped/n*100,c=b+counts.value.warning/n*100;return{background:`conic-gradient(var(--dt-green) 0 ${a}%, var(--dt-muted) ${a}% ${b}%, var(--dt-orange) ${b}% ${c}%, var(--dt-red) ${c}% 100%)`}})
const running=computed(()=>props.factory?.devices.filter(d=>d.status==='running').length??0)
const runningRatio=computed(()=>props.factory?.devices.length?Math.round(running.value/props.factory.devices.length*100):0)
const belts=computed(()=>props.factory?.devices.filter(d=>['shaft-transfer','transfer-silo-1','transfer-silo-2'].includes(d.id))??[])
const beltStatus=computed(()=>belts.value.some(d=>d.status==='fault')?'故障':belts.value.some(d=>d.status==='running')?'运行中':'已停止')
const warnings=computed(()=>allDevices.value.filter(d=>d.status==='warning'||d.status==='fault').map(d=>({...d,time:props.storm.devices.find(e=>e.id===d.id)?.warningAt??null})))
const totalCoal=computed(()=>((props.factory?.stocks.reduce((sum,s)=>sum+s.mass,0)??0)/1000).toFixed(1))
function status(id:string){return allDevices.value.find(d=>d.id===id)?.status??'unavailable'}
function nameOfStatus(s:string){return ({running:'运行中',stopped:'已停止',normal:'正常',warning:'预警',fault:'故障',unavailable:'未就绪'} as Record<string,string>)[s]??s}
const keyDevices=computed(()=>[
  {id:'hoist-house-01',focus:'headframe-01',name:'井架提升系统',icon:'hoist',metric:`设定速度 ${props.factory?.devices.find(d=>d.id==='hoist-house-01')?.speed.toFixed(2)??'—'} m/s`,detail:`行程 ${(props.factory?.hoistStrokeMeters??0).toFixed(2)} m`},
  {id:'shaft-transfer',focus:'shaft-transfer',name:'输煤系统',icon:'belt',metric:`设定带速 ${props.factory?.devices.find(d=>d.id==='shaft-transfer')?.speed.toFixed(2)??'—'} m/s`,detail:`${belts.value.filter(d=>d.status==='running').length} / ${belts.value.length} 段运行`},
  {id:'power-transformer-01',focus:'substation-01',name:'变电站',icon:'power',metric:'主变压器',detail:'状态联动'},
  {id:'power-cabinet-lv-01',focus:'power-cabinet-lv-01',name:'低压配电柜 01',icon:'cabinet',metric:'SPD 独立节点',detail:'可进入内部'},
])
const protections=[{id:'lightning-location-01',name:'闪电定位仪',icon:'sensor'},{id:'storm-warning-01',name:'雷暴预警仪',icon:'cloud'},{id:'spd-lv-01',name:'SPD 浪涌保护器',icon:'shield'},{id:'ground-monitor-01',name:'接地电阻监测仪',icon:'gauge'}]
const destinations=[{name:'园区总览',id:'',icon:'park'},{name:'煤炭运输',id:'transfer-01',icon:'belt'},{name:'井架提升',id:'headframe-01',icon:'hoist'},{name:'配电室',id:'distribution-01',icon:'cabinet'},{name:'变电站',id:'substation-01',icon:'power'},{name:'雷电防护',id:'air-terminal-production',icon:'shield'}]
function focus(id:string){if(id)emit('locate',id==='power-transformer-01'?'substation-01':id);else{activeNav.value='园区总览';emit('overview')}}
</script>

<template>
  <div class="mine-command-shell" :class="{'is-compact':compact}" @keydown.stop>
    <header class="command-header">
      <div class="command-brand">
        <img v-if="logoUrl" :src="logoUrl" alt="平台标志" class="command-logo" />
        <svg v-else class="command-logo" viewBox="0 0 64 48" aria-hidden="true"><defs><linearGradient id="mine-logo-gradient" x2=".7" y2="1"><stop stop-color="#b2efff"/><stop offset="1" stop-color="#1883c9"/></linearGradient></defs><path d="M2 41 18 11l11 15L40 4l22 37H44L34 25l-9 16H2Z" fill="url(#mine-logo-gradient)"/><path d="m12 37 7-13 7 10M34 19l6-10 15 26H44" fill="none" stroke="#bcefff" stroke-width="2"/></svg>
        <div><h1>煤矿地面工业园区数字孪生平台</h1><p>COAL MINE · INDUSTRIAL DIGITAL TWIN</p></div>
      </div>
      <nav class="command-top-nav" aria-label="平台功能导航"><button v-for="tab in tabs" :key="tab" :class="{active:activeNav===tab}" :aria-current="activeNav===tab?'page':undefined" :disabled="!ready" @click="navigate(tab)">{{ tab }}</button></nav>
      <div class="command-header-right"><div class="command-clock"><time>{{ dateText }} <b>{{ timeText }}</b></time><span><Icon name="cloud"/>{{ storm.phase==='warning'?'模拟雷暴预警':'晴 · 18.6°C' }} <i>演示天气</i></span></div>
        <button class="command-round" aria-label="查看模拟告警" :aria-pressed="alertsOnly" @click="alertsOnly=!alertsOnly"><Icon name="bell"/><b v-if="warnings.length" class="command-badge">{{warnings.length}}</b></button>
        <button class="command-round" aria-label="查看演示身份" :aria-expanded="profile" @click="profile=!profile"><Icon name="user"/></button>
        <div v-if="profile" class="command-profile"><strong>演示观察员</strong><span>本地演示模式 · 未连接生产接口</span><button @click="profile=false">收起</button></div>
      </div>
    </header>

    <aside class="command-left" aria-label="园区模拟态势" :inert="compact||undefined">
      <section class="command-card production-card"><header><h2>生产概况</h2><span>模拟运行</span></header>
        <div class="production-primary"><Icon name="park"/><div><span>煤仓模拟库存</span><p>{{totalCoal}}<small>吨</small></p></div><span class="data-source">演示数据</span></div>
        <div class="production-row"><span><Icon name="hoist"/>运行设备</span><strong>{{running}}<small>/ {{factory?.devices.length??0}} 台</small></strong></div>
        <div class="production-row"><span><Icon name="gauge"/>设备运行率</span><strong>{{runningRatio}}<small>%</small></strong></div>
        <div class="command-meter"><i :style="{width:runningRatio+'%'}"></i></div>
        <div class="production-row"><span><Icon name="belt"/>输煤系统</span><b :class="{'text-green':beltStatus==='运行中','text-red':beltStatus==='故障'}">{{beltStatus}}</b></div>
        <footer>按已注册设备统计 · 停止状态不计为故障</footer>
      </section>
      <section class="command-card status-card"><header><h2>园区态势</h2><span>状态同步</span></header>
        <div class="status-chart"><div class="status-ring" :style="ringStyle"><div><strong>{{counts.total}}</strong><span>已注册设备</span></div></div><ul><li><i class="normal"></i>正常 / 运行<strong>{{counts.normal}}</strong></li><li><i class="stopped"></i>停止<strong>{{counts.stopped}}</strong></li><li><i class="warning"></i>预警<strong>{{counts.warning}}</strong></li><li><i class="fault"></i>故障<strong>{{counts.fault}}</strong></li></ul></div>
        <footer>工厂与防雷设施统一状态源 · 演示数据</footer>
      </section>
      <section class="command-card environment-card"><header><h2>环境监测</h2><span>演示数据</span></header>
        <div class="environment-grid"><div><Icon name="temperature"/><span>温度<strong>18.6<small>°C</small></strong></span></div><div><Icon name="drop"/><span>相对湿度<strong>42<small>%</small></strong></span></div><div><Icon name="wind"/><span>风速<strong>2.3<small>m/s</small></strong></span></div><div><Icon name="eye"/><span>能见度<strong>10<small>km</small></strong></span></div></div>
        <footer>固定示意值 · 不代表现场气象观测</footer>
      </section>
    </aside>

    <aside class="command-right" :class="{'show-alerts':alertsOnly}" aria-label="设备与防雷状态" :inert="compact&&!alertsOnly||undefined">
      <section class="command-card devices-card"><header><h2>重点设备状态</h2><button :disabled="!ready" @click="emit('find')">查找设备 <Icon name="arrow"/></button></header>
        <button v-for="device in keyDevices" :key="device.id" class="key-device" :class="{selected:selectedId===device.id}" :disabled="!ready" @click="focus(device.focus)"><div class="device-symbol"><Icon :name="device.icon"/></div><div class="key-device-copy"><div><strong>{{device.name}}</strong><span class="status-pill" :data-status="status(device.id)">{{nameOfStatus(status(device.id))}}</span></div><p>{{device.metric}}</p><small>{{device.detail}}</small></div></button>
        <footer>运行状态与三维设备同步 · 演示数据</footer>
      </section>
      <section class="command-card alerts-card"><header><h2>告警信息</h2><span>{{warnings.length?'当前 '+warnings.length+' 条':'无活动告警'}}</span></header>
        <div v-if="!warnings.length" class="no-alert"><Icon name="shield"/><div><strong>当前无模拟告警</strong><p>设备故障和雷暴预警将显示于此</p></div></div>
        <button v-for="alert in warnings.slice(0,3)" :key="alert.id" class="alert-row" :disabled="!ready" @click="focus(alert.id)"><Icon name="warning"/><span><strong>{{alert.name}}</strong><small>{{nameOfStatus(alert.status)}} · {{alert.time?new Date(alert.time).toLocaleTimeString('zh-CN',{hour12:false}):'人工模拟故障'}}</small></span><Icon name="arrow"/></button>
        <button class="command-text-action" :disabled="!ready" @click="emit('storm')">打开雷暴演示与事件记录 <Icon name="arrow"/></button>
      </section>
      <section class="command-card protection-card"><header><h2>雷电防护态势</h2><span>演示数据</span></header>
        <button v-for="device in protections" :key="device.id" class="protection-row" :disabled="!ready" @click="focus(device.id)"><Icon :name="device.icon"/><span>{{device.name}}</span><b :data-status="status(device.id)"><i></i>{{nameOfStatus(status(device.id))}}</b></button>
      </section>
    </aside>

    <div class="command-context"><span class="context-cross">⌖</span><div><strong>{{compact?'设备空间观察':'山谷矿区 · 园区总览'}}</strong><small>本地三维场景<span>Y ↑ · 米制坐标</span></small></div><span class="context-status"><i></i>{{ready?'场景已就绪':'资源加载中'}}</span></div>
    <nav class="command-bottom" aria-label="园区区域导航"><button v-for="item in destinations" :key="item.name" :disabled="!ready" :class="{active:item.id?selectedId===item.id:!compact&&!selectedId}" @click="focus(item.id)"><Icon :name="item.icon"/><span>{{item.name}}</span></button></nav>
    <div class="command-corner-tools" role="toolbar" aria-label="视图工具"><button :disabled="!ready" aria-label="打开演示视角" title="演示视角" @click="emit('views')"><Icon name="eye"/></button><button aria-label="打开图层控制" title="图层控制" @click="emit('layers')"><Icon name="layers"/></button><button aria-label="切换全屏" title="全屏" @click="emit('fullscreen')"><Icon name="full"/></button></div>
  </div>
</template>
