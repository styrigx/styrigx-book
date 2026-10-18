/* B2-7：书站继承主站外观（sgx-ui cookie）+ 数字健康上报。
 * 本地跑在 localhost，cookie 直接种在 localhost 上，效果等同线上 Domain=styrigx.com。 */
const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:8932';
const enc = (o) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function setUi(context, ui) {
  await context.addCookies([{ name: 'sgx-ui', value: enc(ui), url: BASE }]);
}

test('有主站 cookie：首帧前应用深色、调色板、字体、减弱动效', async ({ page, context }) => {
  await setUi(context, { v: 2, mode: 'dark', mat: Date.now(), pal: 'teal', fs: 'large', rm: 1 });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const h = page.locator('html');
  await expect(h).toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(h).toHaveAttribute('data-palette', 'teal');
  await expect(h).toHaveAttribute('data-font-size', 'large');
  await expect(h).toHaveClass(/reduced-motion/);
  const primary = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--m-primary').trim());
  expect(primary.toLowerCase()).toBe('#4cdadd');
});

test('没有 cookie：保持原行为（浅色、默认色板）', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const h = page.locator('html');
  await expect(h).not.toHaveClass(/(^|\s)dark(\s|$)/);
  expect(await h.getAttribute('data-palette')).toBeNull();
});

test('书库里后改深浅色：本地选择优先，调色板仍跟主站', async ({ page, context }) => {
  await setUi(context, { v: 2, mode: 'dark', mat: 1000, pal: 'orchid', fs: 'standard', rm: 0 });
  await page.addInitScript(() => {
    try { localStorage.setItem('sgx-theme-mode', 'light'); localStorage.setItem('sgx-theme-at', String(Date.now())); } catch (e) {}
  });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const h = page.locator('html');
  await expect(h).not.toHaveClass(/(^|\s)dark(\s|$)/);
  await expect(h).toHaveAttribute('data-palette', 'orchid');
});

test('数字健康：书库页计时并在页面隐藏时上报到主站接口', async ({ page }) => {
  const posts = [];
  await page.route('https://styrigx.com/api/wellbeing', (r) => { posts.push(r.request().postData()); return r.fulfill({ status: 204 }); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.mouse.click(5, 300);
  await page.waitForTimeout(5600);
  await page.mouse.click(5, 300);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { get: () => 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(() => posts.length, { timeout: 5000 }).toBeGreaterThan(0);
  const b = JSON.parse(posts[0]);
  expect(b.s[0].k).toBe('book');
  expect(b.s[0].sec).toBeGreaterThanOrEqual(5);
  expect(b.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});
