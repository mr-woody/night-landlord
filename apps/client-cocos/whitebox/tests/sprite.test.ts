// M5 P3-2（C8）自检：怪物战斗姿态选择纯函数——attack 优先/idle 次之/锚点兑底/全缺回退程序化。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickMonsterSprite } from '../sprite.ts'

const has = (s: Set<string>) => (n: string) => s.has(n)

test('attack 资产在位且攻击中 → attack 帧', () => {
  const h = has(new Set(['monster_seeker_attack@2x.png', 'monster_seeker_idle@2x.png']))
  assert.equal(pickMonsterSprite(h, true), 'monster_seeker_attack@2x.png')
})

test('攻击中但 attack 缺位 → 回退 idle', () => {
  const h = has(new Set(['monster_seeker_idle@2x.png']))
  assert.equal(pickMonsterSprite(h, true), 'monster_seeker_idle@2x.png')
})

test('行进中 → idle 帧', () => {
  const h = has(new Set(['monster_seeker_attack@2x.png', 'monster_seeker_idle@2x.png']))
  assert.equal(pickMonsterSprite(h, false), 'monster_seeker_idle@2x.png')
})

test('专用 sprite 全缺 → 锚点兑底（P1 已确认的 anchor_monster_seeker）', () => {
  const h = has(new Set(['anchor_monster_seeker@2x.png']))
  assert.equal(pickMonsterSprite(h, false), 'anchor_monster_seeker@2x.png')
  assert.equal(pickMonsterSprite(h, true), 'anchor_monster_seeker@2x.png')
})

test('全缺 → null（调用侧回退程序化矢量）', () => {
  assert.equal(pickMonsterSprite(has(new Set()), true), null)
})
