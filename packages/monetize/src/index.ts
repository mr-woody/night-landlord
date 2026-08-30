// @rn/monetize —— 商业化插件骨架（M3.1 D3；FR-B3/G2/K4）：ads + iap 两个 removable 插件。
// 原则：fail-open（平台不可用/被 kill switch 停用 → 游戏完整可玩，仅无奖励入口）；
// 平台实现（微信/抖音 SDK）M4 接入，本骨架只定义契约与降级路径。
// 职责单一：ads 只管激励视频投放与频控；iap 只管目录与购买意图；资源发放一律由消费方走 EffectOp。
import { definePlugin, type PluginDeclaration } from '@rn/kernel'

export interface AdsService {
  /** 平台可用性：不可用时调用方隐藏入口（UI fail-open） */
  isReady(): boolean
  /** 激励视频：平台不可用 → { rewarded:false }，不抛错 */
  showRewarded(placement: string): Promise<{ rewarded: boolean; reason?: string }>
  /** 频控查询：placement 今日剩余次数（频控键由宿主注入） */
  remainingToday(placement: string): number
}

export interface IapService {
  /** SKU 目录（来自 config/iap_sku.json 注入） */
  catalog(): { id: string; type: string; price: number }[]
  /** 购买意图：平台不可用/未知 SKU → { ok:false }，不抛错；真实支付 M4 接入 */
  purchase(skuId: string): Promise<{ ok: boolean; reason?: string }>
}

export interface AdsPluginOptions {
  /** 频控表：placement → 每日上限（对齐设计方案 §5.1 密度） */
  caps?: Record<string, number>
}

export function createAdsPlugin(options: AdsPluginOptions = {}): PluginDeclaration {
  let platformReady = false
  let usedToday: Record<string, number> = {}
  return definePlugin({
    name: 'rn.ads',
    version: '0.1.0',
    hotplug: 'removable',
    depends: [],
    provides: ['ads'],
    produces: [],
    hooks: {
      setup(ctx) {
        platformReady = typeof (globalThis as any).wx !== 'undefined' || typeof (globalThis as any).document !== 'undefined'
        usedToday = {}
        ctx.provide('ads', {
          isReady: () => platformReady,
          showRewarded: async (placement: string) => {
            const cap = options.caps?.[placement] ?? 99
            if (!platformReady) return { rewarded: false, reason: 'platform-unavailable' }
            if ((usedToday[placement] ?? 0) >= cap) return { rewarded: false, reason: 'frequency-capped' }
            usedToday[placement] = (usedToday[placement] ?? 0) + 1
            return { rewarded: true }
          },
          remainingToday: (placement: string) => (options.caps?.[placement] ?? 99) - (usedToday[placement] ?? 0)
        } satisfies AdsService)
      },
      async stop() {
        usedToday = {} // drain：清频控状态（FR-A4）
      }
    }
  })
}

export interface IapPluginOptions {
  catalog: { id: string; type: string; price: number }[]
}

export function createIapPlugin(options: Partial<IapPluginOptions> = {}): PluginDeclaration {
  const catalog = options.catalog ?? []
  let platformReady = false
  return definePlugin({
    name: 'rn.iap',
    version: '0.1.0',
    hotplug: 'removable',
    depends: [],
    provides: ['iap'],
    produces: [],
    hooks: {
      setup(ctx) {
        platformReady = typeof (globalThis as any).wx !== 'undefined'
        ctx.provide('iap', {
          catalog: () => catalog.map(c => ({ id: c.id, type: c.type, price: c.price })),
          purchase: async (skuId: string) => {
            if (!catalog.some(c => c.id === skuId)) return { ok: false, reason: 'unknown-sku' }
            if (!platformReady) return { ok: false, reason: 'platform-unavailable' }
            return { ok: false, reason: 'M4-接入真实支付' }
          }
        } satisfies IapService)
      }
    }
  })
}
