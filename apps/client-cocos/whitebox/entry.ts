// M2.5 白盒渲染入口（浏览器运行，无 node:fs）：一天循环全相交互演示
// （DAWN_SETTLE→DAY→DUSK_FORECAST→NIGHT，门②）+ 主界面/事件卡/夜战/结算渲染
// + rAF 帧率采样。打包：npm run build:whitebox（esbuild → whitebox/bundle.js）
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'
import { buildBundle, runSimulation, type AppContext } from '../../../apps/headless/src/sim.ts'
import dayCurveJson from '../../../config/day_curve.json'
import constantsJson from '../../../config/constants.json'
import buildingDefJson from '../../../config/building_def.json'
import eventLibJson from '../../../config/event_lib.json'
import monstersJson from '../../../config/monster.json'
import type { BattleSession } from '../../../packages/systems/src/index.ts'
import { WhiteboxRenderer, fpsReport, type DayFrame, type Playback } from './renderer.ts'
import { col, motion } from './theme.ts'
import {
  createUiState, openModal, closeModal, topModal, pushEvent, setPage,
  type UiState
} from './state.ts'
import { DESIGN_W, DESIGN_H, hitTest } from './layout.ts'
import { settleDoneAt, nightWaves } from './anim.ts'

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

let frames: DayFrame[] = []
let idx = 0
const ui: UiState = createUiState()
const SKILL_CD_MS = motion('normal').dur * 10 // 主动技 CD 占位 = normal×10（tokens 派生）
const pb: Playback = {
  session: null,
  monsterNames: Object.fromEntries(monstersJson.entries.map(m => [m.id, m.name])),
  nightStart: null,
  settleStart: null,
  chosenAt: null,
  logs: [],
  skills: [
    { label: '空投物资', glyph: '💊', cdUntil: 0 },
    { label: '护盾', glyph: '🛡', cdUntil: 0 }
  ]
}

/** 进入第 d 天的 DAY 相：事件卡插播排队（≤2/日，slots=1+day%2） */
function enterDay(d: number): void {
  idx = d
  ui.phase = 'DAY'
  ui.page = 'main'
  pb.chosenAt = null
  for (const card of frames[d]?.eventCards ?? []) Object.assign(ui, pushEvent(ui, card))
}

// 点击 → 命中 → 相位/模态分发（CSS 像素 → 750 逻辑坐标换算）
canvas.addEventListener('click', ev => {
  const rect = canvas.getBoundingClientRect()
  const x = (ev.clientX - rect.left) * (canvas.width / rect.width)
  const y = (ev.clientY - rect.top) * (canvas.height / rect.height)
  const now = performance.now()
  const modalOpen = topModal(ui) !== undefined
  const hit = hitTest(x, y, { modalOpen, page: ui.page })
  switch (hit.kind) {
    case 'pageBack':
      Object.assign(ui, setPage(ui, 'main'))
      return
    case 'nav':
      Object.assign(ui, setPage(ui, hit.page))
      return
    case 'modalClose': {
      const wasEvent = topModal(ui)?.kind === 'event'
      Object.assign(ui, closeModal(ui))
      if (wasEvent) pb.chosenAt = null
      return
    }
    case 'modalOption': {
      // 事件卡选项：选择即锁定（state.chooseOption）→ 翻面/结果/飞图标时间线启动
      Object.assign(ui, { ...ui, eventQueue: [...ui.eventQueue.slice(0, -1), { ...topModal(ui)!, chosen: 0 }] })
      pb.chosenAt = now
      return
    }
    case 'modalConfirm':
      if (topModal(ui)?.kind === 'confirmNight') {
        Object.assign(ui, closeModal(ui))
        ui.phase = 'DUSK_FORECAST'
      }
      return
    case 'modal':
      return
    case 'duskConfirm':
      if (ui.phase === 'DUSK_FORECAST') {
        ui.phase = 'NIGHT'
        pb.nightStart = now
        pb.session = simSessions[idx + 1] ?? null // frames[idx]=D{idx+1}，其夜战为 sessions[D]
        pb.logs = []
      }
      return
    case 'skill':
      if (ui.phase === 'NIGHT') {
        const sk = pb.skills[hit.index]
        if (sk && now >= sk.cdUntil) {
          sk.cdUntil = now + SKILL_CD_MS
          pb.logs.push(`使用主动技「${sk.label}」（占位演出）`)
        }
      }
      return
    case 'nightBack':
      if (ui.phase === 'NIGHT' && pb.session && pb.nightStart !== null && nightWaves(pb.session.routes, pb.nightStart, now).done) {
        ui.phase = 'DAWN_SETTLE'
        pb.settleStart = now
        pb.logs = []
      }
      return
    case 'settleContinue':
      if (ui.phase === 'DAWN_SETTLE' && pb.settleStart !== null && now >= settleDoneAt(pb.settleStart, settleHouseholds())) {
        pb.settleStart = null
        enterDay((idx + 1) % frames.length) // 一天循环：D1–D7 循环播放
      }
      return
    case 'dock':
      if (hit.key === 'night') Object.assign(ui, openModal(ui, { kind: 'confirmNight', id: 'night' }))
      else Object.assign(ui, openModal(ui, { kind: 'panel', id: hit.key }))
      return
    case 'settings':
      Object.assign(ui, setPage(ui, 'settings'))
      return
    case 'eventEntry': {
      const card = frames[idx]?.eventCards[0]
      if (card) Object.assign(ui, openModal(ui, { kind: 'event', id: card.id, card }))
      return
    }
    default:
      return
  }
})

function settleHouseholds(): number {
  const f = frames[idx]
  return f ? Math.min(f.population, f.roomsBuilt) : 0
}

let simSessions: Record<number, BattleSession> = {}

// 字体就绪（@font-face 子集；失败时回退系统字体不阻塞）
const fontsReady = Promise.all([
  (document as any).fonts.load('bold 24px "SourceHanSansCN-Bold"', '永夜收租人日次布防招募升级血月夜战'),
  (document as any).fonts.load('32px "BebasNeue"', '0123456789D+%.'),
]).catch(() => undefined)

boot.then(async () => {
  const sim = runSimulation(app, kernel, { days: 7, seed: 42 })
  simSessions = sim.sessions
  frames = sim.records.map(r => ({
    day: r.day, population: r.population, roomsBuilt: r.roomsBuilt,
    gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
    deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
    modifiers: r.modifiers, avgLevel: r.avgLevel, panicSum: r.panicSum,
    // 表现层投影：破防房间（r<0.95）与今日事件（weight 高在前，完整元数据供事件卡模板）
    breachedRooms: (sim.sessions[r.day]?.routes ?? []).filter(rt => rt.r < 0.95).map(rt => rt.roomId),
    eventCards: [...(sim.eventCards[r.day] ?? [])].sort((a, b) => b.weight - a.weight)
  }))
  // 冒烟调试入口：?phase=day|dusk|night|dawn 进入对应相；?page=codex|shop|settings 直达占位页
  const want = new URLSearchParams(location.search).get('phase')
  const wantPage = new URLSearchParams(location.search).get('page')
  await fontsReady
  renderer.start(
    () => {
      const f = frames[idx]
      if (!f) return null
      // 事件卡选择后：翻面(normal)→结果浮现→图标飞资源栏(rain) 完毕自动收卡
      const now = performance.now()
      const top = topModal(ui)
      if (top?.kind === 'event' && top.chosen !== undefined && pb.chosenAt !== null &&
          now - pb.chosenAt > motion('normal').dur + motion('rain').dur + motion('fast').dur) {
        Object.assign(ui, closeModal(ui))
        pb.chosenAt = null
      }
      return f
    },
    () => ui,
    () => pb
  )
  ;(globalThis as unknown as { __fpsReport: () => ReturnType<typeof fpsReport> }).__fpsReport =
    () => fpsReport(renderer.getSamples())
  if (want === 'dusk') { idx = 6; ui.phase = 'DUSK_FORECAST' }
  else if (want === 'night') { idx = 6; ui.phase = 'NIGHT'; pb.nightStart = performance.now(); pb.session = simSessions[7] ?? null }
  else if (want === 'dawn') { idx = 6; ui.phase = 'DAWN_SETTLE'; pb.settleStart = performance.now() }
  else enterDay(0)
  if (wantPage === 'codex' || wantPage === 'shop' || wantPage === 'settings') ui.page = wantPage
  console.log(`白盒播放就绪：${frames.length} 天，事件 ${sim.eventsFired} 次，独立 ${sim.distinctFired.length}`)
})
