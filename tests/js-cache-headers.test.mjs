// /js/、/css/ 缓存头与静态守卫测试（styrigx-book）
// 运行：node tests/js-cache-headers.test.mjs
//
// 背景：functions/_middleware.js 是根目录中间件，静态资源走 isWhitelisted
// 直接 return next()，响应仍算「经过 Functions」，Cloudflare Pages 的
// static/_headers 规则对这类响应不生效。因此在 middleware 里直接设头：
//   - 已指纹化（Hugo Pipes fingerprint，文件名带哈希）：public, max-age=31536000, immutable
//   - 未指纹化：no-cache
//
// 静态守卫（staticGuard）：文件不存在时 Pages 回落到 index.html（200 text/html），
// 未解锁访客能拿到 HTML 壳；更糟的是缓存头逻辑只看路径，浏览器会把 HTML
// 当 JS/CSS 缓存一年。规则：只有「200 + content-type 与扩展名匹配」才算命中；
// 否则一律 404 + no-store + 纯文本体。

import { onRequest } from '../functions/_middleware.js';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((e) => {
      console.error(`  ✗ ${name}: ${e.message}`);
      process.exitCode = 1;
    });
}

/* mock next()：按 content-type 返回指定响应 */
function makeContext(path, { status = 200, contentType = 'application/javascript', body = 'x' } = {}) {
  return {
    request: new Request('https://book.styrigx.com' + path),
    env: { SGX_SITE: 'book' },
    next: async () =>
      new Response(body, {
        status,
        headers: { 'Content-Type': contentType },
      }),
  };
}

console.log('withStaticCacheHeaders:');

await test('未指纹化的 /js/xxx.js → Cache-Control: no-cache', async () => {
  const res = await onRequest(makeContext('/js/upload-queue.js'));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
});

await test('指纹化的 /js/xxx.min.<hash>.js → immutable', async () => {
  const res = await onRequest(
    makeContext('/js/upload-queue.min.3642ecc6b53d66210f8cb685868415c15db1a98c7873081a50c560158a2c81fd.js')
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
  assert.ok((res.headers.get('Content-Type') || '').includes('javascript'));
});

await test('指纹化的 /css/main.min.<hash>.css → immutable', async () => {
  const res = await onRequest(
    makeContext('/css/main.min.3642ecc6b53d66210f8cb685868415c15db1a98c7873081a50c560158a2c81fd.css', {
      contentType: 'text/css',
      body: 'body{}',
    })
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
});

await test('未指纹化的 /css/main.css → no-cache', async () => {
  const res = await onRequest(
    makeContext('/css/main.css', { contentType: 'text/css', body: 'body{}' })
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
});

console.log('staticGuard（缺失文件回落）:');

await test('缺失的 /js/x.<64位哈希>.js（回落 text/html）→ 404 + no-store', async () => {
  const res = await onRequest(
    makeContext(
      '/js/x.3642ecc6b53d66210f8cb685868415c15db1a98c7873081a50c560158a2c81fd.js',
      { contentType: 'text/html; charset=utf-8', body: '<html>书库首页壳</html>' }
    )
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const body = await res.text();
  assert.ok(!body.includes('书库首页壳'), '不得返回 HTML 壳');
});

await test('缺失的 /js/x.js（回落 text/html）→ 404 + no-store', async () => {
  const res = await onRequest(
    makeContext('/js/x.js', { contentType: 'text/html', body: '<html></html>' })
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

await test('缺失的 /css/x.<哈希>.css（回落 text/html）→ 404 + no-store', async () => {
  const res = await onRequest(
    makeContext('/css/x.3642ecc6b53d66210f8cb685868415c15db1a98c7873081a50c560158a2c81fd.css', {
      contentType: 'text/html',
      body: '<html></html>',
    })
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

await test('/js/xxx.js 非 200（如 500）→ 404 + no-store', async () => {
  const res = await onRequest(
    makeContext('/js/upload-queue.js', {
      status: 500,
      contentType: 'application/javascript',
      body: 'err',
    })
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

await test('缺失的 /fonts/x.woff2（回落 text/html）→ 404 + no-store', async () => {
  const res = await onRequest(
    makeContext('/fonts/x.woff2', { contentType: 'text/html', body: '<html></html>' })
  );
  assert.equal(res.status, 404);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});

await test('/api/session-check 的 401 JSON 不受守卫影响（原样返回）', async () => {
  const res = await onRequest(
    makeContext('/api/session-check', {
      status: 401,
      contentType: 'application/json',
      body: '{"ok":false}',
    })
  );
  assert.equal(res.status, 401);
  assert.equal(res.headers.get('Cache-Control'), null);
});

await test('真实的图片 /img/x.png（200 image/png）原样返回', async () => {
  const res = await onRequest(
    makeContext('/img/x.png', { contentType: 'image/png', body: 'PNG' })
  );
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), null);
});

console.log('构建产物检查:');

await test('public/ 里不允许出现无版本的 /js/ 引用（排除 vendor/）', async () => {
  // 若 public/ 不存在（如 CI 里测试跑在 hugo 构建之前），跳过本项
  if (!existsSync('public/index.html')) {
    console.log('    (无 public/，跳过构建产物检查)');
    return;
  }
  const out = execSync(
    `grep -rhoE 'src="/js/[a-zA-Z0-9_.-]+\\.js"' public/ 2>/dev/null | sort -u || true`,
    { encoding: 'utf-8' }
  );
  const refs = out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !s.includes('/js/vendor/'));
  const unversioned = refs.filter((s) => !/\.[0-9a-f]{8,}\.(js|mjs)"/.test(s));
  assert.deepEqual(
    unversioned,
    [],
    '发现无版本 /js/ 引用: ' + JSON.stringify(unversioned)
  );
});

await test('public/404.html 存在（Pages 不再回落到首页）', async () => {
  if (!existsSync('public/index.html')) {
    console.log('    (无 public/，跳过构建产物检查)');
    return;
  }
  assert.ok(existsSync('public/404.html'), '缺少 public/404.html');
});

console.log(`\n${passed} passed`);
