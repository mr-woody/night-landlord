// @rn/systems —— GameState 单一状态树、applyEffects 护栏单点（D4）、经济结算、夜战、存档。
// 红线：一切游戏状态变更必须经 applyEffects；确定性哈希用 canonicalJson+hash32。
import { createRngStreams, hash32, canonicalJson, type Phase } from '@rn/core'
import {
  createFormula, loadConstants, upgradeCost, type Quality, type DayCurveTable,
  type ConstantsTable, type RouteOutcome
} from '@rn/formula'

export type { Quality }
export const RESOURCES = ['food', 'water', 'material', 'ammo', 'talentStone'] as const
export type ResourceId = typeof RESOURCES[number] | 'gold'

export interface Tenant {
  id: number
  quality: Quality
  level: number
  job: string
  hp: number
  panic: number
}
export interface GameState {
  version: 1
  seed: number
  day: number
  phase: Phase
  rng: Record<string, number>
  resources: { food: number; water: number; material: number; ammo: number; gold: number; talentStone: number }
  tenants: Tenant[]
  nextTenantId: number
  roomsBuilt: number
  floors: number
  canteenLevel: number
  warehouseLevel: number
  clinicLevel: number
  defense: { power: number; alloc: number[] }
  flags: Record<string, number>
  stats: { deathsTotal: number; deathsToday: number; goldEarnedTotal: number; breachesLastNight: number }
}

export interface BuildingEntry { type: string; level: number; cost: Record<string, number>; capacity?: number; slots?: Record<string, number>; unlockDay?: number; /** M3.2 房屋进化：耐久系数（type='house' 专用） */ durability?: number; desc?: string }
export interface Tables {
  dayCurve: DayCurveTable
  constants: ConstantsTable
  buildingDef: { version: number; entries: BuildingEntry[] }
}

export interface Formula {
  row(d: number): { population: number; hp: number; routes: number; threat: number; fReq: number; income: number; rTarget: number }
  bloodMoon(d: number): boolean
  rent(quality: Quality, level: number, mods?: { panicFactor?: number; monthlyBonus?: number; rentBuff?: number }): number
  dailyRent(tenants: { quality: Quality; level: number }[], mods?: { panicFactor?: number; monthlyBonus?: number; rentBuff?: number }): number
  judgeRoute(r: number): RouteOutcome
}

export function loadTables(tables: Tables): { formula: Formula; constants: Record<string, number> } {
  return { formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }), constants: loadConstants(tables.constants.entries) }
}

export function createGameState(seed: number): GameState {
  const s: GameState = {
    version: 1,
    seed,
    day: 0,
    phase: 'DAWN_SETTLE',
    rng: {},
    resources: { food: 600, water: 600, material: 400, ammo: 200, gold: 3200, talentStone: 0 },
    tenants: [],
    nextTenantId: 1,
    roomsBuilt: 3,
    floors: 1,
    canteenLevel: 1,
    warehouseLevel: 1,
    clinicLevel: 1,
    defense: { power: 0, alloc: [] },
    flags: {},
    stats: { deathsTotal: 0, deathsToday: 0, goldEarnedTotal: 0, breachesLastNight: 0 }
  }
  const rng = createRngStreams(seed, s.rng)
  for (let i = 0; i < 3; i++) {
    s.tenants.push({ id: s.nextTenantId++, quality: 'N', level: 1, job: 'worker', hp: 100, panic: 0 })
    void rng
  }
  return s
}

export function serialize(state: GameState): string { return canonicalJson(state) }

export function deserialize(json: string): GameState {
  const s = JSON.parse(json) as GameState
  if (s.version !== 1) throw new Error(`存档版本不支持: ${s.version}`)
  return s
}

export function canteenCap(state: GameState, buildingDef: Tables['buildingDef']): number {
  const row = buildingDef.entries.find(b => b.type === 'canteen' && b.level === state.canteenLevel)
  return row?.capacity ?? 0
}
export function warehouseCap(state: GameState, buildingDef: Tables['buildingDef']): number {
  const row = buildingDef.entries.find(b => b.type === 'warehouse' && b.level === state.warehouseLevel)
  return row?.capacity ?? 0
}

/** 有效防御力 = 投资战力 + 守卫岗位贡献（岗位空缺=战力折扣，M2 功能点4） */
export function defensePower(state: GameState, constants: Record<string, number>): number {
  const guards = state.tenants.filter(t => t.job === 'guard').length
  return state.defense.power + guards * (constants.GUARD_POWER ?? 15)
}

export function checkInvariants(state: GameState, caps: { canteenCap: number; warehouseCap: number }): string[] {
  const errs: string[] = []
  if (state.resources.gold < 0) errs.push('gold < 0')
  for (const r of RESOURCES) if (state.resources[r] < 0) errs.push(`${r} < 0`)
  if (state.tenants.length > caps.canteenCap) errs.push(`人口 ${state.tenants.length} > 食堂容量 ${caps.canteenCap}`)
  if (state.tenants.length > state.roomsBuilt) errs.push(`人口 ${state.tenants.length} > 房间 ${state.roomsBuilt}`)
  for (const t of state.tenants) {
    if (t.panic < 0 || t.panic > 100) errs.push(`住户 ${t.id} panic 越界: ${t.panic}`)
    if (t.hp <= 0) errs.push(`住户 ${t.id} hp ≤ 0（应死亡移除）`)
  }
  if (state.stats.deathsToday < 0 || state.stats.deathsTotal < 0) errs.push('死亡计数为负')
  return errs
}

// ---- EffectOp（v1.0 终稿 §4.2 词汇；护栏在 applyEffects 单点执行）----
export type EffectOp =
  | { op: 'ADD_GOLD'; n: number }
  | { op: 'ADD_RES'; res: (typeof RESOURCES)[number]; n: number }
  | { op: 'SPAWN_TENANT'; quality: Quality }
  | { op: 'KILL_TENANT'; tenantId: number }
  | { op: 'WOUND_TENANT'; tenantId: number }
  | { op: 'UPGRADE_TENANT'; tenantId: number }
  | { op: 'ADD_PANIC'; n: number }
  | { op: 'SET_FLAG'; key: string; v: number }
  | { op: 'GRANT_BUFF'; buff: string; days: number }
  | { op: 'NIGHT_MOD'; mod: 'BLOOD_MOON' | 'SILENT' | 'MIGRATE' }

export interface EffectDeps {
  constants: Record<string, number>
  buildingDef: Tables['buildingDef']
  audit?: { record(kind: string, actor: string, detail: unknown): void }
}

/** 全游戏唯一状态变更执行点（ADR-4/D4）。护栏：死亡带/资源非负/容量上限。 */
export function applyEffects(state: GameState, ops: EffectOp[], deps: EffectDeps): { applied: number; rejected: { op: EffectOp; reason: string }[] } {
  const rejected: { op: EffectOp; reason: string }[] = []
  let applied = 0
  const cap = canteenCap(state, deps.buildingDef)
  for (const op of ops) {
    let ok = true
    let reason = ''
    switch (op.op) {
      case 'ADD_GOLD':
        if (op.n < 0 && state.resources.gold + op.n < 0) { ok = false; reason = '金币不足' }
        else state.resources.gold += op.n
        break
      case 'ADD_RES': {
        const cur = state.resources[op.res]
        if (op.n < 0 && cur + op.n < 0) { ok = false; reason = `${op.res} 不足` }
        else state.resources[op.res] = cur + op.n
        break
      }
      case 'SPAWN_TENANT':
        if (state.tenants.length >= Math.min(cap, state.roomsBuilt)) { ok = false; reason = '无空房或食堂容量不足' }
        else state.tenants.push({ id: state.nextTenantId++, quality: op.quality, level: 1, job: 'worker', hp: 100, panic: 0 })
        break
      case 'KILL_TENANT': {
        const idx = state.tenants.findIndex(t => t.id === op.tenantId)
        if (idx < 0) { ok = false; reason = '住户不存在' }
        else if (state.stats.deathsToday >= deps.constants.GUARD_DEATH_DAY) { ok = false; reason = '单日死亡护栏' }
        else if (state.stats.deathsTotal >= deps.constants.GUARD_DEATH_30D) { ok = false; reason = '30 日死亡护栏' }
        else {
          state.tenants.splice(idx, 1)
          state.stats.deathsToday++
          state.stats.deathsTotal++
        }
        break
      }
      case 'WOUND_TENANT': {
        const t = state.tenants.find(t => t.id === op.tenantId)
        if (!t) { ok = false; reason = '住户不存在' } else t.hp = Math.max(20, t.hp - 40)
        break
      }
      case 'UPGRADE_TENANT': {
        const t = state.tenants.find(t => t.id === op.tenantId)
        if (!t) { ok = false; reason = '住户不存在' } else {
          const cost = upgradeCost(t.level, deps.constants.UPGRADE_BASE, deps.constants.UPGRADE_GROWTH)
          if (state.resources.gold < cost) { ok = false; reason = `金币不足（升级需 ${cost}）` }
          else { state.resources.gold -= cost; t.level++ }
        }
        break
      }
      case 'ADD_PANIC': {
        for (const t of state.tenants) {
          t.panic = Math.max(0, Math.min(deps.constants.PANIC_MAX, t.panic + op.n))
          if (state.day <= 7) t.panic = Math.min(t.panic, deps.constants.TUTORIAL_PANIC_CAP)
        }
        break
      }
      case 'SET_FLAG':
        state.flags[op.key] = op.v
        break
      case 'GRANT_BUFF':
        state.flags[`buff_${op.buff}`] = op.days
        break
      case 'NIGHT_MOD':
        state.flags[`nightmod_${op.mod}`] = 1
        break
    }
    if (ok) applied++
    else rejected.push({ op, reason })
  }
  deps.audit?.record('effect', 'applyEffects', { applied, rejected: rejected.length, day: state.day })
  return { applied, rejected }
}

export interface SettleResult { income: number; escaped: number }

/** 天亮结算：收租（收租×2 广告在 headless 策略层乘算）→ 恐慌衰减/传播 → 出逃（FR 流程） */
export function settleDawn(state: GameState, deps: { formula: Formula; constants: Record<string, number>; rng: { next(stream: string): number }; audit?: EffectDeps['audit'] }): SettleResult {
  const C = deps.constants
  const avgPanic = state.tenants.length ? state.tenants.reduce((a, t) => a + t.panic, 0) / state.tenants.length : 0
  const panicFactor = avgPanic > C.PANIC_MEAN_PENALTY_AT ? C.PANIC_MEAN_PENALTY : 1
  const monthlyBonus = state.flags.monthlyOwned ? 1.15 : 1
  const income = deps.formula.dailyRent(state.tenants, { panicFactor, monthlyBonus })
  state.resources.gold += income
  state.stats.goldEarnedTotal += income

  const decay = C.PANIC_DECAY + (state.flags.curfew ? C.CURFEW_DECAY_BONUS : 0)
  for (const t of state.tenants) {
    t.panic = Math.max(0, t.panic - decay)
    if (t.hp < 100) t.hp = Math.min(100, t.hp + C.CLINIC_HEAL_HP * (state.clinicLevel ?? 1)) // 医务室治疗
  }
  if (state.stats.breachesLastNight > 0) {
    for (const t of state.tenants) {
      t.panic = Math.min(C.PANIC_MAX, t.panic + C.PANIC_PROP_FLOOR)
      if (state.day <= 7) t.panic = Math.min(t.panic, C.TUTORIAL_PANIC_CAP)
    }
  }
  let escaped = 0
  const remain: typeof state.tenants = []
  for (const t of state.tenants) {
    if (t.panic >= C.PANIC_ESCAPE_AT && deps.rng.next('tenant') < C.PANIC_ESCAPE_P) escaped++
    else remain.push(t)
  }
  state.tenants = remain
  state.stats.deathsToday = 0
  state.stats.breachesLastNight = 0
  deps.audit?.record('econ', 'settleDawn', { day: state.day, income, escaped })
  return { income, escaped }
}

// ---- 夜战（路级判定 + BattleSession 可序列化）----
export interface NightRoute { roomId: string; hp: number; monsterId?: string }
export interface NightPlan { day: number; routes: NightRoute[]; modifiers: string[]; seed: number; /** 目标楼栋地块（M3.0 世界空间；缺省=默认栋 A） */ lotId?: string }
export interface RouteResult { roomId: string; f: number; hp: number; r: number; outcome: RouteOutcome; monsterId?: string }
export interface BattleSession {
  day: number
  plan: NightPlan
  power: number
  allocation: number[]
  routes: RouteResult[]
  deaths: number
  wounds: number
  migrated?: boolean
  silent?: boolean
  settlementHash: string
}

const BAND_DEATHS: Record<RouteOutcome, number> = { HOLD: 0, HOLD_WOUNDED: 0, LOSE_1: 1, LOSE_2: 2, LOSE_3P: 3 }
const BAND_WOUNDS: Record<RouteOutcome, number> = { HOLD: 0, HOLD_WOUNDED: 2, LOSE_1: 1, LOSE_2: 1, LOSE_3P: 1 }

/** 路级判定 → 夜死亡 = 最差路 band（均匀布防下逐路 r_i≈r_target，聚合复现 M0 死亡带，校准见 v1.0 §4.3） */
export function runNight(state: GameState, plan: NightPlan, deps: { formula: Formula; constants: Record<string, number>; buildingDef: Tables['buildingDef']; dayRng: { next(): number }; audit?: EffectDeps['audit'] }): BattleSession {
  // MIGRATE：迁移夜在开战瞬间重排目标房间（预告失效，FR 白盒日志可见）
  if (plan.modifiers.includes('MIGRATE')) {
    const rooms = Array.from({ length: Math.max(state.roomsBuilt, plan.routes.length) }, (_, i) => `F1-R${i + 1}`)
    for (const rt of plan.routes) rt.roomId = rooms[Math.floor(deps.dayRng.next() * rooms.length)]
  }
  const silent = plan.modifiers.includes('SILENT')
  const W = plan.routes.length
  const F = defensePower(state, deps.constants)
  const per = W > 0 ? F / W : 0
  const routes: RouteResult[] = plan.routes.map(rt => {
    const f = per
    const r = rt.hp > 0 ? f / rt.hp : 9.99
    return { roomId: rt.roomId, hp: rt.hp, f, r, outcome: deps.formula.judgeRoute(r), monsterId: rt.monsterId }
  })
  let worst = 0
  let breaches = 0
  for (const rt of routes) {
    worst = Math.max(worst, BAND_DEATHS[rt.outcome])
    if (rt.r < 0.95) breaches++
  }
  const wounds = Math.max(...routes.map(rt => BAND_WOUNDS[rt.outcome]), 0)
  state.stats.breachesLastNight = breaches

  const ops: EffectOp[] = []
  for (let i = 0; i < worst; i++) {
    if (state.tenants.length === 0) break
    const victim = state.tenants[Math.floor(deps.dayRng.next() * state.tenants.length)]
    ops.push({ op: 'KILL_TENANT', tenantId: victim.id })
  }
  for (let i = 0; i < wounds; i++) {
    if (state.tenants.length === 0) break
    const victim = state.tenants[Math.floor(deps.dayRng.next() * state.tenants.length)]
    ops.push({ op: 'WOUND_TENANT', tenantId: victim.id })
  }
  const res = applyEffects(state, ops, deps)
  const deaths = res.applied > worst ? worst : ops.filter(o => o.op === 'KILL_TENANT' && !res.rejected.some(rj => rj.op === o)).length
  const woundsApplied = ops.length - res.rejected.length - deaths

  const session: BattleSession = {
    day: plan.day,
    plan,
    power: F,
    allocation: routes.map(r => r.f),
    routes,
    deaths,
    wounds: woundsApplied,
    migrated: plan.modifiers.includes('MIGRATE'),
    silent: silent,
    settlementHash: hash32(canonicalJson({ day: plan.day, seed: plan.seed, migrated: plan.modifiers.includes('MIGRATE'), routes: routes.map(r => ({ id: r.roomId, m: r.monsterId ?? '', r: Math.round(r.r * 10000) / 10000, o: r.outcome })), d: deaths, w: woundsApplied }))
  }
  deps.audit?.record('battle', 'runNight', { day: plan.day, deaths, breaches })
  return session
}
