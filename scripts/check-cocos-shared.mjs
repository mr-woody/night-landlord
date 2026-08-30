#!/usr/bin/env node
// 门③前置自检：对同步产物 apps/client-cocos/assets/scripts/** 做 standalone 严格类型检查
// （无 node types、无引擎依赖），证明 Cocos 编译前的静态正确性。用法：node scripts/check-cocos-shared.mjs
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'apps/client-cocos/assets/scripts')

function listTs(d) {
  const out = []
  for (const n of readdirSync(d)) {
    const p = join(d, n)
    if (statSync(p).isDirectory()) out.push(...listTs(p))
    else if (n.endsWith('.ts')) out.push(p)
  }
  return out
}
const files = listTs(dir)
if (files.length === 0) { console.error('FAIL: 同步产物为空，先运行 npm run sync:cocos'); process.exit(1) }

const r = spawnSync('npx', ['tsc', '--noEmit', '--strict', '--target', 'ES2022', '--module', 'ESNext',
  '--moduleResolution', 'Bundler', '--skipLibCheck', ...files], { cwd: root, encoding: 'utf8' })
if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1) }
console.log(`check-cocos-shared：${files.length} 个同步产物 standalone strict 编译通过（无 node/引擎依赖）`)
