#!/usr/bin/env node
// M3 素材期：AI 生图接入管线（火山方舟 Seedream）——「生成→校验→重试」agent 闭环。
// 对应《素材提示词模板》§5 流程与《2D美术资产规范》§十五 四段流程的 AI 版实现：
//   ① 生成：每资产 N 候选（Seedream API / --dry 时确定性 mock），锚点图作参考图（一致性策略）
//   ② 挑选：抠底+色板吸附后按覆盖率窗口+色彩层次评分取最优
//   ③ 清理：rembg 抠透明底（可选）→ 全图像素吸附 theme 色板（±10% 门的先决条件）
//   ④ 校验：门禁复刻 check-assets.mjs §十六 视觉段规则（按资产类别参数化）→ 不过关带病因重生成
// 闭环协议（agent 迭代通道）：
//   - docs/assets/ai/prompt-overrides.json：人工/agent 修订提示词，重跑即生效（版本化）
//   - docs/assets/ai/ai-report.json：每资产轮次/病因/终态证据，供 agent 读后定向调整
// 用法：
//   node scripts/gen-ai-assets.mjs --dry                     # 无 key 全流程试跑（mock 出图）
//   node scripts/gen-ai-assets.mjs --only anchors            # 只跑某模块（anchors/houses/monsters/weather/vfx）
//   ARK_API_KEY=sk-.. node scripts/gen-ai-assets.mjs         # 真跑（费用≈资产×候选×轮次×单价）
//   可选：--candidates 8 --rounds 3 --no-rembg --seed 7
// 环境变量（.env 自动加载，不入库）：ARK_API_KEY / ARK_MODEL_ID / ARK_BASE_URL / ARK_PRICE_PER_IMAGE
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Raster, encodePng, decodePng } from './lib/png.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ---- CLI / env ----
const argv = process.argv.slice(2)
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d }
const has = n => argv.includes(n)
const DRY = has('--dry')
const ONLY = flag('--only', null)?.split(',')
const N_CAND = parseInt(flag('--candidates', '8'))
const N_ROUNDS = parseInt(flag('--rounds', '3'))
const BASE_SEED = parseInt(flag('--seed', '7'))
const USE_REMBG = !has('--no-rembg') && !DRY

for (const line of existsSync(join(root, '.env')) ? readFileSync(join(root, '.env'), 'utf8').split('\n') : []) {
  const m = line.match(/^([A-Z_]+)=(.*)$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim()
}
const ARK_API_KEY = process.env.ARK_API_KEY
const ARK_MODEL_ID = process.env.ARK_MODEL_ID || 'doubao-seedream-4-0-250828'
const ARK_BASE_URL = process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com/api/v3'
const PRICE = parseFloat(process.env.ARK_PRICE_PER_IMAGE || '0.25')
if (!DRY && !ARK_API_KEY) { console.error('缺 ARK_API_KEY（或用 --dry 试跑）'); process.exit(2) }

// ---- 色板（theme 基础 12 色为 UI/描边锚 + asset-palette 扩展色板为 AI 资产计量域，M5 C13）----
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const assetPalCfg = JSON.parse(readFileSync(join(root, 'config/asset-palette.json'), 'utf8'))
const hex2rgb = h => { const s = h.replace('#', ''); return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)] }
const palette = [...Object.values(theme.color), ...Object.values(assetPalCfg.extended)].map(hex2rgb)
const OUTLINE_RGB = theme.color.bg_night
const PAL_TOL = assetPalCfg.tol
const MIN_PAL_HIT = assetPalCfg.minPaletteHit

// ---- 提示词拼装（《素材提示词模板》§0 分视角后缀 + §1–4 主体段；M5 §3 视角规格）----
const SUFFIX_BASE = '末日生存卡通风格, flat shading, 粗深色描边, 高饱和点缀, 左上光源, 纯色浅灰背景便于抠图, 手游素材, 3–4 色块面'
const VIEWS = {
  iso: '等距 2.5D 视角，俯角约 30°，方位角 45°（左上前），统一消失点，带接地投影',
  side: '3/4 侧面视角，面朝画面右（行进方向），带接地椭圆影',
  front: '正面半身，平视，圆框头像构图',
  icon: '正视，居中单体',
  flat: '正视全景构图'
}
const NEG = '避免出现：写实、3D 渲染、透视灭点、渐变背景、文字、水印、色卡、图例、标注、边框装饰、多光源、复杂细节'
// 注：不再在提示词中列 hex 色板码——P1 实测模型会把它画成色卡图例（C14）；色板一致性由扩展色板门禁+锚点参考图保障
const buildPrompt = (spec, extra) =>
  [spec.body, VIEWS[spec.view], SUFFIX_BASE, extra, NEG].filter(Boolean).join(', ')

// ---- 资产清单（对齐模板 §1–4 与 manifest；命名红线 {模块}_{对象}_{状态}@2x）----
// cls: scene=大幅场景（无 72px 测试）；char=角色/怪物（72px 剪影必测）
// view: iso=等距场景 / side=战斗实体 3-4 侧 / front=头像 / icon=图标VFX / flat=正视全景
const A = (mod, file, w, h, cls, view, covMin, covMax, body, ref) =>
  ({ id: file.replace('@2x.png', ''), mod, file, w, h, cls, view, covMin, covMax, body, ref })
// 参考链：优先已确认的 AI 锚点（docs/assets/ai/anchors），缺位回退程序化占位锚点
const REF = f => {
  const ai = join(root, 'docs/assets/ai/anchors', f)
  return existsSync(ai) ? ai : join(root, 'docs/assets/anchors', f)
}
const ASSETS = [
  // §1 风格锚点 6（终版将同名替换 docs/assets/anchors/ 占位）
  A('anchors', 'anchor_building_cutaway@2x.png', 1080, 1920, 'scene', 'iso', 0.50, 0.95, '末日生存小区主楼等距剖面，6层×5房网格，金色窗光，深蓝夜空'),
  A('anchors', 'anchor_tenant_worker@2x.png', 192, 192, 'char', 'front', 0.15, 0.70, '末日幸存者半身像，工装背心+工具腰带，坚毅表情'),
  A('anchors', 'anchor_tenant_guard@2x.png', 192, 192, 'char', 'front', 0.15, 0.70, '末日守卫半身像，红臂章+棍棒，警惕姿态'),
  A('anchors', 'anchor_tenant_nurse@2x.png', 192, 192, 'char', 'front', 0.15, 0.70, '末日医护半身像，红十字袖标+急救包'),
  A('anchors', 'anchor_monster_seeker@2x.png', 384, 384, 'char', 'side', 0.12, 0.60, '无眼盲怪，声波探测姿态，红色发光感知器官，尖爪利齿，剪影可读'),
  A('anchors', 'anchor_rain_frame@2x.png', 540, 960, 'scene', 'flat', 0.02, 0.35, '金色物资箱从天而降的定格帧，24粒子雨，动态拖尾'),
  // §2 房屋进化 6 级（等距 4:3；参考主楼锚点统一风格）
  ...[
    ['lv0_thatch', '圆木骨架+枯黄茅草斜顶小屋，泥地基座'],
    ['lv1_broken_wood', '木板墙带缺口补丁的破旧小屋，破洞屋顶漏光'],
    ['lv2_plain_wood', '整齐木板墙小屋，单坡木屋顶，木门框'],
    ['lv3_fine_wood', '双色墙板精品小屋，雕花门楣，气窗，石块基座'],
    ['lv4_stone', '石块墙小屋，石瓦屋顶，加固门框'],
    ['lv5_bastion', '砖石堡垒小屋，瞭望角楼，铁门']
  ].map(([n, b]) => A('houses', `house_${n}@2x.png`, 768, 576, 'scene', 'iso', 0.35, 0.95, `等距视角单人小屋：${b}`, REF('anchor_building_cutaway@2x.png'))),
  // §3 怪物/野物（72px 剪影必测；3/4 侧面朝右=行进方向；参考循声者锚点统一怪物家族风格）
  A('monsters', 'monster_seeker_idle@2x.png', 384, 384, 'char', 'side', 0.12, 0.60, '无眼盲怪爬行姿态，头部声波探测圈，红色感知器官发光', REF('anchor_monster_seeker@2x.png')),
  A('monsters', 'monster_prey_rabbit@2x.png', 384, 384, 'char', 'side', 0.12, 0.60, '野兔侧面剪影，温和体态，生存狩猎猎物，面朝右', REF('anchor_monster_seeker@2x.png')),
  A('monsters', 'monster_beast_boar@2x.png', 384, 384, 'char', 'side', 0.12, 0.60, '野猪侧面剪影，獠牙低吼，攻击前倾，危险野兽，面朝右', REF('anchor_monster_seeker@2x.png')),
  A('monsters', 'monster_night_king@2x.png', 512, 768, 'char', 'side', 0.15, 0.70, '巨型人形暗影，王冠状骨角，全身红纹，赛季Boss，面朝右', REF('anchor_monster_seeker@2x.png')),
  // §4 天气氛围 6（同构图锁参考图+同 seed，供 LUT 对色）+ VFX
  ...['晴朗蓝天白云', '阴天灰云低压', '雨天雨丝斜织', '浓雾低能见度', '大雪覆盖', '血月红光尘暴'].map((w, i) =>
    A('weather', `weather_${['sunny', 'overcast', 'rain', 'fog', 'snow', 'bloodmoon'][i]}@2x.png`, 540, 960, 'scene', 'flat', 0.30, 0.98,
      `末日小区主楼场景氛围图（同构图）：${w}`, REF('anchor_building_cutaway@2x.png'))),
  A('vfx', 'vfx_airdrop@2x.png', 512, 768, 'scene', 'icon', 0.10, 0.60, '空投物资：降落伞+物资箱，金色高光'),
  A('vfx', 'vfx_shield@2x.png', 512, 512, 'scene', 'icon', 0.10, 0.60, '护盾：蓝色半球能量罩，六边纹理呼吸'),
  // C6 扩容：怪物攻击 pose（夜战 §10.2 状态机 attack 帧）+ 粒子贴图 ×4 + 光效贴图 ×3
  A('monsters', 'monster_seeker_attack@2x.png', 384, 384, 'char', 'side', 0.15, 0.65, '无眼盲怪扑击攻击姿态，身体前倾向前扑出，双爪前伸，红色感知器官发光', REF('anchor_monster_seeker@2x.png')),
  ...[
    ['smoke', '灰白色烟雾团，柔和边缘，半透明渐变'],
    ['spark', '橙金色火花四溅颗粒，柔和边缘光点'],
    ['glow', '金色柔和光斑，中心亮四周透明衰减'],
    ['dust', '红棕色尘土颗粒云，柔和边缘']
  ].map(([n, b]) => A('fx', `fx_particle_${n}@2x.png`, 256, 256, 'fx', 'icon', 0.05, 0.60, `游戏粒子贴图，居中单体：${b}；边缘必须柔和渐变到全透明`)),
  ...[
    ['column', '竖直金色光柱，由上至下渐弱，柔边'],
    ['circle', '金色地面光圈，环形柔边发光'],
    ['ring', '暗红色血月光晕环，柔边呼吸感']
  ].map(([n, b]) => A('fx', `fx_light_${n}@2x.png`, 512, 512, 'fx', 'icon', 0.08, 0.70, `游戏光效贴图，居中单体：${b}；边缘必须柔和渐变到全透明`))
]
const list = ONLY ? ASSETS.filter(a => ONLY.includes(a.mod) || ONLY.includes(a.id)) : ASSETS

// 全出血场景（主楼剖面/天气氛围=整幅含背景交付）：不抠底、豁免透明底门、覆盖率按满幅计量
for (const a of list) if (/^(anchor_building_cutaway|anchor_rain|weather_)/.test(a.id)) { a.fullBleed = /^(anchor_building_cutaway|weather_)/.test(a.id); a.covMin = a.fullBleed ? 0.8 : a.covMin; a.covMax = a.fullBleed ? 1 : a.covMax }

// ---- 出图 provider ----
async function arkGenerate({ prompt, refs, w, h, seed }) {
  // Seedream 尺寸钳制：单边 [512,2048] 且 16 对齐、总面积 ≥921600px²（960²，API 下限），出图后本地降采样回目标
  const AREA_MIN = 921600
  let s = 1
  const mx = Math.max(w, h)
  if (mx > 2048) s = 2048 / mx
  if (w * s * (h * s) < AREA_MIN) s = Math.sqrt(AREA_MIN / (w * h))
  const q = v => Math.min(2048, Math.max(512, Math.round(v * s / 16) * 16))
  let gw = q(w), gh = q(h)
  while (gw * gh < AREA_MIN) { if (gw <= gh) gw += 16; else gh += 16 }
  const body = { model: ARK_MODEL_ID, prompt, size: `${gw}x${gh}`, seed, response_format: 'b64_json', watermark: false }
  if (refs?.length) body.image = refs.map(p => `data:image/png;base64,${readFileSync(p).toString('base64')}`)
  const res = await fetch(`${ARK_BASE_URL}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ARK_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`ARK ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const d = (await res.json()).data?.[0]
  if (d?.b64_json) return Buffer.from(d.b64_json, 'base64')
  if (d?.url) return Buffer.from(await (await fetch(d.url)).arrayBuffer())
  throw new Error('ARK 响应无图片数据')
}

// mock provider：确定性程序化占位（无 key 试跑闭环用），透明底+色板内配色
function mockGenerate({ w, h, seed, cls, covMin, covMax }) {
  let s = (seed * 2654435761) >>> 0
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 0xffffffff }
  const pickC = () => palette[Math.floor(rnd() * palette.length)]
  const r = new Raster(w, h)
  const cx = w / 2, cy = h / 2, dark = [0x0b, 0x10, 0x20]
  if (cls === 'char') { // 剪影态 blob：外描边+双色阶+红眼点缀
    const R = Math.min(w, h) * (0.28 + rnd() * 0.08), n = 9
    const poly = Array.from({ length: n }, (_, i) => {
      const a = (i / n) * Math.PI * 2, rr = R * (0.8 + rnd() * 0.4)
      return [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 1.1]
    })
    r.polygon(poly, dark)
    r.polygon(poly.map(([x, y]) => [cx + (x - cx) * 0.88, cy + (y - cy) * 0.88]), pickC())
    r.circle(cx - R * 0.25, cy - R * 0.2, R * 0.09, [0xc0, 0x39, 0x2b])
    r.circle(cx + R * 0.25, cy - R * 0.2, R * 0.09, [0xc0, 0x39, 0x2b])
  } else if (cls === 'fx') { // 柔边径向衰减 blob（阶梯 alpha 模拟柔边，供 fx 软边门自检）
    const R = Math.min(w, h) * (0.3 + rnd() * 0.12)
    const c = pickC()
    for (let k = 6; k >= 1; k--) r.circle(cx, cy, R * k / 6, c, Math.round(230 * (7 - k) / 6))
  } else { // scene：按覆盖率窗口中值反推边距（保证四角透明且覆盖率落窗）
    const mid = (covMin + covMax) / 2
    const m = Math.min(w, h) * Math.min(0.42, Math.max(0.05, (1 - Math.sqrt(mid)) / 2 * 1.2))
    r.roundRect(m, m, w - m * 2, h - m * 2, 16, dark)
    r.roundRect(m + 6, m + 6, w - m * 2 - 12, h - m * 2 - 12, 12, pickC())
    const rows = 3 + Math.floor(rnd() * 3)
    for (let i = 0; i < rows; i++) {
      const bw = (w - m * 2 - 24) / rows
      r.roundRect(m + 12 + i * bw + 4, m + h * 0.15, bw - 8, h * 0.5, 8, i % 2 ? pickC() : [0x1a, 0x22, 0x38])
      r.rect(m + 12 + i * bw + bw * 0.3, m + h * 0.22, bw * 0.4, h * 0.08, [0xff, 0xd7, 0x00]) // 金窗
    }
  }
  return encodePng(w, h, r.px)
}

// Seedream 返回 JPEG：非 PNG 签名时经 sips（macOS 自带）转 PNG（零 Node 依赖）
function ensurePng(buf, path) {
  if (buf[0] === 0x89 && buf[1] === 0x50) return buf
  const src = path.replace(/\.png$/, '.jpg')
  writeFileSync(src, buf)
  execFileSync('sips', ['-s', 'format', 'png', src, '--out', path], { stdio: 'pipe' })
  return readFileSync(path)
}

// ---- 后处理：rembg 抠底 → 双三次盒式降采样 → 色板全吸附 ----
// rembg 库直调（CLI 入口有 gradio/hub 版本冲突；u2net 首跑自动下载模型 ~170MB）
const REMBG_PY = `
from rembg import remove, new_session
from PIL import Image
import sys
session = new_session('u2net')
remove(Image.open(sys.argv[1]), session=session).save(sys.argv[2])
`
function rembg(buf, tag) {
  if (!USE_REMBG) return buf
  const tmp = `/tmp/nl-rembg-${process.pid}-${tag}.png`
  writeFileSync(tmp, buf)
  try {
    execFileSync('python3', ['-c', REMBG_PY, tmp, tmp.replace('.png', '-cut.png')], { stdio: 'pipe' })
    return readFileSync(tmp.replace('.png', '-cut.png'))
  } catch (e) { console.warn(`  ⚠ rembg 不可用，跳过抠底（${tag}）：${String(e.message).split('\n')[0]}`); return buf }
}

function resize(src, tw, th) { // 中心点采样降采样：保住 flat 色块纯度（均值混色会产生大量容差外边缘色，毁色板命中率）；与 check-assets 72px 测法同口径
  const out = new Uint8Array(tw * th * 4)
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    const sx = Math.min(src.w - 1, Math.floor((x + 0.5) * src.w / tw)), sy = Math.min(src.h - 1, Math.floor((y + 0.5) * src.h / th))
    const i = (sy * src.w + sx) * 4, o = (y * tw + x) * 4
    out[o] = src.rgba[i]; out[o + 1] = src.rgba[i + 1]; out[o + 2] = src.rgba[i + 2]; out[o + 3] = src.rgba[i + 3]
  }
  return { w: tw, h: th, rgba: out }
}

function snapPalette(img, binarize = true) { // 容差内吸附：抗锯齿/渐变边缘归位最近色板色；容差外中间色保留（C13）。fx 贴图免二值化（保留柔边 alpha）
  const px = img.rgba
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] <= 8) { if (binarize) px[i + 3] = 0; continue }
    let best = -1, bd = 1e9
    for (let p = 0; p < palette.length; p++) {
      const d = (px[i] - palette[p][0]) ** 2 + (px[i + 1] - palette[p][1]) ** 2 + (px[i + 2] - palette[p][2]) ** 2
      if (d < bd) { bd = d; best = p }
    }
    if (best >= 0 && bd <= PAL_TOL * PAL_TOL * 3) { // 曼哈顿分量均 ≤TOL 才吸附
      const [pr, pg, pb] = palette[best]
      if (Math.abs(px[i] - pr) <= PAL_TOL && Math.abs(px[i + 1] - pg) <= PAL_TOL && Math.abs(px[i + 2] - pb) <= PAL_TOL) {
        px[i] = pr; px[i + 1] = pg; px[i + 2] = pb
      }
    }
    if (binarize) px[i + 3] = px[i + 3] > 128 ? 255 : 0 // 二值化边缘，服务 72px 剪影与透明底
  }
  return img
}

// ---- 门禁（§十六 视觉段按类别参数化；色板=扩展色板 ≥minPaletteHit，M5 C13）----
function gates(img, spec) {
  const fails = [], { w, h, rgba } = img
  const corners = [0, (w - 1) * 4, (h - 1) * w * 4, ((h - 1) * w + w - 1) * 4]
  if (!spec.fullBleed && corners.filter(i => rgba[i + 3] > 128).length) fails.push('透明底违规（四角不透明）')
  let opaque = 0, dark = 0, onPal = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] <= 128) continue
    opaque++
    if (palette.some(([pr, pg, pb]) => Math.abs(rgba[i] - pr) <= PAL_TOL && Math.abs(rgba[i + 1] - pg) <= PAL_TOL && Math.abs(rgba[i + 2] - pb) <= PAL_TOL)) onPal++
    if (rgba[i] < 40 && rgba[i + 1] < 45 && rgba[i + 2] < 70) dark++
  }
  const cov = opaque / (w * h)
  if (cov < spec.covMin || cov > spec.covMax) fails.push(`覆盖率 ${(cov * 100).toFixed(0)}% 越界（${spec.covMin * 100}–${spec.covMax * 100}%）`)
  if (spec.cls === 'fx') { // 粒子/光效贴图走软边透明门（C9）：豁免色板硬门与描边要求，改验柔边半透明像素存在
    let semi = 0
    for (let i = 3; i < rgba.length; i += 4) if (rgba[i] > 24 && rgba[i] < 200) semi++
    if (!semi) fails.push('粒子/光效贴图缺少柔边半透明像素')
  } else {
    const palRatio = opaque ? onPal / opaque : 0
    if (palRatio < MIN_PAL_HIT) fails.push(`扩展色板命中率 ${(palRatio * 100).toFixed(1)}% <${MIN_PAL_HIT * 100}%`)
    if (!dark) fails.push('缺少深色描边（bg_night 系）')
  }
  if (spec.cls === 'char') { // 72px 剪影可读
    const sc = 72 / Math.max(w, h), sw = Math.max(1, Math.round(w * sc)), sh = Math.max(1, Math.round(h * sc))
    let c72 = 0; const set72 = new Set()
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
      const i = (Math.min(h - 1, Math.floor((y + 0.5) / sc)) * w + Math.min(w - 1, Math.floor((x + 0.5) / sc))) * 4
      if (rgba[i + 3] > 128) { c72++; set72.add(`${rgba[i]},${rgba[i + 1]},${rgba[i + 2]}`) }
    }
    const r72 = c72 / (sw * sh)
    if (r72 < 0.08 || r72 > 0.95) fails.push(`72px 覆盖率 ${(r72 * 100).toFixed(0)}% 越界`)
    if (set72.size < 2) fails.push('72px 色彩层次 <2（剪影不可读）')
  }
  return fails
}

// ---- 主循环：候选→后处理→评分挑选→门禁→（不过关）带病因重试 ----
const overrides = existsSync(join(root, 'docs/assets/ai/prompt-overrides.json'))
  ? JSON.parse(readFileSync(join(root, 'docs/assets/ai/prompt-overrides.json'), 'utf8')) : {}
const candDir = join(root, 'docs/assets/ai/candidates')
const outDirs = { anchors: 'anchors', houses: 'houses', monsters: 'monsters', weather: 'weather', vfx: 'vfx', fx: 'fx' }
for (const d of new Set(list.map(a => a.mod))) mkdirSync(join(root, 'docs/assets/ai', outDirs[d]), { recursive: true })
mkdirSync(candDir, { recursive: true })

if (!DRY) {
  const est = list.length * N_CAND * N_ROUNDS * PRICE
  console.log(`真跑估算：${list.length} 资产 × ${N_CAND} 候选 × ≤${N_ROUNDS} 轮 ≈ ¥${est.toFixed(0)}（上限，单价 ¥${PRICE}/张）`)
}

const report = { generatedAt: new Date().toISOString(), provider: DRY ? 'mock(--dry)' : `ark:${ARK_MODEL_ID}`, assets: [] }
let passCount = 0

for (const spec of list) {
  const round = { tries: [], status: 'fail' }
  const dir = join(root, 'docs/assets/ai', outDirs[spec.mod])
  mkdirSync(join(candDir, spec.id), { recursive: true })
  for (let rd = 1; rd <= N_ROUNDS && round.status === 'fail'; rd++) {
    const hint = overrides[spec.id] || ''
    const corrective = round.tries.length ? `上一轮问题：${round.tries.at(-1).fails.join('；')}。请针对性修正。` : ''
    const prompt = buildPrompt(spec, hint || corrective ? `${hint} ${corrective}` : null)
    const tryInfo = { round: rd, fails: [], ok: false }
    const processed = []
    for (let i = 0; i < N_CAND; i++) {
      try {
        const seed = BASE_SEED * 100000 + spec.mod.length * 7919 + rd * 997 + i
        let buf = DRY
          ? mockGenerate({ w: spec.w, h: spec.h, seed: seed + spec.w, cls: spec.cls, covMin: spec.covMin, covMax: spec.covMax })
          : await arkGenerate({ prompt, refs: spec.ref ? [spec.ref] : [], w: spec.w, h: spec.h, seed })
        const saved = join(candDir, spec.id, `r${rd}-cand${i}.png`)
        writeFileSync(saved, buf)
        buf = ensurePng(buf, saved)
        let img = decodePng(spec.fullBleed ? buf : rembg(buf, `${spec.id}-r${rd}-${i}`))
        if (img.w !== spec.w || img.h !== spec.h) img = resize(img, spec.w, spec.h)
        processed.push({ img: snapPalette(img, spec.cls !== 'fx'), seed })
      } catch (e) { tryInfo.fails.push(`候选${i}生成失败: ${e.message}`) }
    }
    if (!processed.length) { round.tries.push(tryInfo); continue }
    // 评分：覆盖率贴窗口 + 扩展色板命中率 + 色彩层次 + 深色描边占比（C13 迭代：命中率入评分，防挑中好看但脱板的候选）
    let best = null
    for (const p of processed) {
      const px = p.img.rgba
      let opaque = 0, dark = 0, onPal = 0
      const cs = new Set()
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] <= 128) continue
        opaque++; cs.add(`${px[i]},${px[i + 1]},${px[i + 2]}`)
        if (palette.some(([pr, pg, pb]) => Math.abs(px[i] - pr) <= PAL_TOL && Math.abs(px[i + 1] - pg) <= PAL_TOL && Math.abs(px[i + 2] - pb) <= PAL_TOL)) onPal++
        if (px[i] < 40 && px[i + 1] < 45 && px[i + 2] < 70) dark++
      }
      const cov = opaque / (spec.w * spec.h)
      const mid = (spec.covMin + spec.covMax) / 2, half = (spec.covMax - spec.covMin) / 2
      const score = Math.max(0, 1 - Math.abs(cov - mid) / half) * 100 + (opaque ? onPal / opaque : 0) * 50 + Math.min(cs.size, 8) * 4 + (dark ? 10 : 0)
      if (!best || score > best.score) best = { ...p, score }
    }
    const fails = gates(best.img, spec)
    if (!fails.length) {
      writeFileSync(join(dir, spec.file), encodePng(spec.w, spec.h, best.img.rgba))
      round.status = 'pass'; tryInfo.ok = true
    } else tryInfo.fails = fails
    tryInfo.seed = best.seed; tryInfo.score = Math.round(best.score * 10) / 10
    round.tries.push(tryInfo)
  }
  report.assets.push({ id: spec.id, mod: spec.mod, status: round.status, tries: round.tries, file: round.status === 'pass' ? `docs/assets/ai/${outDirs[spec.mod]}/${spec.file}` : null })
  passCount += round.status === 'pass' ? 1 : 0
  console.log(`${round.status === 'pass' ? '✓' : '✗'} ${spec.id}（${round.tries.length} 轮${round.status === 'pass' ? '' : '，仍不过关：' + round.tries.at(-1)?.fails.join('；')}）`)
}

writeFileSync(join(root, 'docs/assets/ai/ai-report.json'), JSON.stringify(report, null, 2))
console.log(`\nAI 素材闭环：${passCount}/${list.length} 过四门；报告 docs/assets/ai/ai-report.json；候选证据 docs/assets/ai/candidates/`)
console.log('提示词修订通道：编辑 docs/assets/ai/prompt-overrides.json 后重跑（agent 迭代入口）')
process.exit(passCount === list.length ? 0 : 1)
