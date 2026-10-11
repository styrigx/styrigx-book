// site-fail-closed：SGX_SITE 缺配置/配错时 middleware 必须 fail closed
// 运行：node tests/site-fail-closed.test.mjs
//
// 规范：SGX_SITE 在子站必须为 'book'（Cloudflare 后台配）。缺配置或值不对
// 时，说明站点配置错了，一律拒绝请求，绝不能放行（fail closed）。
// 注意：pages.dev 生产别名 301 仍在链首，不受影响。

import assert from 'node:assert/strict';
import { onRequest } from '../functions/_middleware.js';

let passed = 0;
let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { failed++; console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

function ctx(env, url = 'https://book.styrigx.com/read/') {
  let nextCalled = false;
  return {
    state: () => nextCalled,
    context: {
      request: {
        url,
        headers: { get: () => null },
      },
      env,
      next: async () => { nextCalled = true; return new Response('inner'); },
    },
  };
}

console.log('site-fail-closed:');

await test('env 未配 SGX_SITE → 不放行（next 未被调用）', async () => {
  const { context, state } = ctx({});
  const res = await onRequest(context);
  assert.equal(state(), false, 'SGX_SITE 未配置时 middleware 必须 fail closed，不能调用 next()');
  assert.equal(res.status, 500);
});

await test('env 为空对象且请求 /api/* → 同样 fail closed，不返回业务内容', async () => {
  const { context, state } = ctx({}, 'https://book.styrigx.com/api/private/books');
  const res = await onRequest(context);
  assert.equal(state(), false);
  assert.equal(res.status, 500);
});

await test('SGX_SITE 配错值（如 shop）→ fail closed', async () => {
  const { context, state } = ctx({ SGX_SITE: 'shop' });
  const res = await onRequest(context);
  assert.equal(state(), false);
  assert.equal(res.status, 500);
});

await test('env 本身为 undefined → fail closed（不抛异常）', async () => {
  const { context, state } = ctx(undefined);
  const res = await onRequest(context);
  assert.equal(state(), false);
  assert.equal(res.status, 500);
});

await test('SGX_SITE=book + 无 cookie + 非白名单 → 走锁屏 302（旧行为不变）', async () => {
  const { context, state } = ctx({ SGX_SITE: 'book' }, 'https://book.styrigx.com/read/');
  const res = await onRequest(context);
  assert.equal(state(), false);
  assert.equal(res.status, 302);
  assert.match(res.headers.get('Location'), /^https:\/\/styrigx\.com\/\?lock=1/);
});

await test('pages.dev 生产别名 301 在 SGX_SITE 未配时仍生效（链首跳转不受影响）', async () => {
  const { context } = ctx({}, 'https://styrigx-book.pages.dev/read/');
  const res = await onRequest(context);
  assert.equal(res.status, 301);
  assert.match(res.headers.get('Location'), /^https:\/\/book\.styrigx\.com\/read\//);
});

console.log(`\nsite-fail-closed: ${passed} passed, ${failed} failed`);
