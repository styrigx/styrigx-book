/* 顶栏统一规格 v2.0 验收测试：返回圆＋长条＋导航圆
 * 规格第九节，每条一个 test，中英文各跑一遍。
 * 页面 URL 和选择器放顶部配置。
 */
const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, gotoReady, BOOKS } = require('../visual/helpers.js');

/* ===== 顶部配置 ===== */
const PAGES = {
  home: { zh: '/', en: '/en/' },
  upload: { zh: '/admin/', en: '/en/admin/' }, // 用上传页作为子页面代表
};
const SEL = {
  topbar: '.sgx-topbar',
  back: '.sgx-tb-back',
  pill: '.sgx-tb-pill',
  brand: '.sgx-tb-brand',
  avatar: '.sgx-tb-avatar',
  brandText: '.sgx-tb-text',
  more: '.sgx-tb-more',
  nav: '.sgx-tb-nav',
  navMenu: '#sgx-tb-navmenu',
  miniTitle: '.subpage-mini-title',
  siteNav: '#site-nav',
  head: '[data-subpage-head]',
  headTitle: '.subpage-title',
};
const MANY_BOOKS = [...BOOKS, ...BOOKS, ...BOOKS];

/* ===== 公共函数 ===== */
/** 断言元素盒模型，tol 默认 1px */
async function expectBox(locator, { left, top, width, height }, tol = 1, msg = '') {
  const box = await locator.boundingBox();
  expect(box, `${msg} 元素应可见`).not.toBeNull();
  if (left !== undefined) expect(Math.abs(box.x - left), `${msg} left`).toBeLessThanOrEqual(tol);
  if (top !== undefined) expect(Math.abs(box.y - top), `${msg} top`).toBeLessThanOrEqual(tol);
  if (width !== undefined) expect(Math.abs(box.width - width), `${msg} width`).toBeLessThanOrEqual(tol);
  if (height !== undefined) expect(Math.abs(box.height - height), `${msg} height`).toBeLessThanOrEqual(tol);
  return box;
}

/** 用 Range 量文字的字形矩形（精确到字形，不含多余内边距） */
async function textRect(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const r = range.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height,
             cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }, selector);
}

/** 截取 (x,y) 处 1x1 像素，返回 {r,g,b} */
const zlib = require('zlib');
async function samplePixel(page, x, y) {
  const buf = await page.screenshot({ clip: { x, y, width: 1, height: 1 } });
  let pos = 8, colorType = -1;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') colorType = data[9];
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const px = raw.slice(1);
  if (colorType === 6) return { r: px[0], g: px[1], b: px[2] };
  if (colorType === 2) return { r: px[0], g: px[1], b: px[2] };
  throw new Error('不支持的 PNG 颜色类型: ' + colorType);
}

async function setup(page, lang, pageKey, theme = 'light') {
  await setTheme(page, theme);
  await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
  await gotoReady(page, PAGES[pageKey][lang], pageKey === 'home' ? '#bk-grid:not(.hidden)' : '#adm-main:not(.hidden), main');
}

for (const lang of ['zh', 'en']) {
  test.describe(`topbar v2.0 [${lang}]`, () => {
    /* 验收 1a：手机三块几何 ±1，三块高度都是 52 */
    test('1a. 手机三块几何', async ({ page }) => {
      for (const theme of ['light', 'dark']) {
        await setup(page, lang, 'home', theme);
        const vw = page.viewportSize().width;
        const back = page.locator(SEL.back);
        const pill = page.locator(SEL.pill);
        const nav = page.locator(SEL.nav);
        // 返回圆 x 16–68（52×52）
        await expectBox(back, { left: 16, top: 16, width: 52, height: 52 }, 1, `[${theme}] 返回圆`);
        // 长条：x 76，宽 = vw - 32 - 52 - 8 - 52 - 8，高 52
        const pillW = vw - 32 - 52 - 8 - 52 - 8;
        await expectBox(pill, { left: 76, top: 16, width: pillW, height: 52 }, 1, `[${theme}] 长条`);
        // 导航圆：x = vw - 16 - 52（52×52）
        await expectBox(nav, { left: vw - 16 - 52, top: 16, width: 52, height: 52 }, 1, `[${theme}] 导航圆`);
      }
    });

    /* 验收 1b：头像左边距长条 12±1；⋮ 中心距长条右边 26±1；返回圆和导航圆背景色与长条一致 */
    test('1b. 长条内部几何与质感', async ({ page }) => {
      for (const theme of ['light', 'dark']) {
        await setup(page, lang, 'home', theme);
        const pill = page.locator(SEL.pill);
        const pillBox = await pill.boundingBox();
        const avatar = page.locator(SEL.avatar);
        const avatarBox = await avatar.boundingBox();
        // 头像左边距长条 12±1
        expect(Math.abs(avatarBox.x - pillBox.x - 12), `[${theme}] 头像距长条左 12±1`).toBeLessThanOrEqual(1);
        // Styrigx 在长条内水平、垂直居中（±1）
        const tr = await textRect(page, SEL.brandText);
        expect(Math.abs(tr.cx - (pillBox.x + pillBox.width / 2)), `[${theme}] Styrigx 水平居中`).toBeLessThanOrEqual(1);
        expect(Math.abs(tr.cy - (pillBox.y + pillBox.height / 2)), `[${theme}] Styrigx 垂直居中`).toBeLessThanOrEqual(1);
        // ⋮ 中心距长条右边 26±1
        const more = page.locator(SEL.more);
        const moreBox = await more.boundingBox();
        const moreCx = moreBox.x + moreBox.width / 2;
        expect(Math.abs((pillBox.x + pillBox.width) - moreCx - 26), `[${theme}] ⋮ 中心距长条右 26±1`).toBeLessThanOrEqual(1);
        // 三块背景色一致
        const colors = await page.evaluate(() => {
          const get = (sel) => getComputedStyle(document.querySelector(sel)).backgroundColor;
          return { back: get('.sgx-tb-back'), pill: get('.sgx-tb-pill'), nav: get('.sgx-tb-nav') };
        });
        expect(colors.back, `[${theme}] 返回圆背景与长条一致`).toBe(colors.pill);
        expect(colors.nav, `[${theme}] 导航圆背景与长条一致`).toBe(colors.pill);
      }
    });

    /* 验收 3：#site-nav 背景透明；y=4 像素与背景一致 */
    test('3. 顶栏区域无实心底色', async ({ page }) => {
      await setup(page, lang, 'home');
      const bg = await page.locator(SEL.siteNav).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, '#site-nav 背景透明').toBe('rgba(0, 0, 0, 0)');
      for (const theme of ['light', 'dark']) {
        for (const pageKey of ['home', 'upload']) {
          await setTheme(page, theme);
          await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
          await gotoReady(page, PAGES[pageKey][lang], pageKey === 'home' ? '#bk-grid:not(.hidden)' : '#adm-main:not(.hidden), main');
          const px1 = await samplePixel(page, 4, 4);
          await page.evaluate(() => {
            document.querySelector('#site-nav').style.visibility = 'hidden';
          });
          const px2 = await samplePixel(page, 4, 4);
          await page.evaluate(() => {
            document.querySelector('#site-nav').style.visibility = '';
          });
          for (const ch of ['r', 'g', 'b']) {
            expect(Math.abs(px1[ch] - px2[ch]), `[${theme}][${pageKey}] 通道 ${ch} 差值 ≤2`).toBeLessThanOrEqual(2);
          }
        }
      }
    });

    /* 验收：标题区内不再有按钮元素 */
    test('4. 标题区按钮已删除', async ({ page }) => {
      await setup(page, lang, 'upload');
      for (const sel of ['.subpage-back', '.subpage-actions', '.subpage-more', '.sgx-topcard-back', '.sgx-topcard-more']) {
        await expect(page.locator(sel), `不应有 ${sel}`).toHaveCount(0);
      }
    });

    /* 验收 5：标题区尺寸（v1.1：max(280px, 35%)） */
    test('5. 标题区尺寸', async ({ page }) => {
      await setup(page, lang, 'upload');
      const r = await page.evaluate((sel) => {
        const head = document.querySelector(sel.head);
        const hr = head.getBoundingClientRect();
        const title = head.querySelector(sel.headTitle).getBoundingClientRect();
        return {
          headH: hr.height,
          titleBottomOffset: hr.bottom - title.bottom,
        };
      }, SEL);
      const vh = page.viewportSize().height;
      const expectedH = Math.max(280, vh * 0.35);
      expect(Math.abs(r.headH - expectedH), `标题区高度 ${expectedH}±1`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.titleBottomOffset - 76), '大标题底边 -76±1').toBeLessThanOrEqual(1);
    });

    /* 验收 6：滚动后状态（用书库首页，有足够内容可滚） */
    test('6. 滚动后状态', async ({ page }) => {
      await setup(page, lang, 'home');
      const vw = page.viewportSize().width;
      // 滚到底部确保超过阈值
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      // 等 body 有 sgx-stuck 类
      await expect.poll(async () => {
        return await page.evaluate(() => document.body.classList.contains('sgx-stuck'));
      }, { timeout: 5000 }).toBe(true);
      // 等小标题可见
      await expect.poll(async () => {
        return await page.evaluate(() => {
          const m = document.querySelector('.subpage-mini-title');
          return m ? parseFloat(getComputedStyle(m).opacity) : 0;
        });
      }, { timeout: 5000 }).toBe(1);
      // 头像一直显示；Styrigx 隐藏；大标题已完全淡出
      const st = await page.evaluate(() => ({
        avatar: parseFloat(getComputedStyle(document.querySelector('.sgx-tb-avatar')).opacity),
        brand: parseFloat(getComputedStyle(document.querySelector('.sgx-tb-brand')).opacity),
        text: parseFloat(getComputedStyle(document.querySelector('.sgx-tb-text')).opacity),
        hero: parseFloat(getComputedStyle(document.querySelector('.subpage-hero')).opacity),
      }));
      expect(st.avatar * st.brand, '头像一直显示').toBe(1);
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.sgx-tb-text')).opacity)), { timeout: 5000 }).toBe(0);
      expect(st.hero, '大标题完全淡出').toBe(0);
      // 三个按钮可见且坐标不变
      await expectBox(page.locator(SEL.back), { left: 16, top: 16, width: 52, height: 52 }, 1, '滚动后返回圆');
      await expectBox(page.locator(SEL.nav), { left: vw - 16 - 52, top: 16, width: 52, height: 52 }, 1, '滚动后导航圆');
      const moreVisible = await page.locator(SEL.more).isVisible();
      expect(moreVisible, '滚动后 ⋮ 可见').toBe(true);
      // 小标题可见
      const miniVisible = await page.evaluate(() => {
        const m = document.querySelector('.subpage-mini-title');
        const r = m.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
      expect(miniVisible, '小标题可见').toBe(true);
    });

    /* 验收：导航菜单 */
    test('7. 导航菜单', async ({ page }) => {
      await setup(page, lang, 'home');
      const navBtn = page.locator(SEL.nav);
      const menu = page.locator(SEL.navMenu);
      // 点九宫点，菜单出现
      await navBtn.click();
      await expect(menu, '导航菜单出现').not.toHaveClass(/hidden/);
      // 有 3 项
      const items = menu.locator('[role="menuitem"]');
      await expect(items, '菜单有 3 项').toHaveCount(3);
      // 当前站点有 ✓（aria-current）
      const current = menu.locator('[aria-current="true"]');
      await expect(current, '当前站点高亮').toHaveCount(1);
      // Esc 关闭
      await page.keyboard.press('Escape');
      await expect(menu, 'Esc 后关闭').toHaveClass(/hidden/);
    });

    /* 验收：⋮ 菜单 */
    test('8. ⋮ 菜单', async ({ page }) => {
      await setup(page, lang, 'home');
      const moreBtn = page.locator(SEL.more);
      await moreBtn.click();
      // 原来的设置菜单应该打开（#bk-more-menu）
      const bkMenu = page.locator('#bk-more-menu');
      await expect(bkMenu, '⋮ 菜单打开').not.toHaveClass(/hidden/);
    });

    /* 验收：返回圆行为 */
    test('9. 返回圆', async ({ page }) => {
      // 书库首页：返回圆有 data-go-back（exit-to-host 接管）
      await setup(page, lang, 'home');
      const backBtn = page.locator(SEL.back);
      await expect(backBtn, '书库首页有返回圆').toHaveCount(1);
      const hasGoBack = await backBtn.getAttribute('data-go-back');
      expect(hasGoBack, '返回圆有 data-go-back').not.toBeNull();
      // 子页面：返回圆存在
      await setup(page, lang, 'upload');
      await expect(page.locator(SEL.back), '子页面有返回圆').toHaveCount(1);
    });
  });
}

/* ===== DeX 验收（1280×800 强制视口）===== */
test.describe('topbar v2.0 DeX', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  for (const lang of ['zh', 'en']) {
    /* 验收：容器宽 1068±1 且居中，三块尺寸与手机相同 */
    test(`10. DeX 容器与三块 [${lang}]`, async ({ page }) => {
      await setup(page, lang, 'home');
      const topbar = page.locator(SEL.topbar);
      const box = await topbar.boundingBox();
      expect(Math.abs(box.width - 1068), '容器宽 1068±1').toBeLessThanOrEqual(1);
      expect(Math.abs(box.x - (1280 - 1068) / 2), '容器居中').toBeLessThanOrEqual(1);
      // 三块尺寸与手机相同
      await expectBox(page.locator(SEL.back), { width: 52, height: 52 }, 1, 'DeX 返回圆尺寸');
      await expectBox(page.locator(SEL.nav), { width: 52, height: 52 }, 1, 'DeX 导航圆尺寸');
      const pillBox = await page.locator(SEL.pill).boundingBox();
      expect(Math.abs(pillBox.height - 52), 'DeX 长条高 52').toBeLessThanOrEqual(1);
      // 三块 y 都是 16
      const backBox = await page.locator(SEL.back).boundingBox();
      expect(Math.abs(backBox.y - 16), 'DeX 返回圆 top 16').toBeLessThanOrEqual(1);
    });

    /* 验收：DeX 标题区按钮位置（106±1） */
    test(`11. DeX 标题区 [${lang}]`, async ({ page }) => {
      await setup(page, lang, 'upload');
      // 标题区按钮已删除，确认不存在
      await expect(page.locator('.subpage-back'), '无 subpage-back').toHaveCount(0);
      // scrollWidth <= innerWidth（无横向滚动）
      const noOverflow = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      expect(noOverflow, '无横向滚动').toBe(true);
    });
  }
});


/* 大标题与小标题交接：不会两个标题同时出现 */
test.describe('大标题与顶栏小标题交接', () => {
  test('滚动全程：小标题出现时大标题 opacity 为 0；大标题碰到顶栏下沿时正好切换', async ({ page }) => {
    await setup(page, 'zh', 'home');
    const r = await page.evaluate(async () => {
      const hero = document.querySelector('.subpage-hero');
      const head = document.querySelector('[data-subpage-head]');
      const bar = document.querySelector('.sgx-topbar').getBoundingClientRect().bottom;
      const out = [];
      const raf = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
      for (let y = 0; y <= head.offsetHeight; y += 8) {
        window.scrollTo(0, y);
        await raf();
        const top = head.getBoundingClientRect().top + hero.offsetTop;
        out.push({ y, top, bar, op: parseFloat(getComputedStyle(hero).opacity), stuck: document.body.classList.contains('sgx-stuck') });
      }
      return out;
    });
    for (const s of r) {
      if (s.stuck) expect(s.op, `y=${s.y} 已切到小标题时大标题必须完全消失`).toBe(0);
      if (s.top > s.bar + 48) expect(s.op, `y=${s.y} 离顶栏还远时大标题完全显示`).toBe(1);
      if (s.top > s.bar) expect(s.stuck, `y=${s.y} 大标题还没碰到顶栏时不切换`).toBe(false);
    }
    expect(r.some((s) => s.stuck), '最终会切到小标题').toBe(true);
    expect(r.some((s) => s.op > 0 && s.op < 1), '中间有淡出过程').toBe(true);
  });
});

/* 九宫点菜单：在 book.styrigx.com 上只有「书库」打 ✓（主页的匹配规则不能把子域名也算进去） */
test.describe('导航菜单当前站点', () => {
  test('book.styrigx.com 上只有书库高亮', async ({ page, baseURL }) => {
    await mockBookAPIs(page, { books: BOOKS });
    await page.route('http://book.styrigx.com/**', (route) => {
      const u = new URL(route.request().url());
      route.continue({ url: baseURL + u.pathname + u.search });
    });
    await page.goto('http://book.styrigx.com/');
    await page.locator('.sgx-tb-nav').click();
    const cur = page.locator('#sgx-tb-navmenu [aria-current="true"]');
    await expect(cur).toHaveCount(1);
    await expect(cur).toContainText(/书库|Library/);
  });

  /* 三站统一顺序：主站第一，然后书库、博客（以后新增站点往后排） */
  test('菜单顺序：主站 / 书库 / 博客', async ({ page }) => {
    await mockBookAPIs(page, { books: BOOKS });
    await page.goto('/');
    await page.locator('.sgx-tb-nav').click();
    const labels = await page.locator('#sgx-tb-navmenu .bk-menu-item').allInnerTexts();
    expect(labels.map((t) => t.trim())).toEqual(['主站', '书库', '博客']);
  });
});

/* 壁纸与主站同一套：独立 fixed 层，不依赖 body 的 background-attachment（手机上会被忽略） */
test.describe('壁纸', () => {
  test('#sgx-wallpaper 是 fixed 层且铺着 --m-wallpaper', async ({ page }) => {
    await mockBookAPIs(page, { books: BOOKS });
    await page.goto('/');
    const r = await page.evaluate(() => {
      const el = document.getElementById('sgx-wallpaper');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { pos: cs.position, img: cs.backgroundImage, bodyImg: getComputedStyle(document.body).backgroundImage };
    });
    expect(r, '#sgx-wallpaper 存在').not.toBeNull();
    expect(r.pos).toBe('fixed');
    expect(r.img).toContain('radial-gradient');
    expect(r.bodyImg).toBe('none');
  });
});
