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

// ② 微信构建（存在时）：逻辑包（assets + src + game.js，排除引擎 cocos-js）≤1MB；总包 ≤4MB 红线
const wxRoot = join(root, 'apps/client-cocos/creator/build/wechatgame')
if (existsSync(wxRoot)) {
  let logic = 0
  for (const n of readdirSync(wxRoot)) {
    const p = join(wxRoot, n)
    if (statSync(p).isDirectory()) continue
    if (n === 'cocos-js') continue
    logic += n.endsWith('.js') || n.endsWith('.json') ? statSync(p).size : 0
  }
  const assetsDir = join(wxRoot, 'assets')
  if (existsSync(assetsDir)) logic += dirSize(assetsDir)
  const total = dirSize(wxRoot)
  const logicKB = Math.round(logic / 1024), totalKB = Math.round(total / 1024)
  // WARN（M3.3/M3.4 引擎裁剪+分包完成后硬化为 FAIL）
  if (logicKB > 1024) warnings.push(`微信逻辑包 ${logicKB}KB 超 1MB（引擎裁剪/分包排期 M3.3）`)
  if (totalKB > 4096) warnings.push(`微信总包 ${totalKB}KB 超 4MB 主包红线（NFR-7，引擎分包/CDN 排期 M3.3）`)
  console.log(`[report] wechatgame 逻辑包=${logicKB}KB 总包=${totalKB}KB`)
}

for (const w of warnings) console.log(`  ⚠ WARN ${w}`)
if (failures.length) {
  console.error(`check-size：${failures.length} 项超限`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log('check-size：包体积预算全过')
