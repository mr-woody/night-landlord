// M2.5 白盒渲染入口（浏览器运行，无 node:fs）：播放 7 天模拟（D0–D7 体验），
// 驱动白盒渲染器 + rAF 帧率采样。视觉参数全部经 theme.ts 取 tokens。
// 打包：npm run build:whitebox（esbuild → whitebox/bundle.js）
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'
import { buildBundle, runSimulation, type AppContext } from '../../../apps/headless/src/sim.ts'
import dayCurveJson from '../../../config/day_curve.json'
import constantsJson from '../../../config/constants.json'
import buildingDefJson from '../../../config/building_def.json'
import eventLibJson from '../../../config/event_lib.json'
import monstersJson from '../../../config/monster.json'
import { WhiteboxRenderer, type DayFrame } from './renderer.ts'
import { col, T } from './theme.ts'

const tables = {
  dayCurve: dayCurveJson,
  constants: constantsJson,
  buildingDef: buildingDefJson
}
const app: AppContext = {
  tables,
  formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
  constants: loadConstants(tables.constants.entries),
  eventLib: eventLibJson as unknown as AppContext['eventLib'], // JSON 宽类型收窄（type 字面量联合）
  monsters: monstersJson
}

const kernel = createKernel({ appName: 'nl-whitebox', clock: { logicalDay: () => 0, wallMs: () => Date.now() } })
kernel.register([])
const boot = kernel.boot(buildBundle(app))

const canvas = document.getElementById('stage') as HTMLCanvasElement
canvas.width = 400
canvas.height = 720
const renderer = new WhiteboxRenderer(canvas, {
  onFps(fps, min, avg) {
    const el = document.getElementById('fps')!
    el.textContent = `FPS ${fps}（min ${min} / avg ${avg}）预算${min >= 50 ? '达标' : '未达标'}`
    el.style.color = min >= 50 ? col('success') : col('danger')
  }
})

const DAY_MS = T.motion.dissolve.dur * 2 // 天回放节奏占位 = 2×dissolve(1.6s)；P3 四相状态机接管真实节奏
let idx = 0
boot.then(() => {
  const sim = runSimulation(app, kernel, { days: 7, seed: 42 })
  const frames: DayFrame[] = sim.records.map(r => {
    return {
      day: r.day, population: r.population, roomsBuilt: r.roomsBuilt,
      gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
      deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
      modifiers: r.modifiers, avgLevel: r.avgLevel, panicSum: r.panicSum
    }
  })
  renderer.start(() => {
    if (idx >= frames.length) idx = 0 // 循环播放 D0–D7
    return frames[idx]
  }, DAY_MS)
  console.log(`白盒播放就绪：${frames.length} 天，事件 ${sim.eventsFired} 次，独立 ${sim.distinctFired.length}`)
})
