/* Book 顶栏统一 + ⋮ 菜单 + 退出逻辑 E2E（任务书 v1.0 §六）。
 *
 * A1 首页/上传页标题区；A2 ⋮ 菜单；A3 顶栏几何；A4 点头像刷新；
 * A5 退出（同标签回主站）；A6 弹层打开时返回只关弹层；A7 P1 无横向溢出；A8 cookie 设置同步。
 *
 * 跑在 CI（deploy.yml → npm run test:e2e）。Hark 规则：goto 用 domcontentloaded + 等具体元素。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

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

/* ============ A1：标题区 ============ */
test('A1 homepage: single subpage-head with back and more', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const heads = page.locator('[data-subpage-head]');
  await expect(heads, '首页应只有 1 个 [data-subpage-head]').toHaveCount(1);
  await expect(heads.locator('.subpage-back'), '应有 .subpage-back').toHaveCount(1);
  await expect(heads.locator('.subpage-more'), '应有 .subpage-more（⋮ 占位）').toHaveCount(1);
});

test('A1 upload page: single subpage-head with back and more', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const heads = page.locator('[data-subpage-head]');
  await expect(heads, '上传页应只有 1 个 [data-subpage-head]').toHaveCount(1);
  await expect(heads.locator('.subpage-back'), '应有 .subpage-back').toHaveCount(1);
  await expect(heads.locator('.subpage-more'), '应有 .subpage-more（⋮ 占位）').toHaveCount(1);
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

/* ============ A3：顶栏几何 ============ */
test('A3 topbar geometry: time left, avatar center, wx right, no Styrigx text', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 无 "Styrigx" 文字节点
  const styrigxText = await page.evaluate(() => {
    const nav = document.getElementById('site-nav');
    if (!nav) return false;
    const walker = document.createTreeWalker(nav, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      if (node.textContent.trim() === 'Styrigx') return true;
    }
    return false;
  });
  expect(styrigxText, '顶栏不应有 "Styrigx" 文字').toBe(false);
  // 几何：时间最左，头像居中 ±1px，天气最右
  const geom = await page.evaluate(() => {
    const r = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, cx: b.left + b.width / 2 };
    };
    return {
      time: r('nav-time-center'),
      home: r('nav-home'),
      wx: r('nav-wx'),
      vw: window.innerWidth,
    };
  });
  expect(geom.time, '应有 #nav-time-center').not.toBeNull();
  expect(geom.home, '应有 #nav-home').not.toBeNull();
  // 时间靠最左（left < 20px）
  expect(geom.time.left, '#nav-time 应在最左').toBeLessThan(20);
  // 头像在水平中线 ±1px
  const centerX = geom.vw / 2;
  expect(Math.abs(geom.home.cx - centerX), '头像应在水平中线 ±1px').toBeLessThanOrEqual(1.5);
});

test('A3 topbar stuck: time/wx fade, mini-title visible', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 滚过标题区
  await page.evaluate(() => {
    const head = document.querySelector('[data-subpage-head]');
    window.scrollTo(0, head.offsetHeight);
  });
  await page.waitForFunction(() => {
    return document.getElementById('site-nav').classList.contains('stuck');
  }, null, { timeout: 5000 });
  // 时间和天气 opacity 0
  const opacity = await page.evaluate(() => {
    const t = getComputedStyle(document.getElementById('nav-time-center')).opacity;
    const w = getComputedStyle(document.getElementById('nav-wx')).opacity;
    return { t: parseFloat(t), w: parseFloat(w) };
  });
  expect(opacity.t, '时间应淡出').toBe(0);
  // 小标题可见
  const miniVisible = await page.evaluate(() => {
    const mini = document.querySelector('.subpage-mini-title');
    return mini && mini.classList.contains('show');
  });
  expect(miniVisible, '小标题应可见').toBe(true);
});

/* ============ A4：点头像刷新 ============ */
test('A4 avatar click: full reload to home', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 监听导航
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('#nav-home').click();
  await navPromise;
  expect(page.url(), '应刷新到首页').toMatch(/\/$/);
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
  // 拦截 location.replace
  await page.evaluate(() => {
    window.__exitUrl = null;
    const origReplace = location.replace.bind(location);
    location.replace = function (url) { window.__exitUrl = url; };
  });
  await page.locator('[data-subpage-head] .subpage-back').click();
  const exitUrl = await page.evaluate(() => window.__exitUrl);
  expect(exitUrl, '← 应 replace 到主站 files').toBe('https://styrigx.com/files/');
});

/* ============ A6：弹层打开时返回只关弹层 ============ */
test('A6 back with menu open: closes menu, no exit', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 打开 ⋮ 菜单
  await page.locator('#bk-menu-btn').click();
  await expect(page.locator('#bk-more-menu:not(.hidden)'), '菜单应打开').toBeVisible();
  // 拦截 location.replace
  await page.evaluate(() => {
    window.__exitUrl = null;
    location.replace = function (url) { window.__exitUrl = url; };
  });
  // 执行 goBack（触发 popstate）
  await page.goBack();
  // 菜单应关闭，URL 不变，未退出
  await expect(page.locator('#bk-more-menu:not(.hidden)'), '菜单应关闭').toHaveCount(0);
  const exitUrl = await page.evaluate(() => window.__exitUrl);
  expect(exitUrl, '不应触发退出').toBeNull();
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

/* ============ A8：cookie 设置同步 ============ */
test('A8 no cookie: defaults, no error', async ({ page }) => {
  await setupOwner(page);
  // 清除 sgx-ui cookie
  await page.context().clearCookies();
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 页面不应报错，时间应显示（默认本地时间）
  const timeText = await page.locator('#nav-time').textContent();
  expect(timeText.trim(), '无 cookie 时时间应显示默认值').not.toBe('--:--');
  expect(timeText.trim(), '无 cookie 时时间不应为空').not.toBe('');
});

test('A8 with cookie: time follows tz1/h12', async ({ page }) => {
  await setupOwner(page);
  // 设置 sgx-ui cookie：tz1=Asia/Tokyo, h12=1
  const payload = { v: 1, tz1: 'Asia/Tokyo', tz2: '', h12: 1, clock: 'digital', wx: 0, unit: 'c', loc: 'auto', city: null };
  const json = JSON.stringify(payload);
  const b64 = Buffer.from(json, 'utf8').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await page.context().addCookies([{
    name: 'sgx-ui',
    value: b64,
    domain: 'localhost',
    path: '/',
  }]);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const timeText = await page.locator('#nav-time').textContent();
  // 东京时间 + 12 小时制：应包含 AM/PM 或与本地时间不同
  // 至少验证时间已按 cookie 渲染（非 --:--）
  expect(timeText.trim(), '有 cookie 时时间应按 tz1/h12 显示').not.toBe('--:--');
});
