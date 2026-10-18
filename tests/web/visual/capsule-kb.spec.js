/* Book 手机验收返工 第六、七项 E2E（搜索栏键盘跟随 / 语音按钮）。
 *
 * 第六项：移植主站 vk.js（onKeyboardHeight 整文件）+ capsule.js 的 kbUpdate/open/close/
 *   touchstart preventDefault + focus({preventScroll:true})/blur 180ms 收起 + .sgx-kb-sync/.sgx-vk CSS。
 *   - 两条键盘高度路径：VirtualKeyboard geometrychange、visualViewport resize。
 *   - 键盘 0/半/全高三时刻：胶囊 bottom == kbH + 12（Space 间距）；宽度与 Space 同视口同时刻差 ≤ 2px。
 *     Space 用 SGX_TEST_OWNER_GATE=0 本地构建（/files/ 页，body.subpage，capRest=12）。
 * 第七项：移植 voice-sheet.js（整文件）。注入假 SpeechRecognition：
 *   点麦克风 → 弹窗出现；result → 输入框有文字、书架已过滤；error → 有文字提示（不静默）。
 *
 * Hark 规则：goto 用 domcontentloaded + 等具体元素，不用 networkidle，不用 waitForTimeout。
 */
'use strict';

const { test } = require('@playwright/test');
const { mockBookAPIs, gotoReady, expect } = require('./helpers.js');

const SPACE_FILES = 'http://localhost:8941/files/';
const KB_SEQ = [0, 150, 300, 150, 0]; /* 0 → 半高 → 全高 → 半高 → 收起 */
const KB_SPACING = 12; /* Space 间距：胶囊 bottom = kbH + 12 */

/* VirtualKeyboard API 桩（geometrychange 路径） */
async function stubVirtualKeyboard(page) {
  await page.addInitScript(() => {
    const ls = {};
    const vk = {
      overlaysContent: false,
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      removeEventListener(t, f) { const a = ls[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
      __fire(h) {
        (ls.geometrychange || []).slice().forEach((f) => {
          try { f({ target: { boundingRect: { height: h } } }); } catch (e) {}
        });
      },
    };
    try { delete window.navigator.virtualKeyboard; } catch (e) {}
    Object.defineProperty(window.navigator, 'virtualKeyboard', { value: vk, configurable: true });
    window.__testVK = vk;
  });
}
async function fireVK(page, h) {
  await page.evaluate((hh) => window.__testVK.__fire(hh), h);
}

/* visualViewport 桩（resize 路径）。注意：移动仿真下 Chromium 自带 navigator.virtualKeyboard，
   此处必须删掉，真走 visualViewport 回退分支。 */
async function stubVisualViewport(page) {
  await page.addInitScript(() => {
    try { delete window.navigator.virtualKeyboard; } catch (e) {}
    try {
      Object.defineProperty(window.navigator, 'virtualKeyboard', { value: undefined, configurable: true });
    } catch (e) {}
    const ls = {};
    let h = null;
    const vv = {
      get height() { return h == null ? window.innerHeight : h; },
      get offsetTop() { return 0; },
      addEventListener(t, f) { (ls[t] = ls[t] || []).push(f); },
      removeEventListener(t, f) { const a = ls[t] || []; const i = a.indexOf(f); if (i >= 0) a.splice(i, 1); },
      __fire(kbH) {
        h = window.innerHeight - kbH;
        (ls.resize || []).slice().forEach((f) => { try { f(); } catch (e) {} });
      },
    };
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    window.__testVV = vv;
  });
}
async function fireVV(page, h) {
  await page.evaluate((hh) => window.__testVV.__fire(hh), h);
}

function expectedWidth(vw, h, maxSeen) {
  const baseW = Math.min(vw * 0.64, 300);
  const fullW = Math.max(0, vw - 32);
  const p = maxSeen < 1 ? 1 : Math.min(1, h / maxSeen);
  return Math.round(baseW + (fullW - baseW) * p);
}

/* 读胶囊几何 + 状态 */
async function capGeom(page, capId) {
  return page.evaluate((id) => {
    const cap = document.getElementById(id);
    const r = cap.getBoundingClientRect();
    return {
      bottom: window.innerHeight - r.bottom,
      width: r.width,
      kb: document.documentElement.style.getPropertyValue('--sgx-kb'),
      hasVk: document.documentElement.classList.contains('sgx-vk'),
      open: cap.classList.contains('open'),
    };
  }, capId);
}

/* 触屏点输入框（走 touchstart preventDefault + focus({preventScroll:true}) 路径） */
async function tapInput(page, inputId, capId) {
  const box = await page.locator('#' + inputId).boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForFunction((id) => document.getElementById(id).classList.contains('open'), capId, { timeout: 5000 });
}

for (const vp of [{ width: 412, height: 915 }, { width: 360, height: 800 }]) {
  test.describe(`capsule kb-follow ${vp.width}x${vp.height}`, () => {
    test.use({ viewport: vp, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });

    test('visualViewport 路径：三时刻 bottom/宽度，收起不跳', async ({ page }) => {
      await stubVisualViewport(page);
      await mockBookAPIs(page);
      await gotoReady(page, '/', '#bk-cap');
      await tapInput(page, 'bk-cap-input', 'bk-cap');

      let maxSeen = 0;
      for (const h of KB_SEQ) {
        if (h > maxSeen) maxSeen = h;
        await fireVV(page, h);
        const expBottom = h + KB_SPACING;
        await page.waitForFunction((exp) => {
          const r = document.getElementById('bk-cap').getBoundingClientRect();
          return Math.abs(window.innerHeight - r.bottom - exp) < 2;
        }, expBottom, { timeout: 3000 });
        const g = await capGeom(page, 'bk-cap');
        expect(Math.abs(g.bottom - expBottom), `kb=${h} bottom`).toBeLessThanOrEqual(2);
        expect(Math.abs(g.width - expectedWidth(vp.width, h, maxSeen)), `kb=${h} width`).toBeLessThanOrEqual(2);
        expect(g.kb, `kb=${h} --sgx-kb`).toBe(h + 'px');
        expect(g.hasVk, '不应有 sgx-vk 类').toBe(false);
      }
      /* 收起后：blur 180ms 收起，bottom 回 12，宽度回窄胶囊（不先露宽胶囊） */
      await page.evaluate(() => document.getElementById('bk-cap-input').blur());
      await page.waitForFunction(() => !document.getElementById('bk-cap').classList.contains('open'), null, { timeout: 3000 });
      const g = await capGeom(page, 'bk-cap');
      expect(Math.abs(g.bottom - KB_SPACING), '收起后 bottom').toBeLessThanOrEqual(2);
      expect(g.kb, '收起后 --sgx-kb').toBe('0px');
    });

    test('VirtualKeyboard geometrychange 路径：--sgx-kb/宽度/sgx-vk 规则', async ({ page }) => {
      await stubVirtualKeyboard(page);
      await mockBookAPIs(page);
      await gotoReady(page, '/', '#bk-cap');
      await tapInput(page, 'bk-cap-input', 'bk-cap');
      const g0 = await capGeom(page, 'bk-cap');
      expect(g0.hasVk, '应有 sgx-vk 类（overlaysContent=true）').toBe(true);

      let maxSeen = 0;
      for (const h of KB_SEQ) {
        if (h > maxSeen) maxSeen = h;
        await fireVK(page, h);
        await page.waitForFunction((exp) => {
          return document.documentElement.style.getPropertyValue('--sgx-kb') === exp;
        }, h + 'px', { timeout: 3000 });
        const g = await capGeom(page, 'bk-cap');
        expect(Math.abs(g.width - expectedWidth(vp.width, h, maxSeen)), `kb=${h} width`).toBeLessThanOrEqual(2);
        /* 有 VK API 时 bottom 走 CSS env(keyboard-inset-height)：计算样式会把 env() 解析掉，
           改为断言移植的 CSS 规则本身存在（html.sgx-vk 已挂载前面已断言） */
        const vkRule = await page.evaluate(() => {
          for (const sh of document.styleSheets) {
            let rules = [];
            try { rules = sh.cssRules; } catch (e) { continue; }
            for (const r of rules) {
              if (r.selectorText === '.sgx-vk .bk-cap.open') return r.cssText;
            }
          }
          return '';
        });
        expect(vkRule.includes('keyboard-inset-height'), `kb=${h} bottom 规则已移植`).toBe(true);
      }
    });

    test('与 Space 同视口同时刻宽度差 ≤ 2px', async ({ page }) => {
      await stubVisualViewport(page);
      /* Book */
      await mockBookAPIs(page);
      await gotoReady(page, '/', '#bk-cap');
      await tapInput(page, 'bk-cap-input', 'bk-cap');
      const bookW = {};
      for (const h of [150, 300]) {
        await fireVV(page, h);
        await page.waitForFunction((exp) => {
          const r = document.getElementById('bk-cap').getBoundingClientRect();
          return Math.abs(window.innerHeight - r.bottom - exp) < 2;
        }, h + KB_SPACING, { timeout: 3000 });
        bookW[h] = (await capGeom(page, 'bk-cap')).width;
      }
      /* Space（gate-off 本地构建 /files/） */
      await page.goto(SPACE_FILES, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#sgx-cap-files', { state: 'visible', timeout: 10000 });
      await tapInput(page, 'sgx-cap-input-files', 'sgx-cap-files');
      for (const h of [150, 300]) {
        await fireVV(page, h);
        await page.waitForFunction((exp) => {
          const r = document.getElementById('sgx-cap-files').getBoundingClientRect();
          return Math.abs(window.innerHeight - r.bottom - exp) < 2;
        }, h + KB_SPACING, { timeout: 3000 });
        const sw = (await capGeom(page, 'sgx-cap-files')).width;
        expect(Math.abs(bookW[h] - sw), `kb=${h} Book/Space 宽度差`).toBeLessThanOrEqual(2);
      }
    });
  });
}

test.describe('voice button', () => {
  test.use({ viewport: { width: 360, height: 800 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });

  /* 假 SpeechRecognition：record 实例，支持 __result/__error 注入 */
  async function stubSR(page) {
    await page.addInitScript(() => {
      window.__srLog = [];
      class FakeSR {
        constructor() {
          this.started = false;
          this.onresult = null; this.onerror = null; this.onend = null;
          window.__srLog.push(this);
        }
        start() { this.started = true; }
        stop() { if (this.onend) this.onend(); }
        abort() {}
        __result(text) {
          const item = { 0: { transcript: text }, isFinal: true, length: 1 };
          const results = [item];
          if (this.onresult) this.onresult({ results });
        }
        __error(code) { if (this.onerror) this.onerror({ error: code }); }
      }
      window.SpeechRecognition = FakeSR;
    });
  }
  async function srAct(page, fnName, arg) {
    await page.evaluate(([fn, a]) => {
      const inst = window.__srLog[window.__srLog.length - 1];
      inst[fn](a);
    }, [fnName, arg]);
  }
  async function openVoice(page) {
    await page.locator('#bk-cap [data-mic]').click();
    await page.waitForSelector('dialog.sgx-vs-dlg', { state: 'attached', timeout: 5000 });
  }
  async function closeVoice(page) {
    await page.locator('dialog.sgx-vs-dlg [data-vs-close]').click();
    await page.waitForSelector('dialog.sgx-vs-dlg', { state: 'detached', timeout: 5000 });
  }

  test('点麦克风弹语音窗；result 填入输入框并立即过滤书架', async ({ page }) => {
    await stubSR(page);
    await mockBookAPIs(page);
    await gotoReady(page, '/', '#bk-cap');
    /* 麦克风：支持 SpeechRecognition 时显示 */
    await expect(page.locator('#bk-cap [data-mic]')).toBeVisible();

    await openVoice(page);
    await expect(page.locator('dialog.sgx-vs-dlg')).toBeVisible();

    await srAct(page, '__result', '盖茨比');
    await srAct(page, 'stop');
    /* 输入框有识别文字 */
    await page.waitForFunction(() => document.getElementById('bk-cap-input').value === '盖茨比', null, { timeout: 3000 });
    /* 书架已过滤：只剩《了不起的盖茨比》 */
    await page.waitForFunction(() => document.querySelectorAll('#bk-grid [data-book]').length === 1, null, { timeout: 3000 });
    const ids = await page.evaluate(() =>
      Array.from(document.querySelectorAll('#bk-grid [data-book]')).map((el) => el.dataset.book));
    expect(ids).toEqual(['epub1']);
  });

  test('识别 error（not-allowed）有文字提示，不静默', async ({ page }) => {
    await stubSR(page);
    await mockBookAPIs(page);
    await gotoReady(page, '/', '#bk-cap');
    await openVoice(page);
    await srAct(page, '__error', 'not-allowed');
    const l1 = page.locator('dialog.sgx-vs-dlg .sgx-vs-l1');
    await page.waitForFunction(() => {
      const el = document.querySelector('dialog.sgx-vs-dlg .sgx-vs-l1');
      return el && el.textContent.includes('权限');
    }, null, { timeout: 3000 });
    expect(await l1.textContent()).toContain('权限');
    await closeVoice(page);
  });

  test('无识别结果（no-speech→onend）提示重试，不静默', async ({ page }) => {
    await stubSR(page);
    await mockBookAPIs(page);
    await gotoReady(page, '/', '#bk-cap');
    await openVoice(page);
    await srAct(page, '__error', 'no-speech');
    await srAct(page, 'stop');
    await page.waitForFunction(() => {
      const el = document.querySelector('dialog.sgx-vs-dlg .sgx-vs-l1');
      return el && el.textContent.length > 0 && !el.textContent.includes('立即说出');
    }, null, { timeout: 3000 });
    const t = await page.locator('dialog.sgx-vs-dlg .sgx-vs-l1').textContent();
    expect(t.trim().length).toBeGreaterThan(0);
    await closeVoice(page);
  });
});
