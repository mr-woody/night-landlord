// @rn/headless —— 无头运行器（M1 硬性验收，内核档 §5.7）。
// 命令：simulate / verify / replay / diagnose / depgraph
// 架构：kernel.boot(bundle) → 经服务（formula/game/battle/director/persistence）驱动日循环；
//       逻辑包零平台依赖；uniform 策略属应用层，允许读配置表。
import { readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createKernel, type Kernel } from '@rn/kernel'
import { createDayRng } from '@rn/core'
import { createFormula, loadConstants } from '@rn/formula'
import { createGameState, serialize, deserialize, runNight, type Tables } from '@rn/systems'
import { buildBundle, runSimulation, betaSim, type AppContext, type EventLibEntry } from './sim.ts'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const loadJson = <T>(p: string): T => JSON.parse(readFileSync(join(ROOT, p), 'utf8')) as T


export function loadApp(): AppContext {
  const tables: Tables = {
    dayCurve: loadJson('config/day_curve.json'),
    constants: loadJson('config/constants.json'),
    buildingDef: loadJson('config/building_def.json')
  }
  return {
    tables,
    formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
    constants: loadConstants(tables.constants.entries),
    eventLib: loadJson<{ version: number; entries: EventLibEntry[] }>('config/event_lib.json'),
    monsters: loadJson<{ version: number; entries: { id: string; name: string; active: boolean; unlockDay: number; usableNightMods: string[] }[] }>('config/monster.json')
  }
}

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
