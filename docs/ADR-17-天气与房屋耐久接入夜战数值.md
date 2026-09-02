# ADR-17：天气与房屋耐久系数接入夜战数值（M3.3 草案，待批准）

> 状态：**Accepted → Implemented**（2026-09-03 用户批准；同日实施 V15/V16 回归门与 runNight env 单点）
> 关联：战斗演出与天气系统设计 §3.3/§1.2、M0 数值契约（C1）、FINDING F-5/F-6（M3.2 台账）
> 决策人：用户 · 起草：Project RN · 2026-08-31

## 1. 背景与问题

M3.2 已交付天气引擎（6 天气，确定性序列）与房屋进化（6 级，durability 0.8–1.5），当前均为**表现层+探索层系数**，夜战数值未接入（K-W1 决议：暂缓走 ADR）。本 ADR 补上该决策：

- 不接入的代价：天气/房屋停留在视觉层，「天气影响生存压力」「房屋进化=防御成长」的设定落不了地，塔防深度受损；
- 直接接入的风险：M0 数值契约在 D1–30 锚点窗口冻结（C1），任何威胁/防御系数扰动都会移动 β_sim/ΣI/r(7)，V5/V9/V10 硬门被破坏。

## 2. 决策（方案 B：锚点窗口系数恒等 + D31+ 生效）

### 2.1 时间维度

| 窗口 | 系数 | 理由 |
|---|---|---|
| D1–30（M0 锚点窗口） | **恒等 1**（天气与耐久完全不影响夜战数值） | C1 冻结；V0–V12 逐字节复跑保绿 |
| D31+（赛季/延长期） | 生效（§2.2 公式） | day_curve v2 扩展行由数值组按新公式调参 |

### 2.2 公式（D31+ 生效）

```
threat_eff(d) = threat(d) × W(d)                    # 天气威胁系数
防效_eff = defense.power × durability(houseLevel)    # 房屋耐久系数
r_eff    = 防效_eff / threat_eff                     # 替代既有 r（仅 D31+）
```

- `W(d)`：雨=1.05、雾=1.0（雾走情报降级不走数值）、雪=1.0、血月尘暴=1.10、晴/阴=1.0（常量入 weather.json：`nightThreatAdd`，键命名延续 weather 表字段白名单）；
- `durability(houseLevel)`：building_def.house 表既有 0.8–1.5；
- 二者均整数化进 `threat_eff` 后再进判定，保证确定性（RNG 流不变）。

### 2.3 实现落点（单一接入点）

- `runNight` 增可选 `env?: { threatMul?: number; durability?: number }`（加法参数，缺省=1，D1–30 路径零变化）；
- director 在 D31+ 组装 env；表现层/世界层不触碰；
- 存档兼容：BattleSession 增字段走加法，旧档迁移缺省。

## 3. 回归门（新增/调整）

| 门 | 窗口 | 断言 |
|---|---|---|
| V0–V12（既有） | D1–30 | **零变化**（系数恒等窗口内模拟行为与今日逐字节一致） |
| V13（既有） | 探索 | 不变（天气 gather/encounter 系数已生效，与夜战无关） |
| **V15（新）** | D31–60 | 天气开启 vs 全晴天基线：破防率差落设计区间（初值 +5%~+15%），不变量零违规 |
| **V16（新）** | D31–60 | 耐久系数：Lv5 房屋破防率较 Lv0 单调下降 |

## 4. 前置条件与排期

1. 用户批准本 ADR → Accepted；
2. day_curve v2 扩展 D31–60 行（数值组，按 §2.2 公式带天气/耐久重算）——M0 v2 任务；
3. systems `runNight` env 参数 + V15/V16 门实现 → M3.4；
4. B/C 栋与房屋升级产线（M3.2 F7）提供 houseLevel 数据源。

## 5. 后果

- 正面：天气/房屋进化获得游戏性意义（塔防深度），锚点窗口零风险，扩展可测；
- 负面/成本：day_curve v2 数值组工作量；V15/V16 两门维护；
- 中性：表现层（本档 §10）不依赖本 ADR，已可独立上线演示。

## 6. 实施记录（2026-09-03）

| 项 | 内容 | 证据 |
|---|---|---|
| runNight env 单点 | 第 4 可选参数 `env?: { threatMul?, durability? }`——threat_eff=threat×mul、防效_eff=power×durability；缺省恒等，D1–30 逐字节零变化（V4 determinism b666e7fc 不变） | packages/systems/src/index.ts |
| director D31+ 组装 | planNight 当 day>30 组装 plan.env：threatMul=weather.nightThreatAdd、durability=最高房屋等级耐久（building_def.house）；D1–30 不携带 | apps/headless/src/sim.ts |
| 配套状态/表 | GameState.houseLevels（加法+旧档迁移 `??= {}`）；weather.json v2 += nightThreatAdd×6（雨1.05/血月尘暴1.10/余1.0） | config/weather.json |
| V15 ✅ | 施效天气子集（雨/血月尘暴交替）60 夜×6 路合成场景：基线 38.9% → 开启 47.2%（**+8.3pp 落设计窗 [+5,+15]**） | verify ALL GREEN |
| V16 ✅ | 耐久 Lv0(0.8)/Lv2(1.0)/Lv5(1.5)：84.7%→47.2%→1.7% 单调降 | 同上 |
| 单测 | runNight env 缺省恒等零变化 + threatMul/durability 精确生效（95 tests 全过） | packages/systems/tests/systems.test.ts |
| 遗留 | day_curve v2 D31–60 行（数值组按 §2.2 重算）——V15/V16 现以合成场景直击 runNight 单点，不依赖 v2 | — |
