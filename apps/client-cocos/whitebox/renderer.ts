// 白盒渲染器（M2 功能点6）：竖屏剖面占位 UI——房间格子/人口/金币/日次/夜战结果面板
// + 物资雨占位动画 + rAF 帧率采样。纯 Canvas 2D，零引擎依赖；Creator 原生组件见
// apps/client-cocos/creator-fragment/（随 Creator 安装后移植同一渲染协议）。

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
  private lastFrame = 0

  constructor(private canvas: HTMLCanvasElement, private cb: RendererCallbacks) {
    this.ctx = canvas.getContext('2d')!
  }

  /** rAF 主循环：帧率采样（P6 性能预算冒烟）+ 重绘 */
  start(getFrame: () => DayFrame | null, dayMs = 1500): void {
    let dayStart = performance.now()
    let dayIndex = 0
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
        const rainPhase = elapsed < dayMs * 0.35 // 物资雨占位动画：每日前 35% 时段
        this.draw(frame, rainPhase, rainPhase ? elapsed / (dayMs * 0.35) : 0)
        if (elapsed >= dayMs) { dayStart = now; dayIndex++ }
      }
      requestAnimationFrame(tick)
    }
    this.lastSample = performance.now()
    requestAnimationFrame(tick)
  }

  draw(frame: DayFrame, rain: boolean, rainT: number): void {
    const { ctx, canvas } = this
    const W = canvas.width, H = canvas.height
    ctx.fillStyle = '#0b1020'
    ctx.fillRect(0, 0, W, H)

    // HUD：日次/人口/金币/战力
    ctx.fillStyle = '#e8e8f0'
    ctx.font = 'bold 22px sans-serif'
    ctx.fillText(`第 ${frame.day} 天`, 16, 34)
    ctx.font = '16px sans-serif'
    ctx.fillStyle = '#ffd700'
    ctx.fillText(`金币 ${frame.gold}`, 140, 34)
    ctx.fillStyle = '#9fd8ff'
    ctx.fillText(`人口 ${frame.population}/${frame.roomsBuilt}`, 16, 60)
    ctx.fillStyle = '#ffb0b0'
    ctx.fillText(`战力 ${frame.power}`, 160, 60)
    if (frame.modifiers.length) {
      ctx.fillStyle = '#ff6b6b'
      ctx.fillText(`特殊夜: ${frame.modifiers.join('/')}`, 16, 86)
    }

    // 竖屏剖面：6 层 × 5 房间格子（占位 UI）
    const gx = 16, gy = 110, gw = (W - 32) / ROOMS_PER_FLOOR, gh = 64
    let occupied = frame.population
    for (let f = 0; f < FLOORS; f++) {
      ctx.fillStyle = '#334'
      ctx.fillText(`${FLOORS - f}F`, gx, gy + f * gh + gh / 2)
      for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
        const x = gx + 28 + r * gw, y = gy + f * gh
        const isOccupied = occupied > 0
        if (isOccupied) occupied--
        ctx.strokeStyle = isOccupied ? '#7ec8ff' : '#2a2f45'
        ctx.strokeRect(x + 4, y + 6, gw - 12, gh - 14)
        if (isOccupied) {
          ctx.fillStyle = '#7ec8ff33'
          ctx.fillRect(x + 4, y + 6, gw - 12, gh - 14)
          ctx.fillStyle = '#cfe8ff'
          ctx.font = '12px sans-serif'
          ctx.fillText('住', x + gw / 2 - 6, y + gh / 2 + 4)
        }
      }
    }

    // 物资雨占位动画（天亮收租，标志性瞬间的白盒表达）
    if (rain) {
      ctx.fillStyle = '#ffd700'
      for (let i = 0; i < 24; i++) {
        const seed = (i * 97 + frame.day * 31) % 1000 / 1000
        const x = 30 + seed * (W - 70)
        const y = ((rainT * H * 1.4 + seed * 300) % (H * 0.9))
        ctx.fillRect(x, y, 10, 16)
      }
      ctx.fillStyle = '#ffd700'
      ctx.font = 'bold 26px sans-serif'
      ctx.fillText(`+${frame.income} 物资雨`, W / 2 - 70, H / 2)
    }

    // 夜战结果面板
    ctx.fillStyle = '#889'
    ctx.font = '13px sans-serif'
    ctx.fillText(`夜战: r均=${frame.rAvg} 死亡${frame.deaths} 负伤${frame.wounds} ${frame.modifiers.includes('BLOOD_MOON') ? '[血月]' : ''} hash=${frame.sessionHash}`, 16, H - 46)
    ctx.fillText(`恐慌总量 ${frame.panicSum} · 平均等级 ${frame.avgLevel}`, 16, H - 26)
  }
}

/** 帧率采样报告（性能预算冒烟：中端机 ≥30fps，白盒预算 ≥50fps） */
export function fpsReport(samples: number[]): { min: number; avg: number; budgetOk: boolean } {
  const min = samples.length ? Math.min(...samples) : 0
  const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0
  return { min, avg, budgetOk: min >= 50 }
}
