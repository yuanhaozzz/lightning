import {chromium} from 'file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import {writeFile} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true})
try {
 const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:5176/map/aerotwin'); await page.waitForFunction(()=>window.__aerotwin?.getTaskSnapshot(),{},{timeout:120000});
 await page.getByRole('button',{name:'保障作业',exact:true}).click();await page.getByRole('button',{name:'作业视角',exact:true}).click();await page.waitForTimeout(1500);
 const initial=await page.evaluate(()=>({scene:window.__aerotwin.getSnapshot(),vehicle:window.__aerotwin.getVehicleInspection(),validation:window.__aerotwin.getRouteValidation()}));
 await page.screenshot({path:'tmp/airport-v02-service-idle.png'});
 console.log(JSON.stringify({errors,initial}));
 if(!initial.vehicle.errors.length){await page.getByRole('button',{name:'开始作业',exact:true}).click();await page.waitForTimeout(10000);await page.getByRole('button',{name:'暂停',exact:true}).click();await page.waitForTimeout(200);await page.screenshot({path:'tmp/airport-v02-service-moving.png'});const moving=await page.evaluate(()=>({scene:window.__aerotwin.getSnapshot(),vehicle:window.__aerotwin.getVehicleInspection()}));await writeFile('tmp/airport-v02-smoke.json',JSON.stringify({errors,initial,moving},null,2));console.log(JSON.stringify({moving}));}
}finally{await browser.close()}

