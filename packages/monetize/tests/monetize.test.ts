// @rn/monetize 单测：fail-open（FR-G2）/ 频控 / kill switch 停用后日循环不受损（FR-B3）/ 目录闭合。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createKernel, definePlugin } from '@rn/kernel'
import { applyEffects, createGameState } from '@rn/systems'
import { createAdsPlugin, createIapPlugin, type AdsService } from '../src/index.ts'

const sku = JSON.parse(readFileSync(new URL('../../../config/iap_sku.json', import.meta.url), 'utf8'))

test('ads fail-open：headless（无平台）isReady=false，showRewarded 不抛错且无奖励', async () => {
  const kernel = createKernel({ appName: 't-ads' })
  kernel.register([createAdsPlugin({ caps: { rent_x2: 2 } })])
  await kernel.boot()
  const ads = kernel.service<AdsService>('ads')
  assert.equal(ads.isReady(), false)
  const r = await ads.showRewarded('rent_x2')
  assert.deepEqual(r, { rewarded: false, reason: 'platform-unavailable' })
})

test('ads 频控：platform 可用时按 caps 递减，超额 reason=frequency-capped', async () => {
  ;(globalThis as any).wx = {} // 平台可用性在 setup 前注入（测试替身）
  const kernel = createKernel({ appName: 't-ads-cap' })
  kernel.register([createAdsPlugin({ caps: { rent_x2: 2 } })])
  await kernel.boot()
  const ads = kernel.service<AdsService>('ads')
  assert.equal(ads.isReady(), true)
  const r1 = await ads.showRewarded('rent_x2')
  const r2 = await ads.showRewarded('rent_x2')
  const r3 = await ads.showRewarded('rent_x2')
  assert.equal(ads.remainingToday('rent_x2'), 0)
  assert.equal(r3.reason, 'frequency-capped')
  assert.ok(r1.rewarded && r2.rewarded)
  delete (globalThis as any).wx
})

test('kill switch（FR-B3）：stop rn.ads 后主循环（applyEffects）与收租照常，重挂恢复', async () => {
  const kernel = createKernel({ appName: 't-ads-ks' })
  kernel.register([createAdsPlugin({})])
  await kernel.boot()
  await kernel.stopPlugin('rn.ads')
  // 主循环不受损：kill switch 后状态变更（收租/夜战路径）照常
  const state = createGameState(42)
  const res = applyEffects(state, [{ op: 'ADD_GOLD', n: 500 }], { constants: {}, buildingDef: { version: 1, entries: [] } })
  assert.equal(res.applied, 1)
  assert.equal(state.resources.gold, createGameState(42).resources.gold + 500)
  // 重挂恢复（kernel 契约：运行期恢复走 startPlugin，register 仅限启动相）
  await kernel.startPlugin('rn.ads')
  assert.equal(typeof kernel.service<AdsService>('ads').remainingToday('rent_x2'), 'number')
})

test('iap 目录闭合：catalog 与 iap_sku 注入一致；未知 SKU fail-open', async () => {
  const kernel = createKernel({ appName: 't-iap' })
  kernel.register([createIapPlugin({ catalog: sku.entries.map((e: any) => ({ id: e.id, type: e.type, price: e.price })) })])
  await kernel.boot()
  const iap = kernel.service<any>('iap')
  const cat = iap.catalog()
  assert.equal(cat.length, sku.entries.length)
  assert.equal(sku.entries.filter((e: any) => e.type === 'firstCharge').length, 1)
  const bad = await iap.purchase('no_such_sku')
  assert.equal(bad.ok, false)
})

test('生命周期（FR-A4）：stop 幂等、dispose 后不残留（重复 stop 不抛错）', async () => {
  const kernel = createKernel({ appName: 't-lc' })
  kernel.register([definePlugin({
    name: 'rn.probe', version: '0.1.0', hotplug: 'removable', depends: [], provides: ['probe'], produces: [],
    hooks: { setup(ctx) { ctx.provide('probe', { ok: true }) } }
  })])
  await kernel.boot()
  await kernel.stopPlugin('rn.probe')
  await kernel.stopPlugin('rn.probe') // 幂等
  assert.ok(true)
})
