// @rn/headless —— 无头运行器（M1 硬性验收，内核档 §5.7）。
// 命令：simulate / verify / replay / diagnose / depgraph
// 架构：kernel.boot(bundle) → 经服务（formula/game/battle/director/persistence）驱动日循环；
//       逻辑包零平台依赖；uniform 策略属应用层，允许读配置表。
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createKernel, definePlugin, type Kernel, type PluginDeclaration } from '@rn/kernel'
import { createDiagPlugin } from '@rn/diag'
import { createDayRng, createRngStreams, hash32, canonicalJson } from '@rn/core'
import { createFormula, loadConstants, levelForU, type Quality } from '@rn/formula'
import {
  createGameState, serialize, deserialize, checkInvariants, applyEffects,
  settleDawn, runNight, canteenCap, type GameState, type Tables, type BattleSession, type EffectOp
} from '@rn/systems'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const loadJson = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T

interface AppContext {
  tables: Tables
  formula: ReturnType<typeof createFormula>
  constants: Record<string, number>
}

export function loadApp(): AppContext {
  const tables: Tables = {
    dayCurve: loadJson('config/day_curve.json'),
    constants: loadJson('config/constants.json'),
    buildingDef: loadJson('config/building_def.json')
  }
  return {
    tables,
    formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
    constants: loadConstants(tables.constants.entries)
  }
}

interface DirectorService {
  scriptedEffectsFor(day: number, state: GameState): { id: string; effects: EffectOp[] }[]
  selectDay(state: GameState, day: number): { id: string; effects: EffectOp[] }[]
  planNight(state: GameState, day: number): { day: number; routes: { roomId: string; hp: number }[]; modifiers: string[]; seed: number }
}
interface BattleService { run(state: GameState, plan: Parameters<typeof runNight>[1]): BattleSession }
interface GameService { tables: Tables; createState(seed: number): GameState }


interface EventLibEntry {
  id: string; ver: number; type: 'scripted' | 'choice' | 'mission'; title: string
  weight: number; cooldownDays: number; maxPerRun: number
  prereq?: { dayMin?: number; dayMax?: number; panicMin?: number; panicMax?: number; reputationMin?: number; flags?: Record<string, number> }
  triggerDay?: number
  text?: string
  options: { label: string; outcomes: { p: number; text?: string; effects: EffectOp[] }[] }[]
}

/** outcome 按 p 掷骰（日域确定性 RNG）；tenantId=-1 解析为随机住户。 */
function rollOutcome(e: EventLibEntry, state: GameState, day: number, rng: { next(): number }): EffectOp[] {
  const option = e.options[0]
  if (!option) return []
  let roll = rng.next()
  let picked = option.outcomes[option.outcomes.length - 1]
  for (const oc of option.outcomes) { roll -= oc.p; if (roll > 0) continue; picked = oc; break }
  const resolve = (op: EffectOp): EffectOp => {
    if ((op.op === 'KILL_TENANT' || op.op === 'WOUND_TENANT') && op.tenantId === -1) {
      if (state.tenants.length === 0) return { op: 'SET_FLAG', key: 'noop', v: 1 }
      const victim = state.tenants[Math.floor(rng.next() * state.tenants.length)]
      return { ...op, tenantId: victim.id } as EffectOp
    }
    return op
  }
  const bookkeep: EffectOp[] = [
    { op: 'SET_FLAG', key: `fired_${e.id}`, v: (state.flags[`fired_${e.id}`] ?? 0) + 1 },
    { op: 'SET_FLAG', key: `last_${e.id}`, v: day }
  ]
  return [...picked.effects.map(resolve), ...bookkeep]
}

// ---- M1 bundle（内核档 §2.5 headlessBundle 子集；+devtools 为 devBundle）----
export function buildBundle(app: AppContext, options: { devtools?: boolean } = {}): PluginDeclaration[] {
  const diag = createDiagPlugin()
  const formula = definePlugin({
    name: 'rn.formula', version: '0.1.0', hotplug: 'core',
    depends: [], provides: ['formula'], produces: [],
    hooks: { setup(ctx) { ctx.provide('formula', app.formula) } }
  })
  const save = definePlugin({
    name: 'rn.save', version: '0.1.0', hotplug: 'core',
    depends: [], provides: ['persistence'], produces: [],
    hooks: {
      setup(ctx) {
        const store = new Map<string, string>()
        ctx.provide('persistence', {
          put(slot: string, json: string): void { store.set(slot, json) },
          get(slot: string): string | undefined { return store.get(slot) },
          size(): number { return store.size }
        })
      }
    }
  })
  const systems = definePlugin({
    name: 'rn.systems', version: '0.1.0', hotplug: 'core',
    depends: [{ service: 'formula' }, { service: 'persistence' }],
    provides: ['game'], produces: [],
    hooks: {
      setup(ctx) {
        ctx.provide('game', { tables: app.tables, createState: (seed: number): GameState => createGameState(seed) })
      }
    }
  })
  const battle = definePlugin({
    name: 'rn.battle', version: '0.1.0', hotplug: 'standard',
    depends: [{ service: 'game' }, { service: 'formula' }],
    provides: ['battle'], produces: ['battle/result'],
    hooks: {
      setup(ctx) {
        ctx.provide('battle', {
          run: (state: GameState, plan: Parameters<typeof runNight>[1]): BattleSession =>
            runNight(state, plan, {
              formula: app.formula, constants: app.constants, buildingDef: app.tables.buildingDef,
              dayRng: createDayRng(state.seed, 'monster', plan.day),
              audit: { record: (kind, actor, detail): void => { ctx.emit('battle/result', { kind, actor, detail }) } }
            })
        })
      }
    }
  })
  const director = definePlugin({
    name: 'rn.director', version: '0.2.0', hotplug: 'standard',
    depends: [{ service: 'game' }, { service: 'formula' }],
    provides: ['director'], produces: ['event/fired', 'night/plan'],
    hooks: {
      setup(ctx) {
        ctx.provide('director', {
          scriptedEffectsFor(day: number, state: GameState): { id: string; effects: EffectOp[] }[] {
            const lib = loadJson<{ entries: EventLibEntry[] }>('config/event_lib.json')
            return lib.entries
              .filter(e => e.type === 'scripted' && ((e.triggerDay ?? 0) === day || (day === 1 && (e.triggerDay ?? 99) === 0)))
              .map(e => ({ id: e.id, effects: rollOutcome(e, state, day, createDayRng(app.tables.dayCurve.version, 'event', day * 100 + (e.triggerDay ?? 0))) }))
          },
          /** M2 条件触发版：权重×频控×prereq 抽取 + 保底池（内核档 §5.4） */
          selectDay(state: GameState, day: number): { id: string; effects: EffectOp[] }[] {
            const lib = loadJson<{ entries: EventLibEntry[] }>('config/event_lib.json')
            const slots = 1 + (day % 2)
            const rng = createDayRng(app.tables.dayCurve.version, 'director', day)
            const avgPanic = state.tenants.length ? state.tenants.reduce((a, t) => a + t.panic, 0) / state.tenants.length : 0
            const eligible = (e: EventLibEntry): boolean => {
              if (e.type === 'scripted') return false
              const pr = e.prereq ?? {}
              if (day < (pr.dayMin ?? 0) || (pr.dayMax !== undefined && day > pr.dayMax)) return false
              if (pr.panicMax !== undefined && avgPanic > pr.panicMax) return false
              if (pr.panicMin !== undefined && avgPanic < pr.panicMin) return false
              if (pr.reputationMin !== undefined && (state.flags.reputation ?? 0) < pr.reputationMin) return false
              for (const [k, v] of Object.entries(pr.flags ?? {})) if ((state.flags[k] ?? 0) < v) return false
              if ((state.flags[`fired_${e.id}`] ?? 0) >= e.maxPerRun) return false
              const last = state.flags[`last_${e.id}`] ?? -99
              if (day - last < e.cooldownDays) return false
              return true
            }
            const pool = lib.entries.filter(e => eligible(e)).map(e => ({ e, w: e.weight }))
            const chosen: EventLibEntry[] = []
            for (let s = 0; s < slots && pool.length > 0; s++) {
              const total = pool.reduce((a, x) => a + x.w, 0)
              let roll = rng.next() * total
              let picked = pool[pool.length - 1]
              for (const x of pool) { roll -= x.w; if (roll <= 0) { picked = x; break } }
              pool.splice(pool.indexOf(picked), 1)
              chosen.push(picked.e)
            }
            if (chosen.length === 0) {
              const fb = lib.entries.filter(e => ['evt_ord_207', 'evt_box_003', 'evt_birthday_013'].includes(e.id) && eligible(e))
              if (fb.length) chosen.push(fb[Math.floor(rng.next() * fb.length)])
            }
            return chosen.map(e => ({ id: e.id, effects: rollOutcome(e, state, day, rng) }))
          },
          planNight(state: GameState, day: number) {
            const row = app.formula.row(day)
            const rng = createDayRng(state.seed, 'monster', day)
            // 怪物三段式 AI 最简版：感知（有住户的房间）→ 决策（均匀分散，血月 +1 路由 W 表达）→ 执行（破门点即房间）
            const occupied = Array.from({ length: Math.min(state.tenants.length, state.roomsBuilt) }, (_, i) => `F1-R${i + 1}`)
            const pool = occupied.length > 0 ? occupied : ['F1-R1']
            // 特殊夜三机制调度（白盒固定时刻表：避开教学日与血月日，台账 §3 记录）
            const modifiers: string[] = app.formula.bloodMoon(day) ? ['BLOOD_MOON'] : []
            if (!app.formula.bloodMoon(day) && (day === 17 || day === 25)) modifiers.push('SILENT')
            if (day === 11 || day === 26) modifiers.push('MIGRATE')
            // 怪物按 usableNightMods 过滤（monster.json 生效）
            const monsters = loadJson<{ entries: { id: string; name: string; active: boolean; unlockDay: number; usableNightMods: string[] }[] }>('config/monster.json')
            const candidates = monsters.entries.filter(m =>
              m.active && m.unlockDay <= day &&
              (m.usableNightMods.includes('NORMAL') || m.usableNightMods.some(x => modifiers.includes(x))))
            const routes = Array.from({ length: row.routes }, (_, i) => {
              const m = candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : undefined
              return { roomId: pool[Math.floor(rng.next() * pool.length)], hp: row.hp, monsterId: m?.id ?? 'm_seeker' }
            })
            return { day, routes, modifiers, seed: rng.next() }
          }        })
      }
    }
  })
  const list: PluginDeclaration[] = [diag, formula, save, systems, battle, director]
  if (options.devtools) {
    list.push(definePlugin({
      name: 'rn.devtools', version: '0.1.0', hotplug: 'scope',
      depends: [], provides: ['devtools'], produces: [],
      hooks: {
        setup(ctx) {
          ctx.provide('devtools', {
            dump(): Record<string, unknown> { return { plugin: 'rn.devtools', note: 'M1 雏形：健康/日志由 diagnose 命令输出' } }
          })
        }
      }
    }))
  }
  return list
}

// ---- uniform 策略（F2P 中位数基准）----
interface DayRecord {
  day: number; population: number; gold: number; income: number; power: number
  rAvg: number; deaths: number; wounds: number; sessionHash: string; invariantErrors: string[]
  events: number; checkpoints: number; avgLevel: number; targetLevel: number
}

/** 招募池权重求解：在 {N:1,R:1.5,SR:2.5,SSR:5} 上两两混合出期望品质 E（确定性）。 */
function weightsFor(E: number): Record<Quality, number> {
  const e = Math.max(1, Math.min(5, E))
  if (e <= 1.5) { const wR = (e - 1) / 0.5; return { N: 1 - wR, R: wR, SR: 0, SSR: 0 } }
  if (e <= 2.5) { const wR = 2.5 - e, wSR = e - 1.5; return { N: 0, R: wR, SR: wSR, SSR: 0 } }
  const wSR = (5 - e) / 2.5, wSSR = (e - 2.5) / 2.5
  return { N: 0, R: 0, SR: wSR, SSR: wSSR }
}

function target(d: number, t: Tables): number {
  return t.dayCurve.rows.find(r => r.day === d)?.population ?? 30
}

export function runSimulation(
  app: AppContext, kernel: Kernel, options: { days: number; seed: number }
): { records: DayRecord[]; finalHash: string; findings: string[]; sessions: Record<number, BattleSession>; eventsFired: number; distinctFired: string[] } {
  const { tables, constants } = app
  const formula = kernel.service<ReturnType<typeof createFormula>>('formula')
  const director = kernel.service<DirectorService>('director')
  const battle = kernel.service<BattleService>('battle')
  const persistence = kernel.service<{ put(slot: string, json: string): void; get(slot: string): string | undefined }>('persistence')
  const state: GameState = kernel.service<GameService>('game').createState(options.seed)
  const rng = createRngStreams(options.seed)
  const records: DayRecord[] = []
  const sessions: Record<number, BattleSession> = {}
  const findings: string[] = []
  const distinctFired = new Set<string>()
  let eventsFired = 0
  let checkpoints = 0

  for (let d = 1; d <= options.days; d++) {
    state.day = d
    state.phase = 'DAY'
    const row = tables.dayCurve.rows.find(r => r.day === d)!
    // 食堂扩容
    while (state.canteenLevel < 5) {
      const next = tables.buildingDef.entries.find(b => b.type === 'canteen' && b.level === state.canteenLevel + 1)
      if (!next || canteenCap(state, tables.buildingDef) >= target(d, tables)) break
      if (state.resources.gold < (next.cost.gold ?? 0)) break
      state.resources.gold -= next.cost.gold ?? 0
      state.canteenLevel++
    }
    // 建房
    while (
      state.roomsBuilt < Math.min(target(d, tables), canteenCap(state, tables.buildingDef)) &&
      state.resources.gold >= constants.M1_ROOM_GOLD
    ) {
      state.resources.gold -= constants.M1_ROOM_GOLD
      state.roomsBuilt++
    }
    // 防御投资（优先级 1：目标 fReq(d)）
    const need = Math.max(0, formula.fReq(d) - state.defense.power)
    const invest = Math.min(Math.ceil(need * constants.CFG_K_POWER), state.resources.gold)
    state.resources.gold -= invest
    state.defense.power += Math.floor(invest / constants.CFG_K_POWER)
    // 招募补位至人口目标（优先级 2；品质池权重按“存量品质缺口”求解，使结构平均跟踪 q(d)）
    const stockQ = state.tenants.reduce((a, x) => a + constants.CFG_QUALITY_MUL_N * 0 + ({ N: 1, R: 1.5, SR: 2.5, SSR: 5 } as Record<Quality, number>)[x.quality], 0)
    const popTarget2 = target(d, tables)
    const newRecruits = Math.max(1, popTarget2 - state.tenants.length)
    const needE = Math.max(1, Math.min(5, (row.q * popTarget2 - stockQ) / newRecruits))
    const w = weightsFor(needE)
    while (
      state.tenants.length < Math.min(target(d, tables), state.roomsBuilt, canteenCap(state, tables.buildingDef)) &&
      state.resources.gold >= constants.M1_RECRUIT_GOLD
    ) {
      state.resources.gold -= constants.M1_RECRUIT_GOLD
      const roll = rng.next('tenant')
      let acc = 0
      let q: Quality = 'N'
      for (const quality of ['SSR', 'SR', 'R', 'N'] as Quality[]) {
        acc += w[quality]
        if (roll >= 1 - acc) { q = quality; break }
      }
      const r = applyEffects(state, [{ op: 'SPAWN_TENANT', quality: q }], { constants, buildingDef: tables.buildingDef })
      if (r.applied === 0) break
    }
    // 住户升级（优先级 3：跟踪设计 u 曲线，最便宜优先——FINDING-1 闭环）
    const targetLevel = levelForU(row.u, constants.CFG_G_U)
    let bought = 0
    for (;;) {
      const needy = [...state.tenants].filter(x => x.level < targetLevel).sort((a, b) => a.level - b.level)[0]
      if (!needy) break
      const r = applyEffects(state, [{ op: 'UPGRADE_TENANT', tenantId: needy.id }], { constants, buildingDef: tables.buildingDef })
      if (r.applied === 0) break
      bought++
    }
    // 事件：scripted（A 组 triggerDay 特权）+ selectDay（条件触发版）
    const todays = [...director.scriptedEffectsFor(d, state), ...director.selectDay(state, d)]
    let events = 0
    for (const ev of todays) {
      applyEffects(state, ev.effects, { constants, buildingDef: tables.buildingDef })
      events++
      distinctFired.add(ev.id)
    }
    eventsFired += events
    persistence.put(`ckpt_${d}_day`, serialize(state))
    checkpoints++

    // DUSK：夜计划（SILENT = 无预告，考验冗余布防）
    state.phase = 'DUSK_FORECAST'
    const plan = director.planNight(state, d)
    console.log(`  [DUSK D${d}] ${plan.modifiers.length ? '特殊夜:' + plan.modifiers.join('/') : '标准夜'} ${plan.modifiers.includes('SILENT') ? '——无预告' : '预告 ' + plan.routes.length + ' 路'}`)
    persistence.put(`ckpt_${d}_dusk`, serialize(state))
    checkpoints++

    // NIGHT：路级判定
    state.phase = 'NIGHT'
    const session = battle.run(state, plan)
    sessions[d] = session
    persistence.put(`ckpt_${d}_night`, serialize(state))
    checkpoints++

    // DAWN：收租结算（死亡后的收入线即时断裂）
    state.phase = 'DAWN_SETTLE'
    const settle = settleDawn(state, { formula, constants, rng })
    const rAvg = session.routes.length ? session.routes.reduce((a, r) => a + r.r, 0) / session.routes.length : 9.99
    const invariantErrors = checkInvariants(state, { canteenCap: canteenCap(state, tables.buildingDef), warehouseCap: 30000 })
    records.push({
      day: d, population: state.tenants.length, gold: state.resources.gold,
      income: settle.income, power: state.defense.power, rAvg: Math.round(rAvg * 1000) / 1000,
      deaths: session.deaths, wounds: session.wounds, sessionHash: session.settlementHash,
      invariantErrors, events, checkpoints: 3,
      avgLevel: state.tenants.length ? Math.round(state.tenants.reduce((a, t) => a + t.level, 0) / state.tenants.length * 10) / 10 : 0, targetLevel
    })
    void checkpoints
  }
  const finalHash = hash32(canonicalJson(records))
  const simBeta = betaSim(records, tables)
  const designed = [17, 27, 42, 58]
  for (let i = 0; i < simBeta.length; i++) {
    if (Math.abs(simBeta[i] - designed[i]) > 5) {
      findings.push(`β_sim D${[1, 8, 15, 22][i]}-=${simBeta[i]}% vs 设计 ${designed[i]}%：白盒基础经济无 u 线深度（M0 §3.2 部件，M2 实现住户升级线），见证据台账 FINDING-1`)
    }
  }
  return { records, finalHash, findings, sessions, eventsFired, distinctFired: [...distinctFired] }
}

function betaSim(records: DayRecord[], tables: Tables): number[] {
  const windows: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28]]
  return windows.map(([s, e]) => {
    const fStart = s === 1 ? tables.dayCurve.rows[0].fReq : (records.find(r => r.day === s - 1)?.power ?? tables.dayCurve.rows[s - 1].fReq)
    const fEnd = records.find(r => r.day === e)?.power ?? 0
    const sumI = records.filter(r => r.day >= s && r.day <= e).reduce((a, r) => a + r.income, 0)
    if (sumI === 0) return 0
    return Math.round(((fEnd - fStart) * 2.6) / sumI * 1000) / 10
  })
}

// ---- 命令 ----
function cmdSimulate(app: AppContext, kernel: Kernel, args: Record<string, string>): number {
  const days = Number(args.days ?? 30)
  const seed = Number(args.seed ?? 42)
  const sim = runSimulation(app, kernel, { days, seed })
  for (const r of sim.records) {
    console.log(`D${String(r.day).padStart(2)} 人口${String(r.population).padStart(3)} 金币${String(r.gold).padStart(7)} 租金${String(r.income).padStart(6)} 战力${String(r.power).padStart(6)} r均${String(r.rAvg).padStart(6)} 死${r.deaths} hash=${r.sessionHash}${r.invariantErrors.length ? ' ⚠' + r.invariantErrors.join(',') : ''}`)
  }
  console.log(`\nfinalHash=${sim.finalHash}  累计死亡=${sim.records.reduce((a, r) => a + r.deaths, 0)}  教学事件=${sim.eventsFired}`)
  sim.findings.forEach(f => console.log(`FINDING: ${f}`))
  if (args.out) writeFileSync(resolve(ROOT, args.out), JSON.stringify(sim, null, 2))
  return 0
}

function cmdVerify(app: AppContext, kernel: Kernel, args: Record<string, string>): number {
  const results: { name: string; ok: boolean; detail: string }[] = []
  const cfg = spawnSync('node', ['scripts/check-config.mjs'], { cwd: ROOT, encoding: 'utf8' })
  results.push({ name: 'V0 config-schema', ok: cfg.status === 0, detail: cfg.status === 0 ? '六张表全部通过' : String(cfg.stderr).slice(0, 300) })

  const anchors = app.formula.designAnchors()
  results.push({ name: 'V1 D1 income=1000±5%', ok: Math.abs(anchors.d1Income - 1000) / 1000 <= 0.05, detail: `d1=${anchors.d1Income}` })
  results.push({ name: 'V2 r(7)=1.02±0.05', ok: Math.abs(anchors.r7 - 1.02) <= 0.05, detail: `r7=${Math.round(anchors.r7 * 1000) / 1000}` })
  const expectedBeta = [17, 27, 42, 58]
  anchors.betaByCycle.forEach((b, i) => {
    results.push({ name: `V3 β ${b.window}=${expectedBeta[i]}±5pp`, ok: Math.abs(b.beta - expectedBeta[i]) <= 5, detail: `β=${b.beta}%` })
  })

  if (args.design === undefined) {
    const a = runSimulation(app, kernel, { days: 30, seed: 42 })
    const b = runSimulation(app, kernel, { days: 30, seed: 42 })
    results.push({ name: 'V4 determinism', ok: a.finalHash === b.finalHash, detail: `${a.finalHash} vs ${b.finalHash}` })
    const r7 = a.records.find(r => r.day === 7)
    results.push({ name: 'V5 sim r(7)=1.02±0.05', ok: !!r7 && Math.abs(r7.rAvg - 1.02) <= 0.05, detail: `rAvg=${r7?.rAvg}` })
    const deaths = a.records.reduce((x, r) => x + r.deaths, 0)
    results.push({ name: 'V6 deaths ≤ GUARD_DEATH_30D', ok: deaths <= app.constants.GUARD_DEATH_30D, detail: `deaths=${deaths}` })
    const bad = a.records.filter(r => r.invariantErrors.length > 0)
    results.push({ name: 'V7 invariants clean', ok: bad.length === 0, detail: bad.length ? bad.map(r => `D${r.day}:${r.invariantErrors.join(',')}`).join('; ') : 'clean' })
    results.push({ name: 'V8 事件覆盖 ≥80%', ok: a.distinctFired.length >= 34, detail: `独立触发 ${a.distinctFired.length}/42，总次数 ${a.eventsFired}` })
    // M2 硬门：β_sim 四周期 ±5pp（FINDING-1 闭环）
    const simBeta = betaSim(a.records, app.tables)
    const designedBeta = [17, 27, 42, 58]
    simBeta.forEach((bv, i) => {
      results.push({ name: `V9 β_sim ${['D1-7', 'D8-14', 'D15-21', 'D22-28'][i]}=${designedBeta[i]}±5pp`, ok: Math.abs(bv - designedBeta[i]) <= 5, detail: `β_sim=${bv}%` })
    })
    // M2 硬门：模拟收入回落至设计曲线 ±10%（聚合 ΣI）
    const sumTable = app.tables.dayCurve.rows.filter((r: { day: number; income: number }) => r.day >= 1 && r.day <= 30).reduce((x: number, r: { income: number }) => x + r.income, 0)
    const sumSim = a.records.reduce((x, r) => x + r.income, 0)
    results.push({ name: 'V10 ΣI within ±10% of design', ok: Math.abs(sumSim - sumTable) / sumTable <= 0.1, detail: `sim=${sumSim} vs design=${sumTable}` })
  }

  let ok = true
  for (const r of results) {
    if (r.name === 'FINDING') { console.log(`NOTE  ${r.detail}`); continue }
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}  (${r.detail})`)
    if (!r.ok) ok = false
  }
  console.log(ok ? 'verify: ALL GREEN' : 'verify: FAILED')
  return ok ? 0 : 1
}

function cmdReplay(app: AppContext, kernel: Kernel, args: Record<string, string>): number {
  const seed = Number(args.seed ?? 42)
  const day = Number(args.day ?? 7)
  const sim = runSimulation(app, kernel, { days: day, seed })
  const session = sim.sessions[day]
  if (!session) { console.error(`no session at D${day}`); return 1 }
  const state = deserialize(serialize(createGameState(seed)))
  state.day = day
  state.defense.power = session.power
  const replayed = runNight(state, session.plan, { formula: app.formula, constants: app.constants, buildingDef: app.tables.buildingDef, dayRng: createDayRng(seed, 'monster', day) })
  const ok = replayed.settlementHash === session.settlementHash
  console.log(`replay D${day}: ${session.settlementHash} vs ${replayed.settlementHash} → ${ok ? 'MATCH' : 'MISMATCH'}`)
  return ok ? 0 : 1
}

async function cmdDiagnose(app: AppContext): Promise<number> {
  const kernel = createKernel({ appName: 'nl-headless', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
  await kernel.boot(buildBundle(app, { devtools: true }))
  console.log('== plugins ==')
  for (const h of kernel.healthAll()) console.log(`  ${h.name.padEnd(14)} ${h.status}${h.detail ? ' — ' + h.detail : ''}`)
  const logger = kernel.service<{ tail(n: number): { level: string; channel: string; msg: string }[] }>('logger')
  console.log('== 日志环尾 5 ==')
  for (const e of logger.tail(5)) console.log(`  [${e.level}] ${e.channel} ${e.msg}`)
  console.log('diagnose: ok')
  return 0
}

async function cmdDepgraph(app: AppContext, args: Record<string, string>): Promise<number> {
  const kernel = createKernel({ appName: 'nl-headless', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
  await kernel.boot(buildBundle(app))
  const graph = kernel.exportGraph()
  if (args.out) writeFileSync(resolve(ROOT, args.out), JSON.stringify(graph, null, 2))
  if (args.check !== undefined) {
    // FR-D3：无环（resolve 已保证）+ 分层（内核档 §4.1）
    const layers: Record<string, number> = {
      'rn.kernel': 0, 'rn.config': 1, 'rn.diag': 1, 'rn.control': 2, 'rn.formula': 2,
      'rn.core-loop': 3, 'rn.save': 3, 'rn.systems': 4, 'rn.battle': 5, 'rn.director': 5,
      'rn.stabilizer': 5, 'rn.observability': 6, 'rn.ads': 6, 'rn.iap': 6, 'rn.cloud': 6, 'rn.devtools': 6
    }
    let ok = true
    for (const e of graph.edges) {
      const lf = layers[e.from]
      const lt = layers[e.to]
      if (lf === undefined || lt === undefined) { console.log(`SKIP  ${e.from}→${e.to}（未知层级，M2 插件）`); continue }
      if (lt >= lf) { console.log(`FAIL  分层违规 ${e.from}(L${lf}) → ${e.to}(L${lt})`); ok = false }
    }
    console.log(`depgraph: ${graph.nodes.length} 节点 / ${graph.edges.length} 边，${ok ? '分层校验通过' : '分层校验失败'}`)
    return ok ? 0 : 1
  }
  console.log(JSON.stringify(graph, null, 2))
  return 0
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const cmd = argv[0] ?? ''
  const args: Record<string, string> = {}
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const next = argv[i + 1]
      if (next !== undefined && !next.startsWith('--')) { args[a.slice(2)] = next; i++ }
      else args[a.slice(2)] = 'true'
    }
  }
  const app = loadApp()
  const kernel = createKernel({ appName: 'nl-headless', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
  await kernel.boot(buildBundle(app))
  let code = 0
  if (cmd === 'simulate') code = cmdSimulate(app, kernel, args)
  else if (cmd === 'verify') code = cmdVerify(app, kernel, args)
  else if (cmd === 'replay') code = cmdReplay(app, kernel, args)
  else if (cmd === 'diagnose') code = await cmdDiagnose(app)
  else if (cmd === 'depgraph') code = await cmdDepgraph(app, args)
  else { console.error('用法: main.ts simulate|verify|replay|diagnose|depgraph [--days N] [--seed S] [--out f] [--check] [--design]'); code = 2 }
  process.exitCode = code
}

void main()
