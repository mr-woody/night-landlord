import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DIRECTOR_VERSION } from '../src/index.ts'

test('director 骨架可导入', () => {
  assert.equal(DIRECTOR_VERSION, '0.1.0')
})
