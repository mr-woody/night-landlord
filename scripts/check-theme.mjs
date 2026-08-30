#!/usr/bin/env node
// M2.5 功能点1 质量门：渲染层零硬编码色值（可执行目标 §一 新增红线）。
// ① 白盒渲染层源码 + index.html + 构建产物 bundle.js 内出现 theme.json 色板之外的
//    hex 字面量即 FAIL；② 源码/html 出现裸 rgb()/rgba() 字面量即 FAIL（透明度派生
//    必须走 theme.ts withAlpha）；③ bundle 与源码同步性守卫（重编译结果须与提交一致）。
// 退出码：0=全过；1=存在违规。
import { readFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))

function normalizeHex(raw) {
  let s = raw.replace('#', '').toLowerCase()
  if (s.length === 3 || s.length === 4) s = [...s].map(c => c + c).join('')
  if (s.length === 8) s = s.slice(0, 6) // alpha 通道不参与色相比对
  return s
}
const palette = new Set(Object.values(theme.color).map(normalizeHex))

// 白盒渲染层扫描目标（ts 源码 + 构建产物 + 页面；存在才扫，P2+ 新增文件自动纳入）
const WHITEBOX = 'apps/client-cocos/whitebox'
const targets = ['theme.ts', 'renderer.ts', 'entry.ts', 'state.ts', 'layout.ts', 'bundle.js', 'index.html']
  .map(f => join(WHITEBOX, f))
  .filter(f => existsSync(join(root, f)))

const failures = []
const HEX = /#[0-9a-fA-F]{3,8}\b/g
const RGB = /\brgba?\(\s*\d/g // 仅拦「rgba(数字」字面调用；theme.ts withAlpha 的模板串 `rgba(${...})` 是合法派生入口
for (const rel of targets) {
  const src = readFileSync(join(root, rel), 'utf8')
  const isSourceOrHtml = rel.endsWith('.ts') || rel.endsWith('.html')
  for (const m of src.matchAll(HEX)) {
    if (!palette.has(normalizeHex(m[0]))) failures.push(`${rel}: 非 theme 色值 hex ${m[0]}`)
  }
  if (isSourceOrHtml) {
    for (const m of src.matchAll(RGB)) failures.push(`${rel}: 裸 rgb()/rgba() 字面量（须走 theme.ts withAlpha 派生）`)
  }
}

// bundle 同步性守卫：重编译 entry.ts 与提交的 bundle.js 逐字节比对（防源码/产物漂移）
const bundlePath = join(root, WHITEBOX, 'bundle.js')
if (existsSync(bundlePath)) {
  const tmp = mkdtempSync(join(tmpdir(), 'nl-theme-'))
  const out = join(tmp, 'bundle.js')
  const r = spawnSync('npx', ['esbuild', join(WHITEBOX, 'entry.ts'), '--bundle', `--outfile=${out}`],
    { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) failures.push(`bundle 重编译失败：${(r.stderr || '').split('\n')[0]}`)
  else if (!readFileSync(out).equals(readFileSync(bundlePath))) failures.push('bundle.js 与白盒源码不同步：请重跑 npm run build:whitebox')
  rmSync(tmp, { recursive: true, force: true })
}

if (failures.length) {
  console.error(`check-theme：${failures.length} 项违规`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log(`check-theme：渲染层零硬编码色值（${targets.length} 个文件，色板 ${palette.size} 色，bundle 同步）全部通过`)
