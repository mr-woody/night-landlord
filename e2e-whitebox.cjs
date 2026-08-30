// M4 E2E 全站功能自动化测试 v3（Playwright + 系统 Chrome）
// v2 教训：断言硬编码 true + 坐标猜测 → 夜战/结算/D2 从未被真实验收。
// v3 原则：① 热区一律取自页面 __nlRects()（layout.ts 单一来源）；
//          ② 每一步断言 __nlState() 的真实状态迁移，禁止无条件 record(true)。
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8788/index.html';
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
}

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true
  });
  const context = await browser.newContext({ viewport: { width: 430, height: 940 } });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on('pageerror', e => consoleErrors.push(e.message));
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  const shot = name => page.screenshot({ path: `/tmp/e2e-${name}.png` });
  const state = () => page.evaluate(() => globalThis.__nlState());
  const rects = () => page.evaluate(() => globalThis.__nlRects());
  // 逻辑坐标 → 屏幕坐标点击（rect 为 750×1624 设计坐标）
  const clickRect = async (r, inset = 0.5) => {
    const info = await page.evaluate(() => {
      const c = document.getElementById('stage');
      const b = c.getBoundingClientRect();
      return { x: b.x, y: b.y, sx: b.width / 750, sy: b.height / 1624 };
    });
    const lx = r.x + r.w * inset, ly = r.y + r.h * inset;
    await page.mouse.click(info.x + lx * info.sx, info.y + ly * info.sy);
  };
  const wait = ms => page.waitForTimeout(ms);
  // 轮询直到条件成立或超时
  const until = async (fn, timeout = 8000, step = 250) => {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      const v = await fn();
      if (v) return v;
      await wait(step);
    }
    return null;
  };

  // ═══ T0: 加载 ═══
  await page.goto(BASE, { waitUntil: 'load' });
  await wait(2500);
  const fpsText = await page.textContent('#fps');
  const s0 = await until(async () => (await state()).phase === 'DAY' ? state() : null, 10000);
  record('T0 加载+FPS+进入 DAY', fpsText.includes('FPS') && s0 !== null && s0.day === 1,
    fpsText.trim().slice(0, 30) + ` / phase=${s0?.phase} day=${s0?.day}`);

  // ═══ T1: D1 事件卡（scripted 教学/抉择排队出现）═══
  const s1 = await state();
  const hasEvent = s1.modal?.kind === 'event';
  await shot('01-D1-event');
  record('T1 D1 事件卡弹出', hasEvent, `modal=${JSON.stringify(s1.modal)}`);

  // ═══ T2: 事件卡选择→锁定→自动收卡（队列最多 2 张，逐张处理）═══
  // 收卡完成 = modal 归零 或 下一张卡接替（未选择态）。DAY 相开场都可能
  // 有事件卡排队——之后任何 dock/导航操作前都需先清场（drainEvents）。
  const drainEvents = async () => {
    for (let i = 0; i < 3; i++) {
      const st = await state();
      if (st.modal?.kind !== 'event' || st.modal.chosen !== undefined) break;
      const R = await rects();
      await clickRect(R.modalOption);
      const advanced = await until(async () => {
        const s = await state();
        return s.modal === null || (s.modal.kind === 'event' && s.modal.chosen === undefined);
      }, 6000);
      if (advanced === null) return false;
      await wait(300);
    }
    return true;
  };
  let evClosed = await drainEvents();
  const s2 = await state();
  record('T2 事件卡选择锁定+自动收卡', evClosed && s2.modal === null && s2.phase === 'DAY',
    `modal=${JSON.stringify(s2.modal)}`);

  // ═══ T3: dock 布防面板（真实数据正文）→ 关闭 ═══
  {
    const R = await rects();
    await clickRect(R.dock[0]);
    await wait(450);
    const st = await state();
    await shot('03-deploy-panel');
    const Rc = await rects();
    await clickRect(Rc.modalClose);
    const closed = await until(async () => (await state()).modal === null, 3000);
    record('T3 布防面板开/关', st.modal?.id === 'deploy' && closed !== null, `modal=${JSON.stringify(st.modal)}`);
  }

  // ═══ T4: 招募面板（住户/容量真实数据）═══
  {
    const R = await rects();
    await clickRect(R.dock[1]);
    await wait(450);
    const st = await state();
    const Rc = await rects();
    await clickRect(Rc.modalClose);
    const closed = await until(async () => (await state()).modal === null, 3000);
    record('T4 招募面板开/关+容量', st.modal?.id === 'recruit' && st.capacity === 30 && closed !== null,
      `modal=${JSON.stringify(st.modal)} capacity=${st.capacity}`);
  }

  // ═══ T5: 升级面板 + 房屋升级面板 ═══
  {
    const R = await rects();
    await clickRect(R.dock[2]);
    await wait(450);
    const st = await state();
    const Rc = await rects();
    await clickRect(Rc.modalClose);
    await wait(350);
    await clickRect(R.house0);
    await wait(450);
    const st2 = await state();
    const Rc2 = await rects();
    await clickRect(Rc2.modalClose);
    const closed = await until(async () => (await state()).modal === null, 3000);
    record('T5 升级面板+房屋面板开/关', st.modal?.id === 'upgrade' && st2.modal?.id === 'house:0' && closed !== null,
      `dock=${JSON.stringify(st.modal)} house=${JSON.stringify(st2.modal)}`);
  }

  // ═══ T6: 出门探索 → 野外选区 → 派出队伍 → 返回（L1 全链路）═══
  {
    const R = await rects();
    await clickRect(R.explore);
    const inWild = await until(async () => (await state()).page === 'wild', 3000);
    if (inWild) {
      const R2 = await rects();
      await clickRect(R2.wildZones[0]);
      await wait(400);
      const stSel = await state();
      // + 两次 → 队伍 3 人
      await clickRect(R2.wildPlus); await wait(250);
      await clickRect(R2.wildPlus); await wait(250);
      const stSel2 = await state();
      const R3 = await rects();
      await clickRect(R3.wildDispatch);
      await wait(450);
      const st = await state();
      await shot('06-wild-dispatch');
      const Rc = await rects();
      await clickRect(Rc.modalClose);
      const closed = await until(async () => (await state()).modal === null, 3000);
      const R4 = await rects();
      await clickRect(R4.wildBack);
      const back = await until(async () => (await state()).page === 'map', 3000);
    record('T6 野外探索全链路', stSel.sel?.wildZone === 'zn_forest_edge' &&
      stSel2.sel?.partySize === 3 &&
      typeof st.modal?.id === 'string' && st.modal.id.startsWith('派出成功') &&
      st.parties === 1 && back !== null,
      `zone=${stSel.sel?.wildZone} size=${stSel2.sel?.partySize} dispatch=${JSON.stringify(st.modal)} parties=${st.parties}`);
    } else {
      record('T6 野外探索全链路', false, '点击探索横幅未进入 wild 页');
    }
  }

  // ═══ T7: 设置页 ═══
  {
    const R = await rects();
    await clickRect(R.settings);
    const st = await until(async () => (await state()).page === 'settings' ? state() : null, 3000);
    await shot('07-settings');
    record('T7 设置页', st?.page === 'settings', `page=${st?.page}`);
  }

  // ═══ T8: 设置→图鉴→商店→返回（pageBack 语义=回主界面，经设置齿轮再入）═══
  {
    const R = await rects();
    await clickRect(R.pageBack); await wait(400); // settings → main（T7 遗留）
    const R0 = await rects();
    await clickRect(R0.settings); await wait(450); // main → settings
    const R1 = await rects();
    await clickRect(R1.settingsRows[0]); await wait(450);
    const codex = await state();
    await shot('08-codex');
    await clickRect(R1.pageBack); await wait(400); // codex → main
    const R2 = await rects();
    await clickRect(R2.settings); await wait(450);
    const R3 = await rects();
    await clickRect(R3.settingsRows[1]); await wait(450);
    const shop = await state();
    await shot('08-shop');
    record('T8 图鉴/商店导航', codex.page === 'codex' && shop.page === 'shop',
      `codex=${codex.page} shop=${shop.page}`);
    // 返回主界面并回到小区地图：shop →(pageBack)→ main 楼内 →(◀ 小区)→ map
    const R4 = await rects();
    await clickRect(R4.pageBack);
    await until(async () => (await state()).page === 'main', 3000);
    const R5 = await rects();
    await clickRect(R5.mapBack);
    const backMap = await until(async () => (await state()).page === 'map', 3000);
    record('T8b 返回小区地图', backMap !== null, `page=${(await state()).page}`);
  }

  // ═══ T9: ▶夜 → 确认入夜 → DUSK ═══
  {
    const R = await rects();
    await clickRect(R.dockNight);
    await wait(450);
    const confirm = await state();
    await shot('09-confirm-night');
    const Rc = await rects();
    await clickRect(Rc.modalConfirm);
    const dusk = await until(async () => (await state()).phase === 'DUSK_FORECAST', 3000);
    record('T9 确认入夜→DUSK', confirm.modal?.kind === 'confirmNight' && dusk !== null,
      `confirm=${JSON.stringify(confirm.modal)} phase=${(await state()).phase}`);
  }

  // ═══ T10: DUSK 确认 → NIGHT 开战 ═══
  {
    await shot('10-dusk-banner');
    const R = await rects();
    await clickRect(R.duskConfirm);
    const night = await until(async () => (await state()).phase === 'NIGHT', 3000);
    const st = await state();
    record('T10 DUSK→NIGHT', night !== null && st.waves !== null,
      `phase=${st.phase} waves=${JSON.stringify(st.waves)}`);
  }

  // ═══ T11: 夜战波次推进至完成 ═══
  {
    const done = await until(async () => (await state()).waves?.done === true, 12000, 300);
    const st = await state();
    await shot('11-night-battle');
    record('T11 夜战波次完成', done === true && st.waves?.revealed?.length >= 1,
      `waves=${JSON.stringify(st.waves)}`);
  }

  // ═══ T12: 主动技 CD ═══
  {
    const R = await rects();
    await clickRect(R.nightSkills[0]); await wait(300);
    await clickRect(R.nightSkills[1]); await wait(300);
    const st = await state();
    await shot('12-skill-cd');
    record('T12 主动技 CD 触发', st.skills[0]?.onCd === true && st.skills[1]?.onCd === true,
      `skills=${JSON.stringify(st.skills.map(s => s.onCd))}`);
  }

  // ═══ T13: 天亮了 → DAWN 结算 ═══
  {
    const R = await rects();
    await clickRect(R.nightBack);
    const dawn = await until(async () => (await state()).phase === 'DAWN_SETTLE', 3000);
    const settleDone = await until(async () => (await state()).settleDone === true, 10000, 300);
    await shot('13-dawn-settle');
    record('T13 天亮→结算完成', dawn !== null && settleDone === true,
      `phase=${(await state()).phase}`);
  }

  // ═══ T14: 继续 → D2 循环（金币入账+日次推进+D1 派出队伍归队战报）═══
  {
    const goldBefore = (await state()).gold;
    const R = await rects();
    await clickRect(R.settleContinue);
    const d2 = await until(async () => {
      const st = await state();
      return st.phase === 'DAY' && st.day === 2 ? st : null;
    }, 5000);
    await shot('14-D2-loop');
    record('T14 D2 循环推进+探索归队', d2 !== null && d2.wildReports >= 1,
      `day=${d2?.day} phase=${d2?.phase} gold ${goldBefore}→${d2?.gold} wildReports=${d2?.wildReports} parties=${d2?.parties}`);
  }

  // ═══ T16: D2→D3 第二个完整昼夜循环（多日循环稳定性）═══
  {
    await drainEvents(); // D2 开场事件卡排队会以模态遮罩吞掉 dock 点击，先清场
    const R = await rects();
    await clickRect(R.dockNight); await wait(450);
    const confirm = await state();
    const Rc = await rects();
    await clickRect(Rc.modalConfirm);
    const dusk = await until(async () => (await state()).phase === 'DUSK_FORECAST', 3000);
    const R2 = await rects();
    await clickRect(R2.duskConfirm);
    const night = await until(async () => (await state()).phase === 'NIGHT', 3000);
    const wavesDone = await until(async () => (await state()).waves?.done === true, 12000, 300);
    const R3 = await rects();
    await clickRect(R3.nightBack);
    const dawn = await until(async () => (await state()).phase === 'DAWN_SETTLE', 3000);
    const settleDone = await until(async () => (await state()).settleDone === true, 10000, 300);
    const R4 = await rects();
    await clickRect(R4.settleContinue);
    const d3 = await until(async () => {
      const st = await state();
      return st.phase === 'DAY' && st.day === 3 ? st : null;
    }, 5000);
    await shot('16-D3-loop');
    record('T16 D2→D3 昼夜循环', confirm.modal?.kind === 'confirmNight' && dusk !== null &&
      night !== null && wavesDone === true && dawn !== null && settleDone === true && d3 !== null,
      `day=${d3?.day} gold=${d3?.gold} parties=${d3?.parties} weather=${d3?.weather}`);
  }

  // ═══ T17: 血月天（D7）直达验收——blood_dust 天气 + BLOOD_MOON 修士 + 3 路加强夜战 ═══
  {
    await page.goto(BASE + '?day=7', { waitUntil: 'load' });
    await wait(2500);
    await drainEvents(); // D7 开场事件卡排队先清场
    const d7 = await state();
    await shot('17-bloodmoon-day');
    const R = await rects();
    await clickRect(R.dockNight); await wait(450);
    const confirm = await state();
    const Rc = await rects();
    await clickRect(Rc.modalConfirm);
    const dusk = await until(async () => (await state()).phase === 'DUSK_FORECAST', 3000);
    const R2 = await rects();
    await clickRect(R2.duskConfirm);
    const night = await until(async () => (await state()).phase === 'NIGHT', 3000);
    const wavesDone = await until(async () => (await state()).waves?.done === true, 15000, 300);
    await shot('17-bloodmoon-night');
    const R3 = await rects();
    await clickRect(R3.nightBack);
    const dawn = await until(async () => (await state()).phase === 'DAWN_SETTLE', 3000);
    const settleDone = await until(async () => (await state()).settleDone === true, 10000, 300);
    const R4 = await rects();
    await clickRect(R4.settleContinue);
    const d8 = await until(async () => {
      const st = await state();
      return st.phase === 'DAY' && st.day === 8 ? st : null;
    }, 5000);
    record('T17 血月天 D7 验收', d7.day === 7 && d7.weather === 'blood_dust' &&
      d7.modifiers.includes('BLOOD_MOON') && confirm.modal?.kind === 'confirmNight' &&
      dusk !== null && night !== null && wavesDone === true &&
      dawn !== null && settleDone === true && d8 !== null,
      `day=${d7.day} weather=${d7.weather} mods=${JSON.stringify(d7.modifiers)} ` +
      `waves=${wavesDone ? 'done' : 'timeout'} d8=${d8?.day}`);
  }

  // ═══ T18: D30 B/C 栋解锁验收——unlockProgress 生产接线（扩容 30→90）+ 面板解锁态 ═══
  {
    await page.goto(BASE + '?day=30', { waitUntil: 'load' });
    await wait(2500);
    await drainEvents();
    const d30 = await state();
    const R = await rects();
    await clickRect(R.lot_bld_b);
    await wait(450);
    const panel = await state();
    await shot('18-d30-bcd-unlock');
    const Rc = await rects();
    await clickRect(Rc.modalClose);
    const closed = await until(async () => (await state()).modal === null, 3000);
    record('T18 D30 B/C 栋解锁', d30.day === 30 && d30.capacity === 90 &&
      panel.modal?.id === 'B栋' && closed !== null,
      `day=${d30.day} capacity=${d30.capacity} panel=${JSON.stringify(panel.modal)}`);
  }

  // ═══ T15: Console 错误检查 ═══
  record('T15 Console 无 JS 错误', consoleErrors.length === 0, consoleErrors.join('; ').slice(0, 200));

  // ═══ 汇总 ═══
  const pass = results.filter(r => r.ok).length;
  console.log(`\n===== E2E v3: ${pass}/${results.length} PASS =====`);
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name}`));
  await browser.close();
  process.exit(pass === results.length ? 0 : 1);
})();
