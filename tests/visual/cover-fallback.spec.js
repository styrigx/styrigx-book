/* 封面 403 回落测试（hotfix v1.1）。
 *
 * 红绿要求：
 * - 站长：私有书封面必须请求 /api/private/cover；403 时回落到生成封面（.bk-gen），无裂图 img。
 * - 访客：封面请求 /api/cover（不走 private）；403 时同样回落到生成封面。
 *
 * 改前红：coverUrl 不分站长/访客（都走 /api/cover），且 img 无 onerror，
 *   403 时浏览器显示裂图图标，不出现 .bk-gen。
 *
 * 注意：img 403 后会被 onerror 立刻替换为 .bk-gen，所以用 route 拦截记录
 * 实际请求的 URL 来断言路由，而不是去读已经消失的 img[src]。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, gotoReady, expect } = require('./helpers.js');

const BOOKS = [
  {
    id: 'priv1',
    title: '私有书回落测试',
    author: '测试作者',
    cover_key: 'covers/priv1.webp',
    format: 'epub',
    size: 12345,
    pages: 100,
    tags: [],
    created_at: '2026-10-01T10:00:00Z',
    visibility: 'private',
    in_shelf: 1,
  },
];

async function setup403(page, { owner, coverPattern }, onRequest) {
  await mockBookAPIs(page, { owner, books: BOOKS });
  /* 后注册优先，覆盖 helpers 里的 200 mock */
  await page.route(coverPattern, (route) => {
    if (onRequest) onRequest(route.request().url());
    route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"forbidden"}' });
  });
}

async function waitGrid(page) {
  await gotoReady(page, '/', '#bk-grid:not(.hidden) [data-book]');
  await page.evaluate(() => {
    document.querySelectorAll('#bk-grid img').forEach((img) => { img.loading = 'eager'; });
  });
}

test('站长：私有书封面走 /api/private/cover，403 回落生成封面', async ({ page }) => {
  let requestedUrl = '';
  await setup403(page, { owner: true, coverPattern: '**/api/private/cover*' }, (u) => { requestedUrl = u; });
  await waitGrid(page);

  const card = page.locator('#bk-grid [data-book="priv1"]');
  /* 站长必须请求私有路径 */
  await expect.poll(() => requestedUrl, { timeout: 10000 }).toContain('/api/private/cover?key=');
  /* 403 后回落：出现生成封面，img 被替换掉，不留裂图 */
  await expect(card.locator('.bk-gen')).toBeVisible({ timeout: 10000 });
  await expect(card.locator('img')).toHaveCount(0);
});

test('访客：封面走 /api/cover（不走 private），403 回落生成封面', async ({ page }) => {
  let requestedUrl = '';
  let privateHit = false;
  await setup403(page, { owner: false, coverPattern: '**/api/cover*' }, (u) => { requestedUrl = u; });
  /* 访客绝不能碰私有路径 */
  await page.route('**/api/private/cover*', (route) => {
    privateHit = true;
    route.fulfill({ status: 403, body: '{}' });
  });
  await waitGrid(page);

  const card = page.locator('#bk-grid [data-book="priv1"]');
  /* 访客走公开路径 */
  await expect.poll(() => requestedUrl, { timeout: 10000 }).toContain('/api/cover?key=');
  expect(privateHit).toBe(false);
  /* 403 后回落：出现生成封面，img 被替换掉 */
  await expect(card.locator('.bk-gen')).toBeVisible({ timeout: 10000 });
  await expect(card.locator('img')).toHaveCount(0);
});
