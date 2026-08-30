// @rn/control 单测：覆盖合并/拒绝非法键/类型守卫/回滚（base 不变）/留痕 + OverlaySource 契约（E4）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyOverlay, validateOverlayFile, MemoryOverlaySource, FileOverlaySource, type OverlayFile } from '../src/index.ts'

const base = { version: 1, entries: [{ key: 'CFG_R0', value: 100 }, { key: 'CFG_G_T', value: 1.15 }] }

test('覆盖生效 + 留痕（before/after）', () => {
  const ov: OverlayFile = { version: 3, patches: { constants: { 'entries.CFG_R0.value': 120 } } }
  const r = applyOverlay('constants', base, ov)
  assert.equal(r.merged.entries[0].value, 120)
  assert.equal(r.merged.entries[1].value, 1.15, '未覆盖键不受影响')
  assert.deepEqual(r.applied, [{ target: 'constants', key: 'entries.CFG_R0.value', before: 100, after: 120 }])
  assert.equal(r.rejected.length, 0)
})

test('回滚 = 弃用补丁重新应用 base（base 永不被改写）', () => {
  const ov: OverlayFile = { version: 3, patches: { constants: { 'entries.CFG_R0.value': 999 } } }
  applyOverlay('constants', base, ov)
  assert.equal(base.entries[0].value, 100, 'base 必须保持不变')
})

test('拒绝：键不存在 / 类型不符（防手误注入新逻辑位）', () => {
  const r = applyOverlay('constants', base, { version: 5, patches: { constants: { 'entries.NOPE.value': 1, 'entries.CFG_G_T.value': 'high' } } })
  assert.equal(r.rejected.length, 2)
  assert.equal(r.merged.entries[1].value, 1.15)
})

test('OverlaySource 契约：Memory/File 源加载 + 结构校验 + 应用闭环', async () => {
  const file: OverlayFile = { version: 2, patches: { constants: { 'entries.CFG_R0.value': 110 } } }
  const loaded = await new MemoryOverlaySource(file).load()
  const v = validateOverlayFile(loaded)
  assert.equal(v.ok, true)
  if (v.ok) assert.equal(applyOverlay('constants', base, v.file).merged.entries[0].value, 110)

  const dir = mkdtempSync(join(tmpdir(), 'ov-'))
  const fp = join(dir, 'ov.json')
  writeFileSync(fp, JSON.stringify(file))
  const fromFile = await new FileOverlaySource(fp).load()
  assert.equal(fromFile.version, 2)

  assert.equal(validateOverlayFile({ version: 0 }).ok, false)
  assert.equal(validateOverlayFile(null).ok, false)
})
