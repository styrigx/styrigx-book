/* 顶栏与页面头部统一规格 v1.0 验收测试
 * 规格第八节第 1-7 条，每条一个 test，中英文各跑一遍。
 * 页面 URL 和按钮选择器放顶部配置。
 */
const { test, expect } = require('@playwright/test');
const { mockBookAPIs, setTheme, gotoReady, BOOKS } = require('../visual/helpers.js');

/* ===== 顶部配置 ===== */
const PAGES = {
  home: { zh: '/', en: '/en/' },
  settings: { zh: '/admin/', en: '/en/admin/' }, // 用上传页作为子页面代表
};
const SEL = {
  card: '.sgx-topcard',
  brand: '.sgx-topcard-brand',
  avatar: '.sgx-topcard-avatar',
  brandText: '.sgx-topcard-text',
  cardBack: '.sgx-topcard-back',
  cardMore: '.sgx-topcard-more',
  miniTitle: '.subpage-mini-title',
  siteNav: '#site-nav',
  head: '[data-subpage-head]',
  headTitle: '.subpage-title',
  headBack: '.subpage-back',
  headMore: '.subpage-actions',
  origBack: '.subpage-back',
  origMore: '.subpage-actions .subpage-more, .subpage-actions #bk-menu-btn',
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

/** 截取 (x,y) 处 1x1 像素，返回 {r,g,b}。用最小 PNG 解析器，不依赖外部库。 */
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
  // 1x1：filter 字节 + 像素数据（小图通常 filter=0；若非 0 则按原样取，1 像素无前行可参考）
  const px = raw.slice(1);
  if (colorType === 6) return { r: px[0], g: px[1], b: px[2] };
  if (colorType === 2) return { r: px[0], g: px[1], b: px[2] };
  throw new Error('不支持的 PNG 颜色类型: ' + colorType);
}

async function setup(page, lang, pageKey) {
  await setTheme(page, 'light');
  await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
  await gotoReady(page, PAGES[pageKey][lang], '#bk-grid:not(.hidden)');
}

for (const lang of ['zh', 'en']) {
  test.describe(`topbar-spec [${lang}]`, () => {
    /* 验收 1：卡片 left 16±1，right 16±1，top 16±1，height 52±1，圆角 26px */
    test('1. 卡片几何', async ({ page }) => {
      await setup(page, lang, 'home');
      const card = page.locator(SEL.card);
      const box = await expectBox(card, { height: 52 }, 1, '卡片高度');
      const vw = page.viewportSize().width;
      expect(Math.abs(box.x - 16), '卡片 left 16±1').toBeLessThanOrEqual(1);
      expect(Math.abs(vw - (box.x + box.width) - 16), '卡片 right 16±1').toBeLessThanOrEqual(1);
      expect(Math.abs(box.y - 16), '卡片 top 16±1').toBeLessThanOrEqual(1);
      const radius = await card.evaluate((el) => getComputedStyle(el).borderRadius);
      expect(radius, '卡片圆角 26px').toBe('26px');
    });

    /* 验收 2：头像距卡片左 12±1；头像右到文字左 8±1；垂直居中误差 ≤1 */
    test('2. 品牌组几何', async ({ page }) => {
      await setup(page, lang, 'home');
      const card = page.locator(SEL.card);
      const cardBox = await card.boundingBox();
      const cardCy = cardBox.y + cardBox.height / 2;
      const avatar = page.locator(SEL.avatar);
      const avatarBox = await avatar.boundingBox();
      // 头像距卡片左边缘 12±1
      expect(Math.abs(avatarBox.x - cardBox.x - 12), '头像距卡片左 12±1').toBeLessThanOrEqual(1);
      // 头像右到文字左 8±1（Range 量）
      const tr = await textRect(page, SEL.brandText);
      expect(Math.abs(tr.left - (avatarBox.x + avatarBox.width) - 8), '头像到文字 8±1').toBeLessThanOrEqual(1);
      // 垂直居中
      const avatarCy = avatarBox.y + avatarBox.height / 2;
      expect(Math.abs(avatarCy - cardCy), '头像垂直居中 ≤1').toBeLessThanOrEqual(1);
      expect(Math.abs(tr.cy - cardCy), '文字垂直居中 ≤1').toBeLessThanOrEqual(1);
      // 品牌文字不翻译
      const text = await page.locator(SEL.brandText).textContent();
      expect(text.trim(), '品牌文字 Styrigx 不翻译').toBe('Styrigx');
    });

    /* 验收 3：#site-nav computed background-color 透明；y=4 像素 = 背景色 */
    test('3. 顶栏区域无实心底色', async ({ page }) => {
      await setup(page, lang, 'home');
      const bg = await page.locator(SEL.siteNav).evaluate((el) => getComputedStyle(el).backgroundColor);
      expect(bg, '#site-nav 背景透明').toBe('rgba(0, 0, 0, 0)');
    });

    /* 验收 3b：像素采样 — y=4,x=4 处像素应等于隐藏顶栏后同一位置的背景色（各通道 ≤2） */
    test('3b. 顶栏像素与背景一致', async ({ page }) => {
      for (const theme of ['light', 'dark']) {
        for (const pageKey of ['home', 'settings']) {
          await setTheme(page, theme);
          await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
          await gotoReady(page, PAGES[pageKey][lang], pageKey === 'home' ? '#bk-grid:not(.hidden)' : '#adm-main:not(.hidden), main');
          const px1 = await samplePixel(page, 4, 4);
          await page.evaluate(() => {
            document.querySelector('#site-nav').style.visibility = 'hidden';
            document.querySelector('.sgx-topcard').style.visibility = 'hidden';
          });
          const px2 = await samplePixel(page, 4, 4);
          // 恢复（同一 context 后续测试用新页面，此处仅保险）
          await page.evaluate(() => {
            document.querySelector('#site-nav').style.visibility = '';
            const c = document.querySelector('.sgx-topcard');
            if (c) c.style.visibility = '';
          });
          for (const ch of ['r', 'g', 'b']) {
            expect(Math.abs(px1[ch] - px2[ch]), `[${theme}][${pageKey}] 通道 ${ch} 差值 ≤2 (实际 ${px1[ch]} vs ${px2[ch]})`).toBeLessThanOrEqual(2);
          }
        }
      }
    });

    /* 验收 4：页面里不存在 #nav-time-center 和 #nav-wx */
    test('4. 无旧顶栏元素', async ({ page }) => {
      await setup(page, lang, 'home');
      for (const id of ['#nav-time-center', '#nav-wx', '#nav-time', '#dex-clock-pop']) {
        await expect(page.locator(id), `不应有 ${id}`).toHaveCount(0);
      }
    });

    /* 验收 5：设置页标题区尺寸 */
    test('5. 标题区尺寸', async ({ page }) => {
      await setTheme(page, 'light');
      await mockBookAPIs(page, { owner: true });
      await gotoReady(page, PAGES.settings[lang], '#adm-main:not(.hidden), main');
      const r = await page.evaluate((sel) => {
        const head = document.querySelector(sel.head);
        const hr = head.getBoundingClientRect();
        const title = head.querySelector(sel.headTitle).getBoundingClientRect();
        const back = head.querySelector(sel.headBack).getBoundingClientRect();
        const more = head.querySelector(sel.headMore).getBoundingClientRect();
        const vw = window.innerWidth;
        return {
          headH: hr.height,
          titleBottomOffset: hr.bottom - title.bottom,
          backLeft: back.left,
          backBottomOffset: hr.bottom - back.bottom,
          moreRight: vw - more.right,
          moreBottomOffset: hr.bottom - more.bottom,
        };
      }, SEL);
      // 标题区高度 = max(240, 0.3*844) = 253.2 ±1（844 高视口）
      const vh = page.viewportSize().height;
      const expectedH = Math.max(240, vh * 0.3);
      expect(Math.abs(r.headH - expectedH), `标题区高度 ${expectedH}±1`).toBeLessThanOrEqual(1);
      // 大标题底边 = 标题区底边 - 76
      expect(Math.abs(r.titleBottomOffset - 76), '大标题底边 -76±1').toBeLessThanOrEqual(1);
      // ← 和 ⋮ 距左右 16±1，距底边 8±1
      expect(Math.abs(r.backLeft - 16), '← 距左 16±1').toBeLessThanOrEqual(1);
      expect(Math.abs(r.backBottomOffset - 8), '← 距底边 8±1').toBeLessThanOrEqual(1);
      expect(Math.abs(r.moreRight - 16), '⋮ 距右 16±1').toBeLessThanOrEqual(1);
      expect(Math.abs(r.moreBottomOffset - 8), '⋮ 距底边 8±1').toBeLessThanOrEqual(1);
    });

  });
}

/* ===== DeX 验收（1280×800 强制视口）===== */
test.describe('topbar-spec DeX', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const lang of ['zh', 'en']) {
    /* 验收 7：DeX（1280 宽）卡片宽 1068±1 且居中 */
    test(`7. DeX 卡片宽度居中 [${lang}]`, async ({ page }) => {
      await setup(page, lang, 'home');
      // 确认布局类已切到 dex（视口 ≥980 自动触发）
      await expect.poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('layout-dex'))
      ).toBe(true);
      const card = page.locator(SEL.card);
      const box = await card.boundingBox();
      const vw = page.viewportSize().width;
      expect(Math.abs(box.width - 1068), 'DeX 卡片宽 1068±1').toBeLessThanOrEqual(1);
      const centerOffset = Math.abs((box.x + box.x + box.width) / 2 - vw / 2);
      expect(centerOffset, '卡片水平居中').toBeLessThanOrEqual(1);
    });

    /* 验收 7b：DeX 标题区按钮位置 — ← left = 106±1，⋮ right = 106±1（视口坐标） */
    test(`7b. DeX 标题区按钮位置 [${lang}]`, async ({ page }) => {
      await setTheme(page, 'light');
      await mockBookAPIs(page, { owner: true });
      await gotoReady(page, PAGES.settings[lang], '#adm-main:not(.hidden), main');
      await expect.poll(async () =>
        page.evaluate(() => document.documentElement.classList.contains('layout-dex'))
      ).toBe(true);
      const r = await page.evaluate(() => {
        const back = document.querySelector('.subpage-back').getBoundingClientRect();
        const more = document.querySelector('.subpage-actions').getBoundingClientRect();
        return { backLeft: back.left, moreRight: window.innerWidth - more.right };
      });
      expect(Math.abs(r.backLeft - 106), `← left 应为 106±1，实测 ${r.backLeft.toFixed(1)}`).toBeLessThanOrEqual(1);
      expect(Math.abs(r.moreRight - 106), `⋮ right 应为 106±1，实测 ${r.moreRight.toFixed(1)}`).toBeLessThanOrEqual(1);
    });
  }
});

/* 验收 6：滚动后状态 — 三种模式 */
for (const mode of ['normal', 'js-fallback', 'reduced-motion']) {
  test.describe(`topbar-spec 滚动 [${mode}]`, () => {
    test.beforeEach(async ({ page }) => {
      if (mode === 'js-fallback') {
        // 强制 JS 兜底：让 CSS.supports('animation-timeline: view()') 返回 false
        await page.addInitScript(() => {
          const orig = CSS.supports.bind(CSS);
          CSS.supports = (...args) => {
            if (args.join(' ').includes('animation-timeline')) return false;
            return orig(...args);
          };
          document.documentElement.classList.add('sgx-no-view-timeline');
        });
      }
      if (mode === 'reduced-motion') {
        await page.emulateMedia({ reducedMotion: 'reduce' });
      }
    });

    for (const lang of ['zh', 'en']) {
      test(`6. 滚动后状态 [${lang}]`, async ({ page }) => {
        await setTheme(page, 'light');
        await mockBookAPIs(page, { owner: true, books: MANY_BOOKS });
        await gotoReady(page, PAGES.home[lang], '#bk-grid:not(.hidden)');
        // 滚动 400px
        await page.evaluate(() => window.scrollTo(0, 400));
        // body 应有 sgx-stuck 类
        await expect.poll(async () => {
          return page.evaluate(() => document.body.classList.contains('sgx-stuck'));
        }, { timeout: 5000 }).toBe(true);
        // 品牌组 opacity 0 且不可点
        const brand = await page.evaluate(() => {
          const b = document.querySelector('.sgx-topcard-brand');
          return {
            opacity: parseFloat(getComputedStyle(b).opacity),
            pointerEvents: getComputedStyle(b).pointerEvents,
          };
        });
        expect(brand.opacity, '品牌组 opacity 0').toBe(0);
        expect(brand.pointerEvents, '品牌组不可点').toBe('none');
        // 小标题 opacity 1（用 expect.poll 等，不用 waitForTimeout）
        await expect.poll(async () => {
          return page.evaluate(() => {
            const m = document.querySelector('.sgx-topcard .subpage-mini-title');
            return m ? parseFloat(getComputedStyle(m).opacity) : 0;
          });
        }, { timeout: 5000 }).toBe(1);
        // 小标题中心与卡片中心误差 ≤1
        const centers = await page.evaluate(() => {
          const card = document.querySelector('.sgx-topcard').getBoundingClientRect();
          const mini = document.querySelector('.sgx-topcard .subpage-mini-title').getBoundingClientRect();
          return {
            dx: Math.abs((mini.left + mini.width / 2) - (card.left + card.width / 2)),
            dy: Math.abs((mini.top + mini.height / 2) - (card.top + card.height / 2)),
          };
        });
        expect(centers.dx, '小标题水平居中 ≤1').toBeLessThanOrEqual(1);
        expect(centers.dy, '小标题垂直居中 ≤1').toBeLessThanOrEqual(1);
        // 卡片版 ← 左边缘 = 卡片左 + 6，⋮ 右边缘 = 卡片右 - 6
        const btns = await page.evaluate(() => {
          const card = document.querySelector('.sgx-topcard').getBoundingClientRect();
          const back = document.querySelector('.sgx-topcard-back').getBoundingClientRect();
          const more = document.querySelector('.sgx-topcard-more').getBoundingClientRect();
          return {
            backLeftOffset: back.left - card.left,
            moreRightOffset: card.right - more.right,
          };
        });
        expect(Math.abs(btns.backLeftOffset - 6), '← 左边缘 = 卡片左 + 6').toBeLessThanOrEqual(1);
        expect(Math.abs(btns.moreRightOffset - 6), '⋮ 右边缘 = 卡片右 - 6').toBeLessThanOrEqual(1);
        // 点卡片版 ← 效果和原按钮一致
        const clicked = await page.evaluate(() => {
          let hit = false;
          const orig = document.querySelector('.subpage-back');
          const origClick = orig.click.bind(orig);
          orig.click = () => { hit = true; };
          document.querySelector('.sgx-topcard-back').click();
          orig.click = origClick;
          return hit;
        });
        expect(clicked, '卡片版 ← 调用原按钮 click()').toBe(true);
        // 滚回顶部还原
        await page.evaluate(() => window.scrollTo(0, 0));
        await expect.poll(async () => {
          return page.evaluate(() => document.body.classList.contains('sgx-stuck'));
        }, { timeout: 5000 }).toBe(false);
      });
    }
  });
}
