// 白盒渲染器（M2.5 功能点1 起）：tokens 驱动重绘——色板/字号/动效曲线全部从
// theme.ts（config/theme.json）取，零硬编码色值（scripts/check-theme.mjs 断言）。
// M2 竖屏剖面占位布局保持不变；§3.1 线框风格化在 P2 起展开。
// 纯 Canvas 2D，零引擎依赖；Creator 原生组件移植同一渲染协议（ADR-9 方案 a）。
import { T, col, withAlpha, motion, font } from './theme.ts'

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
}

export interface RendererCallbacks {
  onFps(fps: number, min: number, avg: number): void
}

const FLOORS = 6
const ROOMS_PER_FLOOR = 5

export class WhiteboxRenderer {
  private ctx: CanvasRenderingContext2D
  private frames = 0
  private fpsSamples: number[] = []
  private lastSample = 0

  constructor(private canvas: HTMLCanvasElement, private cb: RendererCallbacks) {
    this.ctx = canvas.getContext('2d')!
  }

  /** rAF 主循环：帧率采样（P6 性能预算冒烟）+ 重绘；物资雨窗口=motion.rain.dur（tokens） */
  start(getFrame: () => DayFrame | null, dayMs: number): void {
    const rainDur = motion('rain').dur
    let dayStart = performance.now()
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
      const elapsed = now - dayStart
      if (frame) {
        const rain = elapsed < rainDur // 物资雨占位动画：每日 rain.dur 时段
        this.draw(frame, rain, rain ? elapsed / rainDur : 0)
        if (elapsed >= dayMs) { dayStart = now }
      }
      requestAnimationFrame(tick)
    }
    this.lastSample = performance.now()
    requestAnimationFrame(tick)
  }

  draw(frame: DayFrame, rain: boolean, rainT: number): void {
    const { ctx, canvas } = this
    const W = canvas.width, H = canvas.height
    ctx.fillStyle = col('bg_night')
    ctx.fillRect(0, 0, W, H)

    // HUD：日次/人口/金币/战力（字号=typography tokens，色=palette tokens）
    ctx.fillStyle = col('text_primary')
    ctx.font = font(T.typography.h2, { weight: 'bold' })
    ctx.fillText(`第 ${frame.day} 天`, T.space.s, T.typography.h2)
    ctx.font = font(T.typography.caption)
    ctx.fillStyle = col('gold_primary')
    ctx.fillText(`金币 ${frame.gold}`, T.space.s + 124, T.typography.h2)
    ctx.fillStyle = col('text_secondary')
    ctx.fillText(`人口 ${frame.population}/${frame.roomsBuilt}`, T.space.s, T.typography.h2 + T.space.s + 2)
    ctx.fillText(`战力 ${frame.power}`, T.space.s + 144, T.typography.h2 + T.space.s + 2)
    if (frame.modifiers.length) {
      ctx.fillStyle = col('alert_blood')
      ctx.fillText(`特殊夜: ${frame.modifiers.join('/')}`, T.space.s, T.typography.h2 + T.space.s * 2 + 4)
    }

    // 竖屏剖面：6 层 × 5 房间格子（占位 UI；占用=success 亮格，空房=panel_stroke 描边）
    const gx = T.space.s, gy = T.space.l + T.typography.h2 + 40, gw = (W - T.space.s * 2) / ROOMS_PER_FLOOR, gh = 64
    let occupied = frame.population
    for (let f = 0; f < FLOORS; f++) {
      ctx.fillStyle = col('text_secondary')
      ctx.fillText(`${FLOORS - f}F`, gx, gy + f * gh + gh / 2)
      for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
        const x = gx + 28 + r * gw, y = gy + f * gh
        const isOccupied = occupied > 0
        if (isOccupied) occupied--
        ctx.strokeStyle = isOccupied ? col('success') : col('panel_stroke')
        ctx.strokeRect(x + 4, y + 6, gw - 12, gh - 14)
        if (isOccupied) {
          ctx.fillStyle = withAlpha(col('success'), 0.2)
          ctx.fillRect(x + 4, y + 6, gw - 12, gh - 14)
          ctx.fillStyle = col('text_primary')
          ctx.font = font(T.typography.caption)
          ctx.fillText('住', x + gw / 2 - 6, y + gh / 2 + 4)
        }
      }
    }

    // 物资雨占位动画（天亮收租，标志性瞬间的白盒表达；色=gold_primary）
    if (rain) {
      ctx.fillStyle = col('gold_primary')
      for (let i = 0; i < 24; i++) {
        const seed = (i * 97 + frame.day * 31) % 1000 / 1000
        const x = T.space.s + 14 + seed * (W - T.space.s * 2 - 38)
        const y = ((rainT * H * 1.4 + seed * 300) % (H * 0.9))
        ctx.fillRect(x, y, 10, 16)
      }
      ctx.font = font(T.typography.h1, { weight: 'bold' })
      ctx.fillText(`+${frame.income} 物资雨`, W / 2 - 70, H / 2)
    }

    // 夜战结果面板
    ctx.fillStyle = col('text_secondary')
    ctx.font = font(T.typography.caption)
    ctx.fillText(`夜战: r均=${frame.rAvg} 死亡${frame.deaths} 负伤${frame.wounds} ${frame.modifiers.includes('BLOOD_MOON') ? '[血月]' : ''} hash=${frame.sessionHash}`, T.space.s, H - T.space.l - 6)
    ctx.fillText(`恐慌总量 ${frame.panicSum} · 平均等级 ${frame.avgLevel}`, T.space.s, H - T.space.m)
  }
}

/** 帧率采样报告（性能预算冒烟：中端机 ≥30fps，白盒预算 ≥50fps） */
export function fpsReport(samples: number[]): { min: number; avg: number; budgetOk: boolean } {
  const min = samples.length ? Math.min(...samples) : 0
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0
  return { min, avg, budgetOk: min >= 50 }
}
