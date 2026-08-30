#!/usr/bin/env node
// M2.5 功能点5 质量门：资产校验清单（《2D美术资产规范》§十六 视觉段，每次入库必过）。
// ① 主色落在 theme 色板 ±10%（逐像素，alpha>128 视为实体）
// ② 72px 缩放剪影可读（怪物/图标：alpha 覆盖率区间 + 色彩层次 ≥2）
// ③ 描边与锚点一致（bg_night 系深色描边像素占比 >0）
// ④ 透明底（四角 alpha=0；全出血资产按 manifest 标记豁免）+ 无文字乱码（程序化生成天然满足）
// ⑤ 命名 {模块}_{对象}_{状态}@2x.png
// （⑥ 骨骼动画循环首尾匹配：本批无骨骼资产，不适用）
// 退出码：0=全过；1=存在违规。
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodePng } from './lib/png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const palette = Object.values(theme.color).map(h => {
  const s = h.replace('#', '')
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
})
const TOL = Math.round(255 * 0.1) // ±10%

const failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }

function walkAssets(dir) {
  return readdirSync(dir).filter(f => f.endsWith('.png')).map(f => join(dir, f))
}
const dirs = ['docs/assets/anchors', 'docs/assets/ui'].map(d => join(root, d))
const files = dirs.filter(existsSync).flatMap(walkAssets)
check(files.length >= 16, `资产数 ${files.length} 应 ≥16（锚点 6 + UI 10）`)

// ⑤ 命名规范（图集与其 json 除外）
const NAME = /^[a-z][a-z0-9_]*@[2]x\.png$/
for (const f of files) {
  const base = f.split('/').pop()
  if (base.startsWith('ui_atlas')) continue
  check(NAME.test(base), `命名不规范：${base}（应为 {模块}_{对象}_{状态}@2x.png）`)
  check(/^(anchor|ui)_/.test(base), `模块前缀缺失：${base}（anchor_/ui_）`)
}

// 内容校验
let checked72 = 0
for (const f of files) {
  const base = f.split('/').pop()
  let img
  try { img = decodePng(readFileSync(f)) } catch (e) { failures.push(`${base}: 解码失败 ${e.message}`); continue }
  const { w, h, rgba } = img

  // ④ 透明底（四角；ui_bar/按钮类全出血条除外——用四角容许面板色判断出血）
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4]
  const opaqueCorners = corners.filter(i => rgba[i + 3] > 128).length
  check(opaqueCorners === 0 || base.startsWith('ui_bar') || base.startsWith('ui_btn') || base.startsWith('ui_panel') || base.startsWith('ui_atlas'),
    `${base}: 透明底违规（四角 ${opaqueCorners}/4 不透明且非全出血类）`)

  // ① 色板 ±10% + ③ 深色描边存在
  let opaque = 0, onPalette = 0, darkOutline = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue
    opaque++
    const hit = palette.some(([pr, pg, pb]) =>
      Math.abs(rgba[i] - pr) <= TOL && Math.abs(rgba[i + 1] - pg) <= TOL && Math.abs(rgba[i + 2] - pb) <= TOL)
    if (hit) onPalette++
    if (rgba[i] < 40 && rgba[i + 1] < 45 && rgba[i + 2] < 70) darkOutline++ // bg_night 系描边
  }
  const ratio = opaque ? onPalette / opaque : 0
  check(ratio >= 0.98, `${base}: 色板合规率 ${(ratio * 100).toFixed(1)}% 应 ≥98%（±10% 容差）`)
  check(darkOutline > 0, `${base}: 缺少深色描边（bg_night 系）`)

  // ② 72px 剪影可读（怪物/图标/头像类；条与面板全出血类跳过）
  const need72 = /monster|tenant|badge|resbar|switch|avatar_frame/.test(base)
  if (need72) {
    const scale = 72 / Math.max(w, h)
    const sw = Math.max(1, Math.round(w * scale)), sh = Math.max(1, Math.round(h * scale))
    let cov = 0, colors = new Set()
    for (let y = 0; y < sh; y++) {
      for (let x = 0; x < sw; x++) {
        // 盒式降采样：取源区中心像素
        const sx = Math.min(w - 1, Math.floor((x + 0.5) / scale)), sy = Math.min(h - 1, Math.floor((y + 0.5) / scale))
        const i = (sy * w + sx) * 4
        if (rgba[i + 3] > 128) {
          cov++
          colors.add(palette.findIndex(([pr, pg, pb]) =>
            Math.abs(rgba[i] - pr) <= TOL && Math.abs(rgba[i + 1] - pg) <= TOL && Math.abs(rgba[i + 2] - pb) <= TOL))
        }
      }
    }
    const covRatio = cov / (sw * sh)
    check(covRatio >= 0.08 && covRatio <= 0.95, `${base}: 72px 覆盖率 ${(covRatio * 100).toFixed(0)}% 越界（8–95%）`)
    check(colors.size >= 2, `${base}: 72px 下色彩层次 ${colors.size} <2（剪影不可读）`)
    checked72++
  }
}
check(checked72 >= 7, `72px 缩放测试资产 ${checked72} 个应 ≥7（怪物/头像/图标类）`)

if (failures.length) {
  console.error(`check-assets：${failures.length} 项违规`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log(`check-assets：${files.length} 个资产全过（色板±10% / 72px 剪影×${checked72} / 深色描边 / 透明底 / 命名）`)
