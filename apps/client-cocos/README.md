# apps/client-cocos（M1 集成套件）

ADR-9 方案 (a)：共享逻辑包经 `scripts/sync-cocos.mjs` 同步进本目录的
`assets/scripts/shared/`（跨包导入 `@rn/*` 自动改写为相对路径，并生成
`manifest.json` 校验和清单防漂移）。

## 人工验证步骤（微信构建门，M1 验收门③）

1. Cocos Creator 3.x 新建 2D 竖屏空工程（或打开既有工程）。
2. 把本目录 `assets/` 整体拷入工程的 assets 下。
3. 等 Cocos 编译通过、无红色报错（这就证明共享逻辑包可在 Cocos/TS 管线编译）。
4. 新建空场景，挂 `assets/scripts/Main.ts` 到任一节点，预览运行，控制台应输出
   `kernel boot ok` 与 `income(D1)=1000`。
5. 构建为微信小游戏（构建面板 → 微信小游戏），用微信开发者工具打开 build 目录，
   确认编译通过并可运行。

以上 5 步全部通过 = 验收门③ 通过；结果记录到 `docs/M1-证据台账.md`。
同步脚本漂移检查：`node scripts/sync-cocos.mjs --check`（CI 中执行）。
