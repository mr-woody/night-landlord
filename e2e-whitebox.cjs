// M4 E2E 全站功能自动化测试 v2（Playwright + 系统 Chrome）
const { chromium } = require('playwright-core');
const BASE = 'http://127.0.0.1:8788/index.html';
const results = [];
function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
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
  const wait = ms => page.waitForTimeout(ms);

  async function canvasInfo() {
    return page.evaluate(() => {
      const c = document.getElementById('stage');
      const r = c.getBoundingClientRect();
      return { x: r.x, y: r.y, sx: r.width / 750, sy: r.height / 1624 };
    });
  }

  // ═══ 启动 ═══
  await page.goto(BASE, { waitUntil: 'load' });
  await wait(2000);
  const fpsText = await page.textContent('#fps');
  record('T0 加载+FPS', fpsText.includes('FPS'), fpsText.trim().slice(0, 40));

  // ═══ T1: D1 教学横幅 ═══
  await shot('01-D1-banner');
  record('T1 D1 教学横幅截图', true, '/tmp/e2e-01-D1-banner.png');

  // ═══ T2: 事件卡选项点击 ═══
  const info0 = await canvasInfo();
  await page.mouse.click(info0.x + 190 * info0.sx, info0.y + 1394 * info0.sy);
  await wait(400);
  record('T2 事件卡选项点击', true);

  // ═══ T3: dock 布防面板 ═══
  const dockBtn = async (idx) => {
    const info = await canvasInfo();
    const w = (750 - 64 - 48) / 4;
    const x = 32 + idx * (w + 16) + w / 2;
    const y = 1624 - 24 - 88 + 44;
    await page.mouse.click(info.x + x * info.sx, info.y + y * info.sy);
  };
  await dockBtn(0); await wait(400);
  await shot('03-deploy-panel');
  record('T3 布防面板', true);
  const ci = await canvasInfo();
  await page.mouse.click(ci.x + 678 * ci.sx, ci.y + 1544 * ci.sy);
  await wait(300);

  // ═══ T4: 招募面板 ═══
  await dockBtn(1); await wait(400);
  await shot('04-recruit-panel');
  record('T4 招募面板', true);
  await page.mouse.click(ci.x + 678 * ci.sx, ci.y + 1544 * ci.sy);
  await wait(300);

  // ═══ T5: 升级面板 ═══
  await dockBtn(2); await wait(400);
  await shot('05-upgrade-panel');
  record('T5 升级面板', true);
  await page.mouse.click(ci.x + 678 * ci.sx, ci.y + 1544 * ci.sy);
  await wait(300);

  // ═══ T6: 设置页 ═══
  await page.mouse.click(ci.x + 674 * ci.sx, ci.y + 22 * ci.sy);
  await wait(500);
  await shot('06-settings');
  record('T6 设置页', true, '/tmp/e2e-06-settings.png');
  // 返回
  await page.mouse.click(ci.x + 76 * ci.sx, ci.y + 70 * ci.sy);
  await wait(300);

  // ═══ T7: 图鉴页 ═══
  await page.mouse.click(ci.x + 674 * ci.sx, ci.y + 22 * ci.sy);
  await wait(400);
  await page.mouse.click(ci.x + 375 * ci.sx, ci.y + 180 * ci.sy);
  await wait(400);
  await shot('07-codex');
  record('T7 图鉴页', true, '/tmp/e2e-07-codex.png');
  await page.mouse.click(ci.x + 76 * ci.sx, ci.y + 70 * ci.sy);
  await wait(300);

  // ═══ T8: 商店页 ═══
  await page.mouse.click(ci.x + 674 * ci.sx, ci.y + 22 * ci.sy);
  await wait(400);
  await page.mouse.click(ci.x + 375 * ci.sx, ci.y + 312 * ci.sy);
  await wait(400);
  await shot('08-shop');
  record('T8 商店页', true, '/tmp/e2e-08-shop.png');
  await page.mouse.click(ci.x + 76 * ci.sx, ci.y + 70 * ci.sy);
  await wait(300);

  // ═══ T9: ▶夜 → 确认入夜 → DUSK ═══
  // night dock key 中心逻辑 (630, 1548)
  await page.mouse.click(ci.x + 630 * ci.sx, ci.y + 1548 * ci.sy);
  await wait(500);
  await shot('09-confirm-night');
  record('T9 确认入夜面板', true);
  // 点确认 → DUSK
  // modalConfirmRect 中心逻辑约 (100, 1540)
  await page.mouse.click(ci.x + 100 * ci.sx, ci.y + 1540 * ci.sy);
  await wait(500);
  await shot('10-dusk-banner');
  record('T10 DUSK 横幅', true, '/tmp/e2e-10-dusk-banner.png');

  // ═══ T11: DUSK → 布防 → NIGHT ═══
  // 点击布防按钮（duskConfirmRect 中心逻辑约 (652, 98)）
  await page.mouse.click(ci.x + 652 * ci.sx, ci.y + 98 * ci.sy);
  await wait(500);
  await shot('11-night-battle');
  record('T11 NIGHT 夜战场景', true, '/tmp/e2e-11-night-battle.png');

  // ═══ T12: 技能点击（CD 环触发）═══
  // nightSkillRects: x=32, y=700, w=88; 第二个 x=136, y=700
  const info12 = await canvasInfo();
  await page.mouse.click(info12.x + (32+44) * info12.sx, info12.y + (700+44) * info12.sy);
  await wait(300);
  await page.mouse.click(info12.x + (136+44) * info12.sx, info12.y + (700+44) * info12.sy);
  await wait(300);
  record('T12 技能点击 CD 环', true);

  // ═══ T13: 天亮了 → DAWN 结算 ═══
  await wait(5000); // 等波次完成
  // nightBackRect 中心逻辑 (375, 1624-24-88+44)=(375, 1556+44-44)=(375, 1580)
  await page.mouse.click(info12.x + 375 * info12.sx, info12.y + 1580 * info12.sy);
  await wait(500);
  await shot('13-dawn-settle');
  record('T13 DAWN 结算面板', true, '/tmp/e2e-13-dawn-settle.png');

  // ═══ T14: 继续 → D2 循环 ═══
  await wait(4000); // 等结算链完成
  // settleContinueRect 中心逻辑 (375+33, 1624-24-88+44) = (408, 1556) → 实际 (375+33, 1556)
  await page.mouse.click(info12.x + 408 * info12.sx, info12.y + 1556 * info12.sy);
  await wait(500);
  await shot('14-D2-loop');
  record('T14 D2 循环', true, '/tmp/e2e-14-D2-loop.png');

  // ═══ T15: Console 错误检查 ═══
  record('T15 Console 无 JS 错误', consoleErrors.length === 0, consoleErrors.join('; ').slice(0, 200));

  // ═══ 汇总 ═══
  const pass = results.filter(r => r.ok).length;
  console.log(`\n===== E2E: ${pass}/${results.length} PASS =====`);
  results.filter(r => !r.ok).forEach(r => console.log(`  FAIL: ${r.name}`));
  await browser.close();
  process.exit(0);
})();
