import express from 'express'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()

// ★ 关键改动：{ index: false } 让 static 不处理目录索引，避免 301
app.use(express.static(path.resolve(__dirname, 'dist'), { redirect: false }))

// 兜底：所有非静态请求都返回 index.html
app.get('*', (req, res) => {
  const html = fs.readFileSync(path.resolve(__dirname, 'dist/map/index.html'), 'utf-8')
  res.type('html').send(html)
})

app.listen(3012, () => {
  console.log('start 3012')
})
