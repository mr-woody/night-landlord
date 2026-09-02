// Creator 适配组件（P6 三屏移植的引擎桥）：白盒渲染协议 → Creator 场景。
// 职责仅三件事：① 离屏 Canvas 桥（运行 runSimulation 回放 + WhiteboxRenderer 绘制）
// ② 动态纹理桥（ImageAsset/Texture2D/SpriteFrame + 每帧 uploadData）
// ③ 输入桥（Creator 触摸 → layout.hitTest → state.ts 相位/模态分发，移植自浏览器 entry.ts）
// 渲染/状态/动效代码零重写（whitebox-core 为引擎无关纯 TS，见 scripts/sync-creator.mjs）。
import { _decorator, Component, Node, Sprite, SpriteFrame, Texture2D, ImageAsset, UITransform, EventTouch, sys } from 'cc';
const { ccclass } = _decorator;
import { WhiteboxRenderer, type DayFrame, type Playback } from '../whitebox-core/renderer';
import { createUiState, openModal, closeModal, topModal, pushEvent, setPage, type UiState } from '../whitebox-core/state';
import { DESIGN_W, DESIGN_H, hitTest } from '../whitebox-core/layout';
import { col, motion } from '../whitebox-core/theme';
import { settleDoneAt, nightWaves } from '../whitebox-core/anim';
import { createKernel } from '../shared/kernel/index';
import { createFormula, loadConstants } from '../shared/formula/index';
import { buildBundle, runSimulation, type AppContext, type EventCardMeta } from '../shared-headless/sim';
import type { BattleSession } from '../shared/systems/index';
import { TABLES } from '../shared-tables/tables';

const SKILL_CD_MS = motion('normal').dur * 10;

/** 离屏画布创建：web 用 document；微信小游戏运行时回退 wx.createCanvas（门⑥构建可用即可） */
function createOffscreen(w: number, h: number): { canvas: any; ctx: any } {
  const g = globalThis as any;
  let canvas: any;
  if (typeof document !== 'undefined') canvas = document.createElement('canvas');
  else if (g.wx && g.wx.createCanvas) canvas = g.wx.createCanvas();
  else throw new Error('no canvas factory (web/wx 均不可用)');
  canvas.width = w; canvas.height = h;
  return { canvas, ctx: canvas.getContext('2d') };
}

@ccclass('WhiteboxMain')
export class WhiteboxMain extends Component {
  private off: any = null;
  private renderer: WhiteboxRenderer | null = null;
  private texture: Texture2D | null = null;
  private ui: UiState = createUiState();
  private pb: Playback = {
    session: null,
    monsterNames: {},
    nightStart: null,
    settleStart: null,
    chosenAt: null,
    logs: [],
    skills: [
      { label: '空投物资', glyph: '💊', cdUntil: 0 },
      { label: '护盾', glyph: '🛡', cdUntil: 0 }
    ]
  };
  private frames: DayFrame[] = [];
  private simSessions: Record<number, BattleSession> = {};
  private idx = 0;
  private booted = false;

  private depsSnap = '';

  async start() {
    try {
      await this.boot();
    } catch (e: any) {
      const k: any = (this as any).__kernel;
      const recSnap = k?.records ? Array.from(k.records.values(), (r: any) => `${r.decl?.name}:${JSON.stringify(r.decl?.depends)}`).join(' | ') : '';
      this.showFatal(e, this.depsSnap + (recSnap ? '\n[records] ' + recSnap.slice(0, 400) : ''));
    }
  }

  /** 真机诊断：组件级启动异常以 modal 直显（引擎不 await async start，静默 rejection 会黑屏空转） */
  private showFatal(e: any, depsSnap = ''): void {
    console.error('[WhiteboxMain]', e);
    try {
      const w: any = globalThis as any;
      w.wx?.showModal?.({
        title: '场景启动异常',
        content: String(e?.message || e).slice(0, 200)
          + (depsSnap ? '\n[depends] ' + depsSnap.slice(0, 220) : '')
          + '\n— ' + String(e?.stack || '').split('\n')[1]?.trim().slice(0, 120),
        showCancel: false
      });
    } catch { /* 保底仅 console */ }
  }

  private async boot() {
    const { canvas, ctx } = createOffscreen(DESIGN_W, DESIGN_H);
    this.off = canvas;
    this.renderer = new WhiteboxRenderer(canvas, { onFps: () => {} });

    // —— 模拟回放数据（与浏览器 entry.ts 同构；逻辑全部来自 sync 产物）——
    const t = TABLES as any;
    const tables = { dayCurve: t.day_curve, constants: t.constants, buildingDef: t.building_def };
    const app: AppContext = {
      tables,
      formula: createFormula({ dayCurve: t.day_curve, constants: loadConstants(t.constants.entries) }),
      constants: loadConstants(t.constants.entries),
      eventLib: t.event_lib as unknown as AppContext['eventLib'],
      monsters: t.monster
    };
    const kernel = createKernel({ appName: 'nl-creator', clock: { logicalDay: () => 0, wallMs: () => Date.now() } });
    (this as any).__kernel = kernel;
    kernel.register([]);
    const bundle = buildBundle(app);
    this.depsSnap = bundle.map((p: any) => `${p.name}:${JSON.stringify(p.depends)}`).join(' | ');
    await kernel.boot(bundle);
    const sim = runSimulation(app, kernel, { days: 7, seed: 42 });
    this.simSessions = sim.sessions;
    this.pb.monsterNames = Object.fromEntries(t.monster.entries.map((m: any) => [m.id, m.name]));
    this.frames = sim.records.map((r: any) => ({
      day: r.day, population: r.population, roomsBuilt: r.roomsBuilt,
      gold: r.gold, income: r.income, power: r.power, rAvg: r.rAvg,
      deaths: r.deaths, wounds: r.wounds, sessionHash: r.sessionHash,
      modifiers: r.modifiers, avgLevel: r.avgLevel, panicSum: r.panicSum,
      breachedRooms: (sim.sessions[r.day]?.routes ?? []).filter((rt: any) => rt.r < 0.95).map((rt: any) => rt.roomId),
      eventCards: [...(sim.eventCards[r.day] ?? [])].sort((a: any, b: any) => b.weight - a.weight)
    }));

    // —— 动态纹理桥 ——
    const imageAsset = new ImageAsset(this.off);
    this.texture = new Texture2D();
    this.texture.image = imageAsset;
    const sf = new SpriteFrame();
    sf.texture = this.texture;
    const viewNode = new Node('whitebox-view');
    const ut = viewNode.addComponent(UITransform);
    ut.setContentSize(DESIGN_W, DESIGN_H);
    const sp = viewNode.addComponent(Sprite);
    sp.type = Sprite.Type.SIMPLE;
    sp.spriteFrame = sf;
    viewNode.parent = this.node;

    // —— 输入桥 ——
    this.node.on(Node.EventType.TOUCH_END, this.onTouch, this);
    this.booted = true;
  }

  private currentFrame(): DayFrame | null {
    return this.frames[this.idx] ?? null;
  }

  update() {
    if (!this.booted || !this.renderer || !this.texture) return;
    const now = performance.now();
    // 事件卡：翻面→结果→飞图标 完毕自动收卡（移植自 entry 主循环）
    const top = topModal(this.ui);
    if (top?.kind === 'event' && top.chosen !== undefined && this.pb.chosenAt !== null &&
        now - this.pb.chosenAt > motion('normal').dur + motion('rain').dur + motion('fast').dur) {
      Object.assign(this.ui, closeModal(this.ui));
      this.pb.chosenAt = null;
    }
    this.renderer.draw(this.ui, this.currentFrame()!, now, this.pb);
    this.texture.uploadData(this.off);
  }

  private onTouch(ev: EventTouch) {
    if (!this.booted) return;
    const uiloc = ev.getUILocation(); // 设计分辨率坐标（左下原点）
    const x = uiloc.x, y = DESIGN_H - uiloc.y;
    const now = performance.now();
    const modalOpen = topModal(this.ui) !== undefined;
    const hit = hitTest(x, y, { modalOpen, page: this.ui.page });
    switch (hit.kind) {
      case 'pageBack': Object.assign(this.ui, setPage(this.ui, 'main')); return;
      case 'nav': Object.assign(this.ui, setPage(this.ui, hit.page)); return;
      case 'modalClose': {
        const wasEvent = topModal(this.ui)?.kind === 'event';
        Object.assign(this.ui, closeModal(this.ui));
        if (wasEvent) this.pb.chosenAt = null;
        return;
      }
      case 'modalOption': {
        const t = topModal(this.ui)!;
        Object.assign(this.ui, { ...this.ui, eventQueue: [...this.ui.eventQueue.slice(0, -1), { ...t, chosen: 0 }] });
        this.pb.chosenAt = now;
        return;
      }
      case 'modalConfirm':
        if (topModal(this.ui)?.kind === 'confirmNight') {
          Object.assign(this.ui, closeModal(this.ui));
          this.ui.phase = 'DUSK_FORECAST';
        }
        return;
      case 'modal': return;
      case 'duskConfirm':
        if (this.ui.phase === 'DUSK_FORECAST') {
          this.ui.phase = 'NIGHT';
          this.pb.nightStart = now;
          this.pb.session = this.simSessions[this.idx + 1] ?? null; // frames[idx]=D{idx+1}
          this.pb.logs = [];
        }
        return;
      case 'skill': {
        if (this.ui.phase === 'NIGHT') {
          const sk = this.pb.skills[hit.index];
          if (sk && now >= sk.cdUntil) {
            sk.cdUntil = now + SKILL_CD_MS;
            this.pb.logs.push(`使用主动技「${sk.label}」（占位演出）`);
          }
        }
        return;
      }
      case 'nightBack':
        if (this.ui.phase === 'NIGHT' && this.pb.session && this.pb.nightStart !== null && nightWaves(this.pb.session.routes, this.pb.nightStart, now).done) {
          this.ui.phase = 'DAWN_SETTLE';
          this.pb.settleStart = now;
          this.pb.logs = [];
        }
        return;
      case 'settleContinue':
        if (this.ui.phase === 'DAWN_SETTLE' && this.pb.settleStart !== null && now >= settleDoneAt(this.pb.settleStart, this.households())) {
          this.pb.settleStart = null;
          this.enterDay((this.idx + 1) % this.frames.length);
        }
        return;
      case 'dock':
        if (hit.key === 'night') Object.assign(this.ui, openModal(this.ui, { kind: 'confirmNight', id: 'night' }));
        else Object.assign(this.ui, openModal(this.ui, { kind: 'panel', id: hit.key }));
        return;
      case 'settings': Object.assign(this.ui, setPage(this.ui, 'settings')); return;
      case 'eventEntry': {
        const card: EventCardMeta | undefined = this.frames[this.idx]?.eventCards[0];
        if (card) Object.assign(this.ui, openModal(this.ui, { kind: 'event', id: card.id, card }));
        return;
      }
      default: return;
    }
  }

  private households(): number {
    const f = this.frames[this.idx];
    return f ? Math.min(f.population, f.roomsBuilt) : 0;
  }

  private enterDay(d: number) {
    this.idx = d;
    this.ui.phase = 'DAY';
    this.ui.page = 'main';
    this.pb.chosenAt = null;
    for (const card of this.frames[d]?.eventCards ?? []) Object.assign(this.ui, pushEvent(this.ui, card));
  }
}
