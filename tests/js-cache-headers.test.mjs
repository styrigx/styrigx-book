// /js/ 缓存头测试（styrigx-book）
// 运行：node tests/js-cache-headers.test.mjs
//
// 背景：functions/_middleware.js 是根目录中间件，静态资源走 isWhitelisted
// 直接 return next()，响应仍算「经过 Functions」，Cloudflare Pages 的
// static/_headers 规则对这类响应不生效。因此在 withJsCacheHeaders 里直接设头：
//   - 已指纹化（Hugo Pipes fingerprint，文件名带哈希）：public, max-age=31536000, immutable
//   - 未指纹化：no-cache

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

function makeContext(path) {
  return {
    request: new Request('https://book.styrigx.com' + path),
    env: { SGX_SITE: 'book' },
    next: async () =>
      new Response('console.log(1)', {
        status: 200,
        headers: { 'Content-Type': 'application/javascript' },
      }),
  };
}

console.log('withJsCacheHeaders:');

await test('未指纹化的 /js/xxx.js → Cache-Control: no-cache', async () => {
  const res = await onRequest(makeContext('/js/upload-queue.js'));
  assert.equal(res.headers.get('Cache-Control'), 'no-cache');
});

await test('指纹化的 /js/xxx.min.<hash>.js → immutable', async () => {
  const res = await onRequest(
    makeContext('/js/upload-queue.min.3642ecc6b53d66210f8cb685868415c15db1a98c7873081a50c560158a2c81fd.js')
  );
  assert.equal(res.headers.get('Cache-Control'), 'public, max-age=31536000, immutable');
});

await test('非 /js/ 静态资源不受影响（CSS 原样返回）', async () => {
  const res = await onRequest(makeContext('/css/main.css'));
  // CSS 走白名单直接 next()，middleware 不改头
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

console.log(`\n${passed} passed`);
