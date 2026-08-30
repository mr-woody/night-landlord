// M3.4-② 单测：分步引导数据（步骤排期一致性/完成打勾/当前步骤）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import eventLib from '../../../../config/event_lib.json' with { type: 'json' }
import { TUT_STEPS, stepsForDay, tutorialBoard } from '../tutorial.ts'

test('TUT_STEPS 与事件库一致：id 存在、triggerDay+1=day（D0–D7 全覆盖 + D30 楼栋开放）', () => {
  const scripted = new Map(eventLib.entries.filter((e: any) => e.type === 'scripted').map((e: any) => [e.id, e]))
  for (const s of TUT_STEPS) {
    const e = scripted.get(s.id) as any
    assert.ok(e, `步骤引用的 scripted 事件 ${s.id} 不存在`)
    assert.equal(s.day, Math.max(e.triggerDay ?? 0, 1), `${s.id} day 应为 max(triggerDay,1)`)
    assert.ok(s.hint.length >= 8, `${s.id} 指引过短`)
    assert.ok(s.highlight.length > 0)
  }
  const days = new Set(TUT_STEPS.map(s => s.day))
  for (const d of [1, 2, 3, 5, 6, 30]) assert.ok(days.has(d), `缺 D${d} 步骤`)
})

test('stepsForDay：D1 三步、D2 两步、D4 空（无教学日不渲染步骤板）', () => {
  assert.equal(stepsForDay(1).length, 3)
  assert.equal(stepsForDay(2).length, 2)
  assert.equal(stepsForDay(3).length, 1)
  assert.equal(stepsForDay(4).length, 0)
  assert.equal(stepsForDay(30).length, 2, 'D30 楼栋开放两步')
})

test('tutorialBoard：完成打勾按当日 fire 的 id 集；全部完成→allDone+收起', () => {
  const fired = new Set(['evt_tut_fortify', 'evt_tut_firstnight', 'evt_tut_rescue'])
  const b1 = tutorialBoard(1, fired)
  assert.equal(b1.allDone, true)
  assert.equal(b1.current, null)
  assert.ok(b1.rows.every(r => r.done))

  const b2 = tutorialBoard(1, new Set(['evt_tut_fortify']))
  assert.equal(b2.allDone, false)
  assert.equal(b2.current?.id, 'evt_tut_firstnight', '首个未完成步骤=当前指引')
  assert.ok(b2.rows.find(r => r.step.id === 'evt_tut_fortify')!.done)
})

test('空教学日：rows 空且 allDone=false（调用方以 rows.length 渲染门控）', () => {
  const b = tutorialBoard(4, new Set())
  assert.equal(b.rows.length, 0)
  assert.equal(b.allDone, false)
  assert.equal(b.current, null)
})
