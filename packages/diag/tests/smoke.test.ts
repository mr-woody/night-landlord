import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIAG_VERSION } from '../src/index.ts'

test('diag 骨架可导入', () => {
  assert.equal(DIAG_VERSION, '0.1.0')
})
