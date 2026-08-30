// M2.5 白盒渲染入口（浏览器运行，无 node:fs）：一天循环全相交互演示
// （DAWN_SETTLE→DAY→DUSK_FORECAST→NIGHT，门②）+ 主界面/事件卡/夜战/结算渲染
// + rAF 帧率采样。打包：npm run build:whitebox（esbuild → whitebox/bundle.js）
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createGameState, applyEffects, type Tables } from '../../../packages/systems/src/index.ts'
import { createWorldState, dispatchParty, resolveDue, restoreStamina, unlockProgress, worldCapacity, type WorldTables } from '../../../packages/world/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'
import { buildBundle, runSimulation, type AppContext } from '../../../apps/headless/src/sim.ts'
import dayCurveJson from '../../../config/day_curve.json'
import constantsJson from '../../../config/constants.json'
import buildingDefJson from '../../../config/building_def.json'
import eventLibJson from '../../../config/event_lib.json'
import monstersJson from '../../../config/monster.json'
import mapDefJson from '../../../config/map_def.json'
import exploreDefJson from '../../../config/explore_def.json'
import gatherTableJson from '../../../config/gather_table.json'
import wildlifeJson from '../../../config/wildlife.json'
import type { BattleSession } from '../../../packages/systems/src/index.ts'
import { WhiteboxRenderer, fpsReport, type DayFrame, type Playback } from './renderer.ts'
import { col, motion } from './theme.ts'
import {
  createUiState, openModal, closeModal, topModal, pushEvent, setPage,
  openBuilding, openInterior, type UiState
} from './state.ts'
import { DESIGN_W, DESIGN_H, hitTest, dockRects, dockRect, modalCloseRect, modalConfirmRect, modalOptionRect,
  duskConfirmRect, nightSkillRects, nightBackRect, settleContinueRect,
  EXPLORE_ENTRY, wildZoneRect, wildDispatchRect, wildBackRect, wildMinusRect, wildPlusRect,
  settingsRect, settingsRowRect, pageBackRect, houseHitRect, mapBackRect, SETTINGS_ROWS,
  LOTS, isoToScreen, ISO_TILE_H } from './layout.ts'
import { settleDoneAt, nightWaves } from './anim.ts'
import { WILD_ZONE_NAME } from './layout.ts'
import { weatherOfDay } from '@rn/weather'
import weatherJson from '../../../config/weather.json' with { type: 'json' }
import type { WeatherEntry } from '@rn/weather'

// JSON 推断的异构 cost 联合与 Record<string,number> 不兼容——使用点收窄（数据经 check-config 校验）
const tables = {
  dayCurve: dayCurveJson,
  constants: constantsJson,
  buildingDef: buildingDefJson
} as unknown as Tables
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
const NO_MODAL = new URLSearchParams(location.search).has('nomodal') // 冒烟调试：隐藏事件卡
const pb: Playback = {
  session: null,
  monsterNames: Object.fromEntries(monstersJson.entries.map(m => [m.id, m.name])),
  nightStart: null,
  settleStart: null,
  chosenAt: null,
  logs: [],
  forts: {},
  parties: [],
  wildReports: [],
  houseLevels: {},
  skills: [
    { label: '空投物资', glyph: '💊', cdUntil: 0, fxUntil: 0, fxKind: 'supply' },
    { label: '护盾', glyph: '🛡', cdUntil: 0, fxUntil: 0, fxKind: 'shield' },
    { label: '冲击波', glyph: '💥', cdUntil: 0, fxUntil: 0, fxKind: 'wave' }
  ]
}

/** 进入第 d 天的 DAY 相：事件卡插播排队（≤2/日，slots=1+day%2） */
function enterDay(d: number): void {
  idx = d
  ui.phase = 'DAY'
  ui.page = 'map'
  pb.chosenAt = null
  const day = d + 1
  const reports = resolveDue(world, sideState, wtables, app.constants, day)
  restoreStamina(world, sideState, app.constants)
  unlockProgress(world, day, wtables) // 楼栋/地块按 unlockDay 推进解锁（D30 → B/C 栋）
  pb.capacity = worldCapacity(world)
  for (const rp of reports) {
    if (rp.loot.length > 0 || rp.encounters.length > 0) {
      pb.wildReports.push([
        ...rp.loot.map(l => `${l.resource}+${l.amount}`),
        ...rp.encounters
      ])
    }
  }
  syncParties()
  if (!NO_MODAL) for (const card of frames[d]?.eventCards ?? []) Object.assign(ui, pushEvent(ui, card))
}

function syncParties(): void {
  pb.parties = world.parties.map(p => ({ zone: p.zone, size: p.members.length, returnsDay: p.returnsDay }))
}

// 点击 → 命中 → 相位/模态分发（CSS 像素 → 750 逻辑坐标换算）
canvas.addEventListener('click', ev => {
  const rect = canvas.getBoundingClientRect()
  const x = (ev.clientX - rect.left) * (canvas.width / rect.width)
  const y = (ev.clientY - rect.top) * (canvas.height / rect.height)
  const now = performance.now()
  const modalOpen = topModal(ui) !== undefined
  const hit = hitTest(x, y, { modalOpen, page: ui.page, phase: ui.phase })
  switch (hit.kind) {
    case 'pageBack':
      Object.assign(ui, setPage(ui, 'main'))
      return
    case 'mapBack':
      Object.assign(ui, setPage(ui, 'map'))
      return
    case 'interiorBack':
      Object.assign(ui, setPage(ui, 'main'))
      return
    case 'fortSlot': {
      const key = `${ui.sel.floor ?? 0}:${ui.sel.room ?? 0}:${hit.index}`
      pb.forts[key] = !pb.forts[key]
      return
    }
    case 'lot': {
      const lot = hit.id
      if (lot === 'lot_bld_a') Object.assign(ui, openBuilding(ui, lot))
      else if (lot === 'lot_gate') Object.assign(ui, setPage(ui, 'wild')) // 大门=野外入口（L2→L1）
      else Object.assign(ui, openModal(ui, { kind: 'panel', id: lot === 'lot_bld_b' ? 'B栋' : lot === 'lot_bld_c' ? 'C栋' : lot }))
      return
    }
    case 'room':
      Object.assign(ui, openInterior(ui, hit.floor - 1, hit.room))
      return
    case 'explore':
      Object.assign(ui, setPage(ui, 'wild'))
      return
    case 'house':
      Object.assign(ui, openModal(ui, { kind: 'panel', id: `house:${hit.index}` }))
      return
    case 'wildBack':
      Object.assign(ui, setPage(ui, 'map'))
      return
    case 'wildZone':
      ui.sel.wildZone = hit.zone
      ui.sel.partySize = 1
      return
    case 'partyMinus':
      ui.sel.partySize = Math.max(1, (ui.sel.partySize ?? 1) - 1)
      return
    case 'partyPlus':
      ui.sel.partySize = Math.min(3, (ui.sel.partySize ?? 1) + 1)
      return
    case 'wildDispatch': {
      const zone = ui.sel.wildZone
      if (!zone) { Object.assign(ui, openModal(ui, { kind: 'panel', id: '请先选择目的地' })); return }
      const size = ui.sel.partySize ?? 1
      const day = idx + 1
      const r = dispatchParty(world, sideState, wtables, app.constants, { zone, tenantIds: [1, 2, 3].slice(0, size), day })
      syncParties()
      Object.assign(ui, openModal(ui, {
        kind: 'panel',
        id: r.ok ? `派出成功：${size} 人前往${WILD_ZONE_NAME(zone)}${r.partyId !== undefined ? `（队伍#${r.partyId}）` : ''}` : `派出失败：${r.reason ?? ''}`
      }))
      return
    }
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
      } else if (topModal(ui)?.id.startsWith('house:')) {
        // 房屋升级（M3.2 F7）：EffectOp 消耗 building_def.house 成本
        const idx = Number(topModal(ui)!.id.split(':')[1])
        const lv = Math.min(5, pb.houseLevels[idx] ?? 0)
        if (lv >= 5) return
        const cost = (buildingDefJson as any).entries.find((e: any) => e.type === 'house' && e.level === lv + 1)?.cost ?? {}
        const ops = Object.entries(cost).map(([k, n]) => k === 'gold'
          ? { op: 'ADD_GOLD', n: -(n as number) }
          : { op: 'ADD_RES', res: k, n: -(n as number) })
        const r = applyEffects(sideState, ops as any, { constants: app.constants, buildingDef: tables.buildingDef })
        if (r.applied === ops.length) {
          pb.houseLevels[idx] = lv + 1
          Object.assign(ui, closeModal(ui))
        } else {
          Object.assign(ui, openModal(ui, { kind: 'panel', id: '资源不足' }))
        }
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
          sk.fxUntil = now + 1200
          pb.logs.push(`使用主动技「${sk.label}」`)
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
// 野外探索（@rn/world 真实逻辑；独立副状态，M3.3 与主经济深度咬合）
const wtables: WorldTables = {
  mapDef: mapDefJson, exploreDef: exploreDefJson, gatherTable: gatherTableJson,
  wildlife: wildlifeJson, buildingDef: buildingDefJson
} as unknown as WorldTables
const sideState = createGameState(42)
const world = createWorldState(42, wtables)
/** 房屋等级（M3.2 F7：升级交互；EffectOp 消耗 building_def.house 成本） */

// 字体就绪（@font-face 子集；失败时回退系统字体不阻塞）
const fontsReady = Promise.all([
  (document as any).fonts.load('bold 24px "SourceHanSansCN-Bold"', '永夜收租人日次布防招募升级血月夜战'),
  (document as any).fonts.load('32px "BebasNeue"', '0123456789D+%.'),
]).catch(() => undefined)

boot.then(async () => {
  const sim = runSimulation(app, kernel, { days: 30, seed: 42 }) // 全程 30 天回放（D1–D30，含 D30 解锁日）
  simSessions = sim.sessions
  frames = sim.records.map(r => ({
    day: r.day, population: r.population, roomsBuilt: r.roomsBuilt,
    gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
    deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
    modifiers: r.modifiers, avgLevel: r.avgLevel, panicSum: r.panicSum,
    // 表现层投影：破防房间（r<0.95）与今日事件（weight 高在前，完整元数据供事件卡模板）
    breachedRooms: (sim.sessions[r.day]?.routes ?? []).filter(rt => rt.r < 0.95).map(rt => rt.roomId),
    eventCards: [...(sim.eventCards[r.day] ?? [])].sort((a, b) => b.weight - a.weight),
    weather: weatherOfDay(r.day, 42, { weather: weatherJson as unknown as { entries: WeatherEntry[] } }).id
  }))
  // 冒烟调试入口：?phase=day|dusk|night|dawn 进入对应相；?page=codex|shop|settings 直达占位页
  const want = new URLSearchParams(location.search).get('phase')
  const wantPage = new URLSearchParams(location.search).get('page')
  const wantDay = Number(new URLSearchParams(location.search).get('day') ?? '0')
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
  // 白盒验收钩子（M4 E2E v3）：热区取自 layout.ts 单一来源，断言取自真实状态机
  const g = globalThis as unknown as Record<string, unknown>
  g.__nlRects = () => ({
    dock: dockRects(), dockNight: dockRect('night'),
    modalClose: modalCloseRect(), modalConfirm: modalConfirmRect(), modalOption: modalOptionRect(),
    duskConfirm: duskConfirmRect(), nightSkills: nightSkillRects(), nightBack: nightBackRect(),
    settleContinue: settleContinueRect(), explore: EXPLORE_ENTRY,
    wildZones: [0, 1, 2, 3].map(wildZoneRect), wildDispatch: wildDispatchRect(),
    wildBack: wildBackRect(), wildMinus: wildMinusRect(), wildPlus: wildPlusRect(),
    settings: settingsRect(), settingsRows: SETTINGS_ROWS.map((_, i) => settingsRowRect(i)),
    pageBack: pageBackRect(), house0: houseHitRect(0), mapBack: mapBackRect(),
    // 等距地块命中框（与 layout.hitTest map 分支同几何：bld bw=100/bh=230）
    lot_bld_b: (() => { const l = LOTS.lot_bld_b; const c = isoToScreen(l.gx, l.gy); const cy = c.y + ISO_TILE_H / 2; return { x: c.x - 50, y: cy - 230, w: 100, h: 260 } })(),
    lot_bld_c: (() => { const l = LOTS.lot_bld_c; const c = isoToScreen(l.gx, l.gy); const cy = c.y + ISO_TILE_H / 2; return { x: c.x - 50, y: cy - 230, w: 100, h: 260 } })()
  })
  g.__nlState = () => {
    const f = frames[idx]
    const now = performance.now()
    const top = topModal(ui)
    const nw = pb.session && pb.nightStart !== null ? nightWaves(pb.session.routes, pb.nightStart, now) : null
    return {
      phase: ui.phase, page: ui.page, day: idx + 1,
      modal: top ? { kind: top.kind, id: top.id, chosen: top.chosen } : null,
      sel: { wildZone: ui.sel.wildZone ?? null, partySize: ui.sel.partySize ?? null },
      modifiers: f?.modifiers ?? [],
      gold: f?.gold ?? null, population: f?.population ?? null, roomsBuilt: f?.roomsBuilt ?? null,
      weather: f?.weather ?? null, capacity: pb.capacity ?? null,
      parties: pb.parties.length, wildReports: pb.wildReports.length,
      houseLevels: { ...pb.houseLevels },
      skills: pb.skills.map(s => ({ label: s.label, onCd: now < s.cdUntil, fx: now < s.fxUntil })),
      waves: nw ? { waveNo: nw.waveNo, revealed: nw.revealed, done: nw.done } : null,
      settleDone: pb.settleStart !== null ? now >= settleDoneAt(pb.settleStart, settleHouseholds()) : null
    }
  }
  if (want === 'dusk') { idx = 6; ui.phase = 'DUSK_FORECAST' }
  else if (want === 'night') { idx = 6; ui.phase = 'NIGHT'; pb.nightStart = performance.now(); pb.session = simSessions[7] ?? null }
  else if (want === 'dawn') { idx = 6; ui.phase = 'DAWN_SETTLE'; pb.settleStart = performance.now() }
  else enterDay(0)
  if (wantDay >= 1 && wantDay <= frames.length) enterDay(wantDay - 1)
  if (wantPage) ui.page = wantPage as UiState['page']
  const wantModal = new URLSearchParams(location.search).get('modal')
  if (wantModal === 'night') Object.assign(ui, openModal(ui, { kind: 'confirmNight', id: 'night' }))
  else if (wantModal) Object.assign(ui, openModal(ui, { kind: 'panel', id: wantModal }))
  console.log(`白盒播放就绪：${frames.length} 天，事件 ${sim.eventsFired} 次，独立 ${sim.distinctFired.length}`)
})
