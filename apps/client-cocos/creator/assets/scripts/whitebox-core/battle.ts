// 夜战演出编排（M3.2 F6；设计 §2）：从 BattleSession 生成确定性表现时间线。
// 契约：演出与结算分离——时间线只读 session（routes/outcome/monsterId），可由
// session+start 完全复现（单测断言）；不改任何结算数据。
import type { BattleSession } from '../creator/assets/scripts/shared/systems/index'
import { WAVE_MS } from './anim'

export interface BattleCue {
  t: number
  kind: 'advance' | 'attack' | 'result'
  route: number
}

/** 波次时长：与 nightWaves 揭示节拍同源（normal×3=900ms，tokens 派生） */
export const WAVE_DURATION = WAVE_MS

/** 怪物视觉类型（差异化呈现，设计 §2.4）：由 monsterId 映射 */
export type MonsterVisual = 'crawler' | 'breaker' | 'climber' | 'flyer' | 'elite'
export function monsterVisual(monsterId: string | undefined): MonsterVisual {
  const id = monsterId ?? ''
  if (id.includes('nightking') || id.includes('elite') || id.includes('focus')) return 'elite'
  if (id.includes('flyer')) return 'flyer'
  if (id.includes('climber')) return 'climber'
  if (id.includes('breaker')) return 'breaker'
  return 'crawler'
}

/** 行进插值：progress ∈ [0,1] → 怪物沿路推进（0=出发，1=抵达目标小屋；占波次前 70%） */
export function monsterProgress(wave: number, start: number, now: number): number {
  const into = now - start - (wave - 1) * WAVE_MS
  if (into < 0) return 0
  return Math.min(1, into / (WAVE_MS * 0.7))
}

/** 全场时间线（确定性：同一 session+start 输出一致） */
export function battleTimeline(session: BattleSession, start: number): { cues: BattleCue[]; total: number } {
  const cues: BattleCue[] = []
  session.routes.forEach((_, i) => {
    const base = start + i * WAVE_DURATION
    cues.push({ t: base, kind: 'advance', route: i })
    cues.push({ t: base + WAVE_DURATION * 0.7, kind: 'attack', route: i })
    cues.push({ t: base + WAVE_DURATION * 0.95, kind: 'result', route: i })
  })
  cues.sort((a, b) => a.t - b.t)
  return { cues, total: session.routes.length * WAVE_DURATION }
}

/** 守卫职业差异化视觉（设计 §10.4）：守卫棍棒/猎人弓弩/平民锅——按车道序号确定性轮换 */
export type GuardVisual = 'club' | 'bow' | 'pot'
export function guardVisual(laneIdx: number): GuardVisual {
  const cycle: GuardVisual[] = ['club', 'bow', 'pot']
  return cycle[((laneIdx % 3) + 3) % 3]
}
