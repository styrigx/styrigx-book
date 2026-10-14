/* 阅读器 404 回归测试（hotfix v1.2）。
 *
 * 根因：#29 把 readBase 改成 {{ $readBase | jsonify }}，在 <script> 里被
 * Go 模板 JS 上下文二次编码，变成 readBase = "\"/read/\""（值带引号）。
 * readUrl() 拼出 "/read/"?id=… → 浏览器解析成 /%22/read/%22?id=… → 404。
 *
 * 改前红：点悬浮条/详情弹层/最近阅读条，最终 URL pathname 含 %22，
 *   阅读器 404。
 * 改后绿：pathname 必须是 /read/，阅读器加载出来。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, gotoReady, expect } = require('./helpers.js');

const BOOKS = [
  {
    id: 'epub1',
    title: '了不起的盖茨比',
    author: 'F. Scott Fitzgerald',
    cover_key: 'cover-epub1',
    format: 'epub',
    size: 512340,
    pages: 218,
    tags: [],
    created_at: '2026-09-20T10:00:00Z',
    visibility: 'public',
    in_shelf: 1,
    percent: 42,
    progress_updated_at: '2026-10-01T10:00:00Z',
  },
];

async function setup(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockBookAPIs(page, { owner: true, books: BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden) [data-book]');
}

function assertReaderUrl(page) {
  const u = new URL(page.url());
  expect(u.pathname, `pathname 不能含 %22，实际 ${u.pathname}`).toBe('/read/');
  expect(u.searchParams.get('id')).toBe('epub1');
}

async function assertReaderLoaded(page) {
  // 阅读器页面加载出来，不是 404（404 页标题含"404"且无阅读器容器）
  await expect(page.locator('body')).not.toContainText('页面不存在', { timeout: 10000 });
}

test('悬浮条：点继续阅读进入 /read/，不是 /%22/read/%22', async ({ page }) => {
  await setup(page);
  const fab = page.locator('#bk-fab:not(.hidden)');
  await expect(fab).toBeVisible({ timeout: 10000 });
  await fab.click();
  await page.waitForURL('**/read/**', { timeout: 10000 });
  assertReaderUrl(page);
  await assertReaderLoaded(page);
});

test('详情弹层：点继续阅读进入 /read/', async ({ page }) => {
  await setup(page);
  await page.locator('#bk-grid [data-book="epub1"]').click();
  const sheet = page.locator('#sheet-wrap.open');
  await expect(sheet.first()).toBeVisible({ timeout: 10000 });
  const link = page.locator('a:has-text("继续阅读"), a:has-text("开始阅读")').first();
  await expect(link).toBeVisible({ timeout: 10000 });
  await link.click();
  await page.waitForURL('**/read/**', { timeout: 10000 });
  assertReaderUrl(page);
  await assertReaderLoaded(page);
});

test('最近阅读条：点书 → 弹层 → 继续阅读进入 /read/', async ({ page }) => {
  await setup(page);
  const stripItem = page.locator('#bk-strip [data-book="epub1"]');
  await expect(stripItem).toBeVisible({ timeout: 10000 });
  await stripItem.click();
  const sheet = page.locator('#sheet-wrap.open');
  await expect(sheet.first()).toBeVisible({ timeout: 10000 });
  const link = page.locator('a:has-text("继续阅读"), a:has-text("开始阅读")').first();
  await expect(link).toBeVisible({ timeout: 10000 });
  await link.click();
  await page.waitForURL('**/read/**', { timeout: 10000 });
  assertReaderUrl(page);
  await assertReaderLoaded(page);
});
