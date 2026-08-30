#!/usr/bin/env node
// M2 功能点2：event_lib 补全 50 条断言（P2 入库后启用全量校验）
// 用法：node scripts/check-event-lib.mjs —— 校验 50 条/p 合计/KILL 禁用/频控域
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const lib = JSON.parse(readFileSync(join(root, 'config/event_lib.json'), 'utf8'))
const entries = lib.entries
const fails = []
const check = (c, m) => { if (!c) fails.push(m) }

check(entries.length === 50, `条目应为 50，实际 ${entries.length}`)
const scripted = entries.filter(e => e.type === 'scripted')
check(scripted.length === 8, `scripted 应为 8，实际 ${scripted.length}`)
check(entries.filter(e => e.type === 'choice').length === 32 + 10, `choice+mission 数量异常`)
for (const e of entries) {
  check(!!e.id && !!e.title, `${e.id || '?'} 缺 id/title`)
  if (e.type !== 'scripted') {
    check(e.weight >= 1 && e.weight <= 100, `${e.id} weight 越界`)
    check(e.cooldownDays >= 1 && e.cooldownDays <= 14, `${e.id} cooldown 越界`)
  }
  for (const o of e.options) {
    const sum = o.outcomes.reduce((a, x) => a + x.p, 0)
    check(Math.abs(sum - 1) < 0.001, `${e.id} outcome p 合计 ${sum} ≠1`)
    for (const oc of o.outcomes) {
      for (const f of oc.effects) {
        check(f.op !== 'KILL_TENANT', `${e.id} 含禁用 KILL_TENANT`)
        if (f.op === 'ADD_PANIC') check(Math.abs(f.n) <= 25, `${e.id} ADD_PANIC 超 25`)
        if (f.op === 'ADD_GOLD') check(Math.abs(f.n) <= 3000, `${e.id} ADD_GOLD 超 3000`)
      }
    }
  }
}
if (fails.length) { fails.forEach(f => console.error('  ✗ ' + f)); process.exit(1) }
console.log('check-event-lib：50 条全量校验通过')
