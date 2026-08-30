// M3.2 F6 单测：演出时间线（确定性/排序/波次边界）+ 怪物视觉映射。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WAVE_DURATION, battleTimeline, monsterProgress, monsterVisual } from '../battle.ts'
import type { BattleSession } from '../../../../packages/systems/src/index.ts'

const session = {
  day: 7, power: 500, allocation: [100, 100, 100],
  plan: { day: 7, routes: [{ roomId: 'F1-R1', hp: 100 }, { roomId: 'F1-R2', hp: 100 }, { roomId: 'F1-R3', hp: 100 }], modifiers: [], seed: 1 },
  routes: [
    { roomId: 'F1-R1', f: 100, hp: 100, r: 1.2, outcome: 'HOLD', monsterId: 'm_seeker' },
    { roomId: 'F1-R2', f: 100, hp: 100, r: 0.9, outcome: 'LOSE_1', monsterId: 'm_breaker' },
    { roomId: 'F1-R3', f: 100, hp: 100, r: 1.05, outcome: 'HOLD', monsterId: 'm_flier' }
  ],
  deaths: 0, wounds: 0, settlementHash: 'x'
} as unknown as BattleSession

test('时间线：每波 advance/attack/result 三 cues，时间有序，总数确定性', () => {
  const { cues, total } = battleTimeline(session, 1000)
  assert.equal(cues.length, 9)
  for (let i = 1; i < cues.length; i++) assert.ok(cues[i].t >= cues[i - 1].t, '时间有序')
  assert.equal(cues[0].kind, 'advance')
  assert.equal(cues[0].t, 1000)
  assert.equal(cues[1].t, 1000 + WAVE_DURATION * 0.7)
  const again = battleTimeline(session, 1000)
  assert.deepEqual(cues, again.cues, '同 session+start 完全复现')
  assert.ok(total > 0)
})

test('行进插值：波内单调递增且封顶 1（节拍与 nightWaves 同源 WAVE_MS）', () => {
  const early = monsterProgress(1, 1000, 1000 + 100)
  const mid = monsterProgress(1, 1000, 1000 + WAVE_DURATION * 0.5)
  const late = monsterProgress(1, 1000, 1000 + WAVE_DURATION * 0.8)
  assert.equal(early, 100 / (WAVE_DURATION * 0.7))
  assert.ok(early < mid && mid <= 1)
  assert.equal(late, 1)
})

test('怪物视觉映射：循声者/破窗者/飞行种/精英种差异化', () => {
  assert.equal(monsterVisual('m_seeker'), 'crawler')
  assert.equal(monsterVisual('m_breaker'), 'breaker')
  assert.equal(monsterVisual('m_flyer'), 'flyer')
  assert.equal(monsterVisual('m_elite'), 'elite')
  assert.equal(monsterVisual(undefined), 'crawler')
})
