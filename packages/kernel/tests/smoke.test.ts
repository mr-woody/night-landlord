import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KERNEL_VERSION } from '../src/index.ts'

test('kernel 骨架可导入', () => {
  assert.equal(KERNEL_VERSION, '0.1.0')
})
