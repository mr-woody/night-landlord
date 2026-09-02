// M5 P3-1（C7）：AI sprite 装载与绘制层——CoC 式 2.5D 资产接入点。
// 契约：有资产用 sprite，缺资产静默回退既有程序化矢量绘制（零素材环境零回归）。
// 路径='assets/ai/'页面相对（scripts/sync-sprites.mjs 构建前把 docs/assets/ai 同步到 whitebox/assets/ai，
// 同 fonts/ 模式——无论静态服务根在仓库根还是 whitebox 目录均可达）；清单构建期内联（零 fetch 零 404）。
import spriteManifest from '../../../docs/assets/ai/sprite-manifest.json' with { type: 'json' }

/** AI 终图资产清单（docs/assets/ai/**，与 scripts/gen-ai-assets.mjs 清单对齐） */
export const SPRITE_FILES = {
  houses: [
    'house_lv0_thatch@2x.png', 'house_lv1_broken_wood@2x.png', 'house_lv2_plain_wood@2x.png',
    'house_lv3_fine_wood@2x.png', 'house_lv4_stone@2x.png', 'house_lv5_bastion@2x.png'
  ],
  monsters: ['monster_seeker_idle@2x.png', 'monster_seeker_attack@2x.png'],
  anchors: ['anchor_monster_seeker@2x.png'],
  fx: ['fx_light_column@2x.png', 'fx_light_circle@2x.png', 'fx_light_ring@2x.png',
    'fx_particle_smoke@2x.png', 'fx_particle_spark@2x.png', 'fx_particle_glow@2x.png', 'fx_particle_dust@2x.png']
} as const

const BASE = 'assets/ai/'

/** C8：怪物战斗姿态选择（纯函数，可单测）——attack 帧优先，idle 次之，风格锚点兑底，全缺 null（程序化回退） */
export function pickMonsterSprite(has: (n: string) => boolean, attacking: boolean): string | null {
  if (attacking && has('monster_seeker_attack@2x.png')) return 'monster_seeker_attack@2x.png'
  if (has('monster_seeker_idle@2x.png')) return 'monster_seeker_idle@2x.png'
  if (has('anchor_monster_seeker@2x.png')) return 'anchor_monster_seeker@2x.png'
  return null
}

export class SpriteStore {
  private map = new Map<string, HTMLImageElement>()

  /** 单文件加载（BASE 页面相对）；失败静默 false（降级信号） */
  load(name: string, dir = ''): Promise<boolean> {
    const hit = this.map.get(name)
    if (hit) return Promise.resolve(hit.complete && hit.naturalWidth > 0)
    return new Promise(resolve => {
      const img = new Image()
      img.onload = () => { this.map.set(name, img); resolve(true) }
      img.onerror = () => resolve(false)
      img.src = BASE + dir + name
    })
  }

  has(name: string): boolean {
    const img = this.map.get(name)
    return !!img && img.complete && img.naturalWidth > 0
  }

  get(name: string): HTMLImageElement | undefined {
    return this.map.get(name)
  }

  /** 清单驱动预载（C16）：只 load 构建期内联清单中的文件（缺资产零 404，补产后重建自动扩列）。
   *  画廊/回退语义不变——未列出的文件视作 miss。返回成功加载数。 */
  async loadFromManifest(): Promise<number> {
    const files: string[] = (spriteManifest as { files: string[] }).files ?? []
    const loaded = await Promise.all(files.map(f => {
      const i = f.indexOf('/')
      return this.load(f.slice(i + 1), f.slice(0, i + 1))
    }))
    return loaded.filter(Boolean).length
  }

  /** 底边中心锚定绘制（等距实体统一锚点：脚底接地）；alpha<1 用于未入住等状态减淡 */
  draw(ctx: CanvasRenderingContext2D, name: string, cx: number, bottom: number, w: number, alpha = 1): void {
    const img = this.map.get(name)
    if (!img || !this.has(name)) return
    const dh = w * (img.naturalHeight / img.naturalWidth)
    if (alpha < 1) ctx.save()
    if (alpha < 1) ctx.globalAlpha = alpha
    ctx.drawImage(img, cx - w / 2, bottom - dh, w, dh)
    if (alpha < 1) ctx.restore()
  }
}
