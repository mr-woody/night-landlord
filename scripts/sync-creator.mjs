#!/usr/bin/env node
// M2.5 功能点6（P6）：Creator 工程资产同步脚本（ADR-9 方案 a 的 Creator 侧延伸）。
// 逻辑侧沿用 sync-cocos（packages → assets/scripts/shared）；本脚本负责 Creator 工程
// （apps/client-cocos/creator/assets）所需的三类同步产物，保持 theme.json/config 单一事实源：
//   ① shared/：packages/*/src → shared/<pkg>/（@rn/x 改写为相对路径，同 sync-cocos）
//   ② shared-headless/sim.ts：headless sim（buildBundle/runSimulation）+ @rn 改写
//   ③ whitebox-core/：白盒渲染层纯模块（theme/layout/state/anim/renderer）+ 生成式改写：
//      - theme.ts 的 JSON import → 生成式 theme-data.ts（THEME 常量）
//      - 相对导入去 .ts 扩展（Creator 编译管线要求）
//      - 指向 apps/headless、packages 的 import type 改写到工程内路径
// 校验和清单写入 creator/assets/scripts/creator-sync.json（--check 防漂移）。
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync, rmSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outRoot = join(root, 'apps/client-cocos/creator/assets/scripts')
const check = process.argv.includes('--check')

function hash32(input) {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) { h ^= input.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const plan = [] // { out, code }

const rel = (fromFile, toPathNoExt) => {
  let r = relative(dirname(fromFile), toPathNoExt).replace(/\\/g, '/')
  if (!r.startsWith('.')) r = './' + r
  return r
}

// ---- ① packages → shared/（与 sync-cocos 同逻辑）----
function listFiles(dir, ext, acc = []) {
  if (!existsSync(dir)) return acc
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (statSync(p).isDirectory()) listFiles(p, ext, acc)
    else if (n.endsWith(ext)) acc.push(p)
  }
  return acc
}
const sharedDir = join(outRoot, 'shared')
for (const pkg of readdirSync(join(root, 'packages'))) {
  const src = join(root, 'packages', pkg, 'src')
  if (!existsSync(src)) continue
  const name = JSON.parse(readFileSync(join(root, 'packages', pkg, 'package.json'), 'utf8')).name.replace('@rn/', '')
  for (const f of listFiles(src, '.ts')) {
    const relFromPkgSrc = relative(src, f)
    const up = '../'.repeat(relFromPkgSrc.split('/').length)
    const code = readFileSync(f, 'utf8').replace(/from '(@rn\/[a-z]+)'/g, (_, m) => `from '${up}${m.replace('@rn/', '')}/index'`)
    plan.push({ out: join(sharedDir, name, relFromPkgSrc), code })
  }
}

// ---- ② headless sim → shared-headless/sim.ts ----
{
  const f = join(root, 'apps/headless/src/sim.ts')
  let code = readFileSync(f, 'utf8')
  code = code.replace(/from '(@rn\/[a-z]+)'/g, (_, m) => `from '${rel(join(outRoot, 'shared-headless/sim.ts'), join(sharedDir, m.replace('@rn/', ''), 'index'))}'`)
  plan.push({ out: join(outRoot, 'shared-headless/sim.ts'), code })
}

// ---- ③ whitebox-core/（改写版）----
{
  const core = join(outRoot, 'whitebox-core')
  // theme-data.ts（生成式 tokens，替代 JSON import——Creator 编译管线对 JSON module 支持不稳）
  plan.push({ out: join(core, 'theme-data.ts'), code: `// 生成产物（scripts/sync-creator.mjs，源=config/theme.json）——勿手改\nexport const THEME = ${JSON.stringify(theme, null, 2)} as const\n` })
  const jsonVars = {
    weatherJson: JSON.parse(readFileSync(join(root, 'config/weather.json'), 'utf8')),
    buildingDefJson: JSON.parse(readFileSync(join(root, 'config/building_def.json'), 'utf8')),
    monstersJson: JSON.parse(readFileSync(join(root, 'config/monster.json'), 'utf8')),
    iapSkuJson: JSON.parse(readFileSync(join(root, 'config/iap_sku.json'), 'utf8')),
    spriteManifest: JSON.parse(readFileSync(join(root, 'docs/assets/ai/sprite-manifest.json'), 'utf8'))
  }
  plan.push({
    out: join(core, 'json-data.ts'),
    code: '// 生成产物（scripts/sync-creator.mjs，源=config/*.json + docs/assets/ai/sprite-manifest.json）——勿手改\n' +
      Object.entries(jsonVars).map(([k, v]) => `export const ${k} = ${JSON.stringify(v)} as const`).join('\n') + '\n'
  })
  const rewriteImportPath = (fromFile, spec) => {
    // 去掉 .ts 扩展；工程内路径映射
    let target = spec.replace(/\.ts$/, '')
    const map = [
      [/^(\.\.\/)+apps\/headless\/src\/sim$/, 'shared-headless/sim'],
      [/^(\.\.\/)+(packages\/systems\/src\/index|packages\/systems)$/, 'shared/systems/index'],
      [/^(\.\.\/)+(packages\/formula\/src\/index|packages\/formula)$/, 'shared/formula/index']
    ]
    for (const [re, to] of map) {
      if (re.test(target)) return rel(fromFile, join(outRoot, to))
    }
    if (target.startsWith('.')) return target // 相对同目录（theme/layout/state/anim/renderer 互引）
    return target
  }
  for (const name of ['theme.ts', 'layout.ts', 'state.ts', 'anim.ts', 'battle.ts', 'tutorial.ts', 'sprite.ts', 'renderer.ts']) {
    const f = join(root, 'apps/client-cocos/whitebox', name)
    let code = readFileSync(f, 'utf8')
    if (name === 'theme.ts') {
      code = code.replace(
        /import themeJson from '[^']+' with \{ type: 'json' \}/,
        `import { THEME as themeJson } from './theme-data'`
      )
    }
    // 通用改写：其余 JSON import-attributes → 生成式 json-data.ts（C13 同策略，防漂移复发）
    code = code.replace(
      /import (\w+) from '[^']*\.json' with \{ type: 'json' \}/g,
      (m, name2) => `import { ${name2} } from './json-data'`
    )
    // 相对导入：去 .ts 扩展 + 工程内映射（含 import type）
    code = code.replace(/from '([^']+)'/g, (m, spec) => {
      if (!spec.startsWith('.')) return m // 'cc' 等外部模块不动
      return `from '${rewriteImportPath(f, spec)}'`
    })
    plan.push({ out: join(core, name), code })
  }
}

// ---- ④ 共享表 → shared-tables/tables.ts（生成式，替代 JSON import）----
{
  const tables = ['day_curve', 'constants', 'building_def', 'event_lib', 'monster']
    .map(n => `${n}: ${readFileSync(join(root, `config/${n}.json`), 'utf8')}`)
    .join(',\n  ')
  plan.push({
    out: join(outRoot, 'shared-tables/tables.ts'),
    code: `// 生成产物（scripts/sync-creator.mjs，源=config/*.json）——勿手改\nexport const TABLES = {\n  ${tables}\n} as const\n`
  })
}

// ---- 写盘 / 校验 ----
const manifest = plan.map(p => ({ file: relative(root, p.out), hash: hash32(p.code) }))
if (check) {
  const mf = join(outRoot, 'creator-sync.json')
  if (!existsSync(mf)) { console.error('FAIL: creator-sync.json 不存在，先执行同步'); process.exit(1) }
  const same = JSON.stringify(JSON.parse(readFileSync(mf, 'utf8'))) === JSON.stringify(manifest)
  console.log(same ? `OK: ${manifest.length} 个 Creator 同步产物与清单一致` : 'DRIFT: 请重跑 node scripts/sync-creator.mjs')
  process.exit(same ? 0 : 1)
}
rmSync(join(outRoot, 'shared'), { recursive: true, force: true })
rmSync(join(outRoot, 'shared-headless'), { recursive: true, force: true })
rmSync(join(outRoot, 'whitebox-core'), { recursive: true, force: true })
for (const p of plan) {
  mkdirSync(dirname(p.out), { recursive: true })
  writeFileSync(p.out, p.code)
}
writeFileSync(join(outRoot, 'creator-sync.json'), JSON.stringify(manifest, null, 2))
console.log(`Creator 同步完成：${plan.length} 个文件 → ${relative(root, outRoot)}`)
console.log('（shared 逻辑 / shared-headless sim / whitebox-core 渲染层 + theme-data 生成）')
