// M2.5 功能点2 单测：UI 状态机（打断/恢复规则 = §3.1 连续性规则）+ 布局合规前置断言。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createUiState, pushEvent, openModal, closeModal, topModal,
  chooseOption, advancePhase, canInterrupt, EVENT_QUEUE_MAX, type UiState
} from '../state.ts'
import {
  dockRects, dockRect, settingsRect, roomRect, hitTest, HIT_MIN,
  DESIGN_W, DESIGN_H, FLOORS, ROOMS_PER_FLOOR,
  duskConfirmRect, nightSkillRects, nightBackRect, settleContinueRect
} from '../layout.ts'

const card = (id: string) => ({ id, title: `事件${id}`, weight: 1, options: [{ label: '选项', ps: [1] }], resultText: '无直接状态变化' })

test('事件卡打断：常规模态之上事件卡优先展示，关闭后 LIFO 恢复原模态', () => {
  let s: UiState = createUiState()
  s = openModal(s, { kind: 'panel', id: 'deploy' })
  s = pushEvent(s, card('evt_001'))
  assert.equal(topModal(s)?.kind, 'event', '事件卡应展示在常规模态之上（打断）')
  s = closeModal(s)
  assert.equal(topModal(s)?.kind, 'panel', '事件卡关闭后应恢复常规模态（先进后出）')
  assert.equal(topModal(s)?.id, 'deploy')
  s = closeModal(s)
  assert.equal(topModal(s), undefined)
})

test('事件卡队列上限 2：第三张被拒绝（打断排队最多 2，§3.1）', () => {
  let s: UiState = createUiState()
  s = pushEvent(s, card('a'))
  s = pushEvent(s, card('b'))
  assert.equal(s.eventQueue.length, EVENT_QUEUE_MAX)
  s = pushEvent(s, card('c'))
  assert.equal(s.eventQueue.length, EVENT_QUEUE_MAX, '队列满后新事件卡不入队')
  assert.equal(topModal(s)?.card?.title, '事件b', '保持先进后出恢复序')
})

test('夜战不可打断：NIGHT 相拒绝事件卡与新模态（全屏接管，§四）', () => {
  let s: UiState = createUiState()
  s = advancePhase(advancePhase(s)) // DAY→DUSK_FORECAST→NIGHT
  assert.equal(s.phase, 'NIGHT')
  assert.equal(canInterrupt(s), false)
  s = pushEvent(s, card('x'))
  assert.equal(s.eventQueue.length, 0, '夜战中事件卡被拒绝')
  s = openModal(s, { kind: 'panel', id: 'recruit' })
  assert.equal(s.modals.length, 0, '夜战中常规模态被拒绝')
})

test('事件卡选择即锁定：已选后再次选择为无操作（§3.2 不可回退）', () => {
  let s: UiState = createUiState()
  s = pushEvent(s, card('k'))
  s = chooseOption(s, 1)
  assert.equal(topModal(s)?.chosen, 1)
  s = chooseOption(s, 0)
  assert.equal(topModal(s)?.chosen, 1, '锁定后不可改选')
})

test('相位单向循环：DAWN→DAY→DUSK→NIGHT→DAWN（门② 四相）', () => {
  let s: UiState = { ...createUiState(), phase: 'DAWN_SETTLE' }
  const seq: string[] = []
  for (let i = 0; i < 4; i++) { seq.push(s.phase); s = advancePhase(s) }
  assert.deepEqual(seq, ['DAWN_SETTLE', 'DAY', 'DUSK_FORECAST', 'NIGHT'])
})

test('布局：dock 四键与设置入口热区 ≥88px（§一.3 可读性红线）', () => {
  const rects = dockRects()
  assert.equal(rects.length, 4)
  for (const r of rects) {
    assert.ok(r.w >= HIT_MIN && r.h >= HIT_MIN, `dock 键热区 ${r.w}×${r.h} 应 ≥88×88`)
    assert.ok(r.x >= 0 && r.x + r.w <= DESIGN_W, 'dock 键不越出画布')
  }
  const st = settingsRect()
  assert.ok(st.w >= HIT_MIN && st.h >= HIT_MIN, '设置入口热区 ≥88×88')
  assert.ok(dockRect('night').x > dockRect('deploy').x, '▶夜 为最右键')
})

test('布局：6F×5 房间格子完整落在剖面区内且互不重叠', () => {
  const rooms = new Set<string>()
  for (let f = 0; f < FLOORS; f++) {
    for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
      const rect = roomRect(f, r)
      assert.ok(rect.x > 0 && rect.x + rect.w < DESIGN_W, `房间 [${f},${r}] 横向越界`)
      assert.ok(rect.y > 0 && rect.y + rect.h < DESIGN_H, `房间 [${f},${r}] 纵向越界`)
      rooms.add(`${Math.round(rect.x)},${Math.round(rect.y)}`)
    }
  }
  assert.equal(rooms.size, FLOORS * ROOMS_PER_FLOOR, '格子坐标应两两不同（无重叠）')
})

test('命中测试：模态开启时不穿透、关闭按钮可点；dock/设置/事件入口正确命中', () => {
  const d = dockRect('night')
  assert.deepEqual(hitTest(d.x + 10, d.y + 10), { kind: 'dock', key: 'night' })
  const st = settingsRect()
  assert.equal(hitTest(st.x + 10, st.y + 10).kind, 'settings')
  // 模态态
  const close = hitTest(0, 0, { modalOpen: true })
  assert.equal(close.kind, 'modal', '模态外点击不穿透（左上角非关闭钮）')
  const anyClose = hitTest(DESIGN_W - 90, DESIGN_H - 84, { modalOpen: true })
  assert.equal(anyClose.kind, 'modalClose', '模态右下关闭钮可命中')
  assert.equal(hitTest(1, DESIGN_H - 1).kind, 'none', 'dock 之下空白处无命中')
})

test('命中测试：小区地图上探索横幅与 30 栋小屋可达（M3.3 回归——此前 hitTest 死分支致入口失效）', () => {
  // 探索横幅中心（EXPLORE_ENTRY: x 235-515, y 240-304）
  const ex = hitTest(DESIGN_W / 2, 240 + 32, { page: 'map' })
  assert.equal(ex.kind, 'explore', '探索横幅必须可命中（L1 野外唯一入口）')
  // 小屋群落：i=0 屋（x 96-158, y 680-730）与末排 row4（偶数行无错位，col3 → x 396-458）
  assert.equal(hitTest(100, 700, { page: 'map' }).kind, 'house', '首排小屋可命中')
  const last = hitTest(416, 726 + 4 * 84 - 20, { page: 'map' })
  assert.equal(last.kind, 'house', '末排小屋可命中')
  // 地块/浮层层序：横幅与小屋命中优先于等距地块
  const lot = hitTest(DESIGN_W / 2 + 110, 540, { page: 'map' })
  assert.ok(['lot', 'house', 'explore'].includes(lot.kind), `地块区域命中应属 lot/house/explore，实得 ${lot.kind}`)
})

test('命中测试：相位接管面（DUSK/NIGHT/DAWN）在 map 页可达（M4 回归——此前相位分派断裂致无法入夜/天亮）', () => {
  const dc = duskConfirmRect()
  assert.deepEqual(hitTest(dc.x + 10, dc.y + 10, { page: 'map', phase: 'DUSK_FORECAST' }), { kind: 'duskConfirm' }, 'DUSK 确认钮在 map 页可命中')
  const sk = nightSkillRects()[0]
  assert.deepEqual(hitTest(sk.x + 10, sk.y + 10, { page: 'map', phase: 'NIGHT' }), { kind: 'skill', index: 0 }, '夜战技能一可命中')
  const nb = nightBackRect()
  assert.deepEqual(hitTest(nb.x + nb.w / 2, nb.y + 10, { page: 'map', phase: 'NIGHT' }), { kind: 'nightBack' }, '夜战「天亮了」可命中')
  const sc = settleContinueRect()
  assert.deepEqual(hitTest(sc.x + 10, sc.y + 10, { page: 'map', phase: 'DAWN_SETTLE' }), { kind: 'settleContinue' }, '结算「继续」可命中')
})
