import type { CloudClock } from './stormCloudState'

const clamp=(value:number)=>Math.max(0,Math.min(1,value))
const smooth=(value:number)=>{const t=clamp(value);return t*t*(3-2*t)}
// Sparse in-cloud illumination only. Event times are demo time, never wall time;
// there are no timers, random frame seeds, new device readings or ground strikes.
export const CLOUD_FLASHES = [
  {at:6.8,position:[.38,.30,.69]},
  {at:14.6,position:[.62,.40,.57]},
  {at:26.4,position:[.46,.32,.73]},
  {at:35.2,position:[.58,.39,.67]},
] as const
export function stormAtmosphereAt(clock:CloudClock){
  const active=clock.runId!==null&&clock.phase==='warning'&&clock.playback!=='idle'
  const seconds=active?Math.max(0,(clock.elapsedMs-5000)/1000):0
  const approach=active?smooth(seconds/Math.max(1,(clock.durationMs-5000)/1000)):0
  let flash=0,flashPosition:[number,number,number]=[.5,.3,.65]
  if(active)for(const event of CLOUD_FLASHES){const age=seconds-event.at
    if(age<0||age>.65)continue
    const pulse=(start:number,decay:number)=>age>=start?smooth((age-start)/.025)*Math.exp(-(age-start)/decay):0
    flash=(pulse(0,.085)+.8*pulse(.19,.12))*(1-smooth((age-.48)/.17))
    flashPosition=[...event.position]
  }
  return {approach,baseLight:active?1-.18*approach+.025*Math.sin(seconds*.55)*Math.sin(seconds*.23):1,
    flash,flashPosition,pulsePhase:active?(seconds%2.6)/2.6:0,active}
}
export type StormAtmosphere=ReturnType<typeof stormAtmosphereAt>
