"use strict";

// config/day_curve.json
var day_curve_default = {
  version: 1,
  sourceDoc: "docs/M0-\u6570\u503C\u6A21\u578B-\u4E09\u66F2\u7EBF\u8C03\u53C2\u8868.md \xA75",
  bloodMoonDays: [7, 14, 21, 28],
  rows: [
    { day: 0, population: 3, q: 0.9, u: 1, income: 270, hp: 87, routes: 1, threat: 87, rTarget: 1.4, fReq: 122, deaths: 0, ads: 0, milestone: "\u6559\u5B66\uFF1A\u9996\u591C\u5FC5\u80DC+\u9996\u6B21\u6536\u79DF" },
    { day: 1, population: 10, q: 1, u: 1, income: 1e3, hp: 100, routes: 1, threat: 100, rTarget: 1.35, fReq: 135, deaths: 0, ads: 2, milestone: "\u6551\u63F4\u7B2C1\u4E2A\u90BB\u5C45\uFF0C\u4FDD\u4EBA=\u8D5A\u94B1" },
    { day: 2, population: 14, q: 1.04, u: 1.05, income: 1534, hp: 115, routes: 1, threat: 115, rTarget: 1.3, fReq: 150, deaths: 0, ads: 3, milestone: "\u5E7F\u64AD\u7AD9\u89E3\u9501\uFF0C\u4EBA\u53E3\u8DF3\u6DA8" },
    { day: 3, population: 15, q: 1.08, u: 1.11, income: 1798, hp: 132, routes: 1, threat: 132, rTarget: 1.25, fReq: 165, deaths: 0, ads: 4, milestone: "\u4ED3\u5E93\u6269\u5BB9\u8F6F\u5361\u70B9+\u5F00\u95E8\u6289\u62E9" },
    { day: 4, population: 16, q: 1.11, u: 1.17, income: 2095, hp: 152, routes: 2, threat: 304, rTarget: 1.2, fReq: 365, deaths: 0, ads: 4, milestone: "\u9996\u6B212\u8DEF\u653B\u9632" },
    { day: 5, population: 18, q: 1.15, u: 1.24, income: 2572, hp: 175, routes: 2, threat: 350, rTarget: 1.18, fReq: 413, deaths: 0, ads: 5, milestone: "\u6050\u614C/\u79E9\u5E8F\u6559\u5B66" },
    { day: 6, population: 19, q: 1.19, u: 1.31, income: 2959, hp: 201, routes: 2, threat: 402, rTarget: 1.1, fReq: 442, deaths: 0, ads: 6, milestone: "\u5F02\u8C61\u4E0E\u8840\u6708\u9884\u544A" },
    { day: 7, population: 20, q: 1.23, u: 1.38, income: 3392, hp: 370, routes: 3, threat: 1110, rTarget: 1.02, fReq: 1132, deaths: 1, ads: 6, milestone: "\u7B2C\u4E00\u6B21\u8840\u6708+\u9996\u5145\u66DD\u5149" },
    { day: 8, population: 20, q: 1.26, u: 1.45, income: 3662, hp: 266, routes: 3, threat: 798, rTarget: 1.2, fReq: 958, deaths: 0, ads: 6, milestone: "" },
    { day: 9, population: 21, q: 1.29, u: 1.53, income: 4148, hp: 306, routes: 3, threat: 918, rTarget: 1.18, fReq: 1083, deaths: 0, ads: 6, milestone: "" },
    { day: 10, population: 22, q: 1.32, u: 1.62, income: 4687, hp: 352, routes: 3, threat: 1055, rTarget: 1.15, fReq: 1214, deaths: 0, ads: 6, milestone: "" },
    { day: 11, population: 22, q: 1.34, u: 1.71, income: 5052, hp: 405, routes: 3, threat: 1214, rTarget: 1.13, fReq: 1371, deaths: 0, ads: 6, milestone: "" },
    { day: 12, population: 23, q: 1.37, u: 1.8, income: 5690, hp: 465, routes: 4, threat: 1861, rTarget: 1.1, fReq: 2047, deaths: 0, ads: 6, milestone: "" },
    { day: 13, population: 24, q: 1.4, u: 1.9, income: 6395, hp: 535, routes: 4, threat: 2140, rTarget: 1.05, fReq: 2247, deaths: 0, ads: 6, milestone: "" },
    { day: 14, population: 24, q: 1.43, u: 2.01, income: 6884, hp: 984, routes: 5, threat: 4922, rTarget: 1, fReq: 4922, deaths: 1, ads: 6, milestone: "\u8D5B\u5B63Boss\u524D\u54E8+\u6218\u4EE4/\u6708\u5361\u66DD\u5149" },
    { day: 15, population: 25, q: 1.45, u: 2.12, income: 7656, hp: 708, routes: 4, threat: 2830, rTarget: 1.18, fReq: 3340, deaths: 0, ads: 6, milestone: "" },
    { day: 16, population: 25, q: 1.46, u: 2.23, income: 8172, hp: 814, routes: 5, threat: 4069, rTarget: 1.15, fReq: 4679, deaths: 0, ads: 6, milestone: "" },
    { day: 17, population: 26, q: 1.48, u: 2.36, income: 9072, hp: 936, routes: 5, threat: 4679, rTarget: 1.12, fReq: 5240, deaths: 0, ads: 6, milestone: "" },
    { day: 18, population: 26, q: 1.5, u: 2.48, income: 9681, hp: 1076, routes: 5, threat: 5381, rTarget: 1.1, fReq: 5919, deaths: 0, ads: 6, milestone: "" },
    { day: 19, population: 26, q: 1.52, u: 2.62, income: 10331, hp: 1238, routes: 5, threat: 6188, rTarget: 1.08, fReq: 6683, deaths: 0, ads: 6, milestone: "" },
    { day: 20, population: 27, q: 1.53, u: 2.77, income: 11446, hp: 1423, routes: 5, threat: 7116, rTarget: 1.05, fReq: 7472, deaths: 0, ads: 6, milestone: "" },
    { day: 21, population: 27, q: 1.55, u: 2.92, income: 12211, hp: 2619, routes: 6, threat: 15712, rTarget: 1.02, fReq: 16026, deaths: 1, ads: 6, milestone: "\u7B2C\u4E09\u6B21\u8840\u6708\uFF0C6\u8DEF\u5CF0\u503C" },
    { day: 22, population: 27, q: 1.56, u: 3.08, income: 13002, hp: 1882, routes: 5, threat: 9411, rTarget: 1.15, fReq: 10822, deaths: 0, ads: 6, milestone: "" },
    { day: 23, population: 28, q: 1.58, u: 3.25, income: 14357, hp: 2164, routes: 5, threat: 10822, rTarget: 1.12, fReq: 12121, deaths: 0, ads: 6, milestone: "" },
    { day: 24, population: 28, q: 1.59, u: 3.43, income: 15285, hp: 2489, routes: 5, threat: 12446, rTarget: 1.1, fReq: 13690, deaths: 0, ads: 6, milestone: "" },
    { day: 25, population: 28, q: 1.61, u: 3.61, income: 16272, hp: 2863, routes: 5, threat: 14313, rTarget: 1.08, fReq: 15458, deaths: 0, ads: 6, milestone: "" },
    { day: 26, population: 29, q: 1.62, u: 3.81, income: 17940, hp: 3292, routes: 5, threat: 16459, rTarget: 1.06, fReq: 17447, deaths: 0, ads: 6, milestone: "" },
    { day: 27, population: 29, q: 1.64, u: 4.02, income: 19095, hp: 3786, routes: 5, threat: 18928, rTarget: 1.03, fReq: 19496, deaths: 1, ads: 6, milestone: "" },
    { day: 28, population: 29, q: 1.65, u: 4.24, income: 20323, hp: 6966, routes: 6, threat: 41794, rTarget: 1, fReq: 41794, deaths: 1, ads: 6, milestone: "\u6700\u540E\u8840\u6708\uFF08\u6700\u6DF1\u4ED8\u8D39\u5899\uFF09" },
    { day: 29, population: 30, q: 1.67, u: 4.48, income: 22374, hp: 5007, routes: 5, threat: 25033, rTarget: 1.1, fReq: 27536, deaths: 0, ads: 6, milestone: "\u5598\u606F\uFF1A\u9632\u5FA1\u9884\u7B97\u8F6C\u53D1\u5C55" },
    { day: 30, population: 30, q: 1.68, u: 4.72, income: 23810, hp: 5758, routes: 5, threat: 28788, rTarget: 1.15, fReq: 33106, deaths: 0, ads: 6, milestone: "\u7B2C1\u680B\u6EE1\u5C42\uFF0C\u89E3\u9501\u7B2C2\u680B+\u591C\u738B\u9884\u544A" }
  ]
};

// config/constants.json
var constants_default = {
  version: 1,
  sourceDoc: "docs/M0-\u6570\u503C\u6A21\u578B-\u4E09\u66F2\u7EBF\u8C03\u53C2\u8868.md \xA72 / docs/\u6280\u672F\u67B6\u6784\u4E0E\u6A21\u5757\u89C4\u5212 v1.0 \xA75.3 / docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1 \xA73",
  entries: [
    {
      key: "CFG_R0",
      value: 100,
      min: 50,
      max: 200,
      desc: "N\u54C1\u8D28\u4F4F\u6237\u57FA\u51C6\u65E5\u4EA7\u51FA\uFF08\u91D1\u5E01/\u5929\uFF09",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_G_U",
      value: 1.055,
      min: 1.05,
      max: 1.06,
      desc: "\u6237\u5747\u5347\u7EA7\u7CFB\u6570\u65E5\u589E\u957F",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_G_T",
      value: 1.15,
      min: 1.14,
      max: 1.17,
      desc: "\u5F3A\u5EA6\u65E5\u6307\u6570",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_HP0",
      value: 100,
      min: 50,
      max: 150,
      desc: "\u5355\u602A\u57FA\u51C6HP",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_J_BM",
      value: 1.6,
      min: 1.45,
      max: 1.8,
      desc: "\u8840\u6708\u8DF3\u53D8\u500D\u7387",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_K_POWER",
      value: 2.6,
      min: 2.2,
      max: 3,
      desc: "\u91D1\u5E01/\u6218\u529B\u70B9\u8F6C\u5316\u6210\u672C",
      sourceDoc: "M0 \xA72"
    },
    {
      key: "CFG_ECPM",
      value: 45,
      min: 30,
      max: 80,
      desc: "\u6FC0\u52B1\u89C6\u9891 eCPM\uFF08\u5143\uFF09",
      sourceDoc: "M0 \xA77.1"
    },
    {
      key: "CFG_QUALITY_MUL_N",
      value: 1,
      min: 1,
      max: 1,
      desc: "N\u54C1\u8D28\u4EA7\u51FA\u500D\u7387",
      sourceDoc: "M0 \xA71 \u54C1\u8D28\u6743\u91CD"
    },
    {
      key: "CFG_QUALITY_MUL_R",
      value: 1.5,
      min: 1.5,
      max: 1.5,
      desc: "R\u54C1\u8D28\u4EA7\u51FA\u500D\u7387",
      sourceDoc: "M0 \xA71"
    },
    {
      key: "CFG_QUALITY_MUL_SR",
      value: 2.5,
      min: 2.5,
      max: 2.5,
      desc: "SR\u54C1\u8D28\u4EA7\u51FA\u500D\u7387",
      sourceDoc: "M0 \xA71"
    },
    {
      key: "CFG_QUALITY_MUL_SSR",
      value: 5,
      min: 5,
      max: 5,
      desc: "SSR\u54C1\u8D28\u4EA7\u51FA\u500D\u7387",
      sourceDoc: "M0 \xA71"
    },
    {
      key: "PANIC_MAX",
      value: 100,
      min: 100,
      max: 100,
      desc: "\u5355\u6237\u6050\u614C\u4E0A\u9650",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_ESCAPE_AT",
      value: 70,
      min: 60,
      max: 80,
      desc: "\u51FA\u9003\u6050\u614C\u9608\u503C",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_ESCAPE_P",
      value: 0.15,
      min: 0.1,
      max: 0.2,
      desc: "\u8FBE\u9608\u503C\u540E\u6BCF\u65E5\u51FA\u9003\u6982\u7387",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_DECAY",
      value: 10,
      min: 5,
      max: 15,
      desc: "\u6BCF\u65E5\u6050\u614C\u81EA\u7136\u8870\u51CF",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_PROP_FLOOR",
      value: 5,
      min: 3,
      max: 8,
      desc: "\u540C\u5C42\u7834\u9632\u6050\u614C\u4F20\u64AD\u91CF",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_MEAN_PENALTY_AT",
      value: 50,
      min: 40,
      max: 60,
      desc: "\u5168\u697C\u5747\u503C\u6050\u614C\u4EA7\u51FA\u60E9\u7F5A\u9608\u503C",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "PANIC_MEAN_PENALTY",
      value: 0.9,
      min: 0.8,
      max: 0.95,
      desc: "\u8D85\u9608\u503C\u540E\u6237\u4EA7\u4E58\u6570",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "TUTORIAL_PANIC_CAP",
      value: 30,
      min: 20,
      max: 40,
      desc: "D1\u2013D7 \u6559\u5B66\u6BB5\u6050\u614C\u5C01\u9876",
      sourceDoc: "v1.0 \xA75.3"
    },
    {
      key: "GUARD_DEATH_DAY",
      value: 4,
      min: 3,
      max: 4,
      desc: "\u5355\u65E5\u6B7B\u4EA1\u62A4\u680F",
      sourceDoc: "M0 \xA74.3"
    },
    {
      key: "GUARD_DEATH_30D",
      value: 6,
      min: 4,
      max: 8,
      desc: "30 \u65E5\u7D2F\u8BA1\u6B7B\u4EA1\u62A4\u680F",
      sourceDoc: "M0 \xA74.3"
    },
    {
      key: "STAB_J_ADJUST_MIN",
      value: 0.9,
      min: 0.85,
      max: 0.95,
      desc: "\u707E\u96BE\u8C03\u5236\u4E0B\u9650",
      sourceDoc: "\u5185\u6838\u6863 \xA75.5"
    },
    {
      key: "STAB_J_ADJUST_MAX",
      value: 1.1,
      min: 1.05,
      max: 1.15,
      desc: "\u707E\u96BE\u8C03\u5236\u4E0A\u9650",
      sourceDoc: "\u5185\u6838\u6863 \xA75.5"
    },
    {
      key: "M1_RECRUIT_GOLD",
      value: 150,
      min: 100,
      max: 300,
      desc: "M1 \u767D\u76D2\u62DB\u52DF\u5355\u4EF7\uFF08\u91D1\u5E01/\u4EBA\uFF09",
      sourceDoc: "M1 \u5B9E\u73B0"
    },
    {
      key: "M1_ROOM_GOLD",
      value: 100,
      min: 50,
      max: 300,
      desc: "M1 \u767D\u76D2\u5EFA\u623F\u5355\u4EF7\uFF08\u91D1\u5E01/\u95F4\uFF09",
      sourceDoc: "M1 \u5B9E\u73B0"
    }
  ]
};

// packages/kernel/src/index.ts
var KernelError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.code = code;
  }
};
var SYSTEM_TAGS = ["diag/leak", "diag/degraded", "diag/record", "ctrl/killswitch"];
var Kernel = class {
  phase = "REGISTER";
  records = /* @__PURE__ */ new Map();
  order = [];
  providers = /* @__PURE__ */ new Map();
  // service → plugin name
  handlers = /* @__PURE__ */ new Map();
  anyHandlers = /* @__PURE__ */ new Set();
  allowedTags = new Set(SYSTEM_TAGS);
  traceSeq = 0;
  clock;
  appName;
  newTraceId;
  constructor(options = {}) {
    this.appName = options.appName ?? "rn";
    this.clock = options.clock ?? { logicalDay: () => 0, wallMs: () => 0 };
    this.newTraceId = options.newTraceId ?? (() => `${this.appName}-${++this.traceSeq}`);
  }
  // ---- REGISTER ----
  register(plugins) {
    if (this.phase !== "REGISTER") throw new KernelError("E_PHASE", `register \u4EC5\u9650 REGISTER \u76F8\uFF08\u5F53\u524D ${this.phase}\uFF09`);
    for (const decl of plugins) {
      if (this.records.has(decl.name)) throw new KernelError("E_DUPLICATE_PLUGIN", `\u63D2\u4EF6\u91CD\u540D: ${decl.name}`);
      const rec = { decl, state: "registered", config: {}, provided: /* @__PURE__ */ new Map(), scope: null, degraded: false, leaks: { handlers: 0, intervals: 0 } };
      this.records.set(decl.name, rec);
      for (const tag of decl.produces ?? []) this.allowedTags.add(tag);
    }
    return this;
  }
  // ---- RESOLVE ----
  resolve() {
    this.assertPhase("REGISTER");
    for (const rec of this.records.values()) {
      for (const p of rec.decl.provides) {
        const owner = this.providers.get(p);
        if (owner) throw new KernelError("E_DUPLICATE_SERVICE", `\u670D\u52A1 ${p} \u88AB ${owner} \u4E0E ${rec.decl.name} \u91CD\u590D\u63D0\u4F9B`);
        this.providers.set(p, rec.decl.name);
      }
    }
    for (const rec of this.records.values()) {
      for (const dep of rec.decl.depends) {
        if (!this.providers.has(dep.service) && !dep.optional) {
          throw new KernelError("E_MISSING_SERVICE", `\u63D2\u4EF6 ${rec.decl.name} \u7F3A\u5931\u4F9D\u8D56\u670D\u52A1 ${dep.service}`);
        }
      }
    }
    this.detectCycles();
    this.order = this.topoOrder();
    for (const rec of this.records.values()) rec.state = "resolved";
    this.phase = "CONFIG";
    return this;
  }
  detectCycles() {
    const color = /* @__PURE__ */ new Map();
    const path = [];
    const edgesTo = (name) => {
      const out = [];
      for (const dep of this.records.get(name).decl.depends) {
        const provider = this.providers.get(dep.service);
        if (provider && provider !== name) out.push(provider);
      }
      return out;
    };
    const dfs = (name) => {
      color.set(name, 1);
      path.push(name);
      for (const next of edgesTo(name)) {
        const c = color.get(next) ?? 0;
        if (c === 1) {
          const from = path.indexOf(next);
          throw new KernelError("E_CYCLE", "\u5FAA\u73AF\u4F9D\u8D56: " + [...path.slice(from), next].join(" \u2192 "));
        }
        if (c === 0) dfs(next);
      }
      path.pop();
      color.set(name, 2);
    };
    for (const name of this.records.keys()) if ((color.get(name) ?? 0) === 0) dfs(name);
  }
  topoOrder() {
    const indeg = /* @__PURE__ */ new Map();
    const dependents = /* @__PURE__ */ new Map();
    for (const name of this.records.keys()) {
      indeg.set(name, 0);
      dependents.set(name, []);
    }
    for (const [name, rec] of this.records) {
      for (const dep of rec.decl.depends) {
        const provider = this.providers.get(dep.service);
        if (provider && provider !== name) {
          indeg.set(name, (indeg.get(name) ?? 0) + 1);
          dependents.get(provider).push(name);
        }
      }
    }
    const queue = [...this.records.keys()].filter((n) => (indeg.get(n) ?? 0) === 0);
    const out = [];
    while (queue.length) {
      const n = queue.shift();
      out.push(n);
      for (const m of dependents.get(n)) {
        const v = (indeg.get(m) ?? 0) - 1;
        indeg.set(m, v);
        if (v === 0) queue.push(m);
      }
    }
    if (out.length !== this.records.size) throw new KernelError("E_CYCLE", "\u62D3\u6251\u6392\u5E8F\u672A\u8986\u76D6\u5168\u90E8\u63D2\u4EF6\uFF08\u5B58\u5728\u73AF\uFF09");
    return out;
  }
  // ---- CONFIG ----
  configure(configs = {}) {
    this.assertPhase("CONFIG");
    for (const rec of this.records.values()) {
      const cfg = { ...configs[rec.decl.name] ?? {} };
      const schema = rec.decl.configSchema;
      if (schema) {
        for (const key of schema.required ?? []) {
          if (!(key in cfg)) throw new KernelError("E_CONFIG", `\u63D2\u4EF6 ${rec.decl.name} \u7F3A\u914D\u7F6E\u9879 ${key}`);
        }
        for (const [key, type] of Object.entries(schema.props ?? {})) {
          if (!(key in cfg)) continue;
          const v = cfg[key];
          const actual = Array.isArray(v) ? "array" : typeof v;
          if (actual !== type) throw new KernelError("E_CONFIG", `\u63D2\u4EF6 ${rec.decl.name} \u914D\u7F6E ${key} \u7C7B\u578B\u5E94\u4E3A ${type}\uFF0C\u5B9E\u9645 ${actual}`);
        }
      }
      rec.config = cfg;
      rec.state = "configured";
    }
    this.phase = "SETUP";
    return this;
  }
  // ---- SETUP / START ----
  setupAll() {
    this.assertPhase("SETUP");
    for (const name of this.order) this.setupOne(this.records.get(name));
    this.phase = "START";
    return this;
  }
  async startAll() {
    this.assertPhase("START");
    for (const name of this.order) await this.startOne(this.records.get(name));
    this.phase = "RUNNING";
    return this;
  }
  /** 便捷入口：register+resolve+configure+setupAll+startAll */
  async boot(plugins = [], configs = {}) {
    this.register(plugins);
    this.resolve();
    this.configure(configs);
    this.setupAll();
    await this.startAll();
    return this;
  }
  setupOne(rec) {
    const ctx = this.makeCtx(rec);
    try {
      rec.decl.hooks.setup?.(ctx);
      rec.state = "setup";
    } catch (err) {
      this.degrade(rec, err);
    }
  }
  async startOne(rec) {
    if (rec.state === "degraded") return;
    for (const dep of rec.decl.depends) {
      const provider = dep.service ? this.providers.get(dep.service) : void 0;
      if (provider) {
        const pr = this.records.get(provider);
        if (pr.state !== "started" && !dep.optional) {
          this.degrade(rec, new Error(`\u4F9D\u8D56 ${provider} \u672A\u542F\u52A8`));
          return;
        }
      }
    }
    try {
      await rec.decl.hooks.start?.(rec.ctx);
      rec.state = "started";
    } catch (err) {
      this.degrade(rec, err);
    }
  }
  degrade(rec, err) {
    rec.degraded = true;
    rec.state = "degraded";
    rec.error = err instanceof Error ? err.message : String(err);
    this.systemEmit("diag/degraded", { plugin: rec.decl.name, error: rec.error });
  }
  // ---- 运行期热插拔 ----
  async stopPlugin(name) {
    const rec = this.records.get(name);
    if (!rec) throw new KernelError("E_NO_PLUGIN", `\u672A\u77E5\u63D2\u4EF6 ${name}`);
    if (rec.decl.hotplug === "core") throw new KernelError("E_HOTPLUG", `core \u63D2\u4EF6 ${name} \u4E0D\u53EF\u505C\u7528`);
    await this.teardown(rec);
  }
  async startPlugin(name) {
    const rec = this.records.get(name);
    if (!rec) throw new KernelError("E_NO_PLUGIN", `\u672A\u77E5\u63D2\u4EF6 ${name}`);
    if (rec.state === "started") return;
    if (rec.state !== "disposed" && rec.state !== "degraded" && rec.state !== "stopped") {
      throw new KernelError("E_HOTPLUG", `\u63D2\u4EF6 ${name} \u72B6\u6001 ${rec.state} \u4E0D\u53EF\u542F\u52A8`);
    }
    rec.degraded = false;
    this.setupOne(rec);
    await this.startOne(rec);
  }
  mount(scope, plugins) {
    const before = this.phase;
    this.phase = "REGISTER";
    this.register(plugins);
    for (const name of this.records.keys()) if (this.records.get(name).scope === null && !this.order.includes(name)) this.records.get(name).scope = scope;
    const scopeRecs = plugins.map((p) => this.records.get(p.name));
    for (const rec of scopeRecs) {
      for (const dep of rec.decl.depends) {
        if (!this.providers.has(dep.service) && !dep.optional) throw new KernelError("E_MISSING_SERVICE", `\u4F5C\u7528\u57DF ${scope} \u63D2\u4EF6 ${rec.decl.name} \u7F3A\u5931\u4F9D\u8D56 ${dep.service}`);
      }
    }
    for (const rec of scopeRecs) {
      const cfg = {};
      rec.config = cfg;
      this.setupOne(rec);
    }
    for (const rec of scopeRecs) {
      void rec;
    }
    this.phase = before === "RUNNING" ? "RUNNING" : before;
    void scopeRecs;
    return this;
  }
  async startScope(scope) {
    for (const name of this.order) {
      const rec = this.records.get(name);
      if (rec.scope === scope && rec.state === "setup") await this.startOne(rec);
    }
    return this;
  }
  async unmount(scope) {
    const recs = [...this.records.values()].filter((r) => r.scope === scope && r.state !== "disposed");
    for (const rec of recs.slice().reverse()) await this.teardown(rec, true);
    return this;
  }
  async teardown(rec, unmounted = false) {
    const ctx = rec.ctx;
    try {
      await rec.decl.hooks.drain?.(ctx);
    } catch (err) {
      this.systemEmit("diag/degraded", { plugin: rec.decl.name, error: String(err) });
    }
    try {
      rec.decl.hooks.stop?.(ctx);
    } catch {
    }
    rec.decl.hooks.dispose?.(ctx);
    rec.state = "disposed";
    const { handlers, intervals } = rec.leaks;
    if (handlers > 0 || intervals > 0) {
      this.systemEmit("diag/leak", { plugin: rec.decl.name, handlers, intervals, scope: rec.scope ?? (unmounted ? "unmounted" : "global") });
    }
  }
  // ---- 服务 / 事件 / 诊断 ----
  service(name) {
    const provider = this.providers.get(name);
    if (!provider) throw new KernelError("E_MISSING_SERVICE", `\u672A\u77E5\u670D\u52A1 ${name}`);
    const v = this.records.get(provider).provided.get(name);
    if (v === void 0) throw new KernelError("E_SERVICE_NOT_READY", `\u670D\u52A1 ${name} \u5C1A\u672A\u6CE8\u518C\u503C`);
    return v;
  }
  has(name) {
    return this.providers.has(name);
  }
  emit(tag, payload) {
    this.dispatch(tag, payload, this.appName);
  }
  on(tag, fn) {
    const key = { rec: null, fn };
    if (!this.handlers.has(tag)) this.handlers.set(tag, /* @__PURE__ */ new Set());
    this.handlers.get(tag).add(key);
    return () => {
      this.handlers.get(tag)?.delete(key);
    };
  }
  onAny(fn) {
    const key = { rec: null, fn };
    this.anyHandlers.add(key);
    return () => {
      this.anyHandlers.delete(key);
    };
  }
  dispatch(tag, payload, source) {
    const env = { ver: 1, tag, wallTs: this.clock.wallMs(), logicalDay: this.clock.logicalDay(), traceId: this.newTraceId(), source, payload };
    for (const key of this.handlers.get(tag) ?? []) key.fn(env);
    for (const key of this.anyHandlers) key.fn(env);
  }
  systemEmit(tag, payload) {
    this.dispatch(tag, payload, "@rn/kernel");
  }
  exportGraph() {
    const nodes = [];
    const edges = [];
    for (const rec of this.records.values()) {
      nodes.push({ name: rec.decl.name, hotplug: rec.decl.hotplug, provides: rec.decl.provides, depends: rec.decl.depends, scope: rec.scope });
      for (const dep of rec.decl.depends) {
        const provider = this.providers.get(dep.service);
        if (provider) edges.push({ from: rec.decl.name, to: provider, service: dep.service });
      }
    }
    return { nodes, edges };
  }
  healthAll() {
    return this.order.map((name) => {
      const rec = this.records.get(name);
      if (rec.degraded) return { name, status: "degraded", detail: rec.error };
      const r = rec.decl.health?.(rec.ctx) ?? { status: "ok" };
      return { name, status: r.status, detail: r.detail };
    });
  }
  makeCtx(rec) {
    const kernel2 = this;
    const ctx = {
      plugin: rec.decl.name,
      config: rec.config,
      logicalDay: () => kernel2.clock.logicalDay(),
      traceId: () => kernel2.newTraceId(),
      provide(name, value) {
        if (!rec.decl.provides.includes(name)) throw new KernelError("E_PROVIDE", `\u63D2\u4EF6 ${rec.decl.name} \u672A\u58F0\u660E\u63D0\u4F9B ${name}`);
        rec.provided.set(name, value);
      },
      service(name) {
        return kernel2.service(name);
      },
      has: (name) => kernel2.has(name),
      emit(tag, payload) {
        if (!(rec.decl.produces ?? []).includes(tag)) {
          throw new KernelError("E_TAG", `\u63D2\u4EF6 ${rec.decl.name} \u53D1\u51FA\u4E86\u672A\u58F0\u660E\u7684\u4E8B\u4EF6 ${tag}`);
        }
        kernel2.dispatch(tag, payload, rec.decl.name);
      },
      on(tag, fn) {
        rec.leaks.handlers++;
        const key = { rec, fn };
        if (!kernel2.handlers.has(tag)) kernel2.handlers.set(tag, /* @__PURE__ */ new Set());
        kernel2.handlers.get(tag).add(key);
        return () => {
          rec.leaks.handlers--;
          kernel2.handlers.get(tag)?.delete(key);
        };
      },
      onAny(fn) {
        rec.leaks.handlers++;
        const key = { rec, fn };
        kernel2.anyHandlers.add(key);
        return () => {
          rec.leaks.handlers--;
          kernel2.anyHandlers.delete(key);
        };
      },
      setInterval(fn, ms) {
        rec.leaks.intervals++;
        const h = setInterval(() => fn(), ms);
        return h;
      },
      clearInterval(handle) {
        rec.leaks.intervals--;
        clearInterval(handle);
      }
    };
    rec.ctx = ctx;
    return ctx;
  }
  assertPhase(expect) {
    if (this.phase !== expect) throw new KernelError("E_PHASE", `\u9700\u8981 ${expect} \u76F8\uFF0C\u5F53\u524D ${this.phase}`);
  }
};
function createKernel(options = {}) {
  return new Kernel(options);
}

// packages/formula/src/index.ts
function loadConstants(entries) {
  const out = {};
  for (const e of entries) {
    if (e.value < e.min || e.value > e.max) throw new Error(`\u5E38\u91CF ${e.key} \u8D8A\u51FA\u5B89\u5168\u533A\u95F4 [${e.min},${e.max}]`);
    out[e.key] = e.value;
  }
  return out;
}
function devMul(level, gU) {
  let m = 1;
  for (let i = 1; i < level; i++) m *= gU;
  return m;
}
function createFormula(tables) {
  const rows = tables.dayCurve.rows;
  const C = tables.constants;
  const qMul = {
    N: C.CFG_QUALITY_MUL_N,
    R: C.CFG_QUALITY_MUL_R,
    SR: C.CFG_QUALITY_MUL_SR,
    SSR: C.CFG_QUALITY_MUL_SSR
  };
  const row = (d) => {
    const r = rows.find((x) => x.day === d);
    if (!r) throw new Error(`day_curve \u7F3A\u5C11 D${d}`);
    return r;
  };
  const api = {
    row,
    bloodMoon: (d) => tables.dayCurve.bloodMoonDays.includes(d),
    /** 单户租金 = round(R0 × 品质倍率 × u系数 × 恐慌系数 × 加成） */
    rent(quality, level, mods = {}) {
      const panic = mods.panicFactor ?? 1;
      const monthly = mods.monthlyBonus ?? 1;
      const buff = mods.rentBuff ?? 1;
      return Math.round(C.CFG_R0 * qMul[quality] * devMul(level, C.CFG_G_U) * panic * monthly * buff);
    },
    dailyRent(tenants, mods = {}) {
      let sum = 0;
      for (const t of tenants) sum += api.rent(t.quality, t.level, mods);
      return sum;
    },
    threat: (d) => row(d).threat,
    fReq: (d) => row(d).fReq,
    /** 路级判定（M0 §4.3 死亡带，规则配置化落点） */
    judgeRoute(r) {
      if (r >= 1.2) return "HOLD";
      if (r >= 1.05) return "HOLD_WOUNDED";
      if (r >= 0.95) return "LOSE_1";
      if (r >= 0.8) return "LOSE_2";
      return "LOSE_3P";
    },
    /** 设计锚点（对 day_curve 表自洽计算，M1 契约的判定源） */
    designAnchors() {
      const d1 = rows.find((r) => r.day === 1);
      const d7 = row(7);
      const r7 = d7.fReq / d7.threat;
      const windows = [[1, 7], [8, 14], [15, 21], [22, 28]];
      const cycles = windows.map(([s, e]) => {
        const prevF = s === 1 ? row(0).fReq : row(s - 1).fReq;
        const dF = row(e).fReq - prevF;
        const sumI = rows.filter((r) => r.day >= s && r.day <= e).reduce((a, r) => a + r.income, 0);
        return { window: `D${s}-${e}`, beta: Math.round(dF * C.CFG_K_POWER / sumI * 1e3) / 10 };
      });
      return { d1Income: d1.income, r7, betaByCycle: cycles };
    }
  };
  return api;
}

// apps/client-cocos/minigame/entry.ts
var kernel = createKernel({ appName: "nl-minigame" });
kernel.register([]);
void kernel.boot().then(() => {
  const formula = createFormula({
    dayCurve: day_curve_default,
    constants: loadConstants(constants_default.entries)
  });
  const G = globalThis;
  G.console.log("kernel boot ok", { day: kernel.clock.logicalDay() });
  G.console.log("income(D1)=", formula.row(1).income);
});
