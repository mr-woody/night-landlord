// UI 状态机（M2.5 功能点2 骨架；UI-UX设计规范 §3.1 连续性规则 + §四 交互流总图）：
// - 相位：DAWN_SETTLE → DAY → DUSK_FORECAST → NIGHT → 循环（门② 一天循环四相）
// - 任意模态可被事件卡打断排队（队列最多 2，先进后出恢复）；夜战不可被打断（全屏接管）
// - 事件卡选择即锁定（不可回退，§3.2）
// 纯数据函数，无 DOM 依赖（单测直接覆盖）。
import type { EventCardMeta } from '../creator/assets/scripts/shared-headless/sim'

export type Phase = 'DAWN_SETTLE' | 'DAY' | 'DUSK_FORECAST' | 'NIGHT'
export type PageId = 'main' | 'codex' | 'shop' | 'settings'
export type DockKey = 'deploy' | 'recruit' | 'upgrade' | 'night'

export type ModalKind = 'panel' | 'event' | 'confirmNight'
export interface Modal {
  kind: ModalKind
  /** panel：dock 键位 id；event：事件 id；confirmNight：固定 'night' */
  id: string
  card?: EventCardMeta
  /** 已选定选项下标（选择即锁定后写入；undefined=未选择） */
  chosen?: number
}

export interface UiState {
  phase: Phase
  page: PageId
  /** 常规模态栈（panel/confirmNight）：LIFO 恢复 */
  modals: Modal[]
  /** 事件卡打断队列：最多 2，先进后出恢复；展示优先级高于常规模态栈 */
  eventQueue: Modal[]
}

export const EVENT_QUEUE_MAX = 2

export function createUiState(): UiState {
  return { phase: 'DAY', page: 'main', modals: [], eventQueue: [] }
}

/** 当前应展示的模态：事件卡优先（打断），否则常规模态栈顶 */
export function topModal(s: UiState): Modal | undefined {
  return s.eventQueue[s.eventQueue.length - 1] ?? s.modals[s.modals.length - 1]
}

/** 事件卡可否打断当前界面：夜战全屏接管，不可打断（UI 规范 §四） */
export function canInterrupt(s: UiState): boolean {
  return s.phase !== 'NIGHT'
}

/** 事件卡到达：夜战时拒绝；队列满 2 时拒绝（保持先进后出恢复序） */
export function pushEvent(s: UiState, card: EventCardMeta): UiState {
  if (!canInterrupt(s) || s.eventQueue.length >= EVENT_QUEUE_MAX) return s
  return { ...s, eventQueue: [...s.eventQueue, { kind: 'event', id: card.id, card }] }
}

/** 打开常规模态：夜战为唯一可交互面，其余模态一律拒绝 */
export function openModal(s: UiState, m: Modal): UiState {
  if (s.phase === 'NIGHT') return s
  return { ...s, modals: [...s.modals, m] }
}

/** 事件卡选定选项：选择即锁定——已选后再次选择为无操作（不可回退，§3.2） */
export function chooseOption(s: UiState, idx: number): UiState {
  const q = s.eventQueue
  if (q.length === 0) return s
  const top = q[q.length - 1]
  if (top.chosen !== undefined) return s
  return { ...s, eventQueue: [...q.slice(0, -1), { ...top, chosen: idx }] }
}

/** 关闭当前展示模态：先清事件队列，再弹常规模态栈（LIFO 恢复） */
export function closeModal(s: UiState): UiState {
  if (s.eventQueue.length > 0) return { ...s, eventQueue: s.eventQueue.slice(0, -1) }
  if (s.modals.length > 0) return { ...s, modals: s.modals.slice(0, -1) }
  return s
}

/** 相位推进（门②：DAWN_SETTLE→DAY→DUSK_FORECAST→NIGHT 单向循环） */
const NEXT: Record<Phase, Phase> = {
  DAWN_SETTLE: 'DAY',
  DAY: 'DUSK_FORECAST',
  DUSK_FORECAST: 'NIGHT',
  NIGHT: 'DAWN_SETTLE'
}
export function advancePhase(s: UiState): UiState {
  return { ...s, phase: NEXT[s.phase] }
}

/** 页面切换（M2.5 功能点4：图鉴/商店/设置占位页；非 DAY 相禁航——相位 UI 优先） */
export function setPage(s: UiState, page: PageId): UiState {
  if (s.phase !== 'DAY') return s
  return { ...s, page }
}
