// 白盒渲染器（M2.5 功能点2+3：主界面风格化 + 事件卡/夜战/收租结算 + §二 motion 表五曲线落地）。
// 视觉参数全部从 theme.ts tokens 取，零硬编码色值/字号/动效时长（scripts/check-theme.mjs 断言）。
// 纯 Canvas 2D，零引擎依赖；Creator 原生组件移植同一渲染协议（ADR-9 方案 a）。
import { T, col, withAlpha, motion, font } from './theme.ts'
import type { UiState, Modal } from './state.ts'
import { topModal } from './state.ts'
import type { EventCardMeta } from '../../../apps/headless/src/sim.ts'
import type { BattleSession } from '../../../packages/systems/src/index.ts'
import {
  DESIGN_W, DESIGN_H, hudRect, resourceRect, settingsRect,
  roomRect, floorLabelRect, eventEntryRect, reportRect, dockRects, DOCK_KEYS,
  modalRect, modalCloseRect, modalConfirmRect, modalOptionRect, FLOORS, ROOMS_PER_FLOOR,
  nightRouteRect, nightSkillRects, nightLogRect, nightBackRect,
  duskBannerRect, duskConfirmRect,
  settlePanelRect, settleCounterRect, settlePopRect, settleContinueRect, SETTLE_POP_MAX
} from './layout.ts'
import {
  nightWaves, OUTCOME_LABEL, counterValue, popProgress, settleDoneAt,
  threatBurst, dissolveAlpha, cardFlip
} from './anim.ts'

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

/** 播放上下文（entry 持有并更新；renderer 只读） */
export interface Playback {
  session: BattleSession | null
  monsterNames: Record<string, string>
  nightStart: number | null
  settleStart: number | null
  /** 当前事件卡选定时刻（翻面→结果浮现→图标飞向资源栏的时间线起点） */
  chosenAt: number | null
  /** 主动技战况日志（玩家点技能追加） */
  logs: string[]
  skills: { label: string; glyph: string; cdUntil: number }[]
}

export interface RendererCallbacks {
  onFps(fps: number, min: number, avg: number): void
}

/** 千分位（BebasNeue 等宽观感的占位实现；字体子集化在 M3） */
function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

const WAVE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

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
  start(getFrame: () => DayFrame | null, getUi: () => UiState, getPb: () => Playback): void {
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
      if (frame) this.draw(getUi(), frame, now, getPb())
      requestAnimationFrame(tick)
    }
    this.lastSample = performance.now()
    requestAnimationFrame(tick)
  }

  getSamples(): number[] {
    return this.fpsSamples
  }

  // ---- 相位分发（门②：DAWN_SETTLE→DAY→DUSK_FORECAST→NIGHT 四相 UI 状态机）----
  draw(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    switch (ui.phase) {
      case 'DAWN_SETTLE':
        // 夜→昼交叉溶解（dissolve 800ms linear）打底
        this.bgBase(col('bg_night'))
        ctx.fillStyle = withAlpha(col('bg_dawn'), dissolveAlpha(pb.settleStart, now))
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
        this.drawSettle(frame, now, pb)
        this.drawModal(ui, frame, now, pb)
        break
      case 'DAY':
        ctx.fillStyle = col('bg_dawn')
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
        this.drawHud(frame, now)
        this.drawResources(frame)
        this.drawBuilding(frame, now)
        this.drawEventEntry(frame)
        this.drawReport(frame)
        this.drawDock()
        this.drawModal(ui, frame, now, pb)
        break
      case 'DUSK_FORECAST':
        ctx.fillStyle = col('bg_dawn')
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
        this.drawHud(frame, now)
        this.drawResources(frame)
        this.drawBuilding(frame, now)
        this.drawEventEntry(frame)
        this.drawReport(frame)
        this.drawDock()
        this.drawDuskBanner(frame, now)
        this.drawModal(ui, frame, now, pb)
        break
      case 'NIGHT':
        this.drawNight(frame, now, pb)
        this.drawNightLog(frame, now, pb)
        break
    }
  }

  private bgBase(c: string): void {
    this.ctx.fillStyle = c
    this.ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
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
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(`日次 D${frame.day}`, T.space.l, hud.h / 2)
    ctx.font = font(T.typography.body)
    ctx.fillText(`🌙${Math.ceil(frame.day / 7)}/4`, T.space.l + 180, hud.h / 2)
    const st = settingsRect()
    ctx.fillStyle = col('text_secondary')
    ctx.fillText('⚙', st.x + st.w / 2 - 14, st.y + st.h / 2)
    if (frame.modifiers.length) {
      const isBM = frame.modifiers.includes('BLOOD_MOON')
      ctx.fillStyle = isBM ? col('alert_blood') : col('danger')
      ctx.font = font(T.typography.caption)
      const label = frame.modifiers.join('/')
      const tw = ctx.measureText(label).width
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
          ctx.fillStyle = withAlpha(col('success'), 0.15)
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.fill()
          ctx.strokeStyle = col('success')
          ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip); ctx.stroke()
          ctx.fillStyle = col('text_primary')
          ctx.font = font(T.typography.caption)
          ctx.fillText('🧑', rect.x + 12, rect.y + rect.h / 2)
          ctx.fillText('🛏', rect.x + rect.w - 34, rect.y + rect.h / 2)
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

  // ---- DUSK 夜战预告横幅（SILENT 时替换为「?」，§四）----
  private drawDuskBanner(frame: DayFrame, now: number): void {
    const { ctx } = this
    const b = duskBannerRect()
    this.panel(b.x, b.y, b.w, b.h, T.radius.btn)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('入夜预告', b.x + T.space.m, b.y + 28)
    const silent = frame.modifiers.includes('SILENT')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    if (silent) {
      ctx.fillStyle = col('text_secondary')
      ctx.fillText('？', b.x + T.space.m, b.y + 68)
      ctx.font = font(T.typography.caption)
      ctx.fillText('静默之夜 · 情报缺失', b.x + T.space.m + 44, b.y + 68)
    } else {
      const isBM = frame.modifiers.includes('BLOOD_MOON')
      ctx.fillStyle = isBM ? col('alert_blood') : col('text_primary')
      ctx.fillText(isBM ? '血月 🔴' : '常规夜袭', b.x + T.space.m, b.y + 68)
      if (frame.modifiers.includes('MIGRATE')) {
        ctx.fillStyle = col('danger')
        ctx.font = font(T.typography.caption)
        ctx.fillText('怪物迁移 · 开战重排', b.x + T.space.m + 150, b.y + 68)
      }
    }
    // 布防确认（88px 热区；threat 红闪吸引注意）
    const c = duskConfirmRect()
    const threat = motion('threat')
    const pulse = 0.7 + 0.3 * Math.sin((now / (threat.dur * 2)) * Math.PI * 2)
    ctx.globalAlpha = pulse
    this.button(c, '布防', col('gold_primary'), withAlpha(col('gold_primary'), 0.16), col('gold_deep'))
    ctx.globalAlpha = 1
  }

  private button(r: { x: number; y: number; w: number; h: number }, label: string, textColor: string, bg: string, stroke: string): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn)
    ctx.fillStyle = bg
    ctx.fill()
    ctx.strokeStyle = stroke
    ctx.lineWidth = 2
    ctx.stroke()
    ctx.fillStyle = textColor
    ctx.font = font(T.typography.body, { weight: 'bold' })
    const tw = ctx.measureText(label).width
    ctx.fillText(label, r.x + (r.w - tw) / 2, r.y + r.h / 2)
  }

  // ---- NIGHT 全屏夜战面板（§3.3：血月 threat 红闪×2+震屏 / 路血条三态 / 技能 CD 环）----
  private drawNight(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    ctx.save()
    if (frame.modifiers.includes('BLOOD_MOON') && pb.nightStart !== null) {
      const burst = threatBurst(pb.nightStart, now)
      if (burst.shake > 0) ctx.translate(Math.sin(now / 16) * burst.shake, Math.cos(now / 13) * burst.shake)
      this.bgBase(col('bg_night'))
      if (burst.flash > 0) {
        ctx.fillStyle = withAlpha(col('alert_blood'), 0.35 * burst.flash)
        ctx.fillRect(-20, -20, DESIGN_W + 40, DESIGN_H + 40)
      }
    } else {
      this.bgBase(col('bg_night'))
    }
    ctx.textBaseline = 'middle'
    // 标题：特殊夜标记 + 波次
    const isBM = frame.modifiers.includes('BLOOD_MOON')
    const waves = pb.session && pb.nightStart !== null ? nightWaves(pb.session.routes, pb.nightStart, now) : null
    ctx.fillStyle = isBM ? col('alert_blood') : col('text_primary')
    ctx.font = font(T.typography.h1, { weight: 'bold' })
    ctx.fillText(isBM ? '血月 🔴' : '夜袭', T.space.l, 120)
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.h2)
    const total = pb.session?.routes.length ?? 0
    ctx.fillText(`第 ${waves?.waveNo ?? 0}/${total} 波`, T.space.l + 260, 120)
    if (pb.session?.silent) {
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.body)
      ctx.fillText('？', T.space.l + 480, 120)
    }
    // 路血条（红/警戒/绿三态；当前波 normal 曲线充能）
    if (pb.session && waves) {
      pb.session.routes.forEach((_, i) => {
        const rv = waves.revealed[i]
        const r = nightRouteRect(i)
        const isCurrent = waves.waveNo === i + 1
        const fill = rv ? (isCurrent ? waves.currentFill : 1) : 0
        ctx.fillStyle = col('text_secondary')
        ctx.font = font(T.typography.caption)
        ctx.fillText(`路${WAVE_LETTERS[i]}`, r.x, r.y + r.h / 2)
        const barX = r.x + 64, barW = r.w - 64 - 160
        ctx.fillStyle = withAlpha(col('panel_stroke'), 0.6)
        ctx.beginPath(); ctx.roundRect(barX, r.y + r.h / 2 - 14, barW, 28, T.radius.chip); ctx.fill()
        if (fill > 0) {
          const stateColor = rv.state === 0 ? col('alert_blood') : rv.state === 1 ? col('gold_deep') : col('success')
          ctx.fillStyle = stateColor
          ctx.beginPath(); ctx.roundRect(barX, r.y + r.h / 2 - 14, Math.max(8, barW * fill), 28, T.radius.chip); ctx.fill()
        }
        ctx.fillStyle = col('text_primary')
        ctx.font = font(T.typography.body)
        if (rv) {
          const mon = pb.monsterNames[rv.route.monsterId ?? ''] ?? '怪物'
          const warn = rv.state === 0 ? ' ⚠⚠' : rv.state === 1 ? ' ⚠' : ''
          ctx.fillText(`${mon} ${Math.round(rv.route.r * 100)}%${warn}`, barX + barW + T.space.s, r.y + r.h / 2)
        } else {
          ctx.fillStyle = col('text_secondary')
          ctx.fillText('？？', barX + barW + T.space.s, r.y + r.h / 2)
        }
      })
    }
    // 主动技（88px 热区 + CD 环）
    nightSkillRects().forEach((r, i) => {
      const sk = pb.skills[i]
      if (!sk) return
      ctx.beginPath()
      ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn)
      ctx.fillStyle = col('panel')
      ctx.fill()
      ctx.strokeStyle = col('panel_stroke')
      ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.h2)
      ctx.fillText(sk.glyph, r.x + r.w / 2 - 16, r.y + r.h / 2 - 8)
      ctx.font = font(T.typography.caption)
      ctx.fillStyle = col('text_secondary')
      const lw = ctx.measureText(sk.label).width
      ctx.fillText(sk.label, r.x + (r.w - lw) / 2, r.y + r.h - 18)
      const cdLeft = sk.cdUntil - now
      if (cdLeft > 0) {
        const frac = cdLeft / (motion('normal').dur * 10) // CD 总长=normal×10（占位，tokens 派生）
        ctx.beginPath()
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 30, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2)
        ctx.strokeStyle = col('gold_primary')
        ctx.lineWidth = 4
        ctx.stroke()
      }
    })
    ctx.restore()
  }

  /** 战况日志（路结果逐波追加 + 技能使用；body 字号可读） */
  private drawNightLog(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const r = nightLogRect()
    this.panel(r.x, r.y, r.w, r.h)
    ctx.save()
    ctx.beginPath()
    ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel)
    ctx.clip()
    ctx.textBaseline = 'middle'
    const lines: string[] = []
    if (pb.session && pb.nightStart !== null) {
      const waves = nightWaves(pb.session.routes, pb.nightStart, now)
      waves.revealed.forEach((rv, i) => {
        const mon = pb.monsterNames[rv.route.monsterId ?? ''] ?? '怪物'
        lines.push(`第${i + 1}波 路${WAVE_LETTERS[i]} · ${rv.route.roomId} · ${mon} · r=${rv.route.r.toFixed(2)} → ${OUTCOME_LABEL[rv.route.outcome]}`)
      })
    }
    lines.push(...pb.logs)
    ctx.font = font(T.typography.body)
    const visible = lines.slice(-Math.floor((r.h - T.space.s * 2) / 36))
    visible.forEach((ln, i) => {
      ctx.fillStyle = i === visible.length - 1 ? col('text_primary') : col('text_secondary')
      ctx.fillText(ln, r.x + T.space.m, r.y + 32 + i * 36)
    })
    // 战毕返回按钮（gold 主行动，88px 热区）
    if (pb.session && pb.nightStart !== null && nightWaves(pb.session.routes, pb.nightStart, now).done) {
      const b = nightBackRect()
      this.button(b, '天亮了 →', col('gold_primary'), withAlpha(col('gold_primary'), 0.16), col('gold_deep'))
    }
    ctx.restore()
  }

  // ---- DAWN 收租结算（§3.4 标志性瞬间：物资雨 rain 500ms → 计数器 counter 800ms → 逐户 stagger 60ms）----
  private drawSettle(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const start = pb.settleStart
    ctx.textBaseline = 'middle'
    // 物资雨：金色方块 24 粒子（美术规范 §七），rain 曲线 500ms 落下
    if (start !== null) {
      const rainM = motion('rain')
      const rainT = Math.min(1, (now - start) / rainM.dur)
      if (rainT < 1) {
        ctx.fillStyle = col('gold_primary')
        for (let i = 0; i < 24; i++) {
          const seed = (i * 97 + frame.day * 31) % 1000 / 1000
          const x = T.space.l + seed * (DESIGN_W - T.space.l * 2 - 24)
          const y = rainM.fn(rainT) * DESIGN_H * 1.1 + seed * 300
          ctx.fillRect(x, y % (DESIGN_H * 0.9), 20, 30)
        }
      }
    }
    const r = settlePanelRect()
    this.panel(r.x, r.y, r.w, r.h)
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.body)
    ctx.fillText('天亮 · 收租结算', r.x + T.space.m, r.y + 48)
    // 计数器滚动（counter 800ms easeOutCubic；BebasNeue 位 M3 子集化，占位粗体）
    const households = Math.min(frame.population, frame.roomsBuilt)
    const shown = start !== null ? counterValue(frame.income, start + motion('rain').dur, now) : 0
    ctx.fillStyle = col('gold_primary')
    ctx.font = font(T.typography.h1, { weight: 'bold' })
    ctx.fillText(`+${fmt(shown)}`, settleCounterRect().x + T.space.m, settleCounterRect().y + 40)
    // 逐户弹出（stagger 60ms 间隔 + fast 曲线滑入）
    const perRoom = households > 0 ? Math.round(frame.income / households) : 0
    const popCount = Math.min(households, SETTLE_POP_MAX)
    for (let i = 0; i < popCount; i++) {
      const p = start !== null ? popProgress(i, start + motion('rain').dur + motion('counter').dur, now) : 0
      if (p <= 0) continue
      const pr = settlePopRect(i)
      ctx.globalAlpha = p
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`住 · F1-R${i + 1}`, pr.x, pr.y + pr.h / 2)
      ctx.fillStyle = col('gold_primary')
      ctx.font = font(T.typography.body)
      ctx.fillText(`+${fmt(perRoom)}`, pr.x + 160, pr.y + pr.h / 2)
      ctx.globalAlpha = 1
    }
    if (households > SETTLE_POP_MAX) {
      const pr = settlePopRect(SETTLE_POP_MAX - 1)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`…共 ${households} 户`, pr.x, pr.y + pr.h + 24)
    }
    // 结算动效链完成后亮出「继续」（88px 热区）
    if (start !== null && now >= settleDoneAt(start, households)) {
      this.button(settleContinueRect(), '继续 ▶', col('gold_primary'), withAlpha(col('gold_primary'), 0.16), col('gold_deep'))
    }
  }

  // ---- 模态：事件卡模板（§3.2）/确认入夜/占位面板 ----
  private drawModal(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const top: Modal | undefined = topModal(ui)
    if (!top) { this.modalOpenAt = null; return }
    if (this.modalOpenAt === null) this.modalOpenAt = now
    const m = motion('normal')
    const eased = m.fn(Math.min(1, (now - this.modalOpenAt) / m.dur))
    const r = modalRect()
    const slide = (1 - eased) * (DESIGN_H - r.y)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.6 * eased)
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    const y = r.y + slide
    this.panel(r.x, y, r.w, r.h)
    ctx.textBaseline = 'middle'
    if (top.kind === 'event' && top.card) {
      this.drawEventCard(top, y, frame, now, pb)
      return
    }
    const title = top.kind === 'confirmNight' ? '确认入夜？'
      : ({ deploy: '布防', recruit: '招募', upgrade: '升级', settings: '设置' } as Record<string, string>)[top.id] ?? top.id
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(title, r.x + T.space.m, y + 48)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath(); ctx.moveTo(r.x + T.space.m, y + 80); ctx.lineTo(r.x + r.w - T.space.m, y + 80); ctx.stroke()
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.body)
    const body = top.kind === 'confirmNight' ? '入夜后不可打断（全屏夜战）' : '占位面板：M3 接入对应系统操作'
    ctx.fillText(body, r.x + T.space.m, y + 120)
    if (top.kind === 'confirmNight') {
      const cr = modalConfirmRect()
      this.button({ ...cr, y: cr.y - r.y + y }, '入夜 ▶', col('gold_primary'), withAlpha(col('gold_primary'), 0.16), col('gold_deep'))
    }
    const c = modalCloseRect()
    this.closeBtn(c, y - r.y, '关闭')
  }

  /** 事件卡（§3.2 模板：标题栏/正文 24px/选项按钮+风险星级/翻面→结果→图标飞资源栏） */
  private drawEventCard(top: Modal, y: number, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const r = modalRect()
    const card = top.card
    if (!card) return
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(card.title, r.x + T.space.m, y + 48)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath(); ctx.moveTo(r.x + T.space.m, y + 80); ctx.lineTo(r.x + r.w - T.space.m, y + 80); ctx.stroke()
    // 正文 24px（≤2 行）
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body)
    if (card.text) ctx.fillText(card.text, r.x + T.space.m, y + 120, r.w - T.space.m * 2)
    // 选项按钮：标签 + 概率徽标 + 风险星级（⚠×非首选结果数）
    const opt = card.options[0]
    const flipped = top.chosen !== undefined
    const flip = cardFlip(pb.chosenAt, now) // normal 300ms easeOutCubic 翻面
    if (opt && !flipped) {
      const or = modalOptionRect()
      const br = { ...or, y: or.y - r.y + y } // 随面板滑入（命中测试用终位，300ms 滑入窗口内偏差可忽略）
      ctx.beginPath()
      ctx.roundRect(br.x, br.y, br.w, br.h, T.radius.btn)
      ctx.fillStyle = withAlpha(col('gold_primary'), 0.1)
      ctx.fill()
      ctx.strokeStyle = col('gold_deep')
      ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      ctx.fillText(`▶ ${opt.label}`, br.x + T.space.m, br.y + 34)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      const ps = opt.ps.map(p => `${Math.round(p * 100)}%`).join('/')
      const stars = '⚠'.repeat(Math.min(3, opt.ps.length - 1))
      ctx.fillText(`${ps} ${stars}`, br.x + T.space.m, br.y + 72)
    }
    if (flipped) {
      // 结果浮现 + 金币图标飞向资源栏（rain 曲线 500ms）
      const flyT = pb.chosenAt !== null ? Math.min(1, Math.max(0, (now - (pb.chosenAt + motion('normal').dur)) / motion('rain').dur)) : 0
      ctx.globalAlpha = flip
      ctx.fillStyle = col('success')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      ctx.fillText(`✓ ${top.chosen === 0 ? '已执行' : '已选择'} · ${card.resultText}`, r.x + T.space.m, y + 170 + 40, r.w - T.space.m * 2)
      ctx.globalAlpha = 1
      if (flyT > 0 && flyT < 1) {
        const rainM = motion('rain')
        const fx = r.x + T.space.m + (resourceRect().x + T.space.l - r.x) * rainM.fn(flyT)
        const fy = y + 210 + (resourceRect().y + 20 - y - 210) * rainM.fn(flyT)
        ctx.fillStyle = col('gold_primary')
        ctx.beginPath(); ctx.arc(fx, fy, 14, 0, Math.PI * 2); ctx.fill()
      }
    }
    const c = modalCloseRect()
    this.closeBtn(c, y - r.y, flipped ? '继续' : '稍后')
  }

  private closeBtn(c: { x: number; y: number; w: number; h: number }, dy: number, label: string): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.roundRect(c.x, c.y + dy, c.w, c.h, T.radius.btn)
    ctx.fillStyle = withAlpha(col('text_secondary'), 0.15)
    ctx.fill()
    ctx.strokeStyle = col('panel_stroke')
    ctx.stroke()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body)
    const tw = ctx.measureText(label).width
    ctx.fillText(label, c.x + (c.w - tw) / 2, c.y + dy + c.h / 2)
  }
}

/** 帧率采样报告（性能预算冒烟：中端机 ≥30fps，白盒预算 ≥50fps） */
export function fpsReport(samples: number[]): { min: number; avg: number; budgetOk: boolean } {
  const min = samples.length ? Math.min(...samples) : 0
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0
  return { min, avg, budgetOk: min >= 50 }
}
