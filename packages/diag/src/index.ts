// @rn/diag —— 诊断底盘（内核档 §5.2–5.6）：Logger 环形缓冲 / Health 聚合 / Audit。
// 职责单一：零游戏知识；业务遥测在 @rn/observability（M2）。
import { definePlugin, type Envelope, type PluginDeclaration } from '@rn/kernel'

export interface LogEntry {
  wallTs: number
  logicalDay: number
  level: 'debug' | 'info' | 'warn' | 'error' | 'fatal'
  channel: string
  traceId: string
  msg: string
  data?: unknown
}
export interface AuditEntry { wallTs: number; kind: string; actor: string; detail: unknown }

export interface LoggerService {
  log(level: LogEntry['level'], channel: string, msg: string, data?: unknown): void
  entries(): LogEntry[]
  tail(n: number): LogEntry[]
  size(): number
}
export interface AuditService {
  record(kind: string, actor: string, detail: unknown): void
  tail(n: number): AuditEntry[]
}

export function createDiagPlugin(options: { ringSize?: number; auditSize?: number } = {}): PluginDeclaration {
  const ringSize = options.ringSize ?? 512
  const auditSize = options.auditSize ?? 256
  return definePlugin({
    name: 'rn.diag',
    version: '0.1.0',
    hotplug: 'core',
    depends: [],
    provides: ['logger', 'audit'],
    produces: ['diag/record'],
    hooks: {
      setup(ctx) {
        const ring: LogEntry[] = []
        let dropped = 0
        const auditRing: AuditEntry[] = []
        const push = (e: LogEntry) => {
          if (ring.length >= ringSize) { ring.shift(); dropped++ }
          ring.push(e)
        }
        const logger: LoggerService = {
          log(level, channel, msg, data) {
            push({ wallTs: Date.now(), logicalDay: ctx.logicalDay(), level, channel, traceId: ctx.traceId(), msg, data })
          },
          entries: () => [...ring],
          tail: (n) => ring.slice(Math.max(0, ring.length - n)),
          size: () => ring.length
        }
        const audit: AuditService = {
          record(kind, actor, detail) {
            auditRing.push({ wallTs: Date.now(), kind, actor, detail })
            if (auditRing.length > auditSize) auditRing.shift()
          },
          tail: (n) => auditRing.slice(Math.max(0, auditRing.length - n))
        }
        // 订阅内核治理诊断流（degraded/leak/killswitch）——常开，进环形缓冲
        ctx.onAny((env: Envelope) => {
          if (env.tag === 'diag/leak' || env.tag === 'diag/degraded' || env.tag === 'ctrl/killswitch') {
            push({
              wallTs: env.wallTs, logicalDay: env.logicalDay,
              level: env.tag === 'diag/leak' ? 'error' : 'warn',
              channel: env.tag, traceId: env.traceId,
              msg: 'kernel governance event', data: env.payload
            })
          }
        })
        ctx.provide('logger', logger)
        ctx.provide('audit', audit)
      }
    },
    health: () => ({ status: 'ok' })
  })
}
