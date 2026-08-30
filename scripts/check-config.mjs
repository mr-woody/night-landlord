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
const REQUIRED = ['CFG_R0','CFG_G_U','CFG_G_T','CFG_HP0','CFG_J_BM','CFG_K_POWER','CFG_ECPM','CFG_QUALITY_MUL_N','CFG_QUALITY_MUL_R','CFG_QUALITY_MUL_SR','CFG_QUALITY_MUL_SSR','PANIC_MAX','PANIC_ESCAPE_AT','PANIC_ESCAPE_P','PANIC_DECAY','PANIC_PROP_FLOOR','PANIC_MEAN_PENALTY_AT','PANIC_MEAN_PENALTY','TUTORIAL_PANIC_CAP','GUARD_DEATH_DAY','GUARD_DEATH_30D','STAB_J_ADJUST_MIN','STAB_J_ADJUST_MAX','M1_RECRUIT_GOLD','M1_ROOM_GOLD','EXPLORE_STAMINA_MAX','EXPLORE_STAMINA_COST_BASE','EXPLORE_TIME_BASE','EXPLORE_NIGHT_DANGER_MUL','EXPLORE_YIELD_TARGET_D8','EXPLORE_YIELD_TARGET_D30','WILDLIFE_FIGHT_WIN_BASE','EXPLORE_PARTY_MAX']
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
check(scripted.length === 10, `event_lib scripted 应为 10 条（8 教学+2 楼栋解锁），实际 ${scripted.length}`)
check(ev.entries.length === 62, `event_lib 总数应为 62（50+世界组10+楼栋解锁2），实际 ${ev.entries.length}`)
const wd = ev.entries.filter(e => e.id.startsWith('evt_wd_'))
const ind = ev.entries.filter(e => e.id.startsWith('evt_in_'))
check(wd.length === 6, `evt_wd_* 应 6 条，实际 ${wd.length}`)
check(ind.length === 4, `evt_in_* 应 4 条，实际 ${ind.length}`)
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
const houses = bd.entries.filter(b => b.type === 'house').sort((a, b) => a.level - b.level)
check(houses.length === 6, `building_def 房屋进化应 6 级，实际 ${houses.length}`)
houses.forEach((h, i) => {
  check(h.level === i, `house Lv${h.level} 应连续（${i}）`)
  const dur = h.durability ?? 0
  check(i === 0 ? dur === 0.8 : dur > houses[i - 1].durability, `house Lv${h.level} 耐久系数未递增`)
})
check((houses[0].durability ?? 0) === 0.8 && (houses[5].durability ?? 0) === 1.5, 'house 耐久端点应为 0.8/1.5')
const room = bd.entries.find(b => b.type === 'room')
check(room && room.slots && room.slots.tenant === 1, 'room 应含 tenant×1 槽位')

// ---- 世界空间四表（v2.0，docs/数据配置表结构设计.md §9；世界观与空间结构设计 v1.0）----
const RESOURCES_W = ['food', 'water', 'material', 'ammo', 'gold', 'talentStone']
const md = load('map_def.json')
const lotIds = new Set(), zoneIds = new Set(), posSeen = new Set()
md.entries.forEach(e => {
  check(['lot', 'zone'].includes(e.kind), `map_def ${e.id} kind 非法`)
  check(!posSeen.has(`${e.pos.x},${e.pos.y}`), `map_def ${e.id} pos 与他人重叠`)
  posSeen.add(`${e.pos.x},${e.pos.y}`)
  if (e.kind === 'lot') {
    lotIds.add(e.id)
    if (e.building) {
      check(e.building.floors === 6 && e.building.roomsPerFloor === 5, `map_def ${e.id} 楼层结构应为 6×5`)
    }
  } else {
    zoneIds.add(e.id)
    check(['low', 'mid', 'high'].includes(e.danger), `map_def ${e.id} danger 非法`)
    check(e.travelTime >= 5, `map_def ${e.id} travelTime 过小`)
  }
})
const blds = md.entries.filter(e => e.id.startsWith('lot_bld_'))
check(blds.length === 3, `map_def 住宅楼应 3 栋，实际 ${blds.length}`)
check(md.entries.find(e => e.id === 'lot_bld_a')?.unlockDay === 1, 'A 栋 unlockDay 应为 1（开局主体）')
check(md.entries.find(e => e.id === 'lot_bld_b')?.unlockDay === 30, 'B 栋 unlockDay 应为 30（M0 D30 锚点）')
for (const z of ['zn_forest_edge', 'zn_deep_forest', 'zn_ruins', 'zn_farm']) {
  check(zoneIds.has(z), `map_def 缺少野外区域 ${z}`)
}

const gt = load('gather_table.json')
const RES_W = ['food', 'water', 'material', 'ammo', 'gold', 'talentStone']
const gByZone = {}
gt.entries.forEach(g => {
  check(RES_W.includes(g.resource), `gather_table ${g.id} resource 非法`)
  check(g.yieldMin >= 0 && g.yieldMin <= g.yieldMax, `gather_table ${g.id} 产出区间非法`)
  check(zoneIds.has(g.zone), `gather_table ${g.id} zone 引用不存在`)
  check(g.respawnDays >= 1 && g.respawnDays <= 7, `gather_table ${g.id} respawnDays 越界`)
  ;(gByZone[g.zone] ??= []).push(g)
})
for (const z of zoneIds) check((gByZone[z]?.length ?? 0) >= 2, `gather_table 区域 ${z} 采集点不足 2`)

const wl = load('wildlife.json')
const wlIds = new Set()
wl.entries.forEach(w => {
  check(!wlIds.has(w.id), `wildlife 重复 id ${w.id}`)
  wlIds.add(w.id)
  check(['prey', 'danger'].includes(w.kind), `wildlife ${w.id} kind 非法`)
  check(w.hp > 0, `wildlife ${w.id} hp 非法`)
  if (w.kind === 'prey') w.drops.forEach(d => check(d.resource === 'food', `wildlife 猎物 ${w.id} drops 应为食物类`))
  else check(w.threat > 0 && w.zones.length > 0, `wildlife 危险野物 ${w.id} 缺威胁/区域`)
  w.zones.forEach(z => check(zoneIds.has(z), `wildlife ${w.id} zone 引用不存在`))
})
check(wl.entries.find(w => w.id === 'w_boar')?.unlockDay >= 5, '野猪 unlockDay 应 ≥5（前期温和）')

const ed = load('explore_def.json')
const staminaMax = cs.entries.find(e => e.key === 'EXPLORE_STAMINA_MAX')?.value
check(ed.entries.length === 4, `explore_def 应 4 条（每 zone 一条），实际 ${ed.entries.length}`)
ed.entries.forEach(e => {
  check(zoneIds.has(e.zone), `explore_def ${e.id} zone 引用不存在`)
  check(e.staminaCost <= staminaMax, `explore_def ${e.id} 体力消耗超上限`)
  check(e.partyMax >= 1 && e.partyMax <= 3, `explore_def ${e.id} partyMax 越界`)
  check((gByZone[e.zone]?.length ?? 0) >= e.gatherSlots, `explore_def ${e.id} gatherSlots 超出该区域采集点`)
  e.wildlifePool.forEach(w => check(wlIds.has(w), `explore_def ${e.id} 野物引用不存在：${w}`))
  e.eventPool.forEach(ev => check(ev.startsWith('evt_wd_'), `explore_def ${e.id} 事件池须为 evt_wd_* 组`))
})


// ---- weather（v2.1 天气引擎，战斗演出与天气系统设计 §3）----
const theme = JSON.parse(readFileSync(join(root, 'config/theme.json'), 'utf8'))
const tintKeys = new Set(Object.keys(theme.color))
const wx = load('weather.json')
const WX_IDS = ['sunny', 'overcast', 'rain', 'foggy', 'snowy', 'blood_dust']
const wxIds = new Set()
wx.entries.forEach((w, i) => {
  check(wxIds.has(w.id) === false, `weather 重复 id ${w.id}`)
  wxIds.add(w.id)
  check(WX_IDS.includes(w.id), `weather ${w.id} 非白名单 id`)
  check(typeof w.lightMul === 'number' && w.lightMul >= 0.5 && w.lightMul <= 1.05, `weather ${w.id} lightMul 越界`)
  check(tintKeys.has(w.tintKey), `weather ${w.id} tintKey 不在 theme 色板键内`)
  check(['mild', 'cold', 'hot', 'freeze'].includes(w.temp), `weather ${w.id} temp 非法`)
  check(['low', 'mid', 'high', 'satur'].includes(w.humidity), `weather ${w.id} humidity 非法`)
  check(['none', 'rain', 'snow', 'fog', 'dust'].includes(w.particles), `weather ${w.id} particles 非法`)
  check(w.gatherMul >= 0.4 && w.gatherMul <= 1.0, `weather ${w.id} gatherMul 越界`)
  check(w.encounterMul >= 0.8 && w.encounterMul <= 2.5, `weather ${w.id} encounterMul 越界`)
  check(w.weightBase >= 0 && w.weightAfter >= 0, `weather ${w.id} 权重负值`)
})
for (const id of WX_IDS) check(wxIds.has(id), `weather 缺 ${id}`)
check(wx.entries.find(w => w.id === 'sunny')?.gatherMul === 1.0, 'sunny 应为基准 gatherMul=1.0')
const bdust = wx.entries.find(w => w.id === 'blood_dust')
check(bdust.exploreDisabled === true, 'blood_dust 应禁用探索（血月尘暴）')
check(bdust.unlockDay === 7, 'blood_dust unlockDay 应=7（首个血月日）')

if (failures.length) {
  console.error(`check-config：${failures.length} 项失败`)
  failures.forEach(f => console.error('  ✗ ' + f))
  process.exit(1)
}
console.log('check-config：基础表全部通过（day_curve 31 行 / constants 全键 / monster 7 / iap 8 / event_lib 62=scripted10+48 / building_def）')
console.log(`check-config：世界空间四表通过（map_def ${md.entries.length} / explore_def ${ed.entries.length} / gather_table ${gt.entries.length} / wildlife ${wl.entries.length}）`)
console.log(`check-config：天气表通过（weather ${wx.entries.length}）+ 房屋进化 6 级`)
