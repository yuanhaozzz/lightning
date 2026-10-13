import {Vector2,type WebGLRenderer} from 'three'
/** Bounded asynchronous GPU queries. CPU submission time is never GPU time. */
export function createFactoryPerformance(renderer:WebGLRenderer){
  const gl=renderer.getContext() as WebGL2RenderingContext,ext=gl.getExtension('EXT_disjoint_timer_query_webgl2') as {TIME_ELAPSED_EXT:number;GPU_DISJOINT_EXT:number}|null
  const pending:WebGLQuery[]=[],gpu:number[]=[],frames:{interval:number;cpu:number;update:number}[]=[]
  let current:WebGLQuery|null=null,invalid=false,done=false
  function poll(){if(!ext)return
    if(gl.getParameter(ext.GPU_DISJOINT_EXT)){invalid=true;gpu.length=0;pending.splice(0).forEach(q=>gl.deleteQuery(q));return}
    while(pending.length&&gl.getQueryParameter(pending[0]!,gl.QUERY_RESULT_AVAILABLE)){
      const q=pending.shift()!;gpu.push(Number(gl.getQueryParameter(q,gl.QUERY_RESULT))/1e6);gl.deleteQuery(q)
    }
  }
  return {
    begin(){poll();if(done||!ext||invalid||pending.length>=4||gpu.length>=32)return;current=gl.createQuery();if(current)gl.beginQuery(ext.TIME_ELAPSED_EXT,current)},
    end(){if(current&&ext){gl.endQuery(ext.TIME_ELAPSED_EXT);pending.push(current);current=null}},
    sample(interval:number,cpu:number,update:number){if(done||interval<=0)return null;frames.push({interval,cpu,update});if(frames.length<32)return null
      poll();done=true
      const sorted=(key:'interval'|'cpu'|'update')=>frames.map(f=>f[key]).sort((a,b)=>a-b),intervals=sorted('interval'),cost=sorted('cpu'),pose=sorted('update'),gpuSorted=[...gpu].sort((a,b)=>a-b)
      const size=renderer.getSize(new Vector2()),debug=gl.getExtension('WEBGL_debug_renderer_info')
      return {samples:32,viewport:{width:size.x,height:size.y},pixelRatio:renderer.getPixelRatio(),hardwareRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):'Unavailable',
        frameIntervalMedianMs:intervals[16],frameIntervalP95Ms:intervals[30],observedFPS:1000/intervals[16]!,
        cpuRenderAndLabelsMedianMs:cost[16],cpuFactoryUpdateMedianMs:pose[16],
        gpuMedianMs:gpuSorted.length?gpuSorted[Math.floor(gpuSorted.length/2)]:null,gpuSamples:gpuSorted.length,
        gpuNote:!ext?'Timer extension unavailable':invalid?'Disjoint timing rejected':gpuSorted.length?'Asynchronous elapsed queries':'No completed GPU samples',
        drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,
        note:'Observed foreground/background browser callback rate, not a stable 60 FPS claim; allocation counts are not measured VRAM.'}
    },
    dispose(){if(current&&ext){gl.endQuery(ext.TIME_ELAPSED_EXT);gl.deleteQuery(current)}pending.forEach(q=>gl.deleteQuery(q));pending.length=0},
  }
}
