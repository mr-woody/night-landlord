// M2.5 功能点1 单测：tokens 桥（渲染数据函数）——motion 表逐条比对、派生函数、色板完整性。
// 运行：node --test（Node 原生 type-stripping，无额外依赖）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { T, withAlpha, col, EASE, easeByName, motion, font } from '../theme.ts'

test('theme.json 色板：12 色全为 6 位 hex', () => {
  const keys = Object.keys(T.color)
  assert.equal(keys.length, 12)
  for (const [k, v] of Object.entries(T.color)) {
    assert.match(v as string, /^#[0-9a-fA-F]{6}$/, `色板 ${k} 非 6 位 hex`)
  }
})

test('motion 表五条曲线与 UI 规范 §二 逐条一致（门③比对基准）', () => {
  assert.deepEqual([T.motion.fast.dur, T.motion.fast.ease], [150, 'easeOutQuad'])
  assert.deepEqual([T.motion.normal.dur, T.motion.normal.ease], [300, 'easeOutCubic'])
  assert.deepEqual([T.motion.rain.dur, T.motion.rain.ease], [500, 'easeOutBack'])
  assert.deepEqual([T.motion.threat.dur, T.motion.threat.ease, T.motion.threat.repeat], [300, 'easeInQuad', 2])
  assert.deepEqual([T.motion.dissolve.dur, T.motion.dissolve.ease], [800, 'linear'])
})

test('五条曲线参考值逐点比对（t=0/0.25/0.5/0.75/1）', () => {
  const pts = [0, 0.25, 0.5, 0.75, 1]
  const expect: Record<string, number[]> = {
    linear: [0, 0.25, 0.5, 0.75, 1],
    easeOutQuad: [0, 0.4375, 0.75, 0.9375, 1],
    easeOutCubic: [0, 0.578125, 0.875, 0.984375, 1],
    easeInQuad: [0, 0.0625, 0.25, 0.5625, 1]
  }
  for (const [name, vals] of Object.entries(expect)) {
    vals.forEach((v, i) => assert.ok(Math.abs(EASE[name](pts[i]) - v) < 1e-9, `${name}(${pts[i]})`))
  }
  // easeOutBack：过冲特征（峰值 >1，终值回 1）
  assert.ok(Math.abs(EASE.easeOutBack(1) - 1) < 1e-9)
  assert.ok(EASE.easeOutBack(0.6) > 1, 'easeOutBack 中段应过冲（>1）')
  assert.ok(Math.abs(EASE.easeOutBack(0) - 0) < 1e-9)
})

test('easeByName：未知曲线名回退 linear（防御 tokens 手改）', () => {
  assert.equal(easeByName('nope'), EASE.linear)
  assert.equal(easeByName('easeOutCubic'), EASE.easeOutCubic)
})

test('motion()：dur/fn/repeat 全部从 tokens 取', () => {
  const rain = motion('rain')
  assert.equal(rain.dur, 500)
  assert.equal(rain.fn, EASE.easeOutBack)
  const threat = motion('threat')
  assert.equal(threat.repeat, 2)
  assert.equal(threat.fn, EASE.easeInQuad)
  const unknown = motion('nope')
  assert.equal(unknown.dur, T.motion.normal.dur)
})

test('withAlpha：hex+alpha → rgba 派生（渲染层唯一透明度入口）', () => {
  assert.equal(withAlpha('#FFD700', 0.5), 'rgba(255,215,0,0.5)')
  assert.equal(withAlpha(col('bg_night'), 1), 'rgba(11,16,32,1)')
})

test('typography：正文 ≥24 可读性原则（UI 规范 §一.3）', () => {
  assert.ok(T.typography.body >= 24)
  assert.equal(T.typography.body, 24)
  assert.equal(T.typography.h1, 32)
})

test('font()：字号与字族来自 tokens', () => {
  assert.equal(font(T.typography.body), `${T.typography.body}px "${T.typography.family_cn}", sans-serif`)
  assert.equal(font(T.typography.h1, { weight: 'bold' }), `bold ${T.typography.h1}px "${T.typography.family_cn}", sans-serif`)
})
