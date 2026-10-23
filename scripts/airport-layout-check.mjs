import { chromium } from 'file:///C:/Users/1/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import { mkdir, writeFile } from 'node:fs/promises'
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true })
try {
  const page = await browser.newPage({viewport:{width:1920,height:1080}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto('http://127.0.0.1:5176/map/aerotwin')
  await page.waitForFunction(()=>window.__aerotwin?.getSnapshot().ready,{},{timeout:120000})
  await page.waitForTimeout(1500)
  await mkdir('docs/screenshots/v0.2',{recursive:true})
  await page.screenshot({path:'docs/screenshots/v0.2/01-layout-calibrated-1920.png'})
  const snapshot=await page.evaluate(()=>window.__aerotwin.getSnapshot())
  await writeFile('docs/airport-v02-layout.json',JSON.stringify({date:new Date().toISOString(),errors,snapshot},null,2))
  console.log(JSON.stringify({errors,snapshot}))
} finally { await browser.close() }
