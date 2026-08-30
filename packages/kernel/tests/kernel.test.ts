import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createKernel, KernelError, definePlugin, type PluginDeclaration } from '../src/index.ts'

const clock = { logicalDay: () => 0, wallMs: () => 0 }

const plug = (name: string, extra: Partial<PluginDeclaration> = {}): PluginDeclaration => definePlugin({
  name, version: '0.1.0', hotplug: 'standard', depends: [], provides: [],
  hooks: {}, ...extra
})

test('拓扑启动顺序：提供者先于依赖者', async () => {
  const order: string[] = []
  const k = createKernel({ clock })
  const a = plug('a', { provides: ['svcA'], hooks: { setup(ctx) { ctx.provide('svcA', 1) }, start() { order.push('a') } } })
  const b = plug('b', { depends: [{ service: 'svcA' }], hooks: { start() { order.push('b') } } })
  const c = plug('c', { depends: [{ service: 'svcA' }], hooks: { start() { order.push('c') } } })
  await k.boot([a, b, c])
  assert.equal(order[0], 'a')
  assert.equal(k.phase, 'RUNNING')
})

test('缺失依赖 fail-fast / 重复服务 / 插件重名', () => {
  const k = createKernel({ clock })
  k.register([plug('x', { depends: [{ service: 'nope' }] })])
  assert.throws(() => k.resolve(), (e: KernelError) => e.code === 'E_MISSING_SERVICE')

  const k2 = createKernel({ clock })
  k2.register([
    plug('p1', { provides: ['s'] }),
    plug('p2', { provides: ['s'] })
  ])
  assert.throws(() => k2.resolve(), (e: KernelError) => e.code === 'E_DUPLICATE_SERVICE')

  const k3 = createKernel({ clock })
  assert.throws(() => k3.register([plug('dup'), plug('dup')]), (e: KernelError) => e.code === 'E_DUPLICATE_PLUGIN')
})

test('循环依赖：报错含环路路径', () => {
  const k = createKernel({ clock })
  const mk = (name: string, dep: string): PluginDeclaration => plug(name, { depends: [{ service: dep }], provides: [`${name}-svc`] })
  k.register([mk('a', 'b-svc'), mk('b', 'a-svc')])
  assert.throws(() => k.resolve(), (e: KernelError) => {
    return e.code === 'E_CYCLE' && e.message.includes('a') && e.message.includes('b')
  })
})

test('启动失败隔离：失败者与依赖者降级，其余照常（FR-A3）', async () => {
  const started: string[] = []
  const k = createKernel({ clock })
  const bad = plug('bad', { hooks: { start() { throw new Error('boom') } } })
  const child = plug('child', { depends: [{ service: 'bad-svc', optional: true }], hooks: { start() { started.push('child') } } })
  // child 的依赖改为必须指向 bad 提供的服务才能验证"依赖子树降级"
  const badWithSvc = plug('bad', { provides: ['bad-svc'], hooks: { setup(ctx) { ctx.provide('bad-svc', 1) }, start() { throw new Error('boom') } } })
  const childOfBad = plug('childOfBad', { depends: [{ service: 'bad-svc' }], hooks: { start() { started.push('childOfBad') } } })
  const independent = plug('independent', { hooks: { start() { started.push('independent') } } })
  // bad 重复注册了两次，修正：只注册一份
  await k.boot([badWithSvc, childOfBad, independent])
  void bad; void child
  const health = Object.fromEntries(k.healthAll().map(h => [h.name, h.status]))
  assert.equal(health['bad'], 'degraded')
  assert.equal(health['childOfBad'], 'degraded')
  assert.equal(health['independent'], 'ok')
  assert.deepEqual(started, ['independent'])
})

test('未声明事件 tag 视为错误（FR-D2）', async () => {
  const errors: string[] = []
  const k = createKernel({ clock })
  const p = plug('p', {
    produces: ['p/ok'],
    hooks: {
      setup(ctx) {
        ctx.emit('p/ok', {})
        try { ctx.emit('p/undeclared', {}) } catch (e) { errors.push((e as KernelError).code) }
      }
    }
  })
  await k.boot([p])
  assert.deepEqual(errors, ['E_TAG'])
})

test('泄漏检测：未释放监听在停用时上报（FR-A4/FR-B4）', async () => {
  const k = createKernel({ clock, newTraceId: () => 't' })
  const leaks: unknown[] = []
  k.on('diag/leak', env => leaks.push(env.payload))
  const p = definePlugin({
    name: 'leaky', version: '0.1.0', hotplug: 'removable', depends: [], provides: [],
    hooks: {
      setup(ctx) { ctx.on('x/y', () => {}) }, // 注册后不释放
      stop() {}
    }
  })
  await k.boot([p])
  await k.stopPlugin('leaky')
  assert.equal(leaks.length, 1)
  assert.deepEqual((leaks[0] as any).handlers, 1)
})

test('removable 可停用/重启，core 禁止停用（FR-C2）', async () => {
  const k = createKernel({ clock })
  const states: string[] = []
  const r = plug('rem', { hotplug: 'removable', hooks: { start() { states.push('start') }, stop() { states.push('stop') } } })
  const c = plug('core-thing', { hotplug: 'core' })
  await k.boot([r, c])
  await k.stopPlugin('rem')
  assert.deepEqual(states, ['start', 'stop'])
  await k.startPlugin('rem')
  assert.deepEqual(states, ['start', 'stop', 'start'])
  await assert.rejects(() => k.stopPlugin('core-thing'), (e: KernelError) => e.code === 'E_HOTPLUG')
})

test('mount/unmount 作用域：可引用全局服务且无泄漏（FR-B5）', async () => {
  const k = createKernel({ clock })
  const global = plug('g', { provides: ['g-svc'], hooks: { setup(ctx) { ctx.provide('g-svc', 'G') } } })
  await k.boot([global])
  const leaks: unknown[] = []
  k.on('diag/leak', env => leaks.push(env.payload))
  let seen = ''
  const scoped = plug('scoped', {
    hotplug: 'scope',
    depends: [{ service: 'g-svc' }],
    hooks: {
      setup(ctx) { seen = String(ctx.service('g-svc')) },
      start() {}
    }
  })
  k.mount('abtest', [scoped])
  await k.startScope('abtest')
  assert.equal(seen, 'G')
  await k.unmount('abtest')
  assert.equal(leaks.length, 0)
})

test('配置校验：required/props 违规报 E_CONFIG', async () => {
  const k = createKernel({ clock })
  const p = plug('p', { configSchema: { required: ['a'], props: { a: 'number', b: 'string' } } })
  k.register([p])
  k.resolve()
  assert.throws(() => k.configure({ p: { b: 'x' } }), (e: KernelError) => e.code === 'E_CONFIG')
  k.configure({ p: { a: 1, b: 'x' } })
  k.setupAll()
  assert.equal(k.phase, 'START')
})

test('exportGraph：节点/边与依赖方向', async () => {
  const k = createKernel({ clock })
  await k.boot([
    plug('g', { provides: ['g-svc'] }),
    plug('u', { depends: [{ service: 'g-svc' }] })
  ])
  const g = k.exportGraph()
  assert.equal(g.nodes.length, 2)
  assert.equal(g.edges.length, 1)
  assert.equal(g.edges[0].from, 'u')
  assert.equal(g.edges[0].to, 'g')
})
