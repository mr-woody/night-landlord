// @rn/world —— 世界空间状态与探索引擎（M3.0 FR-W1/W2/W4；世界观与空间结构设计 v1.0）。
// 红线：资源产出/伤害一律 EffectOp 经 applyEffects 单点（D4）；确定性=createDayRng 日域流
// （禁 Math.random/Date.now）；野外不禁 KILL_TENANT 之外的护栏同样适用（苟神不死原则）。
import { createDayRng, hash32, canonicalJson } from '@rn/core'
import { applyEffects, type GameState, type EffectOp } from '@rn/systems'

// ---- 配置类型（消费 config/map_def|explore_def|gather_table|wildlife 四表）----
export interface MapDefEntry {
  kind: 'lot' | 'zone'
  id: string
  name: string
  pos: { x: number; y: number }
  building?: { floors: number; roomsPerFloor: number }
  travelTime?: number
  danger?: 'low' | 'mid' | 'high'
  unlockDay: number
}
export interface ExploreDefEntry {
  id: string
  zone: string
  staminaCost: number
  timeCost: number
  partyMax: number
  gatherSlots: number
  wildlifePool: string[]
  eventPool: string[]
  unlockDay: number
}
export interface GatherEntry {
  id: string
  zone: string
  resource: 'food' | 'water' | 'material' | 'ammo' | 'gold' | 'talentStone'
  yieldMin: number
  yieldMax: number
  respawnDays: number
}
export interface WildlifeEntry {
  id: string
  kind: 'prey' | 'danger'
  name: string
  hp: number
  threat: number
  drops: { resource: string; amount: number }[]
  activeHours: 'day' | 'night' | 'always'
  zones: string[]
  unlockDay: number
}
export interface WorldTables {
  mapDef: { entries: MapDefEntry[] }
  exploreDef: { entries: ExploreDefEntry[] }
  gatherTable: { entries: GatherEntry[] }
  wildlife: { entries: WildlifeEntry[] }
  buildingDef: { version: number; entries: { type: string; level: number; cost: Record<string, number>; capacity?: number; slots?: Record<string, number>; unlockDay?: number }[] }
}

// ---- 状态 ----
export interface PartyMember { tenantId: number; stamina: number }
export interface ExploreParty {
  id: number
  zone: string
  members: PartyMember[]
  departedDay: number
  returnsDay: number
  overnight: boolean
  loot: { resource: string; amount: number }[]
  log: string[]
}
export interface WorldState {
  version: 1
  seed: number
  lots: Record<string, { unlocked: boolean }>
  buildings: Record<string, { unlocked: boolean }>
  /** tenantId → 剩余体力（EXPLORE_STAMINA_MAX 封顶，清晨回满） */
  stamina: Record<string, number>
  /** gatherId → 可再次采集的游戏日 */
  gatherReadyDay: Record<string, number>
  parties: ExploreParty[]
  nextPartyId: number
  /** 累计野外产出（资源锚点核对：EXPLORE_YIELD_TARGET_*） */
  totalYield: Record<string, number>
}

export const isOvernight = (timeCost: number): boolean => timeCost >= 3

export function createWorldState(seed: number, tables: WorldTables): WorldState {
  const w: WorldState = {
    version: 1, seed,
    lots: {}, buildings: {},
    stamina: {}, gatherReadyDay: {}, parties: [], nextPartyId: 1,
    totalYield: { food: 0, water: 0, material: 0, ammo: 0, gold: 0, talentStone: 0 }
  }
  unlockProgress(w, 1, tables)
  return w
}

/** 按日推进解锁（地块/楼栋）——pure */
export function unlockProgress(w: WorldState, day: number, tables: WorldTables): void {
  for (const e of tables.mapDef.entries) {
    if (e.unlockDay > day) continue
    if (e.kind === 'lot') {
      w.lots[e.id] = { unlocked: true }
      if (e.building) w.buildings[e.id] = { unlocked: true }
    }
  }
}

// ---- 派出队伍 ----
export interface DispatchResult { ok: boolean; reason?: string; partyId?: number }

export function dispatchParty(
  w: WorldState, state: GameState, tables: WorldTables, constants: Record<string, number>,
  opts: { zone: string; tenantIds: number[]; day: number }
): DispatchResult {
  const entry = tables.exploreDef.entries.find(e => e.zone === opts.zone)
  if (!entry) return { ok: false, reason: `未知目的地 ${opts.zone}` }
  if (entry.unlockDay > opts.day) return { ok: false, reason: `${opts.zone} 未解锁` }
  if (!w.lots[`lot_gate`]?.unlocked) return { ok: false, reason: '大门未开放' }
  const partyCap = Math.min(entry.partyMax, constants.EXPLORE_PARTY_MAX ?? 3)
  if (opts.tenantIds.length < 1 || opts.tenantIds.length > partyCap) return { ok: false, reason: `队伍人数须 1–${partyCap}` }
  const cost = entry.staminaCost // 区域体力成本（BASE 常量预留全局修正位）
  const members: PartyMember[] = []
  for (const tid of opts.tenantIds) {
    const t = state.tenants.find(x => x.id === tid)
    if (!t) return { ok: false, reason: `住户 ${tid} 不存在` }
    if (t.hp <= 30) return { ok: false, reason: `住户 ${tid} 重伤不可外出` }
    const remain = w.stamina[String(tid)] ?? constants.EXPLORE_STAMINA_MAX ?? 100
    if (remain < cost) return { ok: false, reason: `住户 ${tid} 体力不足（${remain}<${cost}）` }
    members.push({ tenantId: tid, stamina: remain - cost })
  }
  for (const m of members) w.stamina[String(m.tenantId)] = m.stamina
  const overnight = isOvernight(entry.timeCost)
  const party: ExploreParty = {
    id: w.nextPartyId++, zone: opts.zone, members,
    departedDay: opts.day,
    returnsDay: opts.day + (overnight ? 1 : 0),
    overnight, loot: [], log: [`${opts.day}日派出→${entry.id}`]
  }
  w.parties.push(party)
  return { ok: true, partyId: party.id }
}

/** 清晨体力回满（DAWN 调用） */
export function restoreStamina(w: WorldState, state: GameState, constants: Record<string, number>): void {
  const max = constants.EXPLORE_STAMINA_MAX ?? 100
  for (const t of state.tenants) w.stamina[String(t.id)] = max
}

// ---- 到期结算（采集产出/野物遭遇/战利品，全部 EffectOp 经 applyEffects）----
export interface ResolveReport { partyId: number; loot: { resource: string; amount: number }[]; encounters: string[]; wounded: number[] }

export function resolveDue(
  w: WorldState, state: GameState, tables: WorldTables, constants: Record<string, number>, day: number
): ResolveReport[] {
  const reports: ResolveReport[] = []
  const due = w.parties.filter(p => p.returnsDay <= day)
  for (const party of due) {
    const entry = tables.exploreDef.entries.find(e => e.zone === party.zone)!
    const rng = createDayRng(w.seed, 'explore', day * 100 + party.id)
    const report: ResolveReport = { partyId: party.id, loot: [], encounters: [], wounded: [] }
    const ops: EffectOp[] = []
    const addLoot = (resource: string, amount: number) => {
      if (amount <= 0) return
      party.loot.push({ resource, amount })
      report.loot.push({ resource, amount })
      w.totalYield[resource] = (w.totalYield[resource] ?? 0) + amount
      ops.push(resource === 'gold' ? { op: 'ADD_GOLD', n: amount } : { op: 'ADD_RES', res: resource as any, n: amount })
    }
    // 采集：区域节点中当日就绪者，抽 gatherSlots 个
    const nodes = tables.gatherTable.entries.filter(g => g.zone === party.zone && (w.gatherReadyDay[g.id] ?? 0) <= day)
    for (let i = 0; i < entry.gatherSlots && nodes.length > 0; i++) {
      const idx = Math.floor(rng.next() * nodes.length)
      const node = nodes.splice(idx, 1)[0]
      const amount = node.yieldMin + Math.floor(rng.next() * (node.yieldMax - node.yieldMin + 1))
      addLoot(node.resource, amount)
      w.gatherReadyDay[node.id] = day + node.respawnDays
    }
    // 野物遭遇：夜间滞留→夜行池+危险倍率
    const mul = party.overnight ? (constants.EXPLORE_NIGHT_DANGER_MUL ?? 2) : 1
    const hourPool = tables.wildlife.entries.filter(x =>
      x.zones.includes(party.zone) && x.unlockDay <= day &&
      (party.overnight ? x.activeHours !== 'day' : x.activeHours !== 'night'))
    const encounterP = Math.min(0.9, 0.35 * mul)
    if (hourPool.length > 0 && rng.next() < encounterP) {
      const animal = hourPool[Math.floor(rng.next() * hourPool.length)]
      const winP = Math.min(0.95, (constants.WILDLIFE_FIGHT_WIN_BASE ?? 0.7) + (party.members.length - 1) * 0.06)
      if (rng.next() < winP) {
        for (const d of animal.drops) addLoot(d.resource, d.amount)
        report.encounters.push(`遭遇${animal.name}：战胜`)
      } else {
        // 战败：随机一名队员负伤 + 损失三成战利品（禁 KILL——苟神不死）
        const victim = party.members[Math.floor(rng.next() * party.members.length)]
        ops.push({ op: 'WOUND_TENANT', tenantId: victim.tenantId })
        report.wounded.push(victim.tenantId)
        const lost = party.loot.map(l => ({ resource: l.resource, amount: Math.floor(l.amount * 0.3) }))
        for (const l of lost) {
          if (l.amount <= 0) continue
          party.loot.find(x => x.resource === l.resource)!.amount -= l.amount
          report.loot.find(x => x.resource === l.resource)!.amount -= l.amount
          w.totalYield[l.resource] -= l.amount
          ops.push(l.resource === 'gold' ? { op: 'ADD_GOLD', n: -l.amount } : { op: 'ADD_RES', res: l.resource as any, n: -l.amount })
        }
        report.encounters.push(`遭遇${animal.name}：战败负伤，损失部分物资`)
      }
    }
    if (ops.length > 0) applyEffects(state, ops, { constants, buildingDef: tables.buildingDef })
    party.log.push(`${day}日归来：物资${report.loot.reduce((a, b) => a + b.amount, 0)}，遭遇${report.encounters.length}次`)
    reports.push(report)
  }
  w.parties = w.parties.filter(p => p.returnsDay > day)
  return reports
}

/** 序列化与哈希（检查点/复算） */
export const serializeWorld = (w: WorldState): string => canonicalJson(w)
export const worldHash = (w: WorldState): string => hash32(serializeWorld(w))

/** 反序列化 + 版本迁移（PR-P2）：v1 正常载入并补全早期档缺失字段；
 *  非 v1/损坏档 → 按 tables 重建初始态（载入方负责回填真实 seed），不抛错（fail-open 存档策略） */
export function deserializeWorld(json: string, tables: WorldTables): WorldState {
  let parsed: Partial<WorldState> | null = null
  try { parsed = JSON.parse(json) as Partial<WorldState> } catch { parsed = null }
  if (!parsed || parsed.version !== 1) return createWorldState(parsed?.seed ?? 0, tables)
  const w = parsed as WorldState
  w.seed ??= 0
  w.lots ??= {}
  w.buildings ??= {}
  w.stamina ??= {}
  w.gatherReadyDay ??= {}
  w.parties ??= []
  w.nextPartyId ??= 1
  w.totalYield = { food: 0, water: 0, material: 0, ammo: 0, gold: 0, talentStone: 0, ...(w.totalYield ?? {}) }
  return w
}
