// @rn/headless sim —— 模拟核心 + bundle 装配（平台无关：无 node:fs 依赖，配置经 AppContext 注入）
import { createRngStreams, createDayRng, hash32, canonicalJson } from '@rn/core'
import { definePlugin, type Kernel, type PluginDeclaration } from '@rn/kernel'
import { createDiagPlugin } from '@rn/diag'
import {
  createGameState, serialize, checkInvariants, applyEffects,
  settleDawn, runNight, canteenCap, defensePower, type GameState, type Tables, type BattleSession, type EffectOp, type Quality
} from '@rn/systems'
import { createFormula, levelForU } from '@rn/formula'
import {
  createWorldState, dispatchParty, resolveDue, restoreStamina, serializeWorld,
  type WorldState, type WorldTables
} from '@rn/world'
import { weatherOfDay, weatherMuls, type WeatherEntry } from '@rn/weather'

export interface EventLibEntry {
  id: string; ver: number; type: 'scripted' | 'choice' | 'mission'; title: string
  weight: number; cooldownDays: number; maxPerRun: number
  prereq?: { dayMin?: number; dayMax?: number; panicMin?: number; panicMax?: number; reputationMin?: number; flags?: Record<string, number> }
  triggerDay?: number
  text?: string
  options: { label: string; outcomes: { p: number; text?: string; effects: EffectOp[] }[] }[]
}

export interface AppContext {
  tables: Tables
  formula: ReturnType<typeof createFormula>
  constants: Record<string, number>
  eventLib: { version: number; entries: EventLibEntry[] }
  monsters: { version: number; entries: { id: string; name: string; active: boolean; unlockDay: number; usableNightMods: string[] }[] }
  /** 世界空间四表（M3.0；explore 开启时必填） */
  world?: WorldTables
  /** 天气表（M3.2 环境层） */
  weather?: { entries: WeatherEntry[] }
}

export interface DirectorService {
  scriptedEffectsFor(day: number, state: GameState): { id: string; effects: EffectOp[] }[]
  selectDay(state: GameState, day: number): { id: string; effects: EffectOp[] }[]
  planNight(state: GameState, day: number): { day: number; routes: { roomId: string; hp: number }[]; modifiers: string[]; seed: number }
}
interface BattleService { run(state: GameState, plan: { day: number; routes: { roomId: string; hp: number }[]; modifiers: string[]; seed: number }): BattleSession }
interface GameService { tables: Tables; createState(seed: number): GameState }

// ---- bundle 装配（headlessBundle 子集；+devtools 为 devBundle）----
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
            return app.eventLib.entries
              .filter(e => e.type === 'scripted' && ((e.triggerDay ?? 0) === day || (day === 1 && (e.triggerDay ?? 99) === 0)))
              .map(e => ({ id: e.id, effects: rollOutcome(e, state, day, createDayRng(state.seed, 'event', day * 100 + (e.triggerDay ?? 0))) }))
          },
          selectDay(state: GameState, day: number): { id: string; effects: EffectOp[] }[] {
            const slots = 1 + (day % 2)
            const rng = createDayRng(state.seed, 'director', day)
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
            const pool = app.eventLib.entries.filter(e => eligible(e)).map(e => ({ e, w: e.weight }))
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
              const fb = app.eventLib.entries.filter(e => ['evt_ord_207', 'evt_box_003', 'evt_birthday_013'].includes(e.id) && eligible(e))
              if (fb.length) chosen.push(fb[Math.floor(rng.next() * fb.length)])
            }
            return chosen.map(e => ({ id: e.id, effects: rollOutcome(e, state, day, rng) }))
          },
          planNight(state: GameState, day: number) {
            const row = app.formula.row(day)
            const rng = createDayRng(state.seed, 'monster', day)
            const occupied = Array.from({ length: Math.min(state.tenants.length, state.roomsBuilt) }, (_, i) => `F1-R${i + 1}`)
            const pool = occupied.length > 0 ? occupied : ['F1-R1']
            const modifiers: string[] = app.formula.bloodMoon(day) ? ['BLOOD_MOON'] : []
            if (!app.formula.bloodMoon(day) && (day === 17 || day === 25)) modifiers.push('SILENT')
            if (day === 11 || day === 26) modifiers.push('MIGRATE')
            // M3.0 D5：目标楼栋按日轮换（不消耗 RNG 流——夜战结果与 M0 锚点逐字段不变）
            const unlockedBlds = ['lot_bld_a', ...(day >= 30 ? ['lot_bld_b', 'lot_bld_c'] : [])]
            const lotId = unlockedBlds[(day - 1) % unlockedBlds.length]
            const candidates = app.monsters.entries.filter(m =>
              m.active && m.unlockDay <= day &&
              (m.usableNightMods.includes('NORMAL') || m.usableNightMods.some(x => modifiers.includes(x))))
            const routes = Array.from({ length: row.routes }, (_, i) => {
              const m = candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : undefined
              return { roomId: pool[Math.floor(rng.next() * pool.length)], hp: row.hp, monsterId: m?.id ?? 'm_seeker' }
            })
            return { day, routes, modifiers, seed: rng.next(), lotId }
          }
        })
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
            dump(): Record<string, unknown> { return { plugin: 'rn.devtools', note: 'M2 雏形：健康/日志由 diagnose 命令输出' } }
          })
        }
      }
    }))
  }
  return list
}

/** 效果操作 → 结果摘要文案（表现层投影；applyEffects 单点语义的白盒可读化） */
function summarizeEffects(ops: EffectOp[]): string {
  const parts: string[] = []
  for (const op of ops) {
    if (op.op === 'ADD_GOLD') parts.push(`金币${op.n >= 0 ? '+' : ''}${op.n}`)
    else if (op.op === 'ADD_RES') parts.push(`${op.res}${op.n >= 0 ? '+' : ''}${op.n}`)
    else if (op.op === 'ADD_PANIC') parts.push(`恐慌+${op.n}`)
    else if (op.op === 'WOUND_TENANT') parts.push('住户负伤')
    else if (op.op === 'SPAWN_TENANT') parts.push(`新住户入住（${op.quality}）`)
    else if (op.op === 'UPGRADE_TENANT') parts.push('住户升级')
    else if (op.op === 'GRANT_BUFF') parts.push(`获得 ${op.buff}`)
    else if (op.op === 'NIGHT_MOD') parts.push(`特殊夜 ${op.mod}`)
  }
  return parts.length ? parts.join(' · ') : '无直接状态变化'
}

/** outcome 按 p 掷骰（日域确定性 RNG）；tenantId=-1 解析为随机住户。 */
export function rollOutcome(e: EventLibEntry, state: GameState, day: number, rng: { next(): number }): EffectOp[] {
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

// ---- uniform 策略（F2P 中位数基准）----
export interface DayRecord {
  day: number; population: number; roomsBuilt: number; gold: number; income: number; power: number
  rAvg: number; deaths: number; wounds: number; sessionHash: string; invariantErrors: string[]
  events: number; checkpoints: number; avgLevel: number; targetLevel: number
  panicSum: number; spend: number; wealth: number; modifiers: string[]
  /** 当日探索产出折算（EXPLORE_ENABLED 开启时非 0；折算：食物/水=1、建材=2） */
  exploreYield: number
  /** 当日天气 id（M3.2 环境层） */
  weather: string
}

function target(d: number, t: Tables): number {
  return t.dayCurve.rows.find(r => r.day === d)?.population ?? 30
}

/** 事件卡渲染元数据（M2.5 表现层投影，纯加法）：标题/正文/权重/选项标签+各 outcome 概率
 *  + resultText（实际掷中 outcome 的效果摘要，供卡面翻面结果展示）。不参与 finalHash。 */
export interface EventCardMeta {
  id: string
  title: string
  text?: string
  weight: number
  options: { label: string; ps: number[] }[]
  resultText: string
}

export function runSimulation(
  app: AppContext, kernel: Kernel, options: { days: number; seed: number; explore?: boolean }
): { records: DayRecord[]; finalHash: string; findings: string[]; sessions: Record<number, BattleSession>; eventsFired: number; distinctFired: string[]; eventCounts: Record<string, number>; eventCards: Record<number, EventCardMeta[]>; world?: WorldState; stabilizer: { window: string; wealth: number; produceConsume: number; panic: number }[] } {
  if (options.explore && !app.world) throw new Error('explore=true 需要 AppContext.world（四张世界表）')
  const { tables, constants } = app
  const formula = kernel.service<ReturnType<typeof createFormula>>('formula')
  const director = kernel.service<DirectorService>('director')
  const battle = kernel.service<BattleService>('battle')
  const persistence = kernel.service<{ put(slot: string, json: string): void; get(slot: string): string | undefined }>('persistence')
  const state: GameState = kernel.service<GameService>('game').createState(options.seed)
  const rng = createRngStreams(options.seed)
  // 探索层（K1=A：EXPLORE_ENABLED flag 门控；关闭态与 M2 行为逐字段一致）
  const exploreOn = options.explore === true
  const world = exploreOn ? createWorldState(options.seed, app.world!) : undefined
  let exploreYieldTotal = 0
  const explorePolicy = (d: number): { zone: string; tenantIds: number[] } | null => {
    if (!world) return null
    // 中位数基准策略：按收益偏好选已解锁的最高级区域；队伍=体力与状态合格的前 3 名
    const order = ['zn_deep_forest', 'zn_ruins', 'zn_farm', 'zn_forest_edge']
    const entry = order
      .map(z => app.world!.exploreDef.entries.find(e => e.zone === z)!)
      .find(e => e.unlockDay <= d)
    if (!entry) return null
    const cost = entry.staminaCost
    const members = [...state.tenants]
      .filter(t => t.hp > 30 && (world.stamina[String(t.id)] ?? constants.EXPLORE_STAMINA_MAX) >= cost)
      .sort((a, b) => (world.stamina[String(b.id)] ?? 0) - (world.stamina[String(a.id)] ?? 0) || a.id - b.id)
      .slice(0, Math.min(constants.EXPLORE_PARTY_MAX ?? 3, entry.partyMax))
    if (members.length === 0) return null
    return { zone: entry.zone, tenantIds: members.map(m => m.id) }
  }
  const records: DayRecord[] = []
  const sessions: Record<number, BattleSession> = {}
  const findings: string[] = []
  const distinctFired = new Set<string>()
  const eventCounts: Record<string, number> = {}
  const eventCards: Record<number, EventCardMeta[]> = {}
  let eventsFired = 0
  let spent = 0
  let checkpoints = 0

  for (let d = 1; d <= options.days; d++) {
    state.day = d
    state.phase = 'DAY'
    const weather = app.weather ? weatherOfDay(d, options.seed, { weather: app.weather }) : undefined
    const row = tables.dayCurve.rows.find(r => r.day === d)!
    while (state.canteenLevel < 5) {
      const next = tables.buildingDef.entries.find(b => b.type === 'canteen' && b.level === state.canteenLevel + 1)
      if (!next || canteenCap(state, tables.buildingDef) >= target(d, tables)) break
      if (state.resources.gold < (next.cost.gold ?? 0)) break
      state.resources.gold -= next.cost.gold ?? 0
      state.canteenLevel++
    }
    while (
      state.roomsBuilt < Math.min(target(d, tables), canteenCap(state, tables.buildingDef)) &&
      state.resources.gold >= constants.M1_ROOM_GOLD
    ) {
      state.resources.gold -= constants.M1_ROOM_GOLD
      state.roomsBuilt++
    }
    // 医务室升级（clinic 等级→治疗量；有伤员时自动购买）
    const wounded = state.tenants.filter(t => t.hp < 100).length
    if (wounded > 0 && state.clinicLevel < 3) {
      const next = tables.buildingDef.entries.find(b => b.type === 'clinic' && b.level === state.clinicLevel + 1)
      if (next && state.resources.gold >= (next.cost.gold ?? 0)) {
        state.resources.gold -= next.cost.gold ?? 0
        state.clinicLevel++
      }
    }
    // 防御投资（优先级 1：fReq(d)，守卫贡献抵扣；单日封顶剩余金币 60% 留发展预算）
    const effPower = defensePower(state, constants)
    const need = Math.max(0, formula.fReq(d) - effPower)
    const invest = Math.min(Math.ceil(need * constants.CFG_K_POWER), Math.floor(state.resources.gold * 0.6))
    state.resources.gold -= invest
    state.defense.power += Math.floor(invest / constants.CFG_K_POWER)
    // 招募补位（优先级 2：确定性品质缺口分配——结构平均精确跟踪 q(d)）
    let stockQ = state.tenants.reduce((a, x) => a + ({ N: 1, R: 1.5, SR: 2.5, SSR: 5 } as Record<Quality, number>)[x.quality], 0)
    const popGoal = target(d, tables)
    const qMul: Record<Quality, number> = { N: 1, R: 1.5, SR: 2.5, SSR: 5 }
    const tiers: Quality[] = ['N', 'R', 'SR', 'SSR']
    while (
      state.tenants.length < Math.min(popGoal, state.roomsBuilt, canteenCap(state, tables.buildingDef)) &&
      state.resources.gold >= constants.M1_RECRUIT_GOLD
    ) {
      // 每名新住户应承担的品质点 = （目标品质总点 − 现有品质总点）/ 剩余缺口人数
      const gap = row.q * popGoal - stockQ
      const remaining = Math.max(1, popGoal - state.tenants.length)
      const needPer = Math.max(1, Math.min(5, gap / remaining))
      let q: Quality = 'N'
      let best = 99
      for (const tier of tiers) {
        const d2 = Math.abs(qMul[tier] - needPer)
        if (d2 < best) { best = d2; q = tier }
      }
      const r = applyEffects(state, [{ op: 'SPAWN_TENANT', quality: q }], { constants, buildingDef: tables.buildingDef })
      if (r.applied === 0) break
      stockQ += qMul[q]
    }
    // 住户升级（优先级 3：跟踪设计 u 曲线，最便宜优先——FINDING-1 闭环）
    const targetLevel = levelForU(row.u, constants.CFG_G_U)
    for (;;) {
      const needy = [...state.tenants].filter(x => x.level < targetLevel).sort((a, b) => a.level - b.level)[0]
      if (!needy) break
      const r = applyEffects(state, [{ op: 'UPGRADE_TENANT', tenantId: needy.id }], { constants, buildingDef: tables.buildingDef })
      if (r.applied === 0) break
    }
    // 事件：scripted（A 组 triggerDay 特权）+ selectDay（条件触发）
    const todays = [...director.scriptedEffectsFor(d, state), ...director.selectDay(state, d)]
    let events = 0
    for (const ev of todays) {
      applyEffects(state, ev.effects, { constants, buildingDef: tables.buildingDef })
      events++
      distinctFired.add(ev.id)
      eventCounts[ev.id] = (eventCounts[ev.id] ?? 0) + 1
    }
    eventsFired += events
    eventCards[d] = todays.map(ev => {
      const e = app.eventLib.entries.find(x => x.id === ev.id)
      return {
        id: ev.id,
        title: e?.title ?? ev.id,
        text: e?.text,
        weight: e?.weight ?? 0,
        options: (e?.options ?? []).map(o => ({ label: o.label, ps: o.outcomes.map(oc => oc.p) })),
        // ev.effects = 实际掷中 outcome 的效果 + 2 条 bookkeep（fired_/last_），剔除后即结果摘要
        resultText: summarizeEffects(ev.effects.filter(op => !(op.op === 'SET_FLAG' && (String(op.key).startsWith('fired_') || String(op.key).startsWith('last_')))))
      }
    })
    persistence.put(`ckpt_${d}_day`, serialize(state))
    if (exploreOn && world) {
      restoreStamina(world, state, constants)
      const plan = explorePolicy(d)
      if (plan) dispatchParty(world, state, app.world!, constants, { zone: plan.zone, tenantIds: plan.tenantIds, day: d })
    }
    checkpoints++

    state.phase = 'DUSK_FORECAST'
    const plan = director.planNight(state, d)
    persistence.put(`ckpt_${d}_dusk`, serialize(state))
    checkpoints++

    state.phase = 'NIGHT'
    const session = battle.run(state, plan)
    sessions[d] = session
    persistence.put(`ckpt_${d}_night`, serialize(state))
    checkpoints++

    state.phase = 'DAWN_SETTLE'
    let dayExploreYield = 0
    if (exploreOn && world) {
      const before = { ...world.totalYield }
      resolveDue(world, state, app.world!, constants, d, weather ? weatherMuls(weather) : undefined)
      dayExploreYield = (world.totalYield.food - before.food) + (world.totalYield.water - before.water)
        + (world.totalYield.material - before.material) * 2
      exploreYieldTotal += dayExploreYield
      persistence.put(`ckpt_${d}_world`, serializeWorld(world))
    }
    const settle = settleDawn(state, { formula, constants, rng })
    const rAvg = session.routes.length ? session.routes.reduce((a, r) => a + r.r, 0) / session.routes.length : 9.99
    const invariantErrors = checkInvariants(state, { canteenCap: canteenCap(state, tables.buildingDef), warehouseCap: 30000 })
    records.push({
      day: d, population: state.tenants.length, roomsBuilt: state.roomsBuilt, gold: state.resources.gold,
      income: settle.income, power: state.defense.power, rAvg: Math.round(rAvg * 1000) / 1000,
      deaths: session.deaths, wounds: session.wounds, sessionHash: session.settlementHash,
      invariantErrors, events, checkpoints: 3, modifiers: plan.modifiers,
      avgLevel: state.tenants.length ? Math.round(state.tenants.reduce((a, t) => a + t.level, 0) / state.tenants.length * 10) / 10 : 0,
      targetLevel: levelForU(row.u, constants.CFG_G_U),
      panicSum: state.tenants.reduce((a, t) => a + t.panic, 0),
      spend: spent, wealth: state.resources.gold + state.resources.food + state.resources.material,
      exploreYield: exploreOn ? dayExploreYield : 0,
      weather: weather?.id ?? 'sunny'
    })
    spent = 0
  }
  const finalHash = hash32(canonicalJson(records))
  const simBeta = betaSim(records, tables)
  const designed = [17, 27, 42, 58]
  for (let i = 0; i < simBeta.length; i++) {
    if (Math.abs(simBeta[i] - designed[i]) > 5) {
      findings.push(`β_sim D${[1, 8, 15, 22][i]}-=${simBeta[i]}% vs 设计 ${designed[i]}%：升级线跟踪偏离（M2 FINDING-1 已闭环，此处为实际运行偏差）`)
    }
  }
  const stabilizer = stabilizerL1(records)
  return { records, finalHash, findings, sessions, eventsFired, distinctFired: [...distinctFired], eventCounts, eventCards, world: exploreOn ? world : undefined, stabilizer }
}

/** Stabilizer L1 度量（只记录不干预）：财富指数/产出消耗比/恐慌总量，按血月周期聚合 */
export function stabilizerL1(records: DayRecord[]): { window: string; wealth: number; produceConsume: number; panic: number }[] {
  const windows: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]]
  return windows.map(([s, e]) => {
    const recs = records.filter(r => r.day >= s && r.day <= e)
    const income = recs.reduce((a, r) => a + r.income, 0)
    const spend = recs.reduce((a, r) => a + r.spend, 0)
    const wealth = recs.length ? recs[recs.length - 1].wealth : 0
    const panic = recs.reduce((a, r) => a + r.panicSum, 0)
    return { window: `D${s}-${e}`, wealth, produceConsume: spend > 0 ? Math.round(income / spend * 100) / 100 : 0, panic }
  })
}

export function betaSim(records: DayRecord[], tables: Tables): number[] {
  const windows: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28]]
  return windows.map(([s, e]) => {
    const fStart = s === 1 ? tables.dayCurve.rows[0].fReq : (records.find(r => r.day === s - 1)?.power ?? tables.dayCurve.rows[s - 1].fReq)
    const fEnd = records.find(r => r.day === e)?.power ?? 0
    const sumI = records.filter(r => r.day >= s && r.day <= e).reduce((a, r) => a + r.income, 0)
    if (sumI === 0) return 0
    return Math.round(((fEnd - fStart) * 2.6) / sumI * 1000) / 10
  })
}
