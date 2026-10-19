/* Book 顶栏统一 + ⋮ 菜单 + 退出逻辑 E2E（任务书 v1.0 §六）。
 *
 * A1 首页/上传页标题区；A2 ⋮ 菜单；A3 顶栏几何；A4 点头像刷新；
 * A5 退出（同标签回主站）；A6 弹层打开时返回只关弹层；A7 P1 无横向溢出；A8 cookie 设置同步。
 *
 * 跑在 CI（deploy.yml → npm run test:e2e）。Hark 规则：goto 用 domcontentloaded + 等具体元素。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady, BOOKS } = require('../visual/helpers.js');

// A3 需要页面可滚动：用 3 倍书量撑高页面
const MANY_BOOKS = [...BOOKS, ...BOOKS, ...BOOKS];

async function setupOwner(page) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
}

async function setupVisitor(page) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: false });
}

/* ============ A1：标题区与顶栏（v3：标题区不再有按钮，← ⋮ 在顶栏长条里） ============ */
test('A1 homepage: head has no buttons, topbar has back and menu', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const heads = page.locator('[data-subpage-head]');
  await expect(heads, '首页应只有 1 个 [data-subpage-head]').toHaveCount(1);
  await expect(heads.locator('button'), '标题区内不应有按钮').toHaveCount(0);
  await expect(page.locator('.sgx-topbar .sgx-tb-pill .sgx-tb-back'), '顶栏长条应有返回').toBeVisible();
  await expect(page.locator('.sgx-topbar #bk-menu-btn'), '顶栏应有 ⋮').toBeVisible();
  await expect(page.locator('.sgx-topbar .sgx-tb-nav'), '顶栏应有左圆九宫格').toBeVisible();
  await expect(page.locator('.sgx-topbar .sgx-tb-me'), '顶栏应有右圆头像').toBeVisible();
});

test('A1 upload page: head has no buttons, topbar has back and menu', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const heads = page.locator('[data-subpage-head]');
  await expect(heads, '上传页应只有 1 个 [data-subpage-head]').toHaveCount(1);
  await expect(heads.locator('button'), '标题区内不应有按钮').toHaveCount(0);
  await expect(page.locator('.sgx-topbar .sgx-tb-pill .sgx-tb-back'), '顶栏长条应有返回').toBeVisible();
  await expect(page.locator('.sgx-topbar #bk-menu-btn'), '顶栏应有 ⋮').toBeVisible();
});

/* ============ A2：⋮ 菜单 ============ */
test('A2 visitor menu: 3 items in order, no filter-btn/gear', async ({ page }) => {
  await setupVisitor(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 无 #bk-filter-btn 和 #filter-gear
  await expect(page.locator('#bk-filter-btn'), '不应有 #bk-filter-btn').toHaveCount(0);
  await expect(page.locator('#filter-gear'), '不应有 #filter-gear').toHaveCount(0);
  // ⋮ 按钮可见（访客也显示）
  const btn = page.locator('#bk-menu-btn');
  await expect(btn, '访客应看到 ⋮ 按钮').toBeVisible();
  await btn.click();
  const menu = page.locator('#bk-more-menu:not(.hidden)');
  await expect(menu, '菜单应弹出').toBeVisible();
  const items = menu.locator('.bk-menu-item');
  await expect(items, '访客应看到 3 项').toHaveCount(3);
  const texts = await items.allTextContents();
  expect(texts[0].trim()).toBe('排序与筛选');
  expect(texts[1].trim()).toBe('书库设置');
  expect(texts[2].trim()).toBe('随机打开一本');
});

test('A2 owner menu: 5 items in order', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const btn = page.locator('#bk-menu-btn');
  await expect(btn, '站长应看到 ⋮ 按钮').toBeVisible();
  await btn.click();
  const menu = page.locator('#bk-more-menu:not(.hidden)');
  await expect(menu, '菜单应弹出').toBeVisible();
  const items = menu.locator('.bk-menu-item');
  await expect(items, '站长应看到 5 项').toHaveCount(5);
  const texts = await items.allTextContents();
  expect(texts[0].trim()).toBe('排序与筛选');
  expect(texts[1].trim()).toBe('书库设置');
  expect(texts[2].trim()).toBe('上传书籍');
  expect(texts[3].trim()).toBe('随机打开一本');
  expect(texts[4].trim()).toBe('为无封面的书提取封面');
});

/* A3（v1.0 卡片几何/滚动/卡片按钮/标题区结构）已由 topbar-spec.spec.js（v2.0）覆盖，此处删除 */

/* ============ A4：点 Styrigx 回书库首页（v3：品牌按钮只包着绝对居中的 Styrigx 文字，与主站一致，点文字触发） ============ */
test('A4 brand click: goes to library home', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  await Promise.all([page.waitForURL(/\/$/), page.locator('.sgx-tb-brand .sgx-tb-text').click()]);
  await expect(page.locator('#bk-grid'), '应回到书库首页').toBeAttached();
});

/* ============ A5：退出逻辑 ============ */
test('A5 exit guard installed on homepage', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const hasGuard = await page.evaluate(() => {
    return !!(history.state && history.state.sgxGuard);
  });
  expect(hasGuard, '首页应安装 sgxGuard 守卫').toBe(true);
});

test('A5 back button exits to host files', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 拦截到 styrigx.com 的导航（location.replace 无法在 Chromium 里 stub）
  let navUrl = null;
  await page.route('https://styrigx.com/**', route => {
    navUrl = route.request().url();
    route.abort();
  });
  await page.locator('.sgx-tb-back').click();
  // 等待导航尝试
  await page.waitForTimeout(800);
  expect(navUrl, '← 应导航到主站 files').toBe('https://styrigx.com/files/');
});

test('A5b stale sgx-exit-fired does not block exit', async ({ page }) => {
  await setupOwner(page);
  // 页面加载前先写入旧的 sgx-exit-fired 标记（模拟第一次退出后的会话）
  await page.addInitScript(() => {
    sessionStorage.setItem('sgx-exit-fired', '1');
  });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 拦截到 styrigx.com 的导航（location.replace 无法在 Chromium 里 stub）
  let navUrl = null;
  await page.route('https://styrigx.com/**', route => {
    navUrl = route.request().url();
    route.abort();
  });
  await page.locator('.sgx-tb-back').click();
  // 等待导航尝试
  await page.waitForTimeout(800);
  expect(navUrl, '← 应导航到主站 files（旧标记不应拦截）').toBe('https://styrigx.com/files/');
});

/* ============ A6：弹层打开时返回只关弹层 ============ */
test('A6 back with menu open: closes menu, no exit', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 打开 ⋮ 菜单
  await page.locator('#bk-menu-btn').click();
  await expect(page.locator('#bk-more-menu:not(.hidden)'), '菜单应打开').toBeVisible();
  // 拦截到 styrigx.com 的导航（location.replace 无法在 Chromium 里 stub）
  let navUrl = null;
  await page.route('https://styrigx.com/**', route => {
    navUrl = route.request().url();
    route.abort();
  });
  // 执行 goBack（触发 popstate）
  await page.goBack();
  // 菜单应关闭，URL 不变，未退出
  await expect(page.locator('#bk-more-menu:not(.hidden)'), '菜单应关闭').toHaveCount(0);
  await page.waitForTimeout(500);
  expect(navUrl, '不应触发退出').toBeNull();
  expect(page.url(), 'URL 不应变').toMatch(/\/$/);
});

/* ============ A7：P1 无横向溢出 ============ */
test('A7 no horizontal overflow: homepage', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
  expect(overflow, '首页 scrollWidth 应 <= clientWidth').toBe(true);
});

test('A7 no horizontal overflow: upload page', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const overflow = await page.evaluate(() => {
    return document.documentElement.scrollWidth <= document.documentElement.clientWidth;
  });
  expect(overflow, '上传页 scrollWidth 应 <= clientWidth').toBe(true);
});

/* ============ A8：cookie 设置同步（时间/天气已删除，本节保留占位） ============ */
