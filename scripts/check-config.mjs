#!/usr/bin/env node
// 功能点2 质量门：六张配置表校验（docs/数据配置表结构设计 断言的零依赖实现）。
// 退出码：0=全过；1=存在失败（打印每条失败原因）。
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const load = (n) => JSON.parse(readFileSync(join(root, 'config', n), 'utf8'))

const failures = []
const check = (cond, msg) => { if (!cond) failures.push(msg) }

// ---- day_curve ----
const dc = load('day_curve.json')
const rows = dc.rows
check(rows.length === 31, `day_curve 行数应为 31，实际 ${rows.length}`)
check(JSON.stringify(dc.bloodMoonDays) === '[7,14,21,28]', 'bloodMoonDays 应为 [7,14,21,28]')
rows.forEach((r, i) => {
  check(r.day === i, `day_curve 行 ${i}：day 字段应为 ${i}`)
  check(r.population >= 3 && r.population <= 30, `D${r.day} population 越界`)
  const isBM = dc.bloodMoonDays.includes(r.day)
  check(r.routes === Math.min(1 + Math.floor(r.day / 4), 5) + (isBM ? 1 : 0), `D${r.day} 路数不符公式`)
  check(Math.abs(r.threat - r.hp * r.routes) <= r.routes, `D${r.day} threat 与 hp×routes 偏差超舍入容差`)
  check(Math.abs(r.fReq - r.rTarget * r.threat) <= 2, `D${r.day} fReq 与 rTarget×threat 偏差超舍入容差`)
  check(r.deaths === 0 || r.deaths === 1, `D${r.day} deaths 越界`)
  check(r.ads >= 0 && r.ads <= 6, `D${r.day} ads 越界`)
  if (i > 0) {
    const prev = rows[i - 1]
    const q = r.population * 100 * r.q * r.u
    check(Math.abs(r.income - q) / r.income <= 0.01, `D${r.day} income 与 P×R0×q×u 偏差 >1%（q/u 两位小数舍入容差）`)
    if (!isBM) {
      const prevRaw = dc.bloodMoonDays.includes(prev.day) ? prev.hp / 1.6 : prev.hp
      check(Math.abs(r.hp - Math.round(prevRaw * 1.15)) <= 1, `D${r.day} hp ≠ round(prev×1.15)`)
    }
  }
})
check(rows[7].hp === Math.round((rows[6].hp * 1.15) * 1.6), 'D7 血月 hp ≠ round(prev×1.15×1.6)')

// ---- constants ----
const cs = load('constants.json')
const REQUIRED = ['CFG_R0','CFG_G_U','CFG_G_T','CFG_HP0','CFG_J_BM','CFG_K_POWER','CFG_ECPM','CFG_QUALITY_MUL_N','CFG_QUALITY_MUL_R','CFG_QUALITY_MUL_SR','CFG_QUALITY_MUL_SSR','PANIC_MAX','PANIC_ESCAPE_AT','PANIC_ESCAPE_P','PANIC_DECAY','PANIC_PROP_FLOOR','PANIC_MEAN_PENALTY_AT','PANIC_MEAN_PENALTY','TUTORIAL_PANIC_CAP','GUARD_DEATH_DAY','GUARD_DEATH_30D','STAB_J_ADJUST_MIN','STAB_J_ADJUST_MAX','M1_RECRUIT_GOLD','M1_ROOM_GOLD']
const keys = new Set(cs.entries.map(e => e.key))
for (const k of REQUIRED) check(keys.has(k), `constants 缺少必含键 ${k}`)
check(cs.entries.length === keys.size, 'constants 存在重复 key')
cs.entries.forEach(e => {
  check(typeof e.value === 'number' && e.value >= e.min && e.value <= e.max, `constants ${e.key} 越出安全区间 [${e.min},${e.max}]`)
  check(typeof e.desc === 'string' && e.desc.length > 0, `constants ${e.key} 缺 desc`)
})

// ---- monster ----
const ms = load('monster.json')
const tiers = new Set(['minion', 'elite', 'boss'])
ms.entries.forEach((m, i) => {
  check(tiers.has(m.tier), `monster ${m.id} tier 非法`)
  if (i > 0) check(m.unlockDay >= ms.entries[i - 1].unlockDay, `monster ${m.id} unlockDay 未升序`)
  check(typeof m.active === 'boolean', `monster ${m.id} 缺 active`)
})
check(ms.entries.filter(m => m.tier === 'boss').length === 1, 'monster 应恰有 1 个 boss')

// ---- iap_sku ----
const sku = load('iap_sku.json')
const skuTypes = new Set(['firstCharge', 'pack', 'pass', 'monthly', 'gacha'])
sku.entries.forEach(s => {
  check(skuTypes.has(s.type), `iap ${s.id} type 非法`)
  check(typeof s.price === 'number' && s.price > 0, `iap ${s.id} price 非法`)
  s.contents.forEach(op => check(!['KILL_TENANT'].includes(op.op), `iap ${s.id} contents 含禁用效果`))
})
check(sku.entries.filter(s => s.type === 'firstCharge').length === 1, 'firstCharge 应唯一')

// ---- event_lib（M1 首版：scripted 组 8 条）----
const ev = load('event_lib.json')
const scripted = ev.entries.filter(e => e.type === 'scripted')
check(scripted.length === 8, `event_lib scripted 应为 8 条，实际 ${scripted.length}`)
check(ev.entries.length === 50, `event_lib 总数应为 50，实际 ${ev.entries.length}`)
check(ev.entries.every(e => e.weight >= 0 && e.cooldownDays >= 0), 'event_lib weight/cooldown 越界')
const ids = new Set(ev.entries.map(e => e.id))
check(ids.size === ev.entries.length, 'event_lib 存在重复 id')
ev.entries.forEach(e => {
  e.options.forEach(o => o.outcomes.forEach(oc => {
    const sum = o.outcomes.reduce((a, b) => a + b.p, 0)
    check(Math.abs(sum - 1) < 0.001, `event ${e.id} outcome 概率合计 ≠1`)
    oc.effects.forEach(op => {
      check(op.op !== 'KILL_TENANT', `event ${e.id} 含禁用 KILL_TENANT`)
      if (op.op === 'ADD_PANIC') check(Math.abs(op.n) <= 25, `event ${e.id} ADD_PANIC 超 25`)
      if (op.op === 'ADD_GOLD') check(op.n <= 3000, `event ${e.id} ADD_GOLD 超 3000`)
    })
  }))
})

// ---- building_def ----
const bd = load('building_def.json')
const canteen = bd.entries.filter(b => b.type === 'canteen')
canteen.forEach((b, i) => {
  check(typeof b.capacity === 'number', `canteen lv${b.level} 缺 capacity`)
  if (i > 0) check(b.capacity > canteen[i - 1].capacity, 'canteen capacity 未升序')
})
check(canteen[canteen.length - 1].capacity >= 30, 'canteen 顶级容量须 ≥30（D30 满层锚点）')
const room = bd.entries.find(b => b.type === 'room')
check(room && room.slots && room.slots.tenant === 1, 'room 应含 tenant×1 槽位')

if (failures.length) {
  console.error(`check-config：${failures.length} 项失败`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log('check-config：六张表全部通过（day_curve 31 行 / constants 全键 / monster 7 / iap 8 / event_lib scripted 8 / building_def）')
