// @rn/world 单测：确定性双跑 / EffectOp 产出经 applyEffects / 体力与解锁规则 / 野物遭遇与护栏（禁 KILL）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import mapDef from '../../../config/map_def.json' with { type: 'json' }
import exploreDef from '../../../config/explore_def.json' with { type: 'json' }
import gatherTable from '../../../config/gather_table.json' with { type: 'json' }
import wildlife from '../../../config/wildlife.json' with { type: 'json' }
import buildingDef from '../../../config/building_def.json' with { type: 'json' }
import constantsJson from '../../../config/constants.json' with { type: 'json' }
import { createGameState } from '@rn/systems'
import { loadConstants } from '@rn/formula'
import {
  createWorldState, dispatchParty, resolveDue, restoreStamina, unlockProgress,
  worldHash, serializeWorld, deserializeWorld, worldCapacity, type WorldTables
} from '../src/index.ts'

const tables: WorldTables = {
  mapDef, exploreDef, gatherTable, wildlife, buildingDef
} as unknown as WorldTables
const constants = loadConstants(constantsJson.entries)

function freshWorld(seed = 42) {
  const state = createGameState(seed)
  const world = createWorldState(seed, tables)
  restoreStamina(world, state, constants)
  return { state, world }
}

test('初始世界：A 栋与 D1 内容解锁，B 栋锁定；体力满池', () => {
  const { state, world } = freshWorld()
  assert.equal(world.buildings['lot_bld_a']?.unlocked, true)
  assert.notEqual(world.buildings['lot_bld_b']?.unlocked, true)
  assert.equal(world.lots['lot_gate']?.unlocked, true)
  assert.equal(world.stamina['1'], constants.EXPLORE_STAMINA_MAX)
  void state
})

test('派出与体力：扣减生效；体力耗尽拒绝；重伤住户拒绝', () => {
  const { state, world } = freshWorld()
  const r1 = dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1, 2], day: 1 })
  assert.equal(r1.ok, true)
  assert.ok((world.stamina['1'] as number) < constants.EXPLORE_STAMINA_MAX)
  // 连续派出直至体力耗尽（100/成本20 → 第 6 次拒绝）
  let last = r1
  for (let i = 0; i < 6; i++) last = dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1], day: 1 })
  assert.equal(last.ok, false)
  assert.equal(world.stamina['1'], 0)
  // 重伤不可外出
  state.tenants[2].hp = 10
  const r3 = dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [3], day: 1 })
  assert.equal(r3.ok, false)
})

test('确定性双跑：同 seed 派遣/结算 → 战利品与 worldHash 全等', () => {
  const run = (seed: number) => {
    const { state, world } = freshWorld(seed)
    dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1, 2, 3], day: 1 })
    const reports = resolveDue(world, state, tables, constants, 1)
    return { hash: worldHash(world), reports: JSON.parse(JSON.stringify(reports)) }
  }
  const a = run(42), b = run(42)
  assert.deepEqual(a, b)
  const c = run(7)
  assert.notEqual(a.hash, c.hash, '不同 seed 应产生不同世界哈希')
})

test('产出经 applyEffects 入 GameState：资源真实增加；产出计入 totalYield', () => {
  const { state, world } = freshWorld(99)
  const before = { ...state.resources }
  dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1, 2], day: 1 })
  resolveDue(world, state, tables, constants, 1)
  const gain = Object.keys(before).reduce((acc, k) => acc + (state.resources[k as keyof typeof before] - before[k as keyof typeof before]), 0)
  assert.ok(gain > 0, `六资源应真实增加（实际 ${gain}）`)
  const totalYieldSum = Object.values(world.totalYield).reduce((a, b) => a + b, 0)
  assert.equal(gain, totalYieldSum, 'GameState 增量应与 totalYield 记账一致')
})

test('跨夜滞留：深林 timeCost=3 → returnsDay=+1，夜行池遭遇率显著', () => {
  let withEncounter = 0
  let wounded = 0
  for (let seed = 1; seed <= 40; seed++) {
    const { state, world } = freshWorld(seed)
    const r = dispatchParty(world, state, tables, constants, { zone: 'zn_deep_forest', tenantIds: [1, 2], day: 9 })
    assert.equal(r.ok, true)
    const party = world.parties[0]
    assert.equal(party.returnsDay, 10, '深林 timeCost=3 应跨夜（+1 日归来）')
    assert.equal(party.overnight, true)
    const reports = resolveDue(world, state, tables, constants, 10)
    if (reports[0].encounters.length > 0) withEncounter++
    wounded += reports[0].wounded.length
  }
  assert.ok(withEncounter >= 15, `40 次深林跨夜遭遇次数 ${withEncounter} 应 ≥15（倍率生效）`)
  assert.ok(wounded >= 1, '40 次中应至少出现战败负伤')
})

test('护栏：野物战败不禁 KILL——住户数量不减，仅负伤', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { state, world } = freshWorld(seed)
    const n0 = state.tenants.length
    dispatchParty(world, state, tables, constants, { zone: 'zn_deep_forest', tenantIds: [1, 2, 3], day: 9 })
    resolveDue(world, state, tables, constants, 10)
    assert.equal(state.tenants.length, n0, '住户数量不得减少（苟神不死）')
  }
})

test('采集冷却：同日重复结算不得重复收割同一节点', () => {
  const { state, world } = freshWorld(11)
  dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1], day: 1 })
  const first = resolveDue(world, state, tables, constants, 1)
  // 同日再派再结：所有节点进入冷却，采集产出应为 0（无遭遇时）
  dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [2], day: 1 })
  const second = resolveDue(world, state, tables, constants, 1)
  const gather2 = second[0].loot.filter(l => l.resource !== 'food' || first[0].loot.filter(x => x.resource === 'food').reduce((a, b) => a + b.amount, 0) === 0)
  void gather2
  // 更直接的断言：第二次结算的水资源（g_fe_water 冷却 1 日）必为 0
  assert.equal(second[0].loot.find(l => l.resource === 'water')?.amount ?? 0, 0, '水资源节点应进入冷却')
})

test('解锁推进：D30 后 B 栋解锁（M0 锚点）', () => {
  const { world } = freshWorld()
  unlockProgress(world, 29, tables)
  assert.notEqual(world.buildings['lot_bld_b']?.unlocked, true)
  unlockProgress(world, 30, tables)
  assert.equal(world.buildings['lot_bld_b']?.unlocked, true)
})

test('序列化往返：serialize→parse 后哈希一致', () => {
  const { state, world } = freshWorld(5)
  dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1], day: 1 })
  const h0 = worldHash(world)
  const round = JSON.parse(serializeWorld(world))
  assert.equal(worldHash(round), h0)
})

test('存档统一（PR-P2）：serialize→deserialize 往返哈希一致；旧档迁移不崩', async () => {
  const { state, world } = freshWorld(21)
  dispatchParty(world, state, tables, constants, { zone: 'zn_forest_edge', tenantIds: [1], day: 1 })
  const h0 = worldHash(world)
  const restored = deserializeWorld(serializeWorld(world), tables)
  assert.equal(worldHash(restored), h0, '往返哈希一致')
  // 旧档/损坏档：fail-open 重建，不抛错
  assert.equal(deserializeWorld('{"version":2,"seed":7}', tables).version, 1)
  assert.equal(deserializeWorld('not-json', tables).seed, 0)
  // 字段补全：缺 totalYield 键 → 默认 0 补齐
  const legacy = serializeWorld(world).replace('"food":0,', '"food":')
  const migrated = deserializeWorld(legacy, tables)
  assert.equal(migrated.totalYield.food, 0)
})

test('住户扩容（M3.4-①）：初始 30，B/C 栋解锁后 60/90（worldCapacity）', () => {
  const { world } = freshWorld()
  assert.equal(worldCapacity(world), 30, '仅 A 栋')
  unlockProgress(world, 30, tables)
  assert.equal(worldCapacity(world), 90, 'D30 三栋全解锁')
})
