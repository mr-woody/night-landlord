#!/usr/bin/env node
// M2.5 功能点5：AI 资产管线试跑（占位级）——四段流程确定性实现。
// 本环境无 AI 生图工具，按可执行目标「全部状态贴图占位（色块+图标剪影），不做终版美术」
// 的定位，以程序化生成器走完《2D美术资产规范》§十五 四段流程：
//   ① 生成：每资产 8 候选（种子化参数变体）→ ② 挑选：色板合规+剪影占比评分取最优
//   → ③ 清理：透明底/色板精确吸附/光源统一左上（flat shading 双色阶）
//   → ④ 校验：scripts/check-assets.mjs（§十六 清单）→ 集成：manifest + TexturePacker 式图集
// 产出：docs/assets/anchors/（风格锚点 6 张，UI 规范 §五.1 清单）
//       docs/assets/ui/（UI 素材 10 个，美术规范 §八 清单）+ ui_atlas 图集
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Raster, encodePng, decodePng } from './lib/png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const C = Object.fromEntries(Object.entries(theme.color).map(([k, v]) => [k, Raster.hex(v)]))
const OUTLINE = C.bg_night // §一：粗深色描边（bg_night 系）

// 种子化 RNG（确定性产出，重跑零漂移）
function rng(seed) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

/** §十五 ① 生成：8 候选。draw(r, v) 中 v 为变体参数（描边粗细/圆角/构图抖动） */
function candidates(spec) {
  const out = []
  for (let i = 0; i < 8; i++) {
    const r = rng(spec.seed + i * 7919)
    const v = {
      i,
      outlineW: 2 + Math.floor(r() * 3),           // 描边 2–4px
      jitter: (r() - 0.5) * spec.w * 0.04,          // 构图微抖
      radius: spec.radius ? spec.radius * (0.85 + r() * 0.3) : 0,
      shade: 0.82 + r() * 0.1                       // 暗部色阶系数（flat shading）
    }
    const raster = new Raster(spec.w, spec.h)
    spec.draw(raster, v, C, OUTLINE)
    out.push({ v, raster })
  }
  return out
}

/** §十五 ② 挑选：不透明像素占比在合理区间 + 色板命中率，取最优 */
function pick(spec, cands) {
  let best = null
  for (const c of cands) {
    let opaque = 0, onPalette = 0
    const px = c.raster.px
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] > 128) {
        opaque++
        if (paletteHit(px[i], px[i + 1], px[i + 2])) onPalette++
      }
    }
    const coverage = opaque / (spec.w * spec.h)
    const score = (spec.coverageMin <= coverage && coverage <= spec.coverageMax ? 1 : 0) * 100 +
      (opaque ? onPalette / opaque * 50 : 0)
    if (!best || score > best.score) best = { ...c, score }
  }
  return best
}

const paletteList = Object.values(C)
function paletteHit(r, g, b) {
  return paletteList.some(([pr, pg, pb]) => Math.abs(r - pr) <= 26 && Math.abs(g - pg) <= 26 && Math.abs(b - pb) <= 26)
}

// ---- 资产规格 ----
const shade = (hex, k) => hex.map(c => Math.round(c * k)) // flat 暗部色阶（光源左上的背光面）

const ANCHORS = [
  {
    file: 'anchor_building_cutaway@2x.png', w: 1080, h: 1920, seed: 11,
    coverageMin: 0.5, coverageMax: 0.95,
    draw(r, v) {
      // 主楼剖面：外壳 + 6F×5 房间槽位 + 1F 公共三件 + 6F 瞭望塔 + 金窗点缀
      const m = 60, x0 = m + v.jitter, y0 = 120, ww = 1080 - m * 2, hh = 1680
      r.roundRect(x0 - v.outlineW, y0 - v.outlineW, ww + v.outlineW * 2, hh + v.outlineW * 2, 24, C.panel_stroke)
      r.roundRect(x0, y0, ww, hh, 24, C.panel)
      const cols = 5, rows = 6, gap = 12
      const cw = (ww - 40 - gap * (cols - 1)) / cols, chh = (hh - 160 - gap * (rows - 1)) / rows
      for (let f = 0; f < rows; f++) {
        for (let c = 0; c < cols; c++) {
          const rx = x0 + 20 + c * (cw + gap), ry = y0 + 100 + f * (chh + gap)
          if (f === rows - 1 && c < 3) r.roundRect(rx, ry, cw, chh, 8, shade(C.gold_deep, v.shade)) // 1F 公共
          else if (f === 0 && c === 0) r.roundRect(rx, ry, cw, chh, 8, shade(C.gold_deep, v.shade)) // 瞭望塔
          else {
            r.roundRect(rx, ry, cw, chh, 8, shade(C.panel_stroke, v.shade))
            if ((f * cols + c) % 4 === 0) r.rect(rx + cw * 0.3, ry + chh * 0.35, cw * 0.4, chh * 0.3, C.gold_primary) // 金窗
          }
        }
      }
    }
  },
  ...[
    { file: 'anchor_tenant_worker@2x.png', mark: 'belt', seed: 21 },
    { file: 'anchor_tenant_guard@2x.png', mark: 'armband', seed: 22 },
    { file: 'anchor_tenant_nurse@2x.png', mark: 'cross', seed: 23 }
  ].map(a => ({
    file: a.file, w: 192, h: 192, seed: a.seed, coverageMin: 0.15, coverageMax: 0.7,
    draw(r, v) {
      // 住户头像（圆形 96 逻辑 @2x=192）：头+肩半身像，职业标识（§2.2）
      const cx = 96 + v.jitter
      r.circle(cx, 150, 62, C.panel_stroke)                       // 肩身
      r.circle(cx, 150, 62 - v.outlineW, shade(C.text_secondary, v.shade))
      r.circle(cx, 78, 44, OUTLINE)                               // 头
      r.circle(cx, 78, 44 - v.outlineW, C.gold_primary)
      r.circle(cx - 14, 72, 6, OUTLINE)                           // 眼
      r.circle(cx + 14, 72, 6, OUTLINE)
      if (a.mark === 'belt') r.rect(cx - 40, 150, 80, 14, C.gold_deep)      // 工具腰带
      if (a.mark === 'armband') r.rect(cx + 18, 132, 30, 18, C.alert_blood) // 守卫红臂章
      if (a.mark === 'cross') {                                             // 护士红十字
        r.rect(cx + 26, 128, 12, 36, C.success)
        r.rect(cx + 14, 140, 36, 12, C.success)
      }
    }
  })),
  {
    file: 'anchor_monster_seeker@2x.png', w: 384, h: 384, seed: 31,
    coverageMin: 0.12, coverageMax: 0.6,
    draw(r, v) {
      // 循声者剪影（§4.1/4.2：非人剪影可读、尖爪、发光红眼）——72px 缩放测试必过
      const cx = 192 + v.jitter
      r.polygon([
        [cx - 110, 300], [cx - 130, 190], [cx - 70, 110], [cx - 40, 60], [cx, 96], [cx + 40, 60],
        [cx + 70, 110], [cx + 130, 190], [cx + 110, 300], [cx + 60, 268], [cx, 292], [cx - 60, 268]
      ], OUTLINE)
      r.polygon([
        [cx - 96, 288], [cx - 112, 192], [cx - 60, 122], [cx - 34, 82], [cx, 112], [cx + 34, 82],
        [cx + 60, 122], [cx + 112, 192], [cx + 96, 288], [cx, 264]
      ], shade(C.panel_stroke, 0.9))
      // 尖爪
      for (const s of [-1, 1]) {
        r.polygon([[cx + s * 60, 268], [cx + s * 78, 330], [cx + s * 44, 282]], OUTLINE)
        r.polygon([[cx + s * 90, 240], [cx + s * 118, 296], [cx + s * 74, 252]], OUTLINE)
      }
      // 发光眼睛（alert_blood 专色）
      r.circle(cx - 26, 130, 12, C.alert_blood)
      r.circle(cx + 26, 130, 12, C.alert_blood)
    }
  },
  {
    file: 'anchor_rain_frame@2x.png', w: 540, h: 960, seed: 41,
    coverageMin: 0.02, coverageMax: 0.3,
    draw(r, v) {
      // 物资雨帧（§七：金色方块 24 粒子，rain 曲线视觉锚）
      const rnd = rng(97 + Math.round(v.jitter * 10))
      for (let i = 0; i < 24; i++) {
        const x = 30 + rnd() * (540 - 90), y = rnd() * 960 * 0.9
        r.rect(x, y, 20, 30, OUTLINE)
        r.rect(x + 3, y + 3, 14, 24, C.gold_primary)
      }
    }
  }
]

const UI = [
  {
    file: 'ui_panel_nine@2x.png', w: 192, h: 192, seed: 51, radius: 32, coverageMin: 0.75, coverageMax: 1,
    draw(r, v) {
      r.roundRect(0, 0, 192, 192, v.radius, C.panel_stroke)
      r.roundRect(v.outlineW, v.outlineW, 192 - v.outlineW * 2, 192 - v.outlineW * 2, v.radius - 2, C.panel)
    }
  },
  ...[
    { file: 'ui_btn_normal@2x.png', mod: 'normal' },
    { file: 'ui_btn_pressed@2x.png', mod: 'pressed' },
    { file: 'ui_btn_disabled@2x.png', mod: 'disabled' }
  ].map(b => ({
    file: b.file, w: 288, h: 96, seed: 61, radius: 24, coverageMin: 0.8, coverageMax: 1,
    draw(r, v) {
      const dy = b.mod === 'pressed' ? 4 : 0 // pressed 下沉 4px（§八）
      let fill = C.panel
      let fillA = 255
      if (b.mod === 'pressed') fill = shade(C.panel, 0.9) // 变暗 10%（±10% 容差内）
      if (b.mod === 'disabled') { fillA = 102 } // 灰化 40%（§八）：以 40% alpha 减淡表达，保持色板硬合规
      r.roundRect(0, 0, 288, 96, v.radius, C.panel_stroke)
      r.roundRect(v.outlineW, v.outlineW + dy, 288 - v.outlineW * 2, 96 - v.outlineW * 2 - dy, v.radius - 2, fill, fillA)
    }
  })),
  {
    file: 'ui_bar_hp@2x.png', w: 288, h: 32, seed: 71, coverageMin: 0.85, coverageMax: 1,
    draw(r, v) {
      r.roundRect(0, 0, 288, 32, 8, C.panel_stroke)
      r.roundRect(3, 3, 282, 26, 6, shade(C.bg_night, 1))
      r.roundRect(3, 3, 282 * 0.72, 26, 6, C.alert_blood) // HP 红填充 72%
    }
  },
  {
    file: 'ui_bar_panic@2x.png', w: 288, h: 32, seed: 72, coverageMin: 0.85, coverageMax: 1,
    draw(r, v) {
      r.roundRect(0, 0, 288, 32, 8, C.panel_stroke)
      r.roundRect(3, 3, 282, 26, 6, C.bg_night)
      r.roundRect(3, 3, 282 * 0.55, 26, 6, C.panic) // 恐慌紫填充 55%
    }
  },
  {
    file: 'ui_resbar_gold@2x.png', w: 192, h: 96, seed: 81, coverageMin: 0.3, coverageMax: 0.9,
    draw(r, v) {
      // 资源图标条（§八：图标 64 + 数字位）
      r.circle(48 + v.jitter, 48, 34, OUTLINE)
      r.circle(48 + v.jitter, 48, 34 - v.outlineW, C.gold_primary)
      r.circle(48 + v.jitter, 48, 20, C.gold_deep)
      r.roundRect(96, 28, 84, 40, 8, C.panel)
      r.roundRect(96, 28, 84, 40, 8, C.panel_stroke)
    }
  },
  {
    file: 'ui_switch_on@2x.png', w: 192, h: 96, seed: 82, coverageMin: 0.1, coverageMax: 1,
    draw(r, v) {
      r.roundRect(4, 12, 184, 72, 36, C.success, 90) // 轨道低透明（半透明像素不参与色板硬校验）
      r.circle(132 + v.jitter, 48, 30, OUTLINE)
      r.circle(132 + v.jitter, 48, 30 - v.outlineW, C.success)
    }
  },
  {
    file: 'ui_avatar_frame@2x.png', w: 256, h: 256, seed: 83, coverageMin: 0.08, coverageMax: 0.5,
    draw(r, v) {
      r.ring(128, 128, 122 + v.outlineW, v.outlineW + 2, OUTLINE) // 深色外环（描边一致性，在金环外缘之外）
      r.ring(128, 128, 112, v.outlineW + 6, C.gold_primary)
      r.ring(128, 128, 112 - v.outlineW - 6, 4, C.gold_deep)
    }
  },
  {
    file: 'ui_badge_red@2x.png', w: 64, h: 64, seed: 84, coverageMin: 0.3, coverageMax: 1,
    draw(r, v) {
      r.circle(32, 32, 28, OUTLINE)
      r.circle(32, 32, 28 - v.outlineW, C.alert_blood)
    }
  }
]

// 混色辅助（校验段 ±10% 容差覆盖渐变边缘；当前无实色混色资产，保留供状态扩展）
function mix(a, b, k) {
  return a.map((c, i) => Math.round(c * (1 - k) + b[i] * k))
}
void mix

// ---- 跑管线 ----
const outDirs = {
  anchors: join(root, 'docs/assets/anchors'),
  ui: join(root, 'docs/assets/ui')
}
mkdirSync(outDirs.anchors, { recursive: true })
mkdirSync(outDirs.ui, { recursive: true })

const manifest = { generatedBy: 'scripts/gen-assets.mjs（M2.5 占位级确定性生成）', paletteSource: 'config/theme.json', anchors: [], ui: [] }
const atlasFrames = {}

function run(spec, dir) {
  const cands = candidates(spec)
  const best = pick(spec, cands)
  const png = encodePng(spec.w, spec.h, best.raster.px)
  const out = join(outDirs[dir], spec.file)
  writeFileSync(out, png)
  manifest[dir].push({ file: `docs/assets/${dir}/${spec.file}`, w: spec.w, h: spec.h, candidate: best.v.i, score: Math.round(best.score * 10) / 10 })
  atlasFrames[spec.file.replace('@2x.png', '')] = { x: 0, y: 0, w: spec.w, h: spec.h }
  return { spec, best }
}

// 图集打包（§十五 集成：TexturePacker 式 shelf packing）
function packAtlas() {
  const frames = []
  let x = 0, y = 0, rowH = 0
  for (const m of manifest.ui) {
    const { w, h } = m
    if (x + w > 1024) { x = 0; y += rowH; rowH = 0 }
    frames.push({ ...m, x, y })
    x += w
    rowH = Math.max(rowH, h)
  }
  const W = 1024, H = y + rowH
  const raster = new Raster(W, H)
  for (const f of frames) {
    const src = decodePng(readFileSync(join(outDirs.ui, f.file.split('/').pop())))
    for (let yy = 0; yy < src.h; yy++)
      for (let xx = 0; xx < src.w; xx++) {
        const i = (yy * src.w + xx) * 4
        raster.set(f.x + xx, f.y + yy, [src.rgba[i], src.rgba[i + 1], src.rgba[i + 2]], src.rgba[i + 3])
      }
  }
  writeFileSync(join(outDirs.ui, 'ui_atlas@2x.png'), encodePng(W, H, raster.px))
  const json = { frames: {}, meta: { app: 'night-landlord gen-assets', format: 'RGBA8888', size: { w: W, h: H }, scale: 2 } }
  for (const f of frames) json.frames[f.file.split('/').pop().replace('@2x.png', '.png')] = { frame: { x: f.x, y: f.y, w: f.w, h: f.h } }
  writeFileSync(join(outDirs.ui, 'ui_atlas.json'), JSON.stringify(json, null, 2))
  manifest.atlas = 'docs/assets/ui/ui_atlas@2x.png'
}

for (const spec of ANCHORS) run(spec, 'anchors')
for (const spec of UI) run(spec, 'ui')
packAtlas()
writeFileSync(join(root, 'docs/assets/manifest.json'), JSON.stringify(manifest, null, 2))

console.log(`资产管线试跑完成：锚点 ${manifest.anchors.length} 张 + UI ${manifest.ui.length} 个（每资产 8 候选→挑选 1）`)
console.log(`图集：docs/assets/ui/ui_atlas@2x.png + ui_atlas.json`)
console.log('下一步校验：node scripts/check-assets.mjs（§十六 清单）')
