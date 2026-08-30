// 白盒渲染器（M2.6 视觉升级：程序化质感——矢量图标/房间插画/面板立体感/氛围粒子/真字体）。
// 零素材依赖：全部图形由 Canvas 路径程序化绘制；全部颜色由 theme.ts tokens 派生
// （col/withAlpha/shade/mix），零硬编码色值/字号/动效时长（scripts/check-theme.mjs 断言）。
// 字体：family tokens 对应 @font-face 子集（思源黑体 Bold / BebasNeue，见 scripts/build-fonts.mjs）。
// 纯 Canvas 2D，零引擎依赖；Creator 侧经 whitebox-core 同步复用（scripts/sync-creator.mjs）。
import { T, col, withAlpha, shade, mix, motion, font } from './theme.ts'
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
  settlePanelRect, settleCounterRect, settlePopRect, settleContinueRect, SETTLE_POP_MAX,
  pageBackRect, pageTitleRect, codexCellRect, CODEX_COLS, CODEX_ROWS, shopCardRect, SHOP_CARDS,
  settingsRowRect, SETTINGS_ROWS, LOTS, isoToScreen,
  ISO_TILE_W, ISO_TILE_H, ISO_FLOOR_H, interiorBackRect, interiorSlotRect, mapBackRect, HIT_MIN,
  wildZoneRect, wildBackRect, wildDetailRect, wildDispatchRect, wildMinusRect, wildPlusRect, WILD_ZONES, WILD_ZONE_NAME, EXPLORE_ENTRY
} from './layout.ts'
import {
  nightWaves, OUTCOME_LABEL, counterValue, popProgress, settleDoneAt,
  threatBurst, dissolveAlpha, cardFlip
} from './anim.ts'
import { tutorialBoard, type TutRow } from './tutorial.ts'
import { monsterProgress, monsterVisual } from './battle.ts'
import weatherJson from '../../../config/weather.json' with { type: 'json' }

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
  breachedRooms: string[]
  eventCards: EventCardMeta[]
  /** 当日天气 id（config/weather.json） */
  weather: string
}

export interface Playback {
  session: BattleSession | null
  monsterNames: Record<string, string>
  nightStart: number | null
  settleStart: number | null
  chosenAt: number | null
  logs: string[]
  /** 室内工事位布置状态（key=`floor:room:slot`，视觉占位） */
  forts: Record<string, boolean>
  /** 野外探索战报（最近一次归来结算的表现层投影） */
  wildReports: string[][]
  /** 在外队伍（表现层投影） */
  parties: { zone: string; size: number; returnsDay: number }[]
  skills: { label: string; glyph: string; cdUntil: number }[]
}

export interface RendererCallbacks {
  onFps(fps: number, min: number, avg: number): void
}

const WAVE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

/** 确定性伪随机（按种子稳定，重绘不闪烁） */
const prand = (seed: number) => ((seed * 9301 + 49297) % 233280) / 233280

/** 千分位 */
function fmt(n: number): string {
  return n.toLocaleString('en-US')
}

export class WhiteboxRenderer {
  private ctx: CanvasRenderingContext2D
  private frames = 0
  private fpsSamples: number[] = []
  private budgetSamples: number[] = []
  private warmupLeft = 2
  private lastSample = 0
  private modalOpenAt: number | null = null

  constructor(canvas: HTMLCanvasElement, private cb: RendererCallbacks) {
    this.ctx = canvas.getContext('2d')!
  }

  /** rAF 主循环：帧率采样（预热 2 窗 + 节流窗 <10fps 不计入预算）+ 重绘 */
  start(getFrame: () => DayFrame | null, getUi: () => UiState, getPb: () => Playback): void {
    const tick = (now: number) => {
      this.frames++
      if (now - this.lastSample >= 1000) {
        const fps = Math.round(this.frames * 1000 / (now - this.lastSample))
        this.fpsSamples.push(fps)
        if (this.warmupLeft > 0) this.warmupLeft--
        else if (fps >= 10) this.budgetSamples.push(fps)
        const src = this.budgetSamples.length ? this.budgetSamples : this.fpsSamples
        this.cb.onFps(fps, Math.min(...src), Math.round(src.reduce((a, b) => a + b, 0) / src.length))
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
    return this.budgetSamples
  }

  // ════════ 基础绘制库 ════════

  /** 立体面板：投影 + 底色 + 描边 + 顶部高光棱线（全部 tokens 派生） */
  private panel(x: number, y: number, w: number, h: number, r = T.radius.panel, opts: { depth?: number } = {}): void {
    const { ctx } = this
    const depth = opts.depth ?? 6
    ctx.beginPath(); ctx.roundRect(x, y + depth, w, h, r)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.45); ctx.fill() // 投影
    const g = ctx.createLinearGradient(0, y, 0, y + h)
    g.addColorStop(0, mix(col('panel'), col('text_primary'), 0.06))
    g.addColorStop(1, col('panel'))
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r)
    ctx.fillStyle = g; ctx.fill()
    ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 3; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x + r, y + 2); ctx.lineTo(x + w - r, y + 2)
    ctx.strokeStyle = withAlpha(col('text_primary'), 0.14); ctx.lineWidth = 2; ctx.stroke() // 顶部高光棱线
  }

  /** 立体按钮：上亮下暗渐变 + 底沿厚度 */
  private button(r: { x: number; y: number; w: number; h: number }, label: string, kind: 'primary' | 'normal' | 'ghost' = 'normal'): void {
    const { ctx } = this
    const top = kind === 'primary' ? mix(col('gold_primary'), col('gold_deep'), 0.25) : mix(col('panel'), col('text_primary'), 0.08)
    const bot = kind === 'primary' ? col('gold_deep') : col('panel')
    ctx.beginPath(); ctx.roundRect(r.x, r.y + 4, r.w, r.h, T.radius.btn)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.5); ctx.fill() // 投影
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
    g.addColorStop(0, top); g.addColorStop(1, bot)
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn)
    ctx.fillStyle = g; ctx.fill()
    ctx.strokeStyle = kind === 'primary' ? col('gold_deep') : col('panel_stroke')
    ctx.lineWidth = 3; ctx.stroke()
    ctx.beginPath(); ctx.moveTo(r.x + 10, r.y + r.h - 3); ctx.lineTo(r.x + r.w - 10, r.y + r.h - 3)
    ctx.strokeStyle = withAlpha(col('bg_night'), 0.55); ctx.lineWidth = 4; ctx.stroke() // 底沿厚度
    ctx.fillStyle = kind === 'primary' ? shade(col('gold_primary'), 0.35) : col('text_primary')
    ctx.font = font(T.typography.body, { weight: 'bold' })
    ctx.textAlign = 'center'
    ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + (kind === 'primary' ? -2 : 0))
    ctx.textAlign = 'left'
  }

  /** 圆形图标按钮（设置/关闭等） */
  private circleButton(x: number, y: number, r: number, drawGlyph: () => void): void {
    const { ctx } = this
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = col('panel'); ctx.fill()
    ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 3; ctx.stroke()
    ctx.beginPath(); ctx.arc(x, y, r - 5, Math.PI * 0.9, Math.PI * 1.9)
    ctx.strokeStyle = withAlpha(col('text_primary'), 0.25); ctx.lineWidth = 2; ctx.stroke() // 内高光弧
    drawGlyph()
  }

  /** 自动换行 */
  private wrap(text: string, maxWidth: number): string[] {
    const { ctx } = this
    const lines: string[] = []
    let line = ''
    for (const ch of text) {
      if (ctx.measureText(line + ch).width > maxWidth && line) { lines.push(line); line = ch }
      else line += ch
    }
    if (line) lines.push(line)
    return lines
  }

  private numFont(px: number, weight = 'bold'): string {
    return font(px, { weight, family: T.typography.family_num })
  }

  // ---- 矢量图标（色板派生） ----
  private iconCoin(x: number, y: number, r: number): void {
    const { ctx } = this
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = col('gold_deep'); ctx.fill()
    ctx.beginPath(); ctx.arc(x, y, r - r * 0.22, 0, Math.PI * 2)
    ctx.fillStyle = col('gold_primary'); ctx.fill()
    ctx.beginPath(); ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.2, 0, Math.PI * 2)
    ctx.fillStyle = withAlpha(col('text_primary'), 0.85); ctx.fill() // 高光
    ctx.beginPath(); ctx.arc(x, y, r * 0.52, 0, Math.PI * 2)
    ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 2.5; ctx.stroke() // 内环
  }

  private iconPerson(x: number, y: number, s: number, color: string): void {
    const { ctx } = this
    ctx.beginPath(); ctx.arc(x, y - s * 0.28, s * 0.32, 0, Math.PI * 2)
    ctx.fillStyle = color; ctx.fill()
    ctx.beginPath(); ctx.arc(x, y + s * 0.5, s * 0.52, Math.PI, 0)
    ctx.lineTo(x + s * 0.52, y + s * 0.55); ctx.lineTo(x - s * 0.52, y + s * 0.55)
    ctx.closePath(); ctx.fill()
  }

  private iconBolt(x: number, y: number, s: number, color: string): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.moveTo(x + s * 0.15, y - s * 0.55); ctx.lineTo(x - s * 0.4, y + s * 0.08)
    ctx.lineTo(x - s * 0.05, y + s * 0.08); ctx.lineTo(x - s * 0.15, y + s * 0.55)
    ctx.lineTo(x + s * 0.4, y - s * 0.08); ctx.lineTo(x + s * 0.05, y - s * 0.08)
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
  }

  private iconPanic(x: number, y: number, s: number, color: string): void {
    // 恐慌：惊愕尖刺爆发
    const { ctx } = this
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      const rr = i % 2 === 0 ? s * 0.55 : s * 0.24
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
    ctx.beginPath(); ctx.arc(x, y, s * 0.14, 0, Math.PI * 2)
    ctx.fillStyle = col('bg_night'); ctx.fill()
  }

  private iconGear(x: number, y: number, r: number, color: string): void {
    const { ctx } = this
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      ctx.lineTo(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 1.25)
      ctx.lineTo(x + Math.cos(a + Math.PI / 8) * r * 0.95, y + Math.sin(a + Math.PI / 8) * r * 0.95)
    }
    ctx.closePath()
    ctx.fillStyle = color; ctx.fill()
    ctx.beginPath(); ctx.arc(x, y, r * 0.42, 0, Math.PI * 2)
    ctx.fillStyle = col('bg_night'); ctx.fill()
  }

  private iconMoon(x: number, y: number, r: number, blood: boolean): void {
    const { ctx } = this
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = blood ? col('alert_blood') : mix(col('text_primary'), col('gold_primary'), 0.5); ctx.fill()
    if (blood) {
      for (const [dx, dy, cr] of [[-0.3, -0.2, 0.16], [0.25, 0.15, 0.12], [0.05, 0.38, 0.1]] as const) {
        ctx.beginPath(); ctx.arc(x + dx * r, y + dy * r, cr * r, 0, Math.PI * 2)
        ctx.fillStyle = shade(col('alert_blood'), 0.7); ctx.fill()
      }
    } else {
      ctx.beginPath(); ctx.arc(x - r * 0.32, y - r * 0.3, r * 0.14, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(col('bg_night'), 0.35); ctx.fill()
    }
  }

  private iconStar(x: number, y: number, r: number, color: string): void {
    const { ctx } = this
    ctx.beginPath()
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2
      const rr = i % 2 === 0 ? r : r * 0.45
      ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr)
    }
    ctx.closePath(); ctx.fillStyle = color; ctx.fill()
  }

  private iconWarn(x: number, y: number, s: number): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.moveTo(x, y - s * 0.55); ctx.lineTo(x + s * 0.55, y + s * 0.42); ctx.lineTo(x - s * 0.55, y + s * 0.42)
    ctx.closePath()
    ctx.fillStyle = col('alert_blood'); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = col('text_primary')
    ctx.font = this.numFont(s * 0.62)
    ctx.textAlign = 'center'
    ctx.fillText('!', x, y + s * 0.28)
    ctx.textAlign = 'left'
  }

  // ════════ 相位分发 ════════
  draw(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    ctx.textAlign = 'left'
    switch (ui.phase) {
      case 'DAWN_SETTLE': {
        this.bgBase(col('bg_night'))
        ctx.fillStyle = withAlpha(col('bg_dawn'), dissolveAlpha(pb.settleStart, now))
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
        this.drawStars(now, 0.4)
        this.drawSettle(frame, now, pb)
        this.drawModal(ui, frame, now, pb)
        break
      }
      case 'DAY':
        this.drawDayBg(now)
        if (ui.page === 'map') {
          this.drawMapView(ui, frame, now)
          this.drawHouseVillage(frame, now)
          this.drawWeatherLayer(this.weatherEntry(frame.weather), now)
          this.drawTutorialBanner(frame)
          this.drawTutorialSteps(frame)
          this.drawDock()
        }
        else if (ui.page === 'interior') this.drawInterior(ui, frame, now, pb)
        else if (ui.page === 'wild') this.drawWildView(ui, frame, now, pb)
        else if (ui.page === 'main') {
          this.drawWeatherLayer(this.weatherEntry(frame.weather), now)
          this.button(mapBackRect(), '◀ 小区', 'normal')
          this.drawHud(frame, now)
          this.drawTutorialBanner(frame)
          this.drawTutorialSteps(frame)
          this.drawResources(frame)
          this.drawBuilding(frame, now)
          this.drawEventEntry(frame)
          this.drawReport(frame)
          this.drawDock()
        } else {
          this.drawPage(ui.page, now)
        }
        this.drawModal(ui, frame, now, pb)
        break
      case 'DUSK_FORECAST':
        this.drawDayBg(now)
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

  /** 白天背景：纵向渐变 + 缓浮尘埃 */
  private drawDayBg(now: number): void {
    const { ctx } = this
    const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H)
    g.addColorStop(0, mix(col('bg_dawn'), col('text_primary'), 0.05))
    g.addColorStop(1, col('bg_dawn'))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    for (let i = 0; i < 10; i++) {
      const seed = prand(i * 7 + 3)
      const x = prand(i * 13) * DESIGN_W
      const y = (prand(i * 29) * DESIGN_H + now * 0.008 * (0.5 + seed)) % DESIGN_H
      ctx.beginPath(); ctx.arc(x, y, 2 + seed * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(col('text_primary'), 0.05 + seed * 0.05); ctx.fill()
    }
  }

  /** 天气条目查询（frame.weather id → config/weather.json 条目） */
  private weatherEntry(id: string): any {
    const list = (weatherJson as any).entries as any[]
    return list.find(e => e.id === id) ?? list[0]
  }

  /** 天气层：光照 overlay + 粒子（雨丝/雪花/雾带/血月尘）——全屏表现层 */
  private drawWeatherLayer(w: any, now: number): void {
    const { ctx } = this
    if (w.lightMul < 1) {
      ctx.fillStyle = withAlpha(col(w.tintKey), (1 - w.lightMul) * 0.55)
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    }
    if (w.particles === 'rain') {
      ctx.strokeStyle = withAlpha(col('text_primary'), 0.3)
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 130; i++) {
        const speed = 0.9 * (0.7 + prand(i * 3) * 0.6)
        const x = prand(i * 13) * DESIGN_W + Math.sin(now / 400 + i) * 6
        const y = (prand(i * 7) * DESIGN_H + now * speed) % DESIGN_H
        ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 18)
      }
      ctx.stroke()
      ctx.fillStyle = withAlpha(col('text_primary'), 0.06)
      ctx.fillRect(0, DESIGN_H - 140, DESIGN_W, 140)
    } else if (w.particles === 'snow') {
      ctx.fillStyle = withAlpha(col('text_primary'), 0.75)
      for (let i = 0; i < 90; i++) {
        const speed = 0.12 * (0.6 + prand(i * 5) * 0.8)
        const x = (prand(i * 11) * DESIGN_W + Math.sin(now / 700 + i * 2) * 26) % DESIGN_W
        const y = (prand(i * 23) * DESIGN_H + now * speed) % DESIGN_H
        ctx.beginPath(); ctx.arc(x, y, 1.8 + prand(i) * 2.4, 0, Math.PI * 2); ctx.fill()
      }
    } else if (w.particles === 'fog') {
      for (let i = 0; i < 3; i++) {
        const y = 180 + i * 260 + Math.sin(now / 2200 + i * 1.7) * 36
        ctx.fillStyle = withAlpha(col('text_secondary'), 0.10)
        ctx.beginPath(); ctx.roundRect(-40, y, DESIGN_W + 80, 170, 90); ctx.fill()
      }
    } else if (w.particles === 'dust') {
      ctx.strokeStyle = withAlpha(col('alert_blood'), 0.35)
      ctx.lineWidth = 2
      ctx.beginPath()
      for (let i = 0; i < 60; i++) {
        const speed = 0.5 * (0.6 + prand(i * 9) * 0.8)
        const x = DESIGN_W - ((prand(i * 13) * DESIGN_W + now * speed) % (DESIGN_W + 60))
        const y = prand(i * 17) * DESIGN_H
        ctx.moveTo(x, y); ctx.lineTo(x - 16, y + 2)
      }
      ctx.stroke()
    }
  }

  /** 天气 HUD 角标（图标 + 名称） */
  private drawWeatherBadge(w: any, x: number, y: number): void {
    const { ctx } = this
    ctx.beginPath(); ctx.roundRect(x, y, 108, 28, T.radius.chip)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.5); ctx.fill()
    ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
    if (w.particles === 'rain') {
      ctx.strokeStyle = withAlpha(col('text_primary'), 0.8); ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let i = 0; i < 3; i++) { ctx.moveTo(x + 14 + i * 8, y + 6); ctx.lineTo(x + 11 + i * 8, y + 18) }
      ctx.stroke()
    } else if (w.particles === 'snow') {
      this.iconStar(x + 18, y + 13, 8, col('text_primary'))
    } else if (w.particles === 'fog') {
      ctx.strokeStyle = col('text_secondary'); ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(x + 8, y + 10); ctx.lineTo(x + 28, y + 10)
      ctx.moveTo(x + 10, y + 16); ctx.lineTo(x + 30, y + 16)
      ctx.stroke()
    } else if (w.particles === 'dust') {
      ctx.beginPath(); ctx.arc(x + 18, y + 13, 8, 0, Math.PI * 2)
      ctx.fillStyle = col('alert_blood'); ctx.fill()
    } else if (w.id === 'overcast') {
      ctx.fillStyle = col('text_secondary')
      ctx.beginPath()
      ctx.arc(x + 13, y + 15, 7, 0, Math.PI * 2)
      ctx.arc(x + 23, y + 13, 9, 0, Math.PI * 2)
      ctx.fill()
    } else {
      this.iconStar(x + 18, y + 13, 8, col('gold_primary'))
    }
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.caption)
    ctx.fillText(w.name, x + 36, y + 15)
  }

  /** 夜空星点（NIGHT/DAWN 过渡） */
  private drawStars(now: number, alpha: number): void {
    const { ctx } = this
    for (let i = 0; i < 26; i++) {
      const x = prand(i * 17) * DESIGN_W
      const y = prand(i * 31) * DESIGN_H * 0.7
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(now / 900 + i))
      ctx.beginPath(); ctx.arc(x, y, 1.2 + prand(i) * 1.6, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(col('text_primary'), alpha * tw); ctx.fill()
    }
  }

  // ---- HUD ----
  private drawHud(frame: DayFrame, now: number): void {
    const { ctx } = this
    const hud = hudRect()
    const g = ctx.createLinearGradient(0, 0, 0, hud.h)
    g.addColorStop(0, mix(col('panel'), col('text_primary'), 0.07))
    g.addColorStop(1, col('panel'))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, hud.w, hud.h)
    ctx.fillStyle = col('panel_stroke'); ctx.fillRect(0, hud.h - 3, hud.w, 3)
    ctx.fillStyle = withAlpha(col('text_primary'), 0.12); ctx.fillRect(0, 2, hud.w, 2)
    ctx.textBaseline = 'middle'
    // 日次徽章：BebasNeue 大数字 + 小标
    ctx.fillStyle = withAlpha(col('bg_night'), 0.5)
    ctx.beginPath(); ctx.roundRect(T.space.s, 8, 150, hud.h - 16, T.radius.chip); ctx.fill()
    ctx.fillStyle = col('gold_primary')
    ctx.font = this.numFont(T.typography.h2)
    ctx.fillText(`D${frame.day}`, T.space.s + 16, hud.h / 2 + 1)
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('日次', T.space.s + 16 + ctx.measureText(`D${frame.day}`).width + ctx.measureText('日次').width / 2 + 26, hud.h / 2 + 1)
    // 血月周期 4 pip：已过周期点亮，当前周期脉冲，血月周染红
    const cycle = Math.ceil(frame.day / 7)
    const isBMWeek = frame.modifiers.includes('BLOOD_MOON')
    for (let i = 0; i < 4; i++) {
      const mx = T.space.s + 176 + i * 30, my = hud.h / 2
      const active = i < cycle
      const current = i === cycle - 1
      const pulse = current ? 0.75 + 0.25 * Math.sin(now / 500) : 1
      ctx.beginPath(); ctx.arc(mx, my, 8, 0, Math.PI * 2)
      ctx.fillStyle = active
        ? withAlpha(isBMWeek ? col('alert_blood') : col('gold_primary'), pulse)
        : withAlpha(col('panel_stroke'), 0.8)
      ctx.fill()
      ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
    }
    // 设置入口（齿轮矢量）
    const st = settingsRect()
    // 天气角标（M3.2）
    this.drawWeatherBadge(this.weatherEntry(frame.weather), st.x - 196, hud.h / 2 - 14)
    this.circleButton(st.x + st.w / 2, hud.h / 2, 26, () => this.iconGear(st.x + st.w / 2, hud.h / 2, 13, col('text_secondary')))
    // 特殊夜标签
    if (frame.modifiers.length) {
      const isBM = frame.modifiers.includes('BLOOD_MOON')
      ctx.fillStyle = isBM ? col('alert_blood') : col('danger')
      ctx.font = font(T.typography.caption, { weight: 'bold' })
      const label = frame.modifiers.join('/')
      const tw = ctx.measureText(label).width
      const threat = motion('threat')
      ctx.globalAlpha = isBM ? 0.6 + 0.4 * Math.sin((now / (threat.dur * 2)) * Math.PI * 2) : 1
      ctx.fillText(label, st.x - tw - T.space.l, hud.h / 2)
      ctx.globalAlpha = 1
    }
  }

  // ---- 资源栏 ----
  private drawResources(frame: DayFrame): void {
    const { ctx } = this
    const r = resourceRect()
    ctx.textBaseline = 'middle'
    const items: { draw: () => void; text: string; color: string }[] = [
      { draw: () => this.iconCoin(r.x + colW * 0 + 26, r.y + r.h / 2, 15), text: fmt(frame.gold), color: col('gold_primary') },
      { draw: () => this.iconPerson(r.x + colW * 1 + 26, r.y + r.h / 2, 30, col('text_secondary')), text: `${frame.population}/${frame.roomsBuilt}`, color: col('text_primary') },
      { draw: () => this.iconBolt(r.x + colW * 2 + 26, r.y + r.h / 2, 24, col('success')), text: fmt(frame.power), color: col('text_primary') },
      { draw: () => this.iconPanic(r.x + colW * 3 + 26, r.y + r.h / 2, 22, col('panic')), text: `${frame.panicSum}`, color: col('panic') }
    ]
    const colW = r.w / items.length
    items.forEach((it, i) => {
      const x = r.x + colW * i + T.space.xs
      ctx.beginPath(); ctx.roundRect(x, r.y + 4, colW - T.space.xs * 2, r.h - 12, T.radius.chip)
      ctx.fillStyle = withAlpha(col('panel'), 0.85); ctx.fill()
      ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
      it.draw()
      ctx.fillStyle = it.color
      ctx.font = this.numFont(T.typography.h2)
      ctx.fillText(it.text, x + 52, r.y + r.h / 2)
    })
  }

  // ---- 剖面楼栋 ----
  private drawBuilding(frame: DayFrame, now: number): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    const threat = motion('threat')
    let occupied = frame.population
    for (let f = 0; f < FLOORS; f++) {
      const label = floorLabelRect(f)
      // 楼层标牌：BebasNeue 圆角小牌
      ctx.beginPath(); ctx.roundRect(label.x + 4, label.y + label.h / 2 - 16, 40, 32, 8)
      ctx.fillStyle = withAlpha(col('bg_night'), 0.55); ctx.fill()
      ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = f === 0 ? col('gold_primary') : col('text_secondary')
      ctx.font = this.numFont(T.typography.body)
      ctx.textAlign = 'center'
      ctx.fillText(`${FLOORS - f}F`, label.x + 24, label.y + label.h / 2 + 1)
      ctx.textAlign = 'left'
      // 楼板横梁
      const slab = roomRect(f, 0)
      ctx.fillStyle = withAlpha(col('bg_night'), 0.5)
      ctx.fillRect(slab.x - 6, slab.y + slab.h + 2, (roomRect(f, ROOMS_PER_FLOOR - 1).x + roomRect(f, ROOMS_PER_FLOOR - 1).w) - slab.x + 12, 5)
      for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
        const rect = roomRect(f, r)
        const roomId = `F${FLOORS - f}-R${r + 1}`
        const breached = frame.breachedRooms.includes(roomId)
        const isPublic = f === FLOORS - 1 && r < 3
        const isTower = f === 0 && r === 0
        const isOccupied = !isPublic && !isTower && occupied > 0
        if (isOccupied) occupied--
        this.drawRoom(rect, { breached, isPublic, isTower, isOccupied, roomId, now, threatDur: threat.dur })
      }
    }
  }

  private drawRoom(
    rect: { x: number; y: number; w: number; h: number },
    o: { breached: boolean; isPublic: boolean; isTower: boolean; isOccupied: boolean; roomId: string; now: number; threatDur: number }
  ): void {
    const { ctx } = this
    const rr = T.radius.chip
    ctx.beginPath(); ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rr)
    ctx.save(); ctx.clip()
    if (o.breached) {
      // 破防：血红内衬 + 裂纹 + 惊叹三角
      const pulse = 0.5 + 0.5 * Math.sin((o.now / (o.threatDur * 2)) * Math.PI * 2)
      ctx.fillStyle = withAlpha(col('alert_blood'), 0.3 + 0.3 * pulse); ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      ctx.strokeStyle = withAlpha(col('alert_blood'), 0.85); ctx.lineWidth = 2
      for (const seed of [0, 1]) {
        const bx = rect.x + rect.w * (0.3 + seed * 0.4), by = rect.y + 4
        ctx.beginPath(); ctx.moveTo(bx, by)
        ctx.lineTo(bx + (seed ? 7 : -6), by + rect.h * 0.3)
        ctx.lineTo(bx + (seed ? -4 : 5), by + rect.h * 0.6)
        ctx.lineTo(bx + (seed ? 6 : -7), by + rect.h - 6)
        ctx.stroke()
      }
      this.iconWarn(rect.x + rect.w / 2, rect.y + rect.h / 2, 20)
    } else if (o.isTower) {
      // 瞭望塔：塔身 + 扫描光锥
      ctx.fillStyle = withAlpha(col('bg_night'), 0.5); ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      const cx = rect.x + rect.w / 2, top = rect.y + 10
      ctx.beginPath()
      ctx.moveTo(cx - 14, rect.y + rect.h - 8); ctx.lineTo(cx - 9, top + 14)
      ctx.lineTo(cx + 9, top + 14); ctx.lineTo(cx + 14, rect.y + rect.h - 8)
      ctx.closePath()
      ctx.fillStyle = mix(col('panel_stroke'), col('gold_deep'), 0.4); ctx.fill()
      ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 2; ctx.stroke()
      const sweep = Math.sin(o.now / 1400) * 0.9
      ctx.beginPath()
      ctx.moveTo(cx, top + 16)
      ctx.lineTo(cx + Math.sin(sweep - 0.22) * rect.h, top + 16 - Math.cos(sweep - 0.22) * rect.h)
      ctx.lineTo(cx + Math.sin(sweep + 0.22) * rect.h, top + 16 - Math.cos(sweep + 0.22) * rect.h)
      ctx.closePath()
      ctx.fillStyle = withAlpha(col('gold_primary'), 0.22); ctx.fill()
      ctx.beginPath(); ctx.arc(cx, top + 16, 5, 0, Math.PI * 2)
      ctx.fillStyle = col('gold_primary'); ctx.fill()
    } else if (o.isPublic) {
      // 1F 公共建筑：暖底 + 职能图形
      const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h)
      g.addColorStop(0, mix(col('gold_deep'), col('bg_night'), 0.55))
      g.addColorStop(1, mix(col('gold_deep'), col('bg_night'), 0.75))
      ctx.fillStyle = g; ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
      ctx.strokeStyle = withAlpha(col('gold_primary'), 0.9); ctx.lineWidth = 3
      if (o.roomId.endsWith('R1')) { // 大厅：门 + 雨棚
        ctx.strokeRect(cx - 13, cy - 4, 26, 18)
        ctx.beginPath(); ctx.moveTo(cx - 18, cy - 6); ctx.lineTo(cx, cy - 16); ctx.lineTo(cx + 18, cy - 6); ctx.stroke()
      } else if (o.roomId.endsWith('R2')) { // 医务：十字
        ctx.fillStyle = withAlpha(col('success'), 0.95)
        ctx.fillRect(cx - 5, cy - 14, 10, 28); ctx.fillRect(cx - 14, cy - 5, 28, 10)
      } else { // 仓：板条箱
        ctx.fillStyle = withAlpha(col('gold_deep'), 0.9)
        ctx.fillRect(cx - 16, cy - 2, 14, 14); ctx.fillRect(cx + 1, cy - 2, 14, 14); ctx.fillRect(cx - 8, cy - 16, 14, 14)
        ctx.strokeStyle = shade(col('gold_deep'), 0.6); ctx.lineWidth = 2
        ctx.strokeRect(cx - 16, cy - 2, 14, 14); ctx.strokeRect(cx + 1, cy - 2, 14, 14); ctx.strokeRect(cx - 8, cy - 16, 14, 14)
      }
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.textAlign = 'center'
      ctx.fillText(['大厅', '医务', '仓'][Number(o.roomId.slice(-1)) - 1], cx, rect.y + rect.h - 10)
      ctx.textAlign = 'left'
    } else if (o.isOccupied) {
      // 住户房：暖光渐变 + 窗 + 家具剪影 + 住户半身像（呼吸灯）
      const breathe = 0.8 + 0.2 * Math.sin(o.now / 900 + (rect.x % 7))
      const wg = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h)
      wg.addColorStop(0, withAlpha(col('gold_primary'), 0.28 * breathe))
      wg.addColorStop(1, withAlpha(col('success'), 0.1))
      ctx.fillStyle = wg; ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      // 窗（左）：暖光 + 窗棂
      const wx = rect.x + 10, wy = rect.y + 8, ww = 22, wh = 26
      ctx.fillStyle = withAlpha(col('gold_primary'), 0.75 * breathe); ctx.fillRect(wx, wy, ww, wh)
      ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2
      ctx.strokeRect(wx, wy, ww, wh)
      ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh)
      ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke()
      // 家具（床，右）
      ctx.fillStyle = withAlpha(col('bg_night'), 0.55)
      ctx.fillRect(rect.x + rect.w - 34, rect.y + rect.h - 22, 26, 12)
      ctx.fillRect(rect.x + rect.w - 34, rect.y + rect.h - 26, 8, 8)
      // 住户半身像
      this.iconPerson(rect.x + 34, rect.y + rect.h - 12, 26, col('text_primary'))
      ctx.strokeStyle = withAlpha(col('success'), 0.9); ctx.lineWidth = 2.5
      ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3)
    } else {
      // 空房：暗底 + 虚线 + 淡加号
      ctx.fillStyle = withAlpha(col('bg_night'), 0.35); ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
      ctx.setLineDash([6, 6])
      ctx.strokeStyle = withAlpha(col('panel_stroke'), 0.9); ctx.lineWidth = 2
      ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2)
      ctx.setLineDash([])
      const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2
      ctx.strokeStyle = withAlpha(col('text_secondary'), 0.4); ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(cx - 9, cy); ctx.lineTo(cx + 9, cy); ctx.moveTo(cx, cy - 9); ctx.lineTo(cx, cy + 9); ctx.stroke()
    }
    ctx.restore()
  }

  // ---- 事件卡入口（漫画卡样式） ----
  private drawEventEntry(frame: DayFrame): void {
    const { ctx } = this
    const r = eventEntryRect()
    this.panel(r.x, r.y, r.w, r.h, T.radius.btn, { depth: 8 })
    // 左侧金色书脊
    ctx.fillStyle = col('gold_primary')
    ctx.beginPath(); ctx.roundRect(r.x, r.y, 10, r.h, 5); ctx.fill()
    ctx.textBaseline = 'middle'
    const top = frame.eventCards[0]
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('今日事件', r.x + T.space.m + 8, r.y + 30)
    if (frame.eventCards.length > 1) {
      ctx.fillStyle = col('gold_primary')
      ctx.beginPath(); ctx.roundRect(r.x + r.w - 96, r.y + 14, 56, 32, T.radius.chip)
      ctx.fillStyle = withAlpha(col('gold_primary'), 0.15); ctx.fill()
      ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = col('gold_primary'); ctx.font = this.numFont(T.typography.body)
      ctx.textAlign = 'center'
      ctx.fillText(`+${frame.eventCards.length - 1}`, r.x + r.w - 68, r.y + 31)
      ctx.textAlign = 'left'
    }
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(top ? top.title : '静谧 · 无事件', r.x + T.space.m + 8, r.y + 74)
    // ▶ 圆钮
    this.circleButton(r.x + r.w - T.space.l - 26, r.y + r.h / 2, 26, () => {
      ctx.fillStyle = col('gold_primary')
      ctx.beginPath()
      ctx.moveTo(r.x + r.w - T.space.l - 32, r.y + r.h / 2 - 11)
      ctx.lineTo(r.x + r.w - T.space.l - 12, r.y + r.h / 2)
      ctx.lineTo(r.x + r.w - T.space.l - 32, r.y + r.h / 2 + 11)
      ctx.closePath(); ctx.fill()
    })
  }

  // ---- 昨夜战报 ----
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
    ctx.fillStyle = withAlpha(col('panic'), 0.15)
    ctx.beginPath(); ctx.roundRect(r.x + T.space.m, r.y + r.h - 36, barW, 12, 6); ctx.fill()
    const ratio = Math.min(1, frame.population > 0 ? frame.panicSum / (frame.population * 100) : 0)
    if (ratio > 0) {
      const g = ctx.createLinearGradient(r.x + T.space.m, 0, r.x + T.space.m + barW * ratio, 0)
      g.addColorStop(0, col('panic')); g.addColorStop(1, mix(col('panic'), col('danger'), 0.5))
      ctx.fillStyle = g
      ctx.beginPath(); ctx.roundRect(r.x + T.space.m, r.y + r.h - 36, Math.max(10, barW * ratio), 12, 6); ctx.fill()
    }
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText(`hash=${frame.sessionHash}`, r.x + r.w - T.space.m - 220, r.y + 26)
  }

  // ---- dock ----
  private drawDock(): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    dockRects().forEach((r, i) => {
      const key = DOCK_KEYS[i]
      this.button(r, key.label, key.key === 'night' ? 'primary' : 'normal')
    })
  }

  // ---- DUSK 横幅 ----
  private drawDuskBanner(frame: DayFrame, now: number): void {
    const { ctx } = this
    const b = duskBannerRect()
    this.panel(b.x, b.y, b.w, b.h, T.radius.btn, { depth: 8 })
    ctx.textBaseline = 'middle'
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('入夜预告', b.x + T.space.m, b.y + 28)
    const silent = frame.modifiers.includes('SILENT')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    if (silent) {
      ctx.fillStyle = col('text_secondary')
      ctx.font = this.numFont(T.typography.h1)
      ctx.fillText('?', b.x + T.space.m, b.y + 68)
      ctx.font = font(T.typography.caption)
      ctx.fillText('静默之夜 · 情报缺失', b.x + T.space.m + 36, b.y + 68)
    } else {
      const isBM = frame.modifiers.includes('BLOOD_MOON')
      this.iconMoon(b.x + T.space.m + 18, b.y + 66, 16, isBM)
      ctx.fillStyle = isBM ? col('alert_blood') : col('text_primary')
      ctx.font = font(T.typography.h2, { weight: 'bold' })
      ctx.fillText(isBM ? '血月' : '常规夜袭', b.x + T.space.m + 46, b.y + 68)
      if (frame.modifiers.includes('MIGRATE')) {
        ctx.fillStyle = col('danger')
        ctx.font = font(T.typography.caption, { weight: 'bold' })
        ctx.fillText('怪物迁移 · 开战重排', b.x + T.space.m + 170, b.y + 68)
      }
    }
    const threat = motion('threat')
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin((now / (threat.dur * 2)) * Math.PI * 2)
    this.button(duskConfirmRect(), '布防', 'primary')
    ctx.globalAlpha = 1
  }

  // ---- NIGHT 夜战面板 ----
  private drawNight(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    ctx.save()
    if (frame.modifiers.includes('BLOOD_MOON') && pb.nightStart !== null) {
      const burst = threatBurst(pb.nightStart, now)
      if (burst.shake > 0) ctx.translate(Math.sin(now / 16) * burst.shake, Math.cos(now / 13) * burst.shake)
      this.bgBase(col('bg_night'))
      this.drawStars(now, 0.9)
      if (burst.flash > 0) {
        ctx.fillStyle = withAlpha(col('alert_blood'), 0.35 * burst.flash)
        ctx.fillRect(-20, -20, DESIGN_W + 40, DESIGN_H + 40)
      }
    } else {
      this.bgBase(col('bg_night'))
      this.drawStars(now, 0.9)
    }
    // 血月大月亮相（右上，氛围）
    if (frame.modifiers.includes('BLOOD_MOON')) {
      ctx.beginPath(); ctx.arc(DESIGN_W - 120, 150, 52, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(col('alert_blood'), 0.25); ctx.fill()
      this.iconMoon(DESIGN_W - 120, 150, 40, true)
    }
    ctx.textBaseline = 'middle'
    const isBM = frame.modifiers.includes('BLOOD_MOON')
    const waves = pb.session && pb.nightStart !== null ? nightWaves(pb.session.routes, pb.nightStart, now) : null
    ctx.fillStyle = isBM ? col('alert_blood') : col('text_primary')
    ctx.font = font(T.typography.h1, { weight: 'bold' })
    ctx.fillText(isBM ? '血月' : '夜袭', T.space.l, 120)
    if (isBM) this.iconMoon(T.space.l + 130, 118, 14, true)
    ctx.fillStyle = col('text_secondary')
    ctx.font = this.numFont(T.typography.h2)
    ctx.fillText(`${waves?.waveNo ?? 0}/${pb.session?.routes.length ?? 0}`, T.space.l + 260, 120)
    ctx.font = font(T.typography.caption)
    ctx.fillText('波', T.space.l + 344, 120)
    if (pb.session?.silent) {
      ctx.fillStyle = col('text_secondary')
      ctx.font = this.numFont(T.typography.h2)
      ctx.fillText('?', T.space.l + 420, 120)
    }
    if (pb.session && waves) {
      pb.session.routes.forEach((_, i) => {
        const rv = waves.revealed[i]
        const r = nightRouteRect(i)
        const isCurrent = waves.waveNo === i + 1
        const fill = rv ? (isCurrent ? waves.currentFill : 1) : 0
        ctx.fillStyle = col('text_secondary')
        ctx.font = this.numFont(T.typography.body)
        ctx.fillText(WAVE_LETTERS[i], r.x, r.y + r.h / 2)
        const barX = r.x + 64, barW = r.w - 64 - 180
        ctx.beginPath(); ctx.roundRect(barX, r.y + r.h / 2 - 16, barW, 32, T.radius.chip)
        ctx.fillStyle = withAlpha(col('bg_night'), 0.7); ctx.fill()
        ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
        if (fill > 0 && rv) {
          const stateColor = rv.state === 0 ? col('alert_blood') : rv.state === 1 ? col('gold_deep') : col('success')
          const g = ctx.createLinearGradient(barX, 0, barX + barW, 0)
          g.addColorStop(0, shade(stateColor, 0.75)); g.addColorStop(1, stateColor)
          ctx.fillStyle = g
          ctx.beginPath(); ctx.roundRect(barX + 3, r.y + r.h / 2 - 13, Math.max(8, (barW - 6) * fill), 26, T.radius.chip - 2); ctx.fill()
          // 末端高光点
          ctx.beginPath(); ctx.arc(barX + 3 + Math.max(8, (barW - 6) * fill), r.y + r.h / 2, 5, 0, Math.PI * 2)
          ctx.fillStyle = withAlpha(col('text_primary'), 0.7); ctx.fill()
        }
        if (rv) {
          const mon = pb.monsterNames[rv.route.monsterId ?? ''] ?? '怪物'
          ctx.fillStyle = rv.state === 0 ? col('alert_blood') : col('text_primary')
          ctx.font = font(T.typography.body)
          ctx.fillText(`${this.roomLabel(rv.route.roomId)} ${mon} ${Math.round(rv.route.r * 100)}%${rv.state === 0 ? ' ‼' : rv.state === 1 ? ' ⚠' : ''}`, barX + barW + T.space.s, r.y + r.h / 2)
        } else {
          ctx.fillStyle = col('text_secondary')
          ctx.font = this.numFont(T.typography.body)
          ctx.fillText('??', barX + barW + T.space.s, r.y + r.h / 2)
        }
      })
    }
    // 夜战实体（差异化呈现，设计 §2.4）：怪物沿路行进→守卫反击→结果标记
    if (pb.session && waves) {
      pb.session.routes.forEach((_, i) => {
        const rv = waves.revealed[i]
        if (!rv) return
        const r = nightRouteRect(i)
        const isCurrent = waves.waveNo === i + 1
        const prog = isCurrent
          ? monsterProgress(waves.waveNo, pb.nightStart ?? 0, now)
          : waves.waveNo > i + 1 ? 1 : 0
        const barX = r.x + 64, barW = r.w - 64 - 160
        const visual = monsterVisual(rv.route.monsterId ?? '')
        const mx = barX + 14 + (barW - 60) * prog
        const my = r.y + r.h / 2 + (visual === 'flyer' ? -12 : 0) + (isCurrent ? Math.sin(now / 90) * 2 : 0)
        const scale = visual === 'elite' ? 1.3 : 1
        const gx = barX + barW - 18
        this.iconPerson(gx, r.y + r.h / 2 + 2, 26, col('text_primary'))
        ctx.fillStyle = col('alert_blood')
        ctx.fillRect(gx - 3, r.y + r.h / 2 - 2, 8, 5)
        if (prog <= 0) return
        const lunge = isCurrent && prog > 0.85 ? Math.sin(now / 60) * 6 : 0
        const bobY = visual === 'flyer' ? Math.sin(now / 120) * 4 : Math.abs(Math.sin(now / 110)) * -3
        ctx.save()
        ctx.translate(mx + lunge, my + bobY)
        ctx.scale(scale, scale)
        this.drawMonster(visual, now)
        ctx.restore()
        if (!isCurrent && waves.waveNo > i + 1) {
          if (rv.state === 2) {
            for (let p = 0; p < 5; p++) {
              const a = prand(i * 7 + p) * Math.PI * 2
              ctx.beginPath(); ctx.arc(gx - 10 + Math.cos(a) * (6 + p * 3), r.y + r.h / 2 - Math.sin(a) * (4 + p * 2), 2.5, 0, Math.PI * 2)
              ctx.fillStyle = withAlpha(col('text_primary'), 0.6); ctx.fill()
            }
          } else {
            ctx.fillStyle = withAlpha(col('alert_blood'), 0.4 + 0.3 * Math.sin(now / 150))
            ctx.beginPath(); ctx.arc(gx, r.y + r.h / 2, 16, 0, Math.PI * 2); ctx.fill()
          }
        }
      })
    }
    // 主动技
    nightSkillRects().forEach((r, i) => {
      const sk = pb.skills[i]
      if (!sk) return
      ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn)
      ctx.fillStyle = col('panel'); ctx.fill()
      ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 3; ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = this.numFont(T.typography.h2)
      ctx.fillText(sk.glyph, r.x + r.w / 2 - 16, r.y + r.h / 2 - 8)
      ctx.font = font(T.typography.caption)
      ctx.fillStyle = col('text_secondary')
      const lw = ctx.measureText(sk.label).width
      ctx.fillText(sk.label, r.x + (r.w - lw) / 2, r.y + r.h - 18)
      const cdLeft = sk.cdUntil - now
      if (cdLeft > 0) {
        const frac = cdLeft / (motion('normal').dur * 10)
        ctx.beginPath()
        ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 30, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2)
        ctx.strokeStyle = col('gold_primary'); ctx.lineWidth = 5; ctx.stroke()
        ctx.fillStyle = withAlpha(col('bg_night'), 0.55)
        ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 26, 0, Math.PI * 2); ctx.fill()
      }
    })
    ctx.restore()
  }

  /** 怪物绘制（差异化：循声者爬行+声波圈/破窗者携梯/攀楼种挂钩/飞行种悬停/精英红眼尖刺） */
  private drawMonster(visual: 'crawler' | 'breaker' | 'climber' | 'flyer' | 'elite', now: number): void {
    const { ctx } = this
    const body = shade(col('panel_stroke'), 0.55)
    const legSwing = Math.sin(now / 90) * 3
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 3
    if (visual === 'flyer') {
      const flap = Math.sin(now / 60) * 6
      ctx.beginPath()
      ctx.moveTo(0, -8); ctx.lineTo(-14, -14 + flap); ctx.moveTo(0, -8); ctx.lineTo(14, -14 - flap)
      ctx.stroke()
    }
    if (visual === 'crawler' || visual === 'elite') {
      ctx.beginPath()
      ctx.moveTo(-8, 8); ctx.lineTo(-12, 14 + legSwing)
      ctx.moveTo(8, 8); ctx.lineTo(12, 14 - legSwing)
      ctx.stroke()
    }
    ctx.beginPath()
    if (visual === 'flyer') ctx.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2)
    else ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2)
    ctx.fillStyle = body; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2; ctx.stroke()
    if (visual === 'breaker') {
      ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(10, -6); ctx.lineTo(20, 4); ctx.stroke()
    }
    if (visual === 'climber') {
      ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(-12, -4, 4, 0, Math.PI * 2); ctx.stroke()
    }
    if (visual === 'elite') {
      ctx.beginPath()
      ctx.moveTo(-10, -10); ctx.lineTo(-14, -16); ctx.moveTo(10, -10); ctx.lineTo(14, -16)
      ctx.stroke()
    }
    const er = visual === 'elite' ? 4 : 3
    ctx.fillStyle = col('alert_blood')
    ctx.beginPath(); ctx.arc(-5, -3, er, 0, Math.PI * 2); ctx.fill()
    ctx.beginPath(); ctx.arc(5, -3, er, 0, Math.PI * 2); ctx.fill()
  }

  /** 战况日志 + 战毕返回 */
  private drawNightLog(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const r = nightLogRect()
    this.panel(r.x, r.y, r.w, r.h)
    ctx.save()
    ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel); ctx.clip()
    ctx.textBaseline = 'middle'
    const lines: string[] = []
    if (pb.session && pb.nightStart !== null) {
      const waves = nightWaves(pb.session.routes, pb.nightStart, now)
      waves.revealed.forEach((rv, i) => {
        const mon = pb.monsterNames[rv.route.monsterId ?? ''] ?? '怪物'
        lines.push(`第${i + 1}波 路${WAVE_LETTERS[i]} · ${this.roomLabel(rv.route.roomId)} · ${mon} · r=${rv.route.r.toFixed(2)} → ${OUTCOME_LABEL[rv.route.outcome]}`)
      })
    }
    lines.push(...pb.logs)
    ctx.font = font(T.typography.body)
    const visible = lines.slice(-Math.floor((r.h - T.space.s * 2) / 36))
    visible.forEach((ln, i) => {
      ctx.fillStyle = i === visible.length - 1 ? col('text_primary') : col('text_secondary')
      ctx.fillText(ln, r.x + T.space.m, r.y + 32 + i * 36)
    })
    if (pb.session && pb.nightStart !== null && nightWaves(pb.session.routes, pb.nightStart, now).done) {
      this.button(nightBackRect(), '天亮了 →', 'primary')
    }
    ctx.restore()
  }

  // ---- DAWN 收租结算 ----
  private drawSettle(frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const start = pb.settleStart
    ctx.textBaseline = 'middle'
    if (start !== null) {
      const rainM = motion('rain')
      const rainT = Math.min(1, (now - start) / rainM.dur)
      if (rainT < 1) {
        for (let i = 0; i < 24; i++) {
          const seed = prand(i * 97 + frame.day * 31)
          const x = T.space.l + seed * (DESIGN_W - T.space.l * 2 - 24)
          const y = (rainM.fn(rainT) * DESIGN_H * 1.1 + seed * 300) % (DESIGN_H * 0.9)
          ctx.fillStyle = withAlpha(col('gold_primary'), 0.35)
          ctx.fillRect(x - 2, y - 2, 24, 34)
          ctx.fillStyle = col('gold_primary')
          ctx.fillRect(x, y, 20, 30)
          ctx.fillStyle = shade(col('gold_primary'), 0.72)
          ctx.fillRect(x + 4, y + 4, 12, 8)
        }
      }
    }
    const r = settlePanelRect()
    this.panel(r.x, r.y, r.w, r.h)
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.body)
    ctx.fillText('天亮 · 收租结算', r.x + T.space.m, r.y + 48)
    const households = Math.min(frame.population, frame.roomsBuilt)
    const shown = start !== null ? counterValue(frame.income, start + motion('rain').dur, now) : 0
    ctx.fillStyle = col('gold_primary')
    ctx.font = this.numFont(T.typography.h1)
    ctx.fillText(`+${fmt(shown)}`, settleCounterRect().x + T.space.m, settleCounterRect().y + 40)
    this.iconCoin(settleCounterRect().x + T.space.m + ctx.measureText(`+${fmt(shown)}`).width + 30, settleCounterRect().y + 38, 20)
    const perRoom = households > 0 ? Math.round(frame.income / households) : 0
    const popCount = Math.min(households, SETTLE_POP_MAX)
    for (let i = 0; i < popCount; i++) {
      const p = start !== null ? popProgress(i, start + motion('rain').dur + motion('counter').dur, now) : 0
      if (p <= 0) continue
      const pr = settlePopRect(i)
      ctx.globalAlpha = p
      this.iconPerson(pr.x + 14, pr.y + pr.h / 2, 22, col('text_secondary'))
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`住 · F1-R${i + 1}`, pr.x + 36, pr.y + pr.h / 2)
      ctx.fillStyle = col('gold_primary')
      ctx.font = this.numFont(T.typography.body)
      ctx.fillText(`+${fmt(perRoom)}`, pr.x + 170, pr.y + pr.h / 2)
      ctx.globalAlpha = 1
    }
    if (households > SETTLE_POP_MAX) {
      const pr = settlePopRect(SETTLE_POP_MAX - 1)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`…共 ${households} 户`, pr.x, pr.y + pr.h + 24)
    }
    if (start !== null && now >= settleDoneAt(start, households)) {
      this.button(settleContinueRect(), '继续 ▶', 'primary')
    }
  }

  // ---- L1 野外地图（探索；UI 规范 v2.0 §7.3）----
  private drawWildView(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    ctx.fillStyle = col('bg_night'); ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    ctx.textBaseline = 'middle'
    this.button(wildBackRect(), '◀ 小区', 'normal')
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText('野外 · 大区域地图', wildBackRect().x + wildBackRect().w + T.space.m, wildBackRect().y + wildBackRect().h / 2)
    // 队伍徽标（在外队伍）
    const parties = pb.parties ?? []
    let px = wildBackRect().x + wildBackRect().w + T.space.l + 240
    for (const p of parties) {
      ctx.fillStyle = withAlpha(col('success'), 0.15)
      ctx.beginPath(); ctx.roundRect(px, wildBackRect().y + 8, 190, wildBackRect().h - 16, T.radius.chip); ctx.fill()
      ctx.strokeStyle = col('success'); ctx.lineWidth = 2; ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`${WILD_ZONE_NAME(p.zone)} · ${p.size}人`, px + 12, wildBackRect().y + wildBackRect().h / 2 - 12)
      ctx.fillStyle = col('text_secondary')
      ctx.fillText(`D${p.returnsDay} 归来`, px + 12, wildBackRect().y + wildBackRect().h / 2 + 14)
      px += 205
    }
    // 区域卡 ×4
    WILD_ZONES.forEach((z, i) => {
      const r = wildZoneRect(i)
      const locked = frame.day < z.unlockDay
      const sel = ui.sel.wildZone === z.zone
      this.panel(r.x, r.y, r.w, r.h, T.radius.btn)
      if (sel) { ctx.strokeStyle = col('gold_primary'); ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn); ctx.lineWidth = 3; ctx.stroke() }
      // 区域剪影
      ctx.fillStyle = locked ? withAlpha(col('panel_stroke'), 0.5) : z.danger === 'high' ? withAlpha(col('alert_blood'), 0.3) : z.danger === 'mid' ? withAlpha(col('gold_deep'), 0.25) : withAlpha(col('success'), 0.2)
      for (let t = 0; t < 3; t++) {
        const tx = r.x + 40 + t * 70, ty = r.y + 60
        ctx.beginPath()
        ctx.moveTo(tx, ty - 30); ctx.lineTo(tx + 26, ty + 26); ctx.lineTo(tx - 26, ty + 26)
        ctx.closePath(); ctx.fill()
        ctx.fillRect(tx - 4, ty + 26, 8, 12)
      }
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.h2, { weight: 'bold' })
      ctx.fillText(locked ? `${z.name} D${z.unlockDay}` : z.name, r.x + T.space.m, r.y + 130)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`路程 ${z.travelTime} 分钟 · 危险 ${z.danger === 'low' ? '低' : z.danger === 'mid' ? '中' : '高'}`, r.x + T.space.m, r.y + 165)
    })
    // 详情 + 派出
    const sel = WILD_ZONES.find(z => z.zone === ui.sel.wildZone)
    const d = wildDetailRect()
    this.panel(d.x, d.y, d.w, d.h)
    if (!sel) {
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.body)
      ctx.fillText('点击上方区域查看探索详情', d.x + T.space.m, d.y + 40)
    } else {
      const locked = frame.day < sel.unlockDay
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      ctx.fillText(`${sel.name}${locked ? `（D${sel.unlockDay} 解锁）` : ''}`, d.x + T.space.m, d.y + 40)
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText('队伍人数', d.x + T.space.m, d.y + 100)
      ctx.fillStyle = col('text_primary')
      ctx.font = this.numFont(T.typography.h2)
      ctx.fillText(`${ui.sel.partySize ?? 1}`, wildMinusRect().x + wildMinusRect().w + HIT_MIN + 20, wildMinusRect().y + wildMinusRect().h / 2)
      this.button(wildMinusRect(), '－', 'normal')
      this.button(wildPlusRect(), '＋', 'normal')
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText(`体力 ${sel.travelTime > 20 ? 35 : sel.travelTime > 10 ? 25 : 20}/人 · ${sel.travelTime > 20 ? '跨夜风险（夜晚危险 ×2）' : '当日归来'}`, d.x + T.space.m, d.y + 220)
      if (!locked) this.button(wildDispatchRect(), '派出 ▶', 'primary')
    }
    // 最近归来的野外战报
    if ((pb.wildReports?.length ?? 0) > 0) {
      const rr = pb.wildReports[pb.wildReports.length - 1]
      ctx.fillStyle = withAlpha(col('panel'), 0.9)
      ctx.beginPath(); ctx.roundRect(d.x, d.y + 240, d.w, 48, T.radius.chip); ctx.fill()
      ctx.fillStyle = col('gold_primary')
      ctx.font = font(T.typography.caption, { weight: 'bold' })
      ctx.fillText(`归来战报：${rr.join(' · ')}`, d.x + T.space.m, d.y + 264)
    }
    void now
  }

  /** 独栋小屋群落（M3.2 F5；K-H1 决议）：30 栋错排，6 级进化外观，烟囱/窗光/间距 */
  private drawHouseVillage(frame: DayFrame, now: number): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    // 区域名
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText('住户小屋群落', 90, 690)
    for (let i = 0; i < 30; i++) {
      const col = i % 6, row = Math.floor(i / 6)
      const x = 96 + col * 100 + (row % 2) * 50  // 错排=间距属性可视化
      const y = 726 + row * 84
      const occupied = i < frame.population
      // 进化等级（表现层占位：随天数成长；真实升级交互在 F7）
      const level = Math.min(5, Math.floor(frame.day / 6) + (i % 2 === 0 ? 0 : 1))
      this.drawHouse(x, y, level, occupied, now, i)
    }
  }

  /** 单栋小屋：6 级外观（茅草屋→破损木屋→普通木屋→精品木屋→石屋→砖石堡垒） */
  private drawHouse(x: number, y: number, level: number, occupied: boolean, now: number, i: number): void {
    const { ctx } = this
    const w = 62, wallH = 26 + level * 3
    // 墙体（等级越高越精致：0 枯黄泥墙 / 1 缺口木板 / 2 整齐木板 / 3 双色+石基 / 4 石块 / 5 砖石）
    const wallByLv = [
      mix(col('gold_deep'), col('bg_night'), 0.72),
      shade(col('panel_stroke'), 0.9),
      mix(col('panel'), col('gold_deep'), 0.25),
      col('panel'),
      col('panel_stroke'),
      shade(col('panel_stroke'), 1.15)
    ][Math.min(5, level)]
    ctx.fillStyle = wallByLv
    ctx.fillRect(x, y - wallH, w, wallH)
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2.5
    ctx.strokeRect(x, y - wallH, w, wallH)
    if (level >= 3) { // 石基/砖缝
      ctx.fillStyle = withAlpha(col('bg_night'), 0.35)
      ctx.fillRect(x, y - 6, w, 6)
    }
    if (level === 1) { // 破损补丁
      ctx.strokeStyle = withAlpha(col('bg_night'), 0.7); ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(x + 12, y - wallH + 4); ctx.lineTo(x + 20, y - 6); ctx.stroke()
    }
    // 屋顶（等级决定形制与材质色）
    ctx.beginPath()
    ctx.moveTo(x - 9, y - wallH); ctx.lineTo(x + w / 2, y - wallH - (16 + level * 3)); ctx.lineTo(x + w + 9, y - wallH)
    ctx.closePath()
    const roofByLv = [
      mix(col('gold_primary'), col('bg_night'), 0.55), // 茅草枯黄
      mix(col('gold_primary'), col('bg_night'), 0.62),
      mix(col('gold_deep'), col('bg_night'), 0.35),    // 木棕
      mix(col('panel_stroke'), col('gold_deep'), 0.4), // 精品
      shade(col('panel_stroke'), 0.75),                // 石瓦
      mix(col('panel_stroke'), col('danger'), 0.18)    // 砖石
    ][Math.min(5, level)]
    ctx.fillStyle = roofByLv; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2.5; ctx.stroke()
    if (level >= 2) { // 屋顶纹理
      ctx.strokeStyle = withAlpha(col('bg_night'), 0.4); ctx.lineWidth = 1.5
      for (let t = 1; t <= level - 1 && t <= 3; t++) {
        ctx.beginPath()
        ctx.moveTo(x - 9 + t * 6, y - wallH); ctx.lineTo(x + w / 2, y - wallH - (16 + level * 3) + t * 3)
        ctx.lineTo(x + w + 9 - t * 6, y - wallH)
        ctx.stroke()
      }
    }
    if (level >= 3) { // 气窗
      ctx.fillStyle = col('bg_night')
      ctx.fillRect(x + w / 2 - 6, y - wallH - 10, 12, 10)
    }
    if (level >= 5) { // 瞭望角楼
      ctx.fillRect(x + w - 6, y - wallH - 22, 12, 22)
      ctx.fillStyle = col('danger')
      ctx.fillRect(x + w - 4, y - wallH - 20, 8, 4)
    }
    // 门（occupied 亮色 / 空 灰）
    ctx.fillStyle = occupied ? col('gold_primary') : col('text_secondary')
    ctx.fillRect(x + w / 2 - 7, y - 18, 14, 18)
    // 窗（occupied 夜光；本层白昼微光）
    ctx.fillStyle = occupied ? withAlpha(col('gold_primary'), 0.8) : withAlpha(col('panel_stroke'), 0.8)
    ctx.fillRect(x + 8, y - wallH + 8, 10, 10)
    // 烟囱（occupied：呼吸烟柱）
    if (occupied && level >= 2) {
      const puff = (now / 300 + i * 11) % 36
      ctx.beginPath(); ctx.arc(x + w - 10, y - wallH - 18 - puff * 0.6, 3 + puff * 0.08, 0, Math.PI * 2)
      ctx.fillStyle = withAlpha(col('text_secondary'), Math.max(0, 0.5 - puff / 60)); ctx.fill()
      ctx.fillStyle = col('panel_stroke')
      ctx.fillRect(x + w - 14, y - wallH - 14, 8, 12)
    }
  }

  /** 新手引导横幅（M3.4-①首切片）：当日 scripted 教学事件 → 顶部金色目标条 */
  private drawTutorialBanner(frame: DayFrame): void {
    const tut = frame.eventCards.find(c => c.id.startsWith('evt_tut_'))
    if (!tut) return
    const { ctx } = this
    const y = hudRect().h + 4
    ctx.fillStyle = withAlpha(col('gold_primary'), 0.16)
    ctx.beginPath(); ctx.roundRect(T.space.s, y, DESIGN_W - T.space.s * 2, 52, T.radius.chip); ctx.fill()
    ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = col('gold_primary')
    ctx.beginPath(); ctx.roundRect(T.space.s + 10, y + 12, 56, 28, 6); ctx.fill()
    ctx.fillStyle = shade(col('gold_primary'), 0.3)
    ctx.font = font(T.typography.caption, { weight: 'bold' })
    ctx.fillText('教学', T.space.s + 18, y + 27)
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body, { weight: 'bold' })
    ctx.fillText(`目标：${tut.title}`, T.space.s + 80, y + 27)
  }

  /** 分步引导步骤板（M3.4-②）：当日步骤高亮/下一步指引/完成打勾 */
  private drawTutorialSteps(frame: DayFrame): void {
    const { ctx } = this
    const fired = new Set(frame.eventCards.map(c => c.id))
    const titles = new Map(frame.eventCards.map(c => [c.id, c.title]))
    const { rows, current } = tutorialBoard(frame.day, fired)
    if (rows.length === 0) return
    const w = 330, x = DESIGN_W - w - 16, y = 1150
    const h = 56 + rows.length * 88
    this.panel(x, y, w, h, T.radius.btn)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = col('gold_primary')
    ctx.beginPath(); ctx.roundRect(x + 14, y + 12, 40, 26, 6); ctx.fill()
    ctx.fillStyle = shade(col('gold_primary'), 0.3)
    ctx.font = font(T.typography.caption, { weight: 'bold' })
    ctx.fillText('步骤', x + 20, y + 26)
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.caption, { weight: 'bold' })
    ctx.fillText(`今日目标 ${rows.filter(r => r.done).length}/${rows.length}`, x + 66, y + 26)
    rows.forEach((row: TutRow, i: number) => {
      const ry = y + 52 + i * 88
      const isCurrent = current?.id === row.step.id
      if (isCurrent) {
        ctx.beginPath(); ctx.roundRect(x + 10, ry - 4, w - 20, 84, T.radius.chip)
        ctx.fillStyle = withAlpha(col('gold_primary'), 0.12); ctx.fill()
        ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 2; ctx.stroke()
      }
      // 打勾圆
      ctx.beginPath(); ctx.arc(x + 34, ry + 14, 13, 0, Math.PI * 2)
      if (row.done) { ctx.fillStyle = col('success'); ctx.fill() }
      ctx.strokeStyle = row.done ? col('success') : col('panel_stroke'); ctx.lineWidth = 2.5; ctx.stroke()
      if (row.done) {
        ctx.strokeStyle = shade(col('success'), 0.25); ctx.lineWidth = 3
        ctx.beginPath(); ctx.moveTo(x + 27, ry + 14); ctx.lineTo(x + 32, ry + 20); ctx.lineTo(x + 42, ry + 6); ctx.stroke()
      } else {
        ctx.fillStyle = col('text_secondary')
        ctx.beginPath(); ctx.arc(x + 34, ry + 14, 5, 0, Math.PI * 2); ctx.fill()
      }
      ctx.fillStyle = row.done ? col('text_secondary') : col('text_primary')
      ctx.font = font(T.typography.body, { weight: row.done ? undefined : 'bold' })
      ctx.fillText(titles.get(row.step.id) ?? row.step.id, x + 56, ry + 10)
      if (isCurrent && !row.done) {
        ctx.fillStyle = col('gold_primary')
        ctx.font = font(T.typography.caption)
        ctx.font = font(T.typography.caption)
        for (const [j, ln] of this.wrap(row.step.hint, w - 100).entries()) {
          ctx.fillText(`▸ ${ln}`, x + 56, ry + 42 + j * 24)
        }
      }
    })
  }

  /** 新开放角标（楼栋解锁后 3 天内显示，替代锁定态） */
  private newlyOpenBadge(cx: number, cy: number): void {
    const { ctx } = this
    ctx.fillStyle = col('success')
    ctx.beginPath(); ctx.roundRect(cx - 34, cy - 12, 68, 26, T.radius.chip); ctx.fill()
    ctx.fillStyle = shade(col('success'), 0.3)
    ctx.font = font(T.typography.caption, { weight: 'bold' })
    ctx.textAlign = 'center'
    ctx.fillText('新开放', cx, cy + 1)
    ctx.textAlign = 'left'
  }

  // ---- L2 小区地图（等距；UI 规范 v2.0 §7.1）----
  private drawMapView(ui: UiState, frame: DayFrame, now: number): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    this.drawHudMini(frame, now)
    for (let gx = 0; gx < 7; gx++) {
      for (let gy = 0; gy < 8; gy++) {
        const c = isoToScreen(gx, gy)
        ctx.beginPath()
        ctx.moveTo(c.x, c.y)
        ctx.lineTo(c.x + ISO_TILE_W / 2, c.y + ISO_TILE_H / 2)
        ctx.lineTo(c.x, c.y + ISO_TILE_H)
        ctx.lineTo(c.x - ISO_TILE_W / 2, c.y + ISO_TILE_H / 2)
        ctx.closePath()
        ctx.fillStyle = (gx + gy) % 2 === 0 ? withAlpha(col('panel'), 0.5) : withAlpha(col('panel_stroke'), 0.25)
        ctx.fill()
      }
    }
    for (const [id, lot] of Object.entries(LOTS)) {
      const locked = frame.day < lot.unlockDay
      const base = isoToScreen(lot.gx, lot.gy)
      const cx = base.x, cy = base.y + ISO_TILE_H / 2
      if (lot.kind === 'bld') this.drawIsoBuilding(cx, cy, locked, frame, id, now)
      if (lot.kind === 'bld' && !locked && frame.day >= lot.unlockDay && frame.day - lot.unlockDay < 3) this.newlyOpenBadge(cx, cy - 6 * ISO_FLOOR_H - 34)
      else if (lot.kind === 'gate') this.drawIsoGate(cx, cy)
      else if (lot.kind === 'wall') this.drawIsoWall(cx, cy)
      else if (lot.kind === 'plaza') this.drawIsoPlaza(cx, cy)
      else this.drawIsoFacility(cx, cy, locked)
      ctx.font = font(T.typography.caption, { weight: 'bold' })
      ctx.textAlign = 'center'
      ctx.fillStyle = locked ? col('text_secondary') : col('text_primary')
      ctx.fillText(locked ? `${lot.name} D${lot.unlockDay}` : lot.name, cx, cy + 36)
      ctx.textAlign = 'left'
    }
    const ex = EXPLORE_ENTRY
    ctx.beginPath(); ctx.roundRect(ex.x, ex.y, ex.w, ex.h, T.radius.btn)
    ctx.fillStyle = withAlpha(col('success'), 0.14); ctx.fill()
    ctx.strokeStyle = col('success'); ctx.lineWidth = 2; ctx.stroke()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body, { weight: 'bold' })
    ctx.textAlign = 'center'
    ctx.fillText('🌲 出门探索（M3.3 开放）', ex.x + ex.w / 2, ex.y + ex.h / 2 + 1)
    ctx.textAlign = 'left'
    this.drawDock()
    void ui
  }

  private drawHudMini(frame: DayFrame, now: number): void {
    const { ctx } = this
    const hud = hudRect()
    const g = ctx.createLinearGradient(0, 0, 0, hud.h)
    g.addColorStop(0, mix(col('panel'), col('text_primary'), 0.07))
    g.addColorStop(1, col('panel'))
    ctx.fillStyle = g
    ctx.fillRect(0, 0, hud.w, hud.h)
    ctx.fillStyle = col('panel_stroke'); ctx.fillRect(0, hud.h - 3, hud.w, 3)
    ctx.textBaseline = 'middle'
    ctx.fillStyle = withAlpha(col('bg_night'), 0.5)
    ctx.beginPath(); ctx.roundRect(T.space.s, 8, 150, hud.h - 16, T.radius.chip); ctx.fill()
    ctx.fillStyle = col('gold_primary')
    ctx.font = this.numFont(T.typography.h2)
    ctx.fillText(`D${frame.day}`, T.space.s + 16, hud.h / 2 + 1)
    const cycle = Math.ceil(frame.day / 7)
    for (let i = 0; i < 4; i++) {
      const mx = T.space.s + 176 + i * 30
      ctx.beginPath(); ctx.arc(mx, hud.h / 2, 8, 0, Math.PI * 2)
      ctx.fillStyle = i < cycle ? (frame.modifiers.includes('BLOOD_MOON') ? col('alert_blood') : col('gold_primary')) : withAlpha(col('panel_stroke'), 0.8)
      ctx.fill()
      ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
    }
    this.drawWeatherBadge(this.weatherEntry(frame.weather), DESIGN_W - 32 - 196, hud.h / 2 - 14)
    const st = settingsRect()
    this.circleButton(st.x + st.w / 2, hud.h / 2, 26, () => this.iconGear(st.x + st.w / 2, hud.h / 2, 13, col('text_secondary')))
    void now
  }

  private drawIsoBuilding(cx: number, cy: number, locked: boolean, frame: DayFrame, id: string, now: number): void {
    const { ctx } = this
    const w = ISO_TILE_W * 0.9, h = ISO_TILE_H * 0.9, floors = 6
    const topZ = floors * ISO_FLOOR_H
    const left = locked ? col('panel_stroke') : shade(col('panel'), 0.8)
    const right = locked ? shade(col('panel_stroke'), 0.92) : col('panel')
    const topFill = locked ? shade(col('panel_stroke'), 0.9) : mix(col('panel'), col('text_primary'), 0.12)
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, cy - h / 2 - topZ); ctx.lineTo(cx, cy - topZ)
    ctx.lineTo(cx, cy - topZ + h / 2 + ISO_TILE_H / 2); ctx.lineTo(cx - w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2)
    ctx.closePath(); ctx.fillStyle = left; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2.5; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx + w / 2, cy - h / 2 - topZ); ctx.lineTo(cx, cy - topZ)
    ctx.lineTo(cx, cy - topZ + h / 2 + ISO_TILE_H / 2); ctx.lineTo(cx + w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2)
    ctx.closePath(); ctx.fillStyle = right; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - topZ - h / 2); ctx.lineTo(cx + w / 2, cy - topZ)
    ctx.lineTo(cx, cy - topZ + h / 2); ctx.lineTo(cx - w / 2, cy - topZ)
    ctx.closePath(); ctx.fillStyle = topFill; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.stroke()
    if (!locked) {
      const litTotal = id === 'lot_bld_a' ? Math.min(30, frame.population) : 0
      for (let f = 0; f < floors; f++) {
        const fy = cy - (f + 1) * ISO_FLOOR_H
        ctx.beginPath(); ctx.moveTo(cx - w / 2, fy - h / 2); ctx.lineTo(cx + w / 2, fy - h / 2)
        ctx.strokeStyle = withAlpha(col('bg_night'), 0.5); ctx.lineWidth = 1.5; ctx.stroke()
        for (let win = 0; win < 3; win++) {
          const lit = f * 3 + win < litTotal
          const wx = cx + (win - 1) * (w / 4) + w / 8, wy = fy - ISO_FLOOR_H * 0.45
          ctx.fillStyle = lit ? withAlpha(col('gold_primary'), 0.9) : withAlpha(col('panel_stroke'), 0.6)
          ctx.fillRect(wx - 5, wy - 5, 10, 10)
        }
      }
      if (id === 'lot_bld_a') {
        const pulse = 0.5 + 0.5 * Math.sin(now / 700)
        ctx.beginPath(); ctx.arc(cx, cy + 6, 12 + pulse * 5, 0, Math.PI * 2)
        ctx.strokeStyle = withAlpha(col('success'), 0.5 + pulse * 0.4); ctx.lineWidth = 3; ctx.stroke()
      }
    }
  }

  /** 夜战目标房间标签：F{n}-R{m} → A栋 n 层 m 号（M0 数值窗口内目标恒在默认栋 A） */
  private roomLabel(roomId: string): string {
    const m = /F(\d+)-R(\d+)/.exec(roomId)
    return m ? `A栋${m[1]}层${m[2]}号` : roomId
  }

  private drawIsoGate(cx: number, cy: number): void {
    const { ctx } = this
    ctx.beginPath(); ctx.roundRect(cx - 55, cy - 30, 110, 34, 6)
    ctx.fillStyle = col('panel_stroke'); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2.5; ctx.stroke()
    ctx.beginPath(); ctx.roundRect(cx - 34, cy - 58, 68, 30, 6)
    ctx.fillStyle = mix(col('panel_stroke'), col('gold_deep'), 0.35); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.stroke()
    ctx.fillStyle = col('gold_primary')
    ctx.font = font(T.typography.caption, { weight: 'bold' })
    ctx.textAlign = 'center'
    ctx.fillText('门', cx, cy - 42)
    ctx.textAlign = 'left'
  }

  private drawIsoWall(cx: number, cy: number): void {
    const { ctx } = this
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.roundRect(cx - 60 + i * 42, cy - 16, 36, 20, 4)
      ctx.fillStyle = shade(col('panel_stroke'), 0.85); ctx.fill()
      ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2; ctx.stroke()
    }
  }

  private drawIsoPlaza(cx: number, cy: number): void {
    const { ctx } = this
    ctx.beginPath()
    ctx.moveTo(cx, cy - 20); ctx.lineTo(cx + 52, cy + 6); ctx.lineTo(cx, cy + 32); ctx.lineTo(cx - 52, cy + 6)
    ctx.closePath()
    ctx.fillStyle = withAlpha(col('panel'), 0.7); ctx.fill()
    ctx.strokeStyle = col('panel_stroke'); ctx.lineWidth = 2; ctx.stroke()
    ctx.strokeStyle = col('text_secondary'); ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(cx, cy - 20); ctx.lineTo(cx, cy - 58); ctx.stroke()
    ctx.fillStyle = col('alert_blood')
    ctx.beginPath(); ctx.moveTo(cx, cy - 58); ctx.lineTo(cx + 22, cy - 50); ctx.lineTo(cx, cy - 42)
    ctx.closePath(); ctx.fill()
  }

  private drawIsoFacility(cx: number, cy: number, locked: boolean): void {
    const { ctx } = this
    const w = ISO_TILE_W * 0.66, h = ISO_TILE_H * 0.66
    const z = ISO_FLOOR_H * 1.4
    ctx.beginPath()
    ctx.moveTo(cx - w / 2, cy - h / 2 - z); ctx.lineTo(cx, cy - z)
    ctx.lineTo(cx, cy - z + h / 2 + ISO_TILE_H / 2); ctx.lineTo(cx - w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2)
    ctx.closePath(); ctx.fillStyle = locked ? col('panel_stroke') : shade(col('panel'), 0.85); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 2; ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - h / 2 - z); ctx.lineTo(cx + w / 2, cy - h / 2 - z + h / 2)
    ctx.lineTo(cx + w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2); ctx.lineTo(cx, cy - z + h / 2 + ISO_TILE_H / 2)
    ctx.closePath(); ctx.fillStyle = locked ? shade(col('panel_stroke'), 0.92) : col('panel'); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(cx, cy - h / 2 - z - 14); ctx.lineTo(cx + w / 2, cy - h / 2 - z + h / 2 - 7)
    ctx.lineTo(cx, cy - h / 2 - z + h / 2); ctx.lineTo(cx - w / 2, cy - h / 2 - z + h / 2 - 7)
    ctx.closePath(); ctx.fillStyle = col('gold_deep'); ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.stroke()
  }

  // ---- L3 房屋内部（点击房间进入；UI 规范 v2.0 §7.2）----
  private drawInterior(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const floor = ui.sel.floor ?? 0, room = ui.sel.room ?? 0
    const roomIndex = floor * ROOMS_PER_FLOOR + room
    const occupied = roomIndex < frame.population
    ctx.fillStyle = col('bg_night'); ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    ctx.textBaseline = 'middle'
    this.button(interiorBackRect(), '◀ 楼层', 'normal')
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(`A栋 · ${floor + 1}层 · ${room + 1}号房`, interiorBackRect().x + interiorBackRect().w + T.space.m, interiorBackRect().y + interiorBackRect().h / 2)
    const fx0 = 60, fx1 = DESIGN_W - 60, fy0 = 560, fy1 = 1180, wallTop = 270
    const g = ctx.createLinearGradient(0, fy0, 0, fy1)
    g.addColorStop(0, mix(col('gold_deep'), col('bg_night'), 0.55))
    g.addColorStop(1, mix(col('gold_deep'), col('bg_night'), 0.78))
    ctx.beginPath()
    ctx.moveTo(fx0, fy0); ctx.lineTo(fx1, fy0); ctx.lineTo(fx1 + 60, fy1); ctx.lineTo(fx0 - 60, fy1)
    ctx.closePath(); ctx.fillStyle = g; ctx.fill()
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 3; ctx.stroke()
    ctx.fillStyle = mix(col('panel'), col('bg_night'), 0.35)
    ctx.fillRect(fx0, wallTop, fx1 - fx0, fy0 - wallTop)
    ctx.strokeStyle = col('bg_night'); ctx.strokeRect(fx0, wallTop, fx1 - fx0, fy0 - wallTop)
    const wx = fx0 + 40, wy = wallTop + 40, ww = 150, wh = 170
    ctx.fillStyle = withAlpha(col('gold_primary'), occupied ? 0.35 : 0.12)
    ctx.fillRect(wx, wy, ww, wh)
    ctx.strokeStyle = col('bg_night'); ctx.lineWidth = 5
    ctx.strokeRect(wx, wy, ww, wh)
    ctx.beginPath(); ctx.moveTo(wx + ww / 2, wy); ctx.lineTo(wx + ww / 2, wy + wh)
    ctx.moveTo(wx, wy + wh / 2); ctx.lineTo(wx + ww, wy + wh / 2); ctx.stroke()
    const dx = fx1 - 200
    ctx.fillStyle = mix(col('panel_stroke'), col('gold_deep'), 0.3)
    ctx.fillRect(dx, wallTop + 60, 110, fy0 - wallTop - 60)
    ctx.strokeStyle = col('bg_night'); ctx.strokeRect(dx, wallTop + 60, 110, fy0 - wallTop - 60)
    ctx.beginPath(); ctx.arc(dx + 92, wallTop + 60 + (fy0 - wallTop - 60) / 2, 6, 0, Math.PI * 2)
    ctx.fillStyle = col('gold_primary'); ctx.fill()
    for (let i = 0; i < 2; i++) {
      const sr = interiorSlotRect(i)
      const fortified = pb.forts[`${floor}:${room}:${i}`] ?? false
      ctx.setLineDash(fortified ? [] : [10, 8])
      ctx.beginPath(); ctx.roundRect(sr.x, sr.y, sr.w, sr.h, T.radius.chip)
      ctx.fillStyle = fortified ? withAlpha(col('success'), 0.16) : withAlpha(col('bg_night'), 0.5)
      ctx.fill()
      ctx.strokeStyle = fortified ? col('success') : col('panel_stroke')
      ctx.setLineDash([])
      ctx.lineWidth = 3; ctx.stroke()
      ctx.fillStyle = fortified ? col('success') : col('text_secondary')
      ctx.font = font(T.typography.body, { weight: fortified ? 'bold' : undefined })
      ctx.textAlign = 'center'
      ctx.fillText(fortified ? '已加固' : `工事位 ${i + 1}`, sr.x + sr.w / 2, sr.y + sr.h / 2)
      ctx.textAlign = 'left'
    }
    if (occupied) {
      const px = DESIGN_W / 2, py = (fy0 + fy1) / 2 - 30
      const breathe = 1 + 0.02 * Math.sin(now / 800)
      ctx.save()
      ctx.translate(px, py); ctx.scale(breathe, breathe)
      this.iconPerson(0, 0, 110, col('text_primary'))
      ctx.restore()
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.textAlign = 'center'
      ctx.fillText('住户 · 生命 100 · 恐慌 0', px, py + 92)
      ctx.textAlign = 'left'
    } else {
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.h2)
      ctx.textAlign = 'center'
      ctx.fillText('空房 · 待入住', DESIGN_W / 2, (fy0 + fy1) / 2)
      ctx.textAlign = 'left'
    }
  }

  // ---- 模态 ----
  private drawModal(ui: UiState, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const top: Modal | undefined = topModal(ui)
    if (!top) { this.modalOpenAt = null; return }
    if (this.modalOpenAt === null) this.modalOpenAt = now
    const m = motion('normal')
    const eased = m.fn(Math.min(1, (now - this.modalOpenAt) / m.dur))
    const r = modalRect()
    const slide = (1 - eased) * (DESIGN_H - r.y)
    ctx.fillStyle = withAlpha(col('bg_night'), 0.62 * eased)
    ctx.fillRect(0, 0, DESIGN_W, DESIGN_H)
    const y = r.y + slide
    this.panel(r.x, y, r.w, r.h)
    // 顶部把手
    ctx.fillStyle = withAlpha(col('text_secondary'), 0.5)
    ctx.beginPath(); ctx.roundRect(r.x + r.w / 2 - 40, y + 12, 80, 8, 4); ctx.fill()
    ctx.textBaseline = 'middle'
    if (top.kind === 'event' && top.card) {
      this.drawEventCard(top, y, frame, now, pb)
      return
    }
    const title = top.kind === 'confirmNight' ? '确认入夜？'
      : ({ deploy: '布防', recruit: '招募', upgrade: '升级', settings: '设置' } as Record<string, string>)[top.id] ?? top.id
    ctx.fillStyle = col('gold_primary')
    ctx.beginPath(); ctx.roundRect(r.x + T.space.m, y + 32, 6, 32, 3); ctx.fill()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(title, r.x + T.space.m + 18, y + 48)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath(); ctx.moveTo(r.x + T.space.m, y + 80); ctx.lineTo(r.x + r.w - T.space.m, y + 80); ctx.stroke()
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.body)
    const body = top.kind === 'confirmNight' ? '入夜后不可打断（全屏夜战）' : '占位面板：M3 接入对应系统操作'
    ctx.fillText(body, r.x + T.space.m, y + 120)
    if (top.kind === 'confirmNight') {
      const cr = modalConfirmRect()
      this.button({ ...cr, y: cr.y - r.y + y }, '入夜 ▶', 'primary')
    }
    this.closeBtn(y - r.y, top.kind === 'event' && top.chosen !== undefined ? '继续' : '关闭')
  }

  /** 事件卡（§3.2 模板） */
  private drawEventCard(top: Modal, y: number, frame: DayFrame, now: number, pb: Playback): void {
    const { ctx } = this
    const r = modalRect()
    const card = top.card
    if (!card) return
    ctx.fillStyle = col('gold_primary')
    ctx.beginPath(); ctx.roundRect(r.x + T.space.m, y + 32, 6, 32, 3); ctx.fill()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(card.title, r.x + T.space.m + 18, y + 48)
    ctx.strokeStyle = col('panel_stroke')
    ctx.beginPath(); ctx.moveTo(r.x + T.space.m, y + 80); ctx.lineTo(r.x + r.w - T.space.m, y + 80); ctx.stroke()
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.body)
    const bodyLines = card.text ? this.wrap(card.text, r.w - T.space.m * 2.4) : []
    bodyLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, r.x + T.space.m + 8, y + 118 + i * 34))
    const opt = card.options[0]
    const flipped = top.chosen !== undefined
    const flip = cardFlip(pb.chosenAt, now)
    if (opt && !flipped) {
      const or = modalOptionRect()
      const br = { ...or, y: or.y - r.y + y }
      ctx.beginPath(); ctx.roundRect(br.x, br.y, br.w, br.h, T.radius.btn)
      const g = ctx.createLinearGradient(0, br.y, 0, br.y + br.h)
      g.addColorStop(0, withAlpha(col('gold_primary'), 0.18)); g.addColorStop(1, withAlpha(col('gold_deep'), 0.1))
      ctx.fillStyle = g; ctx.fill()
      ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 3; ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      ctx.fillText(`▶ ${opt.label}`, br.x + T.space.m, br.y + 34)
      ctx.fillStyle = col('text_secondary')
      ctx.font = this.numFont(T.typography.caption)
      const ps = opt.ps.map(p => `${Math.round(p * 100)}%`).join('/')
      ctx.fillText(ps, br.x + T.space.m, br.y + 72)
      const stars = Math.min(3, opt.ps.length - 1)
      for (let i = 0; i < stars; i++) this.iconWarn(br.x + br.w - 60 - i * 34, br.y + 66, 18)
    }
    if (flipped) {
      const flyT = pb.chosenAt !== null ? Math.min(1, Math.max(0, (now - (pb.chosenAt + motion('normal').dur)) / motion('rain').dur)) : 0
      ctx.globalAlpha = flip
      ctx.fillStyle = col('success')
      ctx.font = font(T.typography.body, { weight: 'bold' })
      ctx.fillText(`✓ 已执行 · ${card.resultText}`, r.x + T.space.m + 8, y + 210, r.w - T.space.m * 2.4)
      ctx.globalAlpha = 1
      if (flyT > 0 && flyT < 1) {
        const rainM = motion('rain')
        const e = rainM.fn(flyT)
        const fx = r.x + T.space.m + (resourceRect().x + T.space.l - r.x) * e
        const fy = y + 210 + (resourceRect().y + 20 - y - 210) * e
        this.iconCoin(fx, fy, 14)
      }
    }
    this.closeBtn(y - r.y, flipped ? '继续' : '稍后')
  }

  private closeBtn(dy: number, label: string): void {
    const c = modalCloseRect()
    this.circleButton(c.x + c.w / 2, c.y + dy + c.h / 2, c.h / 2 - 4, () => {
      const { ctx } = this
      ctx.strokeStyle = col('text_primary'); ctx.lineWidth = 3.5
      const m = 9
      ctx.beginPath()
      ctx.moveTo(c.x + c.w / 2 - m, c.y + dy + c.h / 2 - m); ctx.lineTo(c.x + c.w / 2 + m, c.y + dy + c.h / 2 + m)
      ctx.moveTo(c.x + c.w / 2 + m, c.y + dy + c.h / 2 - m); ctx.lineTo(c.x + c.w / 2 - m, c.y + dy + c.h / 2 + m)
      ctx.stroke()
      ctx.fillStyle = col('text_primary')
      ctx.font = font(T.typography.caption)
      ctx.textAlign = 'center'
      ctx.fillText(label, c.x + c.w / 2, c.y + dy + c.h - 8)
      ctx.textAlign = 'left'
    })
  }

  /** 占位页（功能点4）：图鉴 3 列网格剪影 / 商店礼包横滑 / 设置列表 */
  private drawPage(page: 'main' | 'codex' | 'shop' | 'settings', now: number): void {
    const { ctx } = this
    ctx.textBaseline = 'middle'
    this.button(pageBackRect(), '◀ 返回', 'normal')
    const titles: Record<string, string> = { codex: '图鉴', shop: '商店', settings: '设置' }
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h1, { weight: 'bold' })
    ctx.fillText(titles[page] ?? '', pageTitleRect().x, pageTitleRect().y + pageTitleRect().h / 2)
    if (page === 'codex') {
      for (let row = 0; row < CODEX_ROWS; row++) {
        for (let c = 0; c < CODEX_COLS; c++) {
          const r = codexCellRect(c, row)
          const unlocked = row === 0 && c === 0
          const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h)
          g.addColorStop(0, unlocked ? withAlpha(col('success'), 0.16) : withAlpha(col('bg_night'), 0.55))
          g.addColorStop(1, unlocked ? withAlpha(col('success'), 0.06) : withAlpha(col('bg_night'), 0.3))
          ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel)
          ctx.fillStyle = g; ctx.fill()
          ctx.strokeStyle = unlocked ? col('success') : col('panel_stroke')
          ctx.lineWidth = 2; ctx.stroke()
          ctx.font = this.numFont(T.typography.h1)
          ctx.fillStyle = unlocked ? col('text_primary') : col('text_secondary')
          ctx.textAlign = 'center'
          if (unlocked) this.iconPerson(r.x + r.w / 2, r.y + r.h / 2 - 14, 56, col('gold_primary'))
          else {
            // 锁：环 + 方体
            ctx.strokeStyle = col('text_secondary'); ctx.lineWidth = 4
            ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 30, 16, Math.PI, 0); ctx.stroke()
            ctx.fillStyle = col('text_secondary')
            ctx.beginPath(); ctx.roundRect(r.x + r.w / 2 - 22, r.y + r.h / 2 - 30, 44, 34, 6); ctx.fill()
          }
          ctx.font = font(T.typography.caption)
          ctx.fillStyle = unlocked ? col('text_primary') : col('text_secondary')
          ctx.fillText(unlocked ? '循声者' : '未解锁', r.x + r.w / 2, r.y + r.h - 40)
          ctx.textAlign = 'left'
        }
      }
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText('占位：M3 按怪物进化树/住户名册填充', T.space.l, codexCellRect(0, CODEX_ROWS - 1).y + codexCellRect(0, 0).h + 40)
    } else if (page === 'shop') {
      const names = ['首充双倍', '物资补给包', '天赋石礼包']
      const prices = ['¥6', '¥30', '¥68']
      const was = ['¥12', '¥45', '¥98']
      for (let i = 0; i < SHOP_CARDS; i++) {
        const r = shopCardRect(i)
        this.panel(r.x, r.y, r.w, r.h)
        ctx.strokeStyle = i === 0 ? col('gold_deep') : col('panel_stroke')
        ctx.beginPath(); ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel); ctx.stroke()
        ctx.fillStyle = col('gold_primary')
        ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + 140, 42, 0, Math.PI * 2); ctx.fill()
        ctx.strokeStyle = col('gold_deep'); ctx.lineWidth = 4
        ctx.beginPath(); ctx.arc(r.x + r.w / 2, r.y + 140, 30, 0, Math.PI * 2); ctx.stroke()
        this.iconCoin(r.x + r.w / 2 - 30, r.y + 110, 12)
        ctx.fillStyle = col('text_primary')
        ctx.font = font(T.typography.h2, { weight: 'bold' })
        ctx.fillText(names[i], r.x + T.space.m, r.y + 280)
        ctx.fillStyle = col('text_secondary')
        ctx.font = font(T.typography.body)
        ctx.fillText(was[i], r.x + T.space.m, r.y + 340)
        const ww = ctx.measureText(was[i]).width
        ctx.strokeStyle = col('danger')
        ctx.beginPath(); ctx.moveTo(r.x + T.space.m, r.y + 340); ctx.lineTo(r.x + T.space.m + ww, r.y + 340); ctx.stroke()
        ctx.fillStyle = col('gold_primary')
        ctx.font = this.numFont(T.typography.h2)
        ctx.fillText(prices[i], r.x + T.space.m + ww + T.space.s, r.y + 340)
        if (i === 0) {
          ctx.fillStyle = col('alert_blood')
          ctx.beginPath(); ctx.roundRect(r.x + r.w - 128, r.y + 24, 96, 40, T.radius.chip); ctx.fill()
          ctx.fillStyle = col('text_primary')
          ctx.font = font(T.typography.caption, { weight: 'bold' })
          ctx.textAlign = 'center'
          ctx.fillText('双倍', r.x + r.w - 80, r.y + 45)
          ctx.textAlign = 'left'
        }
      }
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText('占位：SKU 走 iap_sku.json，IAA/IAP 合规审查后接入', T.space.l, shopCardRect(0).y + 600)
    } else {
      for (const [i, row] of SETTINGS_ROWS.entries()) {
        const r = settingsRowRect(i)
        this.panel(r.x, r.y, r.w, r.h, T.radius.btn)
        ctx.fillStyle = col('text_primary')
        ctx.font = font(T.typography.body)
        ctx.fillText(row.label, r.x + T.space.m, r.y + r.h / 2)
        if (row.key === 'codex' || row.key === 'shop') {
          ctx.fillStyle = col('gold_primary')
          ctx.beginPath()
          ctx.moveTo(r.x + r.w - T.space.l, r.y + r.h / 2 - 12)
          ctx.lineTo(r.x + r.w - T.space.l + 16, r.y + r.h / 2)
          ctx.lineTo(r.x + r.w - T.space.l, r.y + r.h / 2 + 12)
          ctx.closePath(); ctx.fill()
        } else {
          const tw = 96
          const tx = r.x + r.w - tw - T.space.m
          ctx.beginPath(); ctx.roundRect(tx, r.y + r.h / 2 - 24, tw, 48, 24)
          ctx.fillStyle = withAlpha(col('success'), 0.3); ctx.fill()
          ctx.beginPath(); ctx.arc(tx + tw - 24, r.y + r.h / 2, 18, 0, Math.PI * 2)
          ctx.fillStyle = col('success'); ctx.fill()
        }
      }
      ctx.fillStyle = col('text_secondary')
      ctx.font = font(T.typography.caption)
      ctx.fillText('存档三检查点：日间/黄昏/夜战（fail-safe 恢复）', T.space.l, settingsRowRect(SETTINGS_ROWS.length - 1).y + 128)
    }
    void now
  }
}


/** 帧率采样报告（性能预算冒烟：中端机 ≥30fps，白盒预算 ≥50fps） */
export function fpsReport(samples: number[]): { min: number; avg: number; budgetOk: boolean } {
  const min = samples.length ? Math.min(...samples) : 0
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0
  return { min, avg, budgetOk: min >= 50 }
}
