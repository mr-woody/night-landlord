// @rn/formula —— M0 三曲线的唯一运行时实现：查表 + 乘数组合（ADR-3/D3）。
// 红线：禁 Math.pow/随机/墙钟；金币逐户 round 后求和（整数）。

export interface DayRow {
  day: number; population: number; q: number; u: number; income: number
  hp: number; routes: number; threat: number; rTarget: number; fReq: number
  deaths: number; ads: number; milestone: string
}
export interface DayCurveTable { version: number; sourceDoc: string; bloodMoonDays: number[]; rows: DayRow[] }
export interface ConstantEntry { key: string; value: number; min: number; max: number; desc: string; sourceDoc: string }
export interface ConstantsTable { version: number; sourceDoc: string; entries: ConstantEntry[] }
export type Quality = 'N' | 'R' | 'SR' | 'SSR'

export function loadConstants(entries: ConstantEntry[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) {
    if (e.value < e.min || e.value > e.max) throw new Error(`常量 ${e.key} 越出安全区间 [${e.min},${e.max}]`)
    out[e.key] = e.value
  }
  return out
}

export type RouteOutcome = 'HOLD' | 'HOLD_WOUNDED' | 'LOSE_1' | 'LOSE_2' | 'LOSE_3P'

export interface RentMods { panicFactor?: number; monthlyBonus?: number; rentBuff?: number }

/** 住户等级 → 发展系数：G_U^(level-1)。等级是 u 线的最小实现（M0 §3.2 部件）。 */
export function devMul(level: number, gU: number): number {
  let m = 1
  for (let i = 1; i < level; i++) m *= gU
  return m
}

export function createFormula(tables: { dayCurve: DayCurveTable; constants: Record<string, number> }) {
  const rows = tables.dayCurve.rows
  const C = tables.constants
  const qMul: Record<Quality, number> = {
    N: C.CFG_QUALITY_MUL_N, R: C.CFG_QUALITY_MUL_R, SR: C.CFG_QUALITY_MUL_SR, SSR: C.CFG_QUALITY_MUL_SSR
  }

  const row = (d: number): DayRow => {
    const r = rows.find(x => x.day === d)
    if (!r) throw new Error(`day_curve 缺少 D${d}`)
    return r
  }

  const api = {
    row,
    bloodMoon: (d: number): boolean => tables.dayCurve.bloodMoonDays.includes(d),
    /** 单户租金 = round(R0 × 品质倍率 × u系数 × 恐慌系数 × 加成） */
    rent(quality: Quality, level: number, mods: RentMods = {}): number {
      const panic = mods.panicFactor ?? 1
      const monthly = mods.monthlyBonus ?? 1
      const buff = mods.rentBuff ?? 1
      return Math.round(C.CFG_R0 * qMul[quality] * devMul(level, C.CFG_G_U) * panic * monthly * buff)
    },
    dailyRent(tenants: { quality: Quality; level: number }[], mods: RentMods = {}): number {
      let sum = 0
      for (const t of tenants) sum += api.rent(t.quality, t.level, mods)
      return sum
    },
    threat: (d: number): number => row(d).threat,
    fReq: (d: number): number => row(d).fReq,
    /** 路级判定（M0 §4.3 死亡带，规则配置化落点） */
    judgeRoute(r: number): RouteOutcome {
      if (r >= 1.2) return 'HOLD'
      if (r >= 1.05) return 'HOLD_WOUNDED'
      if (r >= 0.95) return 'LOSE_1'
      if (r >= 0.8) return 'LOSE_2'
      return 'LOSE_3P'
    },
    /** 设计锚点（对 day_curve 表自洽计算，M1 契约的判定源） */
    designAnchors() {
      const d1 = rows.find(r => r.day === 1)!
      const d7 = row(7)
      const r7 = d7.fReq / d7.threat
      const windows: [number, number][] = [[1, 7], [8, 14], [15, 21], [22, 28]]
      const cycles = windows.map(([s, e]) => {
        const prevF = s === 1 ? row(0).fReq : row(s - 1).fReq
        const dF = row(e).fReq - prevF
        const sumI = rows.filter(r => r.day >= s && r.day <= e).reduce((a, r) => a + r.income, 0)
        return { window: `D${s}-${e}`, beta: Math.round((dF * C.CFG_K_POWER) / sumI * 1000) / 10 }
      })
      return { d1Income: d1.income, r7, betaByCycle: cycles }
    }
  }
  return api
}
