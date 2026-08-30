import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKernel, definePlugin, type PluginDeclaration } from '@rn/kernel'
import { createDiagPlugin, type LoggerService } from '../src/index.ts'

const clock = { logicalDay: () => 5, wallMs: () => 0 }

test('diag：环形缓冲封顶 + 治理事件入缓冲', async () => {
  const k = createKernel({ clock, newTraceId: () => 't' })
  const diag = createDiagPlugin({ ringSize: 16 })
  const bad = definePlugin({
    name: 'bad', version: '0.1.0', hotplug: 'standard', depends: [], provides: [],
    hooks: { start() { throw new Error('x') } }
  })
  await k.boot([diag, bad])
  const logger = k.service<LoggerService>('logger')
  // 先断言治理事件入缓冲（bad 的 degraded 发生在 boot 期）
  const degraded = logger.entries().filter(e => e.channel === 'diag/degraded')
  assert.equal(degraded.length, 1)
  assert.equal(degraded[0].data && (degraded[0].data as { plugin: string }).plugin, 'bad')
  // 再灌满环形缓冲（cap 16），确认封顶与丢弃语义
  for (let i = 0; i < 40; i++) logger.log('info', 'test', `m${i}`)
  assert.equal(logger.size(), 16)
  const tail = logger.tail(1)
  assert.equal(tail[0].msg, 'm39')
})

test('diag：audit 记账 + tail', async () => {
  const k = createKernel({ clock })
  await k.boot([createDiagPlugin()])
  const audit = k.service<{ record(k: string, a: string, d: unknown): void; tail(n: number): { kind: string }[] }>('audit')
  audit.record('effect', 'applyEffects', { ops: 3 })
  audit.record('ctrl', 'test', {})
  assert.equal(audit.tail(1)[0].kind, 'ctrl')
  assert.equal(audit.tail(2).length, 2)
})

test('diag：插件 health 三态聚合（FR-E4）', async () => {
  const k = createKernel({ clock })
  const degradedPlugin: PluginDeclaration = definePlugin({
    name: 'h', version: '0.1.0', hotplug: 'standard', depends: [], provides: [],
    hooks: {},
    health() { return { status: 'degraded', detail: '平台不可用' } }
  })
  await k.boot([createDiagPlugin(), degradedPlugin])
  const health = Object.fromEntries(k.healthAll().map(h => [h.name, h.status]))
  assert.equal(health['rn.diag'], 'ok')
  assert.equal(health['h'], 'degraded')
})
