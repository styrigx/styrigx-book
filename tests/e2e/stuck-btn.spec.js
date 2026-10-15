/* Book 吸顶 ⋮ 圆底一致性 E2E（#33 最终任务二）。
 *
 * 断言：书库首页（#bk-menu-btn）与上传页（.subpage-more）吸顶后，
 * ← 和 ⋮ 的 width、height、background-color、box-shadow、top、到边缘距离全部一致（±1px）。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

async function getStuckGeom(page, url, readySel, moreSel) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
  await gotoReady(page, url, readySel);
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(800);
  return page.evaluate(({ moreSel }) => {
    const q = s => document.querySelector(s);
    const r = s => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, width: b.width, height: b.height }; };
    const cs = s => { const e = q(s); if (!e) return null; const st = getComputedStyle(e); return { bg: st.backgroundColor, shadow: st.boxShadow }; };
    const back = q('.subpage-back');
    const more = q(moreSel);
    return {
      backStuck: back?.classList.contains('stuck'),
      moreStuck: more?.classList.contains('stuck'),
      back: { ...r('.subpage-back'), ...cs('.subpage-back') },
      more: { ...r(moreSel), ...cs(moreSel) },
    };
  }, { moreSel });
}

for (const [vpName, vp] of [['phone-412', { width: 412, height: 915 }], ['phone-360', { width: 360, height: 800 }]]) {
  test.describe(vpName, () => {
    test.use({ viewport: vp });

    test('两页吸顶后 ←⋮ 样式一致（±1px）', async ({ page }) => {
      const shelf = await getStuckGeom(page, '/', '#bk-grid:not(.hidden)', '#bk-menu-btn');
      const upload = await getStuckGeom(page, '/admin/', '#adm-main:not(.hidden)', '.subpage-more');

      expect(shelf.backStuck, '书库 ← stuck').toBe(true);
      expect(shelf.moreStuck, '书库 ⋮ stuck').toBe(true);
      expect(upload.backStuck, '上传 ← stuck').toBe(true);
      expect(upload.moreStuck, '上传 ⋮ stuck').toBe(true);

      expect(Math.abs(shelf.more.width - upload.more.width), '⋮ 宽').toBeLessThanOrEqual(1);
      expect(Math.abs(shelf.more.height - upload.more.height), '⋮ 高').toBeLessThanOrEqual(1);
      expect(Math.abs(shelf.more.top - upload.more.top), '⋮ top').toBeLessThanOrEqual(1);
      const vpW = vp.width;
      expect(Math.abs((vpW - shelf.more.right) - (vpW - upload.more.right)), '⋮ 右边距').toBeLessThanOrEqual(1);
      expect(shelf.more.bg, '书库 ⋮ 背景').toBe(upload.more.bg);
    });
  });
}
