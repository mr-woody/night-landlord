// @rn/control —— 配置覆盖层（M3.1 D4；FR-C3/C4：单一通道、版本化可回滚、全留痕）。
// 原则：覆盖是"数据补丁"而非代码（FR-B6 无远程代码下载）；base 永不修改（回滚=弃用补丁）。
// 覆盖文件形态：{ version: int, patches: { "<config名>": { "<key路径>": value } } }，
// key 路径支持 `entries.<key>:<字段>` 形式（如 constants 的 `entries.CFG_R0.value`）由调用方解析。

export interface OverlayFile {
  version: number
  note?: string
  patches: Record<string, Record<string, unknown>>
}

export interface OverlayResult<T> {
  merged: T
  applied: { target: string; key: string; before: unknown; after: unknown }[]
  rejected: { target: string; key: string; reason: string }[]
  version: number
}

/** 按点路径寻址（'a.b.c'）；段落在数组上时按键字段（.key/.id）匹配元素——如 constants 的 'entries.CFG_R0.value' */
function seg(obj: any, k: string): any {
  if (Array.isArray(obj)) return obj.find((e: any) => e && (e.key === k || e.id === k))
  return obj?.[k]
}
function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<any>((o, k) => (o == null ? undefined : seg(o, k)), obj)
}
function setPath(obj: any, path: string, value: unknown): void {
  const keys = path.split('.')
  let o: any = obj
  for (let i = 0; i < keys.length - 1; i++) {
    const nxt = seg(o, keys[i])
    if (nxt === undefined) throw new Error(`路径不可达：${keys.slice(0, i + 1).join('.')}`)
    o = nxt
  }
  const last = keys[keys.length - 1]
  if (Array.isArray(o)) {
    const e = o.find((x: any) => x && (x.key === last || x.id === last))
    if (e === undefined) throw new Error(`路径不可达：${keys.join('.')}`)
    e.value = value
  } else o[last] = value
}

/**
 * 应用覆盖层（深拷贝 base，绝不改写原对象——回滚 = 重新以 base 调用本函数）。
 * 目标键不存在 → rejected（禁止覆盖层"无中生有"，防手误注入新逻辑位）。
 */
export function applyOverlay<T>(target: string, base: T, overlay: OverlayFile): OverlayResult<T> {
  const merged: T = globalThis.structuredClone(base)
  const applied: OverlayResult<T>['applied'] = []
  const rejected: OverlayResult<T>['rejected'] = []
  const patches = overlay.patches[target] ?? {}
  for (const [key, value] of Object.entries(patches)) {
    const before = getPath(merged, key)
    if (before === undefined) { rejected.push({ target, key, reason: 'key 不存在（覆盖层禁止新增键）' }); continue }
    if (typeof before !== typeof value) { rejected.push({ target, key, reason: `类型不符 ${typeof before}→${typeof value}` }); continue }
    setPath(merged, key, value)
    applied.push({ target, key, before, after: value })
  }
  return { merged, applied, rejected, version: overlay.version }
}

// ---- 覆盖层来源契约（M4 E4；FR-C3 单一通道）：远程通道开通前以本地文件源落地 ----
// NFR-6：逻辑包零宿主 API——文件读取由宿主注入（headless 传 node fs，客户端传平台等价物）
export interface TextFileReader { (path: string): string }

export interface OverlaySource {
  load(): Promise<OverlayFile>
}

/** 本地文件源（生产：远程 HTTP 源实现同接口后无缝替换；校验逻辑复用 applyOverlay 单点） */
export class FileOverlaySource implements OverlaySource {
  private path: string
  private readText: TextFileReader
  constructor(path: string, readText: TextFileReader) {
    this.path = path
    this.readText = readText
  }
  async load(): Promise<OverlayFile> {
    return JSON.parse(this.readText(this.path)) as OverlayFile
  }
}

/** 内存源（测试/预览用） */
export class MemoryOverlaySource implements OverlaySource {
  private file: OverlayFile
  constructor(file: OverlayFile) {
    this.file = file
  }
  async load(): Promise<OverlayFile> {
    return this.file
  }
}

/** 覆盖层文件结构校验（形状/版本/patches 白名单容器） */
export function validateOverlayFile(obj: unknown): { ok: true; file: OverlayFile } | { ok: false; reason: string } {
  const o = obj as Partial<OverlayFile> | null
  if (!o || typeof o !== 'object') return { ok: false, reason: '非对象' }
  if (typeof o.version !== 'number' || o.version < 1) return { ok: false, reason: 'version 非法' }
  if (!o.patches || typeof o.patches !== 'object' || Array.isArray(o.patches)) return { ok: false, reason: 'patches 缺失或非对象' }
  return { ok: true, file: o as OverlayFile }
}
