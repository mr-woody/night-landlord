# Creator 原生工程接入实录（P6，ADR-9 方案 a）——已于 M2.5 执行完成

> 状态：**✅ 已执行**（2026-08-30，Creator 3.8.8）。执行走 headless 路线（编辑器窗口为 GPU surface 不可自动化时，手写场景/meta + CLI 构建是唯一可验证路径），与下文原预案的差异以下述实录为准。
> 结果：`creator/build/wechatgame/` 完整小游戏（appid=M2 同款），微信开发者工具 `cli open` → `✔ open` exit=0（门⑥）。

## 实际执行步骤（与预案差异加粗）

1. **引擎获取**：Dashboard 未装且 T7 盘 IO 挂起——直接用官方版本 API（creator-api.cocos.com editor_version_list）拿直链，curl 下载 3.8.8 mac 包（1127MB）解压到 /Applications，`xattr -dr com.apple.quarantine` 清隔离。编辑器打开工程**无登录门槛**。
2. **工程创建**：手写 `creator/package.json`（uuid + creator.version=3.8.8 + type=2d）——编辑器/CLI 打开时自动补 settings/、profiles/、library/、temp/。
3. **逻辑接入**：`scripts/sync-creator.mjs`（npm run sync:creator）——packages→`assets/scripts/shared`、headless sim→`shared-headless`、**whitebox 纯模块→`whitebox-core`**（theme.ts 的 JSON import 改写为生成的 `theme-data.ts`、相对导入去 .ts 扩展、指向 packages/sim 的 import type 改写为工程内路径）、五表→生成的 `shared-tables/tables.ts`。校验和写 `creator-sync.json`。
4. **三屏移植**：`assets/scripts/whitebox-fragment/WhiteboxMain.ts`（路线 A RawCanvas2D 桥）——离屏画布（web=document/wx=wx.createCanvas 兜底）+ `ImageAsset/Texture2D/SpriteFrame` + 每帧 `uploadData`；触摸 `getUILocation()` → `hitTest` → 相位/模态分发。渲染/状态/动效零重写。
5. **场景**：`scripts/gen-creator-scene.mjs`（npm run gen:creator-scene）——确定性 meta（uuid=路径哈希派生，Creator 保留既有 uuid）+ 手写 3.8 序列化 `main.scene`（Canvas: UITransform+Widget+cc.Canvas+WhiteboxMain，子节点正交 Camera；SceneGlobals 全默认）。**未用 GUI**。
6. **构建**：CLI `--build` 接受 **`key=value;` 分号串**（JSON 文件路径会被当任务名忽略）：
   `CocosCreator --project <p> --build "taskName=wechatgame;platform=wechatgame;outputName=wechatgame;debug=true;buildPath=project://build;startScene=<scene uuid>"`
7. **收尾**：生成物 `project.config.json` 的占位 appid 替换为 M2 appid（wx6be7146eb0d60752）→ `cli open --project …/build/wechatgame` → `✔ open` exit=0。

## 完成定义核销（对照原预案 §五）

- [x] Creator 工程建成且场景有效（CLI 构建识别 scene uuid=78ec8124…；`[[Executor]] Register WhiteboxMain` 编译注册成功）
- [x] 三屏代码进入微信构建包（assets/main/index.js 266KB：布防×7/夜战×15/物资雨×3/BLOOD_MOON×11/runSimulation×5）
- [x] 门⑥：`cli open` exit=0
- [x] 台账 P6/门⑥ 翻绿（docs/M2.5-证据台账.md）
- [ ] Creator 预览器内逐帧运行时演示（属运行时联调，非门⑥验收项；CUA 无法投影 Creator GPU 窗口，留 M3 与路线 B 一起做）

