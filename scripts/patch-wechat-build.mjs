#!/usr/bin/env node
// 上线清单 1.2/1.3：微信构建产物后处理（幂等，Creator 重新构建后重跑即可恢复）。
// ① project.config.json appid 单点替换（小游戏类目 appid，命令行 --appid 可覆盖）
// ② game.json 声明 cocos-js 引擎分包（主包 ≤4MB 红线 NFR-7，规避 DevTools 80051）
// ③ game.js 注入 wx.loadSubpackage 包装（引擎经 System.import('cc') 按需加载，分包先加载）
// ④ cocos-js/game.js 分包入口文件（小游戏分包规则：分包根必须有 game.js）
// 用法：node scripts/patch-wechat-build.mjs [--appid wxXXXXXXXX]
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync } from 'node:fs'
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

// ③ game.js：bootFail 诊断助手 + onApplicationCreated 整函数替换（含 loadSubpackage name/超时/catch）
//    ——整函数替换保证任意产物状态（未打补丁/半补丁/语法损坏）都收敛到规范实现。
const gameJsPath = join(wxRoot, 'game.js')
const BOOTFAIL_HELPER = `function bootFail (stage, err) {
    console.error('[boot]', stage, err);
    try {
        wx.showModal({
            title: '启动失败 · ' + stage,
            content: String((err && (err.message || err.errMsg)) || err).slice(0, 400),
            showCancel: false
        });
    } catch (e) { /* 显示失败时仅留 console */ }
}
`
const FULL_FUNCTION = `function onApplicationCreated(application) {
    // 引擎分包（cocos-js → subpackage "engine"）：主包 ≤4MB 红线（NFR-7/上线清单 1.3）。
    // 引擎仅在启动链此处经 System.import('cc') 使用，分包加载完成后再进入引擎导入。
    // 真机必填 name（errno 1001: parameter.name should be String）；30s 分包超时守卫。
    return new Promise(function (resolve, reject) {
        var settled = false
        var timer = setTimeout(function () {
            if (!settled) { settled = true; clearTimeout(timer); console.warn('[boot] loadSubpackage 30s 未回调，乐观放行'); resolve() }
        }, 30000)
        wx.loadSubpackage({
            root: 'cocos-js',
            name: 'engine',
            success: function () { if (!settled) { settled = true; clearTimeout(timer); resolve() } },
            fail: function (err) { if (!settled) { settled = true; clearTimeout(timer); reject(new Error('loadSubpackage fail: ' + JSON.stringify(err))) } }
        })
    }).then(function () {
        return System.import('cc').then((module) => {
            return firstScreen.setProgress(0.6).then(() => Promise.resolve(module));
        });
    }).then((cc) => {
        require('./engine-adapter');
        return application.init(cc);
    }).then(() => {
        return firstScreen.end().then(() => application.start());
    }).catch(function (err) {
        bootFail(String(err && err.message || err).includes('loadSubpackage') ? '分包加载' : '引擎导入', err);
    });
`
if (existsSync(gameJsPath)) {
  let js = readFileSync(gameJsPath, 'utf8')
  const anchor = 'function onApplicationCreated(application) {'
  let start = js.indexOf(anchor)
  if (start >= 0) {
    // bootFail 助手守卫插入（含 FULL_FUNCTION 内层，插入一次即被整函数替换吸收）
    if (!js.includes('function bootFail')) {
      js = js.slice(0, start) + BOOTFAIL_HELPER + js.slice(start)
      start = js.indexOf(anchor)
      changes.push('game.js：bootFail 诊断助手')
    }
    const end = js.indexOf('\n}', start) // 模板中该函数顶格闭合
    if (end >= 0) {
      const patched = js.slice(0, start) + FULL_FUNCTION + js.slice(end)
      if (patched !== js) {
        writeFileSync(gameJsPath, patched)
        changes.push('game.js：onApplicationCreated 整函数替换（分包加载/诊断）')
      }
    }
  }
}

// ④ AI sprite 资产打包（docs/assets/ai → wechatgame/sprites/ai，主包 1362+2015<4MB）
const srcAi = join(root, 'docs/assets/ai')
const dstAi = join(wxRoot, 'sprites/ai')
if (existsSync(srcAi)) {
  let n = 0
  const manifestPath = join(srcAi, 'sprite-manifest.json')
  const files = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')).files ?? []
    : []
  for (const f of files) {
    const from = join(srcAi, f)
    // @ 在 createImage src 的 URL 语义中是保留字符（userinfo 分隔符）→ 包内改名规避
    const to = join(dstAi, f.replace('@2x', '_2x'))
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
    n++
  }
  mkdirSync(dirname(join(dstAi, 'sprite-manifest.json')), { recursive: true })
  copyFileSync(manifestPath, join(dstAi, 'sprite-manifest.json'))
  changes.push(`sprites/ai 打包 ${n} 张`)
}

// ④b 分包入口 game.js（小游戏分包规则：分包根必须有 game.js）
const subEntry = join(wxRoot, 'cocos-js/game.js')
if (existsSync(join(wxRoot, 'cocos-js')) && !existsSync(subEntry)) {
  writeFileSync(subEntry,
    '// cocos-js 引擎分包入口（Cocos Creator 3.8.8 separate-engine 模式）。\n' +
    "// 引擎由主包 game.js 在 wx.loadSubpackage 完成后经 System.import('cc') 加载。\n")
  changes.push('cocos-js/game.js 分包入口已创建')
}

console.log(changes.length ? 'patch-wechat-build：\n  - ' + changes.join('\n  - ') : 'patch-wechat-build：产物已是目标状态（幂等无变更）')
