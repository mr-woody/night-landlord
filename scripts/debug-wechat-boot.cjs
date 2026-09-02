// 真机卡首屏问题的本地模拟器复现器：自动化打开 DevTools，捕获 console 与启动状态。
// 用法：node scripts/debug-wechat-boot.mjs [--timeout 20000]
const automator = require('miniprogram-automator')
const { resolve, dirname } = require('node:path')
const { existsSync, readFileSync } = require('node:fs')

const root = resolve(__dirname, '..')
const WX = resolve(root, 'apps/client-cocos/creator/build/wechatgame')
const CLI = '/Applications/wechatwebdevtools.app/Contents/MacOS/cli'
const timeout = parseInt(process.argv.includes('--timeout') ? process.argv[process.argv.indexOf('--timeout') + 1] : '25000', 10)

async function main () {
  console.log('[boot-debug] launching DevTools automation…')
  const miniProgram = await automator.launch({
    cliPath: CLI,
    projectPath: WX,
    port: 9421,
    timeout: 60000
  })
  const logs = []
  miniProgram.on('console', msg => { logs.push(`[${msg.type}] ${msg.args.map(a => typeof a === 'object' ? JSON.stringify(a).slice(0, 300) : String(a).slice(0, 300)).join(' ')}`) })
  miniProgram.on('exception', err => { logs.push(`[exception] ${err.message} ${err.stack ? err.stack.slice(0, 300) : ''}`) })
  await new Promise(r => setTimeout(r, timeout))
  console.log(`[boot-debug] captured ${logs.length} console messages within ${timeout}ms:`)
  logs.forEach(l => console.log('  ' + l))
  // 采样启动状态：引擎全局/分包状态/画布存在性
  try {
    const probe = await miniProgram.evaluate(() => {
      const g = GameGlobal || globalThis
      return {
        hasCC: !!(g.cc || (g.window && g.window.cc)),
        canvas: !!(g.canvas),
        firstScreenDone: !!g.__nlFirstScreenDone,
        loadSubPkgErr: g.__nlSubPkgErr || null
      }
    })
    console.log('[boot-debug] probe:', JSON.stringify(probe))
  } catch (e) {
    console.log('[boot-debug] probe failed:', e.message)
  }
  try { await miniProgram.close() } catch {}
  process.exit(0)
}
main().catch(e => { console.error('[boot-debug] launch failed:', e.message); process.exit(1) })
