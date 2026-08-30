// tokens 单一事实源桥（M2.5 功能点1，UI-UX设计规范 §二）：
// 白盒渲染器的色板/字号/间距/圆角/动效全部从 config/theme.json 取。
// 红线：渲染层零硬编码色值/字号/时长——本目录源码不得出现字面 hex/rgb()
// （scripts/check-theme.mjs 对源码与 bundle 双向断言）；透明度派生色唯一入口是 withAlpha。
import themeJson from '../../../config/theme.json' with { type: 'json' }

export interface Theme {
  version: number
  color: {
    bg_night: string; bg_dawn: string; alert_blood: string
    gold_primary: string; gold_deep: string
    panel: string; panel_stroke: string
    text_primary: string; text_secondary: string
    success: string; danger: string; panic: string
  }
  typography: { family_cn: string; family_num: string; h1: number; h2: number; body: number; caption: number }
  space: { xs: number; s: number; m: number; l: number }
  radius: { panel: number; btn: number; chip: number }
  motion: Record<string, { dur: number; ease: string; repeat?: number }>
}

export const T = themeJson as unknown as Theme

/** '#RRGGBB' + alpha → 'rgba(r,g,b,a)'：带透明度派生色的唯一入口（禁止字面 rgba） */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`
}

/** 色板取值：未知键回退 text_primary（类型层面已收敛，防御 JSON 手改） */
export function col(key: keyof Theme['color']): string {
  return T.color[key]
}

/** 明度缩放（k<1 压暗/k>1 提亮，通道封顶）——派生色，非新色值（check-theme 合规） */
export function shade(hex: string, k: number): string {
  const h = hex.replace('#', '')
  const f = (s: string) => Math.max(0, Math.min(255, Math.round(parseInt(s, 16) * k)))
  return `#${[0, 2, 4].map(i => f(h.slice(i, i + 2)).toString(16).padStart(2, '0')).join('')}`
}

/** 两色线性插值（k=0 取 a，k=1 取 b）——派生色 */
export function mix(a: string, b: string, k: number): string {
  const p = (h: string) => [0, 2, 4].map(i => parseInt(h.replace('#', '').slice(i, i + 2), 16))
  const [ra, ga, ba] = p(a), [rb, gb, bb] = p(b)
  const f = (x: number, y: number) => Math.max(0, Math.min(255, Math.round(x + (y - x) * k)))
  return `#${[f(ra, rb), f(ga, gb), f(ba, bb)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}

export type EaseFn = (t: number) => number

/** UI 规范 §二 motion 表五条曲线的参考实现（P3 动效落地与单测逐条比对的基准） */
export const EASE: Record<string, EaseFn> = {
  linear: t => t,
  easeOutQuad: t => 1 - (1 - t) ** 2,
  easeOutCubic: t => 1 - (1 - t) ** 3,
  easeInQuad: t => t * t,
  easeOutBack: t => {
    const c1 = 1.70158 // 标准回弹常数（CSS ease-out-back 定义值，非样式参数）
    const c3 = c1 + 1
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
  }
}

export function easeByName(name: string): EaseFn {
  return EASE[name] ?? EASE.linear
}

/** 取 motion token：dur/ease/repeat 全部来自 theme.json，未知键回退 normal */
export function motion(name: string): { dur: number; fn: EaseFn; repeat?: number } {
  const m = T.motion[name] ?? T.motion.normal
  return { dur: m.dur, fn: easeByName(m.ease), repeat: m.repeat }
}

/** canvas font 串：字号由调用方传 typography tokens，字族取 family tokens */
export function font(px: number, opts: { weight?: string; family?: keyof Theme['typography'] | string } = {}): string {
  const family = (opts.family && typeof opts.family === 'string' ? opts.family : T.typography.family_cn) as string
  const weight = opts.weight ? opts.weight + ' ' : ''
  return `${weight}${px}px "${family}", sans-serif`
}
