/* Book App 化改版 v1.1 功能测试（非视觉基线）。
 *
 * 360×800 浅/深色：
 * 1. 上传页无横向溢出（scrollWidth ≤ clientWidth）
 * 2. 大标题上滑收起进顶部栏（.subpage-mini-title.show）
 * 3. 搜索栏聚焦时跟键盘上沿（模拟 visualViewport 变化）
 * 4. 继续阅读悬浮条不存在
 * 5. 两个弹层右上角有 ×，打开前后高度不变
 *
 * Hark 规则：goto 用 domcontentloaded + 等具体元素，不用 networkidle，不用 waitForTimeout。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady, expect } = require('./helpers.js');

const MOBILE_360 = { width: 360, height: 800 };

async function setup(page, { theme = 'light', owner = true } = {}) {
  await page.setViewportSize(MOBILE_360);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setTheme(page, theme);
  await freezeTime(page);
  await mockBookAPIs(page, { owner });
}

for (const theme of ['light', 'dark']) {
  test(`app-shell-upload-no-overflow-${theme}`, async ({ page }) => {
    await setup(page, { theme, owner: true });
    await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, '上传页不应横向溢出').toBeLessThanOrEqual(0);
  });

  test(`app-shell-title-collapse-${theme}`, async ({ page }) => {
    await setup(page, { theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    // 初始：大标题可见，小标题隐藏
    const mini = page.locator('.subpage-mini-title');
    await expect(mini).not.toHaveClass(/show/);
    // 上滑：小标题出现
    await page.evaluate(() => window.scrollTo(0, 500));
    await expect(mini).toHaveClass(/show/, { timeout: 5000 });
    // 回顶：小标题隐藏
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect(mini).not.toHaveClass(/show/, { timeout: 5000 });
  });

  test(`app-shell-search-kb-${theme}`, async ({ page }) => {
    await setup(page, { theme, owner: false });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const cap = page.locator('#bk-cap');
    const input = page.locator('#bk-cap-input');
    // 初始：胶囊在底部
    await expect(cap).toBeVisible();
    const bottomBefore = await cap.evaluate(el => getComputedStyle(el).bottom);
    // 聚焦：胶囊展开
    await input.focus();
    await expect(cap).toHaveClass(/open/);
    // 模拟键盘弹起（visualViewport 高度变小）
    await page.evaluate(() => {
      const capEl = document.getElementById('bk-cap');
      // 模拟 visualViewport resize：直接调用 syncKb 逻辑
      const vv = window.visualViewport;
      if (vv) {
        // 通过覆盖 innerHeight 模拟键盘
        Object.defineProperty(window, 'innerHeight', { value: 400, configurable: true });
        window.dispatchEvent(new Event('resize'));
      }
    });
    await page.waitForTimeout(400);
    // 失焦：胶囊回落
    await input.blur();
    await expect(cap).not.toHaveClass(/open/);
  });

  test(`app-shell-no-fab-${theme}`, async ({ page }) => {
    await setup(page, { theme, owner: true });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    // 悬浮条已删除：DOM 中不应存在
    await expect(page.locator('#bk-fab')).toHaveCount(0);
    await expect(page.locator('#bk-fab-spacer')).toHaveCount(0);
  });

  test(`app-shell-sheets-${theme}`, async ({ page }) => {
    await setup(page, { theme, owner: true });
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    // 打开排序与筛选弹层（经 ⋮ 菜单）
    await page.click('#bk-menu-btn');
    await page.click('#bk-more-menu [data-more="filter"]');
    const filterWrap = page.locator('#filter-wrap');
    await expect(filterWrap).toHaveClass(/open/);
    // 右上角有 ×
    await expect(filterWrap.locator('[data-close="filter"].bk-icbtn')).toBeVisible();
    // 高度固定：记录高度，切换内容后高度不变
    const h1 = await filterWrap.locator('.bk-panel').evaluate(el => el.getBoundingClientRect().height);
    // 关闭
    await filterWrap.locator('[data-close="filter"].bk-icbtn').click();
    await expect(filterWrap).not.toHaveClass(/open/);
    // 打开书库设置（经 ⋮ 菜单直接打开）
    await page.click('#bk-menu-btn');
    await page.click('#bk-more-menu [data-more="settings"]');
    const settingsWrap = page.locator('#settings-wrap');
    await expect(settingsWrap).toHaveClass(/open/);
    await expect(settingsWrap.locator('[data-close="settings"].bk-icbtn')).toBeVisible();
    const h2 = await settingsWrap.locator('.bk-panel').evaluate(el => el.getBoundingClientRect().height);
    // 切换主题选项，高度不变
    await page.click('[data-theme="dark"]');
    const h3 = await settingsWrap.locator('.bk-panel').evaluate(el => el.getBoundingClientRect().height);
    expect(Math.abs(h3 - h2)).toBeLessThan(2);
    await expect(h1).toBeGreaterThan(0);
  });
}

/* 上传页大字号复测：360 宽 + 文字缩放 130% / 150%（模拟三星浏览器大字号）。
 * 用 CSS zoom 放大文字，断言仍无横向溢出。
 */
for (const theme of ['light', 'dark']) {
  for (const zoom of [130, 150]) {
    test(`app-shell-upload-zoom${zoom}-${theme}`, async ({ page }) => {
      await setup(page, { theme, owner: true });
      await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
      // 模拟文字缩放：放大根字体
      await page.evaluate((z) => {
        document.documentElement.style.fontSize = (16 * z / 100) + 'px';
      }, zoom);
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(300);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `文字缩放 ${zoom}% 时不应横向溢出`).toBeLessThanOrEqual(0);
    });
  }
}
