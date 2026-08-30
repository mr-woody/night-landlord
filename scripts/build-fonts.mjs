#!/usr/bin/env node
// M2.6 视觉升级：字体子集化——思源黑体 Bold（Noto Sans SC）按 UI 实际用字子集化 + Bebas Neue 数字字。
// 输出 whitebox/fonts/*.woff2（@font-face 族名与 theme.json typography tokens 一致，
// 渲染器 font() 自动命中）。前置：python3 -m pip install --user fonttools brotli。
// 重跑稳定：字符集=ASCII 可打印 + CJK 常用标点 + event_lib 全部字符串 + 白盒 UI 文案清单。
// 源字体下载（*.otf 不入 git）：
//   NotoSansSC-Bold.otf  ← https://raw.githubusercontent.com/notofonts/noto-cjk/main/Sans/SubsetOTF/SC/NotoSansSC-Bold.otf
//   BebasNeue-Regular.ttf ← https://github.com/google/fonts/raw/main/ofl/bebasneue/BebasNeue-Regular.ttf
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fontsDir = join(root, 'apps/client-cocos/whitebox/fonts')

// ---- 字符集收集 ----
const chars = new Set()
for (let c = 0x20; c <= 0x7e; c++) chars.add(String.fromCharCode(c)) // ASCII 可打印
for (const c of '。·「」『』！？：；、，（）—…％％＋－×÷℃°①②③④⑤⑥⑦⑧⑨⑩★☆⚠▶◀✓✗🔒🎁🧟🧑🛏⚙🌙🔴💊🛡😱👥⚔🪙') chars.add(c)
// 事件库全部字符串（标题/正文/选项/结果文案）
const ev = JSON.parse(readFileSync(join(root, 'config/event_lib.json'), 'utf8'))
const collect = v => {
  if (typeof v === 'string') for (const c of v) chars.add(c)
  else if (Array.isArray(v)) v.forEach(collect)
  else if (v && typeof v === 'object') Object.values(v).forEach(collect)
}
collect(ev)
// 白盒 UI 文案清单（renderer/layout/state/fragment 用字）
const uiTexts = [
  '日次入夜预告血月常规夜袭静默之夜情报缺失怪物迁移开战重排布防招募升级设置',
  '天亮收租结算继续昨夜战报死亡负伤恐慌总量今日事件静谧无事件仓库鼠患粮成麻袋上全是齿印了窝',
  '占位面板接入对应系统操作确认入夜后不可打断全屏关闭稍后已选择执行稍后结果审计流图鉴商店',
  '未解锁循声者音乐音效推送通知存档三检查点黄昏夜间恢复占用破防大厅医务瞭望塔',
  '资源图标空投物资护盾使用主动技占位演出新住户入住获得住户升级金币恐慌首充双倍礼包卡',
  '补给石价格删除线锚点现价库存页横滑列网格剪影锁楼栋剖面住户怪物头雨帧',
  '预算达标采样 FPS 分钟平均数人口战力金币'
]
for (const s of uiTexts) for (const c of s) chars.add(c)
const text = [...chars].sort().join('')
writeFileSync(join(fontsDir, 'charset.txt'), text)

// ---- pyftsubset ----
const subset = (src, out, extra) => {
  if (!existsSync(src)) { console.error(`缺少源字体 ${src}（先按 README 下载）`); process.exit(1) }
  execSync(`python3 -m fontTools.subset "${src}" --text-file="${join(fontsDir, 'charset.txt')}" --flavor=woff2 --layout-features='*' --output-file="${out}" ${extra ?? ''}`, { stdio: 'inherit' })
}
subset(join(fontsDir, 'NotoSansSC-Bold.otf'), join(fontsDir, 'SourceHanSansCN-Bold.subset.woff2'))
subset(join(fontsDir, 'BebasNeue-Regular.ttf'), join(fontsDir, 'BebasNeue.subset.woff2'), '--unicodes=U+0020-007E')

for (const f of ['SourceHanSansCN-Bold.subset.woff2', 'BebasNeue.subset.woff2']) {
  const kb = Math.round(readFileSync(join(fontsDir, f)).length / 1024)
  console.log(`${f}: ${kb}KB`)
}
console.log('字符集大小:', chars.size)
