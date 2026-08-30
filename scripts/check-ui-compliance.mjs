#!/usr/bin/env node
// M2.5 功能点4 质量门：UI 合规扫描（可执行目标 §二.4 / 验收门⑤）。
// ① 热区 ≥88×88px：全部交互元素（dock/设置/夜战技能/返回/确认/继续/事件卡选项/页返回）
// ② 字号：渲染层 font(...) 一律取 typography tokens，出现字面数字 px 即 FAIL
// ③ 动效：motion('name') 引用的 token 名必须存在于 theme.json（防手误漂移）
// ④ 交互字号 ≥24：dock/按钮标签等交互文本引用的 token 字号下限校验（caption 仅限注记）
// 退出码：0=全过；1=存在违规。
import { readFileSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const { HIT_MIN, dockRects, settingsRect } = await import(join(root, 'apps/client-cocos/whitebox/layout.ts'))
const wb = await import(join(root, 'apps/client-cocos/whitebox/layout.ts'))
const { T } = await import(join(root, 'apps/client-cocos/whitebox/theme.ts'))

const failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }

// ---- ① 热区 ≥88×88 ----
const interactive = {
  dock: dockRects(),
  settings: [settingsRect()],
  nightSkills: wb.nightSkillRects(),
  nightBack: [wb.nightBackRect()],
  duskConfirm: [wb.duskConfirmRect()],
  settleContinue: [wb.settleContinueRect()],
  modalClose: [wb.modalCloseRect()],
  modalConfirm: [wb.modalConfirmRect()],
  modalOption: [wb.modalOptionRect()],
  pageBack: [wb.pageBackRect()]
}
for (const [name, rects] of Object.entries(interactive)) {
  for (const [i, r] of rects.entries()) {
    check(r.w >= HIT_MIN && r.h >= HIT_MIN, `热区 ${name}[${i}] ${r.w}×${r.h} 应 ≥${HIT_MIN}×${HIT_MIN}`)
  }
}

// ---- ② 字号字面量：renderer/anim 不得出现 font(数字px) ----
const rendererSrc = readFileSync(join(root, 'apps/client-cocos/whitebox/renderer.ts'), 'utf8')
for (const m of rendererSrc.matchAll(/font\(\s*(\d+)/g)) {
  failures.push(`renderer.ts: 字面数字字号 font(${m[1]}px)——必须引用 T.typography tokens`)
}

// ---- ③ motion token 名引用合法性 ----
for (const m of rendererSrc.matchAll(/motion\('([a-zA-Z]+)'\)/g)) {
  check(theme.motion[m[1]] !== undefined, `renderer.ts: motion('${m[1]}') 不在 theme.json motion 表内`)
}
for (const m of rendererSrc.matchAll(/motion\("([a-zA-Z]+)"\)/g)) {
  check(theme.motion[m[1]] !== undefined, `renderer.ts: motion("${m[1]}") 不在 theme.json motion 表内`)
}

// ---- ④ 交互文本字号 ≥24（正文字号红线，UI 规范 §一.3）----
// dock 标签与主行动按钮用 body(24)；typography tokens 本身须满足 body≥24
check(T.typography.body >= 24, `typography.body=${T.typography.body} 应 ≥24`)
check(T.typography.caption >= 18, `typography.caption=${T.typography.caption} 应 ≥18（注记级下限）`)

if (failures.length) {
  console.error(`check-ui-compliance：${failures.length} 项违规`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
const hotzoneCount = Object.values(interactive).flat().length
console.log(`check-ui-compliance：热区 ${hotzoneCount} 处 ≥${HIT_MIN}px ✓ 字号 tokens 化 ✓ motion 引用合法 ✓ 交互字号 ≥24 ✓`)
