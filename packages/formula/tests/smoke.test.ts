import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FORMULA_VERSION } from '../src/index.ts'

test('formula 骨架可导入', () => {
  assert.equal(FORMULA_VERSION, '0.1.0')
})
