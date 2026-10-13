<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import type {createFactorySimulation,FactoryStatus} from './factorySimulation'
type Snapshot=ReturnType<ReturnType<typeof createFactorySimulation>['snapshot']>
const props=defineProps<{state:Snapshot;selectedId:string;inspection:string|null}>()
const emit=defineEmits<{command:[command:string,id?:string,value?:number];inspect:[id:string];close:[]}>()
const target=ref('hoist-house-01')
watch(()=>props.selectedId,id=>{if(props.state.devices.some(d=>d.id===id))target.value=id})
const device=computed(()=>props.state.devices.find(d=>d.id===target.value)!)
const names:Record<FactoryStatus,string>={running:'运行',stopped:'停止',fault:'故障'}
const mechanical=computed(()=>device.value.id==='hoist-house-01'||device.value.id==='shaft-transfer'||device.value.id.startsWith('transfer-silo'))
</script>
<template>
 <section class="factory-controls" aria-label="工厂运行演示" @keydown.stop>
  <header><strong>工厂运行演示</strong><small>演示数据</small><button aria-label="收起工厂控制" @click="emit('close')">×</button></header>
  <div class="actions"><button @click="emit('command','start-all')">启动工厂</button><button @click="emit('command','stop-all')">停止工厂</button><button @click="emit('command','reset')">复位演示</button></div>
  <label>设备<select v-model="target" aria-label="工厂设备"><option v-for="d in state.devices" :key="d.id" :value="d.id">{{d.name}}</option></select></label>
  <div class="identity"><code>{{device.id}}</code><span :data-state="device.status">{{names[device.status]}}</span></div>
  <div class="actions"><button :disabled="device.status==='fault'" @click="emit('command','run',device.id)">运行设备</button><button @click="emit('command','stop',device.id)">停止设备</button><button @click="emit('command','fault',device.id)">模拟故障</button><button :disabled="device.status!=='fault'" @click="emit('command','recover',device.id)">故障恢复</button></div>
  <label v-if="mechanical">速度 {{device.speed.toFixed(2)}} m/s<input aria-label="设备运行速度" type="range" :min=".05" :max="device.id==='hoist-house-01'?.6:2" :step=".05" :value="device.speed" @input="emit('command','speed',device.id,Number(($event.target as HTMLInputElement).value))"></label>
  <div class="actions"><button v-if="device.id==='hoist-house-01'" @click="emit('command','reverse',device.id)">反转提升方向</button><button @click="emit('inspect',device.id)">定位并查看机械</button><button v-if="inspection" @click="emit('command','restore-inspection')">恢复检修显隐</button></div>
  <dl><div v-for="stock in state.stocks" :key="stock.id"><dt>{{stock.id==='coal-silo-01'?'煤仓 1':'煤仓 2'}}</dt><dd>{{(stock.mass/1000).toFixed(2)}} t · {{(stock.level*100).toFixed(1)}}%</dd></div></dl>
  <p>有限井口行程与工艺数据为模拟。故障恢复后需重新启动；设备运行与雷暴预警独立。</p>
 </section>
</template>
<style scoped>
.factory-controls{position:absolute;right:24px;top:106px;z-index:3;width:310px;padding:15px;background:#f7faf4ec;border:1px solid #fff9;border-radius:12px;box-shadow:0 5px 22px #304e5012;backdrop-filter:blur(12px);font-size:12px;color:#36524f}
header{display:flex;gap:9px;align-items:center}header small{color:#71897f}header button{margin-left:auto;border:0;background:none;font-size:19px}
button{border:1px solid #c8d6cf;border-radius:6px;background:#f2f7f1;color:#36524f;padding:6px 7px;cursor:pointer;font-size:11px}button:disabled{opacity:.4}
.actions{display:flex;flex-wrap:wrap;gap:5px;margin:10px 0}label{display:grid;gap:6px;margin:12px 0}select{padding:7px;border:1px solid #c8d6cf;border-radius:6px;color:inherit;background:white}input{width:100%;accent-color:#51776e}.identity{display:flex;justify-content:space-between}.identity span[data-state=running]{color:#407950}.identity span[data-state=fault]{color:#b55f51}.identity span[data-state=stopped]{color:#937a47}dl div{display:flex;justify-content:space-between;margin:7px 0}dd{margin:0}p{font-size:10px;color:#79857c;line-height:1.5;margin-bottom:0}
@media(max-width:700px){.factory-controls{right:12px;top:94px;width:min(280px,calc(100vw - 54px));max-height:60vh;overflow:auto}}
</style>
