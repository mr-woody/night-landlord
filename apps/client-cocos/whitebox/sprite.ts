// M5 P3-1（C7）：AI sprite 装载与绘制层——CoC 式 2.5D 资产接入点。
// 契约：有资产用 sprite，缺资产静默回退既有程序化矢量绘制（零素材环境零回归）。
// 路径多候选探测：白盒页可能被以仓库根或 whitebox 目录为根两种方式静态服务；
// 浏览器运行（Image），不引入 node:fs；加载失败不 reject，只计 miss。

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

const BASES = ['docs/assets/ai/', '/docs/assets/ai/']

/** C8：怪物战斗姿态选择（纯函数，可单测）——attack 帧优先，idle 次之，风格锚点兑底，全缺 null（程序化回退） */
export function pickMonsterSprite(has: (n: string) => boolean, attacking: boolean): string | null {
  if (attacking && has('monster_seeker_attack@2x.png')) return 'monster_seeker_attack@2x.png'
  if (has('monster_seeker_idle@2x.png')) return 'monster_seeker_idle@2x.png'
  if (has('anchor_monster_seeker@2x.png')) return 'anchor_monster_seeker@2x.png'
  return null
}

export class SpriteStore {
  private map = new Map<string, HTMLImageElement>()

  /** 单文件加载：按路径候选依次尝试；成功 true，全 miss false（静默降级信号） */
  load(name: string, dir = ''): Promise<boolean> {
    const hit = this.map.get(name)
    if (hit) return Promise.resolve(hit.complete && hit.naturalWidth > 0)
    return new Promise(resolve => {
      const img = new Image()
      let bi = 0
      img.onload = () => { this.map.set(name, img); resolve(true) }
      img.onerror = () => { bi += 1; if (bi < BASES.length) img.src = BASES[bi] + dir + name; else resolve(false) }
      img.src = BASES[0] + dir + name
    })
  }

  has(name: string): boolean {
    const img = this.map.get(name)
    return !!img && img.complete && img.naturalWidth > 0
  }

  get(name: string): HTMLImageElement | undefined {
    return this.map.get(name)
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
