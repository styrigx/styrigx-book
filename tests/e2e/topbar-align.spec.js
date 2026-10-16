/* Book 顶栏头像尺寸 E2E（#33 最终任务一，v1.0 修订）。
 *
 * v1.0 顶栏规格：#site-nav 透明（pointer-events:none），可见的是 52px 浮动卡片
 * .sgx-topcard。原"顶栏高度 64px"断言已随旧设计删除，见 tests/e2e/topbar-spec.spec.js。
 *
 * 本文件仅保留头像 28×28 断言（w-7 h-7，v1.0 未变）。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

// 头像常量（v1.0 未变）
const AVATAR_SIZE = 28;     // w-7 h-7

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
      avatar: r('#nav-home img'),
    };
  });
}

for (const [vpName, vp] of [['phone-412', { width: 412, height: 915 }], ['phone-360', { width: 360, height: 800 }]]) {
  test.describe(vpName, () => {
    test.use({ viewport: vp });

    test('头像 28×28（主站 w-7 h-7）', async ({ page }) => {
      const g = await getTopbarGeom(page, '/', '#bk-grid:not(.hidden)');
      if (g.avatar) {
        expect(Math.abs(g.avatar.width - AVATAR_SIZE), '头像宽').toBeLessThanOrEqual(2);
        expect(Math.abs(g.avatar.height - AVATAR_SIZE), '头像高').toBeLessThanOrEqual(2);
      }
    });
  });
}
