import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFormula, loadConstants } from '../src/index.ts'
import type { DayCurveTable, ConstantsTable } from '../src/index.ts'

const dayCurve: DayCurveTable = JSON.parse(readFileSync(new URL('../../../config/day_curve.json', import.meta.url), 'utf8'))
const constantsTable: ConstantsTable = JSON.parse(readFileSync(new URL('../../../config/constants.json', import.meta.url), 'utf8'))
const formula = createFormula({ dayCurve, constants: loadConstants(constantsTable.entries) })

test('M0 锚点 A1：D1 日租金 = 1000±5%（表值）', () => {
  const d1 = formula.row(1)
  assert.equal(d1.population, 10)
  assert.ok(Math.abs(d1.income - 1000) / 1000 <= 0.05, `D1 income ${d1.income}`)
})

test('M0 锚点 A2：D7 设计 r = fReq/threat = 1.02±0.05', () => {
  const r7 = formula.designAnchors().r7
  assert.ok(Math.abs(r7 - 1.02) <= 0.05, `r7 = ${r7}`)
})

test('M0 锚点 A3：四周期设计 β = [17,27,42,58]±5pp', () => {
  const betas = formula.designAnchors().betaByCycle
  const expected = [17, 27, 42, 58]
  betas.forEach((b, i) => {
    assert.ok(Math.abs(b.beta - expected[i]) <= 5, `周期 ${b.window} β=${b.beta} 偏离 ${expected[i]}`)
  })
})

test('血月日：7/14/21/28，hp 含 J=1.6 跳变', () => {
  for (const d of [7, 14, 21, 28]) assert.ok(formula.bloodMoon(d))
  const d6 = formula.row(6).hp
  const d7 = formula.row(7).hp
  assert.ok(Math.abs(d7 / (d6 * 1.15) - 1.6) < 0.01, `D7/D6 应为 1.15×1.6 倍：${d7}/${d6}`)
})

test('路级判定死亡带（M0 §4.3）', () => {
  assert.equal(formula.judgeRoute(1.2), 'HOLD')
  assert.equal(formula.judgeRoute(1.1), 'HOLD_WOUNDED')
  assert.equal(formula.judgeRoute(1.02), 'LOSE_1')
  assert.equal(formula.judgeRoute(0.85), 'LOSE_2')
  assert.equal(formula.judgeRoute(0.5), 'LOSE_3P')
})
