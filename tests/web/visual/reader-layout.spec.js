/* 阅读器布局断言（book）：foliate margin/gap 单位与语义。
 *
 * 背景：曾经往 renderer 传裸数字 margin（'48'），minmax(var(--_margin),1fr)
 * 整条声明失效，正文只占屏幕中间一行。本文件断言：
 *   1. 正文 #container 高度 ≥ 可用高度 − 上下 margin(32×2) − 4px；
 *   2. 页眉有章节名/书名、页脚是「N / M」页码；
 *   3. 页边距最小/最大时正文宽度确实变化（gap 百分比生效）。
 *
 * 不截图（不产生视觉基线）。Hark 规则：等具体元素，不用 networkidle，
 * 不用 waitForTimeout。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, setTheme, freezeTime, expect } = require('./helpers.js');

const MOBILE = { width: 390, height: 844 };

/* 打开阅读器：localStorage 预置 bk-settings（页边距），等正文渲染 + 页脚填好 */
async function openReader(page, margin) {
  await page.setViewportSize(MOBILE);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setTheme(page, 'light');
  await freezeTime(page);
  await mockBookAPIs(page, { owner: false });
  await page.addInitScript(m => {
    try { localStorage.setItem('bk-settings', JSON.stringify({ margin: m })); }
    catch (e) {}
  }, margin);
  await page.goto('/read/?id=epub1', { waitUntil: 'domcontentloaded' });
  /* 等 blob frame 正文渲染出文字（与 reader-epub 视觉用例同） */
  await expect.poll(async () => {
    const f = page.frames().find(fr => fr.url().startsWith('blob:'));
    if (!f) return 0;
    try { return await f.evaluate(() => (document.body ? document.body.innerText.length : 0)); }
    catch (e) { return 0; }
  }, { timeout: 30000 }).toBeGreaterThan(50);
  /* 等页眉页脚填好（updateMarginals 在 relocate 里执行） */
  await expect.poll(async () => {
    try {
      return await page.evaluate(() => {
        const r = window.__bkrdTest && window.__bkrdTest.getRenderer();
        return (r && r.feet && r.feet[0] && r.feet[0].textContent) || '';
      });
    } catch (e) { return ''; }
  }, { timeout: 15000 }).toMatch(/^\d+ \/ \d+$/);
  await page.evaluate(() => document.fonts.ready);
}

/* 经 renderer.heads/feet（paginator 公开引用，closed shadow 外可用）量取布局。
 * 注意：heads[0] 是内层 span（高度=文字高度），外层 div 才是 grid item（高度=32px）。 */
async function layoutInfo(page) {
  return page.evaluate(() => {
    const r = window.__bkrdTest.getRenderer();
    const hOuter = r.heads[0].parentElement.getBoundingClientRect();
    const fOuter = r.feet[0].parentElement.getBoundingClientRect();
    const host = r.getBoundingClientRect();
    return {
      headerH: hOuter.height,
      containerH: fOuter.top - hOuter.bottom, // grid row2（正文区）高度
      hostH: host.height,                     // 可用高度（顶栏/底栏之间）
      headText: r.heads[0].textContent,
      footText: r.feet[0].textContent,
      headW: hOuter.width,                   // 内容列宽（随 gap 变化）
    };
  });
}

test('reader-container-fills-height', async ({ page }) => {
  await openReader(page, 48);
  const m = await layoutInfo(page);
  expect(m.headerH, '页眉高度≈32px（上下 margin 固定 32px）').toBeGreaterThanOrEqual(30);
  expect(m.headerH).toBeLessThanOrEqual(34);
  expect(m.containerH, '正文高度 ≥ 可用高度−64−4').toBeGreaterThanOrEqual(m.hostH - 64 - 4);
  expect(m.headText.length, '页眉有章节名/书名').toBeGreaterThan(0);
  expect(m.footText, '页脚是「N / M」页码').toMatch(/^\d+ \/ \d+$/);
});

test('reader-margin-changes-width', async ({ page }) => {
  await openReader(page, 16);
  const wMin = (await layoutInfo(page)).headW;
  await openReader(page, 120);
  const wMax = (await layoutInfo(page)).headW;
  expect(wMin - wMax, '页边距最小→最大时正文宽度应明显变窄').toBeGreaterThan(10);
});
