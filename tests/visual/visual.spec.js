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

/* 上传页：owner 身份，/admin/ 渲染上传区 + 管理列表 */
test('admin-upload', async ({ page }) => {
  await setup(page, { viewport: MOBILE, theme: 'light', owner: true });
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  await expect(page).toHaveScreenshot('admin-upload.png', {
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
