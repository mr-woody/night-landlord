// @rn/weather 单测：确定性/血月强制/权重分段/探索系数对 @rn/world 的传导。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import weatherJson from '../../../config/weather.json' with { type: 'json' }
import mapDef from '../../../config/map_def.json' with { type: 'json' }
import exploreDef from '../../../config/explore_def.json' with { type: 'json' }
import gatherTable from '../../../config/gather_table.json' with { type: 'json' }
import wildlife from '../../../config/wildlife.json' with { type: 'json' }
import buildingDef from '../../../config/building_def.json' with { type: 'json' }
import constantsJson from '../../../config/constants.json' with { type: 'json' }
import { weatherOfDay, type WeatherTables } from '../src/index.ts'
import { createGameState } from '@rn/systems'
import { createWorldState, dispatchParty, resolveDue } from '@rn/world'

const tables = { weather: weatherJson } as unknown as WeatherTables
const wtables = { mapDef, exploreDef, gatherTable, wildlife, buildingDef } as any
const constants = Object.fromEntries(constantsJson.entries.map((e: any) => [e.key, e.value]))

test('确定性：同 day/seed 双跑同天气；不同 seed 分布多样', () => {
  const a = weatherOfDay(4, 42, tables)
  const b = weatherOfDay(4, 42, tables)
  assert.equal(a.id, b.id)
  const seen = new Set<string>()
  for (let seed = 1; seed <= 60; seed++) seen.add(weatherOfDay(4, seed, tables).id)
  assert.ok(seen.size >= 2, `D4 天气分布应 ≥2 种（实际 ${[...seen].join('/')}）`)
})

test('血月日强制血月尘暴（7/14/21/28，跨 seed 稳定）', () => {
  for (const day of [7, 14, 21, 28]) {
    for (let seed = 1; seed <= 10; seed++) {
      assert.equal(weatherOfDay(day, seed, tables).id, 'blood_dust')
    }
  }
})

test('权重分段：D1–7 无雪（weightBase=0），D8+ 雪可出现；尘暴不出现在普通池', () => {
  for (let seed = 1; seed <= 40; seed++) {
    assert.notEqual(weatherOfDay(5, seed, tables).id, 'snowy', 'D5 无雪')
    assert.notEqual(weatherOfDay(5, seed, tables).id, 'blood_dust')
  }
  const seen20 = new Set<string>()
  for (let seed = 1; seed <= 80; seed++) seen20.add(weatherOfDay(20, seed, tables).id)
  assert.ok(seen20.has('snowy'), 'D20 段雪应可出现')
})

test('系数传导：gatherMul=0.5 时 @rn/world 采集期望减半；encounterMul=2 遭遇更频', () => {
  const harvest = (mul: number) => {
    let sum = 0
    for (let seed = 1; seed <= 30; seed++) {
      const state = createGameState(seed)
      const w = createWorldState(seed, wtables)
      const r = dispatchParty(w, state, wtables, constants, { zone: 'zn_forest_edge', tenantIds: [1, 2], day: 1 })
      assert.equal(r.ok, true)
      const reports = resolveDue(w, state, wtables, constants, 1, { gatherMul: mul, encounterMul: 1 })
      sum += reports[0].loot.reduce((a, l) => a + l.amount, 0)
    }
    return sum
  }
  const full = harvest(1), half = harvest(0.5)
  assert.ok(half > 0 && half < full * 0.7, `半系数收获 ${half} 应显著低于全系数 ${full}`)
  const enc = (emul: number) => {
    let n = 0
    for (let seed = 1; seed <= 40; seed++) {
      const state = createGameState(seed)
      const w = createWorldState(seed, wtables)
      dispatchParty(w, state, wtables, constants, { zone: 'zn_deep_forest', tenantIds: [1, 2], day: 9 })
      n += resolveDue(w, state, wtables, constants, 10, { gatherMul: 1, encounterMul: emul })[0].encounters.length
    }
    return n
  }
  assert.ok(enc(2) > enc(1), 'encounterMul=2 遭遇应更频')
})
