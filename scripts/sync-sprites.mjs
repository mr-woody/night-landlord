#!/usr/bin/env node
// M5 P3-3/C16：AI sprite 同步——docs/assets/ai（管线产物）→ whitebox/assets/ai（页面相对运行时路径）。
// 白盒页无论以仓库根还是 whitebox 目录为静态服务根，'assets/ai/...' 页面相对路径均可达（同 fonts/ 模式）。
// manifest 一并同步；esbuild 构建前执行（package.json build:whitebox）。
import { mkdirSync, copyFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'docs/assets/ai')
const dst = join(root, 'apps/client-cocos/whitebox/assets/ai')
const dirs = ['anchors', 'houses', 'monsters', 'weather', 'vfx', 'fx']

mkdirSync(dst, { recursive: true })
let n = 0
for (const d of dirs) {
  const sd = join(src, d)
  if (!existsSync(sd)) continue
  mkdirSync(join(dst, d), { recursive: true })
  for (const f of readdirSync(sd)) {
    if (!f.endsWith('@2x.png')) continue
    copyFileSync(join(sd, f), join(dst, d, f))
    n++
  }
}
if (existsSync(join(src, 'sprite-manifest.json'))) {
  copyFileSync(join(src, 'sprite-manifest.json'), join(dst, 'sprite-manifest.json'))
} else {
  writeFileSync(join(dst, 'sprite-manifest.json'), JSON.stringify({ version: 1, files: [] }))
}
console.log(`sync-sprites：${n} 个 sprite → apps/client-cocos/whitebox/assets/ai/`)
