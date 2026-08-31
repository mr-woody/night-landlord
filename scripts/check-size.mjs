#!/usr/bin/env node
// M4 E2（PR-Q2/K6）：包体积预算门（NFR-7 主包 ≤4MB；逻辑包独立 ≤1MB）。
// ① 白盒 bundle（浏览器演示主载体）≤800KB —— 硬门
// ② 微信构建存在时：输出逻辑包/总包报告。引擎裁剪（7.4MB→分包/CDN）与逻辑包
//    减重属 M3.3/M3.4 里程碑优化（见上线清单 1.3），硬化为 FAIL 前以 WARN 报告。
// 退出码：0=白盒全过；1=白盒超限。
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LOGIC_BUDGET = 1 * 1024 * 1024   // 逻辑包 ≤1MB
const WHITEBOX_BUDGET = 800 * 1024     // 白盒 bundle ≤800KB
const MAIN_BUDGET = 4 * 1024 * 1024    // 微信主包红线 ≤4MB

const failures = []
const warnings = []
function dirSize(dir, skip = new Set()) {
  let sum = 0
  const walk = d => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else if (!skip.has(n)) sum += st.size
    }
  }
  walk(dir)
  return sum
}

// ① 白盒 bundle
const wb = join(root, 'apps/client-cocos/whitebox/bundle.js')
if (existsSync(wb)) {
  const kb = Math.round(statSync(wb).size / 1024)
  if (kb > WHITEBOX_BUDGET / 1024) failures.push(`whitebox/bundle.js ${kb}KB 超 ${WHITEBOX_BUDGET / 1024}KB 预算`)
}

// ② 微信构建（存在时）：按 game.json subpackages 剔除分包后统计主包（≤4MB 硬红线，
//    与 DevTools/80051 上传校验一致）；逻辑包（assets + src + game.js）≤1MB 独立报告。
const wxRoot = join(root, 'apps/client-cocos/creator/build/wechatgame')
if (existsSync(wxRoot)) {
  const gameJsonPath = join(wxRoot, 'game.json')
  const subRoots = existsSync(gameJsonPath)
    ? (JSON.parse(readFileSync(gameJsonPath, 'utf8')).subpackages ?? []).map(s => s.root.replace(/\/+$/, ''))
    : []
  const inSubpackage = rel => subRoots.some(r => rel === r || rel.startsWith(r + '/'))

  let main = 0
  let logic = 0
  let subTotal = 0
  const walk = (d, rel) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n)
      const r = rel ? `${rel}/${n}` : n
      const st = statSync(p)
      if (st.isDirectory()) { walk(p, r); continue }
      if (inSubpackage(r)) { subTotal += st.size; continue }
      main += st.size
      if ((n.endsWith('.js') || n.endsWith('.json')) && !r.startsWith('assets/')) logic += st.size
    }
  }
  walk(wxRoot, '')
  if (existsSync(join(wxRoot, 'assets')) === false) { /* assets 已计入 walk */ }
  const mainKB = Math.round(main / 1024), subKB = Math.round(subTotal / 1024), logicKB = Math.round(logic / 1024)
  console.log(`[report] wechatgame 主包=${mainKB}KB 分包(${subRoots.join(',')})=${subKB}KB 逻辑包=${logicKB}KB`)
  // 分包落地后主包红线硬化为 FAIL（与微信 80051 上传校验一致）
  if (mainKB > 4096) failures.push(`微信主包 ${mainKB}KB 超 4MB 红线（NFR-7/80051）`)
  if (logicKB > 1024) warnings.push(`微信逻辑包 ${logicKB}KB 超 1MB（引擎裁剪排期）`)
}

for (const w of warnings) console.log(`  ⚠ WARN ${w}`)
if (failures.length) {
  console.error(`check-size：${failures.length} 项超限`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log('check-size：包体积预算全过')
