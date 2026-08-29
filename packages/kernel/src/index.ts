// @rn/kernel —— 插件容器。ADR-11：接口形状对标 Cordis，零游戏知识、零运行时依赖。
// 边界：不实现 loader/hmr/动态作用域；不含任何游戏规则（职责单一）。

export type Hotplug = 'core' | 'standard' | 'removable' | 'scope'
export type LifecyclePhase = 'REGISTER' | 'RESOLVE' | 'CONFIG' | 'SETUP' | 'START' | 'RUNNING' | 'STOP' | 'DISPOSED'
export type HealthStatus = 'ok' | 'degraded' | 'fail'

export interface ServiceDep { service: string; optional?: boolean }
export interface ConfigSchema {
  required?: string[]
  props?: Record<string, 'number' | 'string' | 'boolean' | 'array' | 'object'>
}
export interface Envelope {
  ver: 1
  tag: string
  wallTs: number
  logicalDay: number
  traceId: string
  source: string
  payload: unknown
}
export interface HealthReport { status: HealthStatus; detail?: string }
export interface SelfTestReport { ok: boolean; detail?: string }

export interface HookCtx {
  readonly plugin: string
  readonly config: Record<string, unknown>
  logicalDay(): number
  traceId(): string
  provide(name: string, value: unknown): void
  service<T = unknown>(name: string): T
  has(name: string): boolean
  emit(tag: string, payload: unknown): void
  on(tag: string, fn: (env: Envelope) => void): () => void
  onAny(fn: (env: Envelope) => void): () => void
  setInterval(fn: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
}

export interface PluginHooks {
  setup?(ctx: HookCtx): void
  start?(ctx: HookCtx): Promise<void> | void
  drain?(ctx: HookCtx): Promise<void> | void
  stop?(ctx: HookCtx): void
  dispose?(ctx: HookCtx): void
}

export interface PluginDeclaration {
  name: string
  version: string
  hotplug: Hotplug
  depends: ServiceDep[]
  provides: string[]
  consumes?: string[]
  produces?: string[]
  configSchema?: ConfigSchema
  hooks: PluginHooks
  health?(ctx: HookCtx): HealthReport
  selfTest?(ctx: HookCtx): SelfTestReport
}
export function definePlugin(p: PluginDeclaration): PluginDeclaration { return p }

export class KernelError extends Error {
  code: string
  constructor(code: string, message: string) { super(message); this.code = code }
}

/** 内核内置标签（不参与插件 produces 校验）：治理类诊断流。 */
export const SYSTEM_TAGS = ['diag/leak', 'diag/degraded', 'diag/record', 'ctrl/killswitch'] as const

interface Rec {
  decl: PluginDeclaration
  state: 'registered' | 'resolved' | 'configured' | 'setup' | 'started' | 'stopped' | 'disposed' | 'degraded'
  config: Record<string, unknown>
  provided: Map<string, unknown>
  scope: string | null
  degraded: boolean
  error?: string
  ctx?: HookCtx
  leaks: { handlers: number; intervals: number }
}

export interface GraphNode { name: string; hotplug: Hotplug; provides: string[]; depends: ServiceDep[]; scope: string | null }
export interface Graph { nodes: GraphNode[]; edges: { from: string; to: string; service: string }[] }

export interface KernelOptions {
  appName?: string
  clock?: { logicalDay(): number; wallMs(): number }
  newTraceId?: () => string
}

interface Rec2 { rec: Rec; fn: (env: Envelope) => void }

export class Kernel {
  phase: LifecyclePhase = 'REGISTER'
  private records = new Map<string, Rec>()
  private order: string[] = []
  private providers = new Map<string, string>() // service → plugin name
  private handlers = new Map<string, Set<Rec2>>()
  private anyHandlers = new Set<Rec2>()
  private allowedTags = new Set<string>(SYSTEM_TAGS)
  private traceSeq = 0
  readonly clock: { logicalDay(): number; wallMs(): number }
  readonly appName: string
  private newTraceId: () => string

  constructor(options: KernelOptions = {}) {
    this.appName = options.appName ?? 'rn'
    this.clock = options.clock ?? { logicalDay: () => 0, wallMs: () => 0 }
    this.newTraceId = options.newTraceId ?? (() => `${this.appName}-${++this.traceSeq}`)
  }

  // ---- REGISTER ----
  register(plugins: PluginDeclaration[]): this {
    if (this.phase !== 'REGISTER') throw new KernelError('E_PHASE', `register 仅限 REGISTER 相（当前 ${this.phase}）`)
    for (const decl of plugins) {
      if (this.records.has(decl.name)) throw new KernelError('E_DUPLICATE_PLUGIN', `插件重名: ${decl.name}`)
      const rec: Rec = { decl, state: 'registered', config: {}, provided: new Map(), scope: null, degraded: false, leaks: { handlers: 0, intervals: 0 } }
      this.records.set(decl.name, rec)
      for (const tag of decl.produces ?? []) this.allowedTags.add(tag)
    }
    return this
  }

  // ---- RESOLVE ----
  resolve(): this {
    this.assertPhase('REGISTER')
    for (const rec of this.records.values()) {
      for (const p of rec.decl.provides) {
        const owner = this.providers.get(p)
        if (owner) throw new KernelError('E_DUPLICATE_SERVICE', `服务 ${p} 被 ${owner} 与 ${rec.decl.name} 重复提供`)
        this.providers.set(p, rec.decl.name)
      }
    }
    for (const rec of this.records.values()) {
      for (const dep of rec.decl.depends) {
        if (!this.providers.has(dep.service) && !dep.optional) {
          throw new KernelError('E_MISSING_SERVICE', `插件 ${rec.decl.name} 缺失依赖服务 ${dep.service}`)
        }
      }
    }
    this.detectCycles()
    this.order = this.topoOrder()
    for (const rec of this.records.values()) rec.state = 'resolved'
    this.phase = 'CONFIG'
    return this
  }

  private detectCycles(): void {
    const color = new Map<string, 0 | 1 | 2>()
    const path: string[] = []
    const edgesTo = (name: string): string[] => {
      const out: string[] = []
      for (const dep of this.records.get(name)!.decl.depends) {
        const provider = this.providers.get(dep.service)
        if (provider && provider !== name) out.push(provider)
      }
      return out
    }
    const dfs = (name: string): void => {
      color.set(name, 1)
      path.push(name)
      for (const next of edgesTo(name)) {
        const c = color.get(next) ?? 0
        if (c === 1) {
          const from = path.indexOf(next)
          throw new KernelError('E_CYCLE', '循环依赖: ' + [...path.slice(from), next].join(' → '))
        }
        if (c === 0) dfs(next)
      }
      path.pop()
      color.set(name, 2)
    }
    for (const name of this.records.keys()) if ((color.get(name) ?? 0) === 0) dfs(name)
  }

  private topoOrder(): string[] {
    const indeg = new Map<string, number>()
    const dependents = new Map<string, string[]>()
    for (const name of this.records.keys()) { indeg.set(name, 0); dependents.set(name, []) }
    for (const [name, rec] of this.records) {
      for (const dep of rec.decl.depends) {
        const provider = this.providers.get(dep.service)
        if (provider && provider !== name) {
          indeg.set(name, (indeg.get(name) ?? 0) + 1)
          dependents.get(provider)!.push(name)
        }
      }
    }
    const queue = [...this.records.keys()].filter(n => (indeg.get(n) ?? 0) === 0)
    const out: string[] = []
    while (queue.length) {
      const n = queue.shift()!
      out.push(n)
      for (const m of dependents.get(n)!) {
        const v = (indeg.get(m) ?? 0) - 1
        indeg.set(m, v)
        if (v === 0) queue.push(m)
      }
    }
    if (out.length !== this.records.size) throw new KernelError('E_CYCLE', '拓扑排序未覆盖全部插件（存在环）')
    return out
  }

  // ---- CONFIG ----
  configure(configs: Record<string, Record<string, unknown>> = {}): this {
    this.assertPhase('CONFIG')
    for (const rec of this.records.values()) {
      const cfg = { ...(configs[rec.decl.name] ?? {}) }
      const schema = rec.decl.configSchema
      if (schema) {
        for (const key of schema.required ?? []) {
          if (!(key in cfg)) throw new KernelError('E_CONFIG', `插件 ${rec.decl.name} 缺配置项 ${key}`)
        }
        for (const [key, type] of Object.entries(schema.props ?? {})) {
          if (!(key in cfg)) continue
          const v = cfg[key]
          const actual = Array.isArray(v) ? 'array' : typeof v
          if (actual !== type) throw new KernelError('E_CONFIG', `插件 ${rec.decl.name} 配置 ${key} 类型应为 ${type}，实际 ${actual}`)
        }
      }
      rec.config = cfg
      rec.state = 'configured'
    }
    this.phase = 'SETUP'
    return this
  }

  // ---- SETUP / START ----
  setupAll(): this {
    this.assertPhase('SETUP')
    for (const name of this.order) this.setupOne(this.records.get(name)!)
    this.phase = 'START'
    return this
  }

  async startAll(): Promise<this> {
    this.assertPhase('START')
    for (const name of this.order) await this.startOne(this.records.get(name)!)
    this.phase = 'RUNNING'
    return this
  }

  /** 便捷入口：register+resolve+configure+setupAll+startAll */
  async boot(plugins: PluginDeclaration[] = [], configs: Record<string, Record<string, unknown>> = {}): Promise<this> {
    this.register(plugins)
    this.resolve()
    this.configure(configs)
    this.setupAll()
    await this.startAll()
    return this
  }

  private setupOne(rec: Rec): void {
    const ctx = this.makeCtx(rec)
    try {
      rec.decl.hooks.setup?.(ctx)
      rec.state = 'setup'
    } catch (err) {
      this.degrade(rec, err)
    }
  }

  private async startOne(rec: Rec): Promise<void> {
    if (rec.state === 'degraded') return
    for (const dep of rec.decl.depends) {
      const provider = dep.service ? this.providers.get(dep.service) : undefined
      if (provider) {
        const pr = this.records.get(provider)!
        if (pr.state !== 'started' && !dep.optional) { this.degrade(rec, new Error(`依赖 ${provider} 未启动`)); return }
      }
    }
    try {
      await rec.decl.hooks.start?.(rec.ctx!)
      rec.state = 'started'
    } catch (err) {
      this.degrade(rec, err)
    }
  }

  private degrade(rec: Rec, err: unknown): void {
    rec.degraded = true
    rec.state = 'degraded'
    rec.error = err instanceof Error ? err.message : String(err)
    this.systemEmit('diag/degraded', { plugin: rec.decl.name, error: rec.error })
  }

  // ---- 运行期热插拔 ----
  async stopPlugin(name: string): Promise<void> {
    const rec = this.records.get(name)
    if (!rec) throw new KernelError('E_NO_PLUGIN', `未知插件 ${name}`)
    if (rec.decl.hotplug === 'core') throw new KernelError('E_HOTPLUG', `core 插件 ${name} 不可停用`)
    await this.teardown(rec)
  }

  async startPlugin(name: string): Promise<void> {
    const rec = this.records.get(name)
    if (!rec) throw new KernelError('E_NO_PLUGIN', `未知插件 ${name}`)
    if (rec.state === 'started') return
    if (rec.state !== 'disposed' && rec.state !== 'degraded' && rec.state !== 'stopped') {
      throw new KernelError('E_HOTPLUG', `插件 ${name} 状态 ${rec.state} 不可启动`)
    }
    rec.degraded = false
    this.setupOne(rec)
    await this.startOne(rec)
  }

  mount(scope: string, plugins: PluginDeclaration[]): this {
    // 作用域插件：可引用全局服务；自身按注册集独立解析。
    const before = this.phase
    this.phase = 'REGISTER'
    this.register(plugins)
    for (const name of this.records.keys()) if (this.records.get(name)!.scope === null && !this.order.includes(name)) this.records.get(name)!.scope = scope
    // 复用 resolve/configure/setup/start（增量：仅处理 scope 内新插件）
    const scopeRecs = plugins.map(p => this.records.get(p.name)!)
    for (const rec of scopeRecs) {
      for (const dep of rec.decl.depends) {
        if (!this.providers.has(dep.service) && !dep.optional) throw new KernelError('E_MISSING_SERVICE', `作用域 ${scope} 插件 ${rec.decl.name} 缺失依赖 ${dep.service}`)
      }
    }
    for (const rec of scopeRecs) {
      const cfg = {}
      rec.config = cfg
      this.setupOne(rec)
    }
    for (const rec of scopeRecs) { /* start 由调用方 await */ void rec }
    this.phase = before === 'RUNNING' ? 'RUNNING' : before
    void scopeRecs
    return this
  }

  async startScope(scope: string): Promise<this> {
    for (const name of this.order) {
      const rec = this.records.get(name)!
      if (rec.scope === scope && rec.state === 'setup') await this.startOne(rec)
    }
    return this
  }

  async unmount(scope: string): Promise<this> {
    const recs = [...this.records.values()].filter(r => r.scope === scope && r.state !== 'disposed')
    for (const rec of recs.slice().reverse()) await this.teardown(rec, true)
    return this
  }

  private async teardown(rec: Rec, unmounted = false): Promise<void> {
    const ctx = rec.ctx!
    try { await rec.decl.hooks.drain?.(ctx) } catch (err) { this.systemEmit('diag/degraded', { plugin: rec.decl.name, error: String(err) }) }
    try { rec.decl.hooks.stop?.(ctx) } catch { /* 停止异常不阻断卸载 */ }
    rec.decl.hooks.dispose?.(ctx)
    rec.state = 'disposed'
    const { handlers, intervals } = rec.leaks
    if (handlers > 0 || intervals > 0) {
      this.systemEmit('diag/leak', { plugin: rec.decl.name, handlers, intervals, scope: rec.scope ?? (unmounted ? 'unmounted' : 'global') })
    }
  }

  // ---- 服务 / 事件 / 诊断 ----
  service<T = unknown>(name: string): T {
    const provider = this.providers.get(name)
    if (!provider) throw new KernelError('E_MISSING_SERVICE', `未知服务 ${name}`)
    const v = this.records.get(provider)!.provided.get(name)
    if (v === undefined) throw new KernelError('E_SERVICE_NOT_READY', `服务 ${name} 尚未注册值`)
    return v as T
  }

  has(name: string): boolean { return this.providers.has(name) }

  emit(tag: string, payload: unknown): void { this.dispatch(tag, payload, this.appName) }

  on(tag: string, fn: (env: Envelope) => void): () => void {
    const key: Rec2 = { rec: null as unknown as Rec, fn }
    if (!this.handlers.has(tag)) this.handlers.set(tag, new Set())
    this.handlers.get(tag)!.add(key)
    return () => { this.handlers.get(tag)?.delete(key) }
  }

  onAny(fn: (env: Envelope) => void): () => void {
    const key: Rec2 = { rec: null as unknown as Rec, fn }
    this.anyHandlers.add(key)
    return () => { this.anyHandlers.delete(key) }
  }

  private dispatch(tag: string, payload: unknown, source: string): void {
    const env: Envelope = { ver: 1, tag, wallTs: this.clock.wallMs(), logicalDay: this.clock.logicalDay(), traceId: this.newTraceId(), source, payload }
    for (const key of this.handlers.get(tag) ?? []) key.fn(env)
    for (const key of this.anyHandlers) key.fn(env)
  }

  private systemEmit(tag: string, payload: unknown): void { this.dispatch(tag, payload, '@rn/kernel') }

  exportGraph(): Graph {
    const nodes: GraphNode[] = []
    const edges: Graph['edges'] = []
    for (const rec of this.records.values()) {
      nodes.push({ name: rec.decl.name, hotplug: rec.decl.hotplug, provides: rec.decl.provides, depends: rec.decl.depends, scope: rec.scope })
      for (const dep of rec.decl.depends) {
        const provider = this.providers.get(dep.service)
        if (provider) edges.push({ from: rec.decl.name, to: provider, service: dep.service })
      }
    }
    return { nodes, edges }
  }

  healthAll(): { name: string; status: HealthStatus; detail?: string }[] {
    return this.order.map(name => {
      const rec = this.records.get(name)!
      if (rec.degraded) return { name, status: 'degraded' as HealthStatus, detail: rec.error }
      const r = rec.decl.health?.(rec.ctx!) ?? { status: 'ok' as HealthStatus }
      return { name, status: r.status, detail: r.detail }
    })
  }

  private makeCtx(rec: Rec): HookCtx {
    const kernel = this
    const ctx: HookCtx = {
      plugin: rec.decl.name,
      config: rec.config,
      logicalDay: () => kernel.clock.logicalDay(),
      traceId: () => kernel.newTraceId(),
      provide(name, value) {
        if (!rec.decl.provides.includes(name)) throw new KernelError('E_PROVIDE', `插件 ${rec.decl.name} 未声明提供 ${name}`)
        rec.provided.set(name, value)
      },
      service<T>(name: string): T { return kernel.service<T>(name) },
      has: (name: string) => kernel.has(name),
      emit(tag: string, payload: unknown): void {
        if (!(rec.decl.produces ?? []).includes(tag)) {
          throw new KernelError('E_TAG', `插件 ${rec.decl.name} 发出了未声明的事件 ${tag}`)
        }
        kernel.dispatch(tag, payload, rec.decl.name)
      },
      on(tag: string, fn: (env: Envelope) => void): () => void {
        rec.leaks.handlers++
        const key: Rec2 = { rec, fn }
        if (!kernel.handlers.has(tag)) kernel.handlers.set(tag, new Set())
        kernel.handlers.get(tag)!.add(key)
        return () => { rec.leaks.handlers--; kernel.handlers.get(tag)?.delete(key) }
      },
      onAny(fn: (env: Envelope) => void): () => void {
        rec.leaks.handlers++
        const key: Rec2 = { rec, fn }
        kernel.anyHandlers.add(key)
        return () => { rec.leaks.handlers--; kernel.anyHandlers.delete(key) }
      },
      setInterval(fn: () => void, ms: number): unknown {
        rec.leaks.intervals++
        const h = setInterval(() => fn(), ms)
        return h
      },
      clearInterval(handle: unknown): void {
        rec.leaks.intervals--
        clearInterval(handle as ReturnType<typeof setInterval>)
      }
    }
    rec.ctx = ctx
    return ctx
  }

  private assertPhase(expect: LifecyclePhase): void {
    if (this.phase !== expect) throw new KernelError('E_PHASE', `需要 ${expect} 相，当前 ${this.phase}`)
  }
}

export function createKernel(options: KernelOptions = {}): Kernel { return new Kernel(options) }
