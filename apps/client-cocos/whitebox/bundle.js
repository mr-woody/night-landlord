"use strict";
(() => {
  // packages/kernel/src/index.ts
  function definePlugin(p) {
    return p;
  }
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

  // packages/core/src/index.ts
  function hash32(input) {
    let h = 2166136261;
    for (let i = 0; i < input.length; i++) {
      h ^= input.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function mulberry32(a) {
    let s = a | 0;
    return () => {
      s = s + 1831565813 | 0;
      let t = Math.imul(s ^ s >>> 15, 1 | s);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function mixHash(seed, stream, counter) {
    let h = seed >>> 0;
    const key = `${stream}#${counter}`;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }
  function createRngStreams(seed, saved) {
    const counters = { ...saved ?? {} };
    return {
      next(stream) {
        const c = (counters[stream] ?? 0) + 1;
        counters[stream] = c;
        return mulberry32(mixHash(seed, stream, c))();
      },
      counters: () => ({ ...counters })
    };
  }
  function createDayRng(seed, stream, day) {
    let k = 0;
    return { next: () => mulberry32(mixHash(seed, `${stream}@d${day}`, ++k))() };
  }
  function canonicalJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    const obj = value;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`).join(",")}}`;
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
  function upgradeCost(level, base, growth) {
    let m = 1;
    for (let i = 1; i < level; i++) m *= growth;
    return Math.ceil(base * m);
  }
  function levelForU(u, gU) {
    let m = 1;
    let level = 1;
    while (m < u && level < 60) {
      m *= gU;
      level++;
    }
    return level;
  }
  function createFormula(tables2) {
    const rows = tables2.dayCurve.rows;
    const C = tables2.constants;
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
      bloodMoon: (d) => tables2.dayCurve.bloodMoonDays.includes(d),
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

  // packages/systems/src/index.ts
  var RESOURCES = ["food", "water", "material", "ammo", "talentStone"];
  function createGameState(seed) {
    const s = {
      version: 1,
      seed,
      day: 0,
      phase: "DAWN_SETTLE",
      rng: {},
      resources: { food: 600, water: 600, material: 400, ammo: 200, gold: 3200, talentStone: 0 },
      tenants: [],
      nextTenantId: 1,
      roomsBuilt: 3,
      floors: 1,
      canteenLevel: 1,
      warehouseLevel: 1,
      clinicLevel: 1,
      defense: { power: 0, alloc: [] },
      flags: {},
      stats: { deathsTotal: 0, deathsToday: 0, goldEarnedTotal: 0, breachesLastNight: 0 }
    };
    const rng = createRngStreams(seed, s.rng);
    for (let i = 0; i < 3; i++) {
      s.tenants.push({ id: s.nextTenantId++, quality: "N", level: 1, job: "worker", hp: 100, panic: 0 });
      void rng;
    }
    return s;
  }
  function serialize(state) {
    return canonicalJson(state);
  }
  function canteenCap(state, buildingDef) {
    const row = buildingDef.entries.find((b) => b.type === "canteen" && b.level === state.canteenLevel);
    return row?.capacity ?? 0;
  }
  function defensePower(state, constants) {
    const guards = state.tenants.filter((t) => t.job === "guard").length;
    return state.defense.power + guards * (constants.GUARD_POWER ?? 15);
  }
  function checkInvariants(state, caps) {
    const errs = [];
    if (state.resources.gold < 0) errs.push("gold < 0");
    for (const r of RESOURCES) if (state.resources[r] < 0) errs.push(`${r} < 0`);
    if (state.tenants.length > caps.canteenCap) errs.push(`\u4EBA\u53E3 ${state.tenants.length} > \u98DF\u5802\u5BB9\u91CF ${caps.canteenCap}`);
    if (state.tenants.length > state.roomsBuilt) errs.push(`\u4EBA\u53E3 ${state.tenants.length} > \u623F\u95F4 ${state.roomsBuilt}`);
    for (const t of state.tenants) {
      if (t.panic < 0 || t.panic > 100) errs.push(`\u4F4F\u6237 ${t.id} panic \u8D8A\u754C: ${t.panic}`);
      if (t.hp <= 0) errs.push(`\u4F4F\u6237 ${t.id} hp \u2264 0\uFF08\u5E94\u6B7B\u4EA1\u79FB\u9664\uFF09`);
    }
    if (state.stats.deathsToday < 0 || state.stats.deathsTotal < 0) errs.push("\u6B7B\u4EA1\u8BA1\u6570\u4E3A\u8D1F");
    return errs;
  }
  function applyEffects(state, ops, deps) {
    const rejected = [];
    let applied = 0;
    const cap = canteenCap(state, deps.buildingDef);
    for (const op of ops) {
      let ok = true;
      let reason = "";
      switch (op.op) {
        case "ADD_GOLD":
          if (op.n < 0 && state.resources.gold + op.n < 0) {
            ok = false;
            reason = "\u91D1\u5E01\u4E0D\u8DB3";
          } else state.resources.gold += op.n;
          break;
        case "ADD_RES": {
          const cur = state.resources[op.res];
          if (op.n < 0 && cur + op.n < 0) {
            ok = false;
            reason = `${op.res} \u4E0D\u8DB3`;
          } else state.resources[op.res] = cur + op.n;
          break;
        }
        case "SPAWN_TENANT":
          if (state.tenants.length >= Math.min(cap, state.roomsBuilt)) {
            ok = false;
            reason = "\u65E0\u7A7A\u623F\u6216\u98DF\u5802\u5BB9\u91CF\u4E0D\u8DB3";
          } else state.tenants.push({ id: state.nextTenantId++, quality: op.quality, level: 1, job: "worker", hp: 100, panic: 0 });
          break;
        case "KILL_TENANT": {
          const idx2 = state.tenants.findIndex((t) => t.id === op.tenantId);
          if (idx2 < 0) {
            ok = false;
            reason = "\u4F4F\u6237\u4E0D\u5B58\u5728";
          } else if (state.stats.deathsToday >= deps.constants.GUARD_DEATH_DAY) {
            ok = false;
            reason = "\u5355\u65E5\u6B7B\u4EA1\u62A4\u680F";
          } else if (state.stats.deathsTotal >= deps.constants.GUARD_DEATH_30D) {
            ok = false;
            reason = "30 \u65E5\u6B7B\u4EA1\u62A4\u680F";
          } else {
            state.tenants.splice(idx2, 1);
            state.stats.deathsToday++;
            state.stats.deathsTotal++;
          }
          break;
        }
        case "WOUND_TENANT": {
          const t = state.tenants.find((t2) => t2.id === op.tenantId);
          if (!t) {
            ok = false;
            reason = "\u4F4F\u6237\u4E0D\u5B58\u5728";
          } else t.hp = Math.max(20, t.hp - 40);
          break;
        }
        case "UPGRADE_TENANT": {
          const t = state.tenants.find((t2) => t2.id === op.tenantId);
          if (!t) {
            ok = false;
            reason = "\u4F4F\u6237\u4E0D\u5B58\u5728";
          } else {
            const cost = upgradeCost(t.level, deps.constants.UPGRADE_BASE, deps.constants.UPGRADE_GROWTH);
            if (state.resources.gold < cost) {
              ok = false;
              reason = `\u91D1\u5E01\u4E0D\u8DB3\uFF08\u5347\u7EA7\u9700 ${cost}\uFF09`;
            } else {
              state.resources.gold -= cost;
              t.level++;
            }
          }
          break;
        }
        case "ADD_PANIC": {
          for (const t of state.tenants) {
            t.panic = Math.max(0, Math.min(deps.constants.PANIC_MAX, t.panic + op.n));
            if (state.day <= 7) t.panic = Math.min(t.panic, deps.constants.TUTORIAL_PANIC_CAP);
          }
          break;
        }
        case "SET_FLAG":
          state.flags[op.key] = op.v;
          break;
        case "GRANT_BUFF":
          state.flags[`buff_${op.buff}`] = op.days;
          break;
        case "NIGHT_MOD":
          state.flags[`nightmod_${op.mod}`] = 1;
          break;
      }
      if (ok) applied++;
      else rejected.push({ op, reason });
    }
    deps.audit?.record("effect", "applyEffects", { applied, rejected: rejected.length, day: state.day });
    return { applied, rejected };
  }
  function settleDawn(state, deps) {
    const C = deps.constants;
    const avgPanic = state.tenants.length ? state.tenants.reduce((a, t) => a + t.panic, 0) / state.tenants.length : 0;
    const panicFactor = avgPanic > C.PANIC_MEAN_PENALTY_AT ? C.PANIC_MEAN_PENALTY : 1;
    const monthlyBonus = state.flags.monthlyOwned ? 1.15 : 1;
    const income = deps.formula.dailyRent(state.tenants, { panicFactor, monthlyBonus });
    state.resources.gold += income;
    state.stats.goldEarnedTotal += income;
    const decay = C.PANIC_DECAY + (state.flags.curfew ? C.CURFEW_DECAY_BONUS : 0);
    for (const t of state.tenants) {
      t.panic = Math.max(0, t.panic - decay);
      if (t.hp < 100) t.hp = Math.min(100, t.hp + C.CLINIC_HEAL_HP * (state.clinicLevel ?? 1));
    }
    if (state.stats.breachesLastNight > 0) {
      for (const t of state.tenants) {
        t.panic = Math.min(C.PANIC_MAX, t.panic + C.PANIC_PROP_FLOOR);
        if (state.day <= 7) t.panic = Math.min(t.panic, C.TUTORIAL_PANIC_CAP);
      }
    }
    let escaped = 0;
    const remain = [];
    for (const t of state.tenants) {
      if (t.panic >= C.PANIC_ESCAPE_AT && deps.rng.next("tenant") < C.PANIC_ESCAPE_P) escaped++;
      else remain.push(t);
    }
    state.tenants = remain;
    state.stats.deathsToday = 0;
    state.stats.breachesLastNight = 0;
    deps.audit?.record("econ", "settleDawn", { day: state.day, income, escaped });
    return { income, escaped };
  }
  var BAND_DEATHS = { HOLD: 0, HOLD_WOUNDED: 0, LOSE_1: 1, LOSE_2: 2, LOSE_3P: 3 };
  var BAND_WOUNDS = { HOLD: 0, HOLD_WOUNDED: 2, LOSE_1: 1, LOSE_2: 1, LOSE_3P: 1 };
  function runNight(state, plan, deps) {
    if (plan.modifiers.includes("MIGRATE")) {
      const rooms = Array.from({ length: Math.max(state.roomsBuilt, plan.routes.length) }, (_, i) => `F1-R${i + 1}`);
      for (const rt of plan.routes) rt.roomId = rooms[Math.floor(deps.dayRng.next() * rooms.length)];
    }
    const silent = plan.modifiers.includes("SILENT");
    const W = plan.routes.length;
    const F = defensePower(state, deps.constants);
    const per = W > 0 ? F / W : 0;
    const routes = plan.routes.map((rt) => {
      const f = per;
      const r = rt.hp > 0 ? f / rt.hp : 9.99;
      return { roomId: rt.roomId, hp: rt.hp, f, r, outcome: deps.formula.judgeRoute(r), monsterId: rt.monsterId };
    });
    let worst = 0;
    let breaches = 0;
    for (const rt of routes) {
      worst = Math.max(worst, BAND_DEATHS[rt.outcome]);
      if (rt.r < 0.95) breaches++;
    }
    const wounds = Math.max(...routes.map((rt) => BAND_WOUNDS[rt.outcome]), 0);
    state.stats.breachesLastNight = breaches;
    const ops = [];
    for (let i = 0; i < worst; i++) {
      if (state.tenants.length === 0) break;
      const victim = state.tenants[Math.floor(deps.dayRng.next() * state.tenants.length)];
      ops.push({ op: "KILL_TENANT", tenantId: victim.id });
    }
    for (let i = 0; i < wounds; i++) {
      if (state.tenants.length === 0) break;
      const victim = state.tenants[Math.floor(deps.dayRng.next() * state.tenants.length)];
      ops.push({ op: "WOUND_TENANT", tenantId: victim.id });
    }
    const res = applyEffects(state, ops, deps);
    const deaths = res.applied > worst ? worst : ops.filter((o) => o.op === "KILL_TENANT" && !res.rejected.some((rj) => rj.op === o)).length;
    const woundsApplied = ops.length - res.rejected.length - deaths;
    const session = {
      day: plan.day,
      plan,
      power: F,
      allocation: routes.map((r) => r.f),
      routes,
      deaths,
      wounds: woundsApplied,
      migrated: plan.modifiers.includes("MIGRATE"),
      silent,
      settlementHash: hash32(canonicalJson({ day: plan.day, seed: plan.seed, migrated: plan.modifiers.includes("MIGRATE"), routes: routes.map((r) => ({ id: r.roomId, m: r.monsterId ?? "", r: Math.round(r.r * 1e4) / 1e4, o: r.outcome })), d: deaths, w: woundsApplied }))
    };
    deps.audit?.record("battle", "runNight", { day: plan.day, deaths, breaches });
    return session;
  }

  // packages/world/src/index.ts
  var isOvernight = (timeCost) => timeCost >= 3;
  function createWorldState(seed, tables2) {
    const w = {
      version: 1,
      seed,
      lots: {},
      buildings: {},
      stamina: {},
      gatherReadyDay: {},
      parties: [],
      nextPartyId: 1,
      totalYield: { food: 0, water: 0, material: 0, ammo: 0, gold: 0, talentStone: 0 }
    };
    unlockProgress(w, 1, tables2);
    return w;
  }
  function unlockProgress(w, day, tables2) {
    for (const e of tables2.mapDef.entries) {
      if (e.unlockDay > day) continue;
      if (e.kind === "lot") {
        w.lots[e.id] = { unlocked: true };
        if (e.building) w.buildings[e.id] = { unlocked: true };
      }
    }
  }
  function dispatchParty(w, state, tables2, constants, opts) {
    const entry = tables2.exploreDef.entries.find((e) => e.zone === opts.zone);
    if (!entry) return { ok: false, reason: `\u672A\u77E5\u76EE\u7684\u5730 ${opts.zone}` };
    if (entry.unlockDay > opts.day) return { ok: false, reason: `${opts.zone} \u672A\u89E3\u9501` };
    if (!w.lots[`lot_gate`]?.unlocked) return { ok: false, reason: "\u5927\u95E8\u672A\u5F00\u653E" };
    const partyCap = Math.min(entry.partyMax, constants.EXPLORE_PARTY_MAX ?? 3);
    if (opts.tenantIds.length < 1 || opts.tenantIds.length > partyCap) return { ok: false, reason: `\u961F\u4F0D\u4EBA\u6570\u987B 1\u2013${partyCap}` };
    const cost = entry.staminaCost;
    const members = [];
    for (const tid of opts.tenantIds) {
      const t = state.tenants.find((x) => x.id === tid);
      if (!t) return { ok: false, reason: `\u4F4F\u6237 ${tid} \u4E0D\u5B58\u5728` };
      if (t.hp <= 30) return { ok: false, reason: `\u4F4F\u6237 ${tid} \u91CD\u4F24\u4E0D\u53EF\u5916\u51FA` };
      const remain = w.stamina[String(tid)] ?? constants.EXPLORE_STAMINA_MAX ?? 100;
      if (remain < cost) return { ok: false, reason: `\u4F4F\u6237 ${tid} \u4F53\u529B\u4E0D\u8DB3\uFF08${remain}<${cost}\uFF09` };
      members.push({ tenantId: tid, stamina: remain - cost });
    }
    for (const m of members) w.stamina[String(m.tenantId)] = m.stamina;
    const overnight = isOvernight(entry.timeCost);
    const party = {
      id: w.nextPartyId++,
      zone: opts.zone,
      members,
      departedDay: opts.day,
      returnsDay: opts.day + (overnight ? 1 : 0),
      overnight,
      loot: [],
      log: [`${opts.day}\u65E5\u6D3E\u51FA\u2192${entry.id}`]
    };
    w.parties.push(party);
    return { ok: true, partyId: party.id };
  }
  function restoreStamina(w, state, constants) {
    const max = constants.EXPLORE_STAMINA_MAX ?? 100;
    for (const t of state.tenants) w.stamina[String(t.id)] = max;
  }
  function resolveDue(w, state, tables2, constants, day, weather) {
    const gMul = weather?.gatherMul ?? 1;
    const eMul = weather?.encounterMul ?? 1;
    const reports = [];
    const due = w.parties.filter((p) => p.returnsDay <= day);
    for (const party of due) {
      const entry = tables2.exploreDef.entries.find((e) => e.zone === party.zone);
      const rng = createDayRng(w.seed, "explore", day * 100 + party.id);
      const report = { partyId: party.id, loot: [], encounters: [], wounded: [] };
      const ops = [];
      const addLoot = (resource, amount) => {
        if (amount <= 0) return;
        party.loot.push({ resource, amount });
        report.loot.push({ resource, amount });
        w.totalYield[resource] = (w.totalYield[resource] ?? 0) + amount;
        ops.push(resource === "gold" ? { op: "ADD_GOLD", n: amount } : { op: "ADD_RES", res: resource, n: amount });
      };
      const nodes = tables2.gatherTable.entries.filter((g) => g.zone === party.zone && (w.gatherReadyDay[g.id] ?? 0) <= day);
      for (let i = 0; i < entry.gatherSlots && nodes.length > 0; i++) {
        const idx2 = Math.floor(rng.next() * nodes.length);
        const node = nodes.splice(idx2, 1)[0];
        const raw = node.yieldMin + Math.floor(rng.next() * (node.yieldMax - node.yieldMin + 1));
        const amount = Math.max(0, Math.round(raw * gMul));
        addLoot(node.resource, amount);
        w.gatherReadyDay[node.id] = day + node.respawnDays;
      }
      const mul = party.overnight ? constants.EXPLORE_NIGHT_DANGER_MUL ?? 2 : 1;
      const hourPool = tables2.wildlife.entries.filter((x) => x.zones.includes(party.zone) && x.unlockDay <= day && (party.overnight ? x.activeHours !== "day" : x.activeHours !== "night"));
      const encounterP = Math.min(0.95, 0.35 * mul * eMul);
      if (hourPool.length > 0 && rng.next() < encounterP) {
        const animal = hourPool[Math.floor(rng.next() * hourPool.length)];
        const winP = Math.min(0.95, (constants.WILDLIFE_FIGHT_WIN_BASE ?? 0.7) + (party.members.length - 1) * 0.06);
        if (rng.next() < winP) {
          for (const d of animal.drops) addLoot(d.resource, d.amount);
          report.encounters.push(`\u906D\u9047${animal.name}\uFF1A\u6218\u80DC`);
        } else {
          const victim = party.members[Math.floor(rng.next() * party.members.length)];
          ops.push({ op: "WOUND_TENANT", tenantId: victim.tenantId });
          report.wounded.push(victim.tenantId);
          const lost = party.loot.map((l) => ({ resource: l.resource, amount: Math.floor(l.amount * 0.3) }));
          for (const l of lost) {
            if (l.amount <= 0) continue;
            party.loot.find((x) => x.resource === l.resource).amount -= l.amount;
            report.loot.find((x) => x.resource === l.resource).amount -= l.amount;
            w.totalYield[l.resource] -= l.amount;
            ops.push(l.resource === "gold" ? { op: "ADD_GOLD", n: -l.amount } : { op: "ADD_RES", res: l.resource, n: -l.amount });
          }
          report.encounters.push(`\u906D\u9047${animal.name}\uFF1A\u6218\u8D25\u8D1F\u4F24\uFF0C\u635F\u5931\u90E8\u5206\u7269\u8D44`);
        }
      }
      if (ops.length > 0) applyEffects(state, ops, { constants, buildingDef: tables2.buildingDef });
      party.log.push(`${day}\u65E5\u5F52\u6765\uFF1A\u7269\u8D44${report.loot.reduce((a, b) => a + b.amount, 0)}\uFF0C\u906D\u9047${report.encounters.length}\u6B21`);
      reports.push(report);
    }
    w.parties = w.parties.filter((p) => p.returnsDay > day);
    return reports;
  }
  var serializeWorld = (w) => canonicalJson(w);

  // packages/diag/src/index.ts
  function createDiagPlugin(options = {}) {
    const ringSize = options.ringSize ?? 512;
    const auditSize = options.auditSize ?? 256;
    return definePlugin({
      name: "rn.diag",
      version: "0.1.0",
      hotplug: "core",
      depends: [],
      provides: ["logger", "audit"],
      produces: ["diag/record"],
      hooks: {
        setup(ctx) {
          const ring = [];
          let dropped = 0;
          const auditRing = [];
          const push = (e) => {
            if (ring.length >= ringSize) {
              ring.shift();
              dropped++;
            }
            ring.push(e);
          };
          const logger = {
            log(level, channel, msg, data) {
              push({ wallTs: Date.now(), logicalDay: ctx.logicalDay(), level, channel, traceId: ctx.traceId(), msg, data });
            },
            entries: () => [...ring],
            tail: (n) => ring.slice(Math.max(0, ring.length - n)),
            size: () => ring.length
          };
          const audit = {
            record(kind, actor, detail) {
              auditRing.push({ wallTs: Date.now(), kind, actor, detail });
              if (auditRing.length > auditSize) auditRing.shift();
            },
            tail: (n) => auditRing.slice(Math.max(0, auditRing.length - n))
          };
          ctx.onAny((env) => {
            if (env.tag === "diag/leak" || env.tag === "diag/degraded" || env.tag === "ctrl/killswitch") {
              push({
                wallTs: env.wallTs,
                logicalDay: env.logicalDay,
                level: env.tag === "diag/leak" ? "error" : "warn",
                channel: env.tag,
                traceId: env.traceId,
                msg: "kernel governance event",
                data: env.payload
              });
            }
          });
          ctx.provide("logger", logger);
          ctx.provide("audit", audit);
        }
      },
      health: () => ({ status: "ok" })
    });
  }

  // packages/weather/src/index.ts
  var BLOOD_MOON_DAYS = [7, 14, 21, 28];
  function weatherOfDay(day, seed, tables2) {
    if (BLOOD_MOON_DAYS.includes(day)) {
      return tables2.weather.entries.find((e) => e.id === "blood_dust");
    }
    const pool = tables2.weather.entries.filter((e) => !e.exploreDisabled && e.unlockDay <= day);
    const weightOf = (e) => day >= 8 ? e.weightAfter : e.weightBase;
    const total = pool.reduce((a, e) => a + weightOf(e), 0);
    const rng = createDayRng(seed, "weather", day);
    let roll = rng.next() * total;
    for (const e of pool) {
      roll -= weightOf(e);
      if (roll <= 0) return e;
    }
    return pool[pool.length - 1];
  }
  var weatherMuls = (w) => ({
    gatherMul: w.gatherMul,
    encounterMul: w.encounterMul
  });

  // apps/headless/src/sim.ts
  function buildBundle(app2, options = {}) {
    const diag = createDiagPlugin();
    const formula = definePlugin({
      name: "rn.formula",
      version: "0.1.0",
      hotplug: "core",
      depends: [],
      provides: ["formula"],
      produces: [],
      hooks: { setup(ctx) {
        ctx.provide("formula", app2.formula);
      } }
    });
    const save = definePlugin({
      name: "rn.save",
      version: "0.1.0",
      hotplug: "core",
      depends: [],
      provides: ["persistence"],
      produces: [],
      hooks: {
        setup(ctx) {
          const store = /* @__PURE__ */ new Map();
          ctx.provide("persistence", {
            put(slot, json) {
              store.set(slot, json);
            },
            get(slot) {
              return store.get(slot);
            },
            size() {
              return store.size;
            }
          });
        }
      }
    });
    const systems = definePlugin({
      name: "rn.systems",
      version: "0.1.0",
      hotplug: "core",
      depends: [{ service: "formula" }, { service: "persistence" }],
      provides: ["game"],
      produces: [],
      hooks: {
        setup(ctx) {
          ctx.provide("game", { tables: app2.tables, createState: (seed) => createGameState(seed) });
        }
      }
    });
    const battle = definePlugin({
      name: "rn.battle",
      version: "0.1.0",
      hotplug: "standard",
      depends: [{ service: "game" }, { service: "formula" }],
      provides: ["battle"],
      produces: ["battle/result"],
      hooks: {
        setup(ctx) {
          ctx.provide("battle", {
            run: (state, plan) => runNight(state, plan, {
              formula: app2.formula,
              constants: app2.constants,
              buildingDef: app2.tables.buildingDef,
              dayRng: createDayRng(state.seed, "monster", plan.day),
              audit: { record: (kind, actor, detail) => {
                ctx.emit("battle/result", { kind, actor, detail });
              } }
            })
          });
        }
      }
    });
    const director = definePlugin({
      name: "rn.director",
      version: "0.2.0",
      hotplug: "standard",
      depends: [{ service: "game" }, { service: "formula" }],
      provides: ["director"],
      produces: ["event/fired", "night/plan"],
      hooks: {
        setup(ctx) {
          ctx.provide("director", {
            scriptedEffectsFor(day, state) {
              return app2.eventLib.entries.filter((e) => e.type === "scripted" && ((e.triggerDay ?? 0) === day || day === 1 && (e.triggerDay ?? 99) === 0)).map((e) => ({ id: e.id, effects: rollOutcome(e, state, day, createDayRng(state.seed, "event", day * 100 + (e.triggerDay ?? 0))) }));
            },
            selectDay(state, day) {
              const slots = 1 + day % 2;
              const rng = createDayRng(state.seed, "director", day);
              const avgPanic = state.tenants.length ? state.tenants.reduce((a, t) => a + t.panic, 0) / state.tenants.length : 0;
              const eligible = (e) => {
                if (e.type === "scripted") return false;
                const pr = e.prereq ?? {};
                if (day < (pr.dayMin ?? 0) || pr.dayMax !== void 0 && day > pr.dayMax) return false;
                if (pr.panicMax !== void 0 && avgPanic > pr.panicMax) return false;
                if (pr.panicMin !== void 0 && avgPanic < pr.panicMin) return false;
                if (pr.reputationMin !== void 0 && (state.flags.reputation ?? 0) < pr.reputationMin) return false;
                for (const [k, v] of Object.entries(pr.flags ?? {})) if ((state.flags[k] ?? 0) < v) return false;
                if ((state.flags[`fired_${e.id}`] ?? 0) >= e.maxPerRun) return false;
                const last = state.flags[`last_${e.id}`] ?? -99;
                if (day - last < e.cooldownDays) return false;
                return true;
              };
              const pool = app2.eventLib.entries.filter((e) => eligible(e)).map((e) => ({ e, w: e.weight }));
              const chosen = [];
              for (let s = 0; s < slots && pool.length > 0; s++) {
                const total = pool.reduce((a, x) => a + x.w, 0);
                let roll = rng.next() * total;
                let picked = pool[pool.length - 1];
                for (const x of pool) {
                  roll -= x.w;
                  if (roll <= 0) {
                    picked = x;
                    break;
                  }
                }
                pool.splice(pool.indexOf(picked), 1);
                chosen.push(picked.e);
              }
              if (chosen.length === 0) {
                const fb = app2.eventLib.entries.filter((e) => ["evt_ord_207", "evt_box_003", "evt_birthday_013"].includes(e.id) && eligible(e));
                if (fb.length) chosen.push(fb[Math.floor(rng.next() * fb.length)]);
              }
              return chosen.map((e) => ({ id: e.id, effects: rollOutcome(e, state, day, rng) }));
            },
            planNight(state, day) {
              const row = app2.formula.row(day);
              const rng = createDayRng(state.seed, "monster", day);
              const occupied = Array.from({ length: Math.min(state.tenants.length, state.roomsBuilt) }, (_, i) => `F1-R${i + 1}`);
              const pool = occupied.length > 0 ? occupied : ["F1-R1"];
              const modifiers = app2.formula.bloodMoon(day) ? ["BLOOD_MOON"] : [];
              if (!app2.formula.bloodMoon(day) && (day === 17 || day === 25)) modifiers.push("SILENT");
              if (day === 11 || day === 26) modifiers.push("MIGRATE");
              const unlockedBlds = ["lot_bld_a", ...day >= 30 ? ["lot_bld_b", "lot_bld_c"] : []];
              const lotId = unlockedBlds[(day - 1) % unlockedBlds.length];
              const candidates = app2.monsters.entries.filter((m) => m.active && m.unlockDay <= day && (m.usableNightMods.includes("NORMAL") || m.usableNightMods.some((x) => modifiers.includes(x))));
              const routes = Array.from({ length: row.routes }, (_, i) => {
                const m = candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : void 0;
                return { roomId: pool[Math.floor(rng.next() * pool.length)], hp: row.hp, monsterId: m?.id ?? "m_seeker" };
              });
              return { day, routes, modifiers, seed: rng.next(), lotId };
            }
          });
        }
      }
    });
    const list = [diag, formula, save, systems, battle, director];
    if (options.devtools) {
      list.push(definePlugin({
        name: "rn.devtools",
        version: "0.1.0",
        hotplug: "scope",
        depends: [],
        provides: ["devtools"],
        produces: [],
        hooks: {
          setup(ctx) {
            ctx.provide("devtools", {
              dump() {
                return { plugin: "rn.devtools", note: "M2 \u96CF\u5F62\uFF1A\u5065\u5EB7/\u65E5\u5FD7\u7531 diagnose \u547D\u4EE4\u8F93\u51FA" };
              }
            });
          }
        }
      }));
    }
    return list;
  }
  function summarizeEffects(ops) {
    const parts = [];
    for (const op of ops) {
      if (op.op === "ADD_GOLD") parts.push(`\u91D1\u5E01${op.n >= 0 ? "+" : ""}${op.n}`);
      else if (op.op === "ADD_RES") parts.push(`${op.res}${op.n >= 0 ? "+" : ""}${op.n}`);
      else if (op.op === "ADD_PANIC") parts.push(`\u6050\u614C+${op.n}`);
      else if (op.op === "WOUND_TENANT") parts.push("\u4F4F\u6237\u8D1F\u4F24");
      else if (op.op === "SPAWN_TENANT") parts.push(`\u65B0\u4F4F\u6237\u5165\u4F4F\uFF08${op.quality}\uFF09`);
      else if (op.op === "UPGRADE_TENANT") parts.push("\u4F4F\u6237\u5347\u7EA7");
      else if (op.op === "GRANT_BUFF") parts.push(`\u83B7\u5F97 ${op.buff}`);
      else if (op.op === "NIGHT_MOD") parts.push(`\u7279\u6B8A\u591C ${op.mod}`);
    }
    return parts.length ? parts.join(" \xB7 ") : "\u65E0\u76F4\u63A5\u72B6\u6001\u53D8\u5316";
  }
  function rollOutcome(e, state, day, rng) {
    const option = e.options[0];
    if (!option) return [];
    let roll = rng.next();
    let picked = option.outcomes[option.outcomes.length - 1];
    for (const oc of option.outcomes) {
      roll -= oc.p;
      if (roll > 0) continue;
      picked = oc;
      break;
    }
    const resolve = (op) => {
      if ((op.op === "KILL_TENANT" || op.op === "WOUND_TENANT") && op.tenantId === -1) {
        if (state.tenants.length === 0) return { op: "SET_FLAG", key: "noop", v: 1 };
        const victim = state.tenants[Math.floor(rng.next() * state.tenants.length)];
        return { ...op, tenantId: victim.id };
      }
      return op;
    };
    const bookkeep = [
      { op: "SET_FLAG", key: `fired_${e.id}`, v: (state.flags[`fired_${e.id}`] ?? 0) + 1 },
      { op: "SET_FLAG", key: `last_${e.id}`, v: day }
    ];
    return [...picked.effects.map(resolve), ...bookkeep];
  }
  function target(d, t) {
    return t.dayCurve.rows.find((r) => r.day === d)?.population ?? 30;
  }
  function runSimulation(app2, kernel2, options) {
    if (options.explore && !app2.world) throw new Error("explore=true \u9700\u8981 AppContext.world\uFF08\u56DB\u5F20\u4E16\u754C\u8868\uFF09");
    const { tables: tables2, constants } = app2;
    const formula = kernel2.service("formula");
    const director = kernel2.service("director");
    const battle = kernel2.service("battle");
    const persistence = kernel2.service("persistence");
    const state = kernel2.service("game").createState(options.seed);
    const rng = createRngStreams(options.seed);
    const exploreOn = options.explore === true;
    const world2 = exploreOn ? createWorldState(options.seed, app2.world) : void 0;
    let exploreYieldTotal = 0;
    const explorePolicy = (d) => {
      if (!world2) return null;
      const order = ["zn_deep_forest", "zn_ruins", "zn_farm", "zn_forest_edge"];
      const entry = order.map((z) => app2.world.exploreDef.entries.find((e) => e.zone === z)).find((e) => e.unlockDay <= d);
      if (!entry) return null;
      const cost = entry.staminaCost;
      const members = [...state.tenants].filter((t) => t.hp > 30 && (world2.stamina[String(t.id)] ?? constants.EXPLORE_STAMINA_MAX) >= cost).sort((a, b) => (world2.stamina[String(b.id)] ?? 0) - (world2.stamina[String(a.id)] ?? 0) || a.id - b.id).slice(0, Math.min(constants.EXPLORE_PARTY_MAX ?? 3, entry.partyMax));
      if (members.length === 0) return null;
      return { zone: entry.zone, tenantIds: members.map((m) => m.id) };
    };
    const records = [];
    const sessions = {};
    const findings = [];
    const distinctFired = /* @__PURE__ */ new Set();
    const eventCounts = {};
    const eventCards = {};
    let eventsFired = 0;
    let spent = 0;
    let checkpoints = 0;
    for (let d = 1; d <= options.days; d++) {
      state.day = d;
      state.phase = "DAY";
      const weather = app2.weather ? weatherOfDay(d, options.seed, { weather: app2.weather }) : void 0;
      const row = tables2.dayCurve.rows.find((r) => r.day === d);
      while (state.canteenLevel < 5) {
        const next = tables2.buildingDef.entries.find((b) => b.type === "canteen" && b.level === state.canteenLevel + 1);
        if (!next || canteenCap(state, tables2.buildingDef) >= target(d, tables2)) break;
        if (state.resources.gold < (next.cost.gold ?? 0)) break;
        state.resources.gold -= next.cost.gold ?? 0;
        state.canteenLevel++;
      }
      while (state.roomsBuilt < Math.min(target(d, tables2), canteenCap(state, tables2.buildingDef)) && state.resources.gold >= constants.M1_ROOM_GOLD) {
        state.resources.gold -= constants.M1_ROOM_GOLD;
        state.roomsBuilt++;
      }
      const wounded = state.tenants.filter((t) => t.hp < 100).length;
      if (wounded > 0 && state.clinicLevel < 3) {
        const next = tables2.buildingDef.entries.find((b) => b.type === "clinic" && b.level === state.clinicLevel + 1);
        if (next && state.resources.gold >= (next.cost.gold ?? 0)) {
          state.resources.gold -= next.cost.gold ?? 0;
          state.clinicLevel++;
        }
      }
      const effPower = defensePower(state, constants);
      const need = Math.max(0, formula.fReq(d) - effPower);
      const invest = Math.min(Math.ceil(need * constants.CFG_K_POWER), Math.floor(state.resources.gold * 0.6));
      state.resources.gold -= invest;
      state.defense.power += Math.floor(invest / constants.CFG_K_POWER);
      let stockQ = state.tenants.reduce((a, x) => a + { N: 1, R: 1.5, SR: 2.5, SSR: 5 }[x.quality], 0);
      const popGoal = target(d, tables2);
      const qMul = { N: 1, R: 1.5, SR: 2.5, SSR: 5 };
      const tiers = ["N", "R", "SR", "SSR"];
      while (state.tenants.length < Math.min(popGoal, state.roomsBuilt, canteenCap(state, tables2.buildingDef)) && state.resources.gold >= constants.M1_RECRUIT_GOLD) {
        const gap = row.q * popGoal - stockQ;
        const remaining = Math.max(1, popGoal - state.tenants.length);
        const needPer = Math.max(1, Math.min(5, gap / remaining));
        let q = "N";
        let best = 99;
        for (const tier of tiers) {
          const d2 = Math.abs(qMul[tier] - needPer);
          if (d2 < best) {
            best = d2;
            q = tier;
          }
        }
        const r = applyEffects(state, [{ op: "SPAWN_TENANT", quality: q }], { constants, buildingDef: tables2.buildingDef });
        if (r.applied === 0) break;
        stockQ += qMul[q];
      }
      const targetLevel = levelForU(row.u, constants.CFG_G_U);
      for (; ; ) {
        const needy = [...state.tenants].filter((x) => x.level < targetLevel).sort((a, b) => a.level - b.level)[0];
        if (!needy) break;
        const r = applyEffects(state, [{ op: "UPGRADE_TENANT", tenantId: needy.id }], { constants, buildingDef: tables2.buildingDef });
        if (r.applied === 0) break;
      }
      const todays = [...director.scriptedEffectsFor(d, state), ...director.selectDay(state, d)];
      let events = 0;
      for (const ev of todays) {
        applyEffects(state, ev.effects, { constants, buildingDef: tables2.buildingDef });
        events++;
        distinctFired.add(ev.id);
        eventCounts[ev.id] = (eventCounts[ev.id] ?? 0) + 1;
      }
      eventsFired += events;
      eventCards[d] = todays.map((ev) => {
        const e = app2.eventLib.entries.find((x) => x.id === ev.id);
        return {
          id: ev.id,
          title: e?.title ?? ev.id,
          text: e?.text,
          weight: e?.weight ?? 0,
          options: (e?.options ?? []).map((o) => ({ label: o.label, ps: o.outcomes.map((oc) => oc.p) })),
          // ev.effects = 实际掷中 outcome 的效果 + 2 条 bookkeep（fired_/last_），剔除后即结果摘要
          resultText: summarizeEffects(ev.effects.filter((op) => !(op.op === "SET_FLAG" && (String(op.key).startsWith("fired_") || String(op.key).startsWith("last_")))))
        };
      });
      persistence.put(`ckpt_${d}_day`, serialize(state));
      if (exploreOn && world2) {
        restoreStamina(world2, state, constants);
        const plan2 = explorePolicy(d);
        if (plan2) dispatchParty(world2, state, app2.world, constants, { zone: plan2.zone, tenantIds: plan2.tenantIds, day: d });
      }
      checkpoints++;
      state.phase = "DUSK_FORECAST";
      const plan = director.planNight(state, d);
      persistence.put(`ckpt_${d}_dusk`, serialize(state));
      checkpoints++;
      state.phase = "NIGHT";
      const session = battle.run(state, plan);
      sessions[d] = session;
      persistence.put(`ckpt_${d}_night`, serialize(state));
      checkpoints++;
      state.phase = "DAWN_SETTLE";
      let dayExploreYield = 0;
      if (exploreOn && world2) {
        const before = { ...world2.totalYield };
        resolveDue(world2, state, app2.world, constants, d, weather ? weatherMuls(weather) : void 0);
        dayExploreYield = world2.totalYield.food - before.food + (world2.totalYield.water - before.water) + (world2.totalYield.material - before.material) * 2;
        exploreYieldTotal += dayExploreYield;
        persistence.put(`ckpt_${d}_world`, serializeWorld(world2));
      }
      const settle = settleDawn(state, { formula, constants, rng });
      const rAvg = session.routes.length ? session.routes.reduce((a, r) => a + r.r, 0) / session.routes.length : 9.99;
      const invariantErrors = checkInvariants(state, { canteenCap: canteenCap(state, tables2.buildingDef), warehouseCap: 3e4 });
      records.push({
        day: d,
        population: state.tenants.length,
        roomsBuilt: state.roomsBuilt,
        gold: state.resources.gold,
        income: settle.income,
        power: state.defense.power,
        rAvg: Math.round(rAvg * 1e3) / 1e3,
        deaths: session.deaths,
        wounds: session.wounds,
        sessionHash: session.settlementHash,
        invariantErrors,
        events,
        checkpoints: 3,
        modifiers: plan.modifiers,
        avgLevel: state.tenants.length ? Math.round(state.tenants.reduce((a, t) => a + t.level, 0) / state.tenants.length * 10) / 10 : 0,
        targetLevel: levelForU(row.u, constants.CFG_G_U),
        panicSum: state.tenants.reduce((a, t) => a + t.panic, 0),
        spend: spent,
        wealth: state.resources.gold + state.resources.food + state.resources.material,
        exploreYield: exploreOn ? dayExploreYield : 0,
        weather: weather?.id ?? "sunny"
      });
      spent = 0;
    }
    const finalHash = hash32(canonicalJson(records));
    const simBeta = betaSim(records, tables2);
    const designed = [17, 27, 42, 58];
    for (let i = 0; i < simBeta.length; i++) {
      if (Math.abs(simBeta[i] - designed[i]) > 5) {
        findings.push(`\u03B2_sim D${[1, 8, 15, 22][i]}-=${simBeta[i]}% vs \u8BBE\u8BA1 ${designed[i]}%\uFF1A\u5347\u7EA7\u7EBF\u8DDF\u8E2A\u504F\u79BB\uFF08M2 FINDING-1 \u5DF2\u95ED\u73AF\uFF0C\u6B64\u5904\u4E3A\u5B9E\u9645\u8FD0\u884C\u504F\u5DEE\uFF09`);
      }
    }
    const stabilizer = stabilizerL1(records);
    return { records, finalHash, findings, sessions, eventsFired, distinctFired: [...distinctFired], eventCounts, eventCards, world: exploreOn ? world2 : void 0, stabilizer };
  }
  function stabilizerL1(records) {
    const windows = [[1, 7], [8, 14], [15, 21], [22, 28], [29, 30]];
    return windows.map(([s, e]) => {
      const recs = records.filter((r) => r.day >= s && r.day <= e);
      const income = recs.reduce((a, r) => a + r.income, 0);
      const spend = recs.reduce((a, r) => a + r.spend, 0);
      const wealth = recs.length ? recs[recs.length - 1].wealth : 0;
      const panic = recs.reduce((a, r) => a + r.panicSum, 0);
      return { window: `D${s}-${e}`, wealth, produceConsume: spend > 0 ? Math.round(income / spend * 100) / 100 : 0, panic };
    });
  }
  function betaSim(records, tables2) {
    const windows = [[1, 7], [8, 14], [15, 21], [22, 28]];
    return windows.map(([s, e]) => {
      const fStart = s === 1 ? tables2.dayCurve.rows[0].fReq : records.find((r) => r.day === s - 1)?.power ?? tables2.dayCurve.rows[s - 1].fReq;
      const fEnd = records.find((r) => r.day === e)?.power ?? 0;
      const sumI = records.filter((r) => r.day >= s && r.day <= e).reduce((a, r) => a + r.income, 0);
      if (sumI === 0) return 0;
      return Math.round((fEnd - fStart) * 2.6 / sumI * 1e3) / 10;
    });
  }

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
    version: 2,
    sourceDoc: "docs/M0-\u6570\u503C\u6A21\u578B-\u4E09\u66F2\u7EBF\u8C03\u53C2\u8868.md \xA72 / docs/\u6280\u672F\u67B6\u6784\u4E0E\u6A21\u5757\u89C4\u5212 v1.0 \xA75.3 / docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1 \xA73 / docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA79.5",
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
      },
      {
        key: "UPGRADE_BASE",
        value: 0.5,
        min: 0.5,
        max: 10,
        desc: "\u4F4F\u6237\u5347\u7EA7\u57FA\u7840\u6210\u672C\uFF08\u91D1\u5E01\uFF0CM2 FINDING-1 \u95ED\u73AF\uFF09",
        sourceDoc: "M2 \u53EF\u6267\u884C\u76EE\u6807 \u529F\u80FD\u70B91"
      },
      {
        key: "UPGRADE_GROWTH",
        value: 1.18,
        min: 1.18,
        max: 1.18,
        desc: "\u5347\u7EA7\u6210\u672C\u7EA7\u589E\u7CFB\u6570\uFF08\u5408\u540C\u56FA\u5B9A\uFF09",
        sourceDoc: "M2 \u53EF\u6267\u884C\u76EE\u6807 \u529F\u80FD\u70B91"
      },
      {
        key: "GUARD_POWER",
        value: 15,
        min: 10,
        max: 25,
        desc: "\u5B88\u536B\u5C97\u4F4D\u6218\u529B\u8D21\u732E",
        sourceDoc: "M2 \u529F\u80FD\u70B94"
      },
      {
        key: "CLINIC_HEAL_HP",
        value: 10,
        min: 5,
        max: 20,
        desc: "\u533B\u52A1\u5BA4\u6BCF\u7EA7\u6CBB\u7597 HP",
        sourceDoc: "M2 \u529F\u80FD\u70B94"
      },
      {
        key: "CURFEW_DECAY_BONUS",
        value: 5,
        min: 3,
        max: 8,
        desc: "\u5BB5\u7981\u516C\u7EA6\u6050\u614C\u8870\u51CF\u52A0\u6210",
        sourceDoc: "M2 \u529F\u80FD\u70B94"
      },
      {
        key: "EXPLORE_STAMINA_MAX",
        value: 100,
        min: 80,
        max: 150,
        desc: "\u4F4F\u6237\u4F53\u529B\u4E0A\u9650\uFF08\u5916\u51FA\u63A2\u7D22\u6D88\u8017\u6C60\uFF09",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74"
      },
      {
        key: "EXPLORE_STAMINA_COST_BASE",
        value: 20,
        min: 10,
        max: 45,
        desc: "\u5916\u51FA\u57FA\u7840\u4F53\u529B\u6D88\u8017\uFF08explore_def.staminaCost \u4E3A\u533A\u57DF\u52A0\u6210\u57FA\u51C6\uFF09",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74"
      },
      {
        key: "EXPLORE_TIME_BASE",
        value: 1,
        min: 1,
        max: 2,
        desc: "\u5916\u51FA\u57FA\u7840\u65F6\u95F4\u7247\u6D88\u8017",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74"
      },
      {
        key: "EXPLORE_NIGHT_DANGER_MUL",
        value: 2,
        min: 1.5,
        max: 3,
        desc: "\u591C\u665A\u91CE\u5916\u906D\u9047/\u5371\u9669\u500D\u7387",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74.2"
      },
      {
        key: "EXPLORE_YIELD_TARGET_D8",
        value: 480,
        min: 288,
        max: 672,
        desc: "D8 \u7D2F\u8BA1\u91CE\u5916\u4EA7\u51FA\u6298\u7B97\u951A\u70B9\uFF08\u98DF\u7269/\u6C34=1\u3001\u5EFA\u6750=2\uFF1B\u5B9E\u6D4B\u6821\u51C6 2026-08-31\uFF09",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA79.6"
      },
      {
        key: "EXPLORE_YIELD_TARGET_D30",
        value: 2400,
        min: 1440,
        max: 3360,
        desc: "D30 \u7D2F\u8BA1\u91CE\u5916\u4EA7\u51FA\u6298\u7B97\u951A\u70B9\uFF08\u5B9E\u6D4B\u6821\u51C6 2026-08-31\uFF09",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA79.6"
      },
      {
        key: "WILDLIFE_FIGHT_WIN_BASE",
        value: 0.7,
        min: 0.5,
        max: 0.85,
        desc: "\u5371\u9669\u91CE\u7269\u6218\u6597\u57FA\u7840\u80DC\u7387\uFF08\u6218\u529B\u4FEE\u6B63\u524D\uFF09",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74.2"
      },
      {
        key: "EXPLORE_PARTY_MAX",
        value: 3,
        min: 1,
        max: 3,
        desc: "\u5916\u51FA\u961F\u4F0D\u4EBA\u6570\u4E0A\u9650",
        sourceDoc: "\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1 \xA74.2"
      }
    ]
  };

  // config/building_def.json
  var building_def_default = {
    version: 2,
    sourceDoc: "docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA77\uFF08\u516C\u5171\u5EFA\u7B51\uFF1A\u8BBE\u8BA1\u65B9\u6848 4.1\uFF09",
    entries: [
      {
        type: "room",
        level: 1,
        cost: {
          gold: 300
        },
        slots: {
          tenant: 1,
          fort: 2
        },
        unlockDay: 0
      },
      {
        type: "canteen",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 10
      },
      {
        type: "canteen",
        level: 2,
        cost: {
          gold: 500
        },
        capacity: 14
      },
      {
        type: "canteen",
        level: 3,
        cost: {
          gold: 1e3
        },
        capacity: 18
      },
      {
        type: "canteen",
        level: 4,
        cost: {
          gold: 2500
        },
        capacity: 24
      },
      {
        type: "canteen",
        level: 5,
        cost: {
          gold: 5e3
        },
        capacity: 30
      },
      {
        type: "warehouse",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 5e3
      },
      {
        type: "warehouse",
        level: 2,
        cost: {
          gold: 800
        },
        capacity: 12e3
      },
      {
        type: "warehouse",
        level: 3,
        cost: {
          gold: 2500
        },
        capacity: 3e4
      },
      {
        type: "broadcast",
        level: 1,
        cost: {
          gold: 600
        },
        unlockDay: 2
      },
      {
        type: "broadcast",
        level: 2,
        cost: {
          gold: 1800
        },
        unlockDay: 8
      },
      {
        type: "watchtower",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 1
      },
      {
        type: "watchtower",
        level: 2,
        cost: {
          gold: 400
        },
        capacity: 2
      },
      {
        type: "watchtower",
        level: 3,
        cost: {
          gold: 1200
        },
        capacity: 3
      },
      {
        type: "clinic",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "hall",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "workshop",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "house",
        level: 0,
        cost: {},
        durability: 0.8,
        unlockDay: 1,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv0\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 1,
        cost: {
          material: 50
        },
        durability: 0.9,
        unlockDay: 1,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv1\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 2,
        cost: {
          material: 150
        },
        durability: 1,
        unlockDay: 2,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv2\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 3,
        cost: {
          material: 400,
          gold: 200
        },
        durability: 1.15,
        unlockDay: 8,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv3\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 4,
        cost: {
          material: 800,
          gold: 500
        },
        durability: 1.3,
        unlockDay: 15,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv4\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 5,
        cost: {
          material: 1500,
          gold: 1200
        },
        durability: 1.5,
        unlockDay: 22,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv5\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      }
    ]
  };

  // config/event_lib.json
  var event_lib_default = {
    version: 3,
    sourceDoc: "docs/M0-\u4E8B\u4EF6\u6587\u6848\u5E9350\u6761.md",
    scope: "M2\uFF1A50 \u6761\u5168\u91CF\uFF08scripted 8 / choice 24 / mission 10 / ord 8\uFF09",
    entries: [
      {
        id: "evt_tut_fortify",
        ver: 1,
        type: "scripted",
        triggerDay: 0,
        title: "\u95E8\u53E3\u7684\u6293\u75D5",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u95E8\u677F\u4E0A\u6709\u65B0\u9C9C\u7684\u6293\u75D5\u2026\u2026\u8D81\u5929\u8FD8\u6CA1\u9ED1\uFF0C\u52A0\u56FA\u5B83\u3002",
        options: [
          {
            label: "\u52A0\u56FA\u95E8\uFF08\u6559\u5B66\u5F15\u5BFC\uFF09",
            outcomes: [
              {
                p: 1,
                text: "\u95E8\u677F\u5431\u5440\u4F5C\u54CD\uFF0C\u4F46\u7ED3\u5B9E\u4E86\u3002",
                effects: []
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_firstnight",
        ver: 1,
        type: "scripted",
        triggerDay: 0,
        title: "\u7B2C 1 \u591C\u52A8\u5458",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u5165\u591C\u524D\uFF0C\u628A\u6709\u9650\u7684\u4EBA\u624B\u5E03\u5230\u6700\u53EF\u80FD\u6709\u95EE\u9898\u7684\u4F4D\u7F6E\u3002",
        options: [
          {
            label: "\u5E03\u9632\u5F15\u5BFC",
            outcomes: [
              {
                p: 1,
                text: "\u591C\u8272\u538B\u4E0B\u6765\uFF0C\u697C\u91CC\u5B89\u9759\u5F97\u80FD\u542C\u89C1\u5FC3\u8DF3\u3002",
                effects: []
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_rescue",
        ver: 1,
        type: "scripted",
        triggerDay: 1,
        title: "\u9694\u58C1\u7684\u547C\u6551",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u300C\u6551\u547D\u2014\u2014\u8FD8\u6709\u4EBA\u5417\uFF01\u300D",
        options: [
          {
            label: "\u6D3E\u4E3B\u89D2\u53BB\u6551",
            outcomes: [
              {
                p: 1,
                text: "\u62D6\u56DE\u6765\u4E00\u4E2A\u6D51\u8EAB\u53D1\u6296\u7684\u5E78\u5B58\u8005\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_referral",
        ver: 1,
        type: "scripted",
        triggerDay: 2,
        title: "\u8001\u5F20\u8BF4\uFF1A\u6211\u8FD8\u6709\u4FE9\u90BB\u5C45",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u300C\u4ED6\u4EEC\u4EBA\u4E0D\u9519\uFF0C\u5C31\u5728\u4E0B\u4E00\u6761\u8857\u3002\u300D",
        options: [
          {
            label: "\u63A5\u5F15",
            outcomes: [
              {
                p: 1,
                text: "\u4E00\u8001\u4E00\u5C11\uFF0C\u884C\u674E\u90FD\u6CA1\u4E22\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_broadcast",
        ver: 1,
        type: "scripted",
        triggerDay: 2,
        title: "\u5E7F\u64AD\u7AD9\u7B2C\u4E00\u901A\u5E7F\u64AD",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u300C\u8FD9\u91CC\u662F 7 \u53F7\u697C\uFF0C\u6211\u4EEC\u6536\u7559\u6D3B\u4EBA\u3002\u300D",
        options: [
          {
            label: "\u62DB\u52DF",
            outcomes: [
              {
                p: 1,
                text: "\u5F53\u5929\u4E0B\u5348\uFF0C\u95E8\u53E3\u6392\u8D77\u4E86\u961F\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -100
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_bills",
        ver: 1,
        type: "scripted",
        triggerDay: 3,
        title: "\u7B2C\u4E00\u7B14\u300C\u7269\u4E1A\u8D39\u300D",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u4F4F\u8FDB\u6765\u53EF\u4EE5\uFF0C\u4F46\u89C4\u77E9\u5F97\u7ACB\uFF1A\u6309\u5929\u4EA4\u79DF\u3002",
        options: [
          {
            label: "\u6536\u79DF",
            outcomes: [
              {
                p: 1,
                text: "\u91D1\u5E01\u5165\u888B\u7684\u58F0\u97F3\uFF0C\u6BD4\u67AA\u58F0\u597D\u542C\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 300
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_panic",
        ver: 1,
        type: "scripted",
        triggerDay: 5,
        title: "\u6709\u4EBA\u534A\u591C\u5077\u54ED",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u6050\u614C\u50CF\u9709\u6591\uFF0C\u4F1A\u987A\u7740\u697C\u677F\u8513\u5EF6\u3002",
        options: [
          {
            label: "\u9010\u6237\u5B89\u629A",
            outcomes: [
              {
                p: 1,
                text: "\u54ED\u58F0\u505C\u4E86\u3002\u4EBA\u5FC3\uFF0C\u4E5F\u662F\u8981\u4FEE\u7684\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -10
                  },
                  {
                    op: "SET_FLAG",
                    key: "orderIntro",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tut_omen",
        ver: 1,
        type: "scripted",
        triggerDay: 6,
        title: "\u98CE\u5411\u4E0D\u5BF9",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 0,
        text: "\u72D7\u4E0D\u53EB\u4E86\u3002\u98CE\u91CC\u6709\u94C1\u9508\u5473\u3002",
        options: [
          {
            label: "\u767B\u9AD8\u89C2\u661F",
            outcomes: [
              {
                p: 1,
                text: "\u6708\u4EAE\u662F\u7EA2\u7684\u3002\u660E\u5929\uFF0C\u662F\u8840\u6708\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "bloodmoonForetold",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_knock_001",
        ver: 1,
        type: "choice",
        title: "\u6DF1\u591C\u6572\u95E8\u4EBA",
        weight: 100,
        cooldownDays: 5,
        maxPerRun: 2,
        prereq: {
          dayMin: 3
        },
        text: "\u300C\u549A\u3001\u549A\u3001\u549A\u3002\u300D\u6DF1\u591C\u7684\u6572\u95E8\u58F0\u6BD4\u602A\u7269\u7684\u568E\u53EB\u66F4\u7606\u4EBA\u3002",
        options: [
          {
            label: "\u5F00\u95E8",
            outcomes: [
              {
                p: 0.7,
                text: "\u662F\u4E00\u5BB6\u4E09\u53E3\uFF0C\u5F53\u5BB6\u7684\u8FD8\u61C2\u6C34\u7535\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "R"
                  }
                ]
              },
              {
                p: 0.3,
                text: "\u5B83\u7684\u76AE\u80A4\u5728\u6708\u5149\u4E0B\u5265\u843D\u4E86\u2026\u2026",
                effects: [
                  {
                    op: "NIGHT_MOD",
                    mod: "SILENT"
                  }
                ]
              }
            ]
          },
          {
            label: "\u9694\u95E8\u8BE2\u95EE",
            outcomes: [
              {
                p: 1,
                text: "\u5BF9\u8BDD\u51E0\u53E5\u540E\u811A\u6B65\u58F0\u8FDC\u53BB\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u65E0\u89C6",
            outcomes: [
              {
                p: 1,
                text: "\u6572\u95E8\u58F0\u505C\u4E86\u3002\u4F60\u6709\u70B9\u540E\u6094\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_grain_002",
        ver: 1,
        type: "choice",
        title: "\u90BB\u5C45\u5077\u7CAE",
        weight: 90,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {
          dayMin: 3
        },
        text: "\u4ED3\u5E93\u5C11\u4E86\u4E24\u7BB1\u7F50\u5934\uFF0C\u6709\u4EBA\u770B\u89C1\u4E09\u697C\u7684\u738B\u78CA\u6628\u665A\u9B3C\u9B3C\u795F\u795F\u3002",
        options: [
          {
            label: "\u516C\u5BA1",
            outcomes: [
              {
                p: 1,
                text: "\u79E9\u5E8F\u7ACB\u4F4F\u4E86\uFF0C\u4F46\u4EBA\u5FC3\u60F6\u60F6\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 8
                  },
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u79C1\u4E86",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u4EA4\u56DE\u4E86\u4E00\u90E8\u5206\uFF0C\u8FD9\u4E8B\u7FFB\u7BC7\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 100
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u4EFB",
            outcomes: [
              {
                p: 1,
                text: "\u4ED3\u5E93\u7684\u9501\u5F62\u540C\u865A\u8BBE\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 5
                  },
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_box_003",
        ver: 1,
        type: "choice",
        title: "\u9633\u53F0\u7269\u8D44\u7BB1",
        weight: 85,
        cooldownDays: 5,
        maxPerRun: 2,
        prereq: {},
        text: "\u516D\u697C\u9633\u53F0\u540A\u4E0B\u6765\u4E00\u4E2A\u5BC6\u5C01\u7BB1\uFF0C\u7EF3\u5B50\u4E0A\u7CFB\u7740\u5B57\u6761\uFF1A\u300C\u7ED9\u6709\u7F18\u4EBA\u300D\u3002",
        options: [
          {
            label: "\u72EC\u5360",
            outcomes: [
              {
                p: 1,
                text: "\u7F50\u5934\u4E0E\u51C0\u6C34\uFF0C\u5168\u6536\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 300
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u5E73\u5206",
            outcomes: [
              {
                p: 1,
                text: "\u6309\u6237\u5206\u53D1\uFF0C\u697C\u91CC\u591A\u4E86\u4E9B\u6696\u610F\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -5
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6362\u60C5\u62A5",
            outcomes: [
              {
                p: 1,
                text: "\u5BF9\u9762\u697C\u7684\u773C\u7EBF\u7ED9\u4E86\u4EFD\u5DE1\u903B\u56FE\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "intel",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_rent_004",
        ver: 1,
        type: "choice",
        title: "\u8001\u5468\u6B20\u79DF",
        weight: 80,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u8001\u5468\u8E72\u5728\u95E8\u53E3\u62BD\u70DF\uFF1A\u300C\u5AB3\u5987\u75C5\u7740\uFF0C\u8FD9\u4E2A\u6708\u2026\u2026\u5BBD\u9650\u51E0\u5929\uFF1F\u300D",
        options: [
          {
            label: "\u514D\u79DF",
            outcomes: [
              {
                p: 1,
                text: "\u8001\u5468\u7EA2\u7740\u773C\u7736\u8FDE\u58F0\u9053\u8C22\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u7167\u6536",
            outcomes: [
              {
                p: 1,
                text: "\u89C4\u77E9\u5C31\u662F\u89C4\u77E9\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 500
                  }
                ]
              }
            ]
          },
          {
            label: "\u9A71\u8D76",
            outcomes: [
              {
                p: 1,
                text: "\u884C\u674E\u88AB\u6254\u4E0B\u697C\uFF0C\u697C\u91CC\u6CA1\u4EBA\u8BF4\u8BDD\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 200
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_hoard_005",
        ver: 1,
        type: "choice",
        title: "\u56E4\u79EF\u8005\u8001\u674E",
        weight: 70,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u8001\u674E\u5C4B\u91CC\u5806\u6EE1\u4E86\u7269\u8D44\uFF0C\u697C\u4E0B\u5374\u6709\u4EBA\u5728\u6328\u997F\u3002",
        options: [
          {
            label: "\u5F81\u7528",
            outcomes: [
              {
                p: 1,
                text: "\u7269\u8D44\u5145\u516C\uFF0C\u8001\u674E\u7EDD\u98DF\u6297\u8BAE\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 400
                  },
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              }
            ]
          },
          {
            label: "\u5206\u6210",
            outcomes: [
              {
                p: 1,
                text: "\u5404\u8BA9\u4E00\u6B65\uFF0C\u4ED3\u5E93\u8FDB\u8D26\u4E00\u534A\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 200
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u4EFB",
            outcomes: [
              {
                p: 1,
                text: "\u79E9\u5E8F\u54E8\u58F0\u5728\u8D70\u5ECA\u56DE\u8361\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_dog_006",
        ver: 1,
        type: "choice",
        title: "\u51CC\u6668\u7684\u72D7\u5420",
        weight: 65,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {},
        text: "\u5DF7\u5B50\u91CC\u6709\u6761\u571F\u72D7\uFF0C\u53EB\u6CD5\u5F88\u6709\u89C4\u5F8B\u2014\u2014\u50CF\u5728\u62A5\u4FE1\u3002",
        options: [
          {
            label: "\u6536\u7559",
            outcomes: [
              {
                p: 1,
                text: "\u72D7\u62F4\u5728\u4E00\u5C42\u5927\u5385\uFF0C\u591C\u91CC\u8033\u6735\u6BD4\u4EBA\u7075\u3002",
                effects: [
                  {
                    op: "GRANT_BUFF",
                    buff: "warnDog",
                    days: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u9A71\u8D76",
            outcomes: [
              {
                p: 1,
                text: "\u72D7\u8DD1\u4E86\uFF0C\u591C\u91CC\u9759\u5F97\u53D1\u614C\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 5
                  }
                ]
              }
            ]
          },
          {
            label: "\u65E0\u89C6",
            outcomes: [
              {
                p: 1,
                text: "\u72D7\u53EB\u4E86\u4E00\u6574\u591C\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_generator_007",
        ver: 1,
        type: "choice",
        title: "\u67F4\u6CB9\u53D1\u7535\u673A",
        weight: 70,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u9694\u58C1\u697C\u6361\u6765\u4E00\u53F0\u67F4\u6CB9\u53D1\u7535\u673A\uFF0C\u5F00\u53E3\u5C31\u8981\u5206\u7740\u7528\u3002",
        options: [
          {
            label: "\u5C0F\u533A\u5171\u7528",
            outcomes: [
              {
                p: 1,
                text: "\u5168\u697C\u706F\u706B\u901A\u660E\uFF0C\u6050\u614C\u6D88\u6563\u4E0D\u5C11\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -300
                  },
                  {
                    op: "ADD_PANIC",
                    n: -8
                  }
                ]
              }
            ]
          },
          {
            label: "\u81EA\u5BB6\u5907\u7528",
            outcomes: [
              {
                p: 1,
                text: "\u53D1\u7535\u673A\u9501\u8FDB\u4E86\u4F60\u5BB6\u50A8\u7269\u95F4\u3002",
                effects: [
                  {
                    op: "GRANT_BUFF",
                    buff: "power",
                    days: 2
                  }
                ]
              }
            ]
          },
          {
            label: "\u51FA\u79DF",
            outcomes: [
              {
                p: 1,
                text: "\u6309\u5C0F\u65F6\u8BA1\u8D39\uFF0C\u751F\u610F\u5174\u9686\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 400
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_divorce_008",
        ver: 1,
        type: "choice",
        title: "\u4E8C\u697C\u592B\u59BB\u5435\u67B6",
        weight: 60,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {},
        text: "\u6454\u7897\u58F0\u9694\u7740\u697C\u677F\u90FD\u80FD\u542C\u89C1\u3002",
        options: [
          {
            label: "\u4E0A\u95E8\u8C03\u89E3",
            outcomes: [
              {
                p: 1,
                text: "\u4E24\u53E3\u5B50\u548C\u597D\uFF0C\u8FD8\u786C\u585E\u4E86\u4E24\u6761\u70DF\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -5
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u4E0D\u63BA\u548C",
            outcomes: [
              {
                p: 1,
                text: "\u5435\u5427\uFF0C\u65E5\u5B50\u8FD8\u957F\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u8D81\u673A\u6536\u623F",
            outcomes: [
              {
                p: 1,
                text: "\u623F\u5B50\u5230\u624B\uFF0C\u4F46\u4F60\u6210\u4E86\u697C\u91CC\u7684\u8C08\u8D44\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 600
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_slingshot_009",
        ver: 1,
        type: "choice",
        title: "\u5B69\u5B50\u7684\u5F39\u5F13",
        weight: 55,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {},
        text: "\u4E94\u697C\u7684\u5B69\u5B50\u62FF\u5F39\u5F13\u6253\u8DEF\u706F\uFF0C\u788E\u77F3\u4E71\u98DE\u3002",
        options: [
          {
            label: "\u6CA1\u6536",
            outcomes: [
              {
                p: 1,
                text: "\u5B69\u5B50\u54ED\u4E86\u534A\u5929\uFF0C\u5BB6\u957F\u8138\u8272\u96BE\u770B\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6559\u5BFC",
            outcomes: [
              {
                p: 1,
                text: "\u5B69\u5B50\u6210\u4E86\u697C\u9876\u7684\u77AD\u671B\u54E8\u3002",
                effects: [
                  {
                    op: "GRANT_BUFF",
                    buff: "sentryKid",
                    days: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u4EFB",
            outcomes: [
              {
                p: 1,
                text: "\u73BB\u7483\u53C8\u788E\u4E86\u4E00\u5757\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 5
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_medicine_010",
        ver: 1,
        type: "choice",
        title: "\u6700\u540E\u4E00\u6279\u6297\u751F\u7D20",
        weight: 75,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u533B\u52A1\u5BA4\u53EA\u5269\u6700\u540E\u4E00\u677F\u6297\u751F\u7D20\uFF0C\u4E09\u4E2A\u4EBA\u5728\u6392\u961F\u3002",
        options: [
          {
            label: "\u91CD\u60A3\u5148\u5F97",
            outcomes: [
              {
                p: 1,
                text: "\u8BE5\u6551\u7684\u6551\u4E86\uFF0C\u4EBA\u5FC3\u5B89\u7A33\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -5
                  }
                ]
              }
            ]
          },
          {
            label: "\u8D21\u732E\u8005\u5148\u5F97",
            outcomes: [
              {
                p: 1,
                text: "\u591A\u52B3\u591A\u5F97\uFF0C\u7AD9\u5C97\u7684\u52B2\u5934\u66F4\u8DB3\u4E86\u3002",
                effects: [
                  {
                    op: "GRANT_BUFF",
                    buff: "contrib",
                    days: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u62BD\u7B7E",
            outcomes: [
              {
                p: 1,
                text: "\u547D\u8FD0\u9762\u524D\u4EBA\u4EBA\u5E73\u7B49\uFF0C\u60C5\u7EEA\u610F\u5916\u5E73\u7A33\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_rumor_011",
        ver: 1,
        type: "choice",
        title: "\u300C\u660E\u5929\u602A\u4E0D\u6765\u4E86\u300D",
        weight: 70,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {},
        text: "\u4E0D\u77E5\u9053\u8C01\u4F20\u7684\uFF1A\u6C38\u591C\u8981\u7ED3\u675F\u4E86\uFF0C\u602A\u7269\u660E\u5929\u5C31\u4E0D\u6765\u4E86\u3002",
        options: [
          {
            label: "\u8F9F\u8C23",
            outcomes: [
              {
                p: 1,
                text: "\u5927\u5587\u53ED\u5E7F\u64AD\u4E86\u4E09\u904D\uFF0C\u8C23\u8A00\u6B62\u4F4F\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -6
                  }
                ]
              }
            ]
          },
          {
            label: "\u5229\u7528",
            outcomes: [
              {
                p: 1,
                text: "\u300C\u672B\u65E5\u4FDD\u9669\u300D\u5356\u5F97\u98DE\u8D77\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 300
                  },
                  {
                    op: "SET_FLAG",
                    key: "trust",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u65E0\u89C6",
            outcomes: [
              {
                p: 1,
                text: "\u6709\u4EBA\u771F\u7684\u4E0D\u8BBE\u9632\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 4
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_note_012",
        ver: 1,
        type: "choice",
        title: "\u95E8\u7F1D\u91CC\u7684\u7EB8\u6761",
        weight: 65,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {
          dayMin: 4
        },
        text: "\u7EB8\u6761\u4E0A\u753B\u7740\u4E00\u4E2A\u7BAD\u5934\uFF0C\u6307\u5411\u5730\u4E0B\u5BA4\u7684\u901A\u98CE\u4E95\u3002",
        options: [
          {
            label: "\u6309\u7EB8\u6761\u8D74\u7EA6",
            outcomes: [
              {
                p: 0.5,
                text: "\u662F\u4E2A\u8EB2\u4E86\u534A\u6708\u7684\u59D1\u5A18\uFF0C\u624B\u4E0A\u529F\u592B\u4E0D\u9519\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              },
              {
                p: 0.5,
                text: "\u901A\u98CE\u4E95\u91CC\u53EA\u6709\u6293\u75D5\u548C\u8840\u8FF9\u3002",
                effects: [
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u7F6E\u4E4B\u4E0D\u7406",
            outcomes: [
              {
                p: 1,
                text: "\u7EB8\u6761\u5728\u95E8\u7F1D\u91CC\u53D1\u9EC4\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          },
          {
            label: "\u70E7\u6389",
            outcomes: [
              {
                p: 1,
                text: "\u7701\u5F97\u591C\u91CC\u80E1\u601D\u4E71\u60F3\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 2
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_birthday_013",
        ver: 1,
        type: "choice",
        title: "\u697C\u91CC\u7B2C\u4E00\u4E2A\u751F\u65E5",
        weight: 60,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {},
        text: "\u4ECA\u5929\u662F\u5C0F\u96E8\u7684\u516B\u5C81\u751F\u65E5\uFF0C\u86CB\u7CD5\u662F\u4E0D\u53EF\u80FD\u7684\u3002",
        options: [
          {
            label: "\u529E\u6D3E\u5BF9",
            outcomes: [
              {
                p: 1,
                text: "\u642A\u74F7\u7F38\u78B0\u5728\u4E00\u8D77\uFF0C\u50CF\u8FC7\u5E74\u7684\u58F0\u97F3\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -200
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u53D6\u6D88",
            outcomes: [
              {
                p: 1,
                text: "\u5B69\u5B50\u6CA1\u54ED\uFF0C\u5927\u4EBA\u5FC3\u91CC\u4E0D\u662F\u6ECB\u5473\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u53CC\u4EFD\u53E3\u7CAE",
            outcomes: [
              {
                p: 1,
                text: "\u5168\u697C\u90FD\u8DDF\u7740\u6CBE\u4E86\u5149\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -300
                  },
                  {
                    op: "ADD_PANIC",
                    n: -5
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_thief_014",
        ver: 1,
        type: "choice",
        title: "\u5916\u697C\u7684\u7A83\u8D3C",
        weight: 65,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u5DE1\u903B\u961F\u902E\u4E86\u4E2A\u73B0\u5F62\uFF0C\u4EBA\u8D43\u5E76\u83B7\u3002",
        options: [
          {
            label: "\u516C\u5BA1",
            outcomes: [
              {
                p: 1,
                text: "\u79E9\u5E8F\u7ACB\u5A01\uFF0C\u56F4\u89C2\u8005\u5664\u58F0\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  },
                  {
                    op: "ADD_PANIC",
                    n: 4
                  }
                ]
              }
            ]
          },
          {
            label: "\u6536\u7F16",
            outcomes: [
              {
                p: 0.4,
                text: "\u5F00\u9501\u7684\u624B\u827A\u786E\u5B9E\u6709\u7528\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              },
              {
                p: 0.6,
                text: "\u7B2C\u4E8C\u665A\uFF0C\u4ED3\u5E93\u7684\u9501\u88AB\u4ECE\u91CC\u9762\u6253\u5F00\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -200
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u8D70\u6362\u60C5\u62A5",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u753B\u4E86\u5F20\u602A\u7269\u7684\u6D3B\u52A8\u56FE\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "intel",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_rat_015",
        ver: 1,
        type: "choice",
        title: "\u4ED3\u5E93\u9F20\u60A3",
        weight: 60,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {},
        text: "\u9EBB\u888B\u4E0A\u5168\u662F\u9F7F\u5370\uFF0C\u7CAE\u4ED3\u6210\u4E86\u9F20\u7A9D\u3002",
        options: [
          {
            label: "\u517B\u732B",
            outcomes: [
              {
                p: 1,
                text: "\u5DF7\u5B50\u91CC\u8BA8\u6765\u4E00\u53EA\u72F8\u82B1\uFF0C\u9F20\u60A3\u6E10\u6D88\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -100
                  },
                  {
                    op: "GRANT_BUFF",
                    buff: "cat",
                    days: 7
                  }
                ]
              }
            ]
          },
          {
            label: "\u6295\u836F",
            outcomes: [
              {
                p: 1,
                text: "\u6B7B\u8001\u9F20\u6E05\u7406\u4E86\u4E00\u7C38\u7B95\uFF0C\u4E5F\u8BEF\u4F24\u4E86\u4E24\u888B\u7C73\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -300
                  }
                ]
              }
            ]
          },
          {
            label: "\u6539\u9020\u8D27\u67B6",
            outcomes: [
              {
                p: 1,
                text: "\u5EFA\u6750\u53C8\u82B1\u4E86\u4E00\u7B14\uFF0C\u4F46\u4E00\u52B3\u6C38\u9038\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: -250
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_radio_016",
        ver: 1,
        type: "choice",
        title: "\u5916\u754C\u7684\u5E7F\u64AD",
        weight: 60,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 7
        },
        text: "\u7535\u53F0\u91CC\u5FAA\u73AF\u64AD\u653E\u7740\u64A4\u79BB\u70B9\u7684\u5750\u6807\uFF0C\u771F\u5047\u96BE\u8FA8\u3002",
        options: [
          {
            label: "\u56DE\u5E94",
            outcomes: [
              {
                p: 1,
                text: "Morse \u7801\u56DE\u4E86\u4E09\u77ED\u4E09\u957F\uFF0C\u697C\u91CC\u58EB\u6C14\u4E00\u632F\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u4FDD\u6301\u9759\u9ED8",
            outcomes: [
              {
                p: 1,
                text: "\u67AA\u6253\u51FA\u5934\u9E1F\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u4F2A\u9020\u56DE\u5E94",
            outcomes: [
              {
                p: 1,
                text: "\u9A97\u5230\u4E86\u4E00\u6279\u7A7A\u6295\u7269\u8D44\uFF0C\u4F46\u6709\u4EBA\u8D77\u4E86\u7591\u5FC3\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 500
                  },
                  {
                    op: "SET_FLAG",
                    key: "trust",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_deadbeat_017",
        ver: 1,
        type: "choice",
        title: "\u62D2\u79DF\u7684\u523A\u5934",
        weight: 70,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u56DB\u697C\u7684\u523A\u5934\u628A\u623F\u79DF\u62CD\u5728\u5730\u4E0A\uFF1A\u300C\u7231\u8981\u4E0D\u8981\u3002\u300D",
        options: [
          {
            label: "\u5BBD\u9650",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u53CD\u800C\u4E0D\u597D\u610F\u601D\u4E86\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u65AD\u4F9B",
            outcomes: [
              {
                p: 1,
                text: "\u7B2C\u4E09\u5929\uFF0C\u91D1\u5E01\u548C\u9053\u6B49\u4E00\u8D77\u9001\u6765\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 800
                  },
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              }
            ]
          },
          {
            label: "\u9A71\u9010",
            outcomes: [
              {
                p: 1,
                text: "\u884C\u674E\u6EDA\u4E0B\u697C\u68AF\uFF0C\u697C\u91CC\u4E00\u7247\u8083\u9759\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 400
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_deed_018",
        ver: 1,
        type: "choice",
        title: "\u5F52\u6765\u7684\u300C\u623F\u4E1C\u300D",
        weight: 50,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 8
        },
        text: "\u4E00\u4E2A\u897F\u88C5\u9769\u5C65\u7684\u7537\u4EBA\u4E3E\u7740\u623F\u4EA7\u8BC1\uFF1A\u300C\u8FD9\u680B\u697C\uFF0C\u662F\u6211\u7684\u3002\u300D",
        options: [
          {
            label: "\u5171\u6CBB\u5206\u6210",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u5165\u4F19\u4E86\uFF0C\u5E26\u6765\u4E00\u7B14\u542F\u52A8\u91D1\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 1e3
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6233\u7A7F\u4F2A\u9020",
            outcomes: [
              {
                p: 0.6,
                text: "\u516C\u7AE0\u662F\u841D\u535C\u523B\u7684\uFF0C\u4EBA\u7FA4\u54C4\u7B11\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 1500
                  }
                ]
              },
              {
                p: 0.4,
                text: "\u4ED6\u6897\u7740\u8116\u5B50\u8D70\u4E86\uFF0C\u58F0\u8A89\u53D7\u635F\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u8BA4\u683D\u8865\u507F",
            outcomes: [
              {
                p: 1,
                text: "\u7834\u8D22\u514D\u707E\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -500
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_nightshift_019",
        ver: 1,
        type: "choice",
        title: "\u8C01\u503C\u591C\u73ED",
        weight: 65,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {},
        text: "\u5B88\u591C\u8868\u8D34\u51FA\u6765\u4E09\u5929\uFF0C\u540D\u5B57\u680F\u8FD8\u662F\u7A7A\u767D\u3002",
        options: [
          {
            label: "\u8F6E\u73ED",
            outcomes: [
              {
                p: 1,
                text: "\u516C\u5E73\uFF0C\u4F46\u6BCF\u4E2A\u4EBA\u90FD\u9876\u7740\u9ED1\u773C\u5708\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u52A0\u85AA\u5FD7\u613F",
            outcomes: [
              {
                p: 1,
                text: "\u91CD\u8D4F\u4E4B\u4E0B\uFF0C\u5C97\u54E8\u6EE1\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -400
                  },
                  {
                    op: "GRANT_BUFF",
                    buff: "paidwatch",
                    days: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u4E3B\u89D2\u9876\u73ED",
            outcomes: [
              {
                p: 1,
                text: "\u4F60\u6253\u7740\u54C8\u6B20\u5B88\u5230\u5929\u4EAE\uFF0C\u5A01\u671B\u6DA8\u4E86\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_pet_020",
        ver: 1,
        type: "choice",
        title: "\u5BA0\u7269\u533B\u9662",
        weight: 50,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {},
        text: "\u836F\u5E97\u7684\u91D1\u6BDB\u96BE\u4EA7\uFF0C\u4E3B\u4EBA\u8DEA\u5728\u5730\u4E0A\u6C42\u6551\u3002",
        options: [
          {
            label: "\u6025\u6551",
            outcomes: [
              {
                p: 1,
                text: "\u4E94\u53EA\u5D3D\u5B50\u6D3B\u4E86\u4E0B\u6765\uFF0C\u6BCD\u72AC\u6210\u4E86\u7F16\u5916\u4FDD\u5B89\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: -150
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u5F03",
            outcomes: [
              {
                p: 1,
                text: "\u54C0\u568E\u4E86\u4E00\u6574\u591C\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 4
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_yoga_021",
        ver: 1,
        type: "choice",
        title: "\u5929\u53F0\u7684\u5BCC\u5A46",
        weight: 60,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 7
        },
        text: "\u5929\u53F0\u4E0A\u6709\u4EBA\u5728\u505A\u745C\u4F3D\uFF0C\u745C\u4F3D\u57AB\u662F\u7231\u9A6C\u4ED5\u7684\u3002",
        options: [
          {
            label: "\u6536\u9AD8\u989D\u79DF",
            outcomes: [
              {
                p: 1,
                text: "\u5979\u773C\u90FD\u6CA1\u7728\u5C31\u4ED8\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 1500
                  }
                ]
              }
            ]
          },
          {
            label: "\u8BF7\u5979\u6559\u7406\u8D22",
            outcomes: [
              {
                p: 1,
                text: "\u5979\u7B11\uFF1A\u300C\u6709\u70B9\u610F\u601D\u3002\u300D",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "laiScore",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u65E0\u89C6",
            outcomes: [
              {
                p: 1,
                text: "\u5979\u505A\u5B8C\u4E00\u7EC4\u62DC\u65E5\u5F0F\u5C31\u8D70\u4E86\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_blackout_022",
        ver: 1,
        type: "choice",
        title: "\u505C\u7535\u591C",
        weight: 65,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {},
        text: "\u6574\u680B\u697C\u9677\u5165\u9ED1\u6697\uFF0C\u8D70\u5ECA\u91CC\u5168\u662F\u6478\u7D22\u7684\u58F0\u97F3\u3002",
        options: [
          {
            label: "\u70B9\u8721\u70DB",
            outcomes: [
              {
                p: 1,
                text: "\u70DB\u5149\u6447\u66F3\uFF0C\u4EBA\u5FC3\u4E5F\u8DDF\u7740\u6643\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -100
                  },
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u53D1\u7535\u673A\u5168\u5F00",
            outcomes: [
              {
                p: 1,
                text: "\u8F70\u9E23\u58F0\u91CC\uFF0C\u706F\u5168\u4EAE\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: -100
                  },
                  {
                    op: "ADD_PANIC",
                    n: -6
                  }
                ]
              }
            ]
          },
          {
            label: "\u6478\u9ED1",
            outcomes: [
              {
                p: 0.4,
                text: "\u9ED1\u6697\u4E2D\u4F20\u6765\u51E0\u58F0\u60CA\u53EB\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              },
              {
                p: 0.6,
                text: "\u5C45\u7136\u4E5F\u6CA1\u51FA\u4EC0\u4E48\u4E8B\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_love_023",
        ver: 1,
        type: "choice",
        title: "\u5730\u4E0B\u5BA4\u7684\u5A5A\u793C",
        weight: 55,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {},
        text: "\u5730\u4E0B\u5BA4\u4E00\u5BF9\u5E74\u8F7B\u4EBA\u8981\u6210\u5A5A\uFF0C\u60F3\u501F\u4E00\u697C\u529E\u4EEA\u5F0F\u3002",
        options: [
          {
            label: "\u6210\u5168",
            outcomes: [
              {
                p: 1,
                text: "\u7CD6\u679C\u662F\u7CD6\u7EB8\u6298\u7684\uFF0C\u638C\u58F0\u662F\u771F\u7684\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u68D2\u6253\u9E33\u9E2F",
            outcomes: [
              {
                p: 1,
                text: "\u59D1\u5A18\u54ED\u4E86\u4E00\u591C\uFF0C\u697C\u91CC\u6307\u6307\u70B9\u70B9\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              }
            ]
          },
          {
            label: "\u6536\u793C\u91D1",
            outcomes: [
              {
                p: 1,
                text: "\u573A\u5730\u8D39\u7167\u6536\uFF0C\u9A82\u58F0\u7167\u6765\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 300
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_tycoon_024",
        ver: 1,
        type: "choice",
        title: "\u5BCC\u5546\u6C42\u5E87\u62A4",
        weight: 65,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 8
        },
        text: "\u897F\u88C5\u7537\u4EBA\u5E26\u7740\u4E24\u4E2A\u884C\u674E\u7BB1\uFF1A\u300C\u6211\u80FD\u4ED8\u3002\u300D",
        options: [
          {
            label: "\u6536\u5341\u91D1\u5165\u4F19",
            outcomes: [
              {
                p: 1,
                text: "\u884C\u674E\u7BB1\u91CC\u662F\u91D1\u6761\u548C\u7F50\u5934\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 1e3
                  }
                ]
              }
            ]
          },
          {
            label: "\u514D\u8D39\u5E87\u62A4",
            outcomes: [
              {
                p: 1,
                text: "\u300C\u597D\u4EBA\u5450\uFF01\u300D\u5168\u697C\u4F20\u9882\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 2
                  }
                ]
              }
            ]
          },
          {
            label: "\u62D2\u7EDD",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u6D88\u5931\u5728\u591C\u8272\u91CC\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_101",
        ver: 1,
        type: "mission",
        title: "7 \u697C\u8001\u592A\u88AB\u56F0",
        weight: 100,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {
          dayMin: 3
        },
        text: "7 \u697C\u4F20\u6765\u8BF4\u4E0D\u6E05\u662F\u4EBA\u662F\u7269\u7684\u649E\u51FB\u58F0\u2014\u2014\u88AB\u56F0\u7684\u8001\u592A\u592A\u8FD8\u5728\u91CC\u9762\u3002",
        options: [
          {
            label: "\u6D3E\u4EBA\u6551",
            outcomes: [
              {
                p: 0.7,
                text: "\u8001\u592A\u592A\u88AB\u80CC\u4E0B\u697C\uFF0C\u585E\u7ED9\u961F\u5458\u4E00\u628A\u7CD6\u679C\u548C\u4E00\u5F20\u623F\u5361\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "R"
                  }
                ]
              },
              {
                p: 0.3,
                text: "\u4EBA\u6551\u51FA\u6765\u4E86\uFF0C\u961F\u5458\u6302\u4E86\u5F69\u3002",
                effects: [
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u9065\u63A7\u6307\u6325",
            outcomes: [
              {
                p: 0.5,
                text: "\u7535\u8BDD\u91CC\u6307\u70B9\u8DEF\u7EBF\uFF0C\u8001\u592A\u592A\u81EA\u5DF1\u6478\u4E86\u4E0B\u6765\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              },
              {
                p: 0.5,
                text: "\u4FE1\u53F7\u65AD\u4E86\uFF0C\u518D\u65E0\u56DE\u97F3\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 6
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u5F03",
            outcomes: [
              {
                p: 1,
                text: "\u649E\u51FB\u58F0\u505C\u4E86\u3002\u6574\u680B\u697C\u5B89\u9759\u5F97\u53EF\u6015\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_102",
        ver: 1,
        type: "mission",
        title: "\u836F\u623F\u7A81\u88AD",
        weight: 70,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 4
        },
        text: "\u8857\u89D2\u836F\u623F\u7684\u5377\u5E18\u95E8\u534A\u5F00\uFF0C\u91CC\u9762\u5E94\u8BE5\u8FD8\u6709\u5B58\u8D27\u3002",
        options: [
          {
            label: "\u4EB2\u81EA\u5E26\u961F",
            outcomes: [
              {
                p: 1,
                text: "\u836F\u54C1\u548C\u5F39\u836F\u88C5\u4E86\u4E24\u5927\u5305\uFF0C\u6709\u4EBA\u6302\u5F69\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 200
                  },
                  {
                    op: "ADD_RES",
                    res: "ammo",
                    n: 100
                  },
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6D3E\u5B88\u536B\u53BB",
            outcomes: [
              {
                p: 1,
                text: "\u7A33\u5B57\u5F53\u5934\uFF0C\u6536\u83B7\u6253\u4E86\u6298\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 100
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u5F03",
            outcomes: [
              {
                p: 1,
                text: "\u673A\u4F1A\u53EA\u6709\u4E00\u6B21\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "intel",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_103",
        ver: 1,
        type: "mission",
        title: "\u8D85\u5E02\u6E05\u573A",
        weight: 70,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {},
        text: "\u8FDE\u9501\u8D85\u5E02\u7684\u5377\u5E18\u95E8\u91CC\u4F20\u6765\u6B64\u8D77\u5F7C\u4F0F\u7684\u4F4E\u543C\u3002",
        options: [
          {
            label: "\u641C\u522E",
            outcomes: [
              {
                p: 1,
                text: "\u98DF\u54C1\u548C\u74F6\u88C5\u6C34\u642C\u7A7A\u4E86\u4E24\u6392\u8D27\u67B6\uFF0C\u6709\u4EBA\u88AB\u5212\u4F24\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 300
                  },
                  {
                    op: "ADD_RES",
                    res: "water",
                    n: 200
                  },
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u4FDD\u5B88\u6E05\u70B9",
            outcomes: [
              {
                p: 1,
                text: "\u53EA\u62FF\u4E86\u95E8\u53E3\u987A\u624B\u7684\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 120
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_104",
        ver: 1,
        type: "mission",
        title: "\u4E94\u91D1\u5E97\u5EFA\u6750",
        weight: 60,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u4E94\u91D1\u5E97\u8001\u677F\u8DD1\u4E86\uFF0C\u8D27\u67B6\u4E0A\u4E00\u6392\u6392\u89D2\u94A2\u8FD8\u5728\u3002",
        options: [
          {
            label: "\u6EE1\u8F7D\u800C\u5F52",
            outcomes: [
              {
                p: 1,
                text: "\u89D2\u94A2\u3001\u87BA\u4E1D\u3001\u95E8\u94F0\u94FE\uFF0C\u5168\u662F\u786C\u8D27\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 400
                  }
                ]
              }
            ]
          },
          {
            label: "\u5FEB\u64A4",
            outcomes: [
              {
                p: 1,
                text: "\u53EA\u62A2\u4E86\u624B\u8FB9\u7684\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 150
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_105",
        ver: 1,
        type: "mission",
        title: "\u52A0\u6CB9\u7AD9\u53D6\u6CB9",
        weight: 60,
        cooldownDays: 12,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u52A0\u6CB9\u7AD9\u7684\u50A8\u6CB9\u7F50\u8FD8\u6709\u4F59\u6CB9\uFF0C\u5C31\u662F\u5B88\u7740\u5B83\u7684\u4E1C\u897F\u4E0D\u592A\u53CB\u597D\u3002",
        options: [
          {
            label: "\u53D6\u6CB9",
            outcomes: [
              {
                p: 1,
                text: "\u4E09\u5927\u6876\u67F4\u6CB9\uFF0C\u987A\u4FBF\u62C6\u4E86\u4E24\u4E2A\u71C3\u70E7\u74F6\uFF0C\u6709\u4EBA\u88AB\u70EB\u4F24\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "ammo",
                    n: 80
                  },
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u5F03",
            outcomes: [
              {
                p: 1,
                text: "\u6CB9\u7F50\u7684\u547C\u5438\u5B54\u4F20\u6765\u522E\u64E6\u58F0\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_106",
        ver: 1,
        type: "mission",
        title: "\u6536\u5BB9\u6D41\u6D6A\u8005",
        weight: 65,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 4
        },
        text: "\u9AD8\u67B6\u6865\u4E0B\u8737\u7740\u51E0\u4E2A\u5E78\u5B58\u8005\uFF0C\u773C\u795E\u8B66\u60D5\u3002",
        options: [
          {
            label: "\u6536\u5BB9\u961F",
            outcomes: [
              {
                p: 1,
                text: "\u5E26\u56DE\u4E86\u51E0\u4E2A\u4EBA\uFF0C\u98DF\u5802\u538B\u529B\u5927\u4E86\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          },
          {
            label: "\u529D\u8D70",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u4EEC\u671D\u53E6\u4E00\u4E2A\u65B9\u5411\u53BB\u4E86\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_107",
        ver: 1,
        type: "mission",
        title: "\u533B\u9662\u5E9F\u589F",
        weight: 50,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 8
        },
        text: "\u5E02\u533B\u9662\u7684\u5E9F\u589F\u91CC\u636E\u8BF4\u8FD8\u6709\u4E00\u4F4D\u6CA1\u8D70\u7684\u62A4\u58EB\u957F\u3002",
        options: [
          {
            label: "\u6DF1\u5165",
            outcomes: [
              {
                p: 0.35,
                text: "\u62A4\u58EB\u957F SR \u7EA7\uFF0C\u5E26\u7740\u4E00\u7BB1\u836F\u54C1\u5F52\u961F\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "SR"
                  }
                ]
              },
              {
                p: 0.3,
                text: "\u836F\u54C1\u5230\u624B\uFF0C\u4F46\u4E24\u540D\u961F\u5458\u8D1F\u4F24\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 150
                  },
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  },
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  }
                ]
              },
              {
                p: 0.35,
                text: "\u65E0\u529F\u800C\u8FD4\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 3
                  }
                ]
              }
            ]
          },
          {
            label: "\u5916\u56F4\u6361\u6F0F",
            outcomes: [
              {
                p: 1,
                text: "\u8FB9\u7F18\u67DC\u53F0\u626B\u4E86\u4E00\u4E9B\u836F\u54C1\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 120
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_108",
        ver: 1,
        type: "mission",
        title: "\u5B66\u6821\u907F\u96BE\u6240",
        weight: 55,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 8
        },
        text: "\u5C0F\u5B66\u4F53\u80B2\u9986\u91CC\u6709\u4E8C\u5341\u51E0\u4E2A\u5E78\u5B58\u8005\uFF0C\u53EA\u6536\u5F97\u4E0B\u51E0\u4E2A\u3002",
        options: [
          {
            label: "\u63A5\u7EB3",
            outcomes: [
              {
                p: 1,
                text: "\u6765\u4E86\u8001\u5E08\u5E26\u7740\u4E24\u4E2A\u5B69\u5B50\uFF0C\u697C\u91CC\u591A\u4E86\u4EBA\u6C14\u4E5F\u591A\u4E86\u5634\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u62D2\u6536",
            outcomes: [
              {
                p: 1,
                text: "\u94C1\u95E8\u5728\u4ED6\u4EEC\u8EAB\u540E\u5173\u95ED\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_109",
        ver: 1,
        type: "mission",
        title: "\u94F6\u884C\u91D1\u5E93",
        weight: 45,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 10
        },
        text: "\u94F6\u884C\u5730\u4E0B\u91D1\u5E93\u7684\u7535\u5B50\u9501\u8FD8\u5269\u6700\u540E\u4E00\u9053\u2014\u2014\u91CC\u9762\u662F\u4F20\u8BF4\u4E2D\u7684\u91D1\u6761\u3002",
        options: [
          {
            label: "\u64AC\u5E93",
            outcomes: [
              {
                p: 1,
                text: "\u91D1\u6761\u5230\u624B\uFF01\u4F46\u52A8\u9759\u5F15\u6765\u4E86\u602A\u7269\u7684\u589E\u63F4\u6F6E\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 2500
                  },
                  {
                    op: "NIGHT_MOD",
                    mod: "SILENT"
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u5F03",
            outcomes: [
              {
                p: 1,
                text: "\u91D1\u5E93\u7684\u95E8\u5728\u8EAB\u540E\u7F13\u7F13\u5408\u4E0A\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_mis_110",
        ver: 1,
        type: "mission",
        title: "\u9AD8\u901F\u8DEF\u64A4\u79BB\u8F66\u961F",
        weight: 60,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 9
        },
        text: "\u64A4\u79BB\u8F66\u961F\u629B\u951A\u5728\u9AD8\u67B6\u4E0A\uFF0C\u4EBA\u613F\u610F\u4ED8\u94B1\u6362\u4E00\u4E2A\u94FA\u4F4D\u3002",
        options: [
          {
            label: "\u63A5\u5E94\u6536\u4EBA",
            outcomes: [
              {
                p: 1,
                text: "\u6BCF\u4EBA 200 \u91D1\u5E01\uFF0C\u6765\u4E86\u4E94\u4E2A\u4ED8\u8D39\u79DF\u5BA2\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 1e3
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  },
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          },
          {
            label: "\u9A71\u8D76",
            outcomes: [
              {
                p: 1,
                text: "\u8F66\u961F\u7684\u706F\u5149\u5728\u591C\u91CC\u8FDC\u53BB\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_201",
        ver: 1,
        type: "choice",
        title: "\u697C\u9053\u4E89\u5435",
        weight: 60,
        cooldownDays: 7,
        maxPerRun: 2,
        prereq: {},
        text: "\u4E94\u697C\u4E24\u6237\u4E3A\u4E86\u697C\u9053\u5806\u7269\u5435\u5230\u4E86\u52A8\u624B\u7684\u8FB9\u7F18\u3002",
        options: [
          {
            label: "\u8C03\u89E3",
            outcomes: [
              {
                p: 1,
                text: "\u5404\u9000\u4E00\u6B65\uFF0C\u697C\u9053\u91CD\u65B0\u901A\u7545\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -4
                  }
                ]
              }
            ]
          },
          {
            label: "\u5404\u6253\u4E94\u5341\u5927\u677F",
            outcomes: [
              {
                p: 1,
                text: "\u7F5A\u4E86\u4E24\u5BB6\u6E05\u626B\uFF0C\u79E9\u5E8F\u7ACB\u4E86\uFF0C\u6028\u6C14\u4E5F\u5B58\u4E86\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u51B7\u5904\u7406",
            outcomes: [
              {
                p: 1,
                text: "\u4E89\u5435\u5347\u7EA7\u6210\u4E86\u5BF9\u9A82\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 4
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_202",
        ver: 1,
        type: "choice",
        title: "\u85CF\u7CAE\u4E0E\u6328\u997F\u7684\u5B69\u5B50",
        weight: 70,
        cooldownDays: 12,
        maxPerRun: 2,
        prereq: {
          panicMin: 40
        },
        text: "\u6709\u4EBA\u56E4\u7CAE\uFF0C\u9694\u58C1\u7684\u5B69\u5B50\u5374\u997F\u5F97\u54ED\u4E0D\u51FA\u58F0\u3002",
        options: [
          {
            label: "\u641C\u67E5",
            outcomes: [
              {
                p: 1,
                text: "\u56E4\u7CAE\u5145\u516C\uFF0C\u56E4\u7CAE\u8005\u88AB\u626B\u5730\u51FA\u95E8\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 300
                  },
                  {
                    op: "ADD_PANIC",
                    n: 6
                  },
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u63A5\u6D4E",
            outcomes: [
              {
                p: 1,
                text: "\u81EA\u5BB6\u7684\u7C73\u7F38\u89C1\u5E95\u4E86\uFF0C\u4F46\u5B69\u5B50\u5403\u9971\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -200
                  },
                  {
                    op: "ADD_PANIC",
                    n: -6
                  }
                ]
              }
            ]
          },
          {
            label: "\u4E0D\u7BA1",
            outcomes: [
              {
                p: 1,
                text: "\u54ED\u58F0\u6301\u7EED\u5230\u540E\u534A\u591C\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 10
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_203",
        ver: 1,
        type: "choice",
        title: "\u81EA\u53D1\u5DE1\u903B\u961F",
        weight: 60,
        cooldownDays: 12,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u51E0\u4E2A\u5E74\u8F7B\u4EBA\u81EA\u53D1\u7EC4\u7EC7\u4E86\u591C\u95F4\u5DE1\u903B\u3002",
        options: [
          {
            label: "\u652F\u6301",
            outcomes: [
              {
                p: 1,
                text: "\u5DE1\u903B\u961F\u7684\u81C2\u7AE0\u662F\u7528\u7EA2\u5E03\u6761\u505A\u7684\u3002",
                effects: [
                  {
                    op: "GRANT_BUFF",
                    buff: "patrol",
                    days: 5
                  }
                ]
              }
            ]
          },
          {
            label: "\u53D1\u5DE5\u8D44\u6536\u7F16",
            outcomes: [
              {
                p: 1,
                text: "\u7ED9\u94B1\u624D\u6709\u6267\u884C\u529B\uFF0C\u4F46\u786E\u5B9E\u7BA1\u7528\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -500
                  },
                  {
                    op: "GRANT_BUFF",
                    buff: "patrolPaid",
                    days: 7
                  }
                ]
              }
            ]
          },
          {
            label: "\u89E3\u6563",
            outcomes: [
              {
                p: 1,
                text: "\u5DE1\u903B\u961F\u6563\u4E86\uFF0C\u591C\u91CC\u7684\u811A\u6B65\u58F0\u591A\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 5
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_204",
        ver: 1,
        type: "choice",
        title: "\u300C\u6536\u79DF\u9B3C\u300D\u6D82\u9E26",
        weight: 55,
        cooldownDays: 12,
        maxPerRun: 2,
        prereq: {},
        text: "\u5916\u5899\u4E0A\u88AB\u4EBA\u55B7\u4E86\u4E09\u4E2A\u5927\u7EA2\u5B57\uFF1A\u6536\u79DF\u9B3C\u3002",
        options: [
          {
            label: "\u6E05\u6D17",
            outcomes: [
              {
                p: 1,
                text: "\u6F06\u6CA1\u6D17\u5E72\u51C0\uFF0C\u5B57\u8FD8\u5728\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 0
                  }
                ]
              }
            ]
          },
          {
            label: "\u9ED8\u8BB8",
            outcomes: [
              {
                p: 1,
                text: "\u5E74\u8F7B\u4EBA\u89C9\u5F97\u8FD9\u79F0\u547C\u633A\u9177\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u53CD\u5411\u8425\u9500",
            outcomes: [
              {
                p: 1,
                text: "\u300C\u6536\u79DF\u9B3C\u4FDD\u62A4\u8D39\u300D\u7684\u6BB5\u5B50\u4F20\u904D\u4E86\u907F\u96BE\u6240\u5708\u5B50\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 200
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_205",
        ver: 1,
        type: "choice",
        title: "\u901D\u8005\u846C\u793C",
        weight: 65,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 7
        },
        text: "\u6B7B\u8005\u7684\u5BB6\u5C5E\u60F3\u529E\u4E00\u573A\u50CF\u6837\u7684\u846C\u793C\u3002",
        options: [
          {
            label: "\u529E\u4EEA\u5F0F",
            outcomes: [
              {
                p: 1,
                text: "\u767D\u82B1\u662F\u7528\u7EB8\u5DFE\u6298\u7684\uFF0C\u54C0\u4E50\u662F\u53E3\u7434\u5439\u7684\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -150
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u4ECE\u7B80",
            outcomes: [
              {
                p: 1,
                text: "\u4E00\u4E2A\u5751\uFF0C\u4E00\u5757\u6728\u677F\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u7814\u7A76\u5C38\u4F53",
            outcomes: [
              {
                p: 1,
                text: "\u4F24\u53E3\u7684\u9F7F\u75D5\u8BB0\u5F55\u8FDB\u4E86\u602A\u7269\u56FE\u9274\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "intel",
                    v: 1
                  },
                  {
                    op: "ADD_PANIC",
                    n: 6
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_206",
        ver: 1,
        type: "choice",
        title: "\u516C\u7EA6\u6295\u7968\uFF1A\u5BB5\u7981",
        weight: 70,
        cooldownDays: 14,
        maxPerRun: 2,
        prereq: {
          dayMin: 5,
          flags: {
            orderIntro: 1
          }
        },
        text: "\u8BAE\u4E8B\u5385\u8D34\u51FA\u544A\u793A\uFF1A\u662F\u5426\u5B9E\u884C\u5BB5\u7981\uFF0C\u5168\u697C\u6295\u7968\u3002",
        options: [
          {
            label: "\u901A\u8FC7",
            outcomes: [
              {
                p: 1,
                text: "\u5BB5\u7981\u4EE4\u4E0B\uFF0C\u591C\u91CC\u518D\u65E0\u4EBA\u8D70\u52A8\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "curfew",
                    v: 1
                  },
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u5426\u51B3",
            outcomes: [
              {
                p: 1,
                text: "\u81EA\u7531\u4E07\u5C81\u2014\u2014\u5FE7\u60A3\u6D3E\u6447\u4E86\u6447\u5934\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6298\u4E2D",
            outcomes: [
              {
                p: 1,
                text: "\u5BB5\u7981\u5230\u5341\u70B9\uFF0C\u5927\u5BB6\u90FD\u80FD\u63A5\u53D7\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "curfew",
                    v: 2
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_207",
        ver: 1,
        type: "choice",
        title: "\u516C\u533A\u5927\u626B\u9664",
        weight: 55,
        cooldownDays: 12,
        maxPerRun: 2,
        prereq: {},
        text: "\u697C\u9053\u79EF\u7070\uFF0C\u7535\u68AF\u53E3\u7684\u6742\u7269\u5806\u4E86\u534A\u4EBA\u9AD8\u3002",
        options: [
          {
            label: "\u5168\u5458\u52A8\u5458",
            outcomes: [
              {
                p: 1,
                text: "\u5927\u626B\u9664\u540E\u697C\u91CC\u4EAE\u5802\u4E86\uFF0C\u4EBA\u5FC3\u4E5F\u4EAE\u5802\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: -6
                  }
                ]
              }
            ]
          },
          {
            label: "\u96C7\u4EBA\u6253\u626B",
            outcomes: [
              {
                p: 1,
                text: "\u82B1\u94B1\u4E70\u6E05\u51C0\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: -250
                  },
                  {
                    op: "ADD_PANIC",
                    n: -4
                  }
                ]
              }
            ]
          },
          {
            label: "\u81EA\u5DF1\u4E0A",
            outcomes: [
              {
                p: 1,
                text: "\u4F60\u626B\u4E86\u4E00\u4E0B\u5348\uFF0C\u8170\u90FD\u76F4\u4E0D\u8D77\u6765\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "mood",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_ord_208",
        ver: 1,
        type: "choice",
        title: "\u751F\u9762\u5B54\u6DF7\u5165",
        weight: 65,
        cooldownDays: 10,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u7535\u68AF\u91CC\u51FA\u73B0\u4E86\u6CA1\u89C1\u8FC7\u7684\u9762\u5B54\uFF0C\u8C01\u4E5F\u8BF4\u4E0D\u6E05\u6765\u5386\u3002",
        options: [
          {
            label: "\u6392\u67E5",
            outcomes: [
              {
                p: 0.6,
                text: "\u865A\u60CA\u4E00\u573A\uFF0C\u662F\u9694\u58C1\u697C\u4E32\u95E8\u7684\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "order",
                    v: 1
                  }
                ]
              },
              {
                p: 0.4,
                text: "\u63EA\u51FA\u4E00\u4E2A\u53EF\u7591\u5206\u5B50\uFF0C\u9A71\u9010\u51FA\u5883\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: -1
                  }
                ]
              }
            ]
          },
          {
            label: "\u653E\u884C",
            outcomes: [
              {
                p: 1,
                text: "\u4E5F\u8BB8\u53EA\u662F\u4E2A\u501F\u5BBF\u7684\u3002",
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "reputation",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u6536\u7F16\u8003\u5BDF",
            outcomes: [
              {
                p: 1,
                text: "\u7559\u7528\u5BDF\u770B\uFF0C\u5E72\u6D3B\u90FD\u591A\u4E86\u4E00\u4EFD\u5FC3\u773C\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_001",
        ver: 1,
        type: "choice",
        title: "\u8702\u7FA4\u60CA\u6270",
        weight: 60,
        cooldownDays: 4,
        maxPerRun: 2,
        prereq: {
          dayMin: 3
        },
        text: "\u6797\u7F18\u7684\u91CE\u82B1\u4E1B\u91CC\u6345\u51FA\u4E86\u9A6C\u8702\u7A9D\uFF0C\u55E1\u9E23\u58F0\u8FFD\u7740\u4EBA\u8DD1\u3002",
        options: [
          {
            label: "\u64A4\u9000",
            outcomes: [
              {
                p: 1,
                text: "\u7CAE\u98DF\u6492\u4E86\u4E00\u8DEF\uFF0C\u4EBA\u6CA1\u4E8B\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -20
                  }
                ]
              }
            ]
          },
          {
            label: "\u9A71\u6563",
            outcomes: [
              {
                p: 0.5,
                text: "\u718F\u8D70\u4E86\u8702\u7FA4\uFF0C\u987A\u624B\u5272\u4E86\u871C\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 45
                  }
                ]
              },
              {
                p: 0.5,
                text: "\u88AB\u8707\u5F97\u6EE1\u5934\u5305\uFF0C\u871C\u4E5F\u6CA1\u62FF\u5230\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 10
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_002",
        ver: 1,
        type: "choice",
        title: "\u730E\u6237\u5C0F\u5C4B",
        weight: 40,
        cooldownDays: 6,
        maxPerRun: 1,
        prereq: {
          dayMin: 10
        },
        text: "\u6DF1\u6797\u91CC\u6709\u95F4\u4E0A\u9501\u7684\u730E\u6237\u5C0F\u5C4B\uFF0C\u70DF\u56F1\u5C45\u7136\u8FD8\u662F\u6E29\u7684\u3002",
        options: [
          {
            label: "\u7834\u95E8\u641C\u522E",
            outcomes: [
              {
                p: 0.6,
                text: "\u814A\u8089\u548C\u517D\u76AE\u88C5\u4E86\u6EE1\u6EE1\u4E00\u7B50\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 60
                  },
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 30
                  }
                ]
              },
              {
                p: 0.4,
                text: "\u5C4B\u4E3B\u56DE\u6765\u4E86\uFF0C\u51B7\u7740\u8138\u628A\u4F60\u4EEC\u8F70\u4E86\u51FA\u53BB\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              }
            ]
          },
          {
            label: "\u6572\u95E8\u95EE\u8BE2",
            outcomes: [
              {
                p: 0.8,
                text: "\u8001\u730E\u6237\u6559\u4E86\u4F60\u4EEC\u8BBE\u9677\u9631\u7684\u624B\u827A\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 35
                  },
                  {
                    op: "SET_FLAG",
                    key: "wd_hunter",
                    v: 1
                  }
                ]
              },
              {
                p: 0.2,
                text: "\u5C0F\u5C4B\u7A7A\u65E0\u4E00\u4EBA\uFF0C\u53EA\u6709\u4E00\u672C\u65E7\u7B14\u8BB0\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 15
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_003",
        ver: 1,
        type: "choice",
        title: "\u6355\u517D\u9677\u9631",
        weight: 50,
        cooldownDays: 5,
        maxPerRun: 2,
        prereq: {
          dayMin: 6
        },
        text: "\u53BB\u519C\u7530\u7684\u5C0F\u8DEF\u4E0A\u57CB\u7740\u6355\u517D\u5939\uFF0C\u9508\u8FF9\u6591\u6591\u4F46\u5F39\u7C27\u6709\u529B\u3002",
        options: [
          {
            label: "\u5C0F\u5FC3\u62C6\u9664",
            outcomes: [
              {
                p: 0.7,
                text: "\u62C6\u4E0B\u7684\u5939\u5B50\u9001\u8FDB\u4E86\u5DE5\u574A\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 25
                  }
                ]
              },
              {
                p: 0.3,
                text: "\u5939\u5B50\u7FFB\u4E86\uFF0C\u54AC\u5728\u624B\u4E0A\u3002",
                effects: [
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  },
                  {
                    op: "ADD_PANIC",
                    n: 6
                  }
                ]
              }
            ]
          },
          {
            label: "\u505A\u6807\u8BB0\u7ED5\u884C",
            outcomes: [
              {
                p: 1,
                effects: []
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_004",
        ver: 1,
        type: "choice",
        title: "\u96FE\u591C\u8FF7\u8DEF",
        weight: 45,
        cooldownDays: 6,
        maxPerRun: 1,
        prereq: {
          dayMin: 10
        },
        text: "\u6DF1\u6797\u7684\u96FE\u8BF4\u6765\u5C31\u6765\uFF0C\u706B\u628A\u53EA\u80FD\u7167\u5230\u4E09\u6B65\u8FDC\u3002",
        options: [
          {
            label: "\u539F\u5730\u5B88\u706B",
            outcomes: [
              {
                p: 0.8,
                effects: []
              },
              {
                p: 0.2,
                text: "\u5B88\u591C\u7684\u706B\u5806\u5F15\u6765\u597D\u5947\u7684\u91CE\u5154\uFF0C\u5012\u4E5F\u4E0D\u4E8F\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 15
                  }
                ]
              }
            ]
          },
          {
            label: "\u6478\u9ED1\u524D\u884C",
            outcomes: [
              {
                p: 0.5,
                text: "\u6123\u662F\u6478\u56DE\u4E86\u5C0F\u533A\uFF0C\u8FD8\u6361\u5230\u4E00\u7BB1\u7F50\u5934\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: 50
                  }
                ]
              },
              {
                p: 0.5,
                text: "\u6709\u4EBA\u6454\u8FDB\u4E86\u6C9F\u91CC\uFF0C\u7269\u8D44\u4E5F\u4E22\u4E86\u3002",
                effects: [
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  },
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -25
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_005",
        ver: 1,
        type: "choice",
        title: "\u6D41\u6D6A\u5E78\u5B58\u8005",
        weight: 55,
        cooldownDays: 5,
        maxPerRun: 2,
        prereq: {
          dayMin: 12
        },
        text: "\u5E9F\u589F\u91CC\u6709\u4E2A\u6D41\u6D6A\u8005\u4E3E\u7740\u767D\u65D7\uFF0C\u55D3\u5B50\u54D1\u5F97\u8BF4\u4E0D\u51FA\u6574\u53E5\u8BDD\u3002",
        options: [
          {
            label: "\u6536\u7559",
            outcomes: [
              {
                p: 0.6,
                text: "\u4ED6\u61C2\u53D1\u7535\u673A\u7684\u813E\u6C14\uFF0C\u662F\u4E2A\u4EBA\u624D\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              },
              {
                p: 0.4,
                text: "\u4EBA\u6536\u4E0B\u4E86\uFF0C\u80C3\u53E3\u5374\u4E0D\u5C0F\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -30
                  }
                ]
              }
            ]
          },
          {
            label: "\u7ED9\u7CAE\u9001\u884C",
            outcomes: [
              {
                p: 1,
                text: "\u4ED6\u7559\u4E0B\u534A\u5305\u70DF\u4F5C\u8C22\u793C\uFF0C\u6D88\u5931\u5728\u8857\u89D2\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -15
                  },
                  {
                    op: "ADD_GOLD",
                    n: 80
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_wd_006",
        ver: 1,
        type: "choice",
        title: "\u72FC\u568E\u8FD1\u8425",
        weight: 40,
        cooldownDays: 5,
        maxPerRun: 1,
        prereq: {
          dayMin: 9
        },
        text: "\u5165\u591C\u540E\u72FC\u568E\u7ED5\u7740\u8425\u5730\u8F6C\uFF0C\u706B\u5806\u7684\u706B\u82D7\u538B\u5F97\u5F88\u4F4E\u3002",
        options: [
          {
            label: "\u52A0\u56FA\u706B\u5806\u6B7B\u5B88",
            outcomes: [
              {
                p: 0.7,
                text: "\u72FC\u7FA4\u8BD5\u63A2\u51E0\u8F6E\uFF0C\u6563\u4E86\u3002",
                effects: []
              },
              {
                p: 0.3,
                text: "\u72FC\u6251\u8FDB\u8425\u5730\uFF0C\u53FC\u8D70\u4E86\u8089\u3001\u4F24\u4E86\u5BF9\u53CB\u3002",
                effects: [
                  {
                    op: "WOUND_TENANT",
                    tenantId: -1
                  },
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -30
                  }
                ]
              }
            ]
          },
          {
            label: "\u8FDE\u591C\u64A4\u56DE",
            outcomes: [
              {
                p: 1,
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 8
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_in_001",
        ver: 1,
        type: "choice",
        title: "\u5899\u89D2\u5F02\u54CD",
        weight: 60,
        cooldownDays: 5,
        maxPerRun: 2,
        prereq: {
          dayMin: 4
        },
        text: "\u623F\u95F4\u5899\u89D2\u4F20\u6765\u7AB8\u7AB8\u7AA3\u7AA3\u7684\u58F0\u54CD\uFF0C\u50CF\u662F\u6709\u4EC0\u4E48\u4E1C\u897F\u5728\u5899\u76AE\u540E\u9762\u3002",
        options: [
          {
            label: "\u64AC\u5F00\u5899\u76AE",
            outcomes: [
              {
                p: 0.6,
                text: "\u524D\u4EFB\u623F\u4E3B\u85CF\u7684\u4E00\u888B\u9489\u5B50\u548C\u7EBF\u6750\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "material",
                    n: 30
                  }
                ]
              },
              {
                p: 0.4,
                text: "\u4E00\u7A9D\u8001\u9F20\u70B8\u4E86\u7A9D\uFF0C\u7CAE\u98DF\u906D\u4E86\u6B83\u3002",
                effects: [
                  {
                    op: "ADD_RES",
                    res: "food",
                    n: -18
                  }
                ]
              }
            ]
          },
          {
            label: "\u4E0D\u7BA1\u5B83",
            outcomes: [
              {
                p: 1,
                effects: []
              }
            ]
          }
        ]
      },
      {
        id: "evt_in_002",
        ver: 1,
        type: "choice",
        title: "\u5730\u677F\u4E0B\u7684\u94C1\u76D2",
        weight: 35,
        cooldownDays: 8,
        maxPerRun: 1,
        prereq: {
          dayMin: 6
        },
        text: "\u5730\u677F\u677E\u52A8\uFF0C\u4E0B\u9762\u9489\u7740\u4E00\u53EA\u4E0A\u9501\u7684\u94C1\u76D2\u3002",
        options: [
          {
            label: "\u4E0A\u7F34\u516C\u5E93",
            outcomes: [
              {
                p: 1,
                text: "\u76D2\u91CC\u6574\u6574\u9F50\u9F50\u7801\u7740\u91D1\u6761\uFF0C\u8D26\u672C\u4E0A\u8BB0\u7740'\u7ED9\u5B88\u697C\u4EBA'\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 500
                  }
                ]
              }
            ]
          },
          {
            label: "\u79C1\u85CF",
            outcomes: [
              {
                p: 0.5,
                text: "\u6CA1\u4EBA\u53D1\u73B0\uFF0C\u591C\u91CC\u7761\u5F97\u6709\u70B9\u6D45\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 500
                  },
                  {
                    op: "ADD_PANIC",
                    n: 12
                  }
                ]
              },
              {
                p: 0.5,
                text: "\u88AB\u540C\u5C4B\u7684\u4F4F\u6237\u770B\u89C1\u4E86\uFF0C\u6D41\u8A00\u4F20\u5F00\u4E86\u3002",
                effects: [
                  {
                    op: "ADD_GOLD",
                    n: 500
                  },
                  {
                    op: "ADD_PANIC",
                    n: 20
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_in_003",
        ver: 1,
        type: "choice",
        title: "\u7A97\u5916\u9ED1\u5F71",
        weight: 50,
        cooldownDays: 4,
        maxPerRun: 2,
        prereq: {
          dayMin: 5
        },
        text: "\u534A\u591C\uFF0C\u7A97\u73BB\u7483\u4E0A\u6620\u51FA\u4E00\u4E2A\u4E00\u95EA\u800C\u8FC7\u7684\u9ED1\u5F71\u3002",
        options: [
          {
            label: "\u5F00\u7A97\u67E5\u770B",
            outcomes: [
              {
                p: 0.7,
                text: "\u662F\u4EF6\u6302\u5728\u6811\u4E0A\u7684\u5927\u8863\u3002\u865A\u60CA\u4E00\u573A\u3002",
                effects: []
              },
              {
                p: 0.3,
                text: "\u9ED1\u5F71\u6251\u9762\u800C\u8FC7\uFF0C\u4EC0\u4E48\u90FD\u6CA1\u770B\u6E05\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 15
                  }
                ]
              }
            ]
          },
          {
            label: "\u62C9\u7D27\u7A97\u5E18",
            outcomes: [
              {
                p: 1,
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 5
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_in_004",
        ver: 1,
        type: "choice",
        title: "\u90BB\u5C45\u501F\u5BBF",
        weight: 45,
        cooldownDays: 6,
        maxPerRun: 1,
        prereq: {
          dayMin: 6
        },
        text: "\u9694\u58C1\u680B\u7684\u59D1\u5A18\u62CD\u7740\u95E8\uFF0C\u8BF4\u5979\u4EEC\u90A3\u5C42\u5DF2\u7ECF\u4E09\u5929\u6CA1\u6562\u5F00\u706F\u3002",
        options: [
          {
            label: "\u6536\u7559",
            outcomes: [
              {
                p: 0.7,
                text: "\u59D1\u5A18\u624B\u811A\u9EBB\u5229\uFF0C\u628A\u623F\u95F4\u6536\u62FE\u51FA\u4E86\u751F\u6C14\u3002",
                effects: [
                  {
                    op: "SPAWN_TENANT",
                    quality: "N"
                  }
                ]
              },
              {
                p: 0.3,
                text: "\u5979\u5E26\u6765\u4E86\u9EBB\u70E6\uFF0C\u4E5F\u5E26\u6765\u4E86\u6D88\u606F\u3002",
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 6
                  },
                  {
                    op: "SET_FLAG",
                    key: "in_guest",
                    v: 1
                  }
                ]
              }
            ]
          },
          {
            label: "\u5A49\u62D2",
            outcomes: [
              {
                p: 1,
                effects: [
                  {
                    op: "ADD_PANIC",
                    n: 4
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_bld_b_open",
        ver: 1,
        type: "scripted",
        title: "B \u680B\u5F00\u653E",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 1,
        prereq: {},
        triggerDay: 30,
        text: "\u8F70\u9686\u4E00\u58F0\uFF0CB \u680B\u7684\u5927\u95E8\u88AB\u62C9\u5F00\u4E86\u3002\u4E09\u5341\u4E2A\u65B0\u623F\u95F4\u5728\u706B\u628A\u5149\u91CC\u7B49\u7740\u4F4F\u6237\u3002",
        options: [
          {
            label: "\u786E\u8BA4",
            outcomes: [
              {
                p: 1,
                text: null,
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "evt_bld_b_open",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      },
      {
        id: "evt_bld_c_open",
        ver: 1,
        type: "scripted",
        title: "C \u680B\u5F00\u653E",
        weight: 0,
        cooldownDays: 0,
        maxPerRun: 1,
        prereq: {},
        triggerDay: 30,
        text: "C \u680B\u7684\u7A97\u53E3\u7B2C\u4E00\u6B21\u4EAE\u8D77\u706F\u2014\u2014\u7A7A\u623F\u95F4\u6BD4\u91D1\u5B50\u8FD8\u8BA9\u4EBA\u5B89\u5FC3\u3002",
        options: [
          {
            label: "\u786E\u8BA4",
            outcomes: [
              {
                p: 1,
                text: null,
                effects: [
                  {
                    op: "SET_FLAG",
                    key: "evt_bld_c_open",
                    v: 1
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  };

  // config/monster.json
  var monster_default = {
    version: 1,
    sourceDoc: "docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA74\uFF08\u8FDB\u5316\u6811\uFF1A\u8BBE\u8BA1\u65B9\u6848 4.5\uFF09",
    entries: [
      { id: "m_seeker", name: "\u5FAA\u58F0\u8005", tier: "minion", unlockDay: 1, hpMul: 1, mechanics: [], usableNightMods: ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], active: true },
      { id: "m_breaker", name: "\u7834\u7A97\u8005", tier: "minion", unlockDay: 3, hpMul: 1, mechanics: ["breakDoor"], usableNightMods: ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], active: true },
      { id: "m_climber", name: "\u6500\u697C\u79CD", tier: "minion", unlockDay: 5, hpMul: 1.05, mechanics: ["climbWindow"], usableNightMods: ["NORMAL", "BLOOD_MOON", "MIGRATE"], active: true },
      { id: "m_flyer", name: "\u98DE\u884C\u79CD", tier: "elite", unlockDay: 9, hpMul: 1.1, mechanics: ["fly"], usableNightMods: ["NORMAL", "BLOOD_MOON", "MIGRATE"], active: true },
      { id: "m_focus", name: "\u56F4\u653BAI", tier: "elite", unlockDay: 12, hpMul: 1.15, mechanics: ["focusFire"], usableNightMods: ["NORMAL", "BLOOD_MOON"], active: true },
      { id: "m_elite", name: "\u7CBE\u82F1\u79CD", tier: "elite", unlockDay: 18, hpMul: 1.25, mechanics: [], usableNightMods: ["NORMAL", "BLOOD_MOON", "SILENT", "MIGRATE"], active: true },
      { id: "m_nightking", name: "\u591C\u738B", tier: "boss", unlockDay: 30, hpMul: 2, mechanics: [], usableNightMods: [], active: false }
    ]
  };

  // config/map_def.json
  var map_def_default = {
    version: 1,
    sourceDoc: "docs/\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1.md \xA72/\xA74 + docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA79.1",
    entries: [
      { kind: "lot", id: "lot_gate", name: "\u5927\u95E8", pos: { x: 3, y: 7 }, unlockDay: 1 },
      { kind: "lot", id: "lot_wall", name: "\u56F4\u5899", pos: { x: 2, y: 6 }, unlockDay: 1 },
      { kind: "lot", id: "lot_plaza", name: "\u4E2D\u592E\u5E7F\u573A", pos: { x: 4, y: 5 }, unlockDay: 1 },
      { kind: "lot", id: "lot_bld_a", name: "A\u680B", pos: { x: 2, y: 3 }, building: { floors: 6, roomsPerFloor: 5 }, unlockDay: 1 },
      { kind: "lot", id: "lot_bld_b", name: "B\u680B", pos: { x: 5, y: 3 }, building: { floors: 6, roomsPerFloor: 5 }, unlockDay: 30 },
      { kind: "lot", id: "lot_bld_c", name: "C\u680B", pos: { x: 6, y: 5 }, building: { floors: 6, roomsPerFloor: 5 }, unlockDay: 30 },
      { kind: "lot", id: "lot_canteen", name: "\u98DF\u5802", pos: { x: 3, y: 4 }, unlockDay: 1 },
      { kind: "lot", id: "lot_warehouse", name: "\u4ED3\u5E93", pos: { x: 4, y: 4 }, unlockDay: 1 },
      { kind: "lot", id: "lot_clinic", name: "\u533B\u52A1\u5BA4", pos: { x: 5, y: 4 }, unlockDay: 1 },
      { kind: "lot", id: "lot_workshop", name: "\u5DE5\u574A", pos: { x: 2, y: 5 }, unlockDay: 3 },
      { kind: "lot", id: "lot_broadcast", name: "\u5E7F\u64AD\u7AD9", pos: { x: 5, y: 5 }, unlockDay: 2 },
      { kind: "lot", id: "lot_hall", name: "\u8BAE\u4E8B\u5385", pos: { x: 3, y: 6 }, unlockDay: 5 },
      { kind: "lot", id: "lot_watchtower", name: "\u5C97\u54E8\u5854", pos: { x: 6, y: 6 }, unlockDay: 4 },
      { kind: "zone", id: "zn_forest_edge", name: "\u6797\u7F18", pos: { x: 1, y: 1 }, travelTime: 10, danger: "low", unlockDay: 1 },
      { kind: "zone", id: "zn_deep_forest", name: "\u6DF1\u6797", pos: { x: 0, y: 0 }, travelTime: 25, danger: "mid", unlockDay: 8 },
      { kind: "zone", id: "zn_ruins", name: "\u8857\u9053\u5E9F\u589F", pos: { x: 6, y: 0 }, travelTime: 20, danger: "mid", unlockDay: 12 },
      { kind: "zone", id: "zn_farm", name: "\u6CB3\u8FB9\u519C\u7530", pos: { x: 0, y: 5 }, travelTime: 15, danger: "low", unlockDay: 5 }
    ]
  };

  // config/explore_def.json
  var explore_def_default = {
    version: 1,
    sourceDoc: "docs/\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1.md \xA74 + docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA79.2",
    entries: [
      {
        id: "exp_forest_edge",
        zone: "zn_forest_edge",
        staminaCost: 20,
        timeCost: 1,
        partyMax: 3,
        gatherSlots: 3,
        wildlifePool: ["w_rabbit", "w_deer"],
        eventPool: [],
        unlockDay: 1
      },
      {
        id: "exp_deep_forest",
        zone: "zn_deep_forest",
        staminaCost: 35,
        timeCost: 3,
        partyMax: 3,
        gatherSlots: 3,
        wildlifePool: ["w_deer", "w_boar", "w_wolf"],
        eventPool: [],
        unlockDay: 8
      },
      {
        id: "exp_ruins",
        zone: "zn_ruins",
        staminaCost: 30,
        timeCost: 2,
        partyMax: 3,
        gatherSlots: 3,
        wildlifePool: ["w_wolf"],
        eventPool: [],
        unlockDay: 12
      },
      {
        id: "exp_farm",
        zone: "zn_farm",
        staminaCost: 25,
        timeCost: 2,
        partyMax: 3,
        gatherSlots: 3,
        wildlifePool: ["w_rabbit"],
        eventPool: [],
        unlockDay: 5
      }
    ]
  };

  // config/gather_table.json
  var gather_table_default = {
    version: 1,
    sourceDoc: "docs/\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1.md \xA74 + docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA79.3",
    entries: [
      { id: "g_fe_berry", zone: "zn_forest_edge", resource: "food", yieldMin: 20, yieldMax: 40, respawnDays: 2 },
      { id: "g_fe_veggie", zone: "zn_forest_edge", resource: "food", yieldMin: 15, yieldMax: 30, respawnDays: 2 },
      { id: "g_fe_water", zone: "zn_forest_edge", resource: "water", yieldMin: 20, yieldMax: 40, respawnDays: 1 },
      { id: "g_df_wood", zone: "zn_deep_forest", resource: "material", yieldMin: 30, yieldMax: 60, respawnDays: 3 },
      { id: "g_df_herb", zone: "zn_deep_forest", resource: "food", yieldMin: 20, yieldMax: 45, respawnDays: 3 },
      { id: "g_df_honey", zone: "zn_deep_forest", resource: "food", yieldMin: 30, yieldMax: 55, respawnDays: 4 },
      { id: "g_ru_material", zone: "zn_ruins", resource: "material", yieldMin: 40, yieldMax: 80, respawnDays: 3 },
      { id: "g_ru_canned", zone: "zn_ruins", resource: "food", yieldMin: 35, yieldMax: 70, respawnDays: 4 },
      { id: "g_ru_cloth", zone: "zn_ruins", resource: "material", yieldMin: 20, yieldMax: 45, respawnDays: 2 },
      { id: "g_farm_water", zone: "zn_farm", resource: "water", yieldMin: 30, yieldMax: 55, respawnDays: 1 },
      { id: "g_farm_crop", zone: "zn_farm", resource: "food", yieldMin: 30, yieldMax: 60, respawnDays: 2 },
      { id: "g_farm_fish", zone: "zn_farm", resource: "food", yieldMin: 25, yieldMax: 50, respawnDays: 2 }
    ]
  };

  // config/wildlife.json
  var wildlife_default = {
    version: 1,
    sourceDoc: "docs/\u4E16\u754C\u89C2\u4E0E\u7A7A\u95F4\u7ED3\u6784\u8BBE\u8BA1.md \xA74 + docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA79.4",
    entries: [
      {
        id: "w_rabbit",
        kind: "prey",
        name: "\u91CE\u5154",
        hp: 20,
        threat: 0,
        drops: [{ resource: "food", amount: 25 }],
        activeHours: "day",
        zones: ["zn_forest_edge", "zn_farm"],
        unlockDay: 1
      },
      {
        id: "w_deer",
        kind: "prey",
        name: "\u9E7F",
        hp: 45,
        threat: 0,
        drops: [{ resource: "food", amount: 60 }],
        activeHours: "day",
        zones: ["zn_forest_edge", "zn_deep_forest"],
        unlockDay: 3
      },
      {
        id: "w_boar",
        kind: "danger",
        name: "\u91CE\u732A",
        hp: 80,
        threat: 30,
        drops: [{ resource: "food", amount: 80 }],
        activeHours: "always",
        zones: ["zn_deep_forest"],
        unlockDay: 8
      },
      {
        id: "w_wolf",
        kind: "danger",
        name: "\u72FC",
        hp: 65,
        threat: 25,
        drops: [{ resource: "food", amount: 45 }],
        activeHours: "night",
        zones: ["zn_deep_forest", "zn_ruins"],
        unlockDay: 8
      }
    ]
  };

  // config/theme.json
  var theme_default = {
    version: 1,
    sourceDoc: "docs/UI-UX\u8BBE\u8BA1\u89C4\u8303.md \xA7\u4E8C",
    color: {
      bg_night: "#0B1020",
      bg_dawn: "#141A2E",
      alert_blood: "#C0392B",
      gold_primary: "#FFD700",
      gold_deep: "#B8860B",
      panel: "#1A2238",
      panel_stroke: "#2A3555",
      text_primary: "#E8E8F0",
      text_secondary: "#8892B0",
      success: "#7FFF9F",
      danger: "#FF6B6B",
      panic: "#9B59B6"
    },
    typography: {
      family_cn: "SourceHanSansCN-Bold",
      family_num: "BebasNeue",
      h1: 32,
      h2: 26,
      body: 24,
      caption: 18
    },
    space: { xs: 8, s: 16, m: 24, l: 32 },
    radius: { panel: 16, btn: 12, chip: 8 },
    motion: {
      fast: { dur: 150, ease: "easeOutQuad" },
      normal: { dur: 300, ease: "easeOutCubic" },
      rain: { dur: 500, ease: "easeOutBack" },
      threat: { dur: 300, ease: "easeInQuad", repeat: 2 },
      dissolve: { dur: 800, ease: "linear" },
      counter: { dur: 800, ease: "easeOutCubic" },
      stagger: { dur: 60, ease: "linear" }
    }
  };

  // apps/client-cocos/whitebox/theme.ts
  var T = theme_default;
  function withAlpha(hex, alpha) {
    const h = hex.replace("#", "");
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${alpha})`;
  }
  function col(key) {
    return T.color[key];
  }
  function shade(hex, k) {
    const h = hex.replace("#", "");
    const f = (s) => Math.max(0, Math.min(255, Math.round(parseInt(s, 16) * k)));
    return `#${[0, 2, 4].map((i) => f(h.slice(i, i + 2)).toString(16).padStart(2, "0")).join("")}`;
  }
  function mix(a, b, k) {
    const p = (h) => [0, 2, 4].map((i) => parseInt(h.replace("#", "").slice(i, i + 2), 16));
    const [ra, ga, ba] = p(a), [rb, gb, bb] = p(b);
    const f = (x, y) => Math.max(0, Math.min(255, Math.round(x + (y - x) * k)));
    return `#${[f(ra, rb), f(ga, gb), f(ba, bb)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
  }
  var EASE = {
    linear: (t) => t,
    easeOutQuad: (t) => 1 - (1 - t) ** 2,
    easeOutCubic: (t) => 1 - (1 - t) ** 3,
    easeInQuad: (t) => t * t,
    easeOutBack: (t) => {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
    }
  };
  function easeByName(name) {
    return EASE[name] ?? EASE.linear;
  }
  function motion(name) {
    const m = T.motion[name] ?? T.motion.normal;
    return { dur: m.dur, fn: easeByName(m.ease), repeat: m.repeat };
  }
  function font(px, opts = {}) {
    const family = opts.family && typeof opts.family === "string" ? opts.family : T.typography.family_cn;
    const weight = opts.weight ? opts.weight + " " : "";
    return `${weight}${px}px "${family}", sans-serif`;
  }

  // apps/client-cocos/whitebox/state.ts
  var EVENT_QUEUE_MAX = 2;
  function createUiState() {
    return { phase: "DAY", page: "map", sel: {}, modals: [], eventQueue: [] };
  }
  function topModal(s) {
    return s.eventQueue[s.eventQueue.length - 1] ?? s.modals[s.modals.length - 1];
  }
  function canInterrupt(s) {
    return s.phase !== "NIGHT";
  }
  function pushEvent(s, card) {
    if (!canInterrupt(s) || s.eventQueue.length >= EVENT_QUEUE_MAX) return s;
    return { ...s, eventQueue: [...s.eventQueue, { kind: "event", id: card.id, card }] };
  }
  function openModal(s, m) {
    if (s.phase === "NIGHT") return s;
    return { ...s, modals: [...s.modals, m] };
  }
  function closeModal(s) {
    if (s.eventQueue.length > 0) return { ...s, eventQueue: s.eventQueue.slice(0, -1) };
    if (s.modals.length > 0) return { ...s, modals: s.modals.slice(0, -1) };
    return s;
  }
  function setPage(s, page) {
    if (s.phase !== "DAY") return s;
    return { ...s, page };
  }
  function openBuilding(s, lotId) {
    if (s.phase !== "DAY") return s;
    return { ...s, page: "main", sel: { lot: lotId } };
  }
  function openInterior(s, floor, room) {
    if (s.phase !== "DAY") return s;
    return { ...s, page: "interior", sel: { ...s.sel, floor, room } };
  }

  // apps/client-cocos/whitebox/layout.ts
  var DESIGN_W = 750;
  var DESIGN_H = 1624;
  var HIT_MIN = 88;
  var M = T.space.l;
  var GAP = T.space.s;
  var HUD_H = T.typography.h1 + T.space.s;
  var RES_H = 64;
  var DOCK_H = HIT_MIN;
  var DOCK_Y = DESIGN_H - T.space.m - DOCK_H;
  function hudRect() {
    return { x: 0, y: 0, w: DESIGN_W, h: HUD_H };
  }
  function resourceRect() {
    return { x: 0, y: HUD_H + T.space.xs, w: DESIGN_W, h: RES_H };
  }
  function settingsRect() {
    return { x: DESIGN_W - M - HIT_MIN, y: (HUD_H - HIT_MIN) / 2 + 2, w: HIT_MIN, h: HIT_MIN };
  }
  var FLOORS = 6;
  var ROOMS_PER_FLOOR = 5;
  var FLOOR_LABEL_W = 48;
  function buildingRect() {
    const y = resourceRect().y + RES_H + GAP;
    const h = DESIGN_H * 0.44;
    return { x: M, y, w: DESIGN_W - M * 2, h };
  }
  function roomRect(floor, room) {
    const b = buildingRect();
    const gw = (b.w - FLOOR_LABEL_W - T.space.xs * (ROOMS_PER_FLOOR - 1)) / ROOMS_PER_FLOOR;
    const gh = (b.h - T.space.xs * (FLOORS - 1)) / FLOORS;
    return {
      x: b.x + FLOOR_LABEL_W + room * (gw + T.space.xs),
      y: b.y + floor * (gh + T.space.xs),
      w: gw,
      h: gh
    };
  }
  function floorLabelRect(floor) {
    const b = buildingRect();
    const gh = (b.h - T.space.xs * (FLOORS - 1)) / FLOORS;
    return { x: b.x, y: b.y + floor * (gh + T.space.xs), w: FLOOR_LABEL_W, h: gh };
  }
  function eventEntryRect() {
    const y = buildingRect().y + buildingRect().h + GAP;
    return { x: M, y, w: DESIGN_W - M * 2, h: 112 };
  }
  function reportRect() {
    const y = eventEntryRect().y + eventEntryRect().h + GAP;
    return { x: M, y, w: DESIGN_W - M * 2, h: 120 };
  }
  var DOCK_KEYS = [
    { key: "deploy", label: "\u5E03\u9632" },
    { key: "recruit", label: "\u62DB\u52DF" },
    { key: "upgrade", label: "\u5347\u7EA7" },
    { key: "night", label: "\u25B6\u591C" }
  ];
  function dockRects() {
    const n = DOCK_KEYS.length;
    const w = (DESIGN_W - M * 2 - T.space.s * (n - 1)) / n;
    return DOCK_KEYS.map((_, i) => ({ x: M + i * (w + T.space.s), y: DOCK_Y, w, h: DOCK_H }));
  }
  var MODAL_H = 420;
  function modalRect() {
    return { x: M, y: DESIGN_H - T.space.m - MODAL_H, w: DESIGN_W - M * 2, h: MODAL_H };
  }
  function modalCloseRect() {
    const r = modalRect();
    return { x: r.x + r.w - HIT_MIN - T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN, h: HIT_MIN };
  }
  function modalConfirmRect() {
    const r = modalRect();
    return { x: r.x + T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN + T.space.l, h: HIT_MIN };
  }
  function modalOptionRect() {
    const r = modalRect();
    return { x: r.x + T.space.m, y: r.y + 170, w: r.w - T.space.m * 2, h: HIT_MIN + T.space.xs };
  }
  var NIGHT_ROUTE_H = 72;
  function nightRouteRect(i) {
    return { x: M, y: 220 + i * (NIGHT_ROUTE_H + T.space.s), w: DESIGN_W - M * 2, h: NIGHT_ROUTE_H };
  }
  function nightSkillRects() {
    return [0, 1].map((i) => ({ x: M + i * (HIT_MIN + T.space.s), y: 700, w: HIT_MIN, h: HIT_MIN }));
  }
  function nightLogRect() {
    return { x: M, y: 840, w: DESIGN_W - M * 2, h: 560 };
  }
  function nightBackRect() {
    return { x: (DESIGN_W - HIT_MIN * 2) / 2, y: DOCK_Y, w: HIT_MIN * 2, h: HIT_MIN };
  }
  function duskBannerRect() {
    return { x: M, y: HUD_H + T.space.s, w: DESIGN_W - M * 2, h: 104 };
  }
  function duskConfirmRect() {
    const b = duskBannerRect();
    return { x: b.x + b.w - HIT_MIN - T.space.s, y: b.y + (b.h - HIT_MIN) / 2, w: HIT_MIN, h: HIT_MIN };
  }
  var SETTLE_H = 560;
  function settlePanelRect() {
    return { x: M, y: DESIGN_H - T.space.m - SETTLE_H, w: DESIGN_W - M * 2, h: SETTLE_H };
  }
  function settleCounterRect() {
    const r = settlePanelRect();
    return { x: r.x, y: r.y + 96, w: r.w, h: 96 };
  }
  var SETTLE_POP_MAX = 6;
  function settlePopRect(i) {
    const r = settlePanelRect();
    return { x: r.x + T.space.m, y: r.y + 216 + i * 48, w: r.w - T.space.m * 2, h: 44 };
  }
  function settleContinueRect() {
    const r = settlePanelRect();
    return { x: r.x + r.w - HIT_MIN - T.space.s, y: r.y + r.h - HIT_MIN - T.space.s, w: HIT_MIN + T.space.l, h: HIT_MIN };
  }
  function pageBackRect() {
    return { x: M, y: HUD_H + T.space.s, w: HIT_MIN, h: HIT_MIN };
  }
  function pageTitleRect() {
    return { x: M + HIT_MIN + T.space.s, y: HUD_H + T.space.s, w: DESIGN_W - M * 2 - HIT_MIN - T.space.s, h: HIT_MIN };
  }
  var CODEX_COLS = 3;
  var CODEX_ROWS = 3;
  function codexCellRect(col2, row) {
    const gx = M, gy = HUD_H + T.space.s * 2 + HIT_MIN;
    const cw = (DESIGN_W - M * 2 - T.space.s * (CODEX_COLS - 1)) / CODEX_COLS;
    const ch = 240;
    return { x: gx + col2 * (cw + T.space.s), y: gy + row * (ch + T.space.s), w: cw, h: ch };
  }
  var SHOP_CARDS = 3;
  function shopCardRect(i) {
    const w = 420, h = 560;
    return { x: M + i * (w + T.space.s), y: HUD_H + T.space.s * 2 + HIT_MIN, w, h };
  }
  var SETTINGS_ROWS = [
    { key: "codex", label: "\u56FE\u9274" },
    { key: "shop", label: "\u5546\u5E97" },
    { key: "sfx", label: "\u97F3\u6548" },
    { key: "bgm", label: "\u97F3\u4E50" },
    { key: "notice", label: "\u63A8\u9001\u901A\u77E5" }
  ];
  function settingsRowRect(i) {
    return { x: M, y: HUD_H + T.space.s * 2 + HIT_MIN + i * (88 + T.space.s), w: DESIGN_W - M * 2, h: 88 };
  }
  function hitTest(x, y, opts = {}) {
    const modalOpen = opts.modalOpen ?? false;
    const page = opts.page ?? "main";
    const inRect = (r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    if (modalOpen) {
      if (inRect(modalCloseRect())) return { kind: "modalClose" };
      if (inRect(modalConfirmRect())) return { kind: "modalConfirm" };
      if (inRect(modalOptionRect())) return { kind: "modalOption" };
      return { kind: "modal" };
    }
    if (page === "map") {
      for (const [id, lot] of Object.entries(LOTS)) {
        const base = isoToScreen(lot.gx, lot.gy);
        const cx = base.x, cy = base.y + ISO_TILE_H / 2;
        const bw = lot.kind === "bld" ? 100 : lot.kind === "wall" ? 140 : 80;
        const bh = lot.kind === "bld" ? 230 : 90;
        if (x >= cx - bw / 2 && x <= cx + bw / 2 && y >= cy - bh && y <= cy + 30) return { kind: "lot", id };
      }
      for (const [i, r] of dockRects().entries()) if (inRect(r)) return { kind: "dock", key: DOCK_KEYS[i].key };
      if (inRect(settingsRect())) return { kind: "settings" };
      return { kind: "none" };
    }
    if (page === "map") {
      for (let i = 29; i >= 0; i--) {
        const r = houseHitRect(i);
        if (inRect(r)) return { kind: "house", index: i };
      }
    }
    if (page === "wild") {
      if (inRect(wildBackRect())) return { kind: "wildBack" };
      for (const z of WILD_ZONES) {
        const r = wildZoneRect(WILD_ZONES.indexOf(z));
        if (inRect(r)) return { kind: "wildZone", zone: z.zone };
      }
      if (inRect(wildDispatchRect())) return { kind: "wildDispatch" };
      if (inRect(wildMinusRect())) return { kind: "partyMinus" };
      if (inRect(wildPlusRect())) return { kind: "partyPlus" };
      return { kind: "none" };
    }
    if (page === "interior") {
      if (inRect(interiorBackRect())) return { kind: "interiorBack" };
      for (const [i, r] of [interiorSlotRect(0), interiorSlotRect(1)].entries()) {
        if (inRect(r)) return { kind: "fortSlot", index: i };
      }
      return { kind: "none" };
    }
    if (page === "main" && inRect(mapBackRect())) return { kind: "mapBack" };
    if (page !== "main") {
      if (inRect(pageBackRect())) return { kind: "pageBack" };
      if (page === "settings") {
        for (const [i, row] of SETTINGS_ROWS.entries()) {
          if (inRect(settingsRowRect(i)) && (row.key === "codex" || row.key === "shop")) {
            return { kind: "nav", page: row.key };
          }
        }
      }
      return { kind: "none" };
    }
    if (inRect(duskConfirmRect())) return { kind: "duskConfirm" };
    for (const [i, r] of nightSkillRects().entries()) if (inRect(r)) return { kind: "skill", index: i };
    if (inRect(nightBackRect())) return { kind: "nightBack" };
    if (inRect(settleContinueRect())) return { kind: "settleContinue" };
    for (const [i, r] of dockRects().entries()) {
      if (inRect(r)) return { kind: "dock", key: DOCK_KEYS[i].key };
    }
    if (inRect(settingsRect())) return { kind: "settings" };
    if (inRect(eventEntryRect())) return { kind: "eventEntry" };
    for (let f = 0; f < FLOORS; f++) {
      for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
        if (inRect(roomRect(f, r))) return { kind: "room", floor: FLOORS - f, room: r };
      }
    }
    return { kind: "none" };
  }
  var ISO_TILE_W = 110;
  var ISO_TILE_H = 55;
  var ISO_ORIGIN = { x: DESIGN_W / 2, y: 320 };
  var ISO_FLOOR_H = 26;
  function isoToScreen(gx, gy, z = 0) {
    return { x: ISO_ORIGIN.x + (gx - gy) * (ISO_TILE_W / 2), y: ISO_ORIGIN.y + (gx + gy) * (ISO_TILE_H / 2) - z * ISO_FLOOR_H };
  }
  var LOTS = {
    lot_gate: { gx: 3, gy: 7, name: "\u5927\u95E8", kind: "gate", unlockDay: 1 },
    lot_wall: { gx: 2, gy: 6, name: "\u56F4\u5899", kind: "wall", unlockDay: 1 },
    lot_plaza: { gx: 4, gy: 5, name: "\u5E7F\u573A", kind: "plaza", unlockDay: 1 },
    lot_bld_a: { gx: 2, gy: 3, name: "A\u680B", kind: "bld", unlockDay: 1 },
    lot_bld_b: { gx: 5, gy: 3, name: "B\u680B", kind: "bld", unlockDay: 30 },
    lot_bld_c: { gx: 6, gy: 5, name: "C\u680B", kind: "bld", unlockDay: 30 },
    lot_canteen: { gx: 3, gy: 4, name: "\u98DF\u5802", kind: "facility", unlockDay: 1 },
    lot_warehouse: { gx: 4, gy: 4, name: "\u4ED3\u5E93", kind: "facility", unlockDay: 1 },
    lot_clinic: { gx: 5, gy: 4, name: "\u533B\u52A1\u5BA4", kind: "facility", unlockDay: 1 },
    lot_workshop: { gx: 2, gy: 5, name: "\u5DE5\u574A", kind: "facility", unlockDay: 3 },
    lot_broadcast: { gx: 5, gy: 5, name: "\u5E7F\u64AD\u7AD9", kind: "facility", unlockDay: 2 },
    lot_hall: { gx: 3, gy: 6, name: "\u8BAE\u4E8B\u5385", kind: "facility", unlockDay: 5 },
    lot_watchtower: { gx: 6, gy: 6, name: "\u5C97\u54E8\u5854", kind: "facility", unlockDay: 4 }
  };
  var EXPLORE_ENTRY = { x: DESIGN_W / 2 - 140, y: 240, w: 280, h: 64 };
  function mapBackRect() {
    return { x: M, y: HUD_H + T.space.xs, w: HIT_MIN, h: HIT_MIN };
  }
  function interiorBackRect() {
    return { x: M, y: HUD_H + T.space.xs, w: HIT_MIN + 60, h: HIT_MIN };
  }
  function interiorSlotRect(i) {
    return { x: DESIGN_W / 2 - 220 + i * 240, y: DESIGN_H / 2 - 210, w: 200, h: 120 };
  }
  var WILD_ZONES = [
    { zone: "zn_forest_edge", name: "\u6797\u7F18", danger: "low", travelTime: 10, unlockDay: 1 },
    { zone: "zn_farm", name: "\u6CB3\u8FB9\u519C\u7530", danger: "low", travelTime: 15, unlockDay: 5 },
    { zone: "zn_deep_forest", name: "\u6DF1\u6797", danger: "mid", travelTime: 25, unlockDay: 8 },
    { zone: "zn_ruins", name: "\u8857\u9053\u5E9F\u589F", danger: "mid", travelTime: 20, unlockDay: 12 }
  ];
  function wildZoneRect(i) {
    const col2 = i % 2, row = Math.floor(i / 2);
    return { x: M + col2 * ((DESIGN_W - M * 2 - T.space.m) / 2 + T.space.m / 1), y: HUD_H + T.space.l * 2 + row * 220, w: (DESIGN_W - M * 2 - T.space.m) / 2, h: 200 };
  }
  function wildBackRect() {
    return { x: M, y: HUD_H + T.space.xs, w: HIT_MIN, h: HIT_MIN };
  }
  function wildDetailRect() {
    return { x: M, y: HUD_H + T.space.l * 2 + 440, w: DESIGN_W - M * 2, h: 300 };
  }
  function wildDispatchRect() {
    return { x: DESIGN_W - M - HIT_MIN - T.space.l, y: HUD_H + T.space.l * 2 + 440 + 300 - HIT_MIN - T.space.s, w: HIT_MIN + T.space.l, h: HIT_MIN };
  }
  function wildMinusRect() {
    return { x: M + T.space.s, y: wildDetailRect().y + 130, w: HIT_MIN, h: HIT_MIN };
  }
  function wildPlusRect() {
    return { x: M + T.space.s + HIT_MIN + T.space.s, y: wildDetailRect().y + 130, w: HIT_MIN, h: HIT_MIN };
  }
  var WILD_ZONE_NAME = (zone) => WILD_ZONES.find((z) => z.zone === zone)?.name ?? zone;
  function houseHitRect(i) {
    const col2 = i % 6, row = Math.floor(i / 6);
    const x = 96 + col2 * 100 + row % 2 * 50;
    const y = 726 + row * 84;
    return { x, y: y - 46, w: 62, h: 50 };
  }

  // apps/client-cocos/whitebox/anim.ts
  function routeView(rt) {
    const ratio = Math.min(1, rt.r / 1);
    const state = rt.r < 0.95 ? 0 : rt.r < 1 ? 1 : 2;
    return { route: rt, ratio, state };
  }
  var OUTCOME_LABEL = {
    HOLD: "\u5B88\u4F4F",
    HOLD_WOUNDED: "\u5B88\u4F4F\xB7\u8D1F\u4F24",
    LOSE_1: "\u7834\u9632\xD71",
    LOSE_2: "\u7834\u9632\xD72",
    LOSE_3P: "\u7834\u9632\xD73+"
  };
  var WAVE_MS = motion("normal").dur * 3;
  function nightWaves(routes, start, now) {
    const elapsed = Math.max(0, now - start);
    const n = Math.min(routes.length, Math.floor(elapsed / WAVE_MS) + 1);
    const revealed = [];
    for (let i = 0; i < n; i++) revealed.push(routeView(routes[i]));
    const into = elapsed - (n - 1) * WAVE_MS;
    const currentFill = n === 0 ? 0 : Math.min(1, into / motion("normal").dur);
    return { revealed, currentFill, done: elapsed >= routes.length * WAVE_MS + motion("dissolve").dur, waveNo: n };
  }
  function counterValue(target2, start, now) {
    const m = motion("counter");
    const p = Math.min(1, Math.max(0, (now - start) / m.dur));
    return Math.round(target2 * m.fn(p));
  }
  function popProgress(i, start, now) {
    const st = motion("stagger");
    const m = motion("fast");
    const t0 = start + i * st.dur;
    return Math.min(1, Math.max(0, (now - t0) / m.dur));
  }
  function settleDoneAt(start, households) {
    return start + motion("rain").dur + motion("counter").dur + households * motion("stagger").dur;
  }
  function threatBurst(start, now) {
    const t = motion("threat");
    const total = t.dur * (t.repeat ?? 1);
    const elapsed = now - start;
    if (elapsed < 0 || elapsed > total + t.dur) return { flash: 0, shake: 0 };
    const u = elapsed % t.dur / t.dur;
    const wave = t.fn(u);
    const decay = 1 - elapsed / (total + t.dur);
    return { flash: wave * decay, shake: 8 * (1 - u) * decay };
  }
  function dissolveAlpha(start, now) {
    if (start === null) return 1;
    const m = motion("dissolve");
    return Math.min(1, Math.max(0, (now - start) / m.dur));
  }
  function cardFlip(start, now) {
    if (start === null) return 0;
    const m = motion("normal");
    return Math.min(1, Math.max(0, (now - start) / m.dur));
  }

  // apps/client-cocos/whitebox/tutorial.ts
  var TUT_STEPS = [
    { day: 1, id: "evt_tut_fortify", hint: "\u70B9\u51FB\u300C\u5E03\u9632\u300D\uFF1A\u7528\u6728\u677F\u52A0\u56FA\u4F60\u7684\u95E8", highlight: "dock:deploy" },
    { day: 1, id: "evt_tut_firstnight", hint: "\u70B9\u51FB\u300C\u25B6\u591C\u300D\u2192\u300C\u5165\u591C\u300D\u8FCE\u63A5\u7B2C\u4E00\u591C", highlight: "dock:night" },
    { day: 1, id: "evt_tut_rescue", hint: "\u70B9\u51FB\u300C\u62DB\u52DF\u300D\uFF1A\u591A\u4E00\u4E2A\u90BB\u5C45\u591A\u4E00\u4EFD\u6536\u5165", highlight: "dock:recruit" },
    { day: 2, id: "evt_tut_referral", hint: "\u7EE7\u7EED\u300C\u62DB\u52DF\u300D\uFF1A\u90BB\u5C45\u5F15\u8350\u6B63\u5728\u6EDA\u96EA\u7403", highlight: "dock:recruit" },
    { day: 2, id: "evt_tut_broadcast", hint: "\u300C\u25B6\u591C\u300D\u524D\u786E\u8BA4\u300C\u5E03\u9632\u300D\u5230\u4F4D", highlight: "dock:deploy" },
    { day: 3, id: "evt_tut_bills", hint: "\u5929\u4EAE\u770B\u300C\u6536\u79DF\u7ED3\u7B97\u300D\u2014\u2014\u8FD9\u5C31\u662F\u94B1", highlight: "phase:dawn" },
    { day: 5, id: "evt_tut_panic", hint: "\u6050\u614C\u4F1A\u8D76\u8D70\u4F4F\u6237\uFF0C\u76EF\u4F4F\u8D44\u6E90\u680F\u7684 \u{1F631}", highlight: "res:panic" },
    { day: 6, id: "evt_tut_omen", hint: "\u660E\u5929\u8840\u6708\uFF01\u767D\u5929\u6293\u7D27\u300C\u5E03\u9632\u300D", highlight: "dock:deploy" },
    { day: 30, id: "evt_bld_b_open", hint: "\u70B9\u51FB B \u680B\uFF0C\u770B\u770B\u65B0\u623F\u95F4", highlight: "map:lot_bld_b" },
    { day: 30, id: "evt_bld_c_open", hint: "\u70B9\u51FB C \u680B\uFF0C\u770B\u770B\u65B0\u623F\u95F4", highlight: "map:lot_bld_c" }
  ];
  function stepsForDay(day) {
    return TUT_STEPS.filter((s) => s.day === day);
  }
  function tutorialBoard(day, firedIds) {
    const steps = stepsForDay(day);
    const rows = steps.map((s) => ({ step: s, done: firedIds.has(s.id) }));
    const current = rows.find((r) => !r.done)?.step ?? null;
    return { rows, allDone: steps.length > 0 && rows.every((r) => r.done), current };
  }

  // apps/client-cocos/whitebox/battle.ts
  function monsterVisual(monsterId) {
    const id = monsterId ?? "";
    if (id.includes("nightking") || id.includes("elite") || id.includes("focus")) return "elite";
    if (id.includes("flyer")) return "flyer";
    if (id.includes("climber")) return "climber";
    if (id.includes("breaker")) return "breaker";
    return "crawler";
  }
  function monsterProgress(wave, start, now) {
    const into = now - start - (wave - 1) * WAVE_MS;
    if (into < 0) return 0;
    return Math.min(1, into / (WAVE_MS * 0.7));
  }
  function guardVisual(laneIdx) {
    const cycle = ["club", "bow", "pot"];
    return cycle[(laneIdx % 3 + 3) % 3];
  }

  // config/weather.json
  var weather_default = {
    version: 1,
    sourceDoc: "docs/\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1.md \xA73 + docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA710",
    entries: [
      {
        id: "sunny",
        name: "\u6674",
        lightMul: 1,
        tintKey: "text_primary",
        temp: "mild",
        humidity: "low",
        particles: "none",
        fog: false,
        gatherMul: 1,
        encounterMul: 1,
        panicDecayMul: 1,
        foodConsumeMul: 1,
        weightBase: 40,
        weightAfter: 25,
        exploreDisabled: false,
        unlockDay: 1
      },
      {
        id: "overcast",
        name: "\u9634",
        lightMul: 0.85,
        tintKey: "text_secondary",
        temp: "mild",
        humidity: "mid",
        particles: "none",
        fog: false,
        gatherMul: 0.9,
        encounterMul: 1,
        panicDecayMul: 1,
        foodConsumeMul: 1,
        weightBase: 20,
        weightAfter: 20,
        exploreDisabled: false,
        unlockDay: 1
      },
      {
        id: "rain",
        name: "\u96E8",
        lightMul: 0.75,
        tintKey: "panel_stroke",
        temp: "cold",
        humidity: "high",
        particles: "rain",
        fog: false,
        gatherMul: 0.75,
        encounterMul: 1.2,
        panicDecayMul: 0.9,
        foodConsumeMul: 1,
        weightBase: 15,
        weightAfter: 20,
        exploreDisabled: false,
        unlockDay: 3
      },
      {
        id: "foggy",
        name: "\u96FE",
        lightMul: 0.8,
        tintKey: "text_secondary",
        temp: "cold",
        humidity: "satur",
        particles: "fog",
        fog: true,
        gatherMul: 0.9,
        encounterMul: 1.5,
        panicDecayMul: 0.9,
        foodConsumeMul: 1,
        weightBase: 10,
        weightAfter: 15,
        exploreDisabled: false,
        unlockDay: 6
      },
      {
        id: "snowy",
        name: "\u96EA",
        lightMul: 0.95,
        tintKey: "text_primary",
        temp: "freeze",
        humidity: "low",
        particles: "snow",
        fog: false,
        gatherMul: 0.6,
        encounterMul: 1,
        panicDecayMul: 0.8,
        foodConsumeMul: 1.1,
        weightBase: 5,
        weightAfter: 10,
        exploreDisabled: false,
        unlockDay: 10
      },
      {
        id: "blood_dust",
        name: "\u8840\u6708\u5C18\u66B4",
        lightMul: 0.6,
        tintKey: "alert_blood",
        temp: "hot",
        humidity: "low",
        particles: "dust",
        fog: true,
        gatherMul: 0.5,
        encounterMul: 2,
        panicDecayMul: 0.7,
        foodConsumeMul: 1.1,
        weightBase: 0,
        weightAfter: 10,
        exploreDisabled: true,
        unlockDay: 7
      }
    ]
  };

  // config/building_def.json with { type: 'json' }
  var building_def_default2 = {
    version: 2,
    sourceDoc: "docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA77\uFF08\u516C\u5171\u5EFA\u7B51\uFF1A\u8BBE\u8BA1\u65B9\u6848 4.1\uFF09",
    entries: [
      {
        type: "room",
        level: 1,
        cost: {
          gold: 300
        },
        slots: {
          tenant: 1,
          fort: 2
        },
        unlockDay: 0
      },
      {
        type: "canteen",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 10
      },
      {
        type: "canteen",
        level: 2,
        cost: {
          gold: 500
        },
        capacity: 14
      },
      {
        type: "canteen",
        level: 3,
        cost: {
          gold: 1e3
        },
        capacity: 18
      },
      {
        type: "canteen",
        level: 4,
        cost: {
          gold: 2500
        },
        capacity: 24
      },
      {
        type: "canteen",
        level: 5,
        cost: {
          gold: 5e3
        },
        capacity: 30
      },
      {
        type: "warehouse",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 5e3
      },
      {
        type: "warehouse",
        level: 2,
        cost: {
          gold: 800
        },
        capacity: 12e3
      },
      {
        type: "warehouse",
        level: 3,
        cost: {
          gold: 2500
        },
        capacity: 3e4
      },
      {
        type: "broadcast",
        level: 1,
        cost: {
          gold: 600
        },
        unlockDay: 2
      },
      {
        type: "broadcast",
        level: 2,
        cost: {
          gold: 1800
        },
        unlockDay: 8
      },
      {
        type: "watchtower",
        level: 1,
        cost: {
          gold: 0
        },
        capacity: 1
      },
      {
        type: "watchtower",
        level: 2,
        cost: {
          gold: 400
        },
        capacity: 2
      },
      {
        type: "watchtower",
        level: 3,
        cost: {
          gold: 1200
        },
        capacity: 3
      },
      {
        type: "clinic",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "hall",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "workshop",
        level: 1,
        cost: {
          gold: 800
        }
      },
      {
        type: "house",
        level: 0,
        cost: {},
        durability: 0.8,
        unlockDay: 1,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv0\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 1,
        cost: {
          material: 50
        },
        durability: 0.9,
        unlockDay: 1,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv1\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 2,
        cost: {
          material: 150
        },
        durability: 1,
        unlockDay: 2,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv2\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 3,
        cost: {
          material: 400,
          gold: 200
        },
        durability: 1.15,
        unlockDay: 8,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv3\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 4,
        cost: {
          material: 800,
          gold: 500
        },
        durability: 1.3,
        unlockDay: 15,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv4\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      },
      {
        type: "house",
        level: 5,
        cost: {
          material: 1500,
          gold: 1200
        },
        durability: 1.5,
        unlockDay: 22,
        desc: "\u623F\u5C4B\u8FDB\u5316 Lv5\uFF08\u6218\u6597\u6F14\u51FA\u4E0E\u5929\u6C14\u7CFB\u7EDF\u8BBE\u8BA1 \xA71.2\uFF09"
      }
    ]
  };

  // apps/client-cocos/whitebox/renderer.ts
  var WAVE_LETTERS = ["A", "B", "C", "D", "E", "F"];
  var prand = (seed) => (seed * 9301 + 49297) % 233280 / 233280;
  function fmt(n) {
    return n.toLocaleString("en-US");
  }
  var WhiteboxRenderer = class {
    constructor(canvas2, cb) {
      this.cb = cb;
      this.ctx = canvas2.getContext("2d");
    }
    cb;
    ctx;
    frames = 0;
    fpsSamples = [];
    budgetSamples = [];
    warmupLeft = 2;
    lastSample = 0;
    modalOpenAt = null;
    /** rAF 主循环：帧率采样（预热 2 窗 + 节流窗 <10fps 不计入预算）+ 重绘 */
    start(getFrame, getUi, getPb) {
      const tick = (now) => {
        this.frames++;
        if (now - this.lastSample >= 1e3) {
          const fps = Math.round(this.frames * 1e3 / (now - this.lastSample));
          this.fpsSamples.push(fps);
          if (this.warmupLeft > 0) this.warmupLeft--;
          else if (fps >= 10) this.budgetSamples.push(fps);
          const src = this.budgetSamples.length ? this.budgetSamples : this.fpsSamples;
          this.cb.onFps(fps, Math.min(...src), Math.round(src.reduce((a, b) => a + b, 0) / src.length));
          this.frames = 0;
          this.lastSample = now;
        }
        const frame = getFrame();
        if (frame) this.draw(getUi(), frame, now, getPb());
        requestAnimationFrame(tick);
      };
      this.lastSample = performance.now();
      requestAnimationFrame(tick);
    }
    getSamples() {
      return this.budgetSamples;
    }
    // ════════ 基础绘制库 ════════
    /** 立体面板：投影 + 底色 + 描边 + 顶部高光棱线（全部 tokens 派生） */
    panel(x, y, w, h, r = T.radius.panel, opts = {}) {
      const { ctx } = this;
      const depth = opts.depth ?? 6;
      ctx.beginPath();
      ctx.roundRect(x, y + depth, w, h, r);
      ctx.fillStyle = withAlpha(col("bg_night"), 0.45);
      ctx.fill();
      const g = ctx.createLinearGradient(0, y, 0, y + h);
      g.addColorStop(0, mix(col("panel"), col("text_primary"), 0.06));
      g.addColorStop(1, col("panel"));
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + r, y + 2);
      ctx.lineTo(x + w - r, y + 2);
      ctx.strokeStyle = withAlpha(col("text_primary"), 0.14);
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    /** 立体按钮：上亮下暗渐变 + 底沿厚度 */
    button(r, label, kind = "normal") {
      const { ctx } = this;
      const top = kind === "primary" ? mix(col("gold_primary"), col("gold_deep"), 0.25) : mix(col("panel"), col("text_primary"), 0.08);
      const bot = kind === "primary" ? col("gold_deep") : col("panel");
      ctx.beginPath();
      ctx.roundRect(r.x, r.y + 4, r.w, r.h, T.radius.btn);
      ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
      ctx.fill();
      const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
      g.addColorStop(0, top);
      g.addColorStop(1, bot);
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = kind === "primary" ? col("gold_deep") : col("panel_stroke");
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(r.x + 10, r.y + r.h - 3);
      ctx.lineTo(r.x + r.w - 10, r.y + r.h - 3);
      ctx.strokeStyle = withAlpha(col("bg_night"), 0.55);
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.fillStyle = kind === "primary" ? shade(col("gold_primary"), 0.35) : col("text_primary");
      ctx.font = font(T.typography.body, { weight: "bold" });
      ctx.textAlign = "center";
      ctx.fillText(label, r.x + r.w / 2, r.y + r.h / 2 + (kind === "primary" ? -2 : 0));
      ctx.textAlign = "left";
    }
    /** 圆形图标按钮（设置/关闭等） */
    circleButton(x, y, r, drawGlyph) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col("panel");
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r - 5, Math.PI * 0.9, Math.PI * 1.9);
      ctx.strokeStyle = withAlpha(col("text_primary"), 0.25);
      ctx.lineWidth = 2;
      ctx.stroke();
      drawGlyph();
    }
    /** 自动换行 */
    wrap(text, maxWidth) {
      const { ctx } = this;
      const lines = [];
      let line = "";
      for (const ch of text) {
        if (ctx.measureText(line + ch).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else line += ch;
      }
      if (line) lines.push(line);
      return lines;
    }
    numFont(px, weight = "bold") {
      return font(px, { weight, family: T.typography.family_num });
    }
    // ---- 矢量图标（色板派生） ----
    iconCoin(x, y, r) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = col("gold_deep");
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r - r * 0.22, 0, Math.PI * 2);
      ctx.fillStyle = col("gold_primary");
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x - r * 0.28, y - r * 0.28, r * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(col("text_primary"), 0.85);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.52, 0, Math.PI * 2);
      ctx.strokeStyle = col("gold_deep");
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
    iconPerson(x, y, s, color) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.arc(x, y - s * 0.28, s * 0.32, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y + s * 0.5, s * 0.52, Math.PI, 0);
      ctx.lineTo(x + s * 0.52, y + s * 0.55);
      ctx.lineTo(x - s * 0.52, y + s * 0.55);
      ctx.closePath();
      ctx.fill();
    }
    iconBolt(x, y, s, color) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.moveTo(x + s * 0.15, y - s * 0.55);
      ctx.lineTo(x - s * 0.4, y + s * 0.08);
      ctx.lineTo(x - s * 0.05, y + s * 0.08);
      ctx.lineTo(x - s * 0.15, y + s * 0.55);
      ctx.lineTo(x + s * 0.4, y - s * 0.08);
      ctx.lineTo(x + s * 0.05, y - s * 0.08);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    iconPanic(x, y, s, color) {
      const { ctx } = this;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? s * 0.55 : s * 0.24;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, s * 0.14, 0, Math.PI * 2);
      ctx.fillStyle = col("bg_night");
      ctx.fill();
    }
    iconGear(x, y, r, color) {
      const { ctx } = this;
      ctx.beginPath();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2;
        ctx.lineTo(x + Math.cos(a) * r * 1.25, y + Math.sin(a) * r * 1.25);
        ctx.lineTo(x + Math.cos(a + Math.PI / 8) * r * 0.95, y + Math.sin(a + Math.PI / 8) * r * 0.95);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.42, 0, Math.PI * 2);
      ctx.fillStyle = col("bg_night");
      ctx.fill();
    }
    iconMoon(x, y, r, blood) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = blood ? col("alert_blood") : mix(col("text_primary"), col("gold_primary"), 0.5);
      ctx.fill();
      if (blood) {
        for (const [dx, dy, cr] of [[-0.3, -0.2, 0.16], [0.25, 0.15, 0.12], [0.05, 0.38, 0.1]]) {
          ctx.beginPath();
          ctx.arc(x + dx * r, y + dy * r, cr * r, 0, Math.PI * 2);
          ctx.fillStyle = shade(col("alert_blood"), 0.7);
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(x - r * 0.32, y - r * 0.3, r * 0.14, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(col("bg_night"), 0.35);
        ctx.fill();
      }
    }
    iconStar(x, y, r, color) {
      const { ctx } = this;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = i / 10 * Math.PI * 2 - Math.PI / 2;
        const rr = i % 2 === 0 ? r : r * 0.45;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    }
    iconWarn(x, y, s) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.moveTo(x, y - s * 0.55);
      ctx.lineTo(x + s * 0.55, y + s * 0.42);
      ctx.lineTo(x - s * 0.55, y + s * 0.42);
      ctx.closePath();
      ctx.fillStyle = col("alert_blood");
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = col("text_primary");
      ctx.font = this.numFont(s * 0.62);
      ctx.textAlign = "center";
      ctx.fillText("!", x, y + s * 0.28);
      ctx.textAlign = "left";
    }
    // ════════ 相位分发 ════════
    draw(ui2, frame, now, pb2) {
      const { ctx } = this;
      ctx.textAlign = "left";
      switch (ui2.phase) {
        case "DAWN_SETTLE": {
          this.bgBase(col("bg_night"));
          ctx.fillStyle = withAlpha(col("bg_dawn"), dissolveAlpha(pb2.settleStart, now));
          ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
          this.drawStars(now, 0.4);
          this.drawSettle(frame, now, pb2);
          this.drawModal(ui2, frame, now, pb2);
          break;
        }
        case "DAY":
          this.drawDayBg(now);
          if (ui2.page === "map") {
            this.drawMapView(ui2, frame, now);
            this.drawHouseVillage(frame, now, pb2);
            this.drawWeatherLayer(this.weatherEntry(frame.weather), now);
            this.drawTutorialBanner(frame);
            this.drawTutorialSteps(frame);
            this.drawDock();
          } else if (ui2.page === "interior") this.drawInterior(ui2, frame, now, pb2);
          else if (ui2.page === "wild") this.drawWildView(ui2, frame, now, pb2);
          else if (ui2.page === "main") {
            this.drawWeatherLayer(this.weatherEntry(frame.weather), now);
            this.button(mapBackRect(), "\u25C0 \u5C0F\u533A", "normal");
            this.drawHud(frame, now);
            this.drawTutorialBanner(frame);
            this.drawTutorialSteps(frame);
            this.drawResources(frame);
            this.drawBuilding(frame, now);
            this.drawEventEntry(frame);
            this.drawReport(frame);
            this.drawDock();
          } else {
            this.drawPage(ui2.page, now);
          }
          this.drawModal(ui2, frame, now, pb2);
          break;
        case "DUSK_FORECAST":
          this.drawDayBg(now);
          this.drawHud(frame, now);
          this.drawResources(frame);
          this.drawBuilding(frame, now);
          this.drawEventEntry(frame);
          this.drawReport(frame);
          this.drawDock();
          this.drawDuskBanner(frame, now);
          this.drawModal(ui2, frame, now, pb2);
          break;
        case "NIGHT":
          this.drawNight(frame, now, pb2);
          this.drawNightLog(frame, now, pb2);
          break;
      }
    }
    bgBase(c) {
      this.ctx.fillStyle = c;
      this.ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    }
    /** 白天背景：纵向渐变 + 缓浮尘埃 */
    drawDayBg(now) {
      const { ctx } = this;
      const g = ctx.createLinearGradient(0, 0, 0, DESIGN_H);
      g.addColorStop(0, mix(col("bg_dawn"), col("text_primary"), 0.05));
      g.addColorStop(1, col("bg_dawn"));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      for (let i = 0; i < 10; i++) {
        const seed = prand(i * 7 + 3);
        const x = prand(i * 13) * DESIGN_W;
        const y = (prand(i * 29) * DESIGN_H + now * 8e-3 * (0.5 + seed)) % DESIGN_H;
        ctx.beginPath();
        ctx.arc(x, y, 2 + seed * 2.5, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(col("text_primary"), 0.05 + seed * 0.05);
        ctx.fill();
      }
    }
    /** 天气条目查询（frame.weather id → config/weather.json 条目） */
    weatherEntry(id) {
      const list = weather_default.entries;
      return list.find((e) => e.id === id) ?? list[0];
    }
    /** 天气层：光照 overlay + 粒子（雨丝/雪花/雾带/血月尘）——全屏表现层 */
    drawWeatherLayer(w, now) {
      const { ctx } = this;
      if (w.lightMul < 1) {
        ctx.fillStyle = withAlpha(col(w.tintKey), (1 - w.lightMul) * 0.55);
        ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      }
      if (w.particles === "rain") {
        ctx.strokeStyle = withAlpha(col("text_primary"), 0.3);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 130; i++) {
          const speed = 0.9 * (0.7 + prand(i * 3) * 0.6);
          const x = prand(i * 13) * DESIGN_W + Math.sin(now / 400 + i) * 6;
          const y = (prand(i * 7) * DESIGN_H + now * speed) % DESIGN_H;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 4, y + 18);
        }
        ctx.stroke();
        ctx.fillStyle = withAlpha(col("text_primary"), 0.06);
        ctx.fillRect(0, DESIGN_H - 140, DESIGN_W, 140);
      } else if (w.particles === "snow") {
        ctx.fillStyle = withAlpha(col("text_primary"), 0.75);
        for (let i = 0; i < 90; i++) {
          const speed = 0.12 * (0.6 + prand(i * 5) * 0.8);
          const x = (prand(i * 11) * DESIGN_W + Math.sin(now / 700 + i * 2) * 26) % DESIGN_W;
          const y = (prand(i * 23) * DESIGN_H + now * speed) % DESIGN_H;
          ctx.beginPath();
          ctx.arc(x, y, 1.8 + prand(i) * 2.4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (w.particles === "fog") {
        for (let i = 0; i < 3; i++) {
          const y = 180 + i * 260 + Math.sin(now / 2200 + i * 1.7) * 36;
          ctx.fillStyle = withAlpha(col("text_secondary"), 0.1);
          ctx.beginPath();
          ctx.roundRect(-40, y, DESIGN_W + 80, 170, 90);
          ctx.fill();
        }
      } else if (w.particles === "dust") {
        ctx.strokeStyle = withAlpha(col("alert_blood"), 0.35);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 60; i++) {
          const speed = 0.5 * (0.6 + prand(i * 9) * 0.8);
          const x = DESIGN_W - (prand(i * 13) * DESIGN_W + now * speed) % (DESIGN_W + 60);
          const y = prand(i * 17) * DESIGN_H;
          ctx.moveTo(x, y);
          ctx.lineTo(x - 16, y + 2);
        }
        ctx.stroke();
      }
    }
    /** 天气 HUD 角标（图标 + 名称） */
    drawWeatherBadge(w, x, y) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(x, y, 108, 28, T.radius.chip);
      ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.lineWidth = 2;
      ctx.stroke();
      if (w.particles === "rain") {
        ctx.strokeStyle = withAlpha(col("text_primary"), 0.8);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < 3; i++) {
          ctx.moveTo(x + 14 + i * 8, y + 6);
          ctx.lineTo(x + 11 + i * 8, y + 18);
        }
        ctx.stroke();
      } else if (w.particles === "snow") {
        this.iconStar(x + 18, y + 13, 8, col("text_primary"));
      } else if (w.particles === "fog") {
        ctx.strokeStyle = col("text_secondary");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 8, y + 10);
        ctx.lineTo(x + 28, y + 10);
        ctx.moveTo(x + 10, y + 16);
        ctx.lineTo(x + 30, y + 16);
        ctx.stroke();
      } else if (w.particles === "dust") {
        ctx.beginPath();
        ctx.arc(x + 18, y + 13, 8, 0, Math.PI * 2);
        ctx.fillStyle = col("alert_blood");
        ctx.fill();
      } else if (w.id === "overcast") {
        ctx.fillStyle = col("text_secondary");
        ctx.beginPath();
        ctx.arc(x + 13, y + 15, 7, 0, Math.PI * 2);
        ctx.arc(x + 23, y + 13, 9, 0, Math.PI * 2);
        ctx.fill();
      } else {
        this.iconStar(x + 18, y + 13, 8, col("gold_primary"));
      }
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.caption);
      ctx.fillText(w.name, x + 36, y + 15);
    }
    /** 夜空星点（NIGHT/DAWN 过渡） */
    drawStars(now, alpha) {
      const { ctx } = this;
      for (let i = 0; i < 26; i++) {
        const x = prand(i * 17) * DESIGN_W;
        const y = prand(i * 31) * DESIGN_H * 0.7;
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(now / 900 + i));
        ctx.beginPath();
        ctx.arc(x, y, 1.2 + prand(i) * 1.6, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(col("text_primary"), alpha * tw);
        ctx.fill();
      }
    }
    // ---- HUD ----
    drawHud(frame, now) {
      const { ctx } = this;
      const hud = hudRect();
      const g = ctx.createLinearGradient(0, 0, 0, hud.h);
      g.addColorStop(0, mix(col("panel"), col("text_primary"), 0.07));
      g.addColorStop(1, col("panel"));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, hud.w, hud.h);
      ctx.fillStyle = col("panel_stroke");
      ctx.fillRect(0, hud.h - 3, hud.w, 3);
      ctx.fillStyle = withAlpha(col("text_primary"), 0.12);
      ctx.fillRect(0, 2, hud.w, 2);
      ctx.textBaseline = "middle";
      ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
      ctx.beginPath();
      ctx.roundRect(T.space.s, 8, 150, hud.h - 16, T.radius.chip);
      ctx.fill();
      ctx.fillStyle = col("gold_primary");
      ctx.font = this.numFont(T.typography.h2);
      ctx.fillText(`D${frame.day}`, T.space.s + 16, hud.h / 2 + 1);
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u65E5\u6B21", T.space.s + 16 + ctx.measureText(`D${frame.day}`).width + ctx.measureText("\u65E5\u6B21").width / 2 + 26, hud.h / 2 + 1);
      const cycle = Math.ceil(frame.day / 7);
      const isBMWeek = frame.modifiers.includes("BLOOD_MOON");
      for (let i = 0; i < 4; i++) {
        const mx = T.space.s + 176 + i * 30, my = hud.h / 2;
        const active = i < cycle;
        const current = i === cycle - 1;
        const pulse = current ? 0.75 + 0.25 * Math.sin(now / 500) : 1;
        ctx.beginPath();
        ctx.arc(mx, my, 8, 0, Math.PI * 2);
        ctx.fillStyle = active ? withAlpha(isBMWeek ? col("alert_blood") : col("gold_primary"), pulse) : withAlpha(col("panel_stroke"), 0.8);
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const st = settingsRect();
      this.drawWeatherBadge(this.weatherEntry(frame.weather), st.x - 196, hud.h / 2 - 14);
      this.circleButton(st.x + st.w / 2, hud.h / 2, 26, () => this.iconGear(st.x + st.w / 2, hud.h / 2, 13, col("text_secondary")));
      if (frame.modifiers.length) {
        const isBM = frame.modifiers.includes("BLOOD_MOON");
        ctx.fillStyle = isBM ? col("alert_blood") : col("danger");
        ctx.font = font(T.typography.caption, { weight: "bold" });
        const label = frame.modifiers.join("/");
        const tw = ctx.measureText(label).width;
        const threat = motion("threat");
        ctx.globalAlpha = isBM ? 0.6 + 0.4 * Math.sin(now / (threat.dur * 2) * Math.PI * 2) : 1;
        ctx.fillText(label, st.x - tw - T.space.l, hud.h / 2);
        ctx.globalAlpha = 1;
      }
    }
    // ---- 资源栏 ----
    drawResources(frame) {
      const { ctx } = this;
      const r = resourceRect();
      ctx.textBaseline = "middle";
      const items = [
        { draw: () => this.iconCoin(r.x + colW * 0 + 26, r.y + r.h / 2, 15), text: fmt(frame.gold), color: col("gold_primary") },
        { draw: () => this.iconPerson(r.x + colW * 1 + 26, r.y + r.h / 2, 30, col("text_secondary")), text: `${frame.population}/${frame.roomsBuilt}`, color: col("text_primary") },
        { draw: () => this.iconBolt(r.x + colW * 2 + 26, r.y + r.h / 2, 24, col("success")), text: fmt(frame.power), color: col("text_primary") },
        { draw: () => this.iconPanic(r.x + colW * 3 + 26, r.y + r.h / 2, 22, col("panic")), text: `${frame.panicSum}`, color: col("panic") }
      ];
      const colW = r.w / items.length;
      items.forEach((it, i) => {
        const x = r.x + colW * i + T.space.xs;
        ctx.beginPath();
        ctx.roundRect(x, r.y + 4, colW - T.space.xs * 2, r.h - 12, T.radius.chip);
        ctx.fillStyle = withAlpha(col("panel"), 0.85);
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.lineWidth = 2;
        ctx.stroke();
        it.draw();
        ctx.fillStyle = it.color;
        ctx.font = this.numFont(T.typography.h2);
        ctx.fillText(it.text, x + 52, r.y + r.h / 2);
      });
    }
    // ---- 剖面楼栋 ----
    drawBuilding(frame, now) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      const threat = motion("threat");
      let occupied = frame.population;
      for (let f = 0; f < FLOORS; f++) {
        const label = floorLabelRect(f);
        ctx.beginPath();
        ctx.roundRect(label.x + 4, label.y + label.h / 2 - 16, 40, 32, 8);
        ctx.fillStyle = withAlpha(col("bg_night"), 0.55);
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = f === 0 ? col("gold_primary") : col("text_secondary");
        ctx.font = this.numFont(T.typography.body);
        ctx.textAlign = "center";
        ctx.fillText(`${FLOORS - f}F`, label.x + 24, label.y + label.h / 2 + 1);
        ctx.textAlign = "left";
        const slab = roomRect(f, 0);
        ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
        ctx.fillRect(slab.x - 6, slab.y + slab.h + 2, roomRect(f, ROOMS_PER_FLOOR - 1).x + roomRect(f, ROOMS_PER_FLOOR - 1).w - slab.x + 12, 5);
        for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
          const rect = roomRect(f, r);
          const roomId = `F${FLOORS - f}-R${r + 1}`;
          const breached = frame.breachedRooms.includes(roomId);
          const isPublic = f === FLOORS - 1 && r < 3;
          const isTower = f === 0 && r === 0;
          const isOccupied = !isPublic && !isTower && occupied > 0;
          if (isOccupied) occupied--;
          this.drawRoom(rect, { breached, isPublic, isTower, isOccupied, roomId, now, threatDur: threat.dur });
        }
      }
    }
    drawRoom(rect, o) {
      const { ctx } = this;
      const rr = T.radius.chip;
      ctx.beginPath();
      ctx.roundRect(rect.x, rect.y, rect.w, rect.h, rr);
      ctx.save();
      ctx.clip();
      if (o.breached) {
        const pulse = 0.5 + 0.5 * Math.sin(o.now / (o.threatDur * 2) * Math.PI * 2);
        ctx.fillStyle = withAlpha(col("alert_blood"), 0.3 + 0.3 * pulse);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.strokeStyle = withAlpha(col("alert_blood"), 0.85);
        ctx.lineWidth = 2;
        for (const seed of [0, 1]) {
          const bx = rect.x + rect.w * (0.3 + seed * 0.4), by = rect.y + 4;
          ctx.beginPath();
          ctx.moveTo(bx, by);
          ctx.lineTo(bx + (seed ? 7 : -6), by + rect.h * 0.3);
          ctx.lineTo(bx + (seed ? -4 : 5), by + rect.h * 0.6);
          ctx.lineTo(bx + (seed ? 6 : -7), by + rect.h - 6);
          ctx.stroke();
        }
        this.iconWarn(rect.x + rect.w / 2, rect.y + rect.h / 2, 20);
      } else if (o.isTower) {
        ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        const cx = rect.x + rect.w / 2, top = rect.y + 10;
        ctx.beginPath();
        ctx.moveTo(cx - 14, rect.y + rect.h - 8);
        ctx.lineTo(cx - 9, top + 14);
        ctx.lineTo(cx + 9, top + 14);
        ctx.lineTo(cx + 14, rect.y + rect.h - 8);
        ctx.closePath();
        ctx.fillStyle = mix(col("panel_stroke"), col("gold_deep"), 0.4);
        ctx.fill();
        ctx.strokeStyle = col("gold_deep");
        ctx.lineWidth = 2;
        ctx.stroke();
        const sweep = Math.sin(o.now / 1400) * 0.9;
        ctx.beginPath();
        ctx.moveTo(cx, top + 16);
        ctx.lineTo(cx + Math.sin(sweep - 0.22) * rect.h, top + 16 - Math.cos(sweep - 0.22) * rect.h);
        ctx.lineTo(cx + Math.sin(sweep + 0.22) * rect.h, top + 16 - Math.cos(sweep + 0.22) * rect.h);
        ctx.closePath();
        ctx.fillStyle = withAlpha(col("gold_primary"), 0.22);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, top + 16, 5, 0, Math.PI * 2);
        ctx.fillStyle = col("gold_primary");
        ctx.fill();
      } else if (o.isPublic) {
        const g = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
        g.addColorStop(0, mix(col("gold_deep"), col("bg_night"), 0.55));
        g.addColorStop(1, mix(col("gold_deep"), col("bg_night"), 0.75));
        ctx.fillStyle = g;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        ctx.strokeStyle = withAlpha(col("gold_primary"), 0.9);
        ctx.lineWidth = 3;
        if (o.roomId.endsWith("R1")) {
          ctx.strokeRect(cx - 13, cy - 4, 26, 18);
          ctx.beginPath();
          ctx.moveTo(cx - 18, cy - 6);
          ctx.lineTo(cx, cy - 16);
          ctx.lineTo(cx + 18, cy - 6);
          ctx.stroke();
        } else if (o.roomId.endsWith("R2")) {
          ctx.fillStyle = withAlpha(col("success"), 0.95);
          ctx.fillRect(cx - 5, cy - 14, 10, 28);
          ctx.fillRect(cx - 14, cy - 5, 28, 10);
        } else {
          ctx.fillStyle = withAlpha(col("gold_deep"), 0.9);
          ctx.fillRect(cx - 16, cy - 2, 14, 14);
          ctx.fillRect(cx + 1, cy - 2, 14, 14);
          ctx.fillRect(cx - 8, cy - 16, 14, 14);
          ctx.strokeStyle = shade(col("gold_deep"), 0.6);
          ctx.lineWidth = 2;
          ctx.strokeRect(cx - 16, cy - 2, 14, 14);
          ctx.strokeRect(cx + 1, cy - 2, 14, 14);
          ctx.strokeRect(cx - 8, cy - 16, 14, 14);
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.textAlign = "center";
        ctx.fillText(["\u5927\u5385", "\u533B\u52A1", "\u4ED3"][Number(o.roomId.slice(-1)) - 1], cx, rect.y + rect.h - 10);
        ctx.textAlign = "left";
      } else if (o.isOccupied) {
        const breathe = 0.8 + 0.2 * Math.sin(o.now / 900 + rect.x % 7);
        const wg = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
        wg.addColorStop(0, withAlpha(col("gold_primary"), 0.28 * breathe));
        wg.addColorStop(1, withAlpha(col("success"), 0.1));
        ctx.fillStyle = wg;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        const wx = rect.x + 10, wy = rect.y + 8, ww = 22, wh = 26;
        ctx.fillStyle = withAlpha(col("gold_primary"), 0.75 * breathe);
        ctx.fillRect(wx, wy, ww, wh);
        ctx.strokeStyle = col("bg_night");
        ctx.lineWidth = 2;
        ctx.strokeRect(wx, wy, ww, wh);
        ctx.beginPath();
        ctx.moveTo(wx + ww / 2, wy);
        ctx.lineTo(wx + ww / 2, wy + wh);
        ctx.moveTo(wx, wy + wh / 2);
        ctx.lineTo(wx + ww, wy + wh / 2);
        ctx.stroke();
        ctx.fillStyle = withAlpha(col("bg_night"), 0.55);
        ctx.fillRect(rect.x + rect.w - 34, rect.y + rect.h - 22, 26, 12);
        ctx.fillRect(rect.x + rect.w - 34, rect.y + rect.h - 26, 8, 8);
        this.iconPerson(rect.x + 34, rect.y + rect.h - 12, 26, col("text_primary"));
        ctx.strokeStyle = withAlpha(col("success"), 0.9);
        ctx.lineWidth = 2.5;
        ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);
      } else {
        ctx.fillStyle = withAlpha(col("bg_night"), 0.35);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash([6, 6]);
        ctx.strokeStyle = withAlpha(col("panel_stroke"), 0.9);
        ctx.lineWidth = 2;
        ctx.strokeRect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
        ctx.setLineDash([]);
        const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
        ctx.strokeStyle = withAlpha(col("text_secondary"), 0.4);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - 9, cy);
        ctx.lineTo(cx + 9, cy);
        ctx.moveTo(cx, cy - 9);
        ctx.lineTo(cx, cy + 9);
        ctx.stroke();
      }
      ctx.restore();
    }
    // ---- 事件卡入口（漫画卡样式） ----
    drawEventEntry(frame) {
      const { ctx } = this;
      const r = eventEntryRect();
      this.panel(r.x, r.y, r.w, r.h, T.radius.btn, { depth: 8 });
      ctx.fillStyle = col("gold_primary");
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, 10, r.h, 5);
      ctx.fill();
      ctx.textBaseline = "middle";
      const top = frame.eventCards[0];
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u4ECA\u65E5\u4E8B\u4EF6", r.x + T.space.m + 8, r.y + 30);
      if (frame.eventCards.length > 1) {
        ctx.fillStyle = col("gold_primary");
        ctx.beginPath();
        ctx.roundRect(r.x + r.w - 96, r.y + 14, 56, 32, T.radius.chip);
        ctx.fillStyle = withAlpha(col("gold_primary"), 0.15);
        ctx.fill();
        ctx.strokeStyle = col("gold_deep");
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = col("gold_primary");
        ctx.font = this.numFont(T.typography.body);
        ctx.textAlign = "center";
        ctx.fillText(`+${frame.eventCards.length - 1}`, r.x + r.w - 68, r.y + 31);
        ctx.textAlign = "left";
      }
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(top ? top.title : "\u9759\u8C27 \xB7 \u65E0\u4E8B\u4EF6", r.x + T.space.m + 8, r.y + 74);
      this.circleButton(r.x + r.w - T.space.l - 26, r.y + r.h / 2, 26, () => {
        ctx.fillStyle = col("gold_primary");
        ctx.beginPath();
        ctx.moveTo(r.x + r.w - T.space.l - 32, r.y + r.h / 2 - 11);
        ctx.lineTo(r.x + r.w - T.space.l - 12, r.y + r.h / 2);
        ctx.lineTo(r.x + r.w - T.space.l - 32, r.y + r.h / 2 + 11);
        ctx.closePath();
        ctx.fill();
      });
    }
    // ---- 昨夜战报 ----
    drawReport(frame) {
      const { ctx } = this;
      const r = reportRect();
      this.panel(r.x, r.y, r.w, r.h);
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u6628\u591C\u6218\u62A5", r.x + T.space.m, r.y + 26);
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body);
      ctx.fillText(`r\u5747 ${frame.rAvg} \xB7 \u6B7B\u4EA1 ${frame.deaths} \xB7 \u8D1F\u4F24 ${frame.wounds}`, r.x + T.space.m, r.y + 62);
      const barW = r.w - T.space.m * 2;
      ctx.fillStyle = withAlpha(col("panic"), 0.15);
      ctx.beginPath();
      ctx.roundRect(r.x + T.space.m, r.y + r.h - 36, barW, 12, 6);
      ctx.fill();
      const ratio = Math.min(1, frame.population > 0 ? frame.panicSum / (frame.population * 100) : 0);
      if (ratio > 0) {
        const g = ctx.createLinearGradient(r.x + T.space.m, 0, r.x + T.space.m + barW * ratio, 0);
        g.addColorStop(0, col("panic"));
        g.addColorStop(1, mix(col("panic"), col("danger"), 0.5));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.roundRect(r.x + T.space.m, r.y + r.h - 36, Math.max(10, barW * ratio), 12, 6);
        ctx.fill();
      }
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText(`hash=${frame.sessionHash}`, r.x + r.w - T.space.m - 220, r.y + 26);
    }
    // ---- dock ----
    drawDock() {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      dockRects().forEach((r, i) => {
        const key = DOCK_KEYS[i];
        this.button(r, key.label, key.key === "night" ? "primary" : "normal");
      });
    }
    // ---- DUSK 横幅 ----
    drawDuskBanner(frame, now) {
      const { ctx } = this;
      const b = duskBannerRect();
      this.panel(b.x, b.y, b.w, b.h, T.radius.btn, { depth: 8 });
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u5165\u591C\u9884\u544A", b.x + T.space.m, b.y + 28);
      const silent = frame.modifiers.includes("SILENT");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      if (silent) {
        ctx.fillStyle = col("text_secondary");
        ctx.font = this.numFont(T.typography.h1);
        ctx.fillText("?", b.x + T.space.m, b.y + 68);
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u9759\u9ED8\u4E4B\u591C \xB7 \u60C5\u62A5\u7F3A\u5931", b.x + T.space.m + 36, b.y + 68);
      } else {
        const isBM = frame.modifiers.includes("BLOOD_MOON");
        this.iconMoon(b.x + T.space.m + 18, b.y + 66, 16, isBM);
        ctx.fillStyle = isBM ? col("alert_blood") : col("text_primary");
        ctx.font = font(T.typography.h2, { weight: "bold" });
        ctx.fillText(isBM ? "\u8840\u6708" : "\u5E38\u89C4\u591C\u88AD", b.x + T.space.m + 46, b.y + 68);
        if (frame.modifiers.includes("MIGRATE")) {
          ctx.fillStyle = col("danger");
          ctx.font = font(T.typography.caption, { weight: "bold" });
          ctx.fillText("\u602A\u7269\u8FC1\u79FB \xB7 \u5F00\u6218\u91CD\u6392", b.x + T.space.m + 170, b.y + 68);
        }
      }
      const threat = motion("threat");
      ctx.globalAlpha = 0.7 + 0.3 * Math.sin(now / (threat.dur * 2) * Math.PI * 2);
      this.button(duskConfirmRect(), "\u5E03\u9632", "primary");
      ctx.globalAlpha = 1;
    }
    // ---- NIGHT 全屏夜战（M3.3 v2：类 3D 深度战场——三车道/影子/小屋防区/双方交互实体）----
    drawNight(frame, now, pb2) {
      const { ctx } = this;
      ctx.save();
      const isBM = frame.modifiers.includes("BLOOD_MOON");
      if (isBM && pb2.nightStart !== null) {
        const burst = threatBurst(pb2.nightStart, now);
        if (burst.shake > 0) ctx.translate(Math.sin(now / 16) * burst.shake, Math.cos(now / 13) * burst.shake);
        this.bgBase(col("bg_night"));
        this.drawStars(now, 0.9);
        if (burst.flash > 0) {
          ctx.fillStyle = withAlpha(col("alert_blood"), 0.35 * burst.flash);
          ctx.fillRect(-20, -20, DESIGN_W + 40, DESIGN_H + 40);
        }
      } else {
        this.bgBase(col("bg_night"));
        this.drawStars(now, 0.9);
      }
      if (isBM) {
        ctx.beginPath();
        ctx.arc(DESIGN_W - 120, 150, 52, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(col("alert_blood"), 0.25);
        ctx.fill();
        this.iconMoon(DESIGN_W - 120, 150, 40, true);
      }
      ctx.textBaseline = "middle";
      ctx.fillStyle = isBM ? col("alert_blood") : col("text_primary");
      ctx.font = font(T.typography.h1, { weight: "bold" });
      ctx.fillText(isBM ? "\u8840\u6708" : "\u591C\u88AD", T.space.l, 120);
      if (isBM) this.iconMoon(T.space.l + 130, 118, 14, true);
      ctx.fillStyle = col("text_secondary");
      ctx.font = this.numFont(T.typography.h2);
      const waves = pb2.session && pb2.nightStart !== null ? nightWaves(pb2.session.routes, pb2.nightStart, now) : null;
      ctx.fillText(`${waves?.waveNo ?? 0}/${pb2.session?.routes.length ?? 0}`, T.space.l + 260, 120);
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u6CE2", T.space.l + 344, 120);
      if (pb2.session?.silent) {
        ctx.fillStyle = col("text_secondary");
        ctx.font = this.numFont(T.typography.h2);
        ctx.fillText("?", T.space.l + 420, 120);
      }
      const laneDefs = [
        { y: 430, scale: 0.78 },
        { y: 640, scale: 0.9 },
        { y: 880, scale: 1 }
      ];
      const houseX = 590;
      laneDefs.forEach((l, d) => {
        ctx.fillStyle = withAlpha(col("bg_dawn"), 0.06 + d * 0.02);
        ctx.beginPath();
        ctx.moveTo(40 + d * 20, l.y - 40 * l.scale);
        ctx.lineTo(DESIGN_W - 40 - d * 10, l.y - 40 * l.scale);
        ctx.lineTo(DESIGN_W - 40, l.y + 50 * l.scale);
        ctx.lineTo(40, l.y + 50 * l.scale);
        ctx.closePath();
        ctx.fill();
      });
      if (pb2.session && waves) {
        pb2.session.routes.forEach((_, i) => {
          const lane = laneDefs[i % laneDefs.length];
          const hx = houseX + Math.floor(i / laneDefs.length) * 90;
          const hy = lane.y + 8;
          const rv = waves.revealed[i];
          const breachedNow = rv && rv.state !== 2;
          const resolved = waves.waveNo > i + 1;
          this.drawHouseMini(hx, hy, lane.scale, breachedNow && (resolved || this.isCurrentLane(waves, i, now)) ? col("alert_blood") : void 0, now);
          const gx = hx - 46 * lane.scale;
          ctx.save();
          ctx.translate(gx, hy);
          ctx.scale(lane.scale, lane.scale);
          const attacking = this.isCurrentLane(waves, i, now) && monsterProgress(i + 1, pb2.nightStart ?? 0, now) > 0.72;
          this.drawGuard(0, 0, guardVisual(i), attacking, now);
          ctx.restore();
          ctx.fillStyle = col("text_secondary");
          ctx.font = this.numFont(T.typography.body);
          ctx.fillText(WAVE_LETTERS[i], 56 + i % laneDefs.length * 12, lane.y + 6);
        });
      }
      if (pb2.session && waves && pb2.nightStart !== null) {
        pb2.session.routes.forEach((rt, i) => {
          const rv = waves.revealed[i];
          if (!rv) return;
          const lane = laneDefs[i % laneDefs.length];
          const isCurrent = waves.waveNo === i + 1;
          const prog = isCurrent ? monsterProgress(waves.waveNo, pb2.nightStart ?? 0, now) : waves.waveNo > i + 1 ? 1 : 0;
          if (prog <= 0 && !isCurrent) return;
          const visual = monsterVisual(rt.monsterId ?? "");
          const startX = 90, endX = houseX - 70 * lane.scale;
          const mx = startX + (endX - startX) * prog;
          const my = lane.y + 20 * lane.scale + (visual === "flyer" ? -26 * lane.scale : 0) + (isCurrent ? Math.sin(now / 95) * 2.5 * lane.scale : 0);
          const lunge = isCurrent && prog > 0.72 ? Math.sin(now / 55) * 7 * lane.scale : 0;
          const sc = lane.scale * (visual === "elite" ? 1.3 : 1);
          const shOff = visual === "flyer" ? 26 * lane.scale : 0;
          ctx.beginPath();
          ctx.ellipse(mx - lunge, my + shOff, 20 * sc * lane.scale, 6 * sc * lane.scale, 0, 0, Math.PI * 2);
          ctx.fillStyle = withAlpha(col("bg_night"), 0.6);
          ctx.fill();
          ctx.save();
          ctx.translate(mx + lunge, my + (visual === "flyer" ? Math.sin(now / 120) * 4 : Math.abs(Math.sin(now / 110)) * -3));
          ctx.scale(sc, sc);
          if (isCurrent && prog > 0.72 && Math.sin(now / 55) > 0.4) {
            ctx.fillStyle = withAlpha(col("text_primary"), 0.55);
            ctx.fillRect(-16, -14, 32, 26);
          }
          this.drawMonster(visual, now);
          ctx.restore();
          if (isCurrent && prog > 0.72 && Math.sin(now / 55) > 0.4) {
            ctx.fillStyle = withAlpha(col("text_primary"), 0.25);
            ctx.fillRect(houseX - 40, lane.y - 60, 130, 110);
          }
          void frame;
        });
        pb2.session.routes.forEach((_, i) => {
          const rv = waves?.revealed[i];
          if (!rv || waves.waveNo <= i + 1) return;
          const lane = laneDefs[i % laneDefs.length];
          const hx = houseX + Math.floor(i / laneDefs.length) * 90, hy = lane.y + 8;
          if (rv.state === 2) {
            for (let p = 0; p < 6; p++) {
              const a = prand(i * 7 + p) * Math.PI * 2;
              ctx.beginPath();
              ctx.arc(hx - 40 + Math.cos(a) * (8 + p * 4), hy - 30 - Math.sin(a) * (6 + p * 3), 3, 0, Math.PI * 2);
              ctx.fillStyle = withAlpha(col("text_primary"), 0.55);
              ctx.fill();
            }
          } else {
            ctx.fillStyle = withAlpha(col("alert_blood"), 0.3 + 0.25 * Math.sin(now / 160));
            ctx.beginPath();
            ctx.roundRect(hx - 30, hy - 46, 96, 74, 8);
            ctx.fill();
            ctx.fillStyle = col("text_primary");
            ctx.font = font(T.typography.caption, { weight: "bold" });
            ctx.textAlign = "center";
            ctx.fillText("\u7834\u9632", hx + 18, hy - 8);
            ctx.textAlign = "left";
          }
        });
      }
      const waveFx = pb2.skills.find((k) => k.fxKind === "wave");
      if (waveFx && now < waveFx.fxUntil) {
        const k = 1 - (waveFx.fxUntil - now) / 900;
        for (const lane of laneDefs) {
          ctx.beginPath();
          ctx.moveTo(houseX - 280, lane.y + 10);
          ctx.arc(houseX - 280, lane.y + 10, 130 + k * 430, -0.5, 0.5);
          ctx.closePath();
          ctx.strokeStyle = withAlpha(col("gold_primary"), 0.7 * (1 - k));
          ctx.lineWidth = 6 * (1 - k) + 1;
          ctx.stroke();
        }
      }
      pb2.skills.forEach((sk) => {
        if (now >= sk.fxUntil) return;
        const remain = (sk.fxUntil - now) / 1200;
        if (sk.fxKind === "supply") {
          const py = 180 + (1 - remain) * 420;
          ctx.strokeStyle = withAlpha(col("text_primary"), 0.7);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(DESIGN_W / 2 - 26, py);
          ctx.lineTo(DESIGN_W / 2, py + 26);
          ctx.moveTo(DESIGN_W / 2 + 26, py);
          ctx.lineTo(DESIGN_W / 2, py + 26);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(DESIGN_W / 2, py - 6, 30, Math.PI, 0);
          ctx.fillStyle = withAlpha(col("gold_primary"), 0.85);
          ctx.fill();
          ctx.strokeStyle = col("bg_night");
          ctx.stroke();
          ctx.fillStyle = mix(col("gold_deep"), col("bg_night"), 0.3);
          ctx.fillRect(DESIGN_W / 2 - 14, py + 26, 28, 20);
          ctx.beginPath();
          ctx.arc(DESIGN_W / 2, py + 56, 34 * (1 - remain * 0.5), 0, Math.PI * 2);
          ctx.strokeStyle = withAlpha(col("gold_primary"), 0.5);
          ctx.lineWidth = 3;
          ctx.stroke();
        } else {
          const breathe = 0.5 + 0.5 * Math.sin(now / 180);
          ctx.beginPath();
          ctx.arc(houseX + 60, 760, 190, Math.PI, 0);
          ctx.fillStyle = withAlpha(col("success"), 0.1 + breathe * 0.06);
          ctx.fill();
          ctx.strokeStyle = withAlpha(col("success"), 0.5 + breathe * 0.3);
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      });
      if (pb2.session && waves) {
        pb2.session.routes.forEach((_, i) => {
          const rv = waves.revealed[i];
          const r = nightRouteRect(i);
          const isCurrent = waves.waveNo === i + 1;
          const fill = rv ? isCurrent ? waves.currentFill : 1 : 0;
          const stateColor = !rv ? col("panel_stroke") : rv.state === 0 ? col("alert_blood") : rv.state === 1 ? col("gold_deep") : col("success");
          ctx.fillStyle = col("text_secondary");
          ctx.font = this.numFont(T.typography.caption);
          ctx.textBaseline = "middle";
          ctx.fillText(WAVE_LETTERS[i], r.x + 40, r.y + r.h / 2);
          const barX = r.x + 76, barW = r.w - 76 - 150;
          ctx.fillStyle = withAlpha(col("bg_night"), 0.7);
          ctx.beginPath();
          ctx.roundRect(barX, r.y + r.h / 2 - 8, barW, 16, 8);
          ctx.fill();
          if (fill > 0 && rv) {
            ctx.fillStyle = stateColor;
            ctx.beginPath();
            ctx.roundRect(barX + 2, r.y + r.h / 2 - 6, Math.max(6, (barW - 4) * fill), 12, 6);
            ctx.fill();
          }
          if (rv) {
            ctx.fillStyle = col("text_secondary");
            ctx.font = font(T.typography.caption);
            ctx.fillText(`${this.roomLabel(rv.route.roomId)} ${Math.round(rv.route.r * 100)}%`, barX + barW + T.space.s, r.y + r.h / 2);
          }
        });
      }
      this.drawSkillButtons(now, pb2);
      ctx.restore();
    }
    isCurrentLane(waves, i, now) {
      void now;
      return waves.waveNo === i + 1;
    }
    /** 目标小屋立面（按房屋等级外观；等级来自 pb.houseLevels 覆盖或天数成长） */
    drawHouseMini(x, y, scale, flash, now) {
      const { ctx } = this;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      const w = 80, wallH = 34;
      ctx.fillStyle = mix(col("panel"), col("gold_deep"), 0.3);
      ctx.fillRect(0, -wallH, w, wallH);
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 3;
      ctx.strokeRect(0, -wallH, w, wallH);
      ctx.beginPath();
      ctx.moveTo(-8, -wallH);
      ctx.lineTo(w / 2, -wallH - 24);
      ctx.lineTo(w + 8, -wallH);
      ctx.closePath();
      ctx.fillStyle = col("gold_deep");
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
      ctx.fillStyle = withAlpha(col("gold_primary"), 0.8);
      ctx.fillRect(10, -wallH + 10, 14, 12);
      ctx.fillRect(w - 26, -wallH + 10, 14, 12);
      if (flash) {
        ctx.fillStyle = flash;
        ctx.globalAlpha = 0.3 + 0.2 * Math.sin(now / 120);
        ctx.fillRect(-4, -wallH - 20, w + 8, wallH + 24);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    // 主动技
    // ---- DAWN 收租结算 ----
    drawSettle(frame, now, pb2) {
      const { ctx } = this;
      const start = pb2.settleStart;
      ctx.textBaseline = "middle";
      if (start !== null) {
        const rainM = motion("rain");
        const rainT = Math.min(1, (now - start) / rainM.dur);
        if (rainT < 1) {
          for (let i = 0; i < 24; i++) {
            const seed = prand(i * 97 + frame.day * 31);
            const x = T.space.l + seed * (DESIGN_W - T.space.l * 2 - 24);
            const y = (rainM.fn(rainT) * DESIGN_H * 1.1 + seed * 300) % (DESIGN_H * 0.9);
            ctx.fillStyle = withAlpha(col("gold_primary"), 0.35);
            ctx.fillRect(x - 2, y - 2, 24, 34);
            ctx.fillStyle = col("gold_primary");
            ctx.fillRect(x, y, 20, 30);
            ctx.fillStyle = shade(col("gold_primary"), 0.72);
            ctx.fillRect(x + 4, y + 4, 12, 8);
          }
        }
      }
      const r = settlePanelRect();
      this.panel(r.x, r.y, r.w, r.h);
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.body);
      ctx.fillText("\u5929\u4EAE \xB7 \u6536\u79DF\u7ED3\u7B97", r.x + T.space.m, r.y + 48);
      const households = Math.min(frame.population, frame.roomsBuilt);
      const shown = start !== null ? counterValue(frame.income, start + motion("rain").dur, now) : 0;
      ctx.fillStyle = col("gold_primary");
      ctx.font = this.numFont(T.typography.h1);
      ctx.fillText(`+${fmt(shown)}`, settleCounterRect().x + T.space.m, settleCounterRect().y + 40);
      this.iconCoin(settleCounterRect().x + T.space.m + ctx.measureText(`+${fmt(shown)}`).width + 30, settleCounterRect().y + 38, 20);
      const perRoom = households > 0 ? Math.round(frame.income / households) : 0;
      const popCount = Math.min(households, SETTLE_POP_MAX);
      for (let i = 0; i < popCount; i++) {
        const p = start !== null ? popProgress(i, start + motion("rain").dur + motion("counter").dur, now) : 0;
        if (p <= 0) continue;
        const pr = settlePopRect(i);
        ctx.globalAlpha = p;
        this.iconPerson(pr.x + 14, pr.y + pr.h / 2, 22, col("text_secondary"));
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u4F4F \xB7 F1-R${i + 1}`, pr.x + 36, pr.y + pr.h / 2);
        ctx.fillStyle = col("gold_primary");
        ctx.font = this.numFont(T.typography.body);
        ctx.fillText(`+${fmt(perRoom)}`, pr.x + 170, pr.y + pr.h / 2);
        ctx.globalAlpha = 1;
      }
      if (households > SETTLE_POP_MAX) {
        const pr = settlePopRect(SETTLE_POP_MAX - 1);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u2026\u5171 ${households} \u6237`, pr.x, pr.y + pr.h + 24);
      }
      if (start !== null && now >= settleDoneAt(start, households)) {
        this.button(settleContinueRect(), "\u7EE7\u7EED \u25B6", "primary");
      }
    }
    // ---- L1 野外地图（探索；UI 规范 v2.0 §7.3）----
    drawWildView(ui2, frame, now, pb2) {
      const { ctx } = this;
      ctx.fillStyle = col("bg_night");
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.textBaseline = "middle";
      this.button(wildBackRect(), "\u25C0 \u5C0F\u533A", "normal");
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText("\u91CE\u5916 \xB7 \u5927\u533A\u57DF\u5730\u56FE", wildBackRect().x + wildBackRect().w + T.space.m, wildBackRect().y + wildBackRect().h / 2);
      const parties = pb2.parties ?? [];
      let px = wildBackRect().x + wildBackRect().w + T.space.l + 240;
      for (const p of parties) {
        ctx.fillStyle = withAlpha(col("success"), 0.15);
        ctx.beginPath();
        ctx.roundRect(px, wildBackRect().y + 8, 190, wildBackRect().h - 16, T.radius.chip);
        ctx.fill();
        ctx.strokeStyle = col("success");
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`${WILD_ZONE_NAME(p.zone)} \xB7 ${p.size}\u4EBA`, px + 12, wildBackRect().y + wildBackRect().h / 2 - 12);
        ctx.fillStyle = col("text_secondary");
        ctx.fillText(`D${p.returnsDay} \u5F52\u6765`, px + 12, wildBackRect().y + wildBackRect().h / 2 + 14);
        px += 205;
      }
      WILD_ZONES.forEach((z, i) => {
        const r = wildZoneRect(i);
        const locked = frame.day < z.unlockDay;
        const sel2 = ui2.sel.wildZone === z.zone;
        this.panel(r.x, r.y, r.w, r.h, T.radius.btn);
        if (sel2) {
          ctx.strokeStyle = col("gold_primary");
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
          ctx.lineWidth = 3;
          ctx.stroke();
        }
        ctx.fillStyle = locked ? withAlpha(col("panel_stroke"), 0.5) : z.danger === "high" ? withAlpha(col("alert_blood"), 0.3) : z.danger === "mid" ? withAlpha(col("gold_deep"), 0.25) : withAlpha(col("success"), 0.2);
        for (let t = 0; t < 3; t++) {
          const tx = r.x + 40 + t * 70, ty = r.y + 60;
          ctx.beginPath();
          ctx.moveTo(tx, ty - 30);
          ctx.lineTo(tx + 26, ty + 26);
          ctx.lineTo(tx - 26, ty + 26);
          ctx.closePath();
          ctx.fill();
          ctx.fillRect(tx - 4, ty + 26, 8, 12);
        }
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.h2, { weight: "bold" });
        ctx.fillText(locked ? `${z.name} D${z.unlockDay}` : z.name, r.x + T.space.m, r.y + 130);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u8DEF\u7A0B ${z.travelTime} \u5206\u949F \xB7 \u5371\u9669 ${z.danger === "low" ? "\u4F4E" : z.danger === "mid" ? "\u4E2D" : "\u9AD8"}`, r.x + T.space.m, r.y + 165);
      });
      const sel = WILD_ZONES.find((z) => z.zone === ui2.sel.wildZone);
      const d = wildDetailRect();
      this.panel(d.x, d.y, d.w, d.h);
      if (!sel) {
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.body);
        ctx.fillText("\u70B9\u51FB\u4E0A\u65B9\u533A\u57DF\u67E5\u770B\u63A2\u7D22\u8BE6\u60C5", d.x + T.space.m, d.y + 40);
      } else {
        const locked = frame.day < sel.unlockDay;
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`${sel.name}${locked ? `\uFF08D${sel.unlockDay} \u89E3\u9501\uFF09` : ""}`, d.x + T.space.m, d.y + 40);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u961F\u4F0D\u4EBA\u6570", d.x + T.space.m, d.y + 100);
        ctx.fillStyle = col("text_primary");
        ctx.font = this.numFont(T.typography.h2);
        ctx.fillText(`${ui2.sel.partySize ?? 1}`, wildMinusRect().x + wildMinusRect().w + HIT_MIN + 20, wildMinusRect().y + wildMinusRect().h / 2);
        this.button(wildMinusRect(), "\uFF0D", "normal");
        this.button(wildPlusRect(), "\uFF0B", "normal");
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u4F53\u529B ${sel.travelTime > 20 ? 35 : sel.travelTime > 10 ? 25 : 20}/\u4EBA \xB7 ${sel.travelTime > 20 ? "\u8DE8\u591C\u98CE\u9669\uFF08\u591C\u665A\u5371\u9669 \xD72\uFF09" : "\u5F53\u65E5\u5F52\u6765"}`, d.x + T.space.m, d.y + 220);
        if (!locked) this.button(wildDispatchRect(), "\u6D3E\u51FA \u25B6", "primary");
      }
      if ((pb2.wildReports?.length ?? 0) > 0) {
        const rr = pb2.wildReports[pb2.wildReports.length - 1];
        ctx.fillStyle = withAlpha(col("panel"), 0.9);
        ctx.beginPath();
        ctx.roundRect(d.x, d.y + 240, d.w, 48, T.radius.chip);
        ctx.fill();
        ctx.fillStyle = col("gold_primary");
        ctx.font = font(T.typography.caption, { weight: "bold" });
        ctx.fillText(`\u5F52\u6765\u6218\u62A5\uFF1A${rr.join(" \xB7 ")}`, d.x + T.space.m, d.y + 264);
      }
      void now;
    }
    /** 独栋小屋群落（M3.2 F5；K-H1 决议）：30 栋错排，6 级进化外观，烟囱/窗光/间距 */
    drawHouseVillage(frame, now, pb2) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u4F4F\u6237\u5C0F\u5C4B\u7FA4\u843D", 90, 690);
      for (let i = 0; i < 30; i++) {
        const col2 = i % 6, row = Math.floor(i / 6);
        const x = 96 + col2 * 100 + row % 2 * 50;
        const y = 726 + row * 84;
        const occupied = i < frame.population;
        const dayGrowth = Math.min(5, Math.floor(frame.day / 6) + (i % 2 === 0 ? 0 : 1));
        const level = Math.min(5, Math.max(pb2.houseLevels[i] ?? 0, dayGrowth));
        this.drawHouse(x, y, level, occupied, now, i);
      }
    }
    /** 单栋小屋：6 级外观（茅草屋→破损木屋→普通木屋→精品木屋→石屋→砖石堡垒） */
    drawHouse(x, y, level, occupied, now, i) {
      const { ctx } = this;
      const w = 62, wallH = 26 + level * 3;
      const wallByLv = [
        mix(col("gold_deep"), col("bg_night"), 0.72),
        shade(col("panel_stroke"), 0.9),
        mix(col("panel"), col("gold_deep"), 0.25),
        col("panel"),
        col("panel_stroke"),
        shade(col("panel_stroke"), 1.15)
      ][Math.min(5, level)];
      ctx.fillStyle = wallByLv;
      ctx.fillRect(x, y - wallH, w, wallH);
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y - wallH, w, wallH);
      if (level >= 3) {
        ctx.fillStyle = withAlpha(col("bg_night"), 0.35);
        ctx.fillRect(x, y - 6, w, 6);
      }
      if (level === 1) {
        ctx.strokeStyle = withAlpha(col("bg_night"), 0.7);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 12, y - wallH + 4);
        ctx.lineTo(x + 20, y - 6);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x - 9, y - wallH);
      ctx.lineTo(x + w / 2, y - wallH - (16 + level * 3));
      ctx.lineTo(x + w + 9, y - wallH);
      ctx.closePath();
      const roofByLv = [
        mix(col("gold_primary"), col("bg_night"), 0.55),
        // 茅草枯黄
        mix(col("gold_primary"), col("bg_night"), 0.62),
        mix(col("gold_deep"), col("bg_night"), 0.35),
        // 木棕
        mix(col("panel_stroke"), col("gold_deep"), 0.4),
        // 精品
        shade(col("panel_stroke"), 0.75),
        // 石瓦
        mix(col("panel_stroke"), col("danger"), 0.18)
        // 砖石
      ][Math.min(5, level)];
      ctx.fillStyle = roofByLv;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2.5;
      ctx.stroke();
      if (level >= 2) {
        ctx.strokeStyle = withAlpha(col("bg_night"), 0.4);
        ctx.lineWidth = 1.5;
        for (let t = 1; t <= level - 1 && t <= 3; t++) {
          ctx.beginPath();
          ctx.moveTo(x - 9 + t * 6, y - wallH);
          ctx.lineTo(x + w / 2, y - wallH - (16 + level * 3) + t * 3);
          ctx.lineTo(x + w + 9 - t * 6, y - wallH);
          ctx.stroke();
        }
      }
      if (level >= 3) {
        ctx.fillStyle = col("bg_night");
        ctx.fillRect(x + w / 2 - 6, y - wallH - 10, 12, 10);
      }
      if (level >= 5) {
        ctx.fillRect(x + w - 6, y - wallH - 22, 12, 22);
        ctx.fillStyle = col("danger");
        ctx.fillRect(x + w - 4, y - wallH - 20, 8, 4);
      }
      ctx.fillStyle = occupied ? col("gold_primary") : col("text_secondary");
      ctx.fillRect(x + w / 2 - 7, y - 18, 14, 18);
      ctx.fillStyle = occupied ? withAlpha(col("gold_primary"), 0.8) : withAlpha(col("panel_stroke"), 0.8);
      ctx.fillRect(x + 8, y - wallH + 8, 10, 10);
      if (occupied && level >= 2) {
        const puff = (now / 300 + i * 11) % 36;
        ctx.beginPath();
        ctx.arc(x + w - 10, y - wallH - 18 - puff * 0.6, 3 + puff * 0.08, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(col("text_secondary"), Math.max(0, 0.5 - puff / 60));
        ctx.fill();
        ctx.fillStyle = col("panel_stroke");
        ctx.fillRect(x + w - 14, y - wallH - 14, 8, 12);
      }
    }
    /** 新手引导横幅（M3.4-①首切片）：当日 scripted 教学事件 → 顶部金色目标条 */
    drawTutorialBanner(frame) {
      const tut = frame.eventCards.find((c) => c.id.startsWith("evt_tut_"));
      if (!tut) return;
      const { ctx } = this;
      const y = hudRect().h + 4;
      ctx.fillStyle = withAlpha(col("gold_primary"), 0.16);
      ctx.beginPath();
      ctx.roundRect(T.space.s, y, DESIGN_W - T.space.s * 2, 52, T.radius.chip);
      ctx.fill();
      ctx.strokeStyle = col("gold_deep");
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = col("gold_primary");
      ctx.beginPath();
      ctx.roundRect(T.space.s + 10, y + 12, 56, 28, 6);
      ctx.fill();
      ctx.fillStyle = shade(col("gold_primary"), 0.3);
      ctx.font = font(T.typography.caption, { weight: "bold" });
      ctx.fillText("\u6559\u5B66", T.space.s + 18, y + 27);
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body, { weight: "bold" });
      ctx.fillText(`\u76EE\u6807\uFF1A${tut.title}`, T.space.s + 80, y + 27);
    }
    /** 分步引导步骤板（M3.4-②）：当日步骤高亮/下一步指引/完成打勾 */
    drawTutorialSteps(frame) {
      const { ctx } = this;
      const fired = new Set(frame.eventCards.map((c) => c.id));
      const titles = new Map(frame.eventCards.map((c) => [c.id, c.title]));
      const { rows, current } = tutorialBoard(frame.day, fired);
      if (rows.length === 0) return;
      const w = 330, x = DESIGN_W - w - 16, y = 1150;
      const h = 56 + rows.length * 88;
      this.panel(x, y, w, h, T.radius.btn);
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("gold_primary");
      ctx.beginPath();
      ctx.roundRect(x + 14, y + 12, 40, 26, 6);
      ctx.fill();
      ctx.fillStyle = shade(col("gold_primary"), 0.3);
      ctx.font = font(T.typography.caption, { weight: "bold" });
      ctx.fillText("\u6B65\u9AA4", x + 20, y + 26);
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.caption, { weight: "bold" });
      ctx.fillText(`\u4ECA\u65E5\u76EE\u6807 ${rows.filter((r) => r.done).length}/${rows.length}`, x + 66, y + 26);
      rows.forEach((row, i) => {
        const ry = y + 52 + i * 88;
        const isCurrent = current?.id === row.step.id;
        if (isCurrent) {
          ctx.beginPath();
          ctx.roundRect(x + 10, ry - 4, w - 20, 84, T.radius.chip);
          ctx.fillStyle = withAlpha(col("gold_primary"), 0.12);
          ctx.fill();
          ctx.strokeStyle = col("gold_deep");
          ctx.lineWidth = 2;
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(x + 34, ry + 14, 13, 0, Math.PI * 2);
        if (row.done) {
          ctx.fillStyle = col("success");
          ctx.fill();
        }
        ctx.strokeStyle = row.done ? col("success") : col("panel_stroke");
        ctx.lineWidth = 2.5;
        ctx.stroke();
        if (row.done) {
          ctx.strokeStyle = shade(col("success"), 0.25);
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.moveTo(x + 27, ry + 14);
          ctx.lineTo(x + 32, ry + 20);
          ctx.lineTo(x + 42, ry + 6);
          ctx.stroke();
        } else {
          ctx.fillStyle = col("text_secondary");
          ctx.beginPath();
          ctx.arc(x + 34, ry + 14, 5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = row.done ? col("text_secondary") : col("text_primary");
        ctx.font = font(T.typography.body, { weight: row.done ? void 0 : "bold" });
        ctx.fillText(titles.get(row.step.id) ?? row.step.id, x + 56, ry + 10);
        if (isCurrent && !row.done) {
          ctx.fillStyle = col("gold_primary");
          ctx.font = font(T.typography.caption);
          ctx.font = font(T.typography.caption);
          for (const [j, ln] of this.wrap(row.step.hint, w - 100).entries()) {
            ctx.fillText(`\u25B8 ${ln}`, x + 56, ry + 42 + j * 24);
          }
        }
      });
    }
    /** 新开放角标（楼栋解锁后 3 天内显示，替代锁定态） */
    newlyOpenBadge(cx, cy) {
      const { ctx } = this;
      ctx.fillStyle = col("success");
      ctx.beginPath();
      ctx.roundRect(cx - 34, cy - 12, 68, 26, T.radius.chip);
      ctx.fill();
      ctx.fillStyle = shade(col("success"), 0.3);
      ctx.font = font(T.typography.caption, { weight: "bold" });
      ctx.textAlign = "center";
      ctx.fillText("\u65B0\u5F00\u653E", cx, cy + 1);
      ctx.textAlign = "left";
    }
    /** 守卫绘制（职业差异：守卫棍棒横扫/猎人弓弩/平民顶锅；攻击节拍挥击） */
    drawGuard(x, y, visual, attacking, now) {
      this.iconPerson(x, y, 26, col("text_primary"));
      const { ctx } = this;
      ctx.fillStyle = col("alert_blood");
      ctx.fillRect(x - 3, y - 2, 8, 5);
      const swing = attacking ? Math.sin(now / 70) * 0.6 : 0;
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 3;
      if (visual === "club") {
        ctx.save();
        ctx.translate(x + 10, y - 6);
        ctx.rotate(-0.6 + swing);
        ctx.strokeRect(0, -2, 18, 4);
        ctx.fillStyle = col("panel_stroke");
        ctx.fillRect(14, -5, 7, 7);
        ctx.restore();
      } else if (visual === "bow") {
        ctx.beginPath();
        ctx.arc(x + 12, y - 4, 9, -1.1, 1.1);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(x + 12 + Math.cos(-1.1) * 9, y - 4 + Math.sin(-1.1) * 9);
        ctx.lineTo(x + 12 + Math.cos(1.1) * 9, y - 4 + Math.sin(1.1) * 9);
        ctx.stroke();
        if (attacking) {
          ctx.strokeStyle = col("gold_primary");
          ctx.lineWidth = 2;
          const ax = x + 14 + (Math.sin(now / 70) + 1) * 8;
          ctx.beginPath();
          ctx.moveTo(ax, y - 4);
          ctx.lineTo(ax + 14, y - 4);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        ctx.ellipse(x + 11, y - 16, 9, 5, 0, 0, Math.PI * 2);
        ctx.fillStyle = col("panel_stroke");
        ctx.fill();
        ctx.strokeStyle = col("bg_night");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    /** 怪物绘制（差异化：循声者爬行+声波圈/破窗者携梯/攀楼种挂钩/飞行种悬停/精英红眼尖刺） */
    drawMonster(visual, now) {
      const { ctx } = this;
      const body = shade(col("panel_stroke"), 0.55);
      const legSwing = Math.sin(now / 90) * 3;
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 3;
      if (visual === "flyer") {
        const flap = Math.sin(now / 60) * 6;
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(-14, -14 + flap);
        ctx.moveTo(0, -8);
        ctx.lineTo(14, -14 - flap);
        ctx.stroke();
      }
      if (visual === "crawler" || visual === "elite") {
        ctx.beginPath();
        ctx.moveTo(-8, 8);
        ctx.lineTo(-12, 14 + legSwing);
        ctx.moveTo(8, 8);
        ctx.lineTo(12, 14 - legSwing);
        ctx.stroke();
      }
      ctx.beginPath();
      if (visual === "flyer") ctx.ellipse(0, 0, 12, 9, 0, 0, Math.PI * 2);
      else ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
      ctx.fillStyle = body;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2;
      ctx.stroke();
      if (visual === "breaker") {
        ctx.strokeStyle = col("bg_night");
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(10, -6);
        ctx.lineTo(20, 4);
        ctx.stroke();
      }
      if (visual === "climber") {
        ctx.strokeStyle = col("bg_night");
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(-12, -4, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (visual === "elite") {
        ctx.beginPath();
        ctx.moveTo(-10, -10);
        ctx.lineTo(-14, -16);
        ctx.moveTo(10, -10);
        ctx.lineTo(14, -16);
        ctx.stroke();
      }
      const er = visual === "elite" ? 4 : 3;
      ctx.fillStyle = col("alert_blood");
      ctx.beginPath();
      ctx.arc(-5, -3, er, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(5, -3, er, 0, Math.PI * 2);
      ctx.fill();
    }
    /** 主动技按钮（88px 热区 + CD 环 + 差异化 VFX 触发窗） */
    drawSkillButtons(now, pb2) {
      const { ctx } = this;
      nightSkillRects().forEach((r, i) => {
        const sk = pb2.skills[i];
        if (!sk) return;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
        ctx.fillStyle = col("panel");
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = this.numFont(T.typography.h2);
        ctx.fillText(sk.glyph, r.x + r.w / 2 - 16, r.y + r.h / 2 - 8);
        ctx.font = font(T.typography.caption);
        ctx.fillStyle = col("text_secondary");
        const lw = ctx.measureText(sk.label).width;
        ctx.fillText(sk.label, r.x + (r.w - lw) / 2, r.y + r.h - 18);
        const cdLeft = sk.cdUntil - now;
        if (cdLeft > 0) {
          const frac = cdLeft / (motion("normal").dur * 10);
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 30, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2);
          ctx.strokeStyle = col("gold_primary");
          ctx.lineWidth = 5;
          ctx.stroke();
          ctx.fillStyle = withAlpha(col("bg_night"), 0.55);
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 8, 26, 0, Math.PI * 2);
          ctx.fill();
        }
      });
    }
    /** 战况日志 + 战毕返回 */
    drawNightLog(frame, now, pb2) {
      const { ctx } = this;
      const r = nightLogRect();
      this.panel(r.x, r.y, r.w, r.h);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel);
      ctx.clip();
      ctx.textBaseline = "middle";
      const lines = [];
      if (pb2.session && pb2.nightStart !== null) {
        const waves = nightWaves(pb2.session.routes, pb2.nightStart, now);
        waves.revealed.forEach((rv, i) => {
          const mon = pb2.monsterNames[rv.route.monsterId ?? ""] ?? "\u602A\u7269";
          lines.push(`\u7B2C${i + 1}\u6CE2 \u8DEF${WAVE_LETTERS[i]} \xB7 ${this.roomLabel(rv.route.roomId)} \xB7 ${mon} \xB7 r=${rv.route.r.toFixed(2)} \u2192 ${OUTCOME_LABEL[rv.route.outcome]}`);
        });
      }
      lines.push(...pb2.logs);
      ctx.font = font(T.typography.body);
      const visible = lines.slice(-Math.floor((r.h - T.space.s * 2) / 36));
      visible.forEach((ln, i) => {
        ctx.fillStyle = i === visible.length - 1 ? col("text_primary") : col("text_secondary");
        ctx.fillText(ln, r.x + T.space.m, r.y + 32 + i * 36);
      });
      if (pb2.session && pb2.nightStart !== null && nightWaves(pb2.session.routes, pb2.nightStart, now).done) {
        this.button(nightBackRect(), "\u5929\u4EAE\u4E86 \u2192", "primary");
      }
      ctx.restore();
    }
    // ---- L2 小区地图（等距；UI 规范 v2.0 §7.1）----
    drawMapView(ui2, frame, now) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      this.drawHudMini(frame, now);
      for (let gx = 0; gx < 7; gx++) {
        for (let gy = 0; gy < 8; gy++) {
          const c = isoToScreen(gx, gy);
          ctx.beginPath();
          ctx.moveTo(c.x, c.y);
          ctx.lineTo(c.x + ISO_TILE_W / 2, c.y + ISO_TILE_H / 2);
          ctx.lineTo(c.x, c.y + ISO_TILE_H);
          ctx.lineTo(c.x - ISO_TILE_W / 2, c.y + ISO_TILE_H / 2);
          ctx.closePath();
          ctx.fillStyle = (gx + gy) % 2 === 0 ? withAlpha(col("panel"), 0.5) : withAlpha(col("panel_stroke"), 0.25);
          ctx.fill();
        }
      }
      for (const [id, lot] of Object.entries(LOTS)) {
        const locked = frame.day < lot.unlockDay;
        const base = isoToScreen(lot.gx, lot.gy);
        const cx = base.x, cy = base.y + ISO_TILE_H / 2;
        if (lot.kind === "bld") this.drawIsoBuilding(cx, cy, locked, frame, id, now);
        if (lot.kind === "bld" && !locked && frame.day >= lot.unlockDay && frame.day - lot.unlockDay < 3) this.newlyOpenBadge(cx, cy - 6 * ISO_FLOOR_H - 34);
        else if (lot.kind === "gate") this.drawIsoGate(cx, cy);
        else if (lot.kind === "wall") this.drawIsoWall(cx, cy);
        else if (lot.kind === "plaza") this.drawIsoPlaza(cx, cy);
        else this.drawIsoFacility(cx, cy, locked);
        ctx.font = font(T.typography.caption, { weight: "bold" });
        ctx.textAlign = "center";
        ctx.fillStyle = locked ? col("text_secondary") : col("text_primary");
        ctx.fillText(locked ? `${lot.name} D${lot.unlockDay}` : lot.name, cx, cy + 36);
        ctx.textAlign = "left";
      }
      const ex = EXPLORE_ENTRY;
      ctx.beginPath();
      ctx.roundRect(ex.x, ex.y, ex.w, ex.h, T.radius.btn);
      ctx.fillStyle = withAlpha(col("success"), 0.14);
      ctx.fill();
      ctx.strokeStyle = col("success");
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body, { weight: "bold" });
      ctx.textAlign = "center";
      ctx.fillText("\u{1F332} \u51FA\u95E8\u63A2\u7D22\uFF08M3.3 \u5F00\u653E\uFF09", ex.x + ex.w / 2, ex.y + ex.h / 2 + 1);
      ctx.textAlign = "left";
      this.drawDock();
      void ui2;
    }
    drawHudMini(frame, now) {
      const { ctx } = this;
      const hud = hudRect();
      const g = ctx.createLinearGradient(0, 0, 0, hud.h);
      g.addColorStop(0, mix(col("panel"), col("text_primary"), 0.07));
      g.addColorStop(1, col("panel"));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, hud.w, hud.h);
      ctx.fillStyle = col("panel_stroke");
      ctx.fillRect(0, hud.h - 3, hud.w, 3);
      ctx.textBaseline = "middle";
      ctx.fillStyle = withAlpha(col("bg_night"), 0.5);
      ctx.beginPath();
      ctx.roundRect(T.space.s, 8, 150, hud.h - 16, T.radius.chip);
      ctx.fill();
      ctx.fillStyle = col("gold_primary");
      ctx.font = this.numFont(T.typography.h2);
      ctx.fillText(`D${frame.day}`, T.space.s + 16, hud.h / 2 + 1);
      const cycle = Math.ceil(frame.day / 7);
      for (let i = 0; i < 4; i++) {
        const mx = T.space.s + 176 + i * 30;
        ctx.beginPath();
        ctx.arc(mx, hud.h / 2, 8, 0, Math.PI * 2);
        ctx.fillStyle = i < cycle ? frame.modifiers.includes("BLOOD_MOON") ? col("alert_blood") : col("gold_primary") : withAlpha(col("panel_stroke"), 0.8);
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.drawWeatherBadge(this.weatherEntry(frame.weather), DESIGN_W - 32 - 196, hud.h / 2 - 14);
      const st = settingsRect();
      this.circleButton(st.x + st.w / 2, hud.h / 2, 26, () => this.iconGear(st.x + st.w / 2, hud.h / 2, 13, col("text_secondary")));
      void now;
    }
    drawIsoBuilding(cx, cy, locked, frame, id, now) {
      const { ctx } = this;
      const w = ISO_TILE_W * 0.9, h = ISO_TILE_H * 0.9, floors = 6;
      const topZ = floors * ISO_FLOOR_H;
      const left = locked ? col("panel_stroke") : shade(col("panel"), 0.8);
      const right = locked ? shade(col("panel_stroke"), 0.92) : col("panel");
      const topFill = locked ? shade(col("panel_stroke"), 0.9) : mix(col("panel"), col("text_primary"), 0.12);
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy - h / 2 - topZ);
      ctx.lineTo(cx, cy - topZ);
      ctx.lineTo(cx, cy - topZ + h / 2 + ISO_TILE_H / 2);
      ctx.lineTo(cx - w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2);
      ctx.closePath();
      ctx.fillStyle = left;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx + w / 2, cy - h / 2 - topZ);
      ctx.lineTo(cx, cy - topZ);
      ctx.lineTo(cx, cy - topZ + h / 2 + ISO_TILE_H / 2);
      ctx.lineTo(cx + w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2);
      ctx.closePath();
      ctx.fillStyle = right;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - topZ - h / 2);
      ctx.lineTo(cx + w / 2, cy - topZ);
      ctx.lineTo(cx, cy - topZ + h / 2);
      ctx.lineTo(cx - w / 2, cy - topZ);
      ctx.closePath();
      ctx.fillStyle = topFill;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
      if (!locked) {
        const litTotal = id === "lot_bld_a" ? Math.min(30, frame.population) : 0;
        for (let f = 0; f < floors; f++) {
          const fy = cy - (f + 1) * ISO_FLOOR_H;
          ctx.beginPath();
          ctx.moveTo(cx - w / 2, fy - h / 2);
          ctx.lineTo(cx + w / 2, fy - h / 2);
          ctx.strokeStyle = withAlpha(col("bg_night"), 0.5);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          for (let win = 0; win < 3; win++) {
            const lit = f * 3 + win < litTotal;
            const wx = cx + (win - 1) * (w / 4) + w / 8, wy = fy - ISO_FLOOR_H * 0.45;
            ctx.fillStyle = lit ? withAlpha(col("gold_primary"), 0.9) : withAlpha(col("panel_stroke"), 0.6);
            ctx.fillRect(wx - 5, wy - 5, 10, 10);
          }
        }
        if (id === "lot_bld_a") {
          const pulse = 0.5 + 0.5 * Math.sin(now / 700);
          ctx.beginPath();
          ctx.arc(cx, cy + 6, 12 + pulse * 5, 0, Math.PI * 2);
          ctx.strokeStyle = withAlpha(col("success"), 0.5 + pulse * 0.4);
          ctx.lineWidth = 3;
          ctx.stroke();
        }
      }
    }
    /** 夜战目标房间标签：F{n}-R{m} → A栋 n 层 m 号（M0 数值窗口内目标恒在默认栋 A） */
    roomLabel(roomId) {
      const m = /F(\d+)-R(\d+)/.exec(roomId);
      return m ? `A\u680B${m[1]}\u5C42${m[2]}\u53F7` : roomId;
    }
    drawIsoGate(cx, cy) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(cx - 55, cy - 30, 110, 34, 6);
      ctx.fillStyle = col("panel_stroke");
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2.5;
      ctx.stroke();
      ctx.beginPath();
      ctx.roundRect(cx - 34, cy - 58, 68, 30, 6);
      ctx.fillStyle = mix(col("panel_stroke"), col("gold_deep"), 0.35);
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
      ctx.fillStyle = col("gold_primary");
      ctx.font = font(T.typography.caption, { weight: "bold" });
      ctx.textAlign = "center";
      ctx.fillText("\u95E8", cx, cy - 42);
      ctx.textAlign = "left";
    }
    drawIsoWall(cx, cy) {
      const { ctx } = this;
      for (let i = 0; i < 3; i++) {
        ctx.beginPath();
        ctx.roundRect(cx - 60 + i * 42, cy - 16, 36, 20, 4);
        ctx.fillStyle = shade(col("panel_stroke"), 0.85);
        ctx.fill();
        ctx.strokeStyle = col("bg_night");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    drawIsoPlaza(cx, cy) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 20);
      ctx.lineTo(cx + 52, cy + 6);
      ctx.lineTo(cx, cy + 32);
      ctx.lineTo(cx - 52, cy + 6);
      ctx.closePath();
      ctx.fillStyle = withAlpha(col("panel"), 0.7);
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = col("text_secondary");
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(cx, cy - 20);
      ctx.lineTo(cx, cy - 58);
      ctx.stroke();
      ctx.fillStyle = col("alert_blood");
      ctx.beginPath();
      ctx.moveTo(cx, cy - 58);
      ctx.lineTo(cx + 22, cy - 50);
      ctx.lineTo(cx, cy - 42);
      ctx.closePath();
      ctx.fill();
    }
    drawIsoFacility(cx, cy, locked) {
      const { ctx } = this;
      const w = ISO_TILE_W * 0.66, h = ISO_TILE_H * 0.66;
      const z = ISO_FLOOR_H * 1.4;
      ctx.beginPath();
      ctx.moveTo(cx - w / 2, cy - h / 2 - z);
      ctx.lineTo(cx, cy - z);
      ctx.lineTo(cx, cy - z + h / 2 + ISO_TILE_H / 2);
      ctx.lineTo(cx - w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2);
      ctx.closePath();
      ctx.fillStyle = locked ? col("panel_stroke") : shade(col("panel"), 0.85);
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2 - z);
      ctx.lineTo(cx + w / 2, cy - h / 2 - z + h / 2);
      ctx.lineTo(cx + w / 2, cy - h / 2 + ISO_TILE_H / 2 + h / 2);
      ctx.lineTo(cx, cy - z + h / 2 + ISO_TILE_H / 2);
      ctx.closePath();
      ctx.fillStyle = locked ? shade(col("panel_stroke"), 0.92) : col("panel");
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx, cy - h / 2 - z - 14);
      ctx.lineTo(cx + w / 2, cy - h / 2 - z + h / 2 - 7);
      ctx.lineTo(cx, cy - h / 2 - z + h / 2);
      ctx.lineTo(cx - w / 2, cy - h / 2 - z + h / 2 - 7);
      ctx.closePath();
      ctx.fillStyle = col("gold_deep");
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.stroke();
    }
    // ---- L3 房屋内部（点击房间进入；UI 规范 v2.0 §7.2）----
    drawInterior(ui2, frame, now, pb2) {
      const { ctx } = this;
      const floor = ui2.sel.floor ?? 0, room = ui2.sel.room ?? 0;
      const roomIndex = floor * ROOMS_PER_FLOOR + room;
      const occupied = roomIndex < frame.population;
      ctx.fillStyle = col("bg_night");
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      ctx.textBaseline = "middle";
      this.button(interiorBackRect(), "\u25C0 \u697C\u5C42", "normal");
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(`A\u680B \xB7 ${floor + 1}\u5C42 \xB7 ${room + 1}\u53F7\u623F`, interiorBackRect().x + interiorBackRect().w + T.space.m, interiorBackRect().y + interiorBackRect().h / 2);
      const fx0 = 60, fx1 = DESIGN_W - 60, fy0 = 560, fy1 = 1180, wallTop = 270;
      const g = ctx.createLinearGradient(0, fy0, 0, fy1);
      g.addColorStop(0, mix(col("gold_deep"), col("bg_night"), 0.55));
      g.addColorStop(1, mix(col("gold_deep"), col("bg_night"), 0.78));
      ctx.beginPath();
      ctx.moveTo(fx0, fy0);
      ctx.lineTo(fx1, fy0);
      ctx.lineTo(fx1 + 60, fy1);
      ctx.lineTo(fx0 - 60, fy1);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = mix(col("panel"), col("bg_night"), 0.35);
      ctx.fillRect(fx0, wallTop, fx1 - fx0, fy0 - wallTop);
      ctx.strokeStyle = col("bg_night");
      ctx.strokeRect(fx0, wallTop, fx1 - fx0, fy0 - wallTop);
      const wx = fx0 + 40, wy = wallTop + 40, ww = 150, wh = 170;
      ctx.fillStyle = withAlpha(col("gold_primary"), occupied ? 0.35 : 0.12);
      ctx.fillRect(wx, wy, ww, wh);
      ctx.strokeStyle = col("bg_night");
      ctx.lineWidth = 5;
      ctx.strokeRect(wx, wy, ww, wh);
      ctx.beginPath();
      ctx.moveTo(wx + ww / 2, wy);
      ctx.lineTo(wx + ww / 2, wy + wh);
      ctx.moveTo(wx, wy + wh / 2);
      ctx.lineTo(wx + ww, wy + wh / 2);
      ctx.stroke();
      const dx = fx1 - 200;
      ctx.fillStyle = mix(col("panel_stroke"), col("gold_deep"), 0.3);
      ctx.fillRect(dx, wallTop + 60, 110, fy0 - wallTop - 60);
      ctx.strokeStyle = col("bg_night");
      ctx.strokeRect(dx, wallTop + 60, 110, fy0 - wallTop - 60);
      ctx.beginPath();
      ctx.arc(dx + 92, wallTop + 60 + (fy0 - wallTop - 60) / 2, 6, 0, Math.PI * 2);
      ctx.fillStyle = col("gold_primary");
      ctx.fill();
      for (let i = 0; i < 2; i++) {
        const sr = interiorSlotRect(i);
        const fortified = pb2.forts[`${floor}:${room}:${i}`] ?? false;
        ctx.setLineDash(fortified ? [] : [10, 8]);
        ctx.beginPath();
        ctx.roundRect(sr.x, sr.y, sr.w, sr.h, T.radius.chip);
        ctx.fillStyle = fortified ? withAlpha(col("success"), 0.16) : withAlpha(col("bg_night"), 0.5);
        ctx.fill();
        ctx.strokeStyle = fortified ? col("success") : col("panel_stroke");
        ctx.setLineDash([]);
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = fortified ? col("success") : col("text_secondary");
        ctx.font = font(T.typography.body, { weight: fortified ? "bold" : void 0 });
        ctx.textAlign = "center";
        ctx.fillText(fortified ? "\u5DF2\u52A0\u56FA" : `\u5DE5\u4E8B\u4F4D ${i + 1}`, sr.x + sr.w / 2, sr.y + sr.h / 2);
        ctx.textAlign = "left";
      }
      if (occupied) {
        const px = DESIGN_W / 2, py = (fy0 + fy1) / 2 - 30;
        const breathe = 1 + 0.02 * Math.sin(now / 800);
        ctx.save();
        ctx.translate(px, py);
        ctx.scale(breathe, breathe);
        this.iconPerson(0, 0, 110, col("text_primary"));
        ctx.restore();
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.textAlign = "center";
        ctx.fillText("\u4F4F\u6237 \xB7 \u751F\u547D 100 \xB7 \u6050\u614C 0", px, py + 92);
        ctx.textAlign = "left";
      } else {
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.h2);
        ctx.textAlign = "center";
        ctx.fillText("\u7A7A\u623F \xB7 \u5F85\u5165\u4F4F", DESIGN_W / 2, (fy0 + fy1) / 2);
        ctx.textAlign = "left";
      }
    }
    // ---- 模态 ----
    drawModal(ui2, frame, now, pb2) {
      const { ctx } = this;
      const top = topModal(ui2);
      if (!top) {
        this.modalOpenAt = null;
        return;
      }
      if (this.modalOpenAt === null) this.modalOpenAt = now;
      const m = motion("normal");
      const eased = m.fn(Math.min(1, (now - this.modalOpenAt) / m.dur));
      const r = modalRect();
      const slide = (1 - eased) * (DESIGN_H - r.y);
      ctx.fillStyle = withAlpha(col("bg_night"), 0.62 * eased);
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      const y = r.y + slide;
      this.panel(r.x, y, r.w, r.h);
      ctx.fillStyle = withAlpha(col("text_secondary"), 0.5);
      ctx.beginPath();
      ctx.roundRect(r.x + r.w / 2 - 40, y + 12, 80, 8, 4);
      ctx.fill();
      ctx.textBaseline = "middle";
      if (top.kind === "event" && top.card) {
        this.drawEventCard(top, y, frame, now, pb2);
        return;
      }
      const title = top.id.startsWith("house:") ? `\u5C0F\u5C4B ${Number(top.id.split(":")[1]) + 1} \u53F7` : top.kind === "confirmNight" ? "\u786E\u8BA4\u5165\u591C\uFF1F" : { deploy: "\u5E03\u9632", recruit: "\u62DB\u52DF", upgrade: "\u5347\u7EA7", settings: "\u8BBE\u7F6E" }[top.id] ?? top.id;
      ctx.fillStyle = col("gold_primary");
      ctx.beginPath();
      ctx.roundRect(r.x + T.space.m, y + 32, 6, 32, 3);
      ctx.fill();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(title, r.x + T.space.m + 18, y + 48);
      ctx.strokeStyle = col("panel_stroke");
      ctx.beginPath();
      ctx.moveTo(r.x + T.space.m, y + 80);
      ctx.lineTo(r.x + r.w - T.space.m, y + 80);
      ctx.stroke();
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.body);
      if (top.id.startsWith("house:")) {
        const idx2 = Number(top.id.split(":")[1]);
        const lv = Math.min(5, pb2.houseLevels[idx2] ?? 0);
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`\u5F53\u524D\u7B49\u7EA7 Lv${lv}${lv >= 5 ? "\uFF08\u6EE1\u7EA7\uFF09" : ` \u2192 Lv${lv + 1}`}`, r.x + T.space.m, y + 120);
        const cost = lv >= 5 ? {} : building_def_default2.entries.find((e) => e.type === "house" && e.level === lv + 1)?.cost ?? {};
        const costText = Object.entries(cost).map(([k, v]) => `${k === "gold" ? "\u91D1\u5E01" : "\u5EFA\u6750"} \xD7${v}`).join("  ") || "\u514D\u8D39";
        ctx.fillStyle = col("gold_primary");
        ctx.font = font(T.typography.body);
        ctx.fillText(`\u5347\u7EA7\u6D88\u8017\uFF1A${costText}`, r.x + T.space.m, y + 160);
        if (lv < 5) {
          const cr = modalConfirmRect();
          this.button({ ...cr, y: cr.y - r.y + y }, "\u5347\u7EA7 \u25B6", "primary");
        }
      } else {
        const body = top.kind === "confirmNight" ? "\u5165\u591C\u540E\u4E0D\u53EF\u6253\u65AD\uFF08\u5168\u5C4F\u591C\u6218\uFF09" : "\u5360\u4F4D\u9762\u677F\uFF1AM3 \u63A5\u5165\u5BF9\u5E94\u7CFB\u7EDF\u64CD\u4F5C";
        ctx.fillText(body, r.x + T.space.m, y + 120);
      }
      if (top.kind === "confirmNight") {
        const cr = modalConfirmRect();
        this.button({ ...cr, y: cr.y - r.y + y }, "\u5165\u591C \u25B6", "primary");
      }
      this.closeBtn(y - r.y, top.kind === "event" && top.chosen !== void 0 ? "\u7EE7\u7EED" : "\u5173\u95ED");
    }
    /** 事件卡（§3.2 模板） */
    drawEventCard(top, y, frame, now, pb2) {
      const { ctx } = this;
      const r = modalRect();
      const card = top.card;
      if (!card) return;
      ctx.fillStyle = col("gold_primary");
      ctx.beginPath();
      ctx.roundRect(r.x + T.space.m, y + 32, 6, 32, 3);
      ctx.fill();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(card.title, r.x + T.space.m + 18, y + 48);
      ctx.strokeStyle = col("panel_stroke");
      ctx.beginPath();
      ctx.moveTo(r.x + T.space.m, y + 80);
      ctx.lineTo(r.x + r.w - T.space.m, y + 80);
      ctx.stroke();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body);
      const bodyLines = card.text ? this.wrap(card.text, r.w - T.space.m * 2.4) : [];
      bodyLines.slice(0, 2).forEach((ln, i) => ctx.fillText(ln, r.x + T.space.m + 8, y + 118 + i * 34));
      const opt = card.options[0];
      const flipped = top.chosen !== void 0;
      const flip = cardFlip(pb2.chosenAt, now);
      if (opt && !flipped) {
        const or = modalOptionRect();
        const br = { ...or, y: or.y - r.y + y };
        ctx.beginPath();
        ctx.roundRect(br.x, br.y, br.w, br.h, T.radius.btn);
        const g = ctx.createLinearGradient(0, br.y, 0, br.y + br.h);
        g.addColorStop(0, withAlpha(col("gold_primary"), 0.18));
        g.addColorStop(1, withAlpha(col("gold_deep"), 0.1));
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = col("gold_deep");
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`\u25B6 ${opt.label}`, br.x + T.space.m, br.y + 34);
        ctx.fillStyle = col("text_secondary");
        ctx.font = this.numFont(T.typography.caption);
        const ps = opt.ps.map((p) => `${Math.round(p * 100)}%`).join("/");
        ctx.fillText(ps, br.x + T.space.m, br.y + 72);
        const stars = Math.min(3, opt.ps.length - 1);
        for (let i = 0; i < stars; i++) this.iconWarn(br.x + br.w - 60 - i * 34, br.y + 66, 18);
      }
      if (flipped) {
        const flyT = pb2.chosenAt !== null ? Math.min(1, Math.max(0, (now - (pb2.chosenAt + motion("normal").dur)) / motion("rain").dur)) : 0;
        ctx.globalAlpha = flip;
        ctx.fillStyle = col("success");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`\u2713 \u5DF2\u6267\u884C \xB7 ${card.resultText}`, r.x + T.space.m + 8, y + 210, r.w - T.space.m * 2.4);
        ctx.globalAlpha = 1;
        if (flyT > 0 && flyT < 1) {
          const rainM = motion("rain");
          const e = rainM.fn(flyT);
          const fx = r.x + T.space.m + (resourceRect().x + T.space.l - r.x) * e;
          const fy = y + 210 + (resourceRect().y + 20 - y - 210) * e;
          this.iconCoin(fx, fy, 14);
        }
      }
      this.closeBtn(y - r.y, flipped ? "\u7EE7\u7EED" : "\u7A0D\u540E");
    }
    closeBtn(dy, label) {
      const c = modalCloseRect();
      this.circleButton(c.x + c.w / 2, c.y + dy + c.h / 2, c.h / 2 - 4, () => {
        const { ctx } = this;
        ctx.strokeStyle = col("text_primary");
        ctx.lineWidth = 3.5;
        const m = 9;
        ctx.beginPath();
        ctx.moveTo(c.x + c.w / 2 - m, c.y + dy + c.h / 2 - m);
        ctx.lineTo(c.x + c.w / 2 + m, c.y + dy + c.h / 2 + m);
        ctx.moveTo(c.x + c.w / 2 + m, c.y + dy + c.h / 2 - m);
        ctx.lineTo(c.x + c.w / 2 - m, c.y + dy + c.h / 2 + m);
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.caption);
        ctx.textAlign = "center";
        ctx.fillText(label, c.x + c.w / 2, c.y + dy + c.h - 8);
        ctx.textAlign = "left";
      });
    }
    /** 占位页（功能点4）：图鉴 3 列网格剪影 / 商店礼包横滑 / 设置列表 */
    drawPage(page, now) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      this.button(pageBackRect(), "\u25C0 \u8FD4\u56DE", "normal");
      const titles = { codex: "\u56FE\u9274", shop: "\u5546\u5E97", settings: "\u8BBE\u7F6E" };
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h1, { weight: "bold" });
      ctx.fillText(titles[page] ?? "", pageTitleRect().x, pageTitleRect().y + pageTitleRect().h / 2);
      if (page === "codex") {
        for (let row = 0; row < CODEX_ROWS; row++) {
          for (let c = 0; c < CODEX_COLS; c++) {
            const r = codexCellRect(c, row);
            const unlocked = row === 0 && c === 0;
            const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
            g.addColorStop(0, unlocked ? withAlpha(col("success"), 0.16) : withAlpha(col("bg_night"), 0.55));
            g.addColorStop(1, unlocked ? withAlpha(col("success"), 0.06) : withAlpha(col("bg_night"), 0.3));
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel);
            ctx.fillStyle = g;
            ctx.fill();
            ctx.strokeStyle = unlocked ? col("success") : col("panel_stroke");
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.font = this.numFont(T.typography.h1);
            ctx.fillStyle = unlocked ? col("text_primary") : col("text_secondary");
            ctx.textAlign = "center";
            if (unlocked) this.iconPerson(r.x + r.w / 2, r.y + r.h / 2 - 14, 56, col("gold_primary"));
            else {
              ctx.strokeStyle = col("text_secondary");
              ctx.lineWidth = 4;
              ctx.beginPath();
              ctx.arc(r.x + r.w / 2, r.y + r.h / 2 - 30, 16, Math.PI, 0);
              ctx.stroke();
              ctx.fillStyle = col("text_secondary");
              ctx.beginPath();
              ctx.roundRect(r.x + r.w / 2 - 22, r.y + r.h / 2 - 30, 44, 34, 6);
              ctx.fill();
            }
            ctx.font = font(T.typography.caption);
            ctx.fillStyle = unlocked ? col("text_primary") : col("text_secondary");
            ctx.fillText(unlocked ? "\u5FAA\u58F0\u8005" : "\u672A\u89E3\u9501", r.x + r.w / 2, r.y + r.h - 40);
            ctx.textAlign = "left";
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5360\u4F4D\uFF1AM3 \u6309\u602A\u7269\u8FDB\u5316\u6811/\u4F4F\u6237\u540D\u518C\u586B\u5145", T.space.l, codexCellRect(0, CODEX_ROWS - 1).y + codexCellRect(0, 0).h + 40);
      } else if (page === "shop") {
        const names = ["\u9996\u5145\u53CC\u500D", "\u7269\u8D44\u8865\u7ED9\u5305", "\u5929\u8D4B\u77F3\u793C\u5305"];
        const prices = ["\xA56", "\xA530", "\xA568"];
        const was = ["\xA512", "\xA545", "\xA598"];
        for (let i = 0; i < SHOP_CARDS; i++) {
          const r = shopCardRect(i);
          this.panel(r.x, r.y, r.w, r.h);
          ctx.strokeStyle = i === 0 ? col("gold_deep") : col("panel_stroke");
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel);
          ctx.stroke();
          ctx.fillStyle = col("gold_primary");
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + 140, 42, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = col("gold_deep");
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.arc(r.x + r.w / 2, r.y + 140, 30, 0, Math.PI * 2);
          ctx.stroke();
          this.iconCoin(r.x + r.w / 2 - 30, r.y + 110, 12);
          ctx.fillStyle = col("text_primary");
          ctx.font = font(T.typography.h2, { weight: "bold" });
          ctx.fillText(names[i], r.x + T.space.m, r.y + 280);
          ctx.fillStyle = col("text_secondary");
          ctx.font = font(T.typography.body);
          ctx.fillText(was[i], r.x + T.space.m, r.y + 340);
          const ww = ctx.measureText(was[i]).width;
          ctx.strokeStyle = col("danger");
          ctx.beginPath();
          ctx.moveTo(r.x + T.space.m, r.y + 340);
          ctx.lineTo(r.x + T.space.m + ww, r.y + 340);
          ctx.stroke();
          ctx.fillStyle = col("gold_primary");
          ctx.font = this.numFont(T.typography.h2);
          ctx.fillText(prices[i], r.x + T.space.m + ww + T.space.s, r.y + 340);
          if (i === 0) {
            ctx.fillStyle = col("alert_blood");
            ctx.beginPath();
            ctx.roundRect(r.x + r.w - 128, r.y + 24, 96, 40, T.radius.chip);
            ctx.fill();
            ctx.fillStyle = col("text_primary");
            ctx.font = font(T.typography.caption, { weight: "bold" });
            ctx.textAlign = "center";
            ctx.fillText("\u53CC\u500D", r.x + r.w - 80, r.y + 45);
            ctx.textAlign = "left";
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5360\u4F4D\uFF1ASKU \u8D70 iap_sku.json\uFF0CIAA/IAP \u5408\u89C4\u5BA1\u67E5\u540E\u63A5\u5165", T.space.l, shopCardRect(0).y + 600);
      } else {
        for (const [i, row] of SETTINGS_ROWS.entries()) {
          const r = settingsRowRect(i);
          this.panel(r.x, r.y, r.w, r.h, T.radius.btn);
          ctx.fillStyle = col("text_primary");
          ctx.font = font(T.typography.body);
          ctx.fillText(row.label, r.x + T.space.m, r.y + r.h / 2);
          if (row.key === "codex" || row.key === "shop") {
            ctx.fillStyle = col("gold_primary");
            ctx.beginPath();
            ctx.moveTo(r.x + r.w - T.space.l, r.y + r.h / 2 - 12);
            ctx.lineTo(r.x + r.w - T.space.l + 16, r.y + r.h / 2);
            ctx.lineTo(r.x + r.w - T.space.l, r.y + r.h / 2 + 12);
            ctx.closePath();
            ctx.fill();
          } else {
            const tw = 96;
            const tx = r.x + r.w - tw - T.space.m;
            ctx.beginPath();
            ctx.roundRect(tx, r.y + r.h / 2 - 24, tw, 48, 24);
            ctx.fillStyle = withAlpha(col("success"), 0.3);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(tx + tw - 24, r.y + r.h / 2, 18, 0, Math.PI * 2);
            ctx.fillStyle = col("success");
            ctx.fill();
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5B58\u6863\u4E09\u68C0\u67E5\u70B9\uFF1A\u65E5\u95F4/\u9EC4\u660F/\u591C\u6218\uFF08fail-safe \u6062\u590D\uFF09", T.space.l, settingsRowRect(SETTINGS_ROWS.length - 1).y + 128);
      }
      void now;
    }
  };
  function fpsReport(samples) {
    const min = samples.length ? Math.min(...samples) : 0;
    const avg = samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : 0;
    return { min, avg, budgetOk: min >= 50 };
  }

  // apps/client-cocos/whitebox/entry.ts
  var tables = {
    dayCurve: day_curve_default,
    constants: constants_default,
    buildingDef: building_def_default
  };
  var app = {
    tables,
    formula: createFormula({ dayCurve: tables.dayCurve, constants: loadConstants(tables.constants.entries) }),
    constants: loadConstants(tables.constants.entries),
    eventLib: event_lib_default,
    // JSON 宽类型收窄（type 字面量联合）
    monsters: monster_default
  };
  var kernel = createKernel({ appName: "nl-whitebox", clock: { logicalDay: () => 0, wallMs: () => Date.now() } });
  kernel.register([]);
  var boot = kernel.boot(buildBundle(app));
  var canvas = document.getElementById("stage");
  canvas.width = DESIGN_W;
  canvas.height = DESIGN_H;
  var renderer = new WhiteboxRenderer(canvas, {
    onFps(fps, min, avg) {
      const el = document.getElementById("fps");
      el.textContent = `FPS ${fps}\uFF08min ${min} / avg ${avg}\uFF09\u9884\u7B97${min >= 50 ? "\u8FBE\u6807" : "\u672A\u8FBE\u6807"}`;
      el.style.color = min >= 50 ? col("success") : col("danger");
    }
  });
  var frames = [];
  var idx = 0;
  var ui = createUiState();
  var SKILL_CD_MS = motion("normal").dur * 10;
  var NO_MODAL = new URLSearchParams(location.search).has("nomodal");
  var pb = {
    session: null,
    monsterNames: Object.fromEntries(monster_default.entries.map((m) => [m.id, m.name])),
    nightStart: null,
    settleStart: null,
    chosenAt: null,
    logs: [],
    forts: {},
    parties: [],
    wildReports: [],
    houseLevels: {},
    skills: [
      { label: "\u7A7A\u6295\u7269\u8D44", glyph: "\u{1F48A}", cdUntil: 0, fxUntil: 0, fxKind: "supply" },
      { label: "\u62A4\u76FE", glyph: "\u{1F6E1}", cdUntil: 0, fxUntil: 0, fxKind: "shield" },
      { label: "\u51B2\u51FB\u6CE2", glyph: "\u{1F4A5}", cdUntil: 0, fxUntil: 0, fxKind: "wave" }
    ]
  };
  function enterDay(d) {
    idx = d;
    ui.phase = "DAY";
    ui.page = "map";
    pb.chosenAt = null;
    const day = d + 1;
    const reports = resolveDue(world, sideState, wtables, app.constants, day);
    restoreStamina(world, sideState, app.constants);
    for (const rp of reports) {
      if (rp.loot.length > 0 || rp.encounters.length > 0) {
        pb.wildReports.push([
          ...rp.loot.map((l) => `${l.resource}+${l.amount}`),
          ...rp.encounters
        ]);
      }
    }
    syncParties();
    if (!NO_MODAL) for (const card of frames[d]?.eventCards ?? []) Object.assign(ui, pushEvent(ui, card));
  }
  function syncParties() {
    pb.parties = world.parties.map((p) => ({ zone: p.zone, size: p.members.length, returnsDay: p.returnsDay }));
  }
  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const now = performance.now();
    const modalOpen = topModal(ui) !== void 0;
    const hit = hitTest(x, y, { modalOpen, page: ui.page });
    switch (hit.kind) {
      case "pageBack":
        Object.assign(ui, setPage(ui, "main"));
        return;
      case "mapBack":
        Object.assign(ui, setPage(ui, "map"));
        return;
      case "interiorBack":
        Object.assign(ui, setPage(ui, "main"));
        return;
      case "fortSlot": {
        const key = `${ui.sel.floor ?? 0}:${ui.sel.room ?? 0}:${hit.index}`;
        pb.forts[key] = !pb.forts[key];
        return;
      }
      case "lot": {
        const lot = hit.id;
        if (lot === "lot_bld_a") Object.assign(ui, openBuilding(ui, lot));
        else if (lot === "lot_gate") Object.assign(ui, openModal(ui, { kind: "panel", id: "\u5C0F\u533A\u5927\u95E8\uFF08\u91CE\u5916 M3.3 \u5F00\u653E\uFF09" }));
        else Object.assign(ui, openModal(ui, { kind: "panel", id: lot === "lot_bld_b" ? "B\u680B" : lot === "lot_bld_c" ? "C\u680B" : lot }));
        return;
      }
      case "room":
        Object.assign(ui, openInterior(ui, hit.floor - 1, hit.room));
        return;
      case "explore":
        Object.assign(ui, setPage(ui, "wild"));
        return;
      case "house":
        Object.assign(ui, openModal(ui, { kind: "panel", id: `house:${hit.index}` }));
        return;
      case "house":
        Object.assign(ui, openModal(ui, { kind: "panel", id: `house:${hit.index}` }));
        return;
      case "wildBack":
        Object.assign(ui, setPage(ui, "map"));
        return;
      case "wildZone":
        ui.sel.wildZone = hit.zone;
        ui.sel.partySize = 1;
        return;
      case "partyMinus":
        ui.sel.partySize = Math.max(1, (ui.sel.partySize ?? 1) - 1);
        return;
      case "partyPlus":
        ui.sel.partySize = Math.min(3, (ui.sel.partySize ?? 1) + 1);
        return;
      case "wildDispatch": {
        const zone = ui.sel.wildZone;
        if (!zone) {
          Object.assign(ui, openModal(ui, { kind: "panel", id: "\u8BF7\u5148\u9009\u62E9\u76EE\u7684\u5730" }));
          return;
        }
        const size = ui.sel.partySize ?? 1;
        const day = idx + 1;
        const r = dispatchParty(world, sideState, wtables, app.constants, { zone, tenantIds: [1, 2, 3].slice(0, size), day });
        syncParties();
        Object.assign(ui, openModal(ui, {
          kind: "panel",
          id: r.ok ? `\u6D3E\u51FA\u6210\u529F\uFF1A${size} \u4EBA\u524D\u5F80${WILD_ZONE_NAME(zone)}${r.partyId !== void 0 ? `\uFF08\u961F\u4F0D#${r.partyId}\uFF09` : ""}` : `\u6D3E\u51FA\u5931\u8D25\uFF1A${r.reason ?? ""}`
        }));
        return;
      }
      case "nav":
        Object.assign(ui, setPage(ui, hit.page));
        return;
      case "modalClose": {
        const wasEvent = topModal(ui)?.kind === "event";
        Object.assign(ui, closeModal(ui));
        if (wasEvent) pb.chosenAt = null;
        return;
      }
      case "modalOption": {
        Object.assign(ui, { ...ui, eventQueue: [...ui.eventQueue.slice(0, -1), { ...topModal(ui), chosen: 0 }] });
        pb.chosenAt = now;
        return;
      }
      case "modalConfirm":
        if (topModal(ui)?.kind === "confirmNight") {
          Object.assign(ui, closeModal(ui));
          ui.phase = "DUSK_FORECAST";
        } else if (topModal(ui)?.id.startsWith("house:")) {
          const idx2 = Number(topModal(ui).id.split(":")[1]);
          const lv = Math.min(5, pb.houseLevels[idx2] ?? 0);
          if (lv >= 5) return;
          const cost = building_def_default.entries.find((e) => e.type === "house" && e.level === lv + 1)?.cost ?? {};
          const ops = Object.entries(cost).map(([k, n]) => k === "gold" ? { op: "ADD_GOLD", n: -n } : { op: "ADD_RES", res: k, n: -n });
          const r = applyEffects(sideState, ops, { constants: app.constants, buildingDef: tables.buildingDef });
          if (r.applied === ops.length) {
            pb.houseLevels[idx2] = lv + 1;
            Object.assign(ui, closeModal(ui));
          } else {
            Object.assign(ui, openModal(ui, { kind: "panel", id: "\u8D44\u6E90\u4E0D\u8DB3" }));
          }
        }
        return;
      case "modal":
        return;
      case "duskConfirm":
        if (ui.phase === "DUSK_FORECAST") {
          ui.phase = "NIGHT";
          pb.nightStart = now;
          pb.session = simSessions[idx + 1] ?? null;
          pb.logs = [];
        }
        return;
      case "skill":
        if (ui.phase === "NIGHT") {
          const sk = pb.skills[hit.index];
          if (sk && now >= sk.cdUntil) {
            sk.cdUntil = now + SKILL_CD_MS;
            sk.fxUntil = now + 1200;
            pb.logs.push(`\u4F7F\u7528\u4E3B\u52A8\u6280\u300C${sk.label}\u300D`);
          }
        }
        return;
      case "nightBack":
        if (ui.phase === "NIGHT" && pb.session && pb.nightStart !== null && nightWaves(pb.session.routes, pb.nightStart, now).done) {
          ui.phase = "DAWN_SETTLE";
          pb.settleStart = now;
          pb.logs = [];
        }
        return;
      case "settleContinue":
        if (ui.phase === "DAWN_SETTLE" && pb.settleStart !== null && now >= settleDoneAt(pb.settleStart, settleHouseholds())) {
          pb.settleStart = null;
          enterDay((idx + 1) % frames.length);
        }
        return;
      case "dock":
        if (hit.key === "night") Object.assign(ui, openModal(ui, { kind: "confirmNight", id: "night" }));
        else Object.assign(ui, openModal(ui, { kind: "panel", id: hit.key }));
        return;
      case "settings":
        Object.assign(ui, setPage(ui, "settings"));
        return;
      case "eventEntry": {
        const card = frames[idx]?.eventCards[0];
        if (card) Object.assign(ui, openModal(ui, { kind: "event", id: card.id, card }));
        return;
      }
      default:
        return;
    }
  });
  function settleHouseholds() {
    const f = frames[idx];
    return f ? Math.min(f.population, f.roomsBuilt) : 0;
  }
  var simSessions = {};
  var wtables = {
    mapDef: map_def_default,
    exploreDef: explore_def_default,
    gatherTable: gather_table_default,
    wildlife: wildlife_default,
    buildingDef: building_def_default
  };
  var sideState = createGameState(42);
  var world = createWorldState(42, wtables);
  var fontsReady = Promise.all([
    document.fonts.load('bold 24px "SourceHanSansCN-Bold"', "\u6C38\u591C\u6536\u79DF\u4EBA\u65E5\u6B21\u5E03\u9632\u62DB\u52DF\u5347\u7EA7\u8840\u6708\u591C\u6218"),
    document.fonts.load('32px "BebasNeue"', "0123456789D+%.")
  ]).catch(() => void 0);
  boot.then(async () => {
    const sim = runSimulation(app, kernel, { days: 30, seed: 42 });
    simSessions = sim.sessions;
    frames = sim.records.map((r) => ({
      day: r.day,
      population: r.population,
      roomsBuilt: r.roomsBuilt,
      gold: r.gold,
      income: r.income,
      power: r.power,
      rAvg: r.rAvg,
      deaths: r.deaths,
      wounds: r.wounds,
      sessionHash: r.sessionHash,
      modifiers: r.modifiers,
      avgLevel: r.avgLevel,
      panicSum: r.panicSum,
      // 表现层投影：破防房间（r<0.95）与今日事件（weight 高在前，完整元数据供事件卡模板）
      breachedRooms: (sim.sessions[r.day]?.routes ?? []).filter((rt) => rt.r < 0.95).map((rt) => rt.roomId),
      eventCards: [...sim.eventCards[r.day] ?? []].sort((a, b) => b.weight - a.weight),
      weather: weatherOfDay(r.day, 42, { weather: weather_default }).id
    }));
    const want = new URLSearchParams(location.search).get("phase");
    const wantPage = new URLSearchParams(location.search).get("page");
    const wantDay = Number(new URLSearchParams(location.search).get("day") ?? "0");
    await fontsReady;
    renderer.start(
      () => {
        const f = frames[idx];
        if (!f) return null;
        const now = performance.now();
        const top = topModal(ui);
        if (top?.kind === "event" && top.chosen !== void 0 && pb.chosenAt !== null && now - pb.chosenAt > motion("normal").dur + motion("rain").dur + motion("fast").dur) {
          Object.assign(ui, closeModal(ui));
          pb.chosenAt = null;
        }
        return f;
      },
      () => ui,
      () => pb
    );
    globalThis.__fpsReport = () => fpsReport(renderer.getSamples());
    if (want === "dusk") {
      idx = 6;
      ui.phase = "DUSK_FORECAST";
    } else if (want === "night") {
      idx = 6;
      ui.phase = "NIGHT";
      pb.nightStart = performance.now();
      pb.session = simSessions[7] ?? null;
    } else if (want === "dawn") {
      idx = 6;
      ui.phase = "DAWN_SETTLE";
      pb.settleStart = performance.now();
    } else enterDay(0);
    if (wantDay >= 1 && wantDay <= frames.length) enterDay(wantDay - 1);
    if (wantPage) ui.page = wantPage;
    const wantModal = new URLSearchParams(location.search).get("modal");
    if (wantModal === "night") Object.assign(ui, openModal(ui, { kind: "confirmNight", id: "night" }));
    else if (wantModal) Object.assign(ui, openModal(ui, { kind: "panel", id: wantModal }));
    console.log(`\u767D\u76D2\u64AD\u653E\u5C31\u7EEA\uFF1A${frames.length} \u5929\uFF0C\u4E8B\u4EF6 ${sim.eventsFired} \u6B21\uFF0C\u72EC\u7ACB ${sim.distinctFired.length}`);
  });
})();
