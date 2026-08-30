#!/usr/bin/env node
// P6：Creator 工程资产生成器（headless 路线）。
// ① 为 assets 下全部目录/TS/场景文件生成确定性 .meta（uuid 由相对路径 sha256 派生，重跑稳定；
//    Creator 对已存在 meta 保留 uuid，版本不符时仅按新版本重导入）
// ② 生成 assets/scenes/main.scene（Creator 3.8 序列化格式）：
//    Scene → Canvas(UITransform+Widget+cc.Canvas+WhiteboxMain) → Camera(正交)
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { relative, resolve, dirname, join } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const project = join(root, 'apps/client-cocos/creator')
const assets = join(project, 'assets')

// ---- 确定性 uuid（v4 格式，由相对路径 sha256 派生）----
function uuidFor(relPath) {
  const h = createHash('sha256').update('nl-creator:' + relPath).digest('hex')
  return [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20), h.slice(20, 32)].join('-')
}
// cocos compressUuid：去连字符 32 hex → 前 5 位保留 + 余 27 hex 按 3hex→2base64 压缩
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function compressUuid(uuid) {
  const s = uuid.replace(/-/g, '')
  let out = s.slice(0, 5)
  for (let i = 5; i < 30; i += 3) {
    const v = parseInt(s.slice(i, i + 3), 16)
    out += B64[v >> 6] + B64[v & 63]
  }
  return out
}

function metaFor(kind, uuid) {
  if (kind === 'typescript') return { ver: '4.0.24', importer: 'typescript', imported: true, uuid, files: [], subMetas: {}, userData: {} }
  if (kind === 'scene') return { ver: '1.1.50', importer: 'scene', imported: true, uuid, files: ['.json'], subMetas: {}, userData: {} }
  return { ver: '1.2.0', importer: 'directory', imported: true, uuid, files: [], subMetas: {}, userData: {} }
}
function kindOf(p, isDir) {
  if (isDir) return 'directory'
  if (p.endsWith('.scene')) return 'scene'
  if (p.endsWith('.ts')) return 'typescript'
  return null
}

function walk(dir, acc = []) {
  acc.push(dir)
  for (const n of readdirSync(dir)) {
    if (n.endsWith('.meta')) continue
    const p = join(dir, n)
    acc.push(p)
    if (statSync(p).isDirectory()) walk(p, acc)
  }
  return acc
}

const metas = []
for (const p of walk(assets)) {
  const rel = relative(assets, p)
  const isDir = statSync(p).isDirectory()
  const kind = kindOf(p, isDir)
  if (!kind) continue // 其他文件交由 Creator 默认导入
  const metaPath = p + '.meta'
  if (existsSync(metaPath)) continue
  metas.push({ path: metaPath, data: metaFor(kind, uuidFor(rel)) })
}
for (const m of metas) {
  mkdirSync(dirname(m.path), { recursive: true })
  writeFileSync(m.path, JSON.stringify(m.data, null, 2))
}

// ---- main.scene（3.8 序列化；引用索引固定）----
const sceneMeta = metaFor('scene', uuidFor('scenes/main.scene'))
const sceneUuid = sceneMeta.uuid
const scriptMetaPath = join(assets, 'scripts/whitebox-fragment/WhiteboxMain.ts.meta')
const scriptUuid = existsSync(scriptMetaPath)
  ? JSON.parse(readFileSync(scriptMetaPath, 'utf8')).uuid
  : uuidFor('scripts/whitebox-fragment/WhiteboxMain.ts')
writeFileSync(scriptMetaPath, JSON.stringify(metaFor('typescript', scriptUuid), null, 2))
if (!existsSync(join(assets, 'scenes/main.scene.meta'))) {
  writeFileSync(join(assets, 'scenes/main.scene.meta'), JSON.stringify(sceneMeta, null, 2))
}
const COMPONENT_TYPE = compressUuid(scriptUuid)

const V3 = (x, y, z) => ({ __type__: 'cc.Vec3', x, y, z })
const REF = id => ({ __id__: id })
const id0 = k => 'nl' + uuidFor('scene-id:' + k).replace(/-/g, '').slice(0, 20)
const scene = [
  { __type__: 'cc.SceneAsset', _name: 'main', _objFlags: 0, __editorExtras__: {}, _native: '', scene: REF(1) },
  { // Scene
    __type__: 'cc.Scene', _name: 'main', _objFlags: 0, __editorExtras__: {}, _parent: null,
    _children: [REF(2)], _active: true, _components: [], _prefab: null,
    _lpos: V3(0, 0, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: V3(1, 1, 1), _mobility: 0, _layer: 1073741824, _euler: V3(0, 0, 0),
    autoReleaseAssets: false, _globals: REF(9), _id: id0('scene')
  },
  { // Canvas node
    __type__: 'cc.Node', _name: 'Canvas', _objFlags: 0, __editorExtras__: {}, _parent: REF(1),
    _children: [REF(7)], _active: true, _components: [REF(3), REF(4), REF(5), REF(6)], _prefab: null,
    _lpos: V3(375, 812, 0), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: V3(1, 1, 1), _mobility: 0, _layer: 33554432, _euler: V3(0, 0, 0),
    _id: id0('canvas')
  },
  { // UITransform
    __type__: 'cc.UITransform', _name: '', _objFlags: 0, __editorExtras__: {}, node: REF(2),
    _enabled: true, __prefab: null,
    _contentSize: { __type__: 'cc.Size', width: 750, height: 1624 },
    _anchorPoint: { __type__: 'cc.Vec2', x: 0.5, y: 0.5 }, _id: id0('canvas-uitransform')
  },
  { // Widget
    __type__: 'cc.Widget', _name: '', _objFlags: 0, __editorExtras__: {}, node: REF(2),
    _enabled: true, __prefab: null, _alignFlags: 45, _target: null, _left: 0, _right: 0,
    _top: 0, _bottom: 0, _horizontalCenter: 0, _verticalCenter: 0, _isAbsLeft: true,
    _isAbsRight: true, _isAbsTop: true, _isAbsBottom: true, _isAbsHorizontalCenter: true,
    _isAbsVerticalCenter: true, _originalWidth: 0, _originalHeight: 0, _alignMode: 2,
    _lockFlags: 0, _id: id0('canvas-widget')
  },
  { // cc.Canvas
    __type__: 'cc.Canvas', _name: '', _objFlags: 0, __editorExtras__: {}, node: REF(2),
    _enabled: true, __prefab: null, _cameraComponent: REF(8), _alignCanvasWithScreen: true,
    _id: id0('canvas-cccanvas')
  },
  { // WhiteboxMain 自定义组件
    __type__: COMPONENT_TYPE, _name: 'WhiteboxMain', _objFlags: 0, __editorExtras__: {},
    node: REF(2), _enabled: true, __prefab: null, _id: id0('whitebox-main')
  },
  { // Camera node
    __type__: 'cc.Node', _name: 'Camera', _objFlags: 0, __editorExtras__: {}, _parent: REF(2),
    _children: [], _active: true, _components: [REF(8)], _prefab: null,
    _lpos: V3(0, 0, 1000), _lrot: { __type__: 'cc.Quat', x: 0, y: 0, z: 0, w: 1 },
    _lscale: V3(1, 1, 1), _mobility: 0, _layer: 1073741824, _euler: V3(0, 0, 0),
    _id: id0('camera')
  },
  { // cc.Camera
    __type__: 'cc.Camera', _name: '', _objFlags: 0, __editorExtras__: {}, node: REF(7),
    _enabled: true, __prefab: null, _projection: 0, _priority: 0, _fov: 45, _fovAxis: 0,
    _orthoHeight: 812, _near: -2000, _far: 2000, _colorBufferType: 0,
    _targetTexture: null, _cameraType: -1, _visibility: 41943040,
    _clearColor: { __type__: 'cc.Color', r: 11, g: 16, b: 32, a: 255 },
    _clearDepth: 1, _clearStencil: 0, _screenSize: { __type__: 'cc.Size', width: 750, height: 1624 },
    _id: id0('camera-comp')
  },
  { // SceneGlobals
    __type__: 'cc.SceneGlobals', ambient: REF(10), shadows: REF(11), _skybox: REF(12),
    fog: REF(13), octree: REF(14), lightProbeInfo: REF(15), postSettings: REF(16)
  },
  { __type__: 'cc.AmbientInfo', _envLightingType: 0 },
  { __type__: 'cc.ShadowsInfo', _enabled: false, _type: 0 },
  { __type__: 'cc.SkyboxInfo', _enabled: false, _useHDR: true },
  { __type__: 'cc.FogInfo', _enabled: false, _type: 0, _accurate: false },
  { __type__: 'cc.OctreeInfo', _enabled: false, _depth: 8 },
  { __type__: 'cc.LightProbeInfo', _giScale: 1, _giSamples: 1024, _bounces: 2, _reduceRinging: 0, _showProbe: true, _showWireframe: true, _showConvex: false, _data: null, _lightProbeSphereVolume: 1 },
  { __type__: 'cc.PostSettingsInfo', _toneMappingType: 0 }
]
writeFileSync(join(assets, 'scenes/main.scene'), JSON.stringify(scene, null, 2))
console.log(`meta ${metas.length} 个 + main.scene 生成完成`)
console.log(`scene uuid=${sceneUuid}  组件 uuid=${scriptUuid}  压缩类型=${COMPONENT_TYPE}`)
