// 动效时间线（M2.5 功能点3）：§二 motion 表五条曲线 + §3.4 结算三段式的纯函数投影。
// 全部时长/缓动取自 theme.json（theme.ts motion()），可单测逐条比对。
import { motion } from './theme'
import type { RouteResult } from '../creator/assets/scripts/shared/systems/index'
import type { RouteOutcome } from '../creator/assets/scripts/shared/formula/index'

export interface RouteView {
  route: RouteResult
  /** 血条填充比例（r/rTarget 三态）与状态色档位：0=危(红) 1=警戒(黄) 2=守住(绿) */
  ratio: number
  state: 0 | 1 | 2
}

/** 路血条三态（§3.3：红/黄/绿）；rTarget=1 为设计守御线（formula rTarget 档位） */
export function routeView(rt: RouteResult): RouteView {
  const ratio = Math.min(1, rt.r / 1)
  const state: 0 | 1 | 2 = rt.r < 0.95 ? 0 : rt.r < 1 ? 1 : 2
  return { route: rt, ratio, state }
}

export const OUTCOME_LABEL: Record<RouteOutcome, string> = {
  HOLD: '守住',
  HOLD_WOUNDED: '守住·负伤',
  LOSE_1: '破防×1',
  LOSE_2: '破防×2',
  LOSE_3P: '破防×3+'
}

/** 夜战波次推进：每波间隔 WAVE_MS（=normal×3=900ms，tokens 派生），血条按 normal 曲线充能 */
export const WAVE_MS = motion('normal').dur * 3
export function nightWaves(routes: RouteResult[], start: number, now: number): {
  revealed: RouteView[]
  currentFill: number
  done: boolean
  waveNo: number
} {
  const elapsed = Math.max(0, now - start)
  const n = Math.min(routes.length, Math.floor(elapsed / WAVE_MS) + 1)
  const revealed: RouteView[] = []
  for (let i = 0; i < n; i++) revealed.push(routeView(routes[i]))
  const into = elapsed - (n - 1) * WAVE_MS
  const currentFill = n === 0 ? 0 : Math.min(1, into / motion('normal').dur)
  return { revealed, currentFill, done: elapsed >= routes.length * WAVE_MS + motion('dissolve').dur, waveNo: n }
}

/** 收租金币计数器滚动值（§3.4：0.8s easeOutCubic——counter tokens） */
export function counterValue(target: number, start: number, now: number): number {
  const m = motion('counter')
  const p = Math.min(1, Math.max(0, (now - start) / m.dur))
  return Math.round(target * m.fn(p))
}

/** 逐户弹出：第 i 户在其 stagger 窗口内的 0→1 进度（§3.4：60ms 间隔——stagger tokens） */
export function popProgress(i: number, start: number, now: number): number {
  const st = motion('stagger')
  const m = motion('fast')
  const t0 = start + i * st.dur
  return Math.min(1, Math.max(0, (now - t0) / m.dur))
}

/** 结算面板动效链完成时刻（雨 500ms → 计数器 800ms → N 户 stagger 弹完） */
export function settleDoneAt(start: number, households: number): number {
  return start + motion('rain').dur + motion('counter').dur + households * motion('stagger').dur
}

/** 血月入场红闪×2 + 震屏（threat 曲线，repeat 2；返回叠加Alpha 与位移幅度） */
export function threatBurst(start: number, now: number): { flash: number; shake: number } {
  const t = motion('threat')
  const total = t.dur * (t.repeat ?? 1)
  const elapsed = now - start
  if (elapsed < 0 || elapsed > total + t.dur) return { flash: 0, shake: 0 }
  const u = (elapsed % t.dur) / t.dur
  const wave = t.fn(u) // easeInQuad 单次红闪
  const decay = 1 - elapsed / (total + t.dur)
  return { flash: wave * decay, shake: 8 * (1 - u) * decay }
}

/** 交叉溶解覆盖层 alpha（dissolve 曲线 800ms linear）：0=未开始 1=完成 */
export function dissolveAlpha(start: number | null, now: number): number {
  if (start === null) return 1 // 无转场=已完成态
  const m = motion('dissolve')
  return Math.min(1, Math.max(0, (now - start) / m.dur))
}

/** 事件卡滑入（fast 150ms easeOutQuad，§3.2）与翻面（normal 300ms easeOutCubic）进度 */
export function cardSlide(start: number, now: number): number {
  const m = motion('fast')
  return Math.min(1, Math.max(0, (now - start) / m.dur))
}
export function cardFlip(start: number | null, now: number): number {
  if (start === null) return 0
  const m = motion('normal')
  return Math.min(1, Math.max(0, (now - start) / m.dur))
}
