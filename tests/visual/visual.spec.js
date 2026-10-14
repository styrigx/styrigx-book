/* book 2.0 视觉回归测试。
 *
 * 覆盖页面（基线等 book-2.0 UI 定稿后生成，见 playwright.config.js）：
 *   1. 书架页：390×844 手机 / 1200px 桌面 × 浅色 / 深色（4 张）
 *   2. 详情底部弹层（手机，浅色）
 *   3. 上传页 /admin/（owner）
 *   4. EPUB 阅读器 /read/?id=epub1
 *   5. PDF 阅读器 /read/?id=pdf1
 *   6. 空状态：owner / visitor
 *
 * 所有 /api/* 走 helpers.mockBookAPIs mock；封面是确定性 SVG 占位；
 * EPUB/PDF 用内存生成的最小固件真实渲染。
 *
 * Hark 规则：goto 用 domcontentloaded + 等具体元素，不用 networkidle，不用 waitForTimeout。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady, expect } = require('./helpers.js');

const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1200, height: 800 };

async function setup(page, { viewport, theme = 'light', owner = false, books } = {}) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setTheme(page, theme);
  await freezeTime(page);
  await mockBookAPIs(page, { owner, books });
}

/* 书架网格渲染完成：网格可见 + 封面图加载完。
 * 注意：封面 <img loading="lazy"> 的加载时机不确定，测试里先强制 eager，
 * 避免截图时封面缺失导致基线不稳定。 */
async function waitShelfReady(page) {
  await expect(page.locator('#bk-grid:not(.hidden) [data-book]').first())
    .toBeVisible({ timeout: 15000 });
  await page.evaluate(() => {
    document.querySelectorAll('#bk-grid img').forEach(img => { img.loading = 'eager'; });
  });
  await page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('#bk-grid img')];
    return imgs.length > 0 && imgs.every(img => img.complete && img.naturalWidth > 0);
  }, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
}

const SHELF = [
  ['shelf-mobile-light', MOBILE, 'light'],
  ['shelf-mobile-dark', MOBILE, 'dark'],
  ['shelf-desktop-light', DESKTOP, 'light'],
  ['shelf-desktop-dark', DESKTOP, 'dark'],
];
/* Gray 要求：书库首页 360×800 浅/深（现有只有 390 宽） */
const MOBILE_360 = { width: 360, height: 800 };
const SHELF_360 = [
  ['shelf-360-light', MOBILE_360, 'light'],
  ['shelf-360-dark', MOBILE_360, 'dark'],
];
for (const [name, viewport, theme] of SHELF) {
  test(name, async ({ page }) => {
    await setup(page, { viewport, theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    await waitShelfReady(page);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}
for (const [name, viewport, theme] of SHELF_360) {
  test(name, async ({ page }) => {
    await setup(page, { viewport, theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    await waitShelfReady(page);
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}
/* Gray 要求：首页滚到底，最后一排书和两行页脚完整露在搜索胶囊上方 */
for (const theme of ['light', 'dark']) {
  test(`shelf-360-bottom-${theme}`, async ({ page }) => {
    await setup(page, { viewport: MOBILE_360, theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    await waitShelfReady(page);
    // 滚到底
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(500);
    await page.evaluate(() => document.fonts.ready);
    // 断言：页脚文字下边缘 ≤ 搜索胶囊上边缘（不被挡住）
    const overlap = await page.evaluate(() => {
      const footerText = document.querySelector('footer .sgx-powered');
      const cap = document.querySelector('.bk-cap');
      if (!footerText || !cap) return { footerText: !!footerText, cap: !!cap };
      const fr = footerText.getBoundingClientRect();
      const cr = cap.getBoundingClientRect();
      return {
        footerBottom: fr.bottom,
        capTop: cr.top,
        ok: fr.bottom <= cr.top,
      };
    });
    expect(overlap.ok, `页脚文字下边缘(${overlap.footerBottom})应≤胶囊上边缘(${overlap.capTop})`).toBe(true);
    await expect(page).toHaveScreenshot(`shelf-360-bottom-${theme}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}

/* 详情底部弹层：点第一本书封面，sheet 打开后截图 */
test('sheet-mobile', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: false });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelfReady(page);
  await page.locator('#bk-grid [data-book]').first().click();
  await expect(page.locator('#sheet-wrap.open')).toHaveCount(1, { timeout: 10000 });
  await expect(page).toHaveScreenshot('sheet-mobile.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* 上传页：owner 身份，/admin/ 只渲染上传区（3.0：管理列表已下线，管理移到书架详情弹层） */
test('admin-upload', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: true });
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  await expect(page).toHaveScreenshot('admin-upload.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* Gray 要求：上传页 360×800 浅/深（现有只有 390 宽） */
for (const theme of ['light', 'dark']) {
  test(`admin-upload-360-${theme}`, async ({ page }) => {
    await setup(page, { viewport: MOBILE_360, theme, owner: true });
    await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
    await expect(page).toHaveScreenshot(`admin-upload-360-${theme}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}

/* 管理页：选中长书名文件后（手机宽度），断言无横向溢出 */
test('admin-upload-longname', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: true });
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const { makeEpub } = require('./fixtures/file-fixtures.js');
  const longName = '了不起的盖茨比英文原版未删节超长书名测试版本.epub';
  await page.setInputFiles('#adm-file', {
    name: longName,
    mimeType: 'application/epub+zip',
    buffer: Buffer.from(makeEpub()),
  });
  await expect(page.locator('#adm-queue [data-q]')).toBeVisible({ timeout: 15000 });
  /* 等解析完成（ready 或 error 都会渲染出卡片） */
  await page.waitForFunction(() => {
    const el = document.querySelector('#adm-queue [data-q] [data-status]');
    return el && !el.textContent.includes('解析');
  }, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '页面不应横向溢出').toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('admin-upload-longname.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* 管理页：滚动后折叠标题只显示当前页标题（手机宽度），断言无横向溢出 */
test('admin-upload-scrolled', async ({ page }) => {
  /* 3.0：admin 页只剩上传区，页面变短；390×844 下最大滚动 40px，达不到
     subpage-head 折叠阈值（head 高 354 × 0.55 ≈ 195）。用 390×600 视口
     （仍是手机宽）才能滚出折叠效果，断言意图不变：滚动 → 折叠触发 + 无横向溢出。 */
  await setup(page, { viewport: { width: 390, height: 600 }, theme: 'light', owner: true });
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForFunction(() => document.body.classList.contains('subpage-scrolled'), { timeout: 5000 });
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, '滚动后页面不应横向溢出').toBeLessThanOrEqual(0);
  await expect(page).toHaveScreenshot('admin-upload-scrolled.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* EPUB 阅读器：foliate-view 用 closed shadow root，外部拿不到 iframe；
 * 但它的渲染 iframe（blob: URL）会出现在 page.frames() 里。
 * 等 blob frame 正文渲染出文字后截图。 */
test('reader-epub', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: false });
  await page.goto('/read/?id=epub1', { waitUntil: 'domcontentloaded' });
  await expect.poll(async () => {
    const f = page.frames().find(fr => fr.url().startsWith('blob:'));
    if (!f) return 0;
    try {
      return await f.evaluate(() => (document.body ? document.body.innerText.length : 0));
    } catch (e) { return 0; }
  }, { timeout: 30000 }).toBeGreaterThan(50);
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('reader-epub.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* PDF 阅读器：pdf.js 渲染固件 PDF，第一页 canvas 有内容后截图 */
test('reader-pdf', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: false });
  await page.goto('/read/?id=pdf1', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => {
    const c = document.querySelector('#bkrd-pdf canvas');
    return c && c.width > 0;
  }, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page).toHaveScreenshot('reader-pdf.png', {
    fullPage: false,
    animations: 'disabled',
  });
});

/* 空状态：owner（带「添加第一本书」CTA）/ visitor */
for (const owner of [true, false]) {
  const name = owner ? 'empty-owner' : 'empty-visitor';
  test(name, async ({ page }) => {
    await setup(page, { viewport: MOBILE, theme: 'light', owner, books: [] });
    await gotoReady(page, '/', '#bk-empty:not(.hidden)');
    await expect(page).toHaveScreenshot(`${name}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}

/* ===== App 化 v1.1 新增：排序与筛选 / 书库设置弹层（360×800 浅/深） =====
 * 断言：右上角有 ×；底部按钮不挡住「布局」选项；主题三项选中态一致。
 * 截图进基线（待站长确认）。
 */
const SHEET_360 = { width: 360, height: 800 };

async function openFilterSheet(page) {
  await page.locator('#bk-filter-btn').click();
  await expect(page.locator('#filter-wrap.open')).toHaveCount(1, { timeout: 10000 });
  await page.evaluate(() => document.fonts.ready);
}

for (const theme of ['light', 'dark']) {
  test(`sheet-filter-360-${theme}`, async ({ page }) => {
    await setup(page, { viewport: SHEET_360, theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    await waitShelfReady(page);
    await openFilterSheet(page);
    // 右上角 × 存在且可见
    const closeBtn = page.locator('#filter-wrap [data-close="filter"].bk-icbtn');
    await expect(closeBtn).toBeVisible();
    // 底部按钮不挡住布局选项：两者 bounding box 不相交
    const overlap = await page.evaluate(() => {
      const seg = document.querySelector('#filter-body .bk-seg');
      const bar = document.querySelector('#filter-wrap .shrink-0.flex.gap-3');
      if (!seg || !bar) return 'missing';
      const r1 = seg.getBoundingClientRect();
      const r2 = bar.getBoundingClientRect();
      const xOverlap = Math.max(0, Math.min(r1.right, r2.right) - Math.max(r1.left, r2.left));
      const yOverlap = Math.max(0, Math.min(r1.bottom, r2.bottom) - Math.max(r1.top, r2.top));
      return xOverlap * yOverlap;
    });
    expect(overlap, '底部按钮不应挡住布局选项').toBe(0);
    await expect(page).toHaveScreenshot(`sheet-filter-360-${theme}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });

  test(`sheet-settings-360-${theme}`, async ({ page }) => {
    await setup(page, { viewport: SHEET_360, theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    await waitShelfReady(page);
    await openFilterSheet(page);
    await page.locator('#filter-gear').click();
    await expect(page.locator('#settings-wrap.open')).toHaveCount(1, { timeout: 10000 });
    await page.evaluate(() => document.fonts.ready);
    // 右上角 × 存在且可见
    const closeBtn = page.locator('#settings-wrap [data-close="settings"].bk-icbtn');
    await expect(closeBtn).toBeVisible();
    // 主题三项：同一行样式类，选中项有可见对勾；三行边框/背景计算值完全相同
    const themeState = await page.evaluate(() => {
      const opts = [...document.querySelectorAll('#settings-wrap .bk-theme-opt')];
      if (opts.length !== 3) return 'count:' + opts.length;
      const cls = opts.map(o => o.className);
      const sameBase = cls.every(c => c.includes('sheet-opt') && c.includes('bk-theme-opt'));
      const checks = opts.map(o => {
        const check = o.querySelector('.bk-theme-check');
        return check ? !check.classList.contains('hidden') : 'missing';
      });
      // Gray 要求：三行的边框和背景计算值相同（选中仅文字主色+对勾，不加边框）
      const styles = opts.map(o => {
        const s = getComputedStyle(o);
        return {
          bg: s.backgroundColor,
          btw: s.borderTopWidth, brw: s.borderRightWidth,
          bbw: s.borderBottomWidth, blw: s.borderLeftWidth,
          bts: s.borderTopStyle,
        };
      });
      const sameStyle = styles.every(st =>
        st.bg === styles[0].bg && st.btw === styles[0].btw &&
        st.brw === styles[0].brw && st.bbw === styles[0].bbw &&
        st.blw === styles[0].blw && st.bts === styles[0].bts);
      return { sameBase, checks, sameStyle, styles };
    });
    expect(themeState.sameBase, '主题三项应统一样式').toBe(true);
    expect(themeState.checks.filter(Boolean).length, '应恰有一项选中').toBe(1);
    expect(themeState.sameStyle, '三行边框/背景计算值应完全相同: ' + JSON.stringify(themeState.styles)).toBe(true);
    await expect(page).toHaveScreenshot(`sheet-settings-360-${theme}.png`, {
      fullPage: false,
      animations: 'disabled',
    });
  });
}
