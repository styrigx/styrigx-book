/* Book 顶栏对齐主站 2e7793d E2E（#33 最终任务一）。
 *
 * 主站常量来源（styrigx-space 2e7793d）：
 * - #site-nav 高度 64px：input.css:487 --nav-h: 64px
 * - .nav-inner：baseof.html:196-197 max-w-[1100px] mx-auto px-4 py-2.5 flex items-center gap-3
 * - #site-nav：input.css:804-806 position:fixed; top/left/right 0; 透明
 * - 头像 28×28（w-7 h-7）
 *
 * 断言：Book 顶栏各项与主站常量相差 ≤2px。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

// 主站常量（来自 styrigx-space 2e7793d）
const MAIN = {
  navH: 64,           // input.css:487
  navInnerMaxW: 1100, // baseof.html:197 max-w-[1100px]
  navInnerPx: 16,     // px-4
  navInnerPy: 10,     // py-2.5
  avatarSize: 28,     // w-7 h-7
};

async function getTopbarGeom(page, url, readySel) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
  await gotoReady(page, url, readySel);
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  return page.evaluate(() => {
    const q = s => document.querySelector(s);
    const r = s => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, width: b.width, height: b.height }; };
    return {
      nav: r('#site-nav'),
      avatar: r('#nav-home img'),
      navH_var: getComputedStyle(document.documentElement).getPropertyValue('--nav-h').trim(),
    };
  });
}

for (const [vpName, vp] of [['phone-412', { width: 412, height: 915 }], ['phone-360', { width: 360, height: 800 }]]) {
  test.describe(vpName, () => {
    test.use({ viewport: vp });

    test('顶栏高度 64px（主站 input.css:487）', async ({ page }) => {
      const g = await getTopbarGeom(page, '/', '#bk-grid:not(.hidden)');
      expect(Math.abs(g.nav.height - MAIN.navH), '#site-nav 高度').toBeLessThanOrEqual(2);
      expect(g.navH_var, '--nav-h 变量').toBe('64px');
    });

    test('头像 28×28（主站 w-7 h-7）', async ({ page }) => {
      const g = await getTopbarGeom(page, '/', '#bk-grid:not(.hidden)');
      if (g.avatar) {
        expect(Math.abs(g.avatar.width - MAIN.avatarSize), '头像宽').toBeLessThanOrEqual(2);
        expect(Math.abs(g.avatar.height - MAIN.avatarSize), '头像高').toBeLessThanOrEqual(2);
      }
    });
  });
}
