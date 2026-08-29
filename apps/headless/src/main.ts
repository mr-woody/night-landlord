// @rn/headless —— 无头运行器（M1 硬性验收，内核档 §5.7）。
// 命令：simulate / verify / replay / diagnose / depgraph
// 约束：本文件属应用层（uniform 策略允许读表），逻辑包保持零平台依赖。
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createKernel, definePlugin, type PluginDeclaration } from '@rn/kernel'
import { createDiagPlugin } from '@rn/diag'
import { createDayRng, createRngStreams, hash32, canonicalJson } from '@rn/core'
import { createFormula, loadConstants, type Quality } from '@rn/formula'
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

// ---- M1 bundle（内核档 §2.5 headlessBundle 子集）----
export function buildBundle(app: AppContext): PluginDeclaration[] {
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
        ctx.provide('game', {
          tables: app.tables,
          createState: (seed: number): GameState => createGameState(seed)
        })
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
    name: 'rn.director', version: '0.1.0', hotplug: 'standard',
    depends: [{ service: 'game' }, { service: 'formula' }],
    provides: ['director'], produces: ['event/fired', 'night/plan'],
    hooks: {
      setup(ctx) {
        ctx.provide('director', {
          scriptedEffectsFor(day: number): EffectOp[][] {
            const lib = loadJson<{ entries: { type: string; triggerDay: number; options: { outcomes: { effects: EffectOp[] }[] }[] }[] }>('config/event_lib.json')
            return lib.entries
              .filter(e => e.type === 'scripted' && e.triggerDay === day)
              .map(e => e.options[0]?.outcomes[0]?.effects ?? [])
          },
          planNight(state: GameState, day: number) {
            const row = app.formula.row(day)
            const rng = createDayRng(state.seed, 'monster', day)
            const routes = Array.from({ length: row.routes }, (_, i) => ({ roomId: `F1-R${i + 1}`, hp: row.hp }))
            return { day, routes, modifiers: app.formula.bloodMoon(day) ? ['BLOOD_MOON'] : [], seed: rng.next() }
          }
        })
      }
    }
  })
  return [diag, formula, save, systems, battle, director]
}

// ---- uniform 策略（F2P 中位数基准：招募跟随人口曲线，防御跟随 fReq）----
interface DayRecord {
  day: number; population: number; gold: number; income: number; power: number
  rAvg: number; deaths: number; wounds: number; sessionHash: string; invariantErrors: string[]
}

function target(d: number, t: Tables): number {
  return t.dayCurve.rows.find(r => r.day === d)?.population ?? 30
}

export function runSimulation(app: AppContext, options: { days: number; seed: number }): {
  records: DayRecord[]; finalHash: string; findings: string[]; sessions: Record<number, BattleSession>
} {
  const { tables, formula, constants } = app
  const state = createGameState(options.seed)
  const rng = createRngStreams(options.seed)
  const records: DayRecord[] = []
  const sessions: Record<number, BattleSession> = {}
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
    // 招募（品质按池权重 roll，权重随 q(d) 线性插值）
    const t = Math.max(0, Math.min(1, (row.q - 1) / 0.7))
    const w: Record<Quality, number> = { N: 1 - 0.58 * t, R: 0.32 * t, SR: 0.2 * t, SSR: 0.06 * t }
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
    // 防御投资（目标 fReq(d)）
    const need = Math.max(0, formula.fReq(d) - state.defense.power)
    const invest = Math.min(Math.ceil(need * constants.CFG_K_POWER), state.resources.gold)
    state.resources.gold -= invest
    state.defense.power += Math.floor(invest / constants.CFG_K_POWER)

    // DUSK：夜计划
    state.phase = 'DUSK_FORECAST'
    const routes = Array.from({ length: row.routes }, (_, i) => ({ roomId: `F1-R${i + 1}`, hp: row.hp }))
    const plan = { day: d, routes, modifiers: formula.bloodMoon(d) ? ['BLOOD_MOON'] : [], seed: options.seed * 1000 + d }

    // NIGHT：路级判定
    state.phase = 'NIGHT'
    const session = runNight(state, plan, { formula, constants, buildingDef: tables.buildingDef, dayRng: createDayRng(options.seed, 'monster', d) })
    sessions[d] = session

    // DAWN：收租结算（死亡后的收入线即时断裂）
    state.phase = 'DAWN_SETTLE'
    const settle = settleDawn(state, { formula, constants, rng })
    const rAvg = session.routes.length ? session.routes.reduce((a, r) => a + r.r, 0) / session.routes.length : 9.99
    const invariantErrors = checkInvariants(state, { canteenCap: canteenCap(state, tables.buildingDef), warehouseCap: 30000 })
    records.push({
      day: d, population: state.tenants.length, gold: state.resources.gold,
      income: settle.income, power: state.defense.power, rAvg: Math.round(rAvg * 1000) / 1000,
      deaths: session.deaths, wounds: session.wounds, sessionHash: session.settlementHash,
      invariantErrors
    })
  }
  const finalHash = hash32(canonicalJson(records))
  const findings: string[] = []
  const simBeta = betaSim(records, tables)
  const designed = [17, 27, 42, 58]
  for (let i = 0; i < simBeta.length; i++) {
    if (Math.abs(simBeta[i] - designed[i]) > 5) {
      findings.push(`β_sim D${[1, 8, 15, 22][i]}-=${simBeta[i]}% vs 设计 ${designed[i]}%：白盒基础经济无 u 线深度（M0 §3.2 部件，M2 实现住户升级线），见证据台账 FINDING-1`)
    }
  }
  return { records, finalHash, findings, sessions }
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
function cmdSimulate(app: AppContext, args: Record<string, string>): number {
  const days = Number(args.days ?? 30)
  const seed = Number(args.seed ?? 42)
  const sim = runSimulation(app, { days, seed })
  for (const r of sim.records) {
    console.log(`D${String(r.day).padStart(2)} 人口${String(r.population).padStart(3)} 金币${String(r.gold).padStart(7)} 租金${String(r.income).padStart(6)} 战力${String(r.power).padStart(6)} r均${String(r.rAvg).padStart(6)} 死${r.deaths} hash=${r.sessionHash}${r.invariantErrors.length ? ' ⚠' + r.invariantErrors.join(',') : ''}`)
  }
  console.log(`\nfinalHash=${sim.finalHash}  累计死亡=${sim.records.reduce((a, r) => a + r.deaths, 0)}`)
  sim.findings.forEach(f => console.log(`FINDING: ${f}`))
  if (args.out) writeFileSync(resolve(ROOT, args.out), JSON.stringify(sim, null, 2))
  return 0
}

function cmdVerify(app: AppContext, args: Record<string, string>): number {
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
    const a = runSimulation(app, { days: 30, seed: 42 })
    const b = runSimulation(app, { days: 30, seed: 42 })
    results.push({ name: 'V4 determinism', ok: a.finalHash === b.finalHash, detail: `${a.finalHash} vs ${b.finalHash}` })
    const r7 = a.records.find(r => r.day === 7)
    results.push({ name: 'V5 sim r(7)=1.02±0.05', ok: !!r7 && Math.abs(r7.rAvg - 1.02) <= 0.05, detail: `rAvg=${r7?.rAvg}` })
    const deaths = a.records.reduce((x, r) => x + r.deaths, 0)
    results.push({ name: 'V6 deaths ≤ GUARD_DEATH_30D', ok: deaths <= app.constants.GUARD_DEATH_30D, detail: `deaths=${deaths}` })
    const bad = a.records.filter(r => r.invariantErrors.length > 0)
    results.push({ name: 'V7 invariants clean', ok: bad.length === 0, detail: bad.length ? bad.map(r => `D${r.day}:${r.invariantErrors.join(',')}`).join('; ') : 'clean' })
    a.findings.forEach(f => results.push({ name: 'FINDING', ok: true, detail: f }))
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

function cmdReplay(app: AppContext, args: Record<string, string>): number {
  const seed = Number(args.seed ?? 42)
  const day = Number(args.day ?? 7)
  const sim = runSimulation(app, { days: day, seed })
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
  void app
  await kernel.boot(buildBundle(app))
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
  void app
  await kernel.boot(buildBundle(app))
  const graph = kernel.exportGraph()
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
  let code = 0
  if (cmd === 'simulate') code = cmdSimulate(app, args)
  else if (cmd === 'verify') code = cmdVerify(app, args)
  else if (cmd === 'replay') code = cmdReplay(app, args)
  else if (cmd === 'diagnose') code = await cmdDiagnose(app)
  else if (cmd === 'depgraph') code = await cmdDepgraph(app, args)
  else { console.error('用法: main.ts simulate|verify|replay|diagnose|depgraph [--days N] [--seed S] [--out f] [--check] [--design]'); code = 2 }
  process.exitCode = code
}

void main()
