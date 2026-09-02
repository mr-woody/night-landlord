// 新手引导分步逻辑（M3.4-②，UI 规范 v2.0；新手引导 D0–D7 逐日表首切片的全量态）。
// 步骤由 evt_tut_* 的 triggerDay 驱动，与 scriptedEffectsFor 调度一致：
// triggerDay≥1 在第 triggerDay 日触发，triggerDay=0 归入第 1 日（开局特权），即 day=max(triggerDay,1)。
// 完成判定=当日事件卡含该 scripted id（fire 即完成）。纯数据，无 DOM。
export interface TutStep {
  /** 游戏日（triggerDay+1） */
  day: number
  id: string
  hint: string
  /** 高亮目标（渲染层定位用：dock 键位/资源条/地图地块） */
  highlight: string
}

export const TUT_STEPS: TutStep[] = [
  { day: 1, id: 'evt_tut_fortify', hint: '点击「布防」：用木板加固你的门', highlight: 'dock:deploy' },
  { day: 1, id: 'evt_tut_firstnight', hint: '点击「▶夜」→「入夜」迎接第一夜', highlight: 'dock:night' },
  { day: 1, id: 'evt_tut_rescue', hint: '点击「招募」：多一个邻居多一份收入', highlight: 'dock:recruit' },
  { day: 2, id: 'evt_tut_referral', hint: '继续「招募」：邻居引荐正在滚雪球', highlight: 'dock:recruit' },
  { day: 2, id: 'evt_tut_broadcast', hint: '「▶夜」前确认「布防」到位', highlight: 'dock:deploy' },
  { day: 3, id: 'evt_tut_bills', hint: '天亮看「收租结算」——这就是钱', highlight: 'phase:dawn' },
  { day: 5, id: 'evt_tut_panic', hint: '恐慌会赶走住户，盯住资源栏的 😱', highlight: 'res:panic' },
  { day: 6, id: 'evt_tut_omen', hint: '明天血月！白天抓紧「布防」', highlight: 'dock:deploy' },
  { day: 30, id: 'evt_bld_b_open', hint: '点击 B 栋，看看新房间', highlight: 'map:lot_bld_b' },
  { day: 30, id: 'evt_bld_c_open', hint: '点击 C 栋，看看新房间', highlight: 'map:lot_bld_c' }
]

/** 某游戏日的步骤集（triggerDay+1 对齐 scriptedEffectsFor 调度） */
export function stepsForDay(day: number): TutStep[] {
  return TUT_STEPS.filter(s => s.day === day)
}

export interface TutRow {
  step: TutStep
  /** 完成打勾：当日事件卡已 fire 该 scripted id */
  done: boolean
}

/**
 * 步骤板数据：firedIds=当日已触发的事件 id 集（frames[idx].eventCards）。
 * 规则：列表保持定义序；全部 done → allDone（步骤板收起为打勾徽标）。
 */
export function tutorialBoard(day: number, firedIds: Set<string>): { rows: TutRow[]; allDone: boolean; current: TutStep | null } {
  const steps = stepsForDay(day)
  const rows: TutRow[] = steps.map(s => ({ step: s, done: firedIds.has(s.id) }))
  const current = rows.find(r => !r.done)?.step ?? null
  return { rows, allDone: steps.length > 0 && rows.every(r => r.done), current }
}
