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

console.log('锁屏覆盖 /api/file:');
test('未解锁访问 /api/file?id= 回 401 JSON（不 302，避免 fetch 跨域跟跳转）', async () => {
  let nextCalled = false;
  const res = await onRequest({
    request: {
      url: 'https://book.styrigx.com/api/file?id=abc123',
      headers: new Headers(),
    },
    env: { SGX_SITE: 'book', SGX_LOCK_PUBLIC: 'test-key' },
    next: async () => { nextCalled = true; },
  });
  assert.ok(res, '应返回 Response');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(!nextCalled, '不应放行到文件接口');
});

console.log(`\n${passed} passed`);

console.log('锁屏覆盖 /api/file:');
test('未解锁访问 /api/file?id= 回 401 JSON（不 302，避免 fetch 跨域跟跳转）', async () => {
  let nextCalled = false;
  const res = await onRequest({
    request: {
      url: 'https://book.styrigx.com/api/file?id=abc123',
      headers: new Headers(),
    },
    env: { SGX_SITE: 'book', SGX_LOCK_PUBLIC: 'test-key' },
    next: async () => { nextCalled = true; },
  });
  assert.ok(res, '应返回 Response');
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Content-Type'), 'application/json');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.ok(!nextCalled, '不应放行到文件接口');
});

console.log('跨站契约（主站五段式 cookie）:');
// 用主站 verifyOneCookie 同格式生成的测试向量（Ed25519，payload "owner.owner.123.9999999999999"）
// 契约测试不依赖主站实时 epoch：桩固定返回 epoch=100（测试向量 epoch=123 ≥ 100 通过；
// epoch 检查本身由 lock-sync.test.mjs 覆盖）
globalThis.fetch = async () => ({ ok: true, json: async () => ({ epoch: 100 }) });
const TEST_PUB = 'MCowBQYDK2VwAyEAxNYp16H5st9HIVLeiz36yQgiLZVh9lbhVICPWuoa7I8=';
const TEST_COOKIE_5SEG = 'owner.owner.123.9999999999999.Zc9plh5YLierijJimx3WIm4ViHlzcf1nhSmJ97xf0_SNOudBnGLWkKphODo5uAFDDB81YZuF81zv85OVV34yDw';
const TEST_COOKIE_ROOT_5SEG = 'root.visitor.123.9999999999999.QMmgSn4pCNI6Vs1TdUvivNy-d4E35E3LBQBNdkyRXqMNuEcxuLfyRDNst6RtwsVxiWcTThSQzJJn1W_woWnRAA';
const TEST_COOKIE_4SEG = 'owner.123.9999999999999.v0496AV8rewFMhVO6ti2rLXlzUHswRTm3HMSyTEZzSgBntlBDE8Bml4a-K9LqLUwrXaYif04CAoUtBYVJKdWAQ';
const TEST_COOKIE_BAD_BY = 'admin.owner.123.9999999999999.Zc9plh5YLierijJimx3WIm4ViHlzcf1nhSmJ97xf0_SNOudBnGLWkKphODo5uAFDDB81YZuF81zv85OVV34yDw';

test('五段式 cookie 被 _auth.js 接受（owner）', async () => {
  const { verifyOwnerCookie } = await import('../functions/api/_auth.js');
  const role = await verifyOwnerCookie(
    { headers: new Headers({ Cookie: 'sgx-verified=' + TEST_COOKIE_5SEG }) },
    { SGX_LOCK_PUBLIC: TEST_PUB }
  );
  assert.equal(role, 'owner');
});

test('五段式 cookie（by=root）被 _auth.js 接受（visitor）', async () => {
  const { verifyOwnerCookie } = await import('../functions/api/_auth.js');
  const role = await verifyOwnerCookie(
    { headers: new Headers({ Cookie: 'sgx-verified=' + TEST_COOKIE_ROOT_5SEG }) },
    { SGX_LOCK_PUBLIC: TEST_PUB }
  );
  assert.equal(role, 'visitor');
});

test('旧四段式 cookie 被 _auth.js 拒绝（无兼容层）', async () => {
  const { verifyOwnerCookie } = await import('../functions/api/_auth.js');
  const role = await verifyOwnerCookie(
    { headers: new Headers({ Cookie: 'sgx-verified=' + TEST_COOKIE_4SEG }) },
    { SGX_LOCK_PUBLIC: TEST_PUB }
  );
  assert.equal(role, null);
});

test('非法 by 的 cookie 被 _auth.js 拒绝', async () => {
  const { verifyOwnerCookie } = await import('../functions/api/_auth.js');
  const role = await verifyOwnerCookie(
    { headers: new Headers({ Cookie: 'sgx-verified=' + TEST_COOKIE_BAD_BY }) },
    { SGX_LOCK_PUBLIC: TEST_PUB }
  );
  assert.equal(role, null);
});
