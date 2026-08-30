// M2 白盒渲染入口：播放 7 天模拟（D0–D7 体验），驱动白盒渲染器 + 帧率采样。
// 打包：npx esbuild whitebox/entry.ts --bundle --outfile=whitebox/bundle.js
import { loadApp } from '../../headless/src/main.ts'
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { buildBundle, runSimulation } from '../../headless/src/main.ts'
import { WhiteboxRenderer, fpsReport, type DayFrame } from './renderer.ts'

const app = loadApp()
const kernel = createKernel({ appName: 'nl-whitebox', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
await kernel.boot(buildBundle(app))

const sim = runSimulation(app, kernel, { days: 7, seed: 42 })
const frames: DayFrame[] = sim.records.map(r => {
  const row = app.tables.dayCurve.rows.find(x => x.day === r.day)!
  const plan = sim.sessions[r.day]
  return {
    day: r.day, population: r.population, roomsBuilt: Math.min(30, r.population + 2),
    gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
    deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
    modifiers: (plan?.modifiers as string[]) ?? [],
    avgLevel: r.avgLevel, panicSum: r.panicSum
  }
})

const canvas = document.getElementById('stage') as HTMLCanvasElement
canvas.width = 400
canvas.height = 720
const renderer = new WhiteboxRenderer(canvas, {
  onFps(fps, min, avg) {
    const el = document.getElementById('fps')!
    el.textContent = `FPS ${fps}（min ${min} / avg ${avg}）预算${min >= 50 ? '达标' : '未达标'}`
    el.style.color = min >= 50 ? '#7fff9f' : '#ffb0b0'
  }
})
let idx = 0
renderer.start(() => {
  if (idx >= frames.length) idx = 0 // 循环播放 D0–D7
  return frames[idx]
}, 1600)

// 帧率报告导出（性能预算冒烟证据）
void fpsReport
;(window as unknown as { __fpsReport(): unknown }).__fpsReport = () => fpsReport(
  (window as unknown as { __fpsSamples?: number[] }).__fpsSamples ?? []
)
void idx
