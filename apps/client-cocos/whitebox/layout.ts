// 主界面布局（M2.5 功能点2，UI-UX设计规范 §3.1 线框 1:1 的坐标投影）。
// 设计逻辑分辨率 750×1624（§三）。全部几何为纯函数，供渲染器、命中测试与
// P4 合规扫描（热区 ≥88px / 交互字号 ≥24px）共用。
import { T } from './theme.ts'
import type { DockKey } from './state.ts'

export const DESIGN_W = 750
export const DESIGN_H = 1624

/** 热区下限（UI 规范 §一.3：热区 ≥88×88px）——P4 合规扫描断言值 */
export const HIT_MIN = 88

export interface Rect { x: number; y: number; w: number; h: number }

const M = T.space.l        // 页边距 32
const GAP = T.space.s      // 区块间距 16

// ---- 纵向分段（自上而下）----
export const HUD_H = T.typography.h1 + T.space.s          // 顶部 HUD 48（线框标注 48px 高）
export const RES_H = 64                                    // 资源栏高
export const DOCK_H = HIT_MIN                              // 底部 dock 高=热区下限
export const DOCK_Y = DESIGN_H - T.space.m - DOCK_H

export function hudRect(): Rect {
  return { x: 0, y: 0, w: DESIGN_W, h: HUD_H }
}
export function resourceRect(): Rect {
  return { x: 0, y: HUD_H + T.space.xs, w: DESIGN_W, h: RES_H }
}
export function settingsRect(): Rect {
  // ⚙ 设置入口：HUD 右端 88px 热区
  return { x: DESIGN_W - M - HIT_MIN, y: (HUD_H - HIT_MIN) / 2 + 2, w: HIT_MIN, h: HIT_MIN }
}

// ---- 剖面楼栋（6F×5 房间格子；1F 公共建筑，6F 瞭望塔）----
export const FLOORS = 6
export const ROOMS_PER_FLOOR = 5
const FLOOR_LABEL_W = 48
export function buildingRect(): Rect {
  const y = resourceRect().y + RES_H + GAP
  const h = DESIGN_H * 0.44 // 剖面区主体（6F×5 格）
  return { x: M, y, w: DESIGN_W - M * 2, h }
}
export function roomRect(floor: number, room: number): Rect {
  const b = buildingRect()
  const gw = (b.w - FLOOR_LABEL_W - T.space.xs * (ROOMS_PER_FLOOR - 1)) / ROOMS_PER_FLOOR
  const gh = (b.h - T.space.xs * (FLOORS - 1)) / FLOORS
  return {
    x: b.x + FLOOR_LABEL_W + room * (gw + T.space.xs),
    y: b.y + floor * (gh + T.space.xs),
    w: gw,
    h: gh
  }
}
export function floorLabelRect(floor: number): Rect {
  const b = buildingRect()
  const gh = (b.h - T.space.xs * (FLOORS - 1)) / FLOORS
  return { x: b.x, y: b.y + floor * (gh + T.space.xs), w: FLOOR_LABEL_W, h: gh }
}

// ---- 事件卡入口（今日事件，weight 高在前；§3.1「事件卡：深夜敲门人 ▶」）----
export function eventEntryRect(): Rect {
  const y = buildingRect().y + buildingRect().h + GAP
  return { x: M, y, w: DESIGN_W - M * 2, h: 112 }
}

// ---- 昨夜战报条（r均/死亡/负伤/恐慌摘要；P3 夜战面板落地前的 DAY 侧回看位）----
export function reportRect(): Rect {
  const y = eventEntryRect().y + eventEntryRect().h + GAP
  return { x: M, y, w: DESIGN_W - M * 2, h: 120 }
}

// ---- 底部 dock 四键（布防/招募/升级/▶夜，88px 热区；§3.1 线框 1:1）----
export const DOCK_KEYS: { key: DockKey; label: string }[] = [
  { key: 'deploy', label: '布防' },
  { key: 'recruit', label: '招募' },
  { key: 'upgrade', label: '升级' },
  { key: 'night', label: '▶夜' }
]
export function dockRects(): Rect[] {
  const n = DOCK_KEYS.length
  const w = (DESIGN_W - M * 2 - T.space.s * (n - 1)) / n
  return DOCK_KEYS.map((_, i) => ({ x: M + i * (w + T.space.s), y: DOCK_Y, w, h: DOCK_H }))
}
export function dockRect(key: DockKey): Rect {
  return dockRects()[DOCK_KEYS.findIndex(k => k.key === key)]
}

// ---- 底部滑入模态面板（§3.1「模态面板自底部滑入 normal 300ms」；渲染与命中共用）----
export const MODAL_H = 420
export function modalRect(): Rect {
  return { x: M, y: DESIGN_H - T.space.m - MODAL_H, w: DESIGN_W - M * 2, h: MODAL_H }
}
export function modalCloseRect(): Rect {
  const r = modalRect()
  return { x: r.x + r.w - HIT_MIN - T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN, h: HIT_MIN }
}

// ---- 命中测试（点击 → 元素），自上而下优先（模态/dock 先于背景）----
export type HitTarget =
  | { kind: 'dock'; key: DockKey }
  | { kind: 'settings' }
  | { kind: 'eventEntry' }
  | { kind: 'room'; floor: number; room: number }
  | { kind: 'modalClose' }
  | { kind: 'modal' }
  | { kind: 'none' }

export function hitTest(x: number, y: number, modalOpen = false): HitTarget {
  const inRect = (r: Rect): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
  if (modalOpen) {
    // 模态打开：只有关闭按钮可点，其余点击不穿透
    if (inRect(modalCloseRect())) return { kind: 'modalClose' }
    return { kind: 'modal' }
  }
  for (const [i, r] of dockRects().entries()) {
    if (inRect(r)) return { kind: 'dock', key: DOCK_KEYS[i].key }
  }
  if (inRect(settingsRect())) return { kind: 'settings' }
  if (inRect(eventEntryRect())) return { kind: 'eventEntry' }
  for (let f = 0; f < FLOORS; f++) {
    for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
      if (inRect(roomRect(f, r))) return { kind: 'room', floor: FLOORS - f, room: r }
    }
  }
  return { kind: 'none' }
}
