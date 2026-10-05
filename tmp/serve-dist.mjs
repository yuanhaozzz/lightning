/**
 * 构建产物静态服务器（仅用于本地无头浏览器验证，不参与构建）。
 * 用法：node tmp/serve-dist.mjs [port]
 * 说明：/cesium 与 /china.geojson 由 vite-plugin-static-copy 复制到 dist，无需额外配置。
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const port = Number(process.argv[2] ?? 5199)
const root = new URL('../dist/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '')
  if (path === '/' || path === '\\') path = '/index.html'
  let file = join(root, path)
  try {
    const info = await stat(file)
    if (info.isDirectory()) file = join(file, 'index.html')
  } catch {
    // SPA 回退：未知路径交给前端路由处理
    file = join(root, 'index.html')
  }
  try {
    const body = await readFile(file)
    response.writeHead(200, {
      'content-type': types[extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    response.end(body)
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(`404 ${String(error)}`)
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`static dist server: http://127.0.0.1:${port}/`)
})
