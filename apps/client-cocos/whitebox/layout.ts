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
/** 确认按钮（confirmNight 弹层的「入夜」主行动；与关闭钮同排左右分布） */
export function modalConfirmRect(): Rect {
  const r = modalRect()
  return { x: r.x + T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN + T.space.l, h: HIT_MIN }
}
/** 事件卡选项按钮（§3.2；渲染与命中共用同一 rect） */
export function modalOptionRect(): Rect {
  const r = modalRect()
  return { x: r.x + T.space.m, y: r.y + 170, w: r.w - T.space.m * 2, h: HIT_MIN + T.space.xs }
}

// ---- 夜战面板（§3.3：波次标记/路血条三态/主动技 CD 环 88px/战况日志）----
export const NIGHT_ROUTE_H = 72
export function nightRouteRect(i: number): Rect {
  return { x: M, y: 220 + i * (NIGHT_ROUTE_H + T.space.s), w: DESIGN_W - M * 2, h: NIGHT_ROUTE_H }
}
export function nightSkillRects(): Rect[] {
  // 主动技：空投物资 / 护盾（88px 热区，§3.3）
  return [0, 1].map(i => ({ x: M + i * (HIT_MIN + T.space.s), y: 700, w: HIT_MIN, h: HIT_MIN }))
}
export function nightLogRect(): Rect {
  return { x: M, y: 840, w: DESIGN_W - M * 2, h: 560 }
}
export function nightBackRect(): Rect {
  return { x: (DESIGN_W - HIT_MIN * 2) / 2, y: DOCK_Y, w: HIT_MIN * 2, h: HIT_MIN }
}

// ---- DUSK 夜战预告横幅（SILENT 时替换为「?」，§四）----
export function duskBannerRect(): Rect {
  return { x: M, y: HUD_H + T.space.s, w: DESIGN_W - M * 2, h: 104 }
}
export function duskConfirmRect(): Rect {
  const b = duskBannerRect()
  return { x: b.x + b.w - HIT_MIN - T.space.s, y: b.y + (b.h - HIT_MIN) / 2, w: HIT_MIN, h: HIT_MIN }
}

// ---- 收租结算面板（DAWN 标志性瞬间：物资雨→计数器→逐户弹出，§3.4）----
export const SETTLE_H = 560
export function settlePanelRect(): Rect {
  return { x: M, y: DESIGN_H - T.space.m - SETTLE_H, w: DESIGN_W - M * 2, h: SETTLE_H }
}
export function settleCounterRect(): Rect {
  const r = settlePanelRect()
  return { x: r.x, y: r.y + 96, w: r.w, h: 96 }
}
export const SETTLE_POP_MAX = 6
export function settlePopRect(i: number): Rect {
  const r = settlePanelRect()
  return { x: r.x + T.space.m, y: r.y + 216 + i * 48, w: r.w - T.space.m * 2, h: 44 }
}
export function settleContinueRect(): Rect {
  const r = settlePanelRect()
  return { x: r.x + r.w - HIT_MIN - T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN + T.space.l, h: HIT_MIN }
}

// ---- 占位页（M2.5 功能点4：图鉴 3 列网格 / 商店礼包横滑 / 设置列表）----
export function pageBackRect(): Rect {
  return { x: M, y: HUD_H + T.space.s, w: HIT_MIN, h: HIT_MIN }
}
export function pageTitleRect(): Rect {
  return { x: M + HIT_MIN + T.space.s, y: HUD_H + T.space.s, w: DESIGN_W - M * 2 - HIT_MIN - T.space.s, h: HIT_MIN }
}
export const CODEX_COLS = 3
export const CODEX_ROWS = 3
export function codexCellRect(col: number, row: number): Rect {
  const gx = M, gy = HUD_H + T.space.s * 2 + HIT_MIN
  const cw = (DESIGN_W - M * 2 - T.space.s * (CODEX_COLS - 1)) / CODEX_COLS
  const ch = 240
  return { x: gx + col * (cw + T.space.s), y: gy + row * (ch + T.space.s), w: cw, h: ch }
}
export const SHOP_CARDS = 3
export function shopCardRect(i: number): Rect {
  // 礼包卡横滑：卡片宽 420，横向排列可滑动（白盒首卡对齐）
  const w = 420, h = 560
  return { x: M + i * (w + T.space.s), y: HUD_H + T.space.s * 2 + HIT_MIN, w, h }
}
export const SETTINGS_ROWS: { key: string; label: string }[] = [
  { key: 'codex', label: '图鉴' },
  { key: 'shop', label: '商店' },
  { key: 'sfx', label: '音效' },
  { key: 'bgm', label: '音乐' },
  { key: 'notice', label: '推送通知' }
]
export function settingsRowRect(i: number): Rect {
  return { x: M, y: HUD_H + T.space.s * 2 + HIT_MIN + i * (88 + T.space.s), w: DESIGN_W - M * 2, h: 88 }
}

// ---- 命中测试（点击 → 元素），自上而下优先（模态/dock 先于背景）----
export type HitTarget =
  | { kind: 'dock'; key: DockKey }
  | { kind: 'settings' }
  | { kind: 'eventEntry' }
  | { kind: 'room'; floor: number; room: number }
  | { kind: 'modalClose' }
  | { kind: 'modalConfirm' }
  | { kind: 'modalOption' }
  | { kind: 'modal' }
  | { kind: 'duskConfirm' }
  | { kind: 'skill'; index: number }
  | { kind: 'nightBack' }
  | { kind: 'settleContinue' }
  | { kind: 'pageBack' }
  | { kind: 'nav'; page: 'codex' | 'shop' }
  | { kind: 'mapBack' }
  | { kind: 'interiorBack' }
  | { kind: 'fortSlot'; index: number }
  | { kind: 'lot'; id: string }
  | { kind: 'none' }

export function hitTest(x: number, y: number, opts: { modalOpen?: boolean; page?: string } = {}): HitTarget {
  const modalOpen = opts.modalOpen ?? false
  const page = opts.page ?? 'main'
  const inRect = (r: Rect): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h
  if (modalOpen) {
    // 模态打开：确认/关闭可点，其余点击不穿透
    if (inRect(modalCloseRect())) return { kind: 'modalClose' }
    if (inRect(modalConfirmRect())) return { kind: 'modalConfirm' }
    if (inRect(modalOptionRect())) return { kind: 'modalOption' }
    return { kind: 'modal' }
  }
  // L2 小区地图：等距地块命中（楼栋/大门/设施）+ dock
  if (page === 'map') {
    for (const [id, lot] of Object.entries(LOTS)) {
      const base = isoToScreen(lot.gx, lot.gy)
      const cx = base.x, cy = base.y + ISO_TILE_H / 2
      const bw = lot.kind === 'bld' ? 100 : lot.kind === 'wall' ? 140 : 80
      const bh = lot.kind === 'bld' ? 230 : 90
      if (x >= cx - bw / 2 && x <= cx + bw / 2 && y >= cy - bh && y <= cy + 30) return { kind: 'lot', id }
    }
    for (const [i, r] of dockRects().entries()) if (inRect(r)) return { kind: 'dock', key: DOCK_KEYS[i].key }
    if (inRect(settingsRect())) return { kind: 'settings' }
    return { kind: 'none' }
  }
  // L3 室内：返回 + 工事位
  if (page === 'interior') {
    if (inRect(interiorBackRect())) return { kind: 'interiorBack' }
    for (const [i, r] of [interiorSlotRect(0), interiorSlotRect(1)].entries()) {
      if (inRect(r)) return { kind: 'fortSlot', index: i }
    }
    return { kind: 'none' }
  }
  // 楼内楼层视图（main）：返回小区
  if (page === 'main' && inRect(mapBackRect())) return { kind: 'mapBack' }
  // 占位页接管（图鉴/商店/设置）：返回键 + 站内导航
  if (page !== 'main') {
    if (inRect(pageBackRect())) return { kind: 'pageBack' }
    if (page === 'settings') {
      for (const [i, row] of SETTINGS_ROWS.entries()) {
        if (inRect(settingsRowRect(i)) && (row.key === 'codex' || row.key === 'shop')) {
          return { kind: 'nav', page: row.key }
        }
      }
    }
    return { kind: 'none' }
  }
  // 全屏接管面（DUSK 确认 / NIGHT 面板 / DAWN 结算）优先于主界面元素
  if (inRect(duskConfirmRect())) return { kind: 'duskConfirm' }
  for (const [i, r] of nightSkillRects().entries()) if (inRect(r)) return { kind: 'skill', index: i }
  if (inRect(nightBackRect())) return { kind: 'nightBack' }
  if (inRect(settleContinueRect())) return { kind: 'settleContinue' }
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


// ---- L2 小区等距地图（UI 规范 v2.0 §7.1；地块落位=config/map_def.json 的布局投影）----
export const ISO_TILE_W = 110
export const ISO_TILE_H = 55
export const ISO_ORIGIN = { x: DESIGN_W / 2, y: 320 }
export const ISO_FLOOR_H = 26 // 楼栋每层像素高度

export function isoToScreen(gx: number, gy: number, z = 0): { x: number; y: number } {
  return { x: ISO_ORIGIN.x + (gx - gy) * (ISO_TILE_W / 2), y: ISO_ORIGIN.y + (gx + gy) * (ISO_TILE_H / 2) - z * ISO_FLOOR_H }
}
export function screenToIso(sx: number, sy: number): { gx: number; gy: number } {
  const dx = sx - ISO_ORIGIN.x, dy = sy - ISO_ORIGIN.y
  return {
    gx: Math.floor((dy / (ISO_TILE_H / 2) + dx / (ISO_TILE_W / 2)) / 2),
    gy: Math.floor((dy / (ISO_TILE_H / 2) - dx / (ISO_TILE_W / 2)) / 2)
  }
}

/** 地块统一表（布局投影=config/map_def.json；kind 决定绘制形态与命中行为） */
export const LOTS: Record<string, { gx: number; gy: number; name: string; kind: 'bld' | 'gate' | 'wall' | 'plaza' | 'facility'; unlockDay: number }> = {
  lot_gate: { gx: 3, gy: 7, name: '大门', kind: 'gate', unlockDay: 1 },
  lot_wall: { gx: 2, gy: 6, name: '围墙', kind: 'wall', unlockDay: 1 },
  lot_plaza: { gx: 4, gy: 5, name: '广场', kind: 'plaza', unlockDay: 1 },
  lot_bld_a: { gx: 2, gy: 3, name: 'A栋', kind: 'bld', unlockDay: 1 },
  lot_bld_b: { gx: 5, gy: 3, name: 'B栋', kind: 'bld', unlockDay: 30 },
  lot_bld_c: { gx: 6, gy: 5, name: 'C栋', kind: 'bld', unlockDay: 30 },
  lot_canteen: { gx: 3, gy: 4, name: '食堂', kind: 'facility', unlockDay: 1 },
  lot_warehouse: { gx: 4, gy: 4, name: '仓库', kind: 'facility', unlockDay: 1 },
  lot_clinic: { gx: 5, gy: 4, name: '医务室', kind: 'facility', unlockDay: 1 },
  lot_workshop: { gx: 2, gy: 5, name: '工坊', kind: 'facility', unlockDay: 3 },
  lot_broadcast: { gx: 5, gy: 5, name: '广播站', kind: 'facility', unlockDay: 2 },
  lot_hall: { gx: 3, gy: 6, name: '议事厅', kind: 'facility', unlockDay: 5 },
  lot_watchtower: { gx: 6, gy: 6, name: '岗哨塔', kind: 'facility', unlockDay: 4 }
}

export function mapBackRect(): Rect {
  return { x: M, y: HUD_H + T.space.xs, w: HIT_MIN, h: HIT_MIN }
}

// ---- L3 室内视图几何 ----
export function interiorBackRect(): Rect {
  return { x: M, y: HUD_H + T.space.xs, w: HIT_MIN + 60, h: HIT_MIN }
}
export function interiorSlotRect(i: number): Rect {
  return { x: DESIGN_W / 2 - 220 + i * 240, y: DESIGN_H / 2 - 210, w: 200, h: 120 }
}
