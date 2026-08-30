// 白盒渲染器（M2.5 功能点2：主界面风格化，对照 UI-UX设计规范 §3.1 线框 1:1）：
// 顶部 HUD（日次/血月进度/设置入口）+ 资源栏 + 剖面楼栋（6F×5 房间格子：占用亮格/
// 家具占位/破防血红 threat 闪烁/公共建筑占位）+ 事件卡入口 + 底部 dock 四键（88px 热区）
// + 底部滑入模态。视觉参数全部从 theme.ts tokens 取，零硬编码色值/字号/动效时长
// （scripts/check-theme.mjs 断言）。纯 Canvas 2D，零引擎依赖。
import { T, col, withAlpha, motion, font } from './theme.ts'
import type { UiState, Modal } from './state.ts'
import { topModal } from './state.ts'
import type { EventCardMeta } from '../../../apps/headless/src/sim.ts'
import {
  DESIGN_W, DESIGN_H, hudRect, resourceRect, settingsRect,
  roomRect, floorLabelRect, eventEntryRect, reportRect, dockRects, DOCK_KEYS,
  modalRect, modalCloseRect, FLOORS, ROOMS_PER_FLOOR
} from './layout.ts'

export interface DayFrame {
  day: number
  population: number
  roomsBuilt: number
  gold: number
  income: number
  power: number
  rAvg: number
  deaths: number
  wounds: number
  sessionHash: string
  modifiers: string[]
  avgLevel: number
  panicSum: number
  /** 表现层投影（entry 由 sim.sessions/ eventCards 计算的白盒渲染数据） */
  breachedRooms: string[]
  eventCards: EventCardMeta[]
}

export interface RendererCallbacks {
  onFps(fps: number, min: number, avg: number): void
}

/** 千分位（BebasNeue 等宽观感的占位实现；字体子集化在 M3） */
function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export class WhiteboxRenderer {
  private ctx: CanvasRenderingContext2D
  private frames = 0
  private fpsSamples: number[] = []
  private lastSample = 0
  private modalOpenAt: number | null = null

  constructor(canvas: HTMLCanvasElement, private cb: RendererCallbacks) {
    this.ctx = canvas.getContext('2d')!
  }

  /** rAF 主循环：帧率采样（预算 min ≥50fps）+ 重绘 */
  start(getFrame: () => DayFrame | null, getUi: () => UiState): void {
    const tick = (now: number) => {
      this.frames++
      if (now - this.lastSample >= 1000) {
        const fps = Math.round(this.frames * 1000 / (now - this.lastSample))
        this.fpsSamples.push(fps)
        this.cb.onFps(fps, Math.min(...this.fpsSamples), Math.round(this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length))
        this.frames = 0
        this.lastSample = now
      }
      const frame = getFrame()
      if (frame) this.draw(getUi(), frame, now)
      requestAnimationFrame(tick)
    }
    this.lastSample = performance.now()
    requestAnimationFrame(tick)
  }

  getSamples(): number[] {
    return this.fpsSamples
  }

  // ---- 主界面（§3.1 线框 1:1；DAY 相暖色 bg_dawn）----
  draw(ui: UiState, frame: DayFrame, now: number): void {
    const { ctx } = this
    ctx.fillStyle = col('bg_dawn')
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    this.drawHud(frame, now)
    this.drawResources(frame)
    this.drawBuilding(frame, now)
    this.drawEventEntry(frame)
    this.drawReport(frame)
    this.drawDock()
    this.drawModal(ui, now)
  }

  private panel(x: number, y: number, w: number, h: number, r = T.radius.panel): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.roundRect(x, y, w, h, r)
    ctx.fillStyle = col('panel')
    ctx.fill()
    ctx.strokeStyle = col('panel_stroke')
    ctx.lineWidth = 2
    ctx.stroke()
  }

  private drawHud(frame: DayFrame, now: number): void {
    const { ctx } = this
    const hud = hudRect()
    ctx.fillStyle = col('panel')
    ctx.fillRect(hud.x, hud.y, hud.w, hud.h)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath()
    ctx.moveTo(0, hud.h)
    ctx.lineTo(hud.w, hud.h)
    ctx.stroke()
    ctx.textBaseline = 'middle'
    // 日次（血月周期 🌙n/4：bloodMoonDays 每 7 日一循环）
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(`日次 D${frame.day}`, T.space.l, hud.h / 2)
    ctx.font = font(T.typography.body)
    ctx.fillText(`🌙${Math.ceil(frame.day / 7)}/4`, T.space.l + 180, hud.h / 2)
    // ⚙ 设置入口（88px 热区，layout.settingsRect）
    const st = settingsRect()
    ctx.fillStyle = col('text_secondary')
    ctx.fillText('⚙', st.x + st.w / 2 - 14, st.y + st.h / 2)
    // 特殊夜预告（血月=alert_blood 专用色；SILENT/MIGRATE=danger）
    if (frame.modifiers.length) {
      const isBM = frame.modifiers.includes('BLOOD_MOON')
      ctx.fillStyle = isBM ? col('alert_blood') : col('danger')
      ctx.font = font(T.typography.caption)
      const label = frame.modifiers.join('/')
      const tw = ctx.measureText(label).width
      // 血月标记 threat 曲线红闪（repeat 已入 tokens；此处持续低频脉冲占位）
      const threat = motion('threat')
      const pulse = isBM ? 0.55 + 0.45 * Math.sin((now / (threat.dur * 2)) * Math.PI * 2) : 1
      ctx.globalAlpha = pulse
      ctx.fillText(label, st.x - tw - T.space.s, hud.h / 2)
      ctx.globalAlpha = 1
    }
  }

  private drawResources(frame: DayFrame): void {
    const { ctx } = this
    const r = resourceRect()
    ctx.textBaseline = 'middle'
    ctx.font = font(T.typography.body)
    const items: { glyph: string; text: string; color: string }[] = [
      { glyph: '🪙', text: fmt(frame.gold), color: col('gold_primary') }, // 金色数字=货币（§二色彩角色）
      { glyph: '👥', text: `${frame.population}/${frame.roomsBuilt}`, color: col('text_primary') },
      { glyph: '⚔', text: fmt(frame.power), color: col('text_primary') },
      { glyph: '😱', text: `${frame.panicSum}`, color: col('panic') } // 恐慌紫=恐慌系统视觉锚
    ]
    const colW = r.w / items.length
    items.forEach((it, i) => {
      const x = r.x + colW * i + T.space.m
      ctx.fillStyle = col('text_secondary')
      ctx.fillText(it.glyph, x, r.y + r.h / 2)
      ctx.fillStyle = it.color
      ctx.fillText(it.text, x + 36, r.y + r.h / 2)
    })
  }

  private drawBuilding(frame: DayFrame, now: number): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    let occupied = frame.population
    const threat = motion('threat')
    for (let f = 0; f < FLOORS; f++) {
      const label = floorLabelRect(f)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`${FLOORS - f}F`, label.x, label.y + label.h / 2)
      for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
        const rect = roomRect(f, r)
        const roomId = `F${FLOORS - f}-R${r + 1}`
        const breached = frame.breachedRooms.includes(roomId)
        const isPublic = f === FLOORS - 1 && r < 3 // 1F：大厅/医务/仓（公共建筑占位）
        const isTower = f === 0 && r === 0          // 6F：瞭望塔
        const isOccupied = !isPublic && !isTower && occupied > 0
        if (isOccupied) occupied--
        if (breached) {
          // 破防房间：血红闪烁（threat 曲线脉冲；§3.1「破防房间=血红闪烁」）
          const pulse = 0.5 + 0.5 * Math.sin((now / (threat.dur * 2)) * Math.PI * 2)
          ctx.fillStyle = withAlpha(col('alert_blood'), 0.25 + 0.35 * pulse)
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.fill()
          ctx.strokeStyle = col('alert_blood')
          ctx.stroke()
          ctx.fillStyle = col('text_primary')
          ctx.font = font(T.typography.caption)
          ctx.fillText('破防', rect.x + rect.w / 2 - 18, rect.y + rect.h / 2)
        } else if (isPublic || isTower) {
          ctx.strokeStyle = col('panel_stroke')
          ctx.strokeRect(rect.x, rect.y, rect.w, rect.h)
          ctx.fillStyle = withAlpha(col('gold_deep'), 0.2)
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.fill()
          ctx.fillStyle = col('text_secondary')
          ctx.font = font(T.typography.caption)
          const name = isTower ? '瞭望塔' : ['大厅', '医务', '仓'][r]
          ctx.fillText(name, rect.x + rect.w / 2 - name.length * 9, rect.y + rect.h / 2)
        } else if (isOccupied) {
          // 占用=亮格 + 住户头像占位 + 家具占位剪影
          ctx.fillStyle = withAlpha(col('success'), 0.15)
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.fill()
          ctx.strokeStyle = col('success')
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.stroke()
          ctx.fillStyle = col('text_primary')
          ctx.font = font(T.typography.caption)
          ctx.fillText('🧑', rect.x + 12, rect.y + rect.h / 2)
          ctx.fillText('🛏', rect.x + rect.w - 34, rect.y + rect.h / 2) // 家具占位剪影
        } else {
          ctx.strokeStyle = col('panel_stroke')
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.stroke()
        }
      }
    }
  }

  private drawEventEntry(frame: DayFrame): void {
    const { ctx } = this
    const r = eventEntryRect()
    this.panel(r.x, r.y, r.w, r.h, T.radius.btn)
    ctx.textBaseline = 'middle'
    // weight 高在前（entry 已按权重排序），无事件日显示静谧
    const top = frame.eventCards[0]
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('今日事件', r.x + T.space.m, r.y + 30)
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body, { weight: 'bold' })
    ctx.fillText(top ? top.title : '静谧 · 无事件', r.x + T.space.m, r.y + 72)
    if (frame.eventCards.length > 1) {
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`+${frame.eventCards.length - 1}`, r.x + r.w - T.space.l - 40, r.y + 30)
    }
    ctx.fillStyle = col('gold_primary')
    ctx.font = font(T.typography.h2)
    ctx.fillText('▶', r.x + r.w - T.space.l - 28, r.y + 72)
  }

  private drawReport(frame: DayFrame): void {
    const { ctx } = this
    const r = reportRect()
    this.panel(r.x, r.y, r.w, r.h)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('昨夜战报', r.x + T.space.m, r.y + 26)
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body)
    ctx.fillText(`r均 ${frame.rAvg} · 死亡 ${frame.deaths} · 负伤 ${frame.wounds}`, r.x + T.space.m, r.y + 62)
    // 恐慌条（panic 紫专色；归一化基准=人口×PANIC_MAX 上限）
    const barW = r.w - T.space.m * 2
    ctx.fillStyle = withAlpha(col('panic'), 0.2)
    ctx.fillRect(r.x + T.space.m, r.y + r.h - 34, barW, 10)
    const panicRatio = Math.min(1, frame.population > 0 ? frame.panicSum / (frame.population * 100) : 0)
    ctx.fillStyle = col('panic')
    ctx.fillRect(r.x + T.space.m, r.y + r.h - 34, barW * panicRatio, 10)
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText(`hash=${frame.sessionHash}`, r.x + r.w - T.space.m - 220, r.y + 26)
  }

  private drawDock(): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    dockRects().forEach((r, i) => {
      const key = DOCK_KEYS[i]
      const isNight = key.key === 'night'
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn)
      ctx.fillStyle = isNight ? withAlpha(col('gold_primary'), 0.16) : col('panel')
      ctx.fill()
      ctx.strokeStyle = isNight ? col('gold_deep') : col('panel_stroke')
      ctx.lineWidth = 2
      ctx.stroke()
      ctx.fillStyle = isNight ? col('gold_primary') : col('text_primary')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      const tw = ctx.measureText(key.label).width
      ctx.fillText(key.label, r.x + (r.w - tw) / 2, r.y + r.h / 2)
    })
  }

  // ---- 底部滑入模态（normal 300ms easeOutCubic；§3.1「模态面板自底部滑入」）----
  private drawModal(ui: UiState, now: number): void {
    const { ctx } = this
    const top: Modal | undefined = topModal(ui)
    if (!top) { this.modalOpenAt = null; return }
    if (this.modalOpenAt === null) this.modalOpenAt = now
    const m = motion('normal')
    const p = Math.min(1, (now - this.modalOpenAt) / m.dur)
    const eased = m.fn(p)
    const r = modalRect()
    const slide = (1 - eased) * (DESIGN_H - r.y)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.6 * eased)
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    const y = r.y + slide
    this.panel(r.x, y, r.w, r.h)
    ctx.textBaseline = 'middle'
    const title = top.kind === 'event' ? (top.card?.title ?? top.id)
      : top.kind === 'confirmNight' ? '确认入夜？'
      : ({ deploy: '布防', recruit: '招募', upgrade: '升级', settings: '设置' } as Record<string, string>)[top.id] ?? top.id
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(title, r.x + T.space.m, y + 48)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath(); ctx.moveTo(r.x + T.space.m, y + 80); ctx.lineTo(r.x + r.w - T.space.m, y + 80); ctx.stroke()
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.body)
    const body = top.kind === 'event' ? '事件详情与选项（P3 事件卡模板落地）'
      : top.kind === 'confirmNight' ? '入夜后不可打断（全屏夜战）'
      : '占位面板：M3 接入对应系统操作'
    ctx.fillText(body, r.x + T.space.m, y + 120)
    // 关闭按钮（88px 热区）
    const c = modalCloseRect()
    ctx.beginPath()
    ctx.roundRect(c.x, y + (c.y - r.y), c.w, c.h, T.radius.btn)
    ctx.fillStyle = withAlpha(col('text_secondary'), 0.15)
    ctx.fill()
    ctx.strokeStyle = col('panel_stroke')
    ctx.stroke()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body)
    const tw = ctx.measureText('关闭').width
    ctx.fillText('关闭', c.x + (c.w - tw) / 2, y + (c.y - r.y) + c.h / 2)
  }
}

/** 帧率采样报告（性能预算冒烟：中端机 ≥30fps，白盒预算 ≥50fps） */
export function fpsReport(samples: number[]): { min: number; avg: number; budgetOk: boolean } {
  const min = samples.length ? Math.min(...samples) : 0
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0
  return { min, avg, budgetOk: min >= 50 }
}
