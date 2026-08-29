import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SYSTEMS_VERSION } from '../src/index.ts'

test('systems 骨架可导入', () => {
  assert.equal(SYSTEMS_VERSION, '0.1.0')
})
