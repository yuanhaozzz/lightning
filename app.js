import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// ★ 关键：把 dist/map 挂到 /map 前缀下
app.use('/map', express.static(path.resolve(__dirname, 'dist/map')))

// 兜底
app.get('*', (req, res) => {
  const html = fs.readFileSync(path.resolve(__dirname, 'dist/map/index.html'), 'utf-8')
  res.type('html').send(html)
})

app.listen(3012, () => {
  console.log('start 3012')
})
