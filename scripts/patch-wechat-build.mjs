#!/usr/bin/env node
// 上线清单 1.2/1.3：微信构建产物后处理（幂等，Creator 重新构建后重跑即可恢复）。
// ① project.config.json appid 单点替换（小游戏类目 appid，命令行 --appid 可覆盖）
// ② game.json 声明 cocos-js 引擎分包（主包 ≤4MB 红线 NFR-7，规避 DevTools 80051）
// ③ game.js 注入 wx.loadSubpackage 包装（引擎经 System.import('cc') 按需加载，分包先加载）
// ④ cocos-js/game.js 分包入口文件（小游戏分包规则：分包根必须有 game.js）
// 用法：node scripts/patch-wechat-build.mjs [--appid wxXXXXXXXX]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const wxRoot = join(root, 'apps/client-cocos/creator/build/wechatgame')
const argv = process.argv.slice(2)
const appidArg = argv.includes('--appid') ? argv[argv.indexOf('--appid') + 1] : undefined
const APPID = appidArg ?? 'wx1d1c21f543892aa7' // 小游戏类目 appid（2026-08-31 提供并经 preview 实证）

if (!existsSync(wxRoot)) {
  console.error('patch-wechat-build：未找到构建产物 apps/client-cocos/creator/build/wechatgame（先执行 Creator 构建）')
  process.exit(1)
}

const changes = []

// ① appid
const pcfgPath = join(wxRoot, 'project.config.json')
if (existsSync(pcfgPath)) {
  const pcfg = JSON.parse(readFileSync(pcfgPath, 'utf8'))
  if (pcfg.appid !== APPID) {
    pcfg.appid = APPID
    writeFileSync(pcfgPath, JSON.stringify(pcfg, null, 2) + '\n')
    changes.push(`project.config.json appid → ${APPID}`)
  }
}

// ② game.json 分包声明
const gameJsonPath = join(wxRoot, 'game.json')
const gameJson = JSON.parse(readFileSync(gameJsonPath, 'utf8'))
const SUB = [{ root: 'cocos-js', name: 'engine' }]
if (JSON.stringify(gameJson.subpackages ?? []) !== JSON.stringify(SUB)) {
  gameJson.subpackages = SUB
  writeFileSync(gameJsonPath, JSON.stringify(gameJson, null, 4))
  changes.push('game.json subpackages += cocos-js(engine)')
}

// ③ game.js 分包加载包装（幂等：已含 loadSubpackage 则跳过）
const gameJsPath = join(wxRoot, 'game.js')
const WRAP_ANCHOR = 'function onApplicationCreated(application) {'
const WRAP_CODE = `function onApplicationCreated(application) {
    // 引擎分包（cocos-js → subpackage "engine"）：主包 ≤4MB 红线（NFR-7/上线清单 1.3）。
    // 引擎仅在启动链此处经 System.import('cc') 使用，分包加载完成后再进入引擎导入。
    return new Promise(function (resolve, reject) {
        wx.loadSubpackage({
            root: 'cocos-js',
            success: function () { resolve(); },
            fail: function (err) { reject(new Error('loadSubpackage cocos-js failed: ' + JSON.stringify(err))); }
        });
    }).then(function () {
        return System.import('cc')`
if (existsSync(gameJsPath) && !readFileSync(gameJsPath, 'utf8').includes('loadSubpackage')) {
  const js = readFileSync(gameJsPath, 'utf8')
  if (js.includes(WRAP_ANCHOR)) {
    const patched = js.replace(
      WRAP_ANCHOR + "\n    return System.import('cc')",
      WRAP_CODE
    )
    if (patched !== js) {
      writeFileSync(gameJsPath, patched)
      changes.push('game.js += wx.loadSubpackage 包装')
    }
  }
}

// ④ 分包入口 game.js（小游戏分包规则：分包根必须有 game.js）
const subEntry = join(wxRoot, 'cocos-js/game.js')
if (existsSync(join(wxRoot, 'cocos-js')) && !existsSync(subEntry)) {
  writeFileSync(subEntry,
    '// cocos-js 引擎分包入口（Cocos Creator 3.8.8 separate-engine 模式）。\n' +
    "// 引擎由主包 game.js 在 wx.loadSubpackage 完成后经 System.import('cc') 加载。\n")
  changes.push('cocos-js/game.js 分包入口已创建')
}

console.log(changes.length ? 'patch-wechat-build：\n  - ' + changes.join('\n  - ') : 'patch-wechat-build：产物已是目标状态（幂等无变更）')
