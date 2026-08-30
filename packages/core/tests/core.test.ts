import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PHASES, nextPhase, createRngStreams, hash32, canonicalJson, createCmdBus, createDayRng } from '../src/index.ts'

test('相状态机循环：DAWN→DAY→DUSK→NIGHT→DAWN', () => {
  assert.deepEqual([...PHASES], ['DAWN_SETTLE', 'DAY', 'DUSK_FORECAST', 'NIGHT'])
  let p: ReturnType<typeof nextPhase> = PHASES[0]
  const seen: string[] = [p]
  for (let i = 0; i < 4; i++) { p = nextPhase(p); seen.push(p) }
  assert.deepEqual(seen, ['DAWN_SETTLE', 'DAY', 'DUSK_FORECAST', 'NIGHT', 'DAWN_SETTLE'])
})

test('分流 RNG：同 seed 同序列、异 seed 异序列、计数器可序列化', () => {
  const a = createRngStreams(42)
  const b = createRngStreams(42)
  const seqA = [a.next('monster'), a.next('monster'), a.next('tenant')]
  const seqB = [b.next('monster'), b.next('monster'), b.next('tenant')]
  assert.deepEqual(seqA, seqB)
  const c = createRngStreams(43)
  assert.notEqual(c.next('monster'), seqA[0])
  // 恢复计数器后序列延续
  const restored = createRngStreams(42, a.counters())
  assert.equal(restored.next('monster'), (() => { const d = createRngStreams(42); d.next('monster'); d.next('monster'); d.next('tenant'); return d.next('monster') })())
})

test('日域纯抽取：同 (seed, stream, day) 抽取序列一致，且与主链独立', () => {
  const d1 = createDayRng(7, 'monster', 7)
  const d2 = createDayRng(7, 'monster', 7)
  const s1 = [d1.next(), d1.next(), d1.next()]
  const s2 = [d2.next(), d2.next(), d2.next()]
  assert.deepEqual(s1, s2)
  const other = createDayRng(7, 'monster', 8)
  assert.notEqual(other.next(), s1[0])
})

test('hash32/canonicalJson：确定性（键序无关）', () => {
  assert.equal(hash32('a'), hash32('a'))
  assert.notEqual(hash32('a'), hash32('b'))
  const o1 = { b: 1, a: { y: 2, x: [3, { c: 1, b: 2 }] } }
  const o2 = { a: { x: [3, { b: 2, c: 1 }], y: 2 }, b: 1 }
  assert.equal(canonicalJson(o1), canonicalJson(o2))
  assert.equal(hash32(canonicalJson(o1)), hash32(canonicalJson(o2)))
})

test('命令总线：注册/分发/未知命令/异常捕获', () => {
  const bus = createCmdBus()
  bus.handle('RECRUIT', cmd => `recruited:${String(cmd.count)}`)
  assert.deepEqual(bus.dispatch({ type: 'RECRUIT', count: 2 }), { ok: true, value: 'recruited:2' })
  assert.equal(bus.dispatch({ type: 'NOPE' }).ok, false)
  bus.handle('BOOM', () => { throw new Error('x') })
  assert.deepEqual(bus.dispatch({ type: 'BOOM' }), { ok: false, error: 'x' })
})
