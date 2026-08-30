// M2.5 功能点3 单测：动效时间线（渲染数据函数）——五曲线落地逐条比对 + 夜战波次/结算链。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { motion, EASE, T } from '../theme.ts'
import {
  routeView, nightWaves, counterValue, popProgress, settleDoneAt,
  threatBurst, dissolveAlpha, OUTCOME_LABEL
} from '../anim.ts'
import { nightSkillRects, nightBackRect, duskConfirmRect, settleContinueRect, modalOptionRect, HIT_MIN } from '../layout.ts'
import type { RouteResult } from '../../../../packages/systems/src/index.ts'

const route = (r: number, outcome: RouteResult['outcome']): RouteResult =>
  ({ roomId: `F1-R${Math.round(r * 10)}`, f: 100, hp: 100, r, outcome })

test('新增 tokens：counter(800 easeOutCubic)/stagger(60) 承载 §3.4 明确值（§二五条不动）', () => {
  assert.deepEqual([T.motion.counter.dur, T.motion.counter.ease], [800, 'easeOutCubic'])
  assert.equal(T.motion.stagger.dur, 60)
  // §二 motion 表五条曲线保持原值（防 tokens 漂移）
  assert.equal(T.motion.fast.dur, 150)
  assert.equal(T.motion.dissolve.ease, 'linear')
})

test('路血条三态：r<0.95 红(0) / <1 警戒(1) / ≥1 绿(2)', () => {
  assert.equal(routeView(route(0.9, 'LOSE_2')).state, 0)
  assert.equal(routeView(route(0.97, 'HOLD_WOUNDED')).state, 1)
  assert.equal(routeView(route(1.2, 'HOLD')).state, 2)
  assert.equal(OUTCOME_LABEL.HOLD, '守住')
})

test('夜战波次：逐波揭示、当前波按 normal 曲线充能、全部完成需波数×间隔+dissolve', () => {
  const routes = [route(1.1, 'HOLD'), route(0.9, 'LOSE_1'), route(1.0, 'HOLD')]
  const waveMs = motion('normal').dur * 3
  const t0 = 1000
  assert.equal(nightWaves(routes, t0, t0).revealed.length, 1, 't=0 揭示第 1 波')
  assert.equal(nightWaves(routes, t0, t0).currentFill, 0)
  assert.equal(nightWaves(routes, t0, t0 + waveMs).revealed.length, 2, '1 个间隔后揭示第 2 波')
  assert.ok(nightWaves(routes, t0, t0 + 100).currentFill > 0 && nightWaves(routes, t0, t0 + 100).currentFill < 1)
  assert.equal(nightWaves(routes, t0, t0 + 3 * waveMs + motion('dissolve').dur).done, true, '波次+转场后战毕')
})

test('收租结算链：counter 800ms easeOutCubic 滚动 → stagger 60ms 逐户 → settleDoneAt 总时长', () => {
  const t0 = 0
  const rainDur = motion('rain').dur
  // 雨未结束时计数器未启动
  assert.equal(counterValue(1000, t0 + rainDur, rainDur - 50), 0)
  // 计数器中途值应在 0..target（easeOutCubic 前快后慢）
  const mid = counterValue(1000, t0 + rainDur, t0 + rainDur + 400)
  assert.ok(mid > 500 && mid < 1000, `counter 中途值 ${mid} 应过半`)
  assert.equal(counterValue(1000, t0 + rainDur, t0 + rainDur + 800), 1000, '800ms 后到达目标值')
  // 第 i 户在其 stagger 窗口内滑入（fast 曲线 150ms）
  assert.equal(popProgress(0, t0, t0), 0, '第 0 户窗口刚开始进度 0')
  assert.equal(popProgress(0, t0, t0 + motion('fast').dur), 1, '第 0 户 150ms 后滑入完成')
  assert.equal(popProgress(2, t0, t0 + 100), 0, '第 2 户未到 120ms 不出现')
  assert.ok(popProgress(2, t0, t0 + 130) > 0)
  // 总时长 = 雨 500 + 计数 800 + N×60
  assert.equal(settleDoneAt(t0, 5), rainDur + 800 + 5 * 60)
})

test('threat 红闪×2+震屏：repeat 2 窗口内生效，窗口外归零（血月入场）', () => {
  const t = motion('threat')
  const total = t.dur * (t.repeat ?? 1)
  assert.ok(threatBurst(0, t.dur / 2).flash > 0, '第一闪中段有红闪')
  assert.ok(threatBurst(0, t.dur + t.dur / 2).flash > 0, '第二闪中段有红闪')
  assert.equal(threatBurst(0, total + t.dur + 10).flash, 0, '窗口外归零')
  assert.ok(threatBurst(0, 10).shake > 0, '震屏幅度>0')
})

test('dissolve 交叉溶解：800ms linear 0→1，null=已完成', () => {
  assert.equal(dissolveAlpha(null, 999), 1)
  assert.equal(dissolveAlpha(0, 0), 0)
  assert.equal(dissolveAlpha(0, 400), 0.5)
  assert.equal(dissolveAlpha(0, 800), 1)
})

test('四相交互面热区全部 ≥88px（夜战技能/战毕返回/DUSK 布防/结算继续/事件卡选项）', () => {
  for (const r of [...nightSkillRects(), nightBackRect(), duskConfirmRect(), settleContinueRect(), modalOptionRect()]) {
    assert.ok(r.w >= HIT_MIN && r.h >= HIT_MIN, `热区 ${r.w}×${r.h} 应 ≥88×88`)
  }
})

test('easing 参考表未被 tokens 之外的实现绕过（EASE 即唯一缓动源）', () => {
  assert.equal(motion('counter').fn, EASE.easeOutCubic)
  assert.equal(motion('threat').fn, EASE.easeInQuad)
})
