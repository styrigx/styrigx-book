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

/* ============ A1：标题区 ============ */
test('A1 homepage: single subpage-head with back and functional menu', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const heads = page.locator('[data-subpage-head]');
  await expect(heads, '首页应只有 1 个 [data-subpage-head]').toHaveCount(1);
  await expect(heads.locator('.subpage-back'), '应有 .subpage-back').toHaveCount(1);
  // 首页的 ⋮ 是功能菜单 #bk-menu-btn（非 .subpage-more 占位），设计意图确认
  await expect(heads.locator('#bk-menu-btn'), '首页应有 #bk-menu-btn 功能菜单').toHaveCount(1);
  await expect(heads.locator('.subpage-more'), '首页不应有 .subpage-more 占位').toHaveCount(0);
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

/* ============ A3：顶栏卡片几何（v1.0） ============ */
for (const lang of ['zh', 'en']) {
  test(`A3 topbar geometry [${lang}]: card 16/16/16/52, avatar 12px from card left`, async ({ page }) => {
    await setupOwner(page);
    const url = lang === 'en' ? '/en/' : '/';
    await gotoReady(page, url, '#bk-grid:not(.hidden)');
    // 旧元素不应存在
    for (const id of ['#nav-time', '#nav-wx', '#dex-clock-pop', '#nav-time-center']) {
      await expect(page.locator(id), `不应有 ${id}`).toHaveCount(0);
    }
    // 品牌文字不翻译
    const brandText = await page.locator('.sgx-topcard-text').textContent();
    expect(brandText.trim(), '品牌文字应为 Styrigx（不翻译）').toBe('Styrigx');
    const geom = await page.evaluate(() => {
      const card = document.querySelector('.sgx-topcard');
      const cb = card.getBoundingClientRect();
      const ccs = getComputedStyle(card);
      const img = card.querySelector('.sgx-topcard-avatar');
      const ib = img.getBoundingClientRect();
      // 用 Range 量文字（精确到字形）
      const text = card.querySelector('.sgx-topcard-text');
      const range = document.createRange();
      range.selectNodeContents(text);
      const rb = range.getBoundingClientRect();
      return {
        cardLeft: cb.left,
        cardRight: window.innerWidth - cb.right,
        cardTop: cb.top,
        cardH: cb.height,
        cardRadius: ccs.borderRadius,
        cardCy: cb.top + cb.height / 2,
        avatarLeftOffset: ib.left - cb.left,
        gap: rb.left - ib.right,
        avatarCy: ib.top + ib.height / 2,
        textCy: rb.top + rb.height / 2,
        vw: window.innerWidth,
      };
    });
    // 卡片：left 16±1，right 16±1，top 16±1，height 52±1
    expect(Math.abs(geom.cardLeft - 16), '卡片左边缘应在 16±1px').toBeLessThanOrEqual(1);
    expect(Math.abs(geom.cardRight - 16), '卡片右边缘应在 16±1px').toBeLessThanOrEqual(1);
    expect(Math.abs(geom.cardTop - 16), '卡片上边缘应在 16±1px').toBeLessThanOrEqual(1);
    expect(Math.abs(geom.cardH - 52), '卡片高度应在 52±1px').toBeLessThanOrEqual(1);
    expect(geom.cardRadius, '卡片圆角应为 26px').toBe('26px');
    // 头像距卡片左边缘 12±1
    expect(Math.abs(geom.avatarLeftOffset - 12), '头像距卡片左边缘应在 12±1px').toBeLessThanOrEqual(1);
    // 头像右到文字左 8±1
    expect(Math.abs(geom.gap - 8), '头像到文字间距应在 8±1px').toBeLessThanOrEqual(1);
    // 头像和文字中心与卡片中心垂直误差 ≤1
    expect(Math.abs(geom.avatarCy - geom.cardCy), '头像垂直居中偏差').toBeLessThanOrEqual(1);
    expect(Math.abs(geom.textCy - geom.cardCy), '文字垂直居中偏差').toBeLessThanOrEqual(1);
  });
}

test('A3 topbar stuck: brand fades, mini-title visible, card buttons appear', async ({ page }) => {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 滚过标题区（400px 超过阈值）
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForFunction(() => {
    return document.body.classList.contains('sgx-stuck');
  }, null, { timeout: 5000 });
  // 等 opacity transition (.2s) 完成
  await page.waitForFunction(() => {
    const t = parseFloat(getComputedStyle(document.querySelector('.sgx-topcard-brand')).opacity);
    return t === 0;
  }, null, { timeout: 5000 });
  // 品牌组 opacity 0 且不可点
  const brand = await page.evaluate(() => {
    const b = document.querySelector('.sgx-topcard-brand');
    return {
      opacity: parseFloat(getComputedStyle(b).opacity),
      pointerEvents: getComputedStyle(b).pointerEvents,
    };
  });
  expect(brand.opacity, '品牌组应淡出').toBe(0);
  expect(brand.pointerEvents, '品牌组不应响应点击').toBe('none');
  // 小标题可见
  const miniVisible = await page.evaluate(() => {
    const mini = document.querySelector('.subpage-mini-title');
    return mini && mini.classList.contains('show');
  });
  expect(miniVisible, '小标题应可见').toBe(true);
});

/* ============ 卡片版按钮（v1.0） ============ */
test('滚动后卡片显示 ←/⋮，点击调用原按钮', async ({ page }) => {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 滚动 400px（超过阈值）
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForFunction(() => {
    return document.body.classList.contains('sgx-stuck');
  }, null, { timeout: 5000 });
  // 等 opacity transition (.2s) 完成
  await page.waitForFunction(() => {
    const b = parseFloat(getComputedStyle(document.querySelector('.sgx-topcard-back')).opacity);
    return b === 1;
  }, null, { timeout: 5000 });
  // 卡片版 ←/⋮ 可见
  const btns = await page.evaluate(() => {
    const card = document.querySelector('.sgx-topcard');
    const cr = card.getBoundingClientRect();
    const back = card.querySelector('.sgx-topcard-back');
    const more = card.querySelector('.sgx-topcard-more');
    const br = back.getBoundingClientRect();
    const mr = more.getBoundingClientRect();
    return {
      backOpacity: parseFloat(getComputedStyle(back).opacity),
      moreOpacity: parseFloat(getComputedStyle(more).opacity),
      backLeftOffset: br.left - cr.left,
      moreRightOffset: cr.right - mr.right,
    };
  });
  expect(btns.backOpacity, '卡片版 ← 应可见').toBe(1);
  expect(btns.moreOpacity, '卡片版 ⋮ 应可见').toBe(1);
  expect(Math.abs(btns.backLeftOffset - 6), '← 左边缘 = 卡片左 + 6').toBeLessThanOrEqual(1);
  expect(Math.abs(btns.moreRightOffset - 6), '⋮ 右边缘 = 卡片右 - 6').toBeLessThanOrEqual(1);
  // 点击卡片版 ← 调用原按钮的 click()
  const backClicked = await page.evaluate(() => {
    let clicked = false;
    const orig = document.querySelector('.subpage-back');
    const origClick = orig.click.bind(orig);
    orig.click = () => { clicked = true; };
    document.querySelector('.sgx-topcard-back').click();
    orig.click = origClick;
    return clicked;
  });
  expect(backClicked, '卡片版 ← 应调用原按钮 click()').toBe(true);
});

test('卡片版 ← 是 arrow-left 图标（v1.0 不再用 ‹）', async ({ page }) => {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // 展开态原按钮
  const before = await page.evaluate(() => {
    const btn = document.querySelector('.subpage-back');
    return {
      svgCount: btn.querySelectorAll('svg').length,
      foldCount: btn.querySelectorAll('.sgx-bk-fold').length,
    };
  });
  expect(before.svgCount, '展开态应有 svg 图标').toBe(1);
  expect(before.foldCount, '不应有 ‹ 的 span').toBe(0);
  // 滚动后卡片版 ←（400px 超过阈值）
  await page.evaluate(() => window.scrollTo(0, 400));
  await page.waitForFunction(() => {
    return document.body.classList.contains('sgx-stuck');
  }, null, { timeout: 5000 });
  const after = await page.evaluate(() => {
    const btn = document.querySelector('.sgx-topcard-back');
    return {
      svgCount: btn.querySelectorAll('svg').length,
      hasFold: !!btn.querySelector('.sgx-bk-fold'),
    };
  });
  expect(after.svgCount, '卡片版 ← 应有 svg 图标').toBe(1);
  expect(after.hasFold, '卡片版 ← 不应有 ‹').toBe(false);
  // 原按钮不再吸顶
  const origStuck = await page.evaluate(() => {
    return document.querySelector('.subpage-back').classList.contains('stuck');
  });
  expect(origStuck, '原按钮不应再有 .stuck').toBe(false);
});

test('书库与上传页标题区结构一致', async ({ page }) => {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
  // 书库首页
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  const shelf = await page.evaluate(() => {
    const head = document.querySelector('[data-subpage-head]');
    const title = head.querySelector('.subpage-title').getBoundingClientRect();
    const back = head.querySelector('.subpage-back').getBoundingClientRect();
    const more = head.querySelector('#bk-menu-btn').getBoundingClientRect();
    return { headH: head.offsetHeight, titleBottom: title.bottom, backTop: back.top, moreTop: more.top };
  });
  expect(shelf.backTop, '书库：← 顶部应在标题底部之下').toBeGreaterThan(shelf.titleBottom);
  expect(shelf.moreTop, '书库：⋮ 顶部应在标题底部之下').toBeGreaterThan(shelf.titleBottom);
  // 上传页
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const upload = await page.evaluate(() => {
    const head = document.querySelector('[data-subpage-head]');
    const title = head.querySelector('.subpage-title').getBoundingClientRect();
    const back = head.querySelector('.subpage-back').getBoundingClientRect();
    const more = head.querySelector('.subpage-more').getBoundingClientRect();
    return { headH: head.offsetHeight, titleBottom: title.bottom, backTop: back.top, moreTop: more.top };
  });
  expect(upload.backTop, '上传页：← 顶部应在标题底部之下').toBeGreaterThan(upload.titleBottom);
  expect(upload.moreTop, '上传页：⋮ 顶部应在标题底部之下').toBeGreaterThan(upload.titleBottom);
  expect(Math.abs(shelf.headH - upload.headH), '两页标题区高度差应 ≤1px').toBeLessThanOrEqual(1);
});

/* ============ A4：点头像刷新 ============ */
test('A4 brand click: reloads current page (v1.0)', async ({ page }) => {
  await setupOwner(page);
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  // v1.0：Book 点击品牌组刷新当前页（不再是跳回首页的链接）
  const navPromise = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 10000 });
  await page.locator('.sgx-topcard-brand').click();
  await navPromise;
  expect(page.url(), '应刷新当前页').toMatch(/\/$/);
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
  await page.locator('[data-subpage-head] .subpage-back').click();
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
  await page.locator('[data-subpage-head] .subpage-back').click();
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
