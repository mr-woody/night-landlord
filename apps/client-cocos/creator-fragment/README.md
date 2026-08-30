# Creator 原生工程接入预案（P6，ADR-9 方案 a）

> 状态：**待引擎**——本预案由 M2.5 会话预置（2026-08-30）。Cocos Creator 3.x 二进制到位后，按本清单执行即可完成功能点 6 与验收门⑥。
> 前置事实：白盒渲染层已拆分为**引擎无关纯 TS**（`whitebox/theme.ts` tokens 桥、`layout.ts` 几何、`state.ts` 状态机、`anim.ts` 时间线）+ 单文件 Canvas 渲染器（`renderer.ts`），逻辑侧 sync 产物已就绪（`npm run sync:cocos` → `assets/scripts/shared/`，`check-cocos-shared` standalone strict 编译通过）。

## 一、工程创建（Creator 就位后第一步）

1. 打开 Cocos Dashboard → 安装/选用 Creator 3.x → 新建空白工程（Empty 模板），工程目录选 `apps/client-cocos/creator/`（与 `assets/`、`minigame/` 平级，不污染现有目录）。
2. 项目设置：设计分辨率 **750×1624**（与白盒 `layout.ts DESIGN_W/H` 一致），适配策略 fitWidth，方向竖屏。
3. 构建目标预置：微信小游戏（appid/服务端口沿用 `minigame/project.config.json` 的 M2 配置）。

## 二、逻辑接入（方案 a，零新增动作）

- `npm run sync:cocos` 已把 `packages/*/src` 写入 `assets/scripts/shared/`（相对路径改写 + manifest 校验和）。在 Creator 中该目录即普通资产；`npm run check:cocos` 随时验证 standalone 严格编译。

## 三、白盒三屏移植（主界面 / 夜战 / 收租结算）

两条适配路线，P6 走 A（最低风险），正式美术迁移（M3）走 B：

- **A. RawCanvas2D 桥（P6 采用）**：场景放一个全屏 UI 节点挂 `whitebox-main.ts` 组件，`onLoad` 拿屏幕 WebGL/2D 画布上下文后，直接调用现有 `WhiteboxRenderer`（输入桥：Creator 触摸事件 → `hitTest`；rAF 桥：`director.on(EventType.BEFORE_UPDATE)` 或组件 update）。三屏 = `state.ts` 四相状态机驱动 `renderer.draw` 分支，**渲染代码零重写**。
  - 需写的新代码仅两个组件文件：`whitebox-main.ts`（生命周期+输入桥）与 `whitebox-env.ts`（`performance.now`/画布尺寸注入）。放 `creator/assets/scripts/whitebox-fragment/`。
  - 注意：`ctx.roundRect` 需 Creator 运行时 2D 上下文支持（Chrome/微信基础库 ≥2.25 均已支持；不满足时 polyfill ≤10 行，预案内含）。
- **B. 原生 2D 节点重绘（M3）**：按 `layout.ts` 的 Rect 表生成 Sprite/Label 节点树，tokens 从 `theme.ts` 注入——与 2D 美术资产规范 §八控件皮肤对齐后切换。

## 四、门⑥复跑（微信构建回归）

```bash
# Creator 图形界面构建一次微信小游戏（输出目录指向 apps/client-cocos/minigame/）
# 随后命令行回归（同 M2 门③路径）：
"/Applications/wechatwebdevtools.app/Contents/MacOS/cli" open --project "$(pwd)/apps/client-cocos/minigame"
# 验收：✔ open，exit=0
```

## 五、完成定义（对照可执行目标 §二.6/§三⑥）

- [ ] Creator 工程建成且能打开场景（截图）
- [ ] 三屏（DAY 主界面/NIGHT 夜战/DAWN 结算）在 Creator 预览中可交互演示
- [ ] Creator 构建产物微信回归 `cli open` exit=0
- [ ] 台账 P6/门⑥ 状态翻绿（docs/M2.5-证据台账.md）
