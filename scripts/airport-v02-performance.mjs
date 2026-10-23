import {chromium} from 'file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import os from 'node:os'
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
const report={date:new Date().toISOString(),url:process.env.AEROTWIN_URL||'http://127.0.0.1:4176/map/aerotwin',browser:await browser.version(),cpu:os.cpus()[0].model,errors:[],samples:[]}
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1})
 page.on('pageerror',e=>report.errors.push(e.message))
 await page.goto(report.url,{waitUntil:'networkidle'})
 await page.waitForFunction(()=>window.__aerotwin?.getTaskSnapshot(),null,{timeout:60000})
 await page.getByRole('button',{name:'保障作业',exact:true}).click()
 await page.getByRole('button',{name:'作业视角',exact:true}).click()
 await page.waitForTimeout(1300)
 await page.getByRole('button',{name:'开始作业',exact:true}).click()
 console.log('1920 moving performance: actual task running')
 while(true){
  const s=await page.evaluate(()=>window.__aerotwin.getSnapshot());report.samples.push(s)
  assert.notEqual(s.task.runState,'error',s.task.error)
  if(s.task.phase==='servicing')break
  await page.waitForTimeout(1000)
 }
 await page.getByRole('button',{name:'暂停',exact:true}).click()
 report.service=await page.evaluate(()=>({scene:window.__aerotwin.getSnapshot(),vehicle:window.__aerotwin.getVehicleInspection()}))
 await page.screenshot({path:'docs/screenshots/v0.2/06-service-stop-1920.png'})
 for(const [name,file]of[['飞机','07-aircraft-1920.png'],['廊桥','08-bridge-1920.png']]){
  await page.getByRole('button',{name,exact:true}).click();await page.waitForTimeout(1400);await page.screenshot({path:`docs/screenshots/v0.2/${file}`})
 }
 report.operation=report.samples.filter(s=>s.task.elapsed>10&&s.sampleFrames>=150).map(s=>({elapsed:s.task.elapsed,fps:s.fps,drawCalls:s.drawCalls,triangles:s.triangles,geometries:s.geometries,textures:s.textures}))
 assert.ok(report.operation.length>5)
 assert.equal(report.errors.length,0)
 report.passed=true
 console.log(JSON.stringify({passed:true,operation:report.operation,service:report.service.vehicle.hitchDistance}))
}catch(e){report.passed=false;report.failure=e.stack;throw e}
finally{await writeFile('docs/airport-v02-performance-1920.json',JSON.stringify(report,null,2));await browser.close()}
