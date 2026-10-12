/* 视觉回归测试公共 helpers（book 2.0）。
 *
 * 静态 http-server 没有 functions/ 后端，所有 /api/* 都在这里 mock：
 *   - /api/session-check        → 200 {ok:true}（阻止锁屏同步触发 reload）
 *   - /api/private/me          → {role:'owner'} 或 {}
 *   - /api/books / /api/private/books → 固件书目（或空数组测空态）
 *   - /api/cover / /api/private/cover → SVG 占位封面（按 cover_key 确定颜色）
 *   - /api/file / /api/private/file   → 内存生成的 EPUB / PDF 固件
 *   - /api/status               → {storage_enabled:true}（上传页）
 *   - /api/admin/books          → 固件书目（上传页管理列表）
 *   - 其他 /api/*               → 404
 *
 * Hark 规则（沿用主站）：goto 用 domcontentloaded + 等具体元素，不用 networkidle；
 * 不用 waitForTimeout；关掉动画；冻结时间。
 */
'use strict';

const { expect } = require('@playwright/test');
const { BOOKS } = require('./fixtures/books.js');
const { makeEpub, makePdf } = require('./fixtures/file-fixtures.js');

/* 按 cover_key 确定性取色，保证每次截图封面颜色一致 */
function coverColor(key) {
  let h = 0;
  const s = String(key || '?');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  const hues = [210, 160, 24, 340, 265, 190, 10, 130];
  return `hsl(${hues[h % hues.length]}, 45%, 42%)`;
}

function coverSVG(key, title) {
  const initial = String(title || '?').trim().charAt(0) || '?';
  const bg = coverColor(key);
  const esc = String(initial).replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600" viewBox="0 0 400 600">` +
    `<rect width="400" height="600" fill="${bg}"/>` +
    `<rect x="24" y="24" width="352" height="552" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="3"/>` +
    `<text x="200" y="330" text-anchor="middle" font-family="sans-serif" font-size="150" font-weight="700" fill="rgba(255,255,255,.92)">${esc}</text>` +
    `</svg>`;
}

const EPUB_BUF = makeEpub();
const PDF_BUF = makePdf();
const FILE_BY_ID = { epub1: EPUB_BUF, epub2: EPUB_BUF, epub3: EPUB_BUF, epub4: EPUB_BUF, pdf1: PDF_BUF, pdf2: PDF_BUF };

/**
 * 注册全部 /api/* mock。必须在 goto 之前调用。
 * @param {import('@playwright/test').Page} page
 * @param {{ owner?: boolean, books?: Array|null }} opts
 *   books: 传入数组用固件；传 [] 测空态；默认用 BOOKS。
 */
async function mockBookAPIs(page, opts = {}) {
  const owner = !!opts.owner;
  /* 注意：调用方可能传 { books: undefined }（解构默认值），hasOwnProperty 会误判；
     用 undefined 判断才是可靠的「未传」 */
  const books = opts.books !== undefined ? opts.books : BOOKS;

  /* 注意：Playwright 里后注册的 route 优先匹配，所以 catch-all 必须最先注册 */
  /* 未 mock 到的 /api/*：显式 404，避免请求悬挂导致页面一直 loading */
  await page.route('**/api/**', route =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }));

  await page.route('**/api/session-check', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }));

  await page.route('**/api/private/me', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(owner ? { role: 'owner' } : {}) }));

  const booksBody = JSON.stringify({ books });
  await page.route('**/api/books', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: booksBody }));
  await page.route('**/api/private/books', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: booksBody }));

  await page.route(/\/api\/(private\/)?cover.*/, async route => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get('key') || '?';
    const book = books.find(b => 'cover-' + b.id === key || b.cover_key === key);
    await route.fulfill({ status: 200, contentType: 'image/svg+xml',
      body: coverSVG(key, book ? book.title : key) });
  });

  await page.route(/\/api\/(private\/)?file.*/, async route => {
    const url = new URL(route.request().url());
    const id = url.searchParams.get('id');
    const buf = FILE_BY_ID[id];
    if (!buf) { await route.fulfill({ status: 404, body: 'not found' }); return; }
    const isPdf = id.startsWith('pdf');
    await route.fulfill({ status: 200,
      contentType: isPdf ? 'application/pdf' : 'application/epub+zip', body: buf });
  });

  await page.route('**/api/status', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
      body: '{"storage_enabled":true}' }));
  await page.route('**/api/admin/books', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: booksBody }));

  /* 非本地请求一律拦截（字体/库全部本地 vendor，不应有外网请求） */
  await page.route(/^(https?:)?\/\/(?!localhost|127\.0\.0\.1)/, route => route.abort());
}

/**
 * 预置主题（localStorage sgx-theme-mode，与 baseof.html 的主题预读脚本一致）。
 * 浅色也显式写 'light'，避免跑在深色系统上的机器污染基线。
 */
async function setTheme(page, theme) {
  await page.addInitScript(t => {
    try { localStorage.setItem('sgx-theme-mode', t); } catch (e) {}
  }, theme);
}

/* 冻结时间：固件日期都是固定字符串，这里只是兜底 */
async function freezeTime(page) {
  await page.addInitScript(() => {
    const T0 = Date.parse('2026-10-12T00:00:00+08:00');
    const RealDate = Date;
    class FrozenDate extends RealDate {
      constructor(...args) { super(...(args.length ? args : [T0])); }
      static now() { return T0; }
    }
    Object.setPrototypeOf(FrozenDate, RealDate);
    window.Date = FrozenDate;
  });
}

/**
 * 打开页面并等就绪：domcontentloaded + 具体元素可见 + 字体加载完成。
 * @param readySelector 页面主体就绪的标志选择器
 */
async function gotoReady(page, url, readySelector) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(readySelector).first()).toBeVisible({ timeout: 15000 });
  await page.evaluate(() => document.fonts.ready);
}

module.exports = { mockBookAPIs, setTheme, freezeTime, gotoReady, expect, BOOKS };
