// 生成产物（scripts/sync-creator.mjs，源=config/*.json）——勿手改
export const TABLES = {
  day_curve: {
  "version": 1,
  "sourceDoc": "docs/M0-数值模型-三曲线调参表.md §5",
  "bloodMoonDays": [7, 14, 21, 28],
  "rows": [
    { "day": 0,  "population": 3,  "q": 0.9,  "u": 1.0,  "income": 270,   "hp": 87,   "routes": 1, "threat": 87,    "rTarget": 1.40, "fReq": 122,   "deaths": 0, "ads": 0, "milestone": "教学：首夜必胜+首次收租" },
    { "day": 1,  "population": 10, "q": 1.0,  "u": 1.0,  "income": 1000,  "hp": 100,  "routes": 1, "threat": 100,   "rTarget": 1.35, "fReq": 135,   "deaths": 0, "ads": 2, "milestone": "救援第1个邻居，保人=赚钱" },
    { "day": 2,  "population": 14, "q": 1.04, "u": 1.05, "income": 1534,  "hp": 115,  "routes": 1, "threat": 115,   "rTarget": 1.30, "fReq": 150,   "deaths": 0, "ads": 3, "milestone": "广播站解锁，人口跳涨" },
    { "day": 3,  "population": 15, "q": 1.08, "u": 1.11, "income": 1798,  "hp": 132,  "routes": 1, "threat": 132,   "rTarget": 1.25, "fReq": 165,   "deaths": 0, "ads": 4, "milestone": "仓库扩容软卡点+开门抉择" },
    { "day": 4,  "population": 16, "q": 1.11, "u": 1.17, "income": 2095,  "hp": 152,  "routes": 2, "threat": 304,   "rTarget": 1.20, "fReq": 365,   "deaths": 0, "ads": 4, "milestone": "首次2路攻防" },
    { "day": 5,  "population": 18, "q": 1.15, "u": 1.24, "income": 2572,  "hp": 175,  "routes": 2, "threat": 350,   "rTarget": 1.18, "fReq": 413,   "deaths": 0, "ads": 5, "milestone": "恐慌/秩序教学" },
    { "day": 6,  "population": 19, "q": 1.19, "u": 1.31, "income": 2959,  "hp": 201,  "routes": 2, "threat": 402,   "rTarget": 1.10, "fReq": 442,   "deaths": 0, "ads": 6, "milestone": "异象与血月预告" },
    { "day": 7,  "population": 20, "q": 1.23, "u": 1.38, "income": 3392,  "hp": 370,  "routes": 3, "threat": 1110,  "rTarget": 1.02, "fReq": 1132,  "deaths": 1, "ads": 6, "milestone": "第一次血月+首充曝光" },
    { "day": 8,  "population": 20, "q": 1.26, "u": 1.45, "income": 3662,  "hp": 266,  "routes": 3, "threat": 798,   "rTarget": 1.20, "fReq": 958,   "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 9,  "population": 21, "q": 1.29, "u": 1.53, "income": 4148,  "hp": 306,  "routes": 3, "threat": 918,   "rTarget": 1.18, "fReq": 1083,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 10, "population": 22, "q": 1.32, "u": 1.62, "income": 4687,  "hp": 352,  "routes": 3, "threat": 1055,  "rTarget": 1.15, "fReq": 1214,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 11, "population": 22, "q": 1.34, "u": 1.71, "income": 5052,  "hp": 405,  "routes": 3, "threat": 1214,  "rTarget": 1.13, "fReq": 1371,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 12, "population": 23, "q": 1.37, "u": 1.8,  "income": 5690,  "hp": 465,  "routes": 4, "threat": 1861,  "rTarget": 1.10, "fReq": 2047,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 13, "population": 24, "q": 1.4,  "u": 1.9,  "income": 6395,  "hp": 535,  "routes": 4, "threat": 2140,  "rTarget": 1.05, "fReq": 2247,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 14, "population": 24, "q": 1.43, "u": 2.01, "income": 6884,  "hp": 984,  "routes": 5, "threat": 4922,  "rTarget": 1.00, "fReq": 4922,  "deaths": 1, "ads": 6, "milestone": "赛季Boss前哨+战令/月卡曝光" },
    { "day": 15, "population": 25, "q": 1.45, "u": 2.12, "income": 7656,  "hp": 708,  "routes": 4, "threat": 2830,  "rTarget": 1.18, "fReq": 3340,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 16, "population": 25, "q": 1.46, "u": 2.23, "income": 8172,  "hp": 814,  "routes": 5, "threat": 4069,  "rTarget": 1.15, "fReq": 4679,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 17, "population": 26, "q": 1.48, "u": 2.36, "income": 9072,  "hp": 936,  "routes": 5, "threat": 4679,  "rTarget": 1.12, "fReq": 5240,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 18, "population": 26, "q": 1.5,  "u": 2.48, "income": 9681,  "hp": 1076, "routes": 5, "threat": 5381,  "rTarget": 1.10, "fReq": 5919,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 19, "population": 26, "q": 1.52, "u": 2.62, "income": 10331, "hp": 1238, "routes": 5, "threat": 6188,  "rTarget": 1.08, "fReq": 6683,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 20, "population": 27, "q": 1.53, "u": 2.77, "income": 11446, "hp": 1423, "routes": 5, "threat": 7116,  "rTarget": 1.05, "fReq": 7472,  "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 21, "population": 27, "q": 1.55, "u": 2.92, "income": 12211, "hp": 2619, "routes": 6, "threat": 15712, "rTarget": 1.02, "fReq": 16026, "deaths": 1, "ads": 6, "milestone": "第三次血月，6路峰值" },
    { "day": 22, "population": 27, "q": 1.56, "u": 3.08, "income": 13002, "hp": 1882, "routes": 5, "threat": 9411,  "rTarget": 1.15, "fReq": 10822, "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 23, "population": 28, "q": 1.58, "u": 3.25, "income": 14357, "hp": 2164, "routes": 5, "threat": 10822, "rTarget": 1.12, "fReq": 12121, "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 24, "population": 28, "q": 1.59, "u": 3.43, "income": 15285, "hp": 2489, "routes": 5, "threat": 12446, "rTarget": 1.10, "fReq": 13690, "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 25, "population": 28, "q": 1.61, "u": 3.61, "income": 16272, "hp": 2863, "routes": 5, "threat": 14313, "rTarget": 1.08, "fReq": 15458, "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 26, "population": 29, "q": 1.62, "u": 3.81, "income": 17940, "hp": 3292, "routes": 5, "threat": 16459, "rTarget": 1.06, "fReq": 17447, "deaths": 0, "ads": 6, "milestone": "" },
    { "day": 27, "population": 29, "q": 1.64, "u": 4.02, "income": 19095, "hp": 3786, "routes": 5, "threat": 18928, "rTarget": 1.03, "fReq": 19496, "deaths": 1, "ads": 6, "milestone": "" },
    { "day": 28, "population": 29, "q": 1.65, "u": 4.24, "income": 20323, "hp": 6966, "routes": 6, "threat": 41794, "rTarget": 1.00, "fReq": 41794, "deaths": 1, "ads": 6, "milestone": "最后血月（最深付费墙）" },
    { "day": 29, "population": 30, "q": 1.67, "u": 4.48, "income": 22374, "hp": 5007, "routes": 5, "threat": 25033, "rTarget": 1.10, "fReq": 27536, "deaths": 0, "ads": 6, "milestone": "喘息：防御预算转发展" },
    { "day": 30, "population": 30, "q": 1.68, "u": 4.72, "income": 23810, "hp": 5758, "routes": 5, "threat": 28788, "rTarget": 1.15, "fReq": 33106, "deaths": 0, "ads": 6, "milestone": "第1栋满层，解锁第2栋+夜王预告" }
  ]
}
,
  constants: {
  "version": 2,
  "sourceDoc": "docs/M0-数值模型-三曲线调参表.md §2 / docs/技术架构与模块规划 v1.0 §5.3 / docs/数据配置表结构设计 §3 / docs/数据配置表结构设计.md §9.5",
  "entries": [
    {
      "key": "CFG_R0",
      "value": 100,
      "min": 50,
      "max": 200,
      "desc": "N品质住户基准日产出（金币/天）",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_G_U",
      "value": 1.055,
      "min": 1.05,
      "max": 1.06,
      "desc": "户均升级系数日增长",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_G_T",
      "value": 1.15,
      "min": 1.14,
      "max": 1.17,
      "desc": "强度日指数",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_HP0",
      "value": 100,
      "min": 50,
      "max": 150,
      "desc": "单怪基准HP",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_J_BM",
      "value": 1.6,
      "min": 1.45,
      "max": 1.8,
      "desc": "血月跳变倍率",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_K_POWER",
      "value": 2.6,
      "min": 2.2,
      "max": 3.0,
      "desc": "金币/战力点转化成本",
      "sourceDoc": "M0 §2"
    },
    {
      "key": "CFG_ECPM",
      "value": 45,
      "min": 30,
      "max": 80,
      "desc": "激励视频 eCPM（元）",
      "sourceDoc": "M0 §7.1"
    },
    {
      "key": "CFG_QUALITY_MUL_N",
      "value": 1,
      "min": 1,
      "max": 1,
      "desc": "N品质产出倍率",
      "sourceDoc": "M0 §1 品质权重"
    },
    {
      "key": "CFG_QUALITY_MUL_R",
      "value": 1.5,
      "min": 1.5,
      "max": 1.5,
      "desc": "R品质产出倍率",
      "sourceDoc": "M0 §1"
    },
    {
      "key": "CFG_QUALITY_MUL_SR",
      "value": 2.5,
      "min": 2.5,
      "max": 2.5,
      "desc": "SR品质产出倍率",
      "sourceDoc": "M0 §1"
    },
    {
      "key": "CFG_QUALITY_MUL_SSR",
      "value": 5,
      "min": 5,
      "max": 5,
      "desc": "SSR品质产出倍率",
      "sourceDoc": "M0 §1"
    },
    {
      "key": "PANIC_MAX",
      "value": 100,
      "min": 100,
      "max": 100,
      "desc": "单户恐慌上限",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_ESCAPE_AT",
      "value": 70,
      "min": 60,
      "max": 80,
      "desc": "出逃恐慌阈值",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_ESCAPE_P",
      "value": 0.15,
      "min": 0.1,
      "max": 0.2,
      "desc": "达阈值后每日出逃概率",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_DECAY",
      "value": 10,
      "min": 5,
      "max": 15,
      "desc": "每日恐慌自然衰减",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_PROP_FLOOR",
      "value": 5,
      "min": 3,
      "max": 8,
      "desc": "同层破防恐慌传播量",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_MEAN_PENALTY_AT",
      "value": 50,
      "min": 40,
      "max": 60,
      "desc": "全楼均值恐慌产出惩罚阈值",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "PANIC_MEAN_PENALTY",
      "value": 0.9,
      "min": 0.8,
      "max": 0.95,
      "desc": "超阈值后户产乘数",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "TUTORIAL_PANIC_CAP",
      "value": 30,
      "min": 20,
      "max": 40,
      "desc": "D1–D7 教学段恐慌封顶",
      "sourceDoc": "v1.0 §5.3"
    },
    {
      "key": "GUARD_DEATH_DAY",
      "value": 4,
      "min": 3,
      "max": 4,
      "desc": "单日死亡护栏",
      "sourceDoc": "M0 §4.3"
    },
    {
      "key": "GUARD_DEATH_30D",
      "value": 6,
      "min": 4,
      "max": 8,
      "desc": "30 日累计死亡护栏",
      "sourceDoc": "M0 §4.3"
    },
    {
      "key": "STAB_J_ADJUST_MIN",
      "value": 0.9,
      "min": 0.85,
      "max": 0.95,
      "desc": "灾难调制下限",
      "sourceDoc": "内核档 §5.5"
    },
    {
      "key": "STAB_J_ADJUST_MAX",
      "value": 1.1,
      "min": 1.05,
      "max": 1.15,
      "desc": "灾难调制上限",
      "sourceDoc": "内核档 §5.5"
    },
    {
      "key": "M1_RECRUIT_GOLD",
      "value": 150,
      "min": 100,
      "max": 300,
      "desc": "M1 白盒招募单价（金币/人）",
      "sourceDoc": "M1 实现"
    },
    {
      "key": "M1_ROOM_GOLD",
      "value": 100,
      "min": 50,
      "max": 300,
      "desc": "M1 白盒建房单价（金币/间）",
      "sourceDoc": "M1 实现"
    },
    {
      "key": "UPGRADE_BASE",
      "value": 0.5,
      "min": 0.5,
      "max": 10,
      "desc": "住户升级基础成本（金币，M2 FINDING-1 闭环）",
      "sourceDoc": "M2 可执行目标 功能点1"
    },
    {
      "key": "UPGRADE_GROWTH",
      "value": 1.18,
      "min": 1.18,
      "max": 1.18,
      "desc": "升级成本级增系数（合同固定）",
      "sourceDoc": "M2 可执行目标 功能点1"
    },
    {
      "key": "GUARD_POWER",
      "value": 15,
      "min": 10,
      "max": 25,
      "desc": "守卫岗位战力贡献",
      "sourceDoc": "M2 功能点4"
    },
    {
      "key": "CLINIC_HEAL_HP",
      "value": 10,
      "min": 5,
      "max": 20,
      "desc": "医务室每级治疗 HP",
      "sourceDoc": "M2 功能点4"
    },
    {
      "key": "CURFEW_DECAY_BONUS",
      "value": 5,
      "min": 3,
      "max": 8,
      "desc": "宵禁公约恐慌衰减加成",
      "sourceDoc": "M2 功能点4"
    },
    {
      "key": "EXPLORE_STAMINA_MAX",
      "value": 100,
      "min": 80,
      "max": 150,
      "desc": "住户体力上限（外出探索消耗池）",
      "sourceDoc": "世界观与空间结构设计 §4"
    },
    {
      "key": "EXPLORE_STAMINA_COST_BASE",
      "value": 20,
      "min": 10,
      "max": 45,
      "desc": "外出基础体力消耗（explore_def.staminaCost 为区域加成基准）",
      "sourceDoc": "世界观与空间结构设计 §4"
    },
    {
      "key": "EXPLORE_TIME_BASE",
      "value": 1,
      "min": 1,
      "max": 2,
      "desc": "外出基础时间片消耗",
      "sourceDoc": "世界观与空间结构设计 §4"
    },
    {
      "key": "EXPLORE_NIGHT_DANGER_MUL",
      "value": 2.0,
      "min": 1.5,
      "max": 3.0,
      "desc": "夜晚野外遭遇/危险倍率",
      "sourceDoc": "世界观与空间结构设计 §4.2"
    },
    {
      "key": "EXPLORE_YIELD_TARGET_D8",
      "value": 480,
      "min": 288,
      "max": 672,
      "desc": "D8 累计野外产出折算锚点（食物/水=1、建材=2；实测校准 2026-08-31）",
      "sourceDoc": "世界观与空间结构设计 §9.6"
    },
    {
      "key": "EXPLORE_YIELD_TARGET_D30",
      "value": 2400,
      "min": 1440,
      "max": 3360,
      "desc": "D30 累计野外产出折算锚点（实测校准 2026-08-31）",
      "sourceDoc": "世界观与空间结构设计 §9.6"
    },
    {
      "key": "WILDLIFE_FIGHT_WIN_BASE",
      "value": 0.7,
      "min": 0.5,
      "max": 0.85,
      "desc": "危险野物战斗基础胜率（战力修正前）",
      "sourceDoc": "世界观与空间结构设计 §4.2"
    },
    {
      "key": "EXPLORE_PARTY_MAX",
      "value": 3,
      "min": 1,
      "max": 3,
      "desc": "外出队伍人数上限",
      "sourceDoc": "世界观与空间结构设计 §4.2"
    }
  ]
}
,
  building_def: {
  "version": 2,
  "sourceDoc": "docs/数据配置表结构设计.md §7（公共建筑：设计方案 4.1）",
  "entries": [
    {
      "type": "room",
      "level": 1,
      "cost": {
        "gold": 300
      },
      "slots": {
        "tenant": 1,
        "fort": 2
      },
      "unlockDay": 0
    },
    {
      "type": "canteen",
      "level": 1,
      "cost": {
        "gold": 0
      },
      "capacity": 10
    },
    {
      "type": "canteen",
      "level": 2,
      "cost": {
        "gold": 500
      },
      "capacity": 14
    },
    {
      "type": "canteen",
      "level": 3,
      "cost": {
        "gold": 1000
      },
      "capacity": 18
    },
    {
      "type": "canteen",
      "level": 4,
      "cost": {
        "gold": 2500
      },
      "capacity": 24
    },
    {
      "type": "canteen",
      "level": 5,
      "cost": {
        "gold": 5000
      },
      "capacity": 30
    },
    {
      "type": "warehouse",
      "level": 1,
      "cost": {
        "gold": 0
      },
      "capacity": 5000
    },
    {
      "type": "warehouse",
      "level": 2,
      "cost": {
        "gold": 800
      },
      "capacity": 12000
    },
    {
      "type": "warehouse",
      "level": 3,
      "cost": {
        "gold": 2500
      },
      "capacity": 30000
    },
    {
      "type": "broadcast",
      "level": 1,
      "cost": {
        "gold": 600
      },
      "unlockDay": 2
    },
    {
      "type": "broadcast",
      "level": 2,
      "cost": {
        "gold": 1800
      },
      "unlockDay": 8
    },
    {
      "type": "watchtower",
      "level": 1,
      "cost": {
        "gold": 0
      },
      "capacity": 1
    },
    {
      "type": "watchtower",
      "level": 2,
      "cost": {
        "gold": 400
      },
      "capacity": 2
    },
    {
      "type": "watchtower",
      "level": 3,
      "cost": {
        "gold": 1200
      },
      "capacity": 3
    },
    {
      "type": "clinic",
      "level": 1,
      "cost": {
        "gold": 800
      }
    },
    {
      "type": "hall",
      "level": 1,
      "cost": {
        "gold": 800
      }
    },
    {
      "type": "workshop",
      "level": 1,
      "cost": {
        "gold": 800
      }
    },
    {
      "type": "house",
      "level": 0,
      "cost": {},
      "durability": 0.8,
      "unlockDay": 1,
      "desc": "房屋进化 Lv0（战斗演出与天气系统设计 §1.2）"
    },
    {
      "type": "house",
      "level": 1,
      "cost": {
        "material": 50
      },
      "durability": 0.9,
      "unlockDay": 1,
      "desc": "房屋进化 Lv1（战斗演出与天气系统设计 §1.2）"
    },
    {
      "type": "house",
      "level": 2,
      "cost": {
        "material": 150
      },
      "durability": 1.0,
      "unlockDay": 2,
      "desc": "房屋进化 Lv2（战斗演出与天气系统设计 §1.2）"
    },
    {
      "type": "house",
      "level": 3,
      "cost": {
        "material": 400,
        "gold": 200
      },
      "durability": 1.15,
      "unlockDay": 8,
      "desc": "房屋进化 Lv3（战斗演出与天气系统设计 §1.2）"
    },
    {
      "type": "house",
      "level": 4,
      "cost": {
        "material": 800,
        "gold": 500
      },
      "durability": 1.3,
      "unlockDay": 15,
      "desc": "房屋进化 Lv4（战斗演出与天气系统设计 §1.2）"
    },
    {
      "type": "house",
      "level": 5,
      "cost": {
        "material": 1500,
        "gold": 1200
      },
      "durability": 1.5,
      "unlockDay": 22,
      "desc": "房屋进化 Lv5（战斗演出与天气系统设计 §1.2）"
    }
  ]
}
,
  event_lib: {
  "version": 3,
  "sourceDoc": "docs/M0-事件文案库50条.md",
  "scope": "M2：50 条全量（scripted 8 / choice 24 / mission 10 / ord 8）",
  "entries": [
    {
      "id": "evt_tut_fortify",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 0,
      "title": "门口的抓痕",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "门板上有新鲜的抓痕……趁天还没黑，加固它。",
      "options": [
        {
          "label": "加固门（教学引导）",
          "outcomes": [
            {
              "p": 1.0,
              "text": "门板吱呀作响，但结实了。",
              "effects": []
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_firstnight",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 0,
      "title": "第 1 夜动员",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "入夜前，把有限的人手布到最可能有问题的位置。",
      "options": [
        {
          "label": "布防引导",
          "outcomes": [
            {
              "p": 1.0,
              "text": "夜色压下来，楼里安静得能听见心跳。",
              "effects": []
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_rescue",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 1,
      "title": "隔壁的呼救",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "「救命——还有人吗！」",
      "options": [
        {
          "label": "派主角去救",
          "outcomes": [
            {
              "p": 1.0,
              "text": "拖回来一个浑身发抖的幸存者。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_referral",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 2,
      "title": "老张说：我还有俩邻居",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "「他们人不错，就在下一条街。」",
      "options": [
        {
          "label": "接引",
          "outcomes": [
            {
              "p": 1.0,
              "text": "一老一少，行李都没丢。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_broadcast",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 2,
      "title": "广播站第一通广播",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "「这里是 7 号楼，我们收留活人。」",
      "options": [
        {
          "label": "招募",
          "outcomes": [
            {
              "p": 1.0,
              "text": "当天下午，门口排起了队。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -100
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_bills",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 3,
      "title": "第一笔「物业费」",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "住进来可以，但规矩得立：按天交租。",
      "options": [
        {
          "label": "收租",
          "outcomes": [
            {
              "p": 1.0,
              "text": "金币入袋的声音，比枪声好听。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 300
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_panic",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 5,
      "title": "有人半夜偷哭",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "恐慌像霉斑，会顺着楼板蔓延。",
      "options": [
        {
          "label": "逐户安抚",
          "outcomes": [
            {
              "p": 1.0,
              "text": "哭声停了。人心，也是要修的。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -10
                },
                {
                  "op": "SET_FLAG",
                  "key": "orderIntro",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tut_omen",
      "ver": 1,
      "type": "scripted",
      "triggerDay": 6,
      "title": "风向不对",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 0,
      "text": "狗不叫了。风里有铁锈味。",
      "options": [
        {
          "label": "登高观星",
          "outcomes": [
            {
              "p": 1.0,
              "text": "月亮是红的。明天，是血月。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "bloodmoonForetold",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_knock_001",
      "ver": 1,
      "type": "choice",
      "title": "深夜敲门人",
      "weight": 100,
      "cooldownDays": 5,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 3
      },
      "text": "「咚、咚、咚。」深夜的敲门声比怪物的嚎叫更瘆人。",
      "options": [
        {
          "label": "开门",
          "outcomes": [
            {
              "p": 0.7,
              "text": "是一家三口，当家的还懂水电。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "R"
                }
              ]
            },
            {
              "p": 0.3,
              "text": "它的皮肤在月光下剥落了……",
              "effects": [
                {
                  "op": "NIGHT_MOD",
                  "mod": "SILENT"
                }
              ]
            }
          ]
        },
        {
          "label": "隔门询问",
          "outcomes": [
            {
              "p": 1.0,
              "text": "对话几句后脚步声远去。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "无视",
          "outcomes": [
            {
              "p": 1.0,
              "text": "敲门声停了。你有点后悔。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_grain_002",
      "ver": 1,
      "type": "choice",
      "title": "邻居偷粮",
      "weight": 90,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 3
      },
      "text": "仓库少了两箱罐头，有人看见三楼的王磊昨晚鬼鬼祟祟。",
      "options": [
        {
          "label": "公审",
          "outcomes": [
            {
              "p": 1.0,
              "text": "秩序立住了，但人心惶惶。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 8
                },
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "私了",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他交回了一部分，这事翻篇。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 100
                }
              ]
            }
          ]
        },
        {
          "label": "放任",
          "outcomes": [
            {
              "p": 1.0,
              "text": "仓库的锁形同虚设。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 5
                },
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_box_003",
      "ver": 1,
      "type": "choice",
      "title": "阳台物资箱",
      "weight": 85,
      "cooldownDays": 5,
      "maxPerRun": 2,
      "prereq": {},
      "text": "六楼阳台吊下来一个密封箱，绳子上系着字条：「给有缘人」。",
      "options": [
        {
          "label": "独占",
          "outcomes": [
            {
              "p": 1.0,
              "text": "罐头与净水，全收。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 300
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "平分",
          "outcomes": [
            {
              "p": 1.0,
              "text": "按户分发，楼里多了些暖意。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -5
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "换情报",
          "outcomes": [
            {
              "p": 1.0,
              "text": "对面楼的眼线给了份巡逻图。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "intel",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_rent_004",
      "ver": 1,
      "type": "choice",
      "title": "老周欠租",
      "weight": 80,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "老周蹲在门口抽烟：「媳妇病着，这个月……宽限几天？」",
      "options": [
        {
          "label": "免租",
          "outcomes": [
            {
              "p": 1.0,
              "text": "老周红着眼眶连声道谢。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "照收",
          "outcomes": [
            {
              "p": 1.0,
              "text": "规矩就是规矩。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 500
                }
              ]
            }
          ]
        },
        {
          "label": "驱赶",
          "outcomes": [
            {
              "p": 1.0,
              "text": "行李被扔下楼，楼里没人说话。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 200
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_hoard_005",
      "ver": 1,
      "type": "choice",
      "title": "囤积者老李",
      "weight": 70,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "老李屋里堆满了物资，楼下却有人在挨饿。",
      "options": [
        {
          "label": "征用",
          "outcomes": [
            {
              "p": 1.0,
              "text": "物资充公，老李绝食抗议。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 400
                },
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            }
          ]
        },
        {
          "label": "分成",
          "outcomes": [
            {
              "p": 1.0,
              "text": "各让一步，仓库进账一半。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 200
                }
              ]
            }
          ]
        },
        {
          "label": "放任",
          "outcomes": [
            {
              "p": 1.0,
              "text": "秩序哨声在走廊回荡。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_dog_006",
      "ver": 1,
      "type": "choice",
      "title": "凌晨的狗吠",
      "weight": 65,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {},
      "text": "巷子里有条土狗，叫法很有规律——像在报信。",
      "options": [
        {
          "label": "收留",
          "outcomes": [
            {
              "p": 1.0,
              "text": "狗拴在一层大厅，夜里耳朵比人灵。",
              "effects": [
                {
                  "op": "GRANT_BUFF",
                  "buff": "warnDog",
                  "days": 3
                }
              ]
            }
          ]
        },
        {
          "label": "驱赶",
          "outcomes": [
            {
              "p": 1.0,
              "text": "狗跑了，夜里静得发慌。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 5
                }
              ]
            }
          ]
        },
        {
          "label": "无视",
          "outcomes": [
            {
              "p": 1.0,
              "text": "狗叫了一整夜。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_generator_007",
      "ver": 1,
      "type": "choice",
      "title": "柴油发电机",
      "weight": 70,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "隔壁楼捡来一台柴油发电机，开口就要分着用。",
      "options": [
        {
          "label": "小区共用",
          "outcomes": [
            {
              "p": 1.0,
              "text": "全楼灯火通明，恐慌消散不少。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -300
                },
                {
                  "op": "ADD_PANIC",
                  "n": -8
                }
              ]
            }
          ]
        },
        {
          "label": "自家备用",
          "outcomes": [
            {
              "p": 1.0,
              "text": "发电机锁进了你家储物间。",
              "effects": [
                {
                  "op": "GRANT_BUFF",
                  "buff": "power",
                  "days": 2
                }
              ]
            }
          ]
        },
        {
          "label": "出租",
          "outcomes": [
            {
              "p": 1.0,
              "text": "按小时计费，生意兴隆。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 400
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_divorce_008",
      "ver": 1,
      "type": "choice",
      "title": "二楼夫妻吵架",
      "weight": 60,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {},
      "text": "摔碗声隔着楼板都能听见。",
      "options": [
        {
          "label": "上门调解",
          "outcomes": [
            {
              "p": 1.0,
              "text": "两口子和好，还硬塞了两条烟。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -5
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "不掺和",
          "outcomes": [
            {
              "p": 1.0,
              "text": "吵吧，日子还长。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        },
        {
          "label": "趁机收房",
          "outcomes": [
            {
              "p": 1.0,
              "text": "房子到手，但你成了楼里的谈资。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 600
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_slingshot_009",
      "ver": 1,
      "type": "choice",
      "title": "孩子的弹弓",
      "weight": 55,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {},
      "text": "五楼的孩子拿弹弓打路灯，碎石乱飞。",
      "options": [
        {
          "label": "没收",
          "outcomes": [
            {
              "p": 1.0,
              "text": "孩子哭了半天，家长脸色难看。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "教导",
          "outcomes": [
            {
              "p": 1.0,
              "text": "孩子成了楼顶的瞭望哨。",
              "effects": [
                {
                  "op": "GRANT_BUFF",
                  "buff": "sentryKid",
                  "days": 3
                }
              ]
            }
          ]
        },
        {
          "label": "放任",
          "outcomes": [
            {
              "p": 1.0,
              "text": "玻璃又碎了一块。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 5
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_medicine_010",
      "ver": 1,
      "type": "choice",
      "title": "最后一批抗生素",
      "weight": 75,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "医务室只剩最后一板抗生素，三个人在排队。",
      "options": [
        {
          "label": "重患先得",
          "outcomes": [
            {
              "p": 1.0,
              "text": "该救的救了，人心安稳。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -5
                }
              ]
            }
          ]
        },
        {
          "label": "贡献者先得",
          "outcomes": [
            {
              "p": 1.0,
              "text": "多劳多得，站岗的劲头更足了。",
              "effects": [
                {
                  "op": "GRANT_BUFF",
                  "buff": "contrib",
                  "days": 3
                }
              ]
            }
          ]
        },
        {
          "label": "抽签",
          "outcomes": [
            {
              "p": 1.0,
              "text": "命运面前人人平等，情绪意外平稳。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_rumor_011",
      "ver": 1,
      "type": "choice",
      "title": "「明天怪不来了」",
      "weight": 70,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {},
      "text": "不知道谁传的：永夜要结束了，怪物明天就不来了。",
      "options": [
        {
          "label": "辟谣",
          "outcomes": [
            {
              "p": 1.0,
              "text": "大喇叭广播了三遍，谣言止住。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -6
                }
              ]
            }
          ]
        },
        {
          "label": "利用",
          "outcomes": [
            {
              "p": 1.0,
              "text": "「末日保险」卖得飞起。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 300
                },
                {
                  "op": "SET_FLAG",
                  "key": "trust",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "无视",
          "outcomes": [
            {
              "p": 1.0,
              "text": "有人真的不设防了。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 4
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_note_012",
      "ver": 1,
      "type": "choice",
      "title": "门缝里的纸条",
      "weight": 65,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 4
      },
      "text": "纸条上画着一个箭头，指向地下室的通风井。",
      "options": [
        {
          "label": "按纸条赴约",
          "outcomes": [
            {
              "p": 0.5,
              "text": "是个躲了半月的姑娘，手上功夫不错。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            },
            {
              "p": 0.5,
              "text": "通风井里只有抓痕和血迹。",
              "effects": [
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            }
          ]
        },
        {
          "label": "置之不理",
          "outcomes": [
            {
              "p": 1.0,
              "text": "纸条在门缝里发黄。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        },
        {
          "label": "烧掉",
          "outcomes": [
            {
              "p": 1.0,
              "text": "省得夜里胡思乱想。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 2
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_birthday_013",
      "ver": 1,
      "type": "choice",
      "title": "楼里第一个生日",
      "weight": 60,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {},
      "text": "今天是小雨的八岁生日，蛋糕是不可能的。",
      "options": [
        {
          "label": "办派对",
          "outcomes": [
            {
              "p": 1.0,
              "text": "搪瓷缸碰在一起，像过年的声音。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -200
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "取消",
          "outcomes": [
            {
              "p": 1.0,
              "text": "孩子没哭，大人心里不是滋味。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        },
        {
          "label": "双份口粮",
          "outcomes": [
            {
              "p": 1.0,
              "text": "全楼都跟着沾了光。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -300
                },
                {
                  "op": "ADD_PANIC",
                  "n": -5
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_thief_014",
      "ver": 1,
      "type": "choice",
      "title": "外楼的窃贼",
      "weight": 65,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "巡逻队逮了个现形，人赃并获。",
      "options": [
        {
          "label": "公审",
          "outcomes": [
            {
              "p": 1.0,
              "text": "秩序立威，围观者噤声。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                },
                {
                  "op": "ADD_PANIC",
                  "n": 4
                }
              ]
            }
          ]
        },
        {
          "label": "收编",
          "outcomes": [
            {
              "p": 0.4,
              "text": "开锁的手艺确实有用。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            },
            {
              "p": 0.6,
              "text": "第二晚，仓库的锁被从里面打开了。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -200
                }
              ]
            }
          ]
        },
        {
          "label": "放走换情报",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他画了张怪物的活动图。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "intel",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_rat_015",
      "ver": 1,
      "type": "choice",
      "title": "仓库鼠患",
      "weight": 60,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {},
      "text": "麻袋上全是齿印，粮仓成了鼠窝。",
      "options": [
        {
          "label": "养猫",
          "outcomes": [
            {
              "p": 1.0,
              "text": "巷子里讨来一只狸花，鼠患渐消。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -100
                },
                {
                  "op": "GRANT_BUFF",
                  "buff": "cat",
                  "days": 7
                }
              ]
            }
          ]
        },
        {
          "label": "投药",
          "outcomes": [
            {
              "p": 1.0,
              "text": "死老鼠清理了一簸箕，也误伤了两袋米。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -300
                }
              ]
            }
          ]
        },
        {
          "label": "改造货架",
          "outcomes": [
            {
              "p": 1.0,
              "text": "建材又花了一笔，但一劳永逸。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": -250
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_radio_016",
      "ver": 1,
      "type": "choice",
      "title": "外界的广播",
      "weight": 60,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 7
      },
      "text": "电台里循环播放着撤离点的坐标，真假难辨。",
      "options": [
        {
          "label": "回应",
          "outcomes": [
            {
              "p": 1.0,
              "text": "Morse 码回了三短三长，楼里士气一振。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "保持静默",
          "outcomes": [
            {
              "p": 1.0,
              "text": "枪打出头鸟。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "伪造回应",
          "outcomes": [
            {
              "p": 1.0,
              "text": "骗到了一批空投物资，但有人起了疑心。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 500
                },
                {
                  "op": "SET_FLAG",
                  "key": "trust",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_deadbeat_017",
      "ver": 1,
      "type": "choice",
      "title": "拒租的刺头",
      "weight": 70,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "四楼的刺头把房租拍在地上：「爱要不要。」",
      "options": [
        {
          "label": "宽限",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他反而不好意思了。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "断供",
          "outcomes": [
            {
              "p": 1.0,
              "text": "第三天，金币和道歉一起送来。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 800
                },
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            }
          ]
        },
        {
          "label": "驱逐",
          "outcomes": [
            {
              "p": 1.0,
              "text": "行李滚下楼梯，楼里一片肃静。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 400
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_deed_018",
      "ver": 1,
      "type": "choice",
      "title": "归来的「房东」",
      "weight": 50,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 8
      },
      "text": "一个西装革履的男人举着房产证：「这栋楼，是我的。」",
      "options": [
        {
          "label": "共治分成",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他入伙了，带来一笔启动金。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 1000
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "戳穿伪造",
          "outcomes": [
            {
              "p": 0.6,
              "text": "公章是萝卜刻的，人群哄笑。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 1500
                }
              ]
            },
            {
              "p": 0.4,
              "text": "他梗着脖子走了，声誉受损。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "认栽补偿",
          "outcomes": [
            {
              "p": 1.0,
              "text": "破财免灾。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -500
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_nightshift_019",
      "ver": 1,
      "type": "choice",
      "title": "谁值夜班",
      "weight": 65,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {},
      "text": "守夜表贴出来三天，名字栏还是空白。",
      "options": [
        {
          "label": "轮班",
          "outcomes": [
            {
              "p": 1.0,
              "text": "公平，但每个人都顶着黑眼圈。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "加薪志愿",
          "outcomes": [
            {
              "p": 1.0,
              "text": "重赏之下，岗哨满了。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -400
                },
                {
                  "op": "GRANT_BUFF",
                  "buff": "paidwatch",
                  "days": 3
                }
              ]
            }
          ]
        },
        {
          "label": "主角顶班",
          "outcomes": [
            {
              "p": 1.0,
              "text": "你打着哈欠守到天亮，威望涨了。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_pet_020",
      "ver": 1,
      "type": "choice",
      "title": "宠物医院",
      "weight": 50,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {},
      "text": "药店的金毛难产，主人跪在地上求救。",
      "options": [
        {
          "label": "急救",
          "outcomes": [
            {
              "p": 1.0,
              "text": "五只崽子活了下来，母犬成了编外保安。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": -150
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "放弃",
          "outcomes": [
            {
              "p": 1.0,
              "text": "哀嚎了一整夜。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 4
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_yoga_021",
      "ver": 1,
      "type": "choice",
      "title": "天台的富婆",
      "weight": 60,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 7
      },
      "text": "天台上有人在做瑜伽，瑜伽垫是爱马仕的。",
      "options": [
        {
          "label": "收高额租",
          "outcomes": [
            {
              "p": 1.0,
              "text": "她眼都没眨就付了。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 1500
                }
              ]
            }
          ]
        },
        {
          "label": "请她教理财",
          "outcomes": [
            {
              "p": 1.0,
              "text": "她笑：「有点意思。」",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "laiScore",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "无视",
          "outcomes": [
            {
              "p": 1.0,
              "text": "她做完一组拜日式就走了。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_blackout_022",
      "ver": 1,
      "type": "choice",
      "title": "停电夜",
      "weight": 65,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {},
      "text": "整栋楼陷入黑暗，走廊里全是摸索的声音。",
      "options": [
        {
          "label": "点蜡烛",
          "outcomes": [
            {
              "p": 1.0,
              "text": "烛光摇曳，人心也跟着晃。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -100
                },
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        },
        {
          "label": "发电机全开",
          "outcomes": [
            {
              "p": 1.0,
              "text": "轰鸣声里，灯全亮了。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": -100
                },
                {
                  "op": "ADD_PANIC",
                  "n": -6
                }
              ]
            }
          ]
        },
        {
          "label": "摸黑",
          "outcomes": [
            {
              "p": 0.4,
              "text": "黑暗中传来几声惊叫。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            },
            {
              "p": 0.6,
              "text": "居然也没出什么事。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_love_023",
      "ver": 1,
      "type": "choice",
      "title": "地下室的婚礼",
      "weight": 55,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {},
      "text": "地下室一对年轻人要成婚，想借一楼办仪式。",
      "options": [
        {
          "label": "成全",
          "outcomes": [
            {
              "p": 1.0,
              "text": "糖果是糖纸折的，掌声是真的。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "棒打鸳鸯",
          "outcomes": [
            {
              "p": 1.0,
              "text": "姑娘哭了一夜，楼里指指点点。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            }
          ]
        },
        {
          "label": "收礼金",
          "outcomes": [
            {
              "p": 1.0,
              "text": "场地费照收，骂声照来。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 300
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_tycoon_024",
      "ver": 1,
      "type": "choice",
      "title": "富商求庇护",
      "weight": 65,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 8
      },
      "text": "西装男人带着两个行李箱：「我能付。」",
      "options": [
        {
          "label": "收十金入伙",
          "outcomes": [
            {
              "p": 1.0,
              "text": "行李箱里是金条和罐头。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 1000
                }
              ]
            }
          ]
        },
        {
          "label": "免费庇护",
          "outcomes": [
            {
              "p": 1.0,
              "text": "「好人呐！」全楼传颂。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 2
                }
              ]
            }
          ]
        },
        {
          "label": "拒绝",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他消失在夜色里。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_101",
      "ver": 1,
      "type": "mission",
      "title": "7 楼老太被困",
      "weight": 100,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 3
      },
      "text": "7 楼传来说不清是人是物的撞击声——被困的老太太还在里面。",
      "options": [
        {
          "label": "派人救",
          "outcomes": [
            {
              "p": 0.7,
              "text": "老太太被背下楼，塞给队员一把糖果和一张房卡。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "R"
                }
              ]
            },
            {
              "p": 0.3,
              "text": "人救出来了，队员挂了彩。",
              "effects": [
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            }
          ]
        },
        {
          "label": "遥控指挥",
          "outcomes": [
            {
              "p": 0.5,
              "text": "电话里指点路线，老太太自己摸了下来。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            },
            {
              "p": 0.5,
              "text": "信号断了，再无回音。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 6
                }
              ]
            }
          ]
        },
        {
          "label": "放弃",
          "outcomes": [
            {
              "p": 1.0,
              "text": "撞击声停了。整栋楼安静得可怕。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_102",
      "ver": 1,
      "type": "mission",
      "title": "药房突袭",
      "weight": 70,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 4
      },
      "text": "街角药房的卷帘门半开，里面应该还有存货。",
      "options": [
        {
          "label": "亲自带队",
          "outcomes": [
            {
              "p": 1.0,
              "text": "药品和弹药装了两大包，有人挂彩。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 200
                },
                {
                  "op": "ADD_RES",
                  "res": "ammo",
                  "n": 100
                },
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            }
          ]
        },
        {
          "label": "派守卫去",
          "outcomes": [
            {
              "p": 1.0,
              "text": "稳字当头，收获打了折。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 100
                }
              ]
            }
          ]
        },
        {
          "label": "放弃",
          "outcomes": [
            {
              "p": 1.0,
              "text": "机会只有一次。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "intel",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_103",
      "ver": 1,
      "type": "mission",
      "title": "超市清场",
      "weight": 70,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {},
      "text": "连锁超市的卷帘门里传来此起彼伏的低吼。",
      "options": [
        {
          "label": "搜刮",
          "outcomes": [
            {
              "p": 1.0,
              "text": "食品和瓶装水搬空了两排货架，有人被划伤。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 300
                },
                {
                  "op": "ADD_RES",
                  "res": "water",
                  "n": 200
                },
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            }
          ]
        },
        {
          "label": "保守清点",
          "outcomes": [
            {
              "p": 1.0,
              "text": "只拿了门口顺手的。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 120
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_104",
      "ver": 1,
      "type": "mission",
      "title": "五金店建材",
      "weight": 60,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "五金店老板跑了，货架上一排排角钢还在。",
      "options": [
        {
          "label": "满载而归",
          "outcomes": [
            {
              "p": 1.0,
              "text": "角钢、螺丝、门铰链，全是硬货。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 400
                }
              ]
            }
          ]
        },
        {
          "label": "快撤",
          "outcomes": [
            {
              "p": 1.0,
              "text": "只抢了手边的。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 150
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_105",
      "ver": 1,
      "type": "mission",
      "title": "加油站取油",
      "weight": 60,
      "cooldownDays": 12,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "加油站的储油罐还有余油，就是守着它的东西不太友好。",
      "options": [
        {
          "label": "取油",
          "outcomes": [
            {
              "p": 1.0,
              "text": "三大桶柴油，顺便拆了两个燃烧瓶，有人被烫伤。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "ammo",
                  "n": 80
                },
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            }
          ]
        },
        {
          "label": "放弃",
          "outcomes": [
            {
              "p": 1.0,
              "text": "油罐的呼吸孔传来刮擦声。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_106",
      "ver": 1,
      "type": "mission",
      "title": "收容流浪者",
      "weight": 65,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 4
      },
      "text": "高架桥下蜷着几个幸存者，眼神警惕。",
      "options": [
        {
          "label": "收容队",
          "outcomes": [
            {
              "p": 1.0,
              "text": "带回了几个人，食堂压力大了。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        },
        {
          "label": "劝走",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他们朝另一个方向去了。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_107",
      "ver": 1,
      "type": "mission",
      "title": "医院废墟",
      "weight": 50,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 8
      },
      "text": "市医院的废墟里据说还有一位没走的护士长。",
      "options": [
        {
          "label": "深入",
          "outcomes": [
            {
              "p": 0.35,
              "text": "护士长 SR 级，带着一箱药品归队。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "SR"
                }
              ]
            },
            {
              "p": 0.3,
              "text": "药品到手，但两名队员负伤。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 150
                },
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                },
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                }
              ]
            },
            {
              "p": 0.35,
              "text": "无功而返。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 3
                }
              ]
            }
          ]
        },
        {
          "label": "外围捡漏",
          "outcomes": [
            {
              "p": 1.0,
              "text": "边缘柜台扫了一些药品。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 120
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_108",
      "ver": 1,
      "type": "mission",
      "title": "学校避难所",
      "weight": 55,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 8
      },
      "text": "小学体育馆里有二十几个幸存者，只收得下几个。",
      "options": [
        {
          "label": "接纳",
          "outcomes": [
            {
              "p": 1.0,
              "text": "来了老师带着两个孩子，楼里多了人气也多了嘴。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "拒收",
          "outcomes": [
            {
              "p": 1.0,
              "text": "铁门在他们身后关闭。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_109",
      "ver": 1,
      "type": "mission",
      "title": "银行金库",
      "weight": 45,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 10
      },
      "text": "银行地下金库的电子锁还剩最后一道——里面是传说中的金条。",
      "options": [
        {
          "label": "撬库",
          "outcomes": [
            {
              "p": 1.0,
              "text": "金条到手！但动静引来了怪物的增援潮。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 2500
                },
                {
                  "op": "NIGHT_MOD",
                  "mod": "SILENT"
                }
              ]
            }
          ]
        },
        {
          "label": "放弃",
          "outcomes": [
            {
              "p": 1.0,
              "text": "金库的门在身后缓缓合上。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_mis_110",
      "ver": 1,
      "type": "mission",
      "title": "高速路撤离车队",
      "weight": 60,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 9
      },
      "text": "撤离车队抛锚在高架上，人愿意付钱换一个铺位。",
      "options": [
        {
          "label": "接应收人",
          "outcomes": [
            {
              "p": 1.0,
              "text": "每人 200 金币，来了五个付费租客。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 1000
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                },
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        },
        {
          "label": "驱赶",
          "outcomes": [
            {
              "p": 1.0,
              "text": "车队的灯光在夜里远去。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_201",
      "ver": 1,
      "type": "choice",
      "title": "楼道争吵",
      "weight": 60,
      "cooldownDays": 7,
      "maxPerRun": 2,
      "prereq": {},
      "text": "五楼两户为了楼道堆物吵到了动手的边缘。",
      "options": [
        {
          "label": "调解",
          "outcomes": [
            {
              "p": 1.0,
              "text": "各退一步，楼道重新通畅。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -4
                }
              ]
            }
          ]
        },
        {
          "label": "各打五十大板",
          "outcomes": [
            {
              "p": 1.0,
              "text": "罚了两家清扫，秩序立了，怨气也存了。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "冷处理",
          "outcomes": [
            {
              "p": 1.0,
              "text": "争吵升级成了对骂。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 4
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_202",
      "ver": 1,
      "type": "choice",
      "title": "藏粮与挨饿的孩子",
      "weight": 70,
      "cooldownDays": 12,
      "maxPerRun": 2,
      "prereq": {
        "panicMin": 40
      },
      "text": "有人囤粮，隔壁的孩子却饿得哭不出声。",
      "options": [
        {
          "label": "搜查",
          "outcomes": [
            {
              "p": 1.0,
              "text": "囤粮充公，囤粮者被扫地出门。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 300
                },
                {
                  "op": "ADD_PANIC",
                  "n": 6
                },
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "接济",
          "outcomes": [
            {
              "p": 1.0,
              "text": "自家的米缸见底了，但孩子吃饱了。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -200
                },
                {
                  "op": "ADD_PANIC",
                  "n": -6
                }
              ]
            }
          ]
        },
        {
          "label": "不管",
          "outcomes": [
            {
              "p": 1.0,
              "text": "哭声持续到后半夜。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 10
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_203",
      "ver": 1,
      "type": "choice",
      "title": "自发巡逻队",
      "weight": 60,
      "cooldownDays": 12,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "几个年轻人自发组织了夜间巡逻。",
      "options": [
        {
          "label": "支持",
          "outcomes": [
            {
              "p": 1.0,
              "text": "巡逻队的臂章是用红布条做的。",
              "effects": [
                {
                  "op": "GRANT_BUFF",
                  "buff": "patrol",
                  "days": 5
                }
              ]
            }
          ]
        },
        {
          "label": "发工资收编",
          "outcomes": [
            {
              "p": 1.0,
              "text": "给钱才有执行力，但确实管用。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -500
                },
                {
                  "op": "GRANT_BUFF",
                  "buff": "patrolPaid",
                  "days": 7
                }
              ]
            }
          ]
        },
        {
          "label": "解散",
          "outcomes": [
            {
              "p": 1.0,
              "text": "巡逻队散了，夜里的脚步声多了。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 5
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_204",
      "ver": 1,
      "type": "choice",
      "title": "「收租鬼」涂鸦",
      "weight": 55,
      "cooldownDays": 12,
      "maxPerRun": 2,
      "prereq": {},
      "text": "外墙上被人喷了三个大红字：收租鬼。",
      "options": [
        {
          "label": "清洗",
          "outcomes": [
            {
              "p": 1.0,
              "text": "漆没洗干净，字还在。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 0
                }
              ]
            }
          ]
        },
        {
          "label": "默许",
          "outcomes": [
            {
              "p": 1.0,
              "text": "年轻人觉得这称呼挺酷。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "反向营销",
          "outcomes": [
            {
              "p": 1.0,
              "text": "「收租鬼保护费」的段子传遍了避难所圈子。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 200
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_205",
      "ver": 1,
      "type": "choice",
      "title": "逝者葬礼",
      "weight": 65,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 7
      },
      "text": "死者的家属想办一场像样的葬礼。",
      "options": [
        {
          "label": "办仪式",
          "outcomes": [
            {
              "p": 1.0,
              "text": "白花是用纸巾折的，哀乐是口琴吹的。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -150
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "从简",
          "outcomes": [
            {
              "p": 1.0,
              "text": "一个坑，一块木板。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "研究尸体",
          "outcomes": [
            {
              "p": 1.0,
              "text": "伤口的齿痕记录进了怪物图鉴。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "intel",
                  "v": 1
                },
                {
                  "op": "ADD_PANIC",
                  "n": 6
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_206",
      "ver": 1,
      "type": "choice",
      "title": "公约投票：宵禁",
      "weight": 70,
      "cooldownDays": 14,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5,
        "flags": {
          "orderIntro": 1
        }
      },
      "text": "议事厅贴出告示：是否实行宵禁，全楼投票。",
      "options": [
        {
          "label": "通过",
          "outcomes": [
            {
              "p": 1.0,
              "text": "宵禁令下，夜里再无人走动。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "curfew",
                  "v": 1
                },
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "否决",
          "outcomes": [
            {
              "p": 1.0,
              "text": "自由万岁——忧患派摇了摇头。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "折中",
          "outcomes": [
            {
              "p": 1.0,
              "text": "宵禁到十点，大家都能接受。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "curfew",
                  "v": 2
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_207",
      "ver": 1,
      "type": "choice",
      "title": "公区大扫除",
      "weight": 55,
      "cooldownDays": 12,
      "maxPerRun": 2,
      "prereq": {},
      "text": "楼道积灰，电梯口的杂物堆了半人高。",
      "options": [
        {
          "label": "全员动员",
          "outcomes": [
            {
              "p": 1.0,
              "text": "大扫除后楼里亮堂了，人心也亮堂了。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": -6
                }
              ]
            }
          ]
        },
        {
          "label": "雇人打扫",
          "outcomes": [
            {
              "p": 1.0,
              "text": "花钱买清净。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": -250
                },
                {
                  "op": "ADD_PANIC",
                  "n": -4
                }
              ]
            }
          ]
        },
        {
          "label": "自己上",
          "outcomes": [
            {
              "p": 1.0,
              "text": "你扫了一下午，腰都直不起来。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "mood",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_ord_208",
      "ver": 1,
      "type": "choice",
      "title": "生面孔混入",
      "weight": 65,
      "cooldownDays": 10,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "电梯里出现了没见过的面孔，谁也说不清来历。",
      "options": [
        {
          "label": "排查",
          "outcomes": [
            {
              "p": 0.6,
              "text": "虚惊一场，是隔壁楼串门的。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "order",
                  "v": 1
                }
              ]
            },
            {
              "p": 0.4,
              "text": "揪出一个可疑分子，驱逐出境。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": -1
                }
              ]
            }
          ]
        },
        {
          "label": "放行",
          "outcomes": [
            {
              "p": 1.0,
              "text": "也许只是个借宿的。",
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "reputation",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "收编考察",
          "outcomes": [
            {
              "p": 1.0,
              "text": "留用察看，干活都多了一份心眼。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_001",
      "ver": 1,
      "type": "choice",
      "title": "蜂群惊扰",
      "weight": 60,
      "cooldownDays": 4,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 3
      },
      "text": "林缘的野花丛里捅出了马蜂窝，嗡鸣声追着人跑。",
      "options": [
        {
          "label": "撤退",
          "outcomes": [
            {
              "p": 1.0,
              "text": "粮食撒了一路，人没事。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -20
                }
              ]
            }
          ]
        },
        {
          "label": "驱散",
          "outcomes": [
            {
              "p": 0.5,
              "text": "熏走了蜂群，顺手割了蜜。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 45
                }
              ]
            },
            {
              "p": 0.5,
              "text": "被蜇得满头包，蜜也没拿到。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 10
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_002",
      "ver": 1,
      "type": "choice",
      "title": "猎户小屋",
      "weight": 40,
      "cooldownDays": 6,
      "maxPerRun": 1,
      "prereq": {
        "dayMin": 10
      },
      "text": "深林里有间上锁的猎户小屋，烟囱居然还是温的。",
      "options": [
        {
          "label": "破门搜刮",
          "outcomes": [
            {
              "p": 0.6,
              "text": "腊肉和兽皮装了满满一筐。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 60
                },
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 30
                }
              ]
            },
            {
              "p": 0.4,
              "text": "屋主回来了，冷着脸把你们轰了出去。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            }
          ]
        },
        {
          "label": "敲门问询",
          "outcomes": [
            {
              "p": 0.8,
              "text": "老猎户教了你们设陷阱的手艺。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 35
                },
                {
                  "op": "SET_FLAG",
                  "key": "wd_hunter",
                  "v": 1
                }
              ]
            },
            {
              "p": 0.2,
              "text": "小屋空无一人，只有一本旧笔记。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 15
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_003",
      "ver": 1,
      "type": "choice",
      "title": "捕兽陷阱",
      "weight": 50,
      "cooldownDays": 5,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 6
      },
      "text": "去农田的小路上埋着捕兽夹，锈迹斑斑但弹簧有力。",
      "options": [
        {
          "label": "小心拆除",
          "outcomes": [
            {
              "p": 0.7,
              "text": "拆下的夹子送进了工坊。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 25
                }
              ]
            },
            {
              "p": 0.3,
              "text": "夹子翻了，咬在手上。",
              "effects": [
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                },
                {
                  "op": "ADD_PANIC",
                  "n": 6
                }
              ]
            }
          ]
        },
        {
          "label": "做标记绕行",
          "outcomes": [
            {
              "p": 1.0,
              "effects": []
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_004",
      "ver": 1,
      "type": "choice",
      "title": "雾夜迷路",
      "weight": 45,
      "cooldownDays": 6,
      "maxPerRun": 1,
      "prereq": {
        "dayMin": 10
      },
      "text": "深林的雾说来就来，火把只能照到三步远。",
      "options": [
        {
          "label": "原地守火",
          "outcomes": [
            {
              "p": 0.8,
              "effects": []
            },
            {
              "p": 0.2,
              "text": "守夜的火堆引来好奇的野兔，倒也不亏。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 15
                }
              ]
            }
          ]
        },
        {
          "label": "摸黑前行",
          "outcomes": [
            {
              "p": 0.5,
              "text": "愣是摸回了小区，还捡到一箱罐头。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": 50
                }
              ]
            },
            {
              "p": 0.5,
              "text": "有人摔进了沟里，物资也丢了。",
              "effects": [
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                },
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -25
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_005",
      "ver": 1,
      "type": "choice",
      "title": "流浪幸存者",
      "weight": 55,
      "cooldownDays": 5,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 12
      },
      "text": "废墟里有个流浪者举着白旗，嗓子哑得说不出整句话。",
      "options": [
        {
          "label": "收留",
          "outcomes": [
            {
              "p": 0.6,
              "text": "他懂发电机的脾气，是个人才。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            },
            {
              "p": 0.4,
              "text": "人收下了，胃口却不小。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -30
                }
              ]
            }
          ]
        },
        {
          "label": "给粮送行",
          "outcomes": [
            {
              "p": 1.0,
              "text": "他留下半包烟作谢礼，消失在街角。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -15
                },
                {
                  "op": "ADD_GOLD",
                  "n": 80
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_wd_006",
      "ver": 1,
      "type": "choice",
      "title": "狼嚎近营",
      "weight": 40,
      "cooldownDays": 5,
      "maxPerRun": 1,
      "prereq": {
        "dayMin": 9
      },
      "text": "入夜后狼嚎绕着营地转，火堆的火苗压得很低。",
      "options": [
        {
          "label": "加固火堆死守",
          "outcomes": [
            {
              "p": 0.7,
              "text": "狼群试探几轮，散了。",
              "effects": []
            },
            {
              "p": 0.3,
              "text": "狼扑进营地，叼走了肉、伤了对友。",
              "effects": [
                {
                  "op": "WOUND_TENANT",
                  "tenantId": -1
                },
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -30
                }
              ]
            }
          ]
        },
        {
          "label": "连夜撤回",
          "outcomes": [
            {
              "p": 1.0,
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 8
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_in_001",
      "ver": 1,
      "type": "choice",
      "title": "墙角异响",
      "weight": 60,
      "cooldownDays": 5,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 4
      },
      "text": "房间墙角传来窸窸窣窣的声响，像是有什么东西在墙皮后面。",
      "options": [
        {
          "label": "撬开墙皮",
          "outcomes": [
            {
              "p": 0.6,
              "text": "前任房主藏的一袋钉子和线材。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "material",
                  "n": 30
                }
              ]
            },
            {
              "p": 0.4,
              "text": "一窝老鼠炸了窝，粮食遭了殃。",
              "effects": [
                {
                  "op": "ADD_RES",
                  "res": "food",
                  "n": -18
                }
              ]
            }
          ]
        },
        {
          "label": "不管它",
          "outcomes": [
            {
              "p": 1.0,
              "effects": []
            }
          ]
        }
      ]
    },
    {
      "id": "evt_in_002",
      "ver": 1,
      "type": "choice",
      "title": "地板下的铁盒",
      "weight": 35,
      "cooldownDays": 8,
      "maxPerRun": 1,
      "prereq": {
        "dayMin": 6
      },
      "text": "地板松动，下面钉着一只上锁的铁盒。",
      "options": [
        {
          "label": "上缴公库",
          "outcomes": [
            {
              "p": 1.0,
              "text": "盒里整整齐齐码着金条，账本上记着'给守楼人'。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 500
                }
              ]
            }
          ]
        },
        {
          "label": "私藏",
          "outcomes": [
            {
              "p": 0.5,
              "text": "没人发现，夜里睡得有点浅。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 500
                },
                {
                  "op": "ADD_PANIC",
                  "n": 12
                }
              ]
            },
            {
              "p": 0.5,
              "text": "被同屋的住户看见了，流言传开了。",
              "effects": [
                {
                  "op": "ADD_GOLD",
                  "n": 500
                },
                {
                  "op": "ADD_PANIC",
                  "n": 20
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_in_003",
      "ver": 1,
      "type": "choice",
      "title": "窗外黑影",
      "weight": 50,
      "cooldownDays": 4,
      "maxPerRun": 2,
      "prereq": {
        "dayMin": 5
      },
      "text": "半夜，窗玻璃上映出一个一闪而过的黑影。",
      "options": [
        {
          "label": "开窗查看",
          "outcomes": [
            {
              "p": 0.7,
              "text": "是件挂在树上的大衣。虚惊一场。",
              "effects": []
            },
            {
              "p": 0.3,
              "text": "黑影扑面而过，什么都没看清。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 15
                }
              ]
            }
          ]
        },
        {
          "label": "拉紧窗帘",
          "outcomes": [
            {
              "p": 1.0,
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 5
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_in_004",
      "ver": 1,
      "type": "choice",
      "title": "邻居借宿",
      "weight": 45,
      "cooldownDays": 6,
      "maxPerRun": 1,
      "prereq": {
        "dayMin": 6
      },
      "text": "隔壁栋的姑娘拍着门，说她们那层已经三天没敢开灯。",
      "options": [
        {
          "label": "收留",
          "outcomes": [
            {
              "p": 0.7,
              "text": "姑娘手脚麻利，把房间收拾出了生气。",
              "effects": [
                {
                  "op": "SPAWN_TENANT",
                  "quality": "N"
                }
              ]
            },
            {
              "p": 0.3,
              "text": "她带来了麻烦，也带来了消息。",
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 6
                },
                {
                  "op": "SET_FLAG",
                  "key": "in_guest",
                  "v": 1
                }
              ]
            }
          ]
        },
        {
          "label": "婉拒",
          "outcomes": [
            {
              "p": 1.0,
              "effects": [
                {
                  "op": "ADD_PANIC",
                  "n": 4
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_bld_b_open",
      "ver": 1,
      "type": "scripted",
      "title": "B 栋开放",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 1,
      "prereq": {},
      "triggerDay": 30,
      "text": "轰隆一声，B 栋的大门被拉开了。三十个新房间在火把光里等着住户。",
      "options": [
        {
          "label": "确认",
          "outcomes": [
            {
              "p": 1.0,
              "text": null,
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "evt_bld_b_open",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    },
    {
      "id": "evt_bld_c_open",
      "ver": 1,
      "type": "scripted",
      "title": "C 栋开放",
      "weight": 0,
      "cooldownDays": 0,
      "maxPerRun": 1,
      "prereq": {},
      "triggerDay": 30,
      "text": "C 栋的窗口第一次亮起灯——空房间比金子还让人安心。",
      "options": [
        {
          "label": "确认",
          "outcomes": [
            {
              "p": 1.0,
              "text": null,
              "effects": [
                {
                  "op": "SET_FLAG",
                  "key": "evt_bld_c_open",
                  "v": 1
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
,
  monster: {
  "version": 1,
  "sourceDoc": "docs/数据配置表结构设计.md §4（进化树：设计方案 4.5）",
  "entries": [
    { "id": "m_seeker",    "name": "循声者", "tier": "minion", "unlockDay": 1,  "hpMul": 1.0,  "mechanics": [],             "usableNightMods": ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], "active": true },
    { "id": "m_breaker",   "name": "破窗者", "tier": "minion", "unlockDay": 3,  "hpMul": 1.0,  "mechanics": ["breakDoor"],  "usableNightMods": ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], "active": true },
    { "id": "m_climber",   "name": "攀楼种", "tier": "minion", "unlockDay": 5,  "hpMul": 1.05, "mechanics": ["climbWindow"], "usableNightMods": ["NORMAL", "BLOOD_MOON", "MIGRATE"], "active": true },
    { "id": "m_flyer",     "name": "飞行种", "tier": "elite",  "unlockDay": 9,  "hpMul": 1.1,  "mechanics": ["fly"],        "usableNightMods": ["NORMAL", "BLOOD_MOON", "MIGRATE"], "active": true },
    { "id": "m_focus",     "name": "围攻AI", "tier": "elite",  "unlockDay": 12, "hpMul": 1.15, "mechanics": ["focusFire"],  "usableNightMods": ["NORMAL", "BLOOD_MOON"], "active": true },
    { "id": "m_elite",     "name": "精英种", "tier": "elite",  "unlockDay": 18, "hpMul": 1.25, "mechanics": [],             "usableNightMods": ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], "active": true },
    { "id": "m_nightking", "name": "夜王",   "tier": "boss",   "unlockDay": 30, "hpMul": 2.0,  "mechanics": [],             "usableNightMods": [], "active": false }
  ]
}

} as const
