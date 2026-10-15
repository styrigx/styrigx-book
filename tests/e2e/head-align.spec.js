/* Book 标题区对齐主站「我的文件」E2E（#33 最终任务）。
 *
 * 主站 CSS 来源（space-b1-mustfix）：
 * - .subpage-title: assets/css/main.css:895
 *   { font-size:40px; font-weight:800; letter-spacing:-0.02em; line-height:1.15; color:var(--m-primary) }
 * - .subpage-back: assets/css/main.css:872-882
 *   { position:absolute; left:16px; bottom:var(--sgx-head-btn-gap); width:44px; height:44px }
 * - .subpage-actions: assets/css/main.css:896
 *   { position:absolute; right:16px; bottom:var(--sgx-head-btn-gap) }
 * - .subpage-head（手机）: assets/css/main.css:856-859
 *   { min-height:var(--head-h,max(200px,25svh)); justify-content:flex-end }
 *
 * 断言：
 * 1. 书库首页与上传页的标题区几何一致（≤1px）。
 * 2. 关键 CSS 值与主站一致。
 * 3. 展开态下 ← 和 ⋮ 的顶部都在大标题底部之下。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

async function setup(page) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
}

async function getGeom(page, url, readySel, moreSel) {
  await setup(page);
  await gotoReady(page, url, readySel);
  await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
  return page.evaluate(({ moreSel }) => {
    const q = s => document.querySelector(s);
    const r = s => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: b.top, left: b.left, right: b.right, bottom: b.bottom, width: b.width, height: b.height }; };
    const cs = s => { const e = q(s); if (!e) return null; const st = getComputedStyle(e); return { fontSize: st.fontSize, fontWeight: st.fontWeight, color: st.color }; };
    return {
      title: { ...r('.subpage-title'), ...cs('.subpage-title') },
      back: r('.subpage-back'),
      more: r(moreSel),
      headH: q('[data-subpage-head]')?.getBoundingClientRect().height || null,
    };
  }, { moreSel });
}

for (const [vpName, vp] of [['phone-412', { width: 412, height: 915 }], ['phone-360', { width: 360, height: 800 }]]) {
  test.describe(vpName, () => {
    test.use({ viewport: vp });

    test('书库与上传页标题区几何一致（≤1px）', async ({ page }) => {
      const shelf = await getGeom(page, '/', '#bk-grid:not(.hidden)', '#bk-menu-btn');
      const upload = await getGeom(page, '/admin/', '#adm-main:not(.hidden)', '.subpage-more');
      for (const k of ['top', 'left', 'width', 'height']) {
        expect(Math.abs(shelf.back[k] - upload.back[k]), `back.${k} 差值`).toBeLessThanOrEqual(1);
        expect(Math.abs(shelf.more[k] - upload.more[k]), `more.${k} 差值`).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(shelf.headH - upload.headH), '标题区高度差值').toBeLessThanOrEqual(1);
      expect(Math.abs(shelf.title.top - upload.title.top), '大标题 top 差值').toBeLessThanOrEqual(1);
    });

    test('关键 CSS 与主站一致（main.css:895/872/896）', async ({ page }) => {
      const g = await getGeom(page, '/', '#bk-grid:not(.hidden)', '#bk-menu-btn');
      // .subpage-title: font-size 40px, font-weight 800（主站 main.css:895）
      expect(g.title.fontSize, '标题字号').toBe('40px');
      expect(g.title.fontWeight, '标题字重').toBe('800');
      // .subpage-back/.subpage-more: 44×44（主站 main.css:874,902）
      expect(g.back.width, '← 宽').toBe(44);
      expect(g.back.height, '← 高').toBe(44);
      expect(g.more.width, '⋮ 宽').toBe(44);
      expect(g.more.height, '⋮ 高').toBe(44);
      // ← 左 16px（相对于 header），⋮ 右 16px（相对于 header）；
      // header 在 main(px-4) 内，所以视口边距为 32px。断言两者对称。
      const vpW = vp.width;
      expect(Math.abs(g.back.left - (vpW - g.more.right)), '←/⋮ 边距应对称').toBeLessThanOrEqual(2);
    });

    test('展开态 ←/⋮ 在大标题下方', async ({ page }) => {
      for (const [url, ready, more] of [['/', '#bk-grid:not(.hidden)', '#bk-menu-btn'], ['/admin/', '#adm-main:not(.hidden)', '.subpage-more']]) {
        const g = await getGeom(page, url, ready, more);
        expect(g.back.top, `${url} ← 应在大标题底部之下`).toBeGreaterThan(g.title.bottom);
        expect(g.more.top, `${url} ⋮ 应在大标题底部之下`).toBeGreaterThan(g.title.bottom);
      }
    });
  });
}
