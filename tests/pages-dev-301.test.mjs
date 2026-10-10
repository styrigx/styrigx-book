// pages.dev 301 跳转测试（styrigx-book）
// 运行：node tests/pages-dev-301.test.mjs

import { pagesDevRedirect, onRequest } from '../functions/_middleware.js';
import assert from 'node:assert/strict';

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}
function req(url) {
  return { url };
}

console.log('pagesDevRedirect:');
test('生产别名精确匹配 → 301 到正式域名（保留 path+query）', () => {
  const res = pagesDevRedirect(req('https://styrigx-book.pages.dev/read/?foo=bar'));
  assert.ok(res, '应返回 Response');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://book.styrigx.com/read/?foo=bar');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
test('根路径也跳转', () => {
  const res = pagesDevRedirect(req('https://styrigx-book.pages.dev/'));
  assert.ok(res);
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://book.styrigx.com/');
});
test('hash 预览别名放行（不跳转）', () => {
  const res = pagesDevRedirect(req('https://abc123.styrigx-book.pages.dev/read/'));
  assert.equal(res, null);
});
test('分支预览别名放行（不跳转）', () => {
  const res = pagesDevRedirect(req('https://feat-xyz.styrigx-book.pages.dev/read/'));
  assert.equal(res, null);
});
test('正式域名不跳转', () => {
  const res = pagesDevRedirect(req('https://book.styrigx.com/read/'));
  assert.equal(res, null);
});
test('后缀欺骗不跳转', () => {
  const res = pagesDevRedirect(req('https://styrigx-book.pages.dev.evil.com/read/'));
  assert.equal(res, null);
});

console.log('onRequest 链首:');
test('pages.dev 请求在锁屏逻辑之前被 301（即使未登录）', async () => {
  let nextCalled = false;
  const res = await onRequest({
    request: req('https://styrigx-book.pages.dev/read/'),
    env: { SGX_SITE: 'book' },
    next: async () => { nextCalled = true; },
  });
  assert.ok(res, '应返回 Response');
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('Location'), 'https://book.styrigx.com/read/');
  assert.ok(!nextCalled, '不应继续走锁屏逻辑');
});

console.log(`\n${passed} passed`);
