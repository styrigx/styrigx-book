/* Book 手机验收返工第 8 项：上传页横向溢出回归测试。
 *
 * 根因（2026-10-14 定位）：队列卡片文件名 p.truncate 的 white-space:nowrap 产生
 * 约 514px max-content，逐层向上传播——min-w-0 只管 min-content，管不住
 * max-content；main.bk-admin 身为 body flex 容器的子项又带 mx-auto，auto margin
 * 抵消了 stretch，于是 main 按 max-content 定宽到 674px。html/body 的
 * overflow-x:clip 只盖住 scrollWidth，后代元素 rect 仍越过视口——这就是前两次
 * 只盯 scrollWidth 修不掉的原因。
 *
 * 方法：4 个视口（412 / 360 / 275+zoom1.5 / 240+zoom1.5，后两者等价
 * 412/360 在 1.5 倍大字号下的布局）放入两本超长书名的书并行上传
 * （真实走解析 + 真实上传流程，分片/封面接口 mock），列出所有
 * getBoundingClientRect().right > innerWidth 的元素。
 * 注意：getBoundingClientRect 会乘上 CSS zoom，innerWidth/scrollWidth 不会，
 * 越界判定用 innerWidth*zoom 做上限。
 *
 * 断言：4 视口下 scrollWidth <= innerWidth，且越界元素列表为空。
 * 跑在 CI（deploy.yml → npm run test:e2e）。4 视口循环自带 viewport 配置，
 * 与 project 无关，只在 phone-412 下跑一次，避免多 project 重复。
 *
 * 设备：Chromium，deviceScaleFactor 2.625，isMobile + hasTouch。
 */
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const SHOTS_DIR = path.join(__dirname, 'upload-overflow-shots');
/* CI 用 playwright.e2e.config.js 的 webServer（8932）；本地并行时可用 UPLOAD_OVERFLOW_BASE 换端口避冲突 */
const BASE = process.env.UPLOAD_OVERFLOW_BASE || 'http://localhost:8932';

/* 视口：412/360 正常；275/240 配 html{zoom:1.5} 等价 412/360 放大 1.5 倍 */
const VIEWPORTS = [
  { name: '412', width: 412, height: 820, zoom: 1 },
  { name: '360', width: 360, height: 740, zoom: 1 },
  { name: '275', width: 275, height: 620, zoom: 1.5 },
  { name: '240', width: 240, height: 560, zoom: 1.5 },
];

/* 生成一份带正确 xref 的最小单页 PDF（latin1 字节串），pdfjs 可解析、可渲染封面 */
function makePdfBytes() {
  const stream = 'BT /F1 18 Tf 40 200 Td (Test) Tj ET';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    '<< /Length ' + Buffer.byteLength(stream) + ' >>\nstream\n' + stream + '\nendstream',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += (i + 1) + ' 0 obj\n' + objs[i] + '\nendobj\n';
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 6\n0000000000 65535 f \n';
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF';
  return Buffer.from(out, 'latin1');
}
/* 小文件即可：单分片延迟 1.5s（速度 chip 的 dt>=1s 条件），随后封面上传挂起，
   卡片稳定停在 uploading 态（含 "上传中 … · x B/s"） */
const PDF_B64 = makePdfBytes().toString('base64');

function selPath(el) {
  const parts = [];
  let cur = el;
  while (cur && cur !== document.body && parts.length < 8) {
    let s = cur.tagName.toLowerCase();
    if (cur.id) { s += '#' + cur.id; parts.unshift(s); break; }
    const cn = cur.className;
    if (cn && typeof cn === 'string') {
      const cls = cn.trim().split(/\s+/).slice(0, 4).join('.');
      if (cls) s += '.' + cls;
    }
    const dq = cur.getAttribute && cur.getAttribute('data-q');
    if (dq) s += '[data-q=' + dq + ']';
    if (cur.parentElement) {
      const sibs = Array.from(cur.parentElement.children).filter(c => c.tagName === cur.tagName);
      if (sibs.length > 1) s += ':nth(' + (sibs.indexOf(cur) + 1) + ')';
    }
    parts.unshift(s);
    cur = cur.parentElement;
  }
  return parts.join(' > ');
}

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== 'phone-412', '4 视口循环自带配置，只跑一次');
});

for (const vp of VIEWPORTS) {
  test(`upload queue: no horizontal overflow @${vp.name}`, async ({ browser }) => {
    test.slow();
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
    });
    const page = await context.newPage();
    const json = o => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    await page.route('**/api/status', r => r.fulfill(json({ storage_enabled: true })));
    await page.route('**/api/private/me', r => r.fulfill(json({ role: 'owner' })));
    await page.route('**/api/admin/books', r => r.fulfill(json({ total: 0 })));
    await page.route('**/api/admin/app-check', r => r.fulfill({ status: 200, body: '' }));
    await page.route('**/api/admin/upload/init', r => r.fulfill(json({ uploadId: 'u1', key: 'k1' })));
    await page.route('**/api/admin/upload/part**', async r => {
      /* 分片延迟 1.5s：速度统计要求 dt>=1s，这样 chip 显示 "上传中 … · x B/s" */
      await new Promise(res => setTimeout(res, 1500));
      await r.fulfill(json({ etag: 'e1' }));
    });
    /* 封面上传挂起：卡片稳定停在 uploading 态供测量 */
    await page.route('**/api/admin/cover**', async r => {
      await new Promise(res => setTimeout(res, 120000));
      await r.fulfill(json({ key: 'covers/x.webp' }));
    });
    await page.route('**/api/admin/upload/complete**', async r => {
      await new Promise(res => setTimeout(res, 120000));
      await r.fulfill(json({ ok: true }));
    });

    await page.goto(BASE + '/admin/');
    await page.locator('#adm-main:not(.hidden)').waitFor({ timeout: 15000 });
    if (vp.zoom !== 1) {
      await page.addStyleTag({ content: 'html{zoom:' + vp.zoom + ' !important;}' });
    }

    /* 两本超长书名走真实文件选择流程 */
    await page.evaluate(b64 => {
      const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const name = '模拟电子技术基础（清华大学电子学教研组编 第五版 修订本 高等教育出版社）.pdf';
      const dt = new DataTransfer();
      dt.items.add(new File([bin], name, { type: 'application/pdf' }));
      dt.items.add(new File([bin], name, { type: 'application/pdf' }));
      const input = document.getElementById('adm-file');
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }, PDF_B64);

    /* 等两本都解析完成（两个上传按钮都出现），然后逐个点下实现并行上传。
       注意：uploadItem 同步调 renderQueue 重绘队列，先抓好的按钮节点会被摘除，
       点它不会冒泡到委托监听器，所以每次重查 locator 再点。 */
    await page.waitForFunction(() => document.querySelectorAll('[data-qact="upload"]').length === 2, { timeout: 90000 });
    expect(await page.locator('[data-q]').count()).toBe(2);
    await page.locator('[data-qact="upload"]').first().click();
    await page.locator('[data-qact="upload"]').first().click();
    /* 分片成功后速度 chip 出现（"上传中 … · x B/s"），封面上传挂起保持 uploading 态 */
    await page.locator('[data-status]').first().waitFor();
    await page.waitForFunction(() => {
      const els = document.querySelectorAll('[data-status]');
      return els.length === 2 && Array.from(els).every(e => /·/.test(e.textContent || ''));
    }, { timeout: 60000 });

    /* 注意：getBoundingClientRect() 会乘上 CSS zoom，而 innerWidth/scrollWidth 不会；
       越界判定要用 innerWidth*zoom 做上限 */
    const result = await page.evaluate(args => {
      const selPath = eval('(' + args.selPathSrc + ')'); /* eslint-disable-line no-eval */
      const zoom = args.zoom;
      const iw = window.innerWidth;
      const limit = iw * zoom;
      const sw = document.documentElement.scrollWidth;
      const bad = [];
      const els = document.body.querySelectorAll('*');
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.right > limit + 0.5 && r.width > 0) {
          bad.push({ sel: selPath(el), right: Math.round(r.right * 10) / 10, tag: el.tagName.toLowerCase() });
        }
      }
      /* 只保留最外层越界元素（后代不再重复列） */
      const badEls = Array.from(els).filter(el => {
        const r = el.getBoundingClientRect();
        return r.right > limit + 0.5 && r.width > 0;
      });
      const outer = bad.filter(b => {
        const el = badEls.find(e => selPath(e) === b.sel);
        let p = el && el.parentElement;
        while (p && p !== document.body) {
          if (badEls.includes(p)) return false;
          p = p.parentElement;
        }
        return true;
      });
      return {
        viewport: { width: window.innerWidth, height: window.innerHeight, zoom: zoom },
        scrollWidth: sw, innerWidth: iw,
        offenderCount: bad.length, outerOffenderCount: outer.length,
        offenders: bad, outerOffenders: outer,
      };
    }, { selPathSrc: selPath.toString(), zoom: vp.zoom });

    console.log('OVERFLOW_RESULT @' + vp.name + ' ' + JSON.stringify(result));

    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS_DIR, 'shot-' + vp.name + '.png'), fullPage: true });
    fs.writeFileSync(path.join(SHOTS_DIR, 'result-' + vp.name + '.json'), JSON.stringify(result, null, 2));

    expect(result.offenders, '越界元素 @' + vp.name + ': ' + JSON.stringify(result.outerOffenders, null, 1))
      .toHaveLength(0);
    expect(result.scrollWidth,
      'scrollWidth(' + result.scrollWidth + ') 应 <= innerWidth(' + result.innerWidth + ') @' + vp.name)
      .toBeLessThanOrEqual(result.innerWidth);

    await context.close();
  });
}
