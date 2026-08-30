// @rn/core —— 游戏无关的领域原语：相状态机、可序列化分流 RNG、确定性哈希、命令总线。
// 确定性红线：本包不含 Math.random / Date.now / 超越函数（CI 静态检查对象）。

export const PHASES = ['DAWN_SETTLE', 'DAY', 'DUSK_FORECAST', 'NIGHT'] as const
export type Phase = typeof PHASES[number]

export function nextPhase(p: Phase): Phase {
  const i = PHASES.indexOf(p)
  return PHASES[(i + 1) % PHASES.length]
}

/** FNV-1a 32 位，8 位十六进制。用于结算哈希/校验和（非安全场景）。 */
export function hash32(input: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

export function mulberry32(a: number): () => number {
  let s = a | 0
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function mixHash(seed: number, stream: string, counter: number): number {
  let h = seed >>> 0
  const key = `${stream}#${counter}`
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export interface RngStreams {
  next(stream: string): number
  counters(): Record<string, number>
}

/** 计数器式分流 RNG：next(stream) 纯由 (seed, stream, counter) 决定，状态可序列化。 */
export function createRngStreams(seed: number, saved?: Record<string, number>): RngStreams {
  const counters: Record<string, number> = { ...(saved ?? {}) }
  return {
    next(stream: string): number {
      const c = (counters[stream] ?? 0) + 1
      counters[stream] = c
      return mulberry32(mixHash(seed, stream, c))()
    },
    counters: () => ({ ...counters })
  }
}

/** 日域纯抽取：第 day 天第 k 次抽取只取决于 (seed, stream, day, k)——夜战可独立重放。 */
export function createDayRng(seed: number, stream: string, day: number): { next(): number } {
  let k = 0
  return { next: () => mulberry32(mixHash(seed, `${stream}@d${day}`, ++k))() }
}

/** 规范化序列化：键排序，保证同构对象哈希一致。 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(',')}}`
}

/** 事件词汇表（FR-D2：词表外 tag 为错误；三类：Domain/Control/Diag） */
export const TAG = {
  phaseChanged: 'phase/changed',
  dawnSettled: 'dawn/settled',
  nightPlan: 'night/plan',
  battleResult: 'battle/result',
  econChanged: 'econ/changed',
  eventFired: 'event/fired',
  rewardGranted: 'reward/granted',
  diagRecord: 'diag/record',
  diagLeak: 'diag/leak',
  diagDegraded: 'diag/degraded',
  ctrlKillswitch: 'ctrl/killswitch'
} as const

export type CmdResult = { ok: true; value?: unknown } | { ok: false; error: string }

export function createCmdBus() {
  const handlers = new Map<string, (cmd: Record<string, unknown>) => unknown>()
  return {
    handle(type: string, fn: (cmd: Record<string, unknown>) => unknown): void {
      if (handlers.has(type)) throw new Error(`命令 ${type} 重复注册`)
      handlers.set(type, fn)
    },
    dispatch(cmd: { type: string } & Record<string, unknown>): CmdResult {
      const fn = handlers.get(cmd.type)
      if (!fn) return { ok: false, error: `未知命令 ${cmd.type}` }
      try { return { ok: true, value: fn(cmd) } }
      catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) } }
    }
  }
}
