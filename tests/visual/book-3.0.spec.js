/* Book 3.0 功能断言（无截图）：页头 / 分组 / 筛选 / 角标 / 最近阅读 /
 * FAB / 详情弹层 / Visitor 隔离 / 无横向溢出 / 首屏见书架第一行。
 * 不逐本查进度：断言页面从不请求 /api/private/progress。
 *
 * 所有 /api/* 走 helpers.mockBookAPIs mock；PUT/DELETE/backfill 在各用例里
 * 在 mockBookAPIs 之后注册（后注册优先）。
 *
 * Hark 规则：goto 用 domcontentloaded + 等具体元素，不用 networkidle，不用 waitForTimeout。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady, expect, BOOKS } = require('./helpers.js');

const MOBILE = { width: 390, height: 844 };
const NARROW = { width: 360, height: 740 };

/* Owner 固件：在 BOOKS 基础上加 percent / progress_updated_at（/api/private/books 的 LEFT JOIN 结果）。
 * epub1 在读 42% / pdf1 已读 100% / epub2 已打开 0%（未读）/ epub3 从未打开（无 percent）
 * / pdf2 在读 2%（最近在读 → FAB）/ epub4 在读 9%。epub3 不上主站书单。 */
const OWNER_BOOKS = BOOKS.map((b) => {
  const extra = {
    epub1: { percent: 42, progress_updated_at: 1700000005000 },
    pdf1: { percent: 100, progress_updated_at: 1700000004000 },
    epub2: { percent: 0, progress_updated_at: 1700000003000 },
    epub3: {},
    pdf2: { percent: 2, progress_updated_at: 1700000006000 },
    epub4: { percent: 9, progress_updated_at: 1700000002000 },
  }[b.id] || {};
  const copy = { ...b, ...extra };
  if (b.id === 'epub3') copy.in_shelf = 0;
  return copy;
});

/* 21 字长书名样例（验收：截断） */
const LONG_TITLE = '为什么我们总是对自己撒谎：心理学与自我欺骗';
const LONG_BOOK = {
  id: 'long1', title: LONG_TITLE, author: '罗伯特·特里弗斯',
  cover_key: 'cover-long1', format: 'epub', size: 1234567, pages: 324,
  tags: [], created_at: '2026-09-25T10:00:00Z', visibility: 'public', in_shelf: 1,
};

async function setup(page, { viewport, owner = false, books } = {}) {
  await page.setViewportSize(viewport);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner, books });
}

async function waitShelf(page) {
  await expect(page.locator('#bk-grid:not(.hidden) [data-book]').first())
    .toBeVisible({ timeout: 15000 });
}

/* 收集本页发出的 /api/private/progress 请求（应为 0） */
async function trackProgressRequests(page) {
  const hits = [];
  page.on('request', (req) => {
    if (req.url().includes('/api/private/progress')) hits.push(req.url());
  });
  return hits;
}

test('visitor：无角标 / FAB / ⋮ 菜单 / 最近阅读条；6 本 < 8 本无最近添加条；不逐本查进度', async ({ page }) => {
  const progressHits = await trackProgressRequests(page);
  await setup(page, { viewport: MOBILE, owner: false });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  await expect(page.locator('#bk-fab:not(.hidden)')).toHaveCount(0);
  await expect(page.locator('#bk-menu-btn:not(.hidden)')).toHaveCount(0);
  await expect(page.locator('.bk-badge')).toHaveCount(0);
  await expect(page.locator('#bk-strip:not(.hidden)')).toHaveCount(0);
  /* 排序胶囊默认「添加时间」，无阅读状态胶囊 */
  await expect(page.locator('#bk-chips')).toContainText('排序：添加时间');
  await expect(page.locator('#bk-chips')).not.toContainText('在读');
  expect(progressHits).toEqual([]);
});

test('visitor：公开书 ≥ 8 本时显示最近添加条（5 本，无角标）', async ({ page }) => {
  const extra = [1, 2, 3].map((i) => ({
    id: 'extra' + i, title: '新书' + i, author: '作者' + i,
    cover_key: 'cover-extra' + i, format: 'epub', size: 1000, pages: 100,
    tags: [], created_at: '2026-09-2' + i + 'T10:00:00Z', visibility: 'public', in_shelf: 1,
  }));
  await setup(page, { viewport: MOBILE, owner: false, books: [...BOOKS, ...extra] });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);
  await expect(page.locator('#bk-strip:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('#bk-strip')).toContainText('最近添加');
  await expect(page.locator('#bk-strip [data-book]')).toHaveCount(5);
  await expect(page.locator('#bk-strip .bk-badge')).toHaveCount(0);
});

test('owner：角标（42% 胶囊 / 已读勾）+ 最近阅读条 5 本 + ⋮ 菜单 3 项；不逐本查进度', async ({ page }) => {
  /* App 化 v1.1：FAB 已删除（与底部搜索栏冲突），入口保留在「最近阅读」 */
  const progressHits = await trackProgressRequests(page);
  await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  /* 角标：epub1 42% / pdf2 2% / epub4 9% 胶囊 + pdf1 已读勾；epub2 0% / epub3 无进度无角标 */
  await expect(page.locator('#bk-grid .bk-badge-pct')).toHaveCount(3);
  await expect(page.locator('#bk-grid .bk-badge-done')).toHaveCount(1);
  await expect(page.locator('#bk-grid [data-book="epub1"] .bk-badge-pct')).toHaveText('42%');

  /* 最近阅读条：5 本（pdf2/epub1/pdf1/epub2/epub4），含未读与已读 */
  await expect(page.locator('#bk-strip:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('#bk-strip')).toContainText('最近阅读');
  await expect(page.locator('#bk-strip [data-book]')).toHaveCount(5);
  await expect(page.locator('#bk-strip [data-book="epub2"]')).toContainText('未读');
  await expect(page.locator('#bk-strip [data-book="pdf1"]')).toContainText('已读');

  /* FAB 已删除 */
  await expect(page.locator('#bk-fab')).toHaveCount(0);

  /* ⋮ 菜单：3 项文字 */
  await page.locator('#bk-menu-btn').click();
  const menu = page.locator('#bk-more-menu:not(.hidden)');
  await expect(menu).toHaveCount(1);
  await expect(menu).toContainText('上传书籍');
  await expect(menu).toContainText('随机打开一本');
  await expect(menu).toContainText('为无封面的书提取封面');

  expect(progressHits).toEqual([]);
});

/* App 化 v1.1：分组下拉（#bk-group-btn）已删除，测试作废 */
// test('owner：分组切换（全部 / 在读 / 主站书单）', async ({ page }) => {
//   await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
//   await gotoReady(page, '/', '#bk-grid:not(.hidden)');
//   await waitShelf(page);
//
//   await page.locator('#bk-group-btn').click();
//   const menu = page.locator('#bk-group-menu:not(.hidden)');
//   await expect(menu).toContainText('全部书籍');
//   await expect(menu).toContainText('在读');
//   await expect(menu).toContainText('主站书单');
//
//   await menu.locator('[data-group="reading"]').click();
//   await expect(page.locator('#bk-grid [data-book]')).toHaveCount(3); // epub1/pdf2/epub4
//
//   await page.locator('#bk-group-btn').click();
//   await page.locator('#bk-group-menu [data-group="shelf"]').click();
//   await expect(page.locator('#bk-grid [data-book]')).toHaveCount(5); // epub3 不上书单
// });

test('owner：筛选弹层（排序单选 + 状态多选 + 布局三段式 + 格式复选）+ 胶囊清除 + 清除全部', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  await page.locator('#bk-menu-btn').click();
  await page.locator('#bk-more-menu [data-more="filter"]').click();
  const sheet = page.locator('#filter-wrap.open');
  await expect(sheet).toHaveCount(1);
  await expect(sheet.locator('input[name="bk-sort"]')).toHaveCount(4);
  await expect(sheet.locator('input[data-status]')).toHaveCount(3);
  await expect(sheet.locator('[data-layout]')).toHaveCount(3);
  await expect(sheet.locator('input[data-format]')).toHaveCount(2);
  /* 默认排序 = 最近阅读（Owner） */
  await expect(sheet.locator('input[name="bk-sort"][value="recent"]')).toBeChecked();

  /* 勾 在读 + EPUB，点完成 → 网格只剩在读 EPUB（epub1/epub4）
     原生 checkbox 隐藏（opacity:0），点可见的 label 行触发 */
  await sheet.locator('input[data-status="reading"]').evaluate((el) => el.closest('label').click());
  await sheet.locator('input[data-format="EPUB"]').evaluate((el) => el.closest('label').click());
  await page.locator('#filter-done').click();
  await expect(page.locator('#bk-grid [data-book]')).toHaveCount(2);
  /* 胶囊回显：排序胶囊无 ×，状态/格式胶囊带 × */
  await expect(page.locator('#bk-chips')).toContainText('排序：最近阅读');
  await expect(page.locator('#bk-chips [data-chip="status"]')).toHaveCount(1);
  await expect(page.locator('#bk-chips [data-chip="format"]')).toHaveCount(1);

  /* 点状态胶囊 × 清除 → 剩 EPUB 全部（4 本 epub：epub1/2/3/4） */
  await page.locator('#bk-chips [data-chip="status"]').click();
  await expect(page.locator('#bk-grid [data-book]')).toHaveCount(4);

  /* 清除全部 → 回默认（排序最近阅读，网格 6 本） */
  await page.locator('#bk-menu-btn').click();
  await page.locator('#bk-more-menu [data-more="filter"]').click();
  await page.locator('#filter-clear').click();
  await expect(page.locator('#bk-grid [data-book]')).toHaveCount(6);
  await expect(page.locator('#bk-chips')).toContainText('排序：最近阅读');
});

test('owner：详情弹层（开关 + 换封面 + 编辑 + 删除确认），无收藏行；编辑弹层无换封面控件', async ({ page }) => {
  const puts = [];
  const deletes = [];
  await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
  await page.route('**/api/admin/book*', async (route) => {
    const req = route.request();
    if (req.method() === 'PUT') puts.push(await req.postDataJSON());
    if (req.method() === 'DELETE') deletes.push(req.url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  await page.locator('#bk-grid [data-book="epub1"]').click();
  const sheet = page.locator('#sheet-wrap.open');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('了不起的盖茨比');
  await expect(sheet).toContainText('公开给访客');
  await expect(sheet).toContainText('放进主站书单');
  await expect(sheet).toContainText('换封面');
  await expect(sheet).toContainText('继续阅读');
  await expect(sheet).toContainText('删除这本书');
  await expect(sheet).not.toContainText('收藏');

  /* 换封面子菜单：只用列表（上传图片 / 从书里重新提取），无 ▾ 重复控件 */
  await sheet.locator('#bk-sheet-cover').click();
  const coverMenu = page.locator('#cover-wrap.open');
  await expect(coverMenu).toHaveCount(1);
  await expect(coverMenu).toContainText('上传图片');
  await expect(coverMenu).toContainText('从书里重新提取');
  await expect(coverMenu.locator('select')).toHaveCount(0);
  await page.keyboard.press('Escape');

  /* 编辑：书名/作者输入框，无换封面控件；保存 PUT 后弹层内更新 */
  await sheet.locator('#bk-sheet-edit').click();
  await expect(sheet.locator('#bk-edit-title')).toHaveValue('了不起的盖茨比');
  await expect(sheet.locator('#bk-edit-author')).toHaveValue('F. Scott Fitzgerald');
  await expect(sheet.locator('#bk-sheet-cover')).toHaveCount(0);
  await sheet.locator('#bk-edit-title').fill('盖茨比');
  await sheet.locator('#bk-edit-save').click();
  await expect.poll(() => puts.length, { timeout: 10000 }).toBe(1);
  expect(puts[0]).toMatchObject({ title: '盖茨比', author: 'F. Scott Fitzgerald' });
  await expect(page.locator('#bk-grid [data-book="epub1"]')).toContainText('盖茨比');

  /* 删除：弹层仍开着（编辑保存后回到详情视图），直接点删除 → 确认弹层 → 点取消不删；再点删除 → 点确认 → DELETE */
  await page.locator('#bk-sheet-del').click();
  await expect(page.locator('#confirm-wrap.open')).toHaveCount(1);
  await expect(page.locator('#confirm-msg')).toContainText('确定删除这本书吗？删除后无法恢复。');
  await page.locator('#confirm-cancel').click();
  expect(deletes).toEqual([]);
  await page.locator('#bk-sheet-del').click();
  await page.locator('#confirm-ok').click();
  await expect.poll(() => deletes.length, { timeout: 10000 }).toBe(1);
  await expect(page.locator('#bk-grid [data-book="epub1"]')).toHaveCount(0);
});

test('owner：换封面「从书里重新提取」无封面时提示，不调 cover 接口', async ({ page }) => {
  const coverPosts = [];
  await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
  await page.route('**/api/admin/cover*', async (route) => {
    coverPosts.push(route.request().url());
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"coverKey":"covers/epub1.webp"}' });
  });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  /* epub1 的 /api/private/file 返回无封面的最小 EPUB 固件 → 提示「书里没有找到封面」 */
  await page.locator('#bk-grid [data-book="epub1"]').click();
  await page.locator('#bk-sheet-cover').click();
  await page.locator('#cover-reextract').click();
  await expect(page.locator('#bk-toast:not(.hidden)')).toContainText('书里没有找到封面', { timeout: 15000 });
  expect(coverPosts).toEqual([]);
});

test('360 宽无横向溢出，长书名截断；390×844 首屏见书架第一行', async ({ page }) => {
  await setup(page, { viewport: NARROW, owner: false, books: [...BOOKS, LONG_BOOK] });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  /* 长书名网格标题单行截断：overflow:hidden + ellipsis + nowrap，且可见宽度受限于卡片
     （scrollWidth > clientWidth 恰是截断生效的表现：内容被裁剪而非撑宽） */
  const titleBox = page.locator('#bk-grid [data-book="long1"] h3');
  await expect(titleBox).toBeVisible();
  const trunc = await titleBox.evaluate((el) => {
    const cs = getComputedStyle(el);
    const card = el.closest('article');
    return cs.overflow === 'hidden' && cs.textOverflow === 'ellipsis' && cs.whiteSpace === 'nowrap'
      && el.clientWidth <= card.getBoundingClientRect().width + 1
      && el.scrollWidth > el.clientWidth;
  });
  expect(trunc).toBe(true);
});

/* 上传队列 48px 小封面：长标题两行截断，完整「…」且不贴边（批复：小封面改两行截断）。
 * 根因：单行 nowrap 在小尺寸下只显示约 3 字；两行 line-clamp 显示约 5–6 字 + 省略号。
 * 修复：上传队列走 uq（display:-webkit-box + line-clamp:2），去掉 nowrap 和单行 text-overflow。 */
test('上传队列 48px 小封面：长标题两行截断，完整「…」且不贴边', async ({ page }) => {
  await setup(page, { viewport: NARROW, owner: true });
  await gotoReady(page, '/admin/', '#adm-main:not(.hidden)');
  const { makeEpub } = require('./fixtures/file-fixtures.js');
  await page.setInputFiles('#adm-file', {
    name: 'x.epub', mimeType: 'application/epub+zip', buffer: Buffer.from(makeEpub()),
  });
  await expect(page.locator('#adm-queue [data-q]')).toBeVisible({ timeout: 15000 });
  await page.waitForFunction(() => {
    const el = document.querySelector('#adm-queue [data-q] [data-status]');
    return el && !el.textContent.includes('解析');
  }, { timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
  const m = await page.evaluate(() => {
    const thumb = document.querySelector('#adm-queue [data-q] .bk-cover');
    const title = thumb.querySelector('.bk-gen-title');
    const tr = thumb.getBoundingClientRect();
    const r = title.getBoundingClientRect();
    const cs = getComputedStyle(title);
    return {
      scrollW: title.scrollWidth, clientW: title.clientWidth,
      height: r.height, lineH: parseFloat(cs.lineHeight),
      fontSize: parseFloat(cs.fontSize),
      display: cs.display, lineClamp: cs.webkitLineClamp, boxOrient: cs.webkitBoxOrient,
      whiteSpace: cs.whiteSpace, textOverflow: cs.textOverflow,
      leftGap: r.left - tr.left, rightGap: tr.right - r.right,
    };
  });
  /* 最多 2 行：高度 ≤ 2×行高（line-clamp 把元素高度钳在两行；Range 矩形数在 clamp 下
   * 不可靠——被裁掉的第 3 行仍会出现在 Range 矩形里，故以元素高度为准）。 */
  expect(m.height, '小封面标题最多排两行（高度 ≤ 2×行高）').toBeLessThanOrEqual(2 * m.lineH + 1);
  /* line-clamp 生效：computed style 应为 clamp:2 + vertical，且去掉 nowrap。
   * 注意：Chromium 把 display:-webkit-box 的 computed 值归一化为 flow-root，
   * 故不断言 display，只断言 line-clamp / box-orient + 高度 ≤ 2×行高。 */
  expect(m.lineClamp, '小封面标题应 line-clamp:2').toBe('2');
  expect(m.boxOrient, '小封面标题应 vertical').toBe('vertical');
  expect(m.whiteSpace, '小封面标题不应 nowrap（去掉单行）').not.toBe('nowrap');
  /* 截断生效：内容宽于盒子（第 2 行超宽被裁，省略号生效）。 */
  expect(m.scrollW, '小封面标题应处于截断态（内容宽于盒子，省略号生效）').toBeGreaterThan(m.clientW);
  /* 字号下限 + 不贴边。 */
  expect(m.fontSize, '小封面标题字号 ≥12px').toBeGreaterThanOrEqual(12);
  expect(m.leftGap, '标题左侧内边距 ≥4px').toBeGreaterThanOrEqual(4);
  expect(m.rightGap, '标题右侧内边距 ≥4px').toBeGreaterThanOrEqual(4);
  /* 短标题不截断：注入一个短标题 uq 封面（同尺寸），应只排一行、不被裁。 */
  const s = await page.evaluate(() => {
    const wrap = document.createElement('div');
    wrap.className = 'bk-cover relative';
    wrap.style.cssText = 'position:fixed;top:0;left:0;width:48px;height:72px;opacity:0;pointer-events:none;';
    wrap.innerHTML = window.SgxBookCover.genCoverHTML('短', '', 'uq');
    document.body.appendChild(wrap);
    const title = wrap.querySelector('.bk-gen-title');
    const r = title.getBoundingClientRect();
    const cs = getComputedStyle(title);
    const out = {
      height: r.height, lineH: parseFloat(cs.lineHeight),
      scrollW: title.scrollWidth, clientW: title.clientWidth,
      scrollH: title.scrollHeight, clientH: title.clientHeight,
    };
    wrap.remove();
    return out;
  });
  expect(s.height, '短标题应只排一行').toBeLessThanOrEqual(s.lineH + 1);
  expect(s.scrollW, '短标题不应被截断（内容不宽于盒子）').toBeLessThanOrEqual(s.clientW);
  expect(s.scrollH, '短标题不应被裁（内容不高于盒子）').toBeLessThanOrEqual(s.clientH);
});

test('390×844 首屏见书架第一行', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: false });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);
  const box = await page.locator('#bk-grid [data-book]').first().boundingBox();
  expect(box).not.toBeNull();
  expect(box.y).toBeLessThan(844);
  expect(box.y + box.height).toBeLessThanOrEqual(844);
});

test('搜索：按书名/作者过滤，150ms 防抖', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: false });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  /* App 化 v1.1：底部搜索胶囊（#bk-cap-input），聚焦展开 */
  await page.locator('#bk-cap-input').click();
  await expect(page.locator('#bk-cap.open')).toHaveCount(1);
  await page.locator('#bk-cap-input').fill('盖茨比');
  await expect(page.locator('#bk-grid [data-book]')).toHaveCount(1, { timeout: 10000 });
  await page.locator('#bk-cap-input').fill('');
  await expect(page.locator('#bk-grid [data-book]')).toHaveCount(6);
});

test('owner：⋮ 菜单「为无封面的书提取封面」调 backfill 接口并提示结果', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: true, books: OWNER_BOOKS });
  await page.route('**/api/admin/books/backfill-covers', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"checked":6,"fixed":2}' });
  });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  await page.locator('#bk-menu-btn').click();
  await page.locator('#bk-more-menu [data-more="backfill"]').click();
  await expect(page.locator('#bk-toast:not(.hidden)')).toContainText('已为 2 本书补齐封面（共检查 6 本）。', { timeout: 10000 });
});

test('空状态：owner 有上传按钮，排序胶囊隐藏', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: true, books: [] });
  await gotoReady(page, '/', '#bk-empty:not(.hidden)');
  await expect(page.locator('#bk-empty')).toContainText('书架还是空的。');
  await expect(page.locator('#bk-empty')).toContainText('上传第一本书，开始你的阅读。');
  await expect(page.locator('#bk-empty-cta:not(.hidden)')).toHaveCount(1);
  await expect(page.locator('#bk-empty-cta')).toHaveAttribute('href', '/admin/');
  /* 书架为空时不显示排序胶囊（画布 12 里没有） */
  await expect(page.locator('#bk-chips:not(.hidden)')).toHaveCount(0);
  /* 空状态插画居中：120px 描边书本的中心 ≈ 视口中心（390/2=195） */
  const svgBox = await page.locator('#bk-empty svg').boundingBox();
  expect(svgBox).not.toBeNull();
  expect(Math.abs((svgBox.x + svgBox.width / 2) - 195)).toBeLessThan(2);
});

test('空状态：visitor 只有说明，无上传按钮', async ({ page }) => {
  await setup(page, { viewport: MOBILE, owner: false, books: [] });
  await gotoReady(page, '/', '#bk-empty:not(.hidden)');
  await expect(page.locator('#bk-empty')).toContainText('书架还是空的。');
  await expect(page.locator('#bk-empty-cta:not(.hidden)')).toHaveCount(0);
  await expect(page.locator('#bk-chips:not(.hidden)')).toHaveCount(0);
});

test('owner：详情弹层 360 宽（操作按钮固定底部，在视口内；文案「在读 42%」）', async ({ page }) => {
  await setup(page, { viewport: NARROW, owner: true, books: OWNER_BOOKS });
  await gotoReady(page, '/', '#bk-grid:not(.hidden)');
  await waitShelf(page);

  await page.locator('#bk-grid [data-book="epub1"]').click();
  const sheet = page.locator('#sheet-wrap.open');
  await expect(sheet).toHaveCount(1);
  await expect(sheet).toContainText('在读 42%');
  await expect(sheet).not.toContainText('已读 42%');

  /* 操作按钮固定在弹层底部，不随内容滚动 → 在视口内 */
  const actionsBox = await page.locator('#sheet-actions').boundingBox();
  expect(actionsBox).not.toBeNull();
  expect(actionsBox.y + actionsBox.height).toBeLessThanOrEqual(740);
  /* 编辑态按钮同样在视口内 */
  await page.locator('#bk-sheet-edit').click();
  const editBox = await page.locator('#sheet-actions').boundingBox();
  expect(editBox).not.toBeNull();
  expect(editBox.y + editBox.height).toBeLessThanOrEqual(740);
});
