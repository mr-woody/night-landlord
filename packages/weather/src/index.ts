// @rn/weather —— 天气引擎逻辑核心（M3.2 F3；战斗演出与天气系统设计 §3）。
// 确定性：weatherOfDay = createDayRng(seed,'weather',day) 加权抽取（同 seed 可复算）；
// 血月日（7/14/21/28）强制血月尘暴伴生；纯函数无副作用——模块影响以系数交给消费方
// （explore 采集/遭遇；渲染光照与粒子）。K-W1：夜战数值影响暂缓（ADR 评估中）。
import { createDayRng } from '@rn/core'

export interface WeatherEntry {
  id: string
  name: string
  lightMul: number
  tintKey: string
  temp: 'mild' | 'cold' | 'hot' | 'freeze'
  humidity: 'low' | 'mid' | 'high' | 'satur'
  particles: 'none' | 'rain' | 'snow' | 'fog' | 'dust'
  fog: boolean
  gatherMul: number
  encounterMul: number
  panicDecayMul: number
  foodConsumeMul: number
  weightBase: number
  weightAfter: number
  exploreDisabled: boolean
  unlockDay: number
}

export interface WeatherTables {
  weather: { entries: WeatherEntry[] }
}

export const BLOOD_MOON_DAYS = [7, 14, 21, 28]

/** 当日天气（确定性）：血月日强制尘暴；否则按天数段权重抽取（D8 起用 weightAfter） */
export function weatherOfDay(day: number, seed: number, tables: WeatherTables): WeatherEntry {
  if (BLOOD_MOON_DAYS.includes(day)) {
    return tables.weather.entries.find(e => e.id === 'blood_dust')!
  }
  const pool = tables.weather.entries.filter(e => !e.exploreDisabled && e.unlockDay <= day)
  const weightOf = (e: WeatherEntry) => (day >= 8 ? e.weightAfter : e.weightBase)
  const total = pool.reduce((a, e) => a + weightOf(e), 0)
  const rng = createDayRng(seed, 'weather', day)
  let roll = rng.next() * total
  for (const e of pool) {
    roll -= weightOf(e)
    if (roll <= 0) return e
  }
  return pool[pool.length - 1]
}

/** 探索系数包（消费方：@rn/world resolveDue） */
export interface WeatherMuls {
  gatherMul: number
  encounterMul: number
}
export const weatherMuls = (w: WeatherEntry): WeatherMuls => ({
  gatherMul: w.gatherMul,
  encounterMul: w.encounterMul
})
