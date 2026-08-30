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
              const candidates = app2.monsters.entries.filter((m) => m.active && m.unlockDay <= day && (m.usableNightMods.includes("NORMAL") || m.usableNightMods.some((x) => modifiers.includes(x))));
              const routes = Array.from({ length: row.routes }, (_, i) => {
                const m = candidates.length ? candidates[Math.floor(rng.next() * candidates.length)] : void 0;
                return { roomId: pool[Math.floor(rng.next() * pool.length)], hp: row.hp, monsterId: m?.id ?? "m_seeker" };
              });
              return { day, routes, modifiers, seed: rng.next() };
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
    const { tables: tables2, constants } = app2;
    const formula = kernel2.service("formula");
    const director = kernel2.service("director");
    const battle = kernel2.service("battle");
    const persistence = kernel2.service("persistence");
    const state = kernel2.service("game").createState(options.seed);
    const rng = createRngStreams(options.seed);
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
        wealth: state.resources.gold + state.resources.food + state.resources.material
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
    return { records, finalHash, findings, sessions, eventsFired, distinctFired: [...distinctFired], eventCounts, eventCards, stabilizer };
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
      }
    ]
  };

  // config/building_def.json
  var building_def_default = {
    version: 1,
    sourceDoc: "docs/\u6570\u636E\u914D\u7F6E\u8868\u7ED3\u6784\u8BBE\u8BA1.md \xA77\uFF08\u516C\u5171\u5EFA\u7B51\uFF1A\u8BBE\u8BA1\u65B9\u6848 4.1\uFF09",
    entries: [
      { type: "room", level: 1, cost: { gold: 300 }, slots: { tenant: 1, fort: 2 }, unlockDay: 0 },
      { type: "canteen", level: 1, cost: { gold: 0 }, capacity: 10 },
      { type: "canteen", level: 2, cost: { gold: 500 }, capacity: 14 },
      { type: "canteen", level: 3, cost: { gold: 1e3 }, capacity: 18 },
      { type: "canteen", level: 4, cost: { gold: 2500 }, capacity: 24 },
      { type: "canteen", level: 5, cost: { gold: 5e3 }, capacity: 30 },
      { type: "warehouse", level: 1, cost: { gold: 0 }, capacity: 5e3 },
      { type: "warehouse", level: 2, cost: { gold: 800 }, capacity: 12e3 },
      { type: "warehouse", level: 3, cost: { gold: 2500 }, capacity: 3e4 },
      { type: "broadcast", level: 1, cost: { gold: 600 }, unlockDay: 2 },
      { type: "broadcast", level: 2, cost: { gold: 1800 }, unlockDay: 8 },
      { type: "watchtower", level: 1, cost: { gold: 0 }, capacity: 1 },
      { type: "watchtower", level: 2, cost: { gold: 400 }, capacity: 2 },
      { type: "watchtower", level: 3, cost: { gold: 1200 }, capacity: 3 },
      { type: "clinic", level: 1, cost: { gold: 800 } },
      { type: "hall", level: 1, cost: { gold: 800 } },
      { type: "workshop", level: 1, cost: { gold: 800 } }
    ]
  };

  // config/event_lib.json
  var event_lib_default = {
    version: 2,
    sourceDoc: "docs/M0-\u4E8B\u4EF6\u6587\u6848\u5E9350\u6761.md",
    scope: "M2\uFF1A50 \u6761\u5168\u91CF\uFF08scripted 8 / choice 24 / mission 10 / ord 8\uFF09",
    entries: [
      { id: "evt_tut_fortify", ver: 1, type: "scripted", triggerDay: 0, title: "\u95E8\u53E3\u7684\u6293\u75D5", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u95E8\u677F\u4E0A\u6709\u65B0\u9C9C\u7684\u6293\u75D5\u2026\u2026\u8D81\u5929\u8FD8\u6CA1\u9ED1\uFF0C\u52A0\u56FA\u5B83\u3002", options: [{ label: "\u52A0\u56FA\u95E8\uFF08\u6559\u5B66\u5F15\u5BFC\uFF09", outcomes: [{ p: 1, text: "\u95E8\u677F\u5431\u5440\u4F5C\u54CD\uFF0C\u4F46\u7ED3\u5B9E\u4E86\u3002", effects: [] }] }] },
      { id: "evt_tut_firstnight", ver: 1, type: "scripted", triggerDay: 0, title: "\u7B2C 1 \u591C\u52A8\u5458", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u5165\u591C\u524D\uFF0C\u628A\u6709\u9650\u7684\u4EBA\u624B\u5E03\u5230\u6700\u53EF\u80FD\u6709\u95EE\u9898\u7684\u4F4D\u7F6E\u3002", options: [{ label: "\u5E03\u9632\u5F15\u5BFC", outcomes: [{ p: 1, text: "\u591C\u8272\u538B\u4E0B\u6765\uFF0C\u697C\u91CC\u5B89\u9759\u5F97\u80FD\u542C\u89C1\u5FC3\u8DF3\u3002", effects: [] }] }] },
      { id: "evt_tut_rescue", ver: 1, type: "scripted", triggerDay: 1, title: "\u9694\u58C1\u7684\u547C\u6551", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u300C\u6551\u547D\u2014\u2014\u8FD8\u6709\u4EBA\u5417\uFF01\u300D", options: [{ label: "\u6D3E\u4E3B\u89D2\u53BB\u6551", outcomes: [{ p: 1, text: "\u62D6\u56DE\u6765\u4E00\u4E2A\u6D51\u8EAB\u53D1\u6296\u7684\u5E78\u5B58\u8005\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }] }] }] },
      { id: "evt_tut_referral", ver: 1, type: "scripted", triggerDay: 2, title: "\u8001\u5F20\u8BF4\uFF1A\u6211\u8FD8\u6709\u4FE9\u90BB\u5C45", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u300C\u4ED6\u4EEC\u4EBA\u4E0D\u9519\uFF0C\u5C31\u5728\u4E0B\u4E00\u6761\u8857\u3002\u300D", options: [{ label: "\u63A5\u5F15", outcomes: [{ p: 1, text: "\u4E00\u8001\u4E00\u5C11\uFF0C\u884C\u674E\u90FD\u6CA1\u4E22\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }, { op: "SPAWN_TENANT", quality: "N" }] }] }] },
      { id: "evt_tut_broadcast", ver: 1, type: "scripted", triggerDay: 2, title: "\u5E7F\u64AD\u7AD9\u7B2C\u4E00\u901A\u5E7F\u64AD", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u300C\u8FD9\u91CC\u662F 7 \u53F7\u697C\uFF0C\u6211\u4EEC\u6536\u7559\u6D3B\u4EBA\u3002\u300D", options: [{ label: "\u62DB\u52DF", outcomes: [{ p: 1, text: "\u5F53\u5929\u4E0B\u5348\uFF0C\u95E8\u53E3\u6392\u8D77\u4E86\u961F\u3002", effects: [{ op: "ADD_RES", res: "food", n: -100 }, { op: "SPAWN_TENANT", quality: "N" }, { op: "SPAWN_TENANT", quality: "N" }] }] }] },
      { id: "evt_tut_bills", ver: 1, type: "scripted", triggerDay: 3, title: "\u7B2C\u4E00\u7B14\u300C\u7269\u4E1A\u8D39\u300D", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u4F4F\u8FDB\u6765\u53EF\u4EE5\uFF0C\u4F46\u89C4\u77E9\u5F97\u7ACB\uFF1A\u6309\u5929\u4EA4\u79DF\u3002", options: [{ label: "\u6536\u79DF", outcomes: [{ p: 1, text: "\u91D1\u5E01\u5165\u888B\u7684\u58F0\u97F3\uFF0C\u6BD4\u67AA\u58F0\u597D\u542C\u3002", effects: [{ op: "ADD_GOLD", n: 300 }] }] }] },
      { id: "evt_tut_panic", ver: 1, type: "scripted", triggerDay: 5, title: "\u6709\u4EBA\u534A\u591C\u5077\u54ED", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u6050\u614C\u50CF\u9709\u6591\uFF0C\u4F1A\u987A\u7740\u697C\u677F\u8513\u5EF6\u3002", options: [{ label: "\u9010\u6237\u5B89\u629A", outcomes: [{ p: 1, text: "\u54ED\u58F0\u505C\u4E86\u3002\u4EBA\u5FC3\uFF0C\u4E5F\u662F\u8981\u4FEE\u7684\u3002", effects: [{ op: "ADD_PANIC", n: -10 }, { op: "SET_FLAG", key: "orderIntro", v: 1 }] }] }] },
      { id: "evt_tut_omen", ver: 1, type: "scripted", triggerDay: 6, title: "\u98CE\u5411\u4E0D\u5BF9", weight: 0, cooldownDays: 0, maxPerRun: 0, text: "\u72D7\u4E0D\u53EB\u4E86\u3002\u98CE\u91CC\u6709\u94C1\u9508\u5473\u3002", options: [{ label: "\u767B\u9AD8\u89C2\u661F", outcomes: [{ p: 1, text: "\u6708\u4EAE\u662F\u7EA2\u7684\u3002\u660E\u5929\uFF0C\u662F\u8840\u6708\u3002", effects: [{ op: "SET_FLAG", key: "bloodmoonForetold", v: 1 }] }] }] },
      { id: "evt_knock_001", ver: 1, type: "choice", title: "\u6DF1\u591C\u6572\u95E8\u4EBA", weight: 100, cooldownDays: 5, maxPerRun: 2, prereq: { dayMin: 3 }, text: "\u300C\u549A\u3001\u549A\u3001\u549A\u3002\u300D\u6DF1\u591C\u7684\u6572\u95E8\u58F0\u6BD4\u602A\u7269\u7684\u568E\u53EB\u66F4\u7606\u4EBA\u3002", options: [
        { label: "\u5F00\u95E8", outcomes: [{ p: 0.7, text: "\u662F\u4E00\u5BB6\u4E09\u53E3\uFF0C\u5F53\u5BB6\u7684\u8FD8\u61C2\u6C34\u7535\u3002", effects: [{ op: "SPAWN_TENANT", quality: "R" }] }, { p: 0.3, text: "\u5B83\u7684\u76AE\u80A4\u5728\u6708\u5149\u4E0B\u5265\u843D\u4E86\u2026\u2026", effects: [{ op: "NIGHT_MOD", mod: "SILENT" }] }] },
        { label: "\u9694\u95E8\u8BE2\u95EE", outcomes: [{ p: 1, text: "\u5BF9\u8BDD\u51E0\u53E5\u540E\u811A\u6B65\u58F0\u8FDC\u53BB\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u65E0\u89C6", outcomes: [{ p: 1, text: "\u6572\u95E8\u58F0\u505C\u4E86\u3002\u4F60\u6709\u70B9\u540E\u6094\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_grain_002", ver: 1, type: "choice", title: "\u90BB\u5C45\u5077\u7CAE", weight: 90, cooldownDays: 7, maxPerRun: 2, prereq: { dayMin: 3 }, text: "\u4ED3\u5E93\u5C11\u4E86\u4E24\u7BB1\u7F50\u5934\uFF0C\u6709\u4EBA\u770B\u89C1\u4E09\u697C\u7684\u738B\u78CA\u6628\u665A\u9B3C\u9B3C\u795F\u795F\u3002", options: [
        { label: "\u516C\u5BA1", outcomes: [{ p: 1, text: "\u79E9\u5E8F\u7ACB\u4F4F\u4E86\uFF0C\u4F46\u4EBA\u5FC3\u60F6\u60F6\u3002", effects: [{ op: "ADD_PANIC", n: 8 }, { op: "SET_FLAG", key: "order", v: 1 }] }] },
        { label: "\u79C1\u4E86", outcomes: [{ p: 1, text: "\u4ED6\u4EA4\u56DE\u4E86\u4E00\u90E8\u5206\uFF0C\u8FD9\u4E8B\u7FFB\u7BC7\u3002", effects: [{ op: "ADD_RES", res: "food", n: 100 }] }] },
        { label: "\u653E\u4EFB", outcomes: [{ p: 1, text: "\u4ED3\u5E93\u7684\u9501\u5F62\u540C\u865A\u8BBE\u3002", effects: [{ op: "ADD_PANIC", n: 5 }, { op: "SET_FLAG", key: "order", v: -1 }] }] }
      ] },
      { id: "evt_box_003", ver: 1, type: "choice", title: "\u9633\u53F0\u7269\u8D44\u7BB1", weight: 85, cooldownDays: 5, maxPerRun: 2, prereq: {}, text: "\u516D\u697C\u9633\u53F0\u540A\u4E0B\u6765\u4E00\u4E2A\u5BC6\u5C01\u7BB1\uFF0C\u7EF3\u5B50\u4E0A\u7CFB\u7740\u5B57\u6761\uFF1A\u300C\u7ED9\u6709\u7F18\u4EBA\u300D\u3002", options: [
        { label: "\u72EC\u5360", outcomes: [{ p: 1, text: "\u7F50\u5934\u4E0E\u51C0\u6C34\uFF0C\u5168\u6536\u3002", effects: [{ op: "ADD_RES", res: "food", n: 300 }, { op: "SET_FLAG", key: "reputation", v: -1 }] }] },
        { label: "\u5E73\u5206", outcomes: [{ p: 1, text: "\u6309\u6237\u5206\u53D1\uFF0C\u697C\u91CC\u591A\u4E86\u4E9B\u6696\u610F\u3002", effects: [{ op: "ADD_PANIC", n: -5 }, { op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u6362\u60C5\u62A5", outcomes: [{ p: 1, text: "\u5BF9\u9762\u697C\u7684\u773C\u7EBF\u7ED9\u4E86\u4EFD\u5DE1\u903B\u56FE\u3002", effects: [{ op: "SET_FLAG", key: "intel", v: 1 }] }] }
      ] },
      { id: "evt_rent_004", ver: 1, type: "choice", title: "\u8001\u5468\u6B20\u79DF", weight: 80, cooldownDays: 7, maxPerRun: 2, prereq: { dayMin: 5 }, text: "\u8001\u5468\u8E72\u5728\u95E8\u53E3\u62BD\u70DF\uFF1A\u300C\u5AB3\u5987\u75C5\u7740\uFF0C\u8FD9\u4E2A\u6708\u2026\u2026\u5BBD\u9650\u51E0\u5929\uFF1F\u300D", options: [
        { label: "\u514D\u79DF", outcomes: [{ p: 1, text: "\u8001\u5468\u7EA2\u7740\u773C\u7736\u8FDE\u58F0\u9053\u8C22\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }, { op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u7167\u6536", outcomes: [{ p: 1, text: "\u89C4\u77E9\u5C31\u662F\u89C4\u77E9\u3002", effects: [{ op: "ADD_GOLD", n: 500 }] }] },
        { label: "\u9A71\u8D76", outcomes: [{ p: 1, text: "\u884C\u674E\u88AB\u6254\u4E0B\u697C\uFF0C\u697C\u91CC\u6CA1\u4EBA\u8BF4\u8BDD\u3002", effects: [{ op: "ADD_GOLD", n: 200 }, { op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_hoard_005", ver: 1, type: "choice", title: "\u56E4\u79EF\u8005\u8001\u674E", weight: 70, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 6 }, text: "\u8001\u674E\u5C4B\u91CC\u5806\u6EE1\u4E86\u7269\u8D44\uFF0C\u697C\u4E0B\u5374\u6709\u4EBA\u5728\u6328\u997F\u3002", options: [
        { label: "\u5F81\u7528", outcomes: [{ p: 1, text: "\u7269\u8D44\u5145\u516C\uFF0C\u8001\u674E\u7EDD\u98DF\u6297\u8BAE\u3002", effects: [{ op: "ADD_RES", res: "food", n: 400 }, { op: "ADD_PANIC", n: 8 }] }] },
        { label: "\u5206\u6210", outcomes: [{ p: 1, text: "\u5404\u8BA9\u4E00\u6B65\uFF0C\u4ED3\u5E93\u8FDB\u8D26\u4E00\u534A\u3002", effects: [{ op: "ADD_RES", res: "food", n: 200 }] }] },
        { label: "\u653E\u4EFB", outcomes: [{ p: 1, text: "\u79E9\u5E8F\u54E8\u58F0\u5728\u8D70\u5ECA\u56DE\u8361\u3002", effects: [{ op: "SET_FLAG", key: "order", v: -1 }] }] }
      ] },
      { id: "evt_dog_006", ver: 1, type: "choice", title: "\u51CC\u6668\u7684\u72D7\u5420", weight: 65, cooldownDays: 7, maxPerRun: 2, prereq: {}, text: "\u5DF7\u5B50\u91CC\u6709\u6761\u571F\u72D7\uFF0C\u53EB\u6CD5\u5F88\u6709\u89C4\u5F8B\u2014\u2014\u50CF\u5728\u62A5\u4FE1\u3002", options: [
        { label: "\u6536\u7559", outcomes: [{ p: 1, text: "\u72D7\u62F4\u5728\u4E00\u5C42\u5927\u5385\uFF0C\u591C\u91CC\u8033\u6735\u6BD4\u4EBA\u7075\u3002", effects: [{ op: "GRANT_BUFF", buff: "warnDog", days: 3 }] }] },
        { label: "\u9A71\u8D76", outcomes: [{ p: 1, text: "\u72D7\u8DD1\u4E86\uFF0C\u591C\u91CC\u9759\u5F97\u53D1\u614C\u3002", effects: [{ op: "ADD_PANIC", n: 5 }] }] },
        { label: "\u65E0\u89C6", outcomes: [{ p: 1, text: "\u72D7\u53EB\u4E86\u4E00\u6574\u591C\u3002", effects: [{ op: "ADD_PANIC", n: 3 }] }] }
      ] },
      { id: "evt_generator_007", ver: 1, type: "choice", title: "\u67F4\u6CB9\u53D1\u7535\u673A", weight: 70, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 5 }, text: "\u9694\u58C1\u697C\u6361\u6765\u4E00\u53F0\u67F4\u6CB9\u53D1\u7535\u673A\uFF0C\u5F00\u53E3\u5C31\u8981\u5206\u7740\u7528\u3002", options: [
        { label: "\u5C0F\u533A\u5171\u7528", outcomes: [{ p: 1, text: "\u5168\u697C\u706F\u706B\u901A\u660E\uFF0C\u6050\u614C\u6D88\u6563\u4E0D\u5C11\u3002", effects: [{ op: "ADD_GOLD", n: -300 }, { op: "ADD_PANIC", n: -8 }] }] },
        { label: "\u81EA\u5BB6\u5907\u7528", outcomes: [{ p: 1, text: "\u53D1\u7535\u673A\u9501\u8FDB\u4E86\u4F60\u5BB6\u50A8\u7269\u95F4\u3002", effects: [{ op: "GRANT_BUFF", buff: "power", days: 2 }] }] },
        { label: "\u51FA\u79DF", outcomes: [{ p: 1, text: "\u6309\u5C0F\u65F6\u8BA1\u8D39\uFF0C\u751F\u610F\u5174\u9686\u3002", effects: [{ op: "ADD_GOLD", n: 400 }] }] }
      ] },
      { id: "evt_divorce_008", ver: 1, type: "choice", title: "\u4E8C\u697C\u592B\u59BB\u5435\u67B6", weight: 60, cooldownDays: 10, maxPerRun: 2, prereq: {}, text: "\u6454\u7897\u58F0\u9694\u7740\u697C\u677F\u90FD\u80FD\u542C\u89C1\u3002", options: [
        { label: "\u4E0A\u95E8\u8C03\u89E3", outcomes: [{ p: 1, text: "\u4E24\u53E3\u5B50\u548C\u597D\uFF0C\u8FD8\u786C\u585E\u4E86\u4E24\u6761\u70DF\u3002", effects: [{ op: "ADD_PANIC", n: -5 }, { op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u4E0D\u63BA\u548C", outcomes: [{ p: 1, text: "\u5435\u5427\uFF0C\u65E5\u5B50\u8FD8\u957F\u3002", effects: [{ op: "ADD_PANIC", n: 3 }] }] },
        { label: "\u8D81\u673A\u6536\u623F", outcomes: [{ p: 1, text: "\u623F\u5B50\u5230\u624B\uFF0C\u4F46\u4F60\u6210\u4E86\u697C\u91CC\u7684\u8C08\u8D44\u3002", effects: [{ op: "ADD_GOLD", n: 600 }, { op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_slingshot_009", ver: 1, type: "choice", title: "\u5B69\u5B50\u7684\u5F39\u5F13", weight: 55, cooldownDays: 10, maxPerRun: 2, prereq: {}, text: "\u4E94\u697C\u7684\u5B69\u5B50\u62FF\u5F39\u5F13\u6253\u8DEF\u706F\uFF0C\u788E\u77F3\u4E71\u98DE\u3002", options: [
        { label: "\u6CA1\u6536", outcomes: [{ p: 1, text: "\u5B69\u5B50\u54ED\u4E86\u534A\u5929\uFF0C\u5BB6\u957F\u8138\u8272\u96BE\u770B\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: -1 }] }] },
        { label: "\u6559\u5BFC", outcomes: [{ p: 1, text: "\u5B69\u5B50\u6210\u4E86\u697C\u9876\u7684\u77AD\u671B\u54E8\u3002", effects: [{ op: "GRANT_BUFF", buff: "sentryKid", days: 3 }] }] },
        { label: "\u653E\u4EFB", outcomes: [{ p: 1, text: "\u73BB\u7483\u53C8\u788E\u4E86\u4E00\u5757\u3002", effects: [{ op: "ADD_PANIC", n: 5 }] }] }
      ] },
      { id: "evt_medicine_010", ver: 1, type: "choice", title: "\u6700\u540E\u4E00\u6279\u6297\u751F\u7D20", weight: 75, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 6 }, text: "\u533B\u52A1\u5BA4\u53EA\u5269\u6700\u540E\u4E00\u677F\u6297\u751F\u7D20\uFF0C\u4E09\u4E2A\u4EBA\u5728\u6392\u961F\u3002", options: [
        { label: "\u91CD\u60A3\u5148\u5F97", outcomes: [{ p: 1, text: "\u8BE5\u6551\u7684\u6551\u4E86\uFF0C\u4EBA\u5FC3\u5B89\u7A33\u3002", effects: [{ op: "ADD_PANIC", n: -5 }] }] },
        { label: "\u8D21\u732E\u8005\u5148\u5F97", outcomes: [{ p: 1, text: "\u591A\u52B3\u591A\u5F97\uFF0C\u7AD9\u5C97\u7684\u52B2\u5934\u66F4\u8DB3\u4E86\u3002", effects: [{ op: "GRANT_BUFF", buff: "contrib", days: 3 }] }] },
        { label: "\u62BD\u7B7E", outcomes: [{ p: 1, text: "\u547D\u8FD0\u9762\u524D\u4EBA\u4EBA\u5E73\u7B49\uFF0C\u60C5\u7EEA\u610F\u5916\u5E73\u7A33\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] }
      ] },
      { id: "evt_rumor_011", ver: 1, type: "choice", title: "\u300C\u660E\u5929\u602A\u4E0D\u6765\u4E86\u300D", weight: 70, cooldownDays: 7, maxPerRun: 2, prereq: {}, text: "\u4E0D\u77E5\u9053\u8C01\u4F20\u7684\uFF1A\u6C38\u591C\u8981\u7ED3\u675F\u4E86\uFF0C\u602A\u7269\u660E\u5929\u5C31\u4E0D\u6765\u4E86\u3002", options: [
        { label: "\u8F9F\u8C23", outcomes: [{ p: 1, text: "\u5927\u5587\u53ED\u5E7F\u64AD\u4E86\u4E09\u904D\uFF0C\u8C23\u8A00\u6B62\u4F4F\u3002", effects: [{ op: "ADD_PANIC", n: -6 }] }] },
        { label: "\u5229\u7528", outcomes: [{ p: 1, text: "\u300C\u672B\u65E5\u4FDD\u9669\u300D\u5356\u5F97\u98DE\u8D77\u3002", effects: [{ op: "ADD_GOLD", n: 300 }, { op: "SET_FLAG", key: "trust", v: -1 }] }] },
        { label: "\u65E0\u89C6", outcomes: [{ p: 1, text: "\u6709\u4EBA\u771F\u7684\u4E0D\u8BBE\u9632\u4E86\u3002", effects: [{ op: "ADD_PANIC", n: 4 }] }] }
      ] },
      { id: "evt_note_012", ver: 1, type: "choice", title: "\u95E8\u7F1D\u91CC\u7684\u7EB8\u6761", weight: 65, cooldownDays: 7, maxPerRun: 2, prereq: { dayMin: 4 }, text: "\u7EB8\u6761\u4E0A\u753B\u7740\u4E00\u4E2A\u7BAD\u5934\uFF0C\u6307\u5411\u5730\u4E0B\u5BA4\u7684\u901A\u98CE\u4E95\u3002", options: [
        { label: "\u6309\u7EB8\u6761\u8D74\u7EA6", outcomes: [{ p: 0.5, text: "\u662F\u4E2A\u8EB2\u4E86\u534A\u6708\u7684\u59D1\u5A18\uFF0C\u624B\u4E0A\u529F\u592B\u4E0D\u9519\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }] }, { p: 0.5, text: "\u901A\u98CE\u4E95\u91CC\u53EA\u6709\u6293\u75D5\u548C\u8840\u8FF9\u3002", effects: [{ op: "WOUND_TENANT", tenantId: -1 }] }] },
        { label: "\u7F6E\u4E4B\u4E0D\u7406", outcomes: [{ p: 1, text: "\u7EB8\u6761\u5728\u95E8\u7F1D\u91CC\u53D1\u9EC4\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] },
        { label: "\u70E7\u6389", outcomes: [{ p: 1, text: "\u7701\u5F97\u591C\u91CC\u80E1\u601D\u4E71\u60F3\u3002", effects: [{ op: "ADD_PANIC", n: 2 }] }] }
      ] },
      { id: "evt_birthday_013", ver: 1, type: "choice", title: "\u697C\u91CC\u7B2C\u4E00\u4E2A\u751F\u65E5", weight: 60, cooldownDays: 14, maxPerRun: 2, prereq: {}, text: "\u4ECA\u5929\u662F\u5C0F\u96E8\u7684\u516B\u5C81\u751F\u65E5\uFF0C\u86CB\u7CD5\u662F\u4E0D\u53EF\u80FD\u7684\u3002", options: [
        { label: "\u529E\u6D3E\u5BF9", outcomes: [{ p: 1, text: "\u642A\u74F7\u7F38\u78B0\u5728\u4E00\u8D77\uFF0C\u50CF\u8FC7\u5E74\u7684\u58F0\u97F3\u3002", effects: [{ op: "ADD_RES", res: "food", n: -200 }, { op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u53D6\u6D88", outcomes: [{ p: 1, text: "\u5B69\u5B50\u6CA1\u54ED\uFF0C\u5927\u4EBA\u5FC3\u91CC\u4E0D\u662F\u6ECB\u5473\u3002", effects: [{ op: "ADD_PANIC", n: 3 }] }] },
        { label: "\u53CC\u4EFD\u53E3\u7CAE", outcomes: [{ p: 1, text: "\u5168\u697C\u90FD\u8DDF\u7740\u6CBE\u4E86\u5149\u3002", effects: [{ op: "ADD_RES", res: "food", n: -300 }, { op: "ADD_PANIC", n: -5 }] }] }
      ] },
      { id: "evt_thief_014", ver: 1, type: "choice", title: "\u5916\u697C\u7684\u7A83\u8D3C", weight: 65, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 5 }, text: "\u5DE1\u903B\u961F\u902E\u4E86\u4E2A\u73B0\u5F62\uFF0C\u4EBA\u8D43\u5E76\u83B7\u3002", options: [
        { label: "\u516C\u5BA1", outcomes: [{ p: 1, text: "\u79E9\u5E8F\u7ACB\u5A01\uFF0C\u56F4\u89C2\u8005\u5664\u58F0\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }, { op: "ADD_PANIC", n: 4 }] }] },
        { label: "\u6536\u7F16", outcomes: [{ p: 0.4, text: "\u5F00\u9501\u7684\u624B\u827A\u786E\u5B9E\u6709\u7528\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }] }, { p: 0.6, text: "\u7B2C\u4E8C\u665A\uFF0C\u4ED3\u5E93\u7684\u9501\u88AB\u4ECE\u91CC\u9762\u6253\u5F00\u4E86\u3002", effects: [{ op: "ADD_RES", res: "food", n: -200 }] }] },
        { label: "\u653E\u8D70\u6362\u60C5\u62A5", outcomes: [{ p: 1, text: "\u4ED6\u753B\u4E86\u5F20\u602A\u7269\u7684\u6D3B\u52A8\u56FE\u3002", effects: [{ op: "SET_FLAG", key: "intel", v: 1 }] }] }
      ] },
      { id: "evt_rat_015", ver: 1, type: "choice", title: "\u4ED3\u5E93\u9F20\u60A3", weight: 60, cooldownDays: 10, maxPerRun: 2, prereq: {}, text: "\u9EBB\u888B\u4E0A\u5168\u662F\u9F7F\u5370\uFF0C\u7CAE\u4ED3\u6210\u4E86\u9F20\u7A9D\u3002", options: [
        { label: "\u517B\u732B", outcomes: [{ p: 1, text: "\u5DF7\u5B50\u91CC\u8BA8\u6765\u4E00\u53EA\u72F8\u82B1\uFF0C\u9F20\u60A3\u6E10\u6D88\u3002", effects: [{ op: "ADD_RES", res: "food", n: -100 }, { op: "GRANT_BUFF", buff: "cat", days: 7 }] }] },
        { label: "\u6295\u836F", outcomes: [{ p: 1, text: "\u6B7B\u8001\u9F20\u6E05\u7406\u4E86\u4E00\u7C38\u7B95\uFF0C\u4E5F\u8BEF\u4F24\u4E86\u4E24\u888B\u7C73\u3002", effects: [{ op: "ADD_RES", res: "food", n: -300 }] }] },
        { label: "\u6539\u9020\u8D27\u67B6", outcomes: [{ p: 1, text: "\u5EFA\u6750\u53C8\u82B1\u4E86\u4E00\u7B14\uFF0C\u4F46\u4E00\u52B3\u6C38\u9038\u3002", effects: [{ op: "ADD_RES", res: "material", n: -250 }] }] }
      ] },
      { id: "evt_radio_016", ver: 1, type: "choice", title: "\u5916\u754C\u7684\u5E7F\u64AD", weight: 60, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 7 }, text: "\u7535\u53F0\u91CC\u5FAA\u73AF\u64AD\u653E\u7740\u64A4\u79BB\u70B9\u7684\u5750\u6807\uFF0C\u771F\u5047\u96BE\u8FA8\u3002", options: [
        { label: "\u56DE\u5E94", outcomes: [{ p: 1, text: "Morse \u7801\u56DE\u4E86\u4E09\u77ED\u4E09\u957F\uFF0C\u697C\u91CC\u58EB\u6C14\u4E00\u632F\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u4FDD\u6301\u9759\u9ED8", outcomes: [{ p: 1, text: "\u67AA\u6253\u51FA\u5934\u9E1F\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }] }] },
        { label: "\u4F2A\u9020\u56DE\u5E94", outcomes: [{ p: 1, text: "\u9A97\u5230\u4E86\u4E00\u6279\u7A7A\u6295\u7269\u8D44\uFF0C\u4F46\u6709\u4EBA\u8D77\u4E86\u7591\u5FC3\u3002", effects: [{ op: "ADD_GOLD", n: 500 }, { op: "SET_FLAG", key: "trust", v: -1 }] }] }
      ] },
      { id: "evt_deadbeat_017", ver: 1, type: "choice", title: "\u62D2\u79DF\u7684\u523A\u5934", weight: 70, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 6 }, text: "\u56DB\u697C\u7684\u523A\u5934\u628A\u623F\u79DF\u62CD\u5728\u5730\u4E0A\uFF1A\u300C\u7231\u8981\u4E0D\u8981\u3002\u300D", options: [
        { label: "\u5BBD\u9650", outcomes: [{ p: 1, text: "\u4ED6\u53CD\u800C\u4E0D\u597D\u610F\u601D\u4E86\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u65AD\u4F9B", outcomes: [{ p: 1, text: "\u7B2C\u4E09\u5929\uFF0C\u91D1\u5E01\u548C\u9053\u6B49\u4E00\u8D77\u9001\u6765\u3002", effects: [{ op: "ADD_GOLD", n: 800 }, { op: "ADD_PANIC", n: 8 }] }] },
        { label: "\u9A71\u9010", outcomes: [{ p: 1, text: "\u884C\u674E\u6EDA\u4E0B\u697C\u68AF\uFF0C\u697C\u91CC\u4E00\u7247\u8083\u9759\u3002", effects: [{ op: "ADD_GOLD", n: 400 }, { op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_deed_018", ver: 1, type: "choice", title: "\u5F52\u6765\u7684\u300C\u623F\u4E1C\u300D", weight: 50, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 8 }, text: "\u4E00\u4E2A\u897F\u88C5\u9769\u5C65\u7684\u7537\u4EBA\u4E3E\u7740\u623F\u4EA7\u8BC1\uFF1A\u300C\u8FD9\u680B\u697C\uFF0C\u662F\u6211\u7684\u3002\u300D", options: [
        { label: "\u5171\u6CBB\u5206\u6210", outcomes: [{ p: 1, text: "\u4ED6\u5165\u4F19\u4E86\uFF0C\u5E26\u6765\u4E00\u7B14\u542F\u52A8\u91D1\u3002", effects: [{ op: "ADD_GOLD", n: 1e3 }, { op: "SET_FLAG", key: "mood", v: -1 }] }] },
        { label: "\u6233\u7A7F\u4F2A\u9020", outcomes: [{ p: 0.6, text: "\u516C\u7AE0\u662F\u841D\u535C\u523B\u7684\uFF0C\u4EBA\u7FA4\u54C4\u7B11\u3002", effects: [{ op: "ADD_GOLD", n: 1500 }] }, { p: 0.4, text: "\u4ED6\u6897\u7740\u8116\u5B50\u8D70\u4E86\uFF0C\u58F0\u8A89\u53D7\u635F\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] },
        { label: "\u8BA4\u683D\u8865\u507F", outcomes: [{ p: 1, text: "\u7834\u8D22\u514D\u707E\u3002", effects: [{ op: "ADD_GOLD", n: -500 }] }] }
      ] },
      { id: "evt_nightshift_019", ver: 1, type: "choice", title: "\u8C01\u503C\u591C\u73ED", weight: 65, cooldownDays: 7, maxPerRun: 2, prereq: {}, text: "\u5B88\u591C\u8868\u8D34\u51FA\u6765\u4E09\u5929\uFF0C\u540D\u5B57\u680F\u8FD8\u662F\u7A7A\u767D\u3002", options: [
        { label: "\u8F6E\u73ED", outcomes: [{ p: 1, text: "\u516C\u5E73\uFF0C\u4F46\u6BCF\u4E2A\u4EBA\u90FD\u9876\u7740\u9ED1\u773C\u5708\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }] }] },
        { label: "\u52A0\u85AA\u5FD7\u613F", outcomes: [{ p: 1, text: "\u91CD\u8D4F\u4E4B\u4E0B\uFF0C\u5C97\u54E8\u6EE1\u4E86\u3002", effects: [{ op: "ADD_GOLD", n: -400 }, { op: "GRANT_BUFF", buff: "paidwatch", days: 3 }] }] },
        { label: "\u4E3B\u89D2\u9876\u73ED", outcomes: [{ p: 1, text: "\u4F60\u6253\u7740\u54C8\u6B20\u5B88\u5230\u5929\u4EAE\uFF0C\u5A01\u671B\u6DA8\u4E86\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] }
      ] },
      { id: "evt_pet_020", ver: 1, type: "choice", title: "\u5BA0\u7269\u533B\u9662", weight: 50, cooldownDays: 14, maxPerRun: 2, prereq: {}, text: "\u836F\u5E97\u7684\u91D1\u6BDB\u96BE\u4EA7\uFF0C\u4E3B\u4EBA\u8DEA\u5728\u5730\u4E0A\u6C42\u6551\u3002", options: [
        { label: "\u6025\u6551", outcomes: [{ p: 1, text: "\u4E94\u53EA\u5D3D\u5B50\u6D3B\u4E86\u4E0B\u6765\uFF0C\u6BCD\u72AC\u6210\u4E86\u7F16\u5916\u4FDD\u5B89\u3002", effects: [{ op: "ADD_RES", res: "material", n: -150 }, { op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u653E\u5F03", outcomes: [{ p: 1, text: "\u54C0\u568E\u4E86\u4E00\u6574\u591C\u3002", effects: [{ op: "ADD_PANIC", n: 4 }] }] }
      ] },
      { id: "evt_yoga_021", ver: 1, type: "choice", title: "\u5929\u53F0\u7684\u5BCC\u5A46", weight: 60, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 7 }, text: "\u5929\u53F0\u4E0A\u6709\u4EBA\u5728\u505A\u745C\u4F3D\uFF0C\u745C\u4F3D\u57AB\u662F\u7231\u9A6C\u4ED5\u7684\u3002", options: [
        { label: "\u6536\u9AD8\u989D\u79DF", outcomes: [{ p: 1, text: "\u5979\u773C\u90FD\u6CA1\u7728\u5C31\u4ED8\u4E86\u3002", effects: [{ op: "ADD_GOLD", n: 1500 }] }] },
        { label: "\u8BF7\u5979\u6559\u7406\u8D22", outcomes: [{ p: 1, text: "\u5979\u7B11\uFF1A\u300C\u6709\u70B9\u610F\u601D\u3002\u300D", effects: [{ op: "SET_FLAG", key: "laiScore", v: 1 }] }] },
        { label: "\u65E0\u89C6", outcomes: [{ p: 1, text: "\u5979\u505A\u5B8C\u4E00\u7EC4\u62DC\u65E5\u5F0F\u5C31\u8D70\u4E86\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] }
      ] },
      { id: "evt_blackout_022", ver: 1, type: "choice", title: "\u505C\u7535\u591C", weight: 65, cooldownDays: 10, maxPerRun: 2, prereq: {}, text: "\u6574\u680B\u697C\u9677\u5165\u9ED1\u6697\uFF0C\u8D70\u5ECA\u91CC\u5168\u662F\u6478\u7D22\u7684\u58F0\u97F3\u3002", options: [
        { label: "\u70B9\u8721\u70DB", outcomes: [{ p: 1, text: "\u70DB\u5149\u6447\u66F3\uFF0C\u4EBA\u5FC3\u4E5F\u8DDF\u7740\u6643\u3002", effects: [{ op: "ADD_GOLD", n: -100 }, { op: "ADD_PANIC", n: 3 }] }] },
        { label: "\u53D1\u7535\u673A\u5168\u5F00", outcomes: [{ p: 1, text: "\u8F70\u9E23\u58F0\u91CC\uFF0C\u706F\u5168\u4EAE\u4E86\u3002", effects: [{ op: "ADD_RES", res: "material", n: -100 }, { op: "ADD_PANIC", n: -6 }] }] },
        { label: "\u6478\u9ED1", outcomes: [{ p: 0.4, text: "\u9ED1\u6697\u4E2D\u4F20\u6765\u51E0\u58F0\u60CA\u53EB\u3002", effects: [{ op: "ADD_PANIC", n: 8 }] }, { p: 0.6, text: "\u5C45\u7136\u4E5F\u6CA1\u51FA\u4EC0\u4E48\u4E8B\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }] }] }
      ] },
      { id: "evt_love_023", ver: 1, type: "choice", title: "\u5730\u4E0B\u5BA4\u7684\u5A5A\u793C", weight: 55, cooldownDays: 14, maxPerRun: 2, prereq: {}, text: "\u5730\u4E0B\u5BA4\u4E00\u5BF9\u5E74\u8F7B\u4EBA\u8981\u6210\u5A5A\uFF0C\u60F3\u501F\u4E00\u697C\u529E\u4EEA\u5F0F\u3002", options: [
        { label: "\u6210\u5168", outcomes: [{ p: 1, text: "\u7CD6\u679C\u662F\u7CD6\u7EB8\u6298\u7684\uFF0C\u638C\u58F0\u662F\u771F\u7684\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }, { op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u68D2\u6253\u9E33\u9E2F", outcomes: [{ p: 1, text: "\u59D1\u5A18\u54ED\u4E86\u4E00\u591C\uFF0C\u697C\u91CC\u6307\u6307\u70B9\u70B9\u3002", effects: [{ op: "ADD_PANIC", n: 8 }] }] },
        { label: "\u6536\u793C\u91D1", outcomes: [{ p: 1, text: "\u573A\u5730\u8D39\u7167\u6536\uFF0C\u9A82\u58F0\u7167\u6765\u3002", effects: [{ op: "ADD_GOLD", n: 300 }, { op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_tycoon_024", ver: 1, type: "choice", title: "\u5BCC\u5546\u6C42\u5E87\u62A4", weight: 65, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 8 }, text: "\u897F\u88C5\u7537\u4EBA\u5E26\u7740\u4E24\u4E2A\u884C\u674E\u7BB1\uFF1A\u300C\u6211\u80FD\u4ED8\u3002\u300D", options: [
        { label: "\u6536\u5341\u91D1\u5165\u4F19", outcomes: [{ p: 1, text: "\u884C\u674E\u7BB1\u91CC\u662F\u91D1\u6761\u548C\u7F50\u5934\u3002", effects: [{ op: "ADD_GOLD", n: 1e3 }] }] },
        { label: "\u514D\u8D39\u5E87\u62A4", outcomes: [{ p: 1, text: "\u300C\u597D\u4EBA\u5450\uFF01\u300D\u5168\u697C\u4F20\u9882\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 2 }] }] },
        { label: "\u62D2\u7EDD", outcomes: [{ p: 1, text: "\u4ED6\u6D88\u5931\u5728\u591C\u8272\u91CC\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] }
      ] },
      { id: "evt_mis_101", ver: 1, type: "mission", title: "7 \u697C\u8001\u592A\u88AB\u56F0", weight: 100, cooldownDays: 7, maxPerRun: 2, prereq: { dayMin: 3 }, text: "7 \u697C\u4F20\u6765\u8BF4\u4E0D\u6E05\u662F\u4EBA\u662F\u7269\u7684\u649E\u51FB\u58F0\u2014\u2014\u88AB\u56F0\u7684\u8001\u592A\u592A\u8FD8\u5728\u91CC\u9762\u3002", options: [
        { label: "\u6D3E\u4EBA\u6551", outcomes: [{ p: 0.7, text: "\u8001\u592A\u592A\u88AB\u80CC\u4E0B\u697C\uFF0C\u585E\u7ED9\u961F\u5458\u4E00\u628A\u7CD6\u679C\u548C\u4E00\u5F20\u623F\u5361\u3002", effects: [{ op: "SPAWN_TENANT", quality: "R" }] }, { p: 0.3, text: "\u4EBA\u6551\u51FA\u6765\u4E86\uFF0C\u961F\u5458\u6302\u4E86\u5F69\u3002", effects: [{ op: "WOUND_TENANT", tenantId: -1 }] }] },
        { label: "\u9065\u63A7\u6307\u6325", outcomes: [{ p: 0.5, text: "\u7535\u8BDD\u91CC\u6307\u70B9\u8DEF\u7EBF\uFF0C\u8001\u592A\u592A\u81EA\u5DF1\u6478\u4E86\u4E0B\u6765\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }] }, { p: 0.5, text: "\u4FE1\u53F7\u65AD\u4E86\uFF0C\u518D\u65E0\u56DE\u97F3\u3002", effects: [{ op: "ADD_PANIC", n: 6 }] }] },
        { label: "\u653E\u5F03", outcomes: [{ p: 1, text: "\u649E\u51FB\u58F0\u505C\u4E86\u3002\u6574\u680B\u697C\u5B89\u9759\u5F97\u53EF\u6015\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_mis_102", ver: 1, type: "mission", title: "\u836F\u623F\u7A81\u88AD", weight: 70, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 4 }, text: "\u8857\u89D2\u836F\u623F\u7684\u5377\u5E18\u95E8\u534A\u5F00\uFF0C\u91CC\u9762\u5E94\u8BE5\u8FD8\u6709\u5B58\u8D27\u3002", options: [
        { label: "\u4EB2\u81EA\u5E26\u961F", outcomes: [{ p: 1, text: "\u836F\u54C1\u548C\u5F39\u836F\u88C5\u4E86\u4E24\u5927\u5305\uFF0C\u6709\u4EBA\u6302\u5F69\u3002", effects: [{ op: "ADD_RES", res: "material", n: 200 }, { op: "ADD_RES", res: "ammo", n: 100 }, { op: "WOUND_TENANT", tenantId: -1 }] }] },
        { label: "\u6D3E\u5B88\u536B\u53BB", outcomes: [{ p: 1, text: "\u7A33\u5B57\u5F53\u5934\uFF0C\u6536\u83B7\u6253\u4E86\u6298\u3002", effects: [{ op: "ADD_RES", res: "material", n: 100 }] }] },
        { label: "\u653E\u5F03", outcomes: [{ p: 1, text: "\u673A\u4F1A\u53EA\u6709\u4E00\u6B21\u3002", effects: [{ op: "SET_FLAG", key: "intel", v: -1 }] }] }
      ] },
      { id: "evt_mis_103", ver: 1, type: "mission", title: "\u8D85\u5E02\u6E05\u573A", weight: 70, cooldownDays: 10, maxPerRun: 2, prereq: {}, text: "\u8FDE\u9501\u8D85\u5E02\u7684\u5377\u5E18\u95E8\u91CC\u4F20\u6765\u6B64\u8D77\u5F7C\u4F0F\u7684\u4F4E\u543C\u3002", options: [
        { label: "\u641C\u522E", outcomes: [{ p: 1, text: "\u98DF\u54C1\u548C\u74F6\u88C5\u6C34\u642C\u7A7A\u4E86\u4E24\u6392\u8D27\u67B6\uFF0C\u6709\u4EBA\u88AB\u5212\u4F24\u3002", effects: [{ op: "ADD_RES", res: "food", n: 300 }, { op: "ADD_RES", res: "water", n: 200 }, { op: "WOUND_TENANT", tenantId: -1 }] }] },
        { label: "\u4FDD\u5B88\u6E05\u70B9", outcomes: [{ p: 1, text: "\u53EA\u62FF\u4E86\u95E8\u53E3\u987A\u624B\u7684\u3002", effects: [{ op: "ADD_RES", res: "food", n: 120 }] }] }
      ] },
      { id: "evt_mis_104", ver: 1, type: "mission", title: "\u4E94\u91D1\u5E97\u5EFA\u6750", weight: 60, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 5 }, text: "\u4E94\u91D1\u5E97\u8001\u677F\u8DD1\u4E86\uFF0C\u8D27\u67B6\u4E0A\u4E00\u6392\u6392\u89D2\u94A2\u8FD8\u5728\u3002", options: [
        { label: "\u6EE1\u8F7D\u800C\u5F52", outcomes: [{ p: 1, text: "\u89D2\u94A2\u3001\u87BA\u4E1D\u3001\u95E8\u94F0\u94FE\uFF0C\u5168\u662F\u786C\u8D27\u3002", effects: [{ op: "ADD_RES", res: "material", n: 400 }] }] },
        { label: "\u5FEB\u64A4", outcomes: [{ p: 1, text: "\u53EA\u62A2\u4E86\u624B\u8FB9\u7684\u3002", effects: [{ op: "ADD_RES", res: "material", n: 150 }] }] }
      ] },
      { id: "evt_mis_105", ver: 1, type: "mission", title: "\u52A0\u6CB9\u7AD9\u53D6\u6CB9", weight: 60, cooldownDays: 12, maxPerRun: 2, prereq: { dayMin: 6 }, text: "\u52A0\u6CB9\u7AD9\u7684\u50A8\u6CB9\u7F50\u8FD8\u6709\u4F59\u6CB9\uFF0C\u5C31\u662F\u5B88\u7740\u5B83\u7684\u4E1C\u897F\u4E0D\u592A\u53CB\u597D\u3002", options: [
        { label: "\u53D6\u6CB9", outcomes: [{ p: 1, text: "\u4E09\u5927\u6876\u67F4\u6CB9\uFF0C\u987A\u4FBF\u62C6\u4E86\u4E24\u4E2A\u71C3\u70E7\u74F6\uFF0C\u6709\u4EBA\u88AB\u70EB\u4F24\u3002", effects: [{ op: "ADD_RES", res: "ammo", n: 80 }, { op: "WOUND_TENANT", tenantId: -1 }] }] },
        { label: "\u653E\u5F03", outcomes: [{ p: 1, text: "\u6CB9\u7F50\u7684\u547C\u5438\u5B54\u4F20\u6765\u522E\u64E6\u58F0\u3002", effects: [{ op: "ADD_PANIC", n: 3 }] }] }
      ] },
      { id: "evt_mis_106", ver: 1, type: "mission", title: "\u6536\u5BB9\u6D41\u6D6A\u8005", weight: 65, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 4 }, text: "\u9AD8\u67B6\u6865\u4E0B\u8737\u7740\u51E0\u4E2A\u5E78\u5B58\u8005\uFF0C\u773C\u795E\u8B66\u60D5\u3002", options: [
        { label: "\u6536\u5BB9\u961F", outcomes: [{ p: 1, text: "\u5E26\u56DE\u4E86\u51E0\u4E2A\u4EBA\uFF0C\u98DF\u5802\u538B\u529B\u5927\u4E86\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }, { op: "SPAWN_TENANT", quality: "N" }] }] },
        { label: "\u529D\u8D70", outcomes: [{ p: 1, text: "\u4ED6\u4EEC\u671D\u53E6\u4E00\u4E2A\u65B9\u5411\u53BB\u4E86\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] }
      ] },
      { id: "evt_mis_107", ver: 1, type: "mission", title: "\u533B\u9662\u5E9F\u589F", weight: 50, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 8 }, text: "\u5E02\u533B\u9662\u7684\u5E9F\u589F\u91CC\u636E\u8BF4\u8FD8\u6709\u4E00\u4F4D\u6CA1\u8D70\u7684\u62A4\u58EB\u957F\u3002", options: [
        { label: "\u6DF1\u5165", outcomes: [{ p: 0.35, text: "\u62A4\u58EB\u957F SR \u7EA7\uFF0C\u5E26\u7740\u4E00\u7BB1\u836F\u54C1\u5F52\u961F\u3002", effects: [{ op: "SPAWN_TENANT", quality: "SR" }] }, { p: 0.3, text: "\u836F\u54C1\u5230\u624B\uFF0C\u4F46\u4E24\u540D\u961F\u5458\u8D1F\u4F24\u3002", effects: [{ op: "ADD_RES", res: "material", n: 150 }, { op: "WOUND_TENANT", tenantId: -1 }, { op: "WOUND_TENANT", tenantId: -1 }] }, { p: 0.35, text: "\u65E0\u529F\u800C\u8FD4\u3002", effects: [{ op: "ADD_PANIC", n: 3 }] }] },
        { label: "\u5916\u56F4\u6361\u6F0F", outcomes: [{ p: 1, text: "\u8FB9\u7F18\u67DC\u53F0\u626B\u4E86\u4E00\u4E9B\u836F\u54C1\u3002", effects: [{ op: "ADD_RES", res: "material", n: 120 }] }] }
      ] },
      { id: "evt_mis_108", ver: 1, type: "mission", title: "\u5B66\u6821\u907F\u96BE\u6240", weight: 55, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 8 }, text: "\u5C0F\u5B66\u4F53\u80B2\u9986\u91CC\u6709\u4E8C\u5341\u51E0\u4E2A\u5E78\u5B58\u8005\uFF0C\u53EA\u6536\u5F97\u4E0B\u51E0\u4E2A\u3002", options: [
        { label: "\u63A5\u7EB3", outcomes: [{ p: 1, text: "\u6765\u4E86\u8001\u5E08\u5E26\u7740\u4E24\u4E2A\u5B69\u5B50\uFF0C\u697C\u91CC\u591A\u4E86\u4EBA\u6C14\u4E5F\u591A\u4E86\u5634\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }, { op: "SPAWN_TENANT", quality: "N" }, { op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u62D2\u6536", outcomes: [{ p: 1, text: "\u94C1\u95E8\u5728\u4ED6\u4EEC\u8EAB\u540E\u5173\u95ED\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_mis_109", ver: 1, type: "mission", title: "\u94F6\u884C\u91D1\u5E93", weight: 45, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 10 }, text: "\u94F6\u884C\u5730\u4E0B\u91D1\u5E93\u7684\u7535\u5B50\u9501\u8FD8\u5269\u6700\u540E\u4E00\u9053\u2014\u2014\u91CC\u9762\u662F\u4F20\u8BF4\u4E2D\u7684\u91D1\u6761\u3002", options: [
        { label: "\u64AC\u5E93", outcomes: [{ p: 1, text: "\u91D1\u6761\u5230\u624B\uFF01\u4F46\u52A8\u9759\u5F15\u6765\u4E86\u602A\u7269\u7684\u589E\u63F4\u6F6E\u3002", effects: [{ op: "ADD_GOLD", n: 2500 }, { op: "NIGHT_MOD", mod: "SILENT" }] }] },
        { label: "\u653E\u5F03", outcomes: [{ p: 1, text: "\u91D1\u5E93\u7684\u95E8\u5728\u8EAB\u540E\u7F13\u7F13\u5408\u4E0A\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] }
      ] },
      { id: "evt_mis_110", ver: 1, type: "mission", title: "\u9AD8\u901F\u8DEF\u64A4\u79BB\u8F66\u961F", weight: 60, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 9 }, text: "\u64A4\u79BB\u8F66\u961F\u629B\u951A\u5728\u9AD8\u67B6\u4E0A\uFF0C\u4EBA\u613F\u610F\u4ED8\u94B1\u6362\u4E00\u4E2A\u94FA\u4F4D\u3002", options: [
        { label: "\u63A5\u5E94\u6536\u4EBA", outcomes: [{ p: 1, text: "\u6BCF\u4EBA 200 \u91D1\u5E01\uFF0C\u6765\u4E86\u4E94\u4E2A\u4ED8\u8D39\u79DF\u5BA2\u3002", effects: [{ op: "ADD_GOLD", n: 1e3 }, { op: "SPAWN_TENANT", quality: "N" }, { op: "SPAWN_TENANT", quality: "N" }] }] },
        { label: "\u9A71\u8D76", outcomes: [{ p: 1, text: "\u8F66\u961F\u7684\u706F\u5149\u5728\u591C\u91CC\u8FDC\u53BB\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] }
      ] },
      { id: "evt_ord_201", ver: 1, type: "choice", title: "\u697C\u9053\u4E89\u5435", weight: 60, cooldownDays: 7, maxPerRun: 2, prereq: {}, text: "\u4E94\u697C\u4E24\u6237\u4E3A\u4E86\u697C\u9053\u5806\u7269\u5435\u5230\u4E86\u52A8\u624B\u7684\u8FB9\u7F18\u3002", options: [
        { label: "\u8C03\u89E3", outcomes: [{ p: 1, text: "\u5404\u9000\u4E00\u6B65\uFF0C\u697C\u9053\u91CD\u65B0\u901A\u7545\u3002", effects: [{ op: "ADD_PANIC", n: -4 }] }] },
        { label: "\u5404\u6253\u4E94\u5341\u5927\u677F", outcomes: [{ p: 1, text: "\u7F5A\u4E86\u4E24\u5BB6\u6E05\u626B\uFF0C\u79E9\u5E8F\u7ACB\u4E86\uFF0C\u6028\u6C14\u4E5F\u5B58\u4E86\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }, { op: "SET_FLAG", key: "mood", v: -1 }] }] },
        { label: "\u51B7\u5904\u7406", outcomes: [{ p: 1, text: "\u4E89\u5435\u5347\u7EA7\u6210\u4E86\u5BF9\u9A82\u3002", effects: [{ op: "ADD_PANIC", n: 4 }] }] }
      ] },
      { id: "evt_ord_202", ver: 1, type: "choice", title: "\u85CF\u7CAE\u4E0E\u6328\u997F\u7684\u5B69\u5B50", weight: 70, cooldownDays: 12, maxPerRun: 2, prereq: { panicMin: 40 }, text: "\u6709\u4EBA\u56E4\u7CAE\uFF0C\u9694\u58C1\u7684\u5B69\u5B50\u5374\u997F\u5F97\u54ED\u4E0D\u51FA\u58F0\u3002", options: [
        { label: "\u641C\u67E5", outcomes: [{ p: 1, text: "\u56E4\u7CAE\u5145\u516C\uFF0C\u56E4\u7CAE\u8005\u88AB\u626B\u5730\u51FA\u95E8\u3002", effects: [{ op: "ADD_RES", res: "food", n: 300 }, { op: "ADD_PANIC", n: 6 }, { op: "SET_FLAG", key: "order", v: 1 }] }] },
        { label: "\u63A5\u6D4E", outcomes: [{ p: 1, text: "\u81EA\u5BB6\u7684\u7C73\u7F38\u89C1\u5E95\u4E86\uFF0C\u4F46\u5B69\u5B50\u5403\u9971\u4E86\u3002", effects: [{ op: "ADD_RES", res: "food", n: -200 }, { op: "ADD_PANIC", n: -6 }] }] },
        { label: "\u4E0D\u7BA1", outcomes: [{ p: 1, text: "\u54ED\u58F0\u6301\u7EED\u5230\u540E\u534A\u591C\u3002", effects: [{ op: "ADD_PANIC", n: 10 }] }] }
      ] },
      { id: "evt_ord_203", ver: 1, type: "choice", title: "\u81EA\u53D1\u5DE1\u903B\u961F", weight: 60, cooldownDays: 12, maxPerRun: 2, prereq: { dayMin: 6 }, text: "\u51E0\u4E2A\u5E74\u8F7B\u4EBA\u81EA\u53D1\u7EC4\u7EC7\u4E86\u591C\u95F4\u5DE1\u903B\u3002", options: [
        { label: "\u652F\u6301", outcomes: [{ p: 1, text: "\u5DE1\u903B\u961F\u7684\u81C2\u7AE0\u662F\u7528\u7EA2\u5E03\u6761\u505A\u7684\u3002", effects: [{ op: "GRANT_BUFF", buff: "patrol", days: 5 }] }] },
        { label: "\u53D1\u5DE5\u8D44\u6536\u7F16", outcomes: [{ p: 1, text: "\u7ED9\u94B1\u624D\u6709\u6267\u884C\u529B\uFF0C\u4F46\u786E\u5B9E\u7BA1\u7528\u3002", effects: [{ op: "ADD_GOLD", n: -500 }, { op: "GRANT_BUFF", buff: "patrolPaid", days: 7 }] }] },
        { label: "\u89E3\u6563", outcomes: [{ p: 1, text: "\u5DE1\u903B\u961F\u6563\u4E86\uFF0C\u591C\u91CC\u7684\u811A\u6B65\u58F0\u591A\u4E86\u3002", effects: [{ op: "ADD_PANIC", n: 5 }] }] }
      ] },
      { id: "evt_ord_204", ver: 1, type: "choice", title: "\u300C\u6536\u79DF\u9B3C\u300D\u6D82\u9E26", weight: 55, cooldownDays: 12, maxPerRun: 2, prereq: {}, text: "\u5916\u5899\u4E0A\u88AB\u4EBA\u55B7\u4E86\u4E09\u4E2A\u5927\u7EA2\u5B57\uFF1A\u6536\u79DF\u9B3C\u3002", options: [
        { label: "\u6E05\u6D17", outcomes: [{ p: 1, text: "\u6F06\u6CA1\u6D17\u5E72\u51C0\uFF0C\u5B57\u8FD8\u5728\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 0 }] }] },
        { label: "\u9ED8\u8BB8", outcomes: [{ p: 1, text: "\u5E74\u8F7B\u4EBA\u89C9\u5F97\u8FD9\u79F0\u547C\u633A\u9177\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u53CD\u5411\u8425\u9500", outcomes: [{ p: 1, text: "\u300C\u6536\u79DF\u9B3C\u4FDD\u62A4\u8D39\u300D\u7684\u6BB5\u5B50\u4F20\u904D\u4E86\u907F\u96BE\u6240\u5708\u5B50\u3002", effects: [{ op: "ADD_GOLD", n: 200 }] }] }
      ] },
      { id: "evt_ord_205", ver: 1, type: "choice", title: "\u901D\u8005\u846C\u793C", weight: 65, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 7 }, text: "\u6B7B\u8005\u7684\u5BB6\u5C5E\u60F3\u529E\u4E00\u573A\u50CF\u6837\u7684\u846C\u793C\u3002", options: [
        { label: "\u529E\u4EEA\u5F0F", outcomes: [{ p: 1, text: "\u767D\u82B1\u662F\u7528\u7EB8\u5DFE\u6298\u7684\uFF0C\u54C0\u4E50\u662F\u53E3\u7434\u5439\u7684\u3002", effects: [{ op: "ADD_RES", res: "food", n: -150 }, { op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u4ECE\u7B80", outcomes: [{ p: 1, text: "\u4E00\u4E2A\u5751\uFF0C\u4E00\u5757\u6728\u677F\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: -1 }] }] },
        { label: "\u7814\u7A76\u5C38\u4F53", outcomes: [{ p: 1, text: "\u4F24\u53E3\u7684\u9F7F\u75D5\u8BB0\u5F55\u8FDB\u4E86\u602A\u7269\u56FE\u9274\u3002", effects: [{ op: "SET_FLAG", key: "intel", v: 1 }, { op: "ADD_PANIC", n: 6 }] }] }
      ] },
      { id: "evt_ord_206", ver: 1, type: "choice", title: "\u516C\u7EA6\u6295\u7968\uFF1A\u5BB5\u7981", weight: 70, cooldownDays: 14, maxPerRun: 2, prereq: { dayMin: 5, flags: { orderIntro: 1 } }, text: "\u8BAE\u4E8B\u5385\u8D34\u51FA\u544A\u793A\uFF1A\u662F\u5426\u5B9E\u884C\u5BB5\u7981\uFF0C\u5168\u697C\u6295\u7968\u3002", options: [
        { label: "\u901A\u8FC7", outcomes: [{ p: 1, text: "\u5BB5\u7981\u4EE4\u4E0B\uFF0C\u591C\u91CC\u518D\u65E0\u4EBA\u8D70\u52A8\u3002", effects: [{ op: "SET_FLAG", key: "curfew", v: 1 }, { op: "SET_FLAG", key: "mood", v: -1 }] }] },
        { label: "\u5426\u51B3", outcomes: [{ p: 1, text: "\u81EA\u7531\u4E07\u5C81\u2014\u2014\u5FE7\u60A3\u6D3E\u6447\u4E86\u6447\u5934\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] },
        { label: "\u6298\u4E2D", outcomes: [{ p: 1, text: "\u5BB5\u7981\u5230\u5341\u70B9\uFF0C\u5927\u5BB6\u90FD\u80FD\u63A5\u53D7\u3002", effects: [{ op: "SET_FLAG", key: "curfew", v: 2 }] }] }
      ] },
      { id: "evt_ord_207", ver: 1, type: "choice", title: "\u516C\u533A\u5927\u626B\u9664", weight: 55, cooldownDays: 12, maxPerRun: 2, prereq: {}, text: "\u697C\u9053\u79EF\u7070\uFF0C\u7535\u68AF\u53E3\u7684\u6742\u7269\u5806\u4E86\u534A\u4EBA\u9AD8\u3002", options: [
        { label: "\u5168\u5458\u52A8\u5458", outcomes: [{ p: 1, text: "\u5927\u626B\u9664\u540E\u697C\u91CC\u4EAE\u5802\u4E86\uFF0C\u4EBA\u5FC3\u4E5F\u4EAE\u5802\u4E86\u3002", effects: [{ op: "ADD_PANIC", n: -6 }] }] },
        { label: "\u96C7\u4EBA\u6253\u626B", outcomes: [{ p: 1, text: "\u82B1\u94B1\u4E70\u6E05\u51C0\u3002", effects: [{ op: "ADD_GOLD", n: -250 }, { op: "ADD_PANIC", n: -4 }] }] },
        { label: "\u81EA\u5DF1\u4E0A", outcomes: [{ p: 1, text: "\u4F60\u626B\u4E86\u4E00\u4E0B\u5348\uFF0C\u8170\u90FD\u76F4\u4E0D\u8D77\u6765\u3002", effects: [{ op: "SET_FLAG", key: "mood", v: 1 }] }] }
      ] },
      { id: "evt_ord_208", ver: 1, type: "choice", title: "\u751F\u9762\u5B54\u6DF7\u5165", weight: 65, cooldownDays: 10, maxPerRun: 2, prereq: { dayMin: 5 }, text: "\u7535\u68AF\u91CC\u51FA\u73B0\u4E86\u6CA1\u89C1\u8FC7\u7684\u9762\u5B54\uFF0C\u8C01\u4E5F\u8BF4\u4E0D\u6E05\u6765\u5386\u3002", options: [
        { label: "\u6392\u67E5", outcomes: [{ p: 0.6, text: "\u865A\u60CA\u4E00\u573A\uFF0C\u662F\u9694\u58C1\u697C\u4E32\u95E8\u7684\u3002", effects: [{ op: "SET_FLAG", key: "order", v: 1 }] }, { p: 0.4, text: "\u63EA\u51FA\u4E00\u4E2A\u53EF\u7591\u5206\u5B50\uFF0C\u9A71\u9010\u51FA\u5883\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: -1 }] }] },
        { label: "\u653E\u884C", outcomes: [{ p: 1, text: "\u4E5F\u8BB8\u53EA\u662F\u4E2A\u501F\u5BBF\u7684\u3002", effects: [{ op: "SET_FLAG", key: "reputation", v: 1 }] }] },
        { label: "\u6536\u7F16\u8003\u5BDF", outcomes: [{ p: 1, text: "\u7559\u7528\u5BDF\u770B\uFF0C\u5E72\u6D3B\u90FD\u591A\u4E86\u4E00\u4EFD\u5FC3\u773C\u3002", effects: [{ op: "SPAWN_TENANT", quality: "N" }] }] }
      ] }
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
    return { phase: "DAY", page: "main", modals: [], eventQueue: [] };
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

  // apps/client-cocos/whitebox/renderer.ts
  function fmt(n) {
    return n.toLocaleString("en-US");
  }
  var WAVE_LETTERS = ["A", "B", "C", "D", "E", "F"];
  var WhiteboxRenderer = class {
    constructor(canvas2, cb) {
      this.cb = cb;
      this.ctx = canvas2.getContext("2d");
    }
    cb;
    ctx;
    frames = 0;
    fpsSamples = [];
    // 预热期原始样本（透明保留）
    budgetSamples = [];
    // 预热后样本（预算判定源）
    warmupLeft = 2;
    // 预热窗数：加载/首帧编译毛刺不计入预算
    lastSample = 0;
    modalOpenAt = null;
    /** rAF 主循环：帧率采样（预算 min ≥50fps，2 窗预热剔除加载毛刺）+ 重绘 */
    start(getFrame, getUi, getPb) {
      const tick = (now) => {
        this.frames++;
        if (now - this.lastSample >= 1e3) {
          const fps = Math.round(this.frames * 1e3 / (now - this.lastSample));
          this.fpsSamples.push(fps);
          if (this.warmupLeft > 0) this.warmupLeft--;
          else this.budgetSamples.push(fps);
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
    // ---- 相位分发（门②：DAWN_SETTLE→DAY→DUSK_FORECAST→NIGHT 四相 UI 状态机）----
    draw(ui2, frame, now, pb2) {
      const { ctx } = this;
      switch (ui2.phase) {
        case "DAWN_SETTLE":
          this.bgBase(col("bg_night"));
          ctx.fillStyle = withAlpha(col("bg_dawn"), dissolveAlpha(pb2.settleStart, now));
          ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
          this.drawSettle(frame, now, pb2);
          this.drawModal(ui2, frame, now, pb2);
          break;
        case "DAY":
          ctx.fillStyle = col("bg_dawn");
          ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
          if (ui2.page === "main") {
            this.drawHud(frame, now);
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
          ctx.fillStyle = col("bg_dawn");
          ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
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
    /** 占位页（功能点4）：图鉴 3 列网格剪影 / 商店礼包横滑 / 设置列表 */
    drawPage(page, now) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      this.button(pageBackRect(), "\u25C0 \u8FD4\u56DE", col("text_primary"), col("panel"), col("panel_stroke"));
      const titles = { codex: "\u56FE\u9274", shop: "\u5546\u5E97", settings: "\u8BBE\u7F6E" };
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h1, { weight: "bold" });
      ctx.fillText(titles[page] ?? "", pageTitleRect().x, pageTitleRect().y + pageTitleRect().h / 2);
      if (page === "codex") {
        for (let row = 0; row < CODEX_ROWS; row++) {
          for (let c = 0; c < CODEX_COLS; c++) {
            const r = codexCellRect(c, row);
            const unlocked = row === 0 && c === 0;
            ctx.beginPath();
            ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel);
            ctx.fillStyle = unlocked ? withAlpha(col("success"), 0.12) : withAlpha(col("bg_night"), 0.5);
            ctx.fill();
            ctx.strokeStyle = unlocked ? col("success") : col("panel_stroke");
            ctx.stroke();
            ctx.font = font(T.typography.h1);
            ctx.fillStyle = unlocked ? col("text_primary") : col("text_secondary");
            ctx.fillText(unlocked ? "\u{1F9DF}" : "\u{1F512}", r.x + r.w / 2 - 18, r.y + r.h / 2 - 16);
            ctx.font = font(T.typography.caption);
            ctx.fillText(unlocked ? "\u5FAA\u58F0\u8005" : "\u672A\u89E3\u9501", r.x + r.w / 2 - 24, r.y + r.h - 40);
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5360\u4F4D\uFF1AM3 \u6309\u602A\u7269\u8FDB\u5316\u6811/\u4F4F\u6237\u540D\u518C\u586B\u5145", T.space.l, codexCellRect(0, CODEX_ROWS - 1).y + 240 + 40);
      } else if (page === "shop") {
        const names = ["\u9996\u5145\u53CC\u500D", "\u7269\u8D44\u8865\u7ED9\u5305", "\u5929\u8D4B\u77F3\u793C\u5305"];
        const prices = ["\xA56", "\xA530", "\xA568"];
        const was = ["\xA512", "\xA545", "\xA598"];
        for (let i = 0; i < SHOP_CARDS; i++) {
          const r = shopCardRect(i);
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.panel);
          ctx.fillStyle = col("panel");
          ctx.fill();
          ctx.strokeStyle = i === 0 ? col("gold_deep") : col("panel_stroke");
          ctx.stroke();
          ctx.fillStyle = col("text_secondary");
          ctx.font = font(T.typography.h1);
          ctx.fillText("\u{1F381}", r.x + r.w / 2 - 20, r.y + 140);
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
          ctx.font = font(T.typography.h2, { weight: "bold" });
          ctx.fillText(prices[i], r.x + T.space.m + ww + T.space.s, r.y + 340);
          if (i === 0) {
            ctx.fillStyle = col("alert_blood");
            ctx.font = font(T.typography.caption, { weight: "bold" });
            ctx.fillText("\u53CC\u500D", r.x + r.w - 96, r.y + 40);
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5360\u4F4D\uFF1ASKU \u8D70 iap_sku.json\uFF0CIAA/IAP \u5408\u89C4\u5BA1\u67E5\u540E\u63A5\u5165", T.space.l, shopCardRect(0).y + 560 + 40);
      } else {
        for (const [i, row] of SETTINGS_ROWS.entries()) {
          const r = settingsRowRect(i);
          ctx.beginPath();
          ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
          ctx.fillStyle = col("panel");
          ctx.fill();
          ctx.strokeStyle = col("panel_stroke");
          ctx.stroke();
          ctx.fillStyle = col("text_primary");
          ctx.font = font(T.typography.body);
          ctx.fillText(row.label, r.x + T.space.m, r.y + r.h / 2);
          if (row.key === "codex" || row.key === "shop") {
            ctx.fillStyle = col("text_secondary");
            ctx.fillText("\u25B6", r.x + r.w - T.space.l, r.y + r.h / 2);
          } else {
            const tw = 96;
            ctx.beginPath();
            ctx.roundRect(r.x + r.w - tw - T.space.m, r.y + r.h / 2 - 24, tw, 48, 24);
            ctx.fillStyle = withAlpha(col("success"), 0.3);
            ctx.fill();
            ctx.beginPath();
            ctx.arc(r.x + r.w - tw - T.space.m + tw - 24, r.y + r.h / 2, 18, 0, Math.PI * 2);
            ctx.fillStyle = col("success");
            ctx.fill();
          }
        }
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u5B58\u6863\u4E09\u68C0\u67E5\u70B9\uFF1A\u65E5\u95F4/\u9EC4\u660F/\u591C\u6218\uFF08fail-safe \u6062\u590D\uFF09", T.space.l, settingsRowRect(SETTINGS_ROWS.length - 1).y + 88 + 40);
      }
      void now;
    }
    bgBase(c) {
      this.ctx.fillStyle = c;
      this.ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
    }
    panel(x, y, w, h, r = T.radius.panel) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, r);
      ctx.fillStyle = col("panel");
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    drawHud(frame, now) {
      const { ctx } = this;
      const hud = hudRect();
      ctx.fillStyle = col("panel");
      ctx.fillRect(hud.x, hud.y, hud.w, hud.h);
      ctx.strokeStyle = col("panel_stroke");
      ctx.beginPath();
      ctx.moveTo(0, hud.h);
      ctx.lineTo(hud.w, hud.h);
      ctx.stroke();
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(`\u65E5\u6B21 D${frame.day}`, T.space.l, hud.h / 2);
      ctx.font = font(T.typography.body);
      ctx.fillText(`\u{1F319}${Math.ceil(frame.day / 7)}/4`, T.space.l + 180, hud.h / 2);
      const st = settingsRect();
      ctx.fillStyle = col("text_secondary");
      ctx.fillText("\u2699", st.x + st.w / 2 - 14, st.y + st.h / 2);
      if (frame.modifiers.length) {
        const isBM = frame.modifiers.includes("BLOOD_MOON");
        ctx.fillStyle = isBM ? col("alert_blood") : col("danger");
        ctx.font = font(T.typography.caption);
        const label = frame.modifiers.join("/");
        const tw = ctx.measureText(label).width;
        const threat = motion("threat");
        const pulse = isBM ? 0.55 + 0.45 * Math.sin(now / (threat.dur * 2) * Math.PI * 2) : 1;
        ctx.globalAlpha = pulse;
        ctx.fillText(label, st.x - tw - T.space.s, hud.h / 2);
        ctx.globalAlpha = 1;
      }
    }
    drawResources(frame) {
      const { ctx } = this;
      const r = resourceRect();
      ctx.textBaseline = "middle";
      ctx.font = font(T.typography.body);
      const items = [
        { glyph: "\u{1FA99}", text: fmt(frame.gold), color: col("gold_primary") },
        // 金色数字=货币（§二色彩角色）
        { glyph: "\u{1F465}", text: `${frame.population}/${frame.roomsBuilt}`, color: col("text_primary") },
        { glyph: "\u2694", text: fmt(frame.power), color: col("text_primary") },
        { glyph: "\u{1F631}", text: `${frame.panicSum}`, color: col("panic") }
        // 恐慌紫=恐慌系统视觉锚
      ];
      const colW = r.w / items.length;
      items.forEach((it, i) => {
        const x = r.x + colW * i + T.space.m;
        ctx.fillStyle = col("text_secondary");
        ctx.fillText(it.glyph, x, r.y + r.h / 2);
        ctx.fillStyle = it.color;
        ctx.fillText(it.text, x + 36, r.y + r.h / 2);
      });
    }
    drawBuilding(frame, now) {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      let occupied = frame.population;
      const threat = motion("threat");
      for (let f = 0; f < FLOORS; f++) {
        const label = floorLabelRect(f);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`${FLOORS - f}F`, label.x, label.y + label.h / 2);
        for (let r = 0; r < ROOMS_PER_FLOOR; r++) {
          const rect = roomRect(f, r);
          const roomId = `F${FLOORS - f}-R${r + 1}`;
          const breached = frame.breachedRooms.includes(roomId);
          const isPublic = f === FLOORS - 1 && r < 3;
          const isTower = f === 0 && r === 0;
          const isOccupied = !isPublic && !isTower && occupied > 0;
          if (isOccupied) occupied--;
          if (breached) {
            const pulse = 0.5 + 0.5 * Math.sin(now / (threat.dur * 2) * Math.PI * 2);
            ctx.fillStyle = withAlpha(col("alert_blood"), 0.25 + 0.35 * pulse);
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip);
            ctx.fill();
            ctx.strokeStyle = col("alert_blood");
            ctx.stroke();
            ctx.fillStyle = col("text_primary");
            ctx.font = font(T.typography.caption);
            ctx.fillText("\u7834\u9632", rect.x + rect.w / 2 - 18, rect.y + rect.h / 2);
          } else if (isPublic || isTower) {
            ctx.strokeStyle = col("panel_stroke");
            ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
            ctx.fillStyle = withAlpha(col("gold_deep"), 0.2);
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip);
            ctx.fill();
            ctx.fillStyle = col("text_secondary");
            ctx.font = font(T.typography.caption);
            const name = isTower ? "\u77AD\u671B\u5854" : ["\u5927\u5385", "\u533B\u52A1", "\u4ED3"][r];
            ctx.fillText(name, rect.x + rect.w / 2 - name.length * 9, rect.y + rect.h / 2);
          } else if (isOccupied) {
            ctx.fillStyle = withAlpha(col("success"), 0.15);
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip);
            ctx.fill();
            ctx.strokeStyle = col("success");
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip);
            ctx.stroke();
            ctx.fillStyle = col("text_primary");
            ctx.font = font(T.typography.caption);
            ctx.fillText("\u{1F9D1}", rect.x + 12, rect.y + rect.h / 2);
            ctx.fillText("\u{1F6CF}", rect.x + rect.w - 34, rect.y + rect.h / 2);
          } else {
            ctx.strokeStyle = col("panel_stroke");
            ctx.beginPath();
            ctx.roundRect(rect.x, rect.y, rect.w, rect.h, T.radius.chip);
            ctx.stroke();
          }
        }
      }
    }
    drawEventEntry(frame) {
      const { ctx } = this;
      const r = eventEntryRect();
      this.panel(r.x, r.y, r.w, r.h, T.radius.btn);
      ctx.textBaseline = "middle";
      const top = frame.eventCards[0];
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u4ECA\u65E5\u4E8B\u4EF6", r.x + T.space.m, r.y + 30);
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body, { weight: "bold" });
      ctx.fillText(top ? top.title : "\u9759\u8C27 \xB7 \u65E0\u4E8B\u4EF6", r.x + T.space.m, r.y + 72);
      if (frame.eventCards.length > 1) {
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`+${frame.eventCards.length - 1}`, r.x + r.w - T.space.l - 40, r.y + 30);
      }
      ctx.fillStyle = col("gold_primary");
      ctx.font = font(T.typography.h2);
      ctx.fillText("\u25B6", r.x + r.w - T.space.l - 28, r.y + 72);
    }
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
      ctx.fillStyle = withAlpha(col("panic"), 0.2);
      ctx.fillRect(r.x + T.space.m, r.y + r.h - 34, barW, 10);
      const panicRatio = Math.min(1, frame.population > 0 ? frame.panicSum / (frame.population * 100) : 0);
      ctx.fillStyle = col("panic");
      ctx.fillRect(r.x + T.space.m, r.y + r.h - 34, barW * panicRatio, 10);
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText(`hash=${frame.sessionHash}`, r.x + r.w - T.space.m - 220, r.y + 26);
    }
    drawDock() {
      const { ctx } = this;
      ctx.textBaseline = "middle";
      dockRects().forEach((r, i) => {
        const key = DOCK_KEYS[i];
        const isNight = key.key === "night";
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
        ctx.fillStyle = isNight ? withAlpha(col("gold_primary"), 0.16) : col("panel");
        ctx.fill();
        ctx.strokeStyle = isNight ? col("gold_deep") : col("panel_stroke");
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = isNight ? col("gold_primary") : col("text_primary");
        ctx.font = font(T.typography.body, { weight: "bold" });
        const tw = ctx.measureText(key.label).width;
        ctx.fillText(key.label, r.x + (r.w - tw) / 2, r.y + r.h / 2);
      });
    }
    // ---- DUSK 夜战预告横幅（SILENT 时替换为「?」，§四）----
    drawDuskBanner(frame, now) {
      const { ctx } = this;
      const b = duskBannerRect();
      this.panel(b.x, b.y, b.w, b.h, T.radius.btn);
      ctx.textBaseline = "middle";
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.caption);
      ctx.fillText("\u5165\u591C\u9884\u544A", b.x + T.space.m, b.y + 28);
      const silent = frame.modifiers.includes("SILENT");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      if (silent) {
        ctx.fillStyle = col("text_secondary");
        ctx.fillText("\uFF1F", b.x + T.space.m, b.y + 68);
        ctx.font = font(T.typography.caption);
        ctx.fillText("\u9759\u9ED8\u4E4B\u591C \xB7 \u60C5\u62A5\u7F3A\u5931", b.x + T.space.m + 44, b.y + 68);
      } else {
        const isBM = frame.modifiers.includes("BLOOD_MOON");
        ctx.fillStyle = isBM ? col("alert_blood") : col("text_primary");
        ctx.fillText(isBM ? "\u8840\u6708 \u{1F534}" : "\u5E38\u89C4\u591C\u88AD", b.x + T.space.m, b.y + 68);
        if (frame.modifiers.includes("MIGRATE")) {
          ctx.fillStyle = col("danger");
          ctx.font = font(T.typography.caption);
          ctx.fillText("\u602A\u7269\u8FC1\u79FB \xB7 \u5F00\u6218\u91CD\u6392", b.x + T.space.m + 150, b.y + 68);
        }
      }
      const c = duskConfirmRect();
      const threat = motion("threat");
      const pulse = 0.7 + 0.3 * Math.sin(now / (threat.dur * 2) * Math.PI * 2);
      ctx.globalAlpha = pulse;
      this.button(c, "\u5E03\u9632", col("gold_primary"), withAlpha(col("gold_primary"), 0.16), col("gold_deep"));
      ctx.globalAlpha = 1;
    }
    button(r, label, textColor, bg, stroke) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = textColor;
      ctx.font = font(T.typography.body, { weight: "bold" });
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, r.x + (r.w - tw) / 2, r.y + r.h / 2);
    }
    // ---- NIGHT 全屏夜战面板（§3.3：血月 threat 红闪×2+震屏 / 路血条三态 / 技能 CD 环）----
    drawNight(frame, now, pb2) {
      const { ctx } = this;
      ctx.save();
      if (frame.modifiers.includes("BLOOD_MOON") && pb2.nightStart !== null) {
        const burst = threatBurst(pb2.nightStart, now);
        if (burst.shake > 0) ctx.translate(Math.sin(now / 16) * burst.shake, Math.cos(now / 13) * burst.shake);
        this.bgBase(col("bg_night"));
        if (burst.flash > 0) {
          ctx.fillStyle = withAlpha(col("alert_blood"), 0.35 * burst.flash);
          ctx.fillRect(-20, -20, DESIGN_W + 40, DESIGN_H + 40);
        }
      } else {
        this.bgBase(col("bg_night"));
      }
      ctx.textBaseline = "middle";
      const isBM = frame.modifiers.includes("BLOOD_MOON");
      const waves = pb2.session && pb2.nightStart !== null ? nightWaves(pb2.session.routes, pb2.nightStart, now) : null;
      ctx.fillStyle = isBM ? col("alert_blood") : col("text_primary");
      ctx.font = font(T.typography.h1, { weight: "bold" });
      ctx.fillText(isBM ? "\u8840\u6708 \u{1F534}" : "\u591C\u88AD", T.space.l, 120);
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.h2);
      const total = pb2.session?.routes.length ?? 0;
      ctx.fillText(`\u7B2C ${waves?.waveNo ?? 0}/${total} \u6CE2`, T.space.l + 260, 120);
      if (pb2.session?.silent) {
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.body);
        ctx.fillText("\uFF1F", T.space.l + 480, 120);
      }
      if (pb2.session && waves) {
        pb2.session.routes.forEach((_, i) => {
          const rv = waves.revealed[i];
          const r = nightRouteRect(i);
          const isCurrent = waves.waveNo === i + 1;
          const fill = rv ? isCurrent ? waves.currentFill : 1 : 0;
          ctx.fillStyle = col("text_secondary");
          ctx.font = font(T.typography.caption);
          ctx.fillText(`\u8DEF${WAVE_LETTERS[i]}`, r.x, r.y + r.h / 2);
          const barX = r.x + 64, barW = r.w - 64 - 160;
          ctx.fillStyle = withAlpha(col("panel_stroke"), 0.6);
          ctx.beginPath();
          ctx.roundRect(barX, r.y + r.h / 2 - 14, barW, 28, T.radius.chip);
          ctx.fill();
          if (fill > 0) {
            const stateColor = rv.state === 0 ? col("alert_blood") : rv.state === 1 ? col("gold_deep") : col("success");
            ctx.fillStyle = stateColor;
            ctx.beginPath();
            ctx.roundRect(barX, r.y + r.h / 2 - 14, Math.max(8, barW * fill), 28, T.radius.chip);
            ctx.fill();
          }
          ctx.fillStyle = col("text_primary");
          ctx.font = font(T.typography.body);
          if (rv) {
            const mon = pb2.monsterNames[rv.route.monsterId ?? ""] ?? "\u602A\u7269";
            const warn = rv.state === 0 ? " \u26A0\u26A0" : rv.state === 1 ? " \u26A0" : "";
            ctx.fillText(`${mon} ${Math.round(rv.route.r * 100)}%${warn}`, barX + barW + T.space.s, r.y + r.h / 2);
          } else {
            ctx.fillStyle = col("text_secondary");
            ctx.fillText("\uFF1F\uFF1F", barX + barW + T.space.s, r.y + r.h / 2);
          }
        });
      }
      nightSkillRects().forEach((r, i) => {
        const sk = pb2.skills[i];
        if (!sk) return;
        ctx.beginPath();
        ctx.roundRect(r.x, r.y, r.w, r.h, T.radius.btn);
        ctx.fillStyle = col("panel");
        ctx.fill();
        ctx.strokeStyle = col("panel_stroke");
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.h2);
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
          ctx.lineWidth = 4;
          ctx.stroke();
        }
      });
      ctx.restore();
    }
    /** 战况日志（路结果逐波追加 + 技能使用；body 字号可读） */
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
          lines.push(`\u7B2C${i + 1}\u6CE2 \u8DEF${WAVE_LETTERS[i]} \xB7 ${rv.route.roomId} \xB7 ${mon} \xB7 r=${rv.route.r.toFixed(2)} \u2192 ${OUTCOME_LABEL[rv.route.outcome]}`);
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
        const b = nightBackRect();
        this.button(b, "\u5929\u4EAE\u4E86 \u2192", col("gold_primary"), withAlpha(col("gold_primary"), 0.16), col("gold_deep"));
      }
      ctx.restore();
    }
    // ---- DAWN 收租结算（§3.4 标志性瞬间：物资雨 rain 500ms → 计数器 counter 800ms → 逐户 stagger 60ms）----
    drawSettle(frame, now, pb2) {
      const { ctx } = this;
      const start = pb2.settleStart;
      ctx.textBaseline = "middle";
      if (start !== null) {
        const rainM = motion("rain");
        const rainT = Math.min(1, (now - start) / rainM.dur);
        if (rainT < 1) {
          ctx.fillStyle = col("gold_primary");
          for (let i = 0; i < 24; i++) {
            const seed = (i * 97 + frame.day * 31) % 1e3 / 1e3;
            const x = T.space.l + seed * (DESIGN_W - T.space.l * 2 - 24);
            const y = rainM.fn(rainT) * DESIGN_H * 1.1 + seed * 300;
            ctx.fillRect(x, y % (DESIGN_H * 0.9), 20, 30);
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
      ctx.font = font(T.typography.h1, { weight: "bold" });
      ctx.fillText(`+${fmt(shown)}`, settleCounterRect().x + T.space.m, settleCounterRect().y + 40);
      const perRoom = households > 0 ? Math.round(frame.income / households) : 0;
      const popCount = Math.min(households, SETTLE_POP_MAX);
      for (let i = 0; i < popCount; i++) {
        const p = start !== null ? popProgress(i, start + motion("rain").dur + motion("counter").dur, now) : 0;
        if (p <= 0) continue;
        const pr = settlePopRect(i);
        ctx.globalAlpha = p;
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u4F4F \xB7 F1-R${i + 1}`, pr.x, pr.y + pr.h / 2);
        ctx.fillStyle = col("gold_primary");
        ctx.font = font(T.typography.body);
        ctx.fillText(`+${fmt(perRoom)}`, pr.x + 160, pr.y + pr.h / 2);
        ctx.globalAlpha = 1;
      }
      if (households > SETTLE_POP_MAX) {
        const pr = settlePopRect(SETTLE_POP_MAX - 1);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        ctx.fillText(`\u2026\u5171 ${households} \u6237`, pr.x, pr.y + pr.h + 24);
      }
      if (start !== null && now >= settleDoneAt(start, households)) {
        this.button(settleContinueRect(), "\u7EE7\u7EED \u25B6", col("gold_primary"), withAlpha(col("gold_primary"), 0.16), col("gold_deep"));
      }
    }
    // ---- 模态：事件卡模板（§3.2）/确认入夜/占位面板 ----
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
      ctx.fillStyle = withAlpha(col("bg_night"), 0.6 * eased);
      ctx.fillRect(0, 0, DESIGN_W, DESIGN_H);
      const y = r.y + slide;
      this.panel(r.x, y, r.w, r.h);
      ctx.textBaseline = "middle";
      if (top.kind === "event" && top.card) {
        this.drawEventCard(top, y, frame, now, pb2);
        return;
      }
      const title = top.kind === "confirmNight" ? "\u786E\u8BA4\u5165\u591C\uFF1F" : { deploy: "\u5E03\u9632", recruit: "\u62DB\u52DF", upgrade: "\u5347\u7EA7", settings: "\u8BBE\u7F6E" }[top.id] ?? top.id;
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(title, r.x + T.space.m, y + 48);
      ctx.strokeStyle = col("panel_stroke");
      ctx.beginPath();
      ctx.moveTo(r.x + T.space.m, y + 80);
      ctx.lineTo(r.x + r.w - T.space.m, y + 80);
      ctx.stroke();
      ctx.fillStyle = col("text_secondary");
      ctx.font = font(T.typography.body);
      const body = top.kind === "confirmNight" ? "\u5165\u591C\u540E\u4E0D\u53EF\u6253\u65AD\uFF08\u5168\u5C4F\u591C\u6218\uFF09" : "\u5360\u4F4D\u9762\u677F\uFF1AM3 \u63A5\u5165\u5BF9\u5E94\u7CFB\u7EDF\u64CD\u4F5C";
      ctx.fillText(body, r.x + T.space.m, y + 120);
      if (top.kind === "confirmNight") {
        const cr = modalConfirmRect();
        this.button({ ...cr, y: cr.y - r.y + y }, "\u5165\u591C \u25B6", col("gold_primary"), withAlpha(col("gold_primary"), 0.16), col("gold_deep"));
      }
      const c = modalCloseRect();
      this.closeBtn(c, y - r.y, "\u5173\u95ED");
    }
    /** 事件卡（§3.2 模板：标题栏/正文 24px/选项按钮+风险星级/翻面→结果→图标飞资源栏） */
    drawEventCard(top, y, frame, now, pb2) {
      const { ctx } = this;
      const r = modalRect();
      const card = top.card;
      if (!card) return;
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.h2, { weight: "bold" });
      ctx.fillText(card.title, r.x + T.space.m, y + 48);
      ctx.strokeStyle = col("panel_stroke");
      ctx.beginPath();
      ctx.moveTo(r.x + T.space.m, y + 80);
      ctx.lineTo(r.x + r.w - T.space.m, y + 80);
      ctx.stroke();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body);
      if (card.text) ctx.fillText(card.text, r.x + T.space.m, y + 120, r.w - T.space.m * 2);
      const opt = card.options[0];
      const flipped = top.chosen !== void 0;
      const flip = cardFlip(pb2.chosenAt, now);
      if (opt && !flipped) {
        const or = modalOptionRect();
        const br = { ...or, y: or.y - r.y + y };
        ctx.beginPath();
        ctx.roundRect(br.x, br.y, br.w, br.h, T.radius.btn);
        ctx.fillStyle = withAlpha(col("gold_primary"), 0.1);
        ctx.fill();
        ctx.strokeStyle = col("gold_deep");
        ctx.stroke();
        ctx.fillStyle = col("text_primary");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`\u25B6 ${opt.label}`, br.x + T.space.m, br.y + 34);
        ctx.fillStyle = col("text_secondary");
        ctx.font = font(T.typography.caption);
        const ps = opt.ps.map((p) => `${Math.round(p * 100)}%`).join("/");
        const stars = "\u26A0".repeat(Math.min(3, opt.ps.length - 1));
        ctx.fillText(`${ps} ${stars}`, br.x + T.space.m, br.y + 72);
      }
      if (flipped) {
        const flyT = pb2.chosenAt !== null ? Math.min(1, Math.max(0, (now - (pb2.chosenAt + motion("normal").dur)) / motion("rain").dur)) : 0;
        ctx.globalAlpha = flip;
        ctx.fillStyle = col("success");
        ctx.font = font(T.typography.body, { weight: "bold" });
        ctx.fillText(`\u2713 ${top.chosen === 0 ? "\u5DF2\u6267\u884C" : "\u5DF2\u9009\u62E9"} \xB7 ${card.resultText}`, r.x + T.space.m, y + 170 + 40, r.w - T.space.m * 2);
        ctx.globalAlpha = 1;
        if (flyT > 0 && flyT < 1) {
          const rainM = motion("rain");
          const fx = r.x + T.space.m + (resourceRect().x + T.space.l - r.x) * rainM.fn(flyT);
          const fy = y + 210 + (resourceRect().y + 20 - y - 210) * rainM.fn(flyT);
          ctx.fillStyle = col("gold_primary");
          ctx.beginPath();
          ctx.arc(fx, fy, 14, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      const c = modalCloseRect();
      this.closeBtn(c, y - r.y, flipped ? "\u7EE7\u7EED" : "\u7A0D\u540E");
    }
    closeBtn(c, dy, label) {
      const { ctx } = this;
      ctx.beginPath();
      ctx.roundRect(c.x, c.y + dy, c.w, c.h, T.radius.btn);
      ctx.fillStyle = withAlpha(col("text_secondary"), 0.15);
      ctx.fill();
      ctx.strokeStyle = col("panel_stroke");
      ctx.stroke();
      ctx.fillStyle = col("text_primary");
      ctx.font = font(T.typography.body);
      const tw = ctx.measureText(label).width;
      ctx.fillText(label, c.x + (c.w - tw) / 2, c.y + dy + c.h / 2);
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
  var pb = {
    session: null,
    monsterNames: Object.fromEntries(monster_default.entries.map((m) => [m.id, m.name])),
    nightStart: null,
    settleStart: null,
    chosenAt: null,
    logs: [],
    skills: [
      { label: "\u7A7A\u6295\u7269\u8D44", glyph: "\u{1F48A}", cdUntil: 0 },
      { label: "\u62A4\u76FE", glyph: "\u{1F6E1}", cdUntil: 0 }
    ]
  };
  function enterDay(d) {
    idx = d;
    ui.phase = "DAY";
    ui.page = "main";
    pb.chosenAt = null;
    for (const card of frames[d]?.eventCards ?? []) Object.assign(ui, pushEvent(ui, card));
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
        }
        return;
      case "modal":
        return;
      case "duskConfirm":
        if (ui.phase === "DUSK_FORECAST") {
          ui.phase = "NIGHT";
          pb.nightStart = now;
          pb.session = simSessions[idx] ?? null;
          pb.logs = [];
        }
        return;
      case "skill":
        if (ui.phase === "NIGHT") {
          const sk = pb.skills[hit.index];
          if (sk && now >= sk.cdUntil) {
            sk.cdUntil = now + SKILL_CD_MS;
            pb.logs.push(`\u4F7F\u7528\u4E3B\u52A8\u6280\u300C${sk.label}\u300D\uFF08\u5360\u4F4D\u6F14\u51FA\uFF09`);
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
  boot.then(() => {
    const sim = runSimulation(app, kernel, { days: 7, seed: 42 });
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
      eventCards: [...sim.eventCards[r.day] ?? []].sort((a, b) => b.weight - a.weight)
    }));
    const want = new URLSearchParams(location.search).get("phase");
    const wantPage = new URLSearchParams(location.search).get("page");
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
    if (wantPage === "codex" || wantPage === "shop" || wantPage === "settings") ui.page = wantPage;
    console.log(`\u767D\u76D2\u64AD\u653E\u5C31\u7EEA\uFF1A${frames.length} \u5929\uFF0C\u4E8B\u4EF6 ${sim.eventsFired} \u6B21\uFF0C\u72EC\u7ACB ${sim.distinctFired.length}`);
  });
})();
