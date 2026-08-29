import { createKernel } from './shared/kernel/index'

// M1 白盒样例：证明共享逻辑包在 Cocos 侧可导入与运行（验收门③ 第 4 步挂载脚本）。
// 真实场景渲染在 M2（竖屏剖面），本文件只做 kernel 冒烟。
const kernel = createKernel({ appName: 'nl-client' })
kernel.register([]) // M1 冒烟：空插件集；后续包同步后在此注册 diag/core-loop/formula/systems/battle/director。
kernel.boot()

// @ts-expect-error Cocos 组件装饰器仅存在于引擎环境，此处仅做存在性探测。
const hasCocos = typeof cc !== 'undefined'
console.log('kernel boot ok', { cocosEnv: hasCocos, day: kernel.clock.logicalDay() })
export { kernel }
