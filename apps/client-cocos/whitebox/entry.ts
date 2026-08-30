// M2 白盒渲染入口（浏览器运行，无 node:fs）：播放 7 天模拟（D0–D7 体验），
// 驱动白盒渲染器 + rAF 帧率采样。打包：npx esbuild whitebox/entry.ts --bundle --outfile=whitebox/bundle.js
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'
import { buildBundle, runSimulation, type AppContext } from '../../../apps/headless/src/sim.ts'
import dayCurveJson from '../../../config/day_curve.json'
import constantsJson from '../../../config/constants.json'
import buildingDefJson from '../../../config/building_def.json'
import eventLibJson from '../../../config/event_lib.json'
import monstersJson from '../../../config/monster.json'
import { WhiteboxRenderer, type DayFrame } from './renderer.ts'

const tables = {
  dayCurve: dayCurveJson,
  constants: constantsJson,
  buildingDef: buildingDefJson
}
const app: AppContext = {
  tables,
  formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
  constants: loadConstants(tables.constants.entries),
  eventLib: eventLibJson,
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
    el.style.color = min >= 50 ? '#7fff9f' : '#ffb0b0'
  }
})

let idx = 0
boot.then(() => {
  const sim = runSimulation(app, kernel, { days: 7, seed: 42 })
  const frames: DayFrame[] = sim.records.map(r => {
    const row = tables.dayCurve.rows.find(x => x.day === r.day)!
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
  }, 1600)
  console.log(`白盒播放就绪：${frames.length} 天，事件 ${sim.eventsFired} 次，独立 ${sim.distinctFired.length}`)
})
