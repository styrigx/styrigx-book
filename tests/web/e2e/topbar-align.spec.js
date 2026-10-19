/* Book 顶栏头像尺寸 E2E。
 *
 * 顶栏 v3：#site-nav 透明（pointer-events:none），可见的是左圆九宫格、长条 .sgx-tb-pill、
 * 右圆头像三块。布局与坐标断言见 tests/web/e2e/topbar-spec.spec.js。
 *
 * 本文件只保留头像尺寸断言：头像铺满右圆 52×52（与主站一致）。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

// 头像常量（v3：右圆 52×52，头像铺满）
const AVATAR_SIZE = 52;

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
      avatar: r('.sgx-tb-me img'),
    };
  });
}

for (const [vpName, vp] of [['phone-412', { width: 412, height: 915 }], ['phone-360', { width: 360, height: 800 }]]) {
  test.describe(vpName, () => {
    test.use({ viewport: vp });

    test('右圆头像 52×52（与主站一致）', async ({ page }) => {
      const g = await getTopbarGeom(page, '/', '#bk-grid:not(.hidden)');
      expect(g.avatar, '右圆头像存在').not.toBeNull();
      expect(Math.abs(g.avatar.width - AVATAR_SIZE), '头像宽').toBeLessThanOrEqual(2);
      expect(Math.abs(g.avatar.height - AVATAR_SIZE), '头像高').toBeLessThanOrEqual(2);
    });
  });
}
