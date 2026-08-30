#!/usr/bin/env node
// ADR-9 方案(a)：源码同步脚本——把 packages/*/src 同步到 Cocos assets，
// 并把跨包导入 '@rn/x' 改写为相对路径；写校验和清单防漂移。
// 用法：node scripts/sync-cocos.mjs [--check]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// FNV-1a 32 位（与 @rn/core hash32 同实现，内联以保持脚本零依赖可独立运行）
function hash32(input) {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packagesDir = join(root, 'packages')
const outDir = join(root, 'apps/client-cocos/assets/scripts/shared')

function listTs(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...listTs(p))
    else if (name.endsWith('.ts')) out.push(p)
  }
  return out
}

function buildSyncPlan() {
  const plan = { files: [], rewrites: 0 }
  if (!existsSync(packagesDir)) return plan
  for (const pkg of readdirSync(packagesDir)) {
    const src = join(packagesDir, pkg, 'src')
    if (!existsSync(src)) continue
    const pkgName = JSON.parse(readFileSync(join(packagesDir, pkg, 'package.json'), 'utf8')).name
    const outPkg = pkgName.replace('@rn/', '')
    for (const file of listTs(src)) {
      const original = readFileSync(file, 'utf8')
      const relFromPkgSrc = relative(src, file)
      const depth = relFromPkgSrc.split('/').length
      const up = '../'.repeat(depth)
      const code = original.replace(/from '(@rn\/[a-z]+)'/g, (_, name) => `from '${up}${name.replace('@rn/', '')}/index'`)
      plan.rewrites += (original.match(/from '@rn\//g) || []).length
      plan.files.push({ outFile: join(outDir, outPkg, relFromPkgSrc), code })
    }
  }
  return plan
}

const check = process.argv.includes('--check')
const plan = buildSyncPlan()
const manifest = plan.files.map(f => ({ file: relative(root, f.outFile), hash: hash32(f.code) }))
const manifestPath = join(outDir, 'manifest.json')

if (check) {
  if (!existsSync(manifestPath)) { console.error('FAIL: manifest 不存在，先执行同步'); process.exit(1) }
  const same = JSON.stringify(JSON.parse(readFileSync(manifestPath, 'utf8'))) === JSON.stringify(manifest)
  console.log(same ? `OK: ${manifest.length} 个文件与清单一致` : 'DRIFT: 同步产物与清单不一致，请重跑 sync-cocos')
  process.exit(same ? 0 : 1)
}

rmSync(outDir, { recursive: true, force: true })
for (const f of plan.files) {
  mkdirSync(dirname(f.outFile), { recursive: true })
  writeFileSync(f.outFile, f.code)
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`同步完成：${plan.files.length} 个文件，改写跨包导入 ${plan.rewrites} 处 → ${relative(root, outDir)}`)
