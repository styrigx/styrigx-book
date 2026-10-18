/* Book 手机验收返工 E2E：四（⋮ 下拉菜单）/ 五（半屏下沉弹层）。
 *
 * 跑在 CI（deploy.yml → npm run test:e2e），站长身份，防以后静默坏掉。
 * 设备见 playwright.e2e.config.js：Chromium，412×915 / 360×800，
 * deviceScaleFactor 2.625，isMobile + hasTouch。
 *
 * Hark 规则：goto 用 domcontentloaded + 等具体元素，不用 networkidle，不用 waitForTimeout。
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, gotoReady } = require('../visual/helpers.js');

async function setupOwner(page) {
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: true });
}

/* 打开 ⋮ 菜单：按钮可见 → 点击 → 菜单可见 */
async function openMoreMenu(page) {
  const btn = page.locator('#bk-menu-btn');
  await expect(btn, '站长身份应显示 ⋮ 按钮').toBeVisible();
  await btn.click();
  const menu = page.locator('#bk-more-menu:not(.hidden)');
  await expect(menu, '点 ⋮ 后菜单应弹出').toBeVisible();
  return { btn, menu };
}

/* 等底部弹层滑入动画结束（transform 归位），再做几何断言/截图 */
async function waitSheetSettled(page, wrapSel) {
  await page.waitForFunction((sel) => {
    const el = document.querySelector(sel + ' .bk-panel');
    if (!el) return false;
    const t = getComputedStyle(el).transform;
    return t === 'none' || t === 'matrix(1, 0, 0, 1, 0, 0)';
  }, wrapSel, { timeout: 5000 });
}

/* 标题行几何一次取全：面板/拖动条/标题行三栏/标题/左右按钮 */
async function titlebarMetrics(page, wrapSel) {
  return page.evaluate((sel) => {
    const wrap = document.querySelector(sel);
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { left: b.left, right: b.right, top: b.top, bottom: b.bottom,
               w: b.width, h: b.height, cx: b.left + b.width / 2, cy: b.top + b.height / 2 };
    };
    const bar = wrap.querySelector('.bk-titlebar');
    const cells = [...bar.children];
    const title = bar.querySelector('.bk-titlebar-mid h2');
    const leftBtn = cells[0].querySelector('button');
    const closeBtn = cells[2].querySelector('button');
    return {
      vw: window.innerWidth, vh: window.innerHeight,
      panel: r(wrap.querySelector('.bk-panel')),
      handle: r(wrap.querySelector('.sheet-handle')),
      bar: r(bar),
      leftCell: r(cells[0]), midCell: r(cells[1]), rightCell: r(cells[2]),
      leftCellEmpty: cells[0].textContent.trim() === '' && !leftBtn,
      title: r(title),
      leftBtn: leftBtn ? r(leftBtn) : null,
      closeBtn: r(closeBtn),
    };
  }, wrapSel);
}

function expectTitlebar(m, { hasGear }) {
  /* 高度 50dvh ±2px */
  expect(Math.abs(m.panel.h - m.vh * 0.5),
    `面板高度应为 50dvh（实测 ${m.panel.h.toFixed(1)}，视口 ${m.vh}）`).toBeLessThanOrEqual(2);
  /* 三栏 48px | 1fr | 48px */
  expect(Math.abs(m.leftCell.w - 48), `左栏宽应为 48px（实测 ${m.leftCell.w})`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.rightCell.w - 48), `右栏宽应为 48px（实测 ${m.rightCell.w})`).toBeLessThanOrEqual(1);
  /* 左右对称：左元素 left == innerWidth - 关闭按钮 right（±1px） */
  const leftEdge = hasGear ? m.leftBtn.left : m.leftCell.left;
  expect(Math.abs(leftEdge - (m.vw - m.closeBtn.right)),
    `左右应镜像对称（左 ${leftEdge.toFixed(1)}，右余 ${m.vw - m.closeBtn.right})`).toBeLessThanOrEqual(1);
  /* 标题中心 x == 屏中心 x（±1px） */
  expect(Math.abs(m.title.cx - m.vw / 2),
    `标题应水平居中（标题中心 ${m.title.cx.toFixed(1)}，屏中心 ${m.vw / 2})`).toBeLessThanOrEqual(1);
  /* 标题/齿轮（或左空位）/关闭中心 y 差 ≤1px */
  const cys = [m.title.cy, m.closeBtn.cy, hasGear ? m.leftBtn.cy : m.leftCell.cy];
  expect(Math.max(...cys) - Math.min(...cys),
    `标题/左右中心 y 应对齐（${cys.map(v => v.toFixed(1)).join(', ')})`).toBeLessThanOrEqual(1);
  /* 标题行顶部距拖动条底部 12px，行高 56px */
  expect(Math.abs(m.bar.top - m.handle.bottom - 12),
    `标题行顶部距拖动条底部应 12px（实测 ${(m.bar.top - m.handle.bottom).toFixed(1)})`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.bar.h - 56),
    `标题行高应 56px（实测 ${m.bar.h.toFixed(1)})`).toBeLessThanOrEqual(1);
}

test.describe('四、⋮ 下拉菜单', () => {
  test('点 ⋮ 弹出：贴按钮下方右对齐，完整在视口内', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const { btn, menu } = await openMoreMenu(page);
    const b = await btn.boundingBox();
    const m = await menu.boundingBox();
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(m.x, '菜单左边界').toBeGreaterThanOrEqual(0);
    expect(m.y, '菜单上边界').toBeGreaterThanOrEqual(0);
    expect(m.x + m.width, '菜单右边界').toBeLessThanOrEqual(vw);
    expect(m.y + m.height, '菜单下边界').toBeLessThanOrEqual(vh);
    /* 顶栏 v2.0：菜单上沿 = 按钮下沿 + 8px（±2px） */
    expect(Math.abs(m.y - (b.y + b.height + 8)),
      `菜单应贴按钮下方（菜单上 ${m.y.toFixed(1)}，按钮下 ${b.y + b.height})`).toBeLessThanOrEqual(2);
    /* 右对齐：菜单右沿 = 按钮右沿（±1px） */
    expect(Math.abs(m.x + m.width - (b.x + b.width)),
      `菜单应右对齐（菜单右 ${m.x + m.width}，按钮右 ${b.x + b.width})`).toBeLessThanOrEqual(1);
    /* 菜单项齐全（站长视角 5 项，按任务书顺序）：排序与筛选 / 书库设置 / 上传书籍 / 随机打开一本 / 为无封面的书提取封面 */
    await expect(menu.locator('.bk-menu-item')).toHaveCount(5);
    const itemTexts = await menu.locator('.bk-menu-item').allTextContents();
    expect(itemTexts.map((t) => t.trim())).toEqual([
      '排序与筛选',
      '书库设置',
      '上传书籍',
      '随机打开一本',
      '为无封面的书提取封面',
    ]);
  });

  test('点「上传书籍」跳 /admin/', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const { menu } = await openMoreMenu(page);
    const item = menu.locator('a.bk-menu-item');
    await expect(item).toHaveAttribute('href', '/admin/');
    await expect(item).toContainText('上传书籍');
    await Promise.all([page.waitForURL('**/admin/'), item.click()]);
    await expect(page.locator('#adm-main'), '应到达上传页').toBeVisible();
  });

  test('点空白处 / Esc 关闭', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    let opened = await openMoreMenu(page);
    /* 点标题区上沿空白（header padding 区，无点击行为；避开胶囊/按钮） */
    await page.locator('.subpage-head').click({ position: { x: 8, y: 100 } });
    await expect(opened.menu, '点空白处应关闭').toBeHidden();
    opened = await openMoreMenu(page);
    await page.keyboard.press('Escape');
    await expect(opened.menu, 'Esc 应关闭').toBeHidden();
  });

  test('滚动后仍贴着按钮（不错位）', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const { btn, menu } = await openMoreMenu(page);
    await page.evaluate(() => window.scrollTo(0, 60));
    await expect.poll(async () => {
      const b = await btn.boundingBox();
      const m = await menu.boundingBox();
      if (!b || !m) return 'missing';
      const dy = Math.abs(m.y - (b.y + b.height + 8));
      const dx = Math.abs(m.x + m.width - (b.x + b.width));
      return dy <= 2 && dx <= 1 ? 'anchored' : `dy=${dy.toFixed(1)} dx=${dx.toFixed(1)}`;
    }, { timeout: 5000 }).toBe('anchored');
    /* 仍在视口内 */
    const m = await menu.boundingBox();
    const vw = await page.evaluate(() => window.innerWidth);
    const vh = await page.evaluate(() => window.innerHeight);
    expect(m.x).toBeGreaterThanOrEqual(0);
    expect(m.y).toBeGreaterThanOrEqual(0);
    expect(m.x + m.width).toBeLessThanOrEqual(vw);
    expect(m.y + m.height).toBeLessThanOrEqual(vh);
  });
});

test.describe('五、半屏下沉弹层', () => {
  test('排序与筛选：50dvh + 标题行三栏数值 + 内容滚到底不被底栏挡', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const { menu: filterMenu } = await openMoreMenu(page);
    await filterMenu.locator('[data-more="filter"]').click();
    const wrap = page.locator('#filter-wrap.open');
    await expect(wrap).toBeVisible();
    await waitSheetSettled(page, '#filter-wrap');

    const m = await titlebarMetrics(page, '#filter-wrap');
    expect(m.leftBtn, '排序与筛选左栏应为 48px 空位（齿轮已删）').toBeNull();
    expectTitlebar(m, { hasGear: false });

    /* 内容区：flex:1 + 内部滚动；底栏固定带 safe-area */
    const layout = await page.evaluate(() => {
      const body = document.querySelector('#filter-body');
      const cs = getComputedStyle(body);
      const panel = document.querySelector('#filter-wrap .bk-panel');
      const footer = panel.querySelector(':scope > .shrink-0.flex');
      const csf = getComputedStyle(footer);
      return {
        flexGrow: cs.flexGrow, minHeight: cs.minHeight, overflowY: cs.overflowY,
        scrollable: body.scrollHeight > body.clientHeight + 1,
        footerPaddingBottom: csf.paddingBottom,
      };
    });
    expect(layout.flexGrow, '内容区 flex:1').toBe('1');
    expect(layout.minHeight, '内容区 min-height:0').toBe('0px');
    expect(layout.overflowY, '内容区 overflow-y:auto').toBe('auto');
    expect(layout.scrollable, '内容应可滚动（否则断言无意义）').toBe(true);
    expect(parseFloat(layout.footerPaddingBottom), '底栏应有 safe-area 内边距').toBeGreaterThan(0);

    /* 滚到底：最后一行不被底栏挡 */
    const r = await page.evaluate(() => {
      const body = document.querySelector('#filter-body');
      body.scrollTop = body.scrollHeight;
      const rows = body.querySelectorAll('.bk-check-row, .bk-radio-row, .bk-seg');
      const last = rows[rows.length - 1].getBoundingClientRect();
      const rb = body.getBoundingClientRect();
      const rf = document.querySelector('#filter-wrap .bk-panel > .shrink-0.flex').getBoundingClientRect();
      return { lastBottom: last.bottom, bodyBottom: rb.bottom, footerTop: rf.top };
    });
    expect(r.lastBottom, '最后一行底部应在内容区内').toBeLessThanOrEqual(r.bodyBottom + 1);
    expect(r.bodyBottom, '内容区底部应在底栏上方').toBeLessThanOrEqual(r.footerTop + 1);
  });

  test('书库设置：50dvh + 左 48px 空位 + 标题居中', async ({ page }) => {
    await setupOwner(page);
    await gotoReady(page, '/', '#bk-grid:not(.hidden)');
    const { menu: settingsMenu } = await openMoreMenu(page);
    await settingsMenu.locator('[data-more="settings"]').click();
    const wrap = page.locator('#settings-wrap.open');
    await expect(wrap).toBeVisible();
    await waitSheetSettled(page, '#settings-wrap');

    const m = await titlebarMetrics(page, '#settings-wrap');
    expect(m.leftBtn, '书库设置左栏不应有按钮').toBeNull();
    expect(m.leftCellEmpty, '书库设置左栏应为 48px 空位').toBe(true);
    expectTitlebar(m, { hasGear: false });

    /* 内容区可滚动（主题三项），结构与筛选一致 */
    const scrollable = await page.evaluate(() => {
      const panel = document.querySelector('#settings-wrap .bk-panel');
      const body = panel.children[2];
      const cs = getComputedStyle(body);
      return cs.flexGrow === '1' && cs.minHeight === '0px' && cs.overflowY === 'auto';
    });
    expect(scrollable, '设置内容区 flex:1/min-height:0/overflow-y:auto').toBe(true);
  });
});
