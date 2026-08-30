// 零依赖 PNG 编解码（M2.5 功能点5 资产管线基础设施）。
// encodePng：RGBA8 → PNG（filter 0 行过滤 + zlib deflate）。
// decodePng：支持 RGB/RGBA 8bit、filter 0–4（供校验脚本解任意外部 PNG）。
import { deflateSync, inflateSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

/** RGBA Uint8Array (w×h×4) → PNG Buffer */
export function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0 // filter none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ])
}

/** PNG Buffer → { w, h, rgba: Uint8Array }（RGB 自动补 alpha；支持 filter 0–4） */
export function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('非 PNG 文件')
  let pos = 8, w = 0, h = 0, colorType = 0, bitDepth = 0, idat = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4)
      bitDepth = data[8]; colorType = data[9]
      if (bitDepth !== 8) throw new Error(`不支持的位深 ${bitDepth}（仅 8bit）`)
      if (![2, 6].includes(colorType)) throw new Error(`不支持的色彩类型 ${colorType}（仅 RGB/RGBA）`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = w * bpp
  const out = new Uint8Array(w * h * 4)
  const prev = Buffer.alloc(stride)
  const cur = Buffer.alloc(stride)
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)]
    raw.copy(cur, 0, y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev[i]
      const c = i >= bpp ? prev[i - bpp] : 0
      if (filter === 1) cur[i] = (cur[i] + a) & 0xff
      else if (filter === 2) cur[i] = (cur[i] + b) & 0xff
      else if (filter === 3) cur[i] = (cur[i] + ((a + b) >> 1)) & 0xff
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
        cur[i] = (cur[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
      }
    }
    for (let x = 0; x < w; x++) {
      out[(y * w + x) * 4] = cur[x * bpp]
      out[(y * w + x) * 4 + 1] = cur[x * bpp + 1]
      out[(y * w + x) * 4 + 2] = cur[x * bpp + 2]
      out[(y * w + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255
    }
    cur.copy(prev)
  }
  return { w, h, rgba: out }
}

// ---- 极简软件光栅器（占位级资产生成用；硬边无抗锯齿保证色板精确）----
export class Raster {
  constructor(w, h) {
    this.w = w
    this.h = h
    this.px = new Uint8Array(w * h * 4)
  }

  static hex(c) {
    const s = c.replace('#', '')
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)]
  }

  set(x, y, [r, g, b], a = 255) {
    x |= 0; y |= 0
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return
    const i = (y * this.w + x) * 4
    if (a >= 255) {
      this.px[i] = r; this.px[i + 1] = g; this.px[i + 2] = b; this.px[i + 3] = 255
    } else if (a > 0) { // 简单 alpha 混合（仅用于调光，不产生中间色相）
      this.px[i] = (r * a + this.px[i] * (255 - a)) / 255
      this.px[i + 1] = (g * a + this.px[i + 1] * (255 - a)) / 255
      this.px[i + 2] = (b * a + this.px[i + 2] * (255 - a)) / 255
      this.px[i + 3] = Math.max(this.px[i + 3], a)
    }
  }

  rect(x, y, w, h, color, a = 255) {
    for (let yy = Math.round(y); yy < Math.round(y + h); yy++)
      for (let xx = Math.round(x); xx < Math.round(x + w); xx++) this.set(xx, yy, color, a)
  }

  circle(cx, cy, rad, color, a = 255) {
    for (let yy = Math.ceil(cy - rad); yy <= cy + rad; yy++)
      for (let xx = Math.ceil(cx - rad); xx <= cx + rad; xx++)
        if ((xx - cx) ** 2 + (yy - cy) ** 2 <= rad ** 2) this.set(xx, yy, color, a)
  }

  ring(cx, cy, rad, thick, color, a = 255) {
    for (let yy = Math.ceil(cy - rad - thick); yy <= cy + rad + thick; yy++)
      for (let xx = Math.ceil(cx - rad - thick); xx <= cx + rad + thick; xx++) {
        const d = Math.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)
        if (d <= rad + thick && d >= rad - thick) this.set(xx, yy, color, a)
      }
  }

  roundRect(x, y, w, h, r, color, a = 255) {
    this.rect(x + r, y, w - r * 2, h, color, a)
    this.rect(x, y + r, w, h - r * 2, color, a)
    this.circle(x + r, y + r, r, color, a)
    this.circle(x + w - r, y + r, r, color, a)
    this.circle(x + r, y + h - r, r, color, a)
    this.circle(x + w - r, y + h - r, r, color, a)
  }

  /** 多边形扫描线填充（顶点 [[x,y],...]；怪物剪影用） */
  polygon(pts, color, a = 255) {
    const ys = pts.map(p => p[1])
    for (let y = Math.ceil(Math.min(...ys)); y < Math.max(...ys); y++) {
      const xs = []
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) xs.push(x1 + (y - y1) / (y2 - y1) * (x2 - x1))
      }
      xs.sort((m, n) => m - n)
      for (let i = 0; i + 1 < xs.length; i += 2)
        for (let x = Math.ceil(xs[i]); x < xs[i + 1]; x++) this.set(x, y, color, a)
    }
  }
}
