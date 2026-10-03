/**
 * 无头浏览器验证脚本（开发期工具，不参与构建）。
 *
 * 用法：
 *   node tmp/cdp.mjs --url <url> [--shot <png>] [--eval "<js>"] [--wait <ms>] [--width 1920] [--height 1080]
 *
 * 启动一个 headless Chrome，打开页面，收集 console / 异常，执行一段表达式并截图。
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const CHROME = 'C:\\Users\\1\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'

const argv = process.argv.slice(2)
const arg = (name, fallback) => {
  const index = argv.indexOf(`--${name}`)
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback
}

const url = arg('url', 'http://localhost:5180/water-screen')
const shot = arg('shot')
const expression = arg('eval')
const waitMs = Number(arg('wait', '14000'))
const width = Number(arg('width', '1920'))
const height = Number(arg('height', '1080'))
const port = 9400 + (process.pid % 400)

const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--hide-scrollbars',
    `--window-size=${width},${height}`,
    `--user-data-dir=${process.env.TEMP}\\ws-cdp-${port}`,
    '--no-first-run',
    '--disable-extensions',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=angle',
    '--force-device-scale-factor=1',
    `--remote-debugging-port=${port}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
)

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPageTarget() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* 浏览器尚未就绪 */
    }
    await sleep(250)
  }
  throw new Error('未能连接到 Chrome 调试端口')
}

const messages = []
let nextId = 1
const pending = new Map()

function send(socket, method, params = {}) {
  const id = nextId++
  socket.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
}

const target = await findPageTarget()
const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data)
  if (payload.id && pending.has(payload.id)) {
    const { resolve, reject } = pending.get(payload.id)
    pending.delete(payload.id)
    if (payload.error) reject(new Error(JSON.stringify(payload.error)))
    else resolve(payload.result)
    return
  }
  if (payload.method === 'Runtime.consoleAPICalled') {
    const text = (payload.params.args ?? [])
      .map((item) => item.value ?? item.description ?? item.type)
      .join(' ')
    messages.push(`[console.${payload.params.type}] ${text}`)
  }
  if (payload.method === 'Runtime.exceptionThrown') {
    const details = payload.params.exceptionDetails
    messages.push(`[exception] ${details.exception?.description ?? details.text}`)
  }
  if (payload.method === 'Log.entryAdded') {
    const entry = payload.params.entry
    messages.push(`[log.${entry.level}] ${entry.text}`)
  }
})

await send(socket, 'Page.enable')
await send(socket, 'Runtime.enable')
await send(socket, 'Log.enable')
await send(socket, 'Page.navigate', { url })
await sleep(waitMs)

if (expression) {
  try {
    const result = await send(socket, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    console.log('EVAL', JSON.stringify(result.result?.value ?? result.result?.description ?? null, null, 2))
  } catch (error) {
    console.log('EVAL_ERROR', error.message)
  }
}

if (shot) {
  const result = await send(socket, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  mkdirSync(dirname(shot), { recursive: true })
  writeFileSync(shot, Buffer.from(result.data, 'base64'))
  console.log('SHOT', shot)
}

console.log('MESSAGES', messages.length)
for (const message of messages.slice(0, 60)) console.log('  ' + message)

socket.close()
chrome.kill()
process.exit(0)
