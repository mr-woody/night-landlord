// M2.5 白盒渲染入口（浏览器运行，无 node:fs）：播放 7 天模拟（D0–D7 体验），
// 驱动主界面风格化渲染 + 点击交互（dock/设置/事件卡入口/模态）+ rAF 帧率采样。
// 打包：npm run build:whitebox（esbuild → whitebox/bundle.js）
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'
import { buildBundle, runSimulation, type AppContext } from '../../../apps/headless/src/sim.ts'
import dayCurveJson from '../../../config/day_curve.json'
import constantsJson from '../../../config/constants.json'
import buildingDefJson from '../../../config/building_def.json'
import eventLibJson from '../../../config/event_lib.json'
import monstersJson from '../../../config/monster.json'
import { WhiteboxRenderer, fpsReport, type DayFrame } from './renderer.ts'
import { col, T } from './theme.ts'
import { createUiState, openModal, closeModal, topModal, type UiState } from './state.ts'
import { DESIGN_W, DESIGN_H, hitTest } from './layout.ts'

const tables = {
  dayCurve: dayCurveJson,
  constants: constantsJson,
  buildingDef: buildingDefJson
}
const app: AppContext = {
  tables,
  formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
  constants: loadConstants(tables.constants.entries),
  eventLib: eventLibJson as unknown as AppContext['eventLib'], // JSON 宽类型收窄（type 字面量联合）
  monsters: monstersJson
}

const kernel = createKernel({ appName: 'nl-whitebox', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
kernel.register([])
const boot = kernel.boot(buildBundle(app))

const canvas = document.getElementById('stage') as HTMLCanvasElement
canvas.width = DESIGN_W   // 750×1624 设计逻辑分辨率（UI 规范 §三）
canvas.height = DESIGN_H
const renderer = new WhiteboxRenderer(canvas, {
  onFps(fps, min, avg) {
    const el = document.getElementById('fps')!
    el.textContent = `FPS ${fps}（min ${min} / avg ${avg}）预算${min >= 50 ? '达标' : '未达标'}`
    el.style.color = min >= 50 ? col('success') : col('danger')
  }
})

const DAY_MS = T.motion.dissolve.dur * 2 // 天回放节奏占位 = 2×dissolve(1.6s)；P3 四相状态机接管真实节奏
let frames: DayFrame[] = []
let idx = 0
const ui: UiState = createUiState()

// 点击 → 命中 → UI 状态机（CSS 像素 → 750 逻辑坐标换算）
canvas.addEventListener('click', ev => {
  const rect = canvas.getBoundingClientRect()
  const x = (ev.clientX - rect.left) * (canvas.width / rect.width)
  const y = (ev.clientY - rect.top) * (canvas.height / rect.height)
  const hit = hitTest(x, y, topModal(ui) !== undefined)
  if (hit.kind === 'modalClose') { Object.assign(ui, closeModal(ui)); return }
  if (hit.kind === 'modal') return
  if (hit.kind === 'dock') {
    if (hit.key === 'night') {
      Object.assign(ui, openModal(ui, { kind: 'confirmNight', id: 'night' }))
    } else {
      Object.assign(ui, openModal(ui, { kind: 'panel', id: hit.key }))
    }
    return
  }
  if (hit.kind === 'settings') {
    Object.assign(ui, openModal(ui, { kind: 'panel', id: 'settings' }))
    return
  }
  if (hit.kind === 'eventEntry') {
    const card = frames[idx]?.eventCards[0]
    if (card) Object.assign(ui, openModal(ui, { kind: 'event', id: card.id, card }))
  }
})

boot.then(() => {
  const sim = runSimulation(app, kernel, { days: 7, seed: 42 })
  let dayStart = performance.now()
  // 冒烟调试入口：?modal=deploy|recruit|upgrade|settings|night 直接开模态（供 headless 截图）
  const want = new URLSearchParams(location.search).get('modal')
  if (want) Object.assign(ui, openModal(ui, want === 'night' ? { kind: 'confirmNight', id: 'night' } : { kind: 'panel', id: want }))
  frames = sim.records.map(r => ({
    day: r.day, population: r.population, roomsBuilt: r.roomsBuilt,
    gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
    deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
    modifiers: r.modifiers, avgLevel: r.avgLevel, panicSum: r.panicSum,
    // 表现层投影：破防房间（r<0.95）与今日事件（weight 高在前，含选项概率供 P3 卡模板用）
    breachedRooms: (sim.sessions[r.day]?.routes ?? []).filter(rt => rt.r < 0.95).map(rt => rt.roomId),
    eventCards: (sim.eventCards[r.day] ?? [])
      .map(c => ({ id: c.id, title: c.title, weight: c.weight, options: c.options }))
      .sort((a, b) => b.weight - a.weight)
  }))
  renderer.start(
    () => {
      const now = performance.now()
      if (now - dayStart >= DAY_MS) { dayStart = now; idx++ }
      if (idx >= frames.length) idx = 0 // 循环播放 D0–D7
      return frames[idx]
    },
    () => ui
  )
  ;(globalThis as unknown as { __fpsReport: () => ReturnType<typeof fpsReport> }).__fpsReport =
    () => fpsReport(renderer.getSamples())
  console.log(`白盒播放就绪：${frames.length} 天，事件 ${sim.eventsFired} 次，独立 ${sim.distinctFired.length}`)
})
