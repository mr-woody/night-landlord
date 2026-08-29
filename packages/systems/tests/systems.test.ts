import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  createGameState, serialize, deserialize, checkInvariants, applyEffects,
  settleDawn, runNight, loadTables, canteenCap
} from '../src/index.ts'
import type { Tables, NightPlan } from '../src/index.ts'

import { createRngStreams, createDayRng } from '@rn/core'

const root = new URL('../../../', import.meta.url)
const load = (n: string) => JSON.parse(readFileSync(new URL(`config/${n}`, root), 'utf8'))
const tables: Tables = {
  dayCurve: load('day_curve.json'),
  constants: load('constants.json'),
  buildingDef: load('building_def.json')
}
const { formula, constants } = loadTables(tables)

const gameWith = (n: number): ReturnType<typeof createGameState> => {
  const s = createGameState(42)
  for (let i = s.tenants.length; i < n; i++) s.tenants.push({ id: s.nextTenantId++, quality: 'N', level: 1, job: 'worker', hp: 100, panic: 0 })
  return s
}

test('M0 锚点 A1（模拟侧）：D1 结算 10 户 N 品质 = 1000±5%', () => {
  const s = gameWith(10)
  const r = settleDawn(s, { formula, constants, rng: createRngStreams(42, s.rng) })
  assert.ok(Math.abs(r.income - 1000) / 1000 <= 0.05, `income=${r.income}`)
  assert.equal(s.resources.gold, 500 + r.income)
})

test('applyEffects 护栏：单日死亡上限 / 30 日上限 / 资源非负（FR 护栏单点）', () => {
  const s = gameWith(10)
  const deps = { constants, buildingDef: tables.buildingDef }
  const ids = s.tenants.map(t => t.id)
  const ops = ids.map(id => ({ op: 'KILL_TENANT' as const, tenantId: id }))
  const r = applyEffects(s, ops, deps)
  assert.equal(r.applied, constants.GUARD_DEATH_DAY) // 单日护栏 4
  assert.equal(r.rejected.length, ops.length - constants.GUARD_DEATH_DAY)
  // 30 日护栏：累计 6 后拒绝
  const s2 = gameWith(10)
  s2.stats.deathsTotal = constants.GUARD_DEATH_30D
  const r2 = applyEffects(s2, [{ op: 'KILL_TENANT', tenantId: s2.tenants[0].id }], deps)
  assert.equal(r2.applied, 0)
  // 资源非负
  s2.resources.gold = 10
  const r3 = applyEffects(s2, [{ op: 'ADD_GOLD', n: -100 }], deps)
  assert.equal(r3.applied, 0)
})

test('SPAWN_TENANT 容量拒绝：食堂与房间双上限', () => {
  const s = gameWith(3) // roomsBuilt=3, canteen lv1 cap 10
  const deps = { constants, buildingDef: tables.buildingDef }
  assert.ok(canteenCap(s, tables.buildingDef) >= s.tenants.length)
  const r = applyEffects(s, [
    { op: 'SPAWN_TENANT', quality: 'N' }, // 第 4 人：房间满 → 拒绝
    { op: 'SET_FLAG', key: 'x', v: 1 }
  ], deps)
  assert.equal(r.applied, 1)
  assert.equal(r.rejected[0].op.op, 'SPAWN_TENANT')
})

test('恐慌：教学段封顶 + 出逃掷骰（deps 注入可测）', () => {
  const s = gameWith(5)
  s.day = 5
  applyEffects(s, [{ op: 'ADD_PANIC', n: 25 }], { constants, buildingDef: tables.buildingDef })
  assert.ok(s.tenants.every(t => t.panic <= constants.TUTORIAL_PANIC_CAP))
  // 出逃：D9（无教学封顶）连加恐慌至满，衰减 10 后仍 ≥70；rng 恒 0.01 < 0.15 → 全出逃
  s.day = 9
  for (let i = 0; i < 4; i++) applyEffects(s, [{ op: 'ADD_PANIC', n: 25 }], { constants, buildingDef: tables.buildingDef })
  const before = s.tenants.length
  const r = settleDawn(s, { formula, constants, rng: { next: () => 0.01 } })
  assert.equal(r.escaped, before)
  assert.equal(s.tenants.length, 0)
})

test('D7 夜战：均匀布防 r_i≈1.02 → 路级 LOSE_1 → 夜死亡=1（复现 M0 设计死亡数）', () => {
  const s = gameWith(20)
  s.day = 7
  s.defense.power = 1132 // fReq(7)
  const row7 = tables.dayCurve.rows.find(r => r.day === 7)!
  const plan: NightPlan = { day: 7, routes: Array.from({ length: row7.routes }, (_, i) => ({ roomId: `r${i}`, hp: row7.hp })), modifiers: ['BLOOD_MOON'], seed: 7 }
  const session = runNight(s, plan, { formula, constants, buildingDef: tables.buildingDef, dayRng: createDayRng(42, 'monster', 7) })
  assert.equal(session.routes.length, 3)
  for (const rt of session.routes) {
    assert.ok(Math.abs(rt.r - 1.02) <= 0.01, `r_i=${rt.r}`)
    assert.equal(rt.outcome, 'LOSE_1')
  }
  assert.equal(session.deaths, 1)
  assert.ok(session.settlementHash.length > 0)
  // 护栏：单日死亡上限在多路惨案时生效
})

test('重放确定性：同 (seed, day, plan) 夜战哈希一致；存档往返一致', () => {
  const mk = () => {
    const s = gameWith(20)
    s.day = 7
    s.defense.power = 1132
    return s
  }
  const plan: NightPlan = { day: 7, routes: Array.from({ length: 3 }, (_, i) => ({ roomId: `r${i}`, hp: tables.dayCurve.rows[7].hp })), modifiers: [], seed: 7 }
  const s1 = mk()
  const sess1 = runNight(s1, plan, { formula, constants, buildingDef: tables.buildingDef, dayRng: createDayRng(42, 'monster', 7) })
  const s2 = deserialize(serialize(mk()))
  const sess2 = runNight(s2, plan, { formula, constants, buildingDef: tables.buildingDef, dayRng: createDayRng(42, 'monster', 7) })
  assert.equal(sess1.settlementHash, sess2.settlementHash)
  // 存档往返
  const roundTrip = deserialize(serialize(gameWith(5)))
  assert.equal(roundTrip.resources.gold, gameWith(5).resources.gold)
  assert.equal(roundTrip.nextTenantId, gameWith(5).nextTenantId)
})

test('不变量：违反可检出（checkInvariants）', () => {
  const s = gameWith(5)
  s.roomsBuilt = 10
  assert.deepEqual(checkInvariants(s, { canteenCap: 10, warehouseCap: 5000 }), [])
  s.resources.gold = -1
  s.tenants.push({ id: 99, quality: 'N', level: 1, job: 'x', hp: 100, panic: 0 })
  const errs = checkInvariants(s, { canteenCap: 5, warehouseCap: 5000 })
  assert.ok(errs.length >= 2)
})
