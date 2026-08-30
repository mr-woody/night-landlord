// M1 白盒小游戏入口：证明共享逻辑包在微信小游戏环境可运行（验收门③）。
// 由 esbuild 打包为 game.js（CommonJS，微信小游戏运行时直接加载）。
import dayCurve from '../../../config/day_curve.json'
import constantsTable from '../../../config/constants.json'
import { createKernel } from '../../../packages/kernel/src/index.ts'
import { createFormula, loadConstants } from '../../../packages/formula/src/index.ts'

const kernel = createKernel({ appName: 'nl-minigame' })
kernel.register([])
void kernel.boot().then(() => {
  const formula = createFormula({
    dayCurve: dayCurve,
    constants: loadConstants(constantsTable.entries)
  })
  const G = globalThis as unknown as { console: { log(...args: unknown[]): void } }
  G.console.log('kernel boot ok', { day: kernel.clock.logicalDay() })
  G.console.log('income(D1)=', formula.row(1).income)
})
