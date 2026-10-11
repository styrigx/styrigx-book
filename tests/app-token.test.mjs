// sgx-app 通行证测试（book 上传入口）。
// 覆盖：
//   1. functions/_app-token.js — parseAppToken / verifyAppToken：
//      有效 token 通过；过期 / aud 错 / scope 错 / epoch 落后 / 伪造签名 / 缺 SGX_APP_PUBLIC 一律拒绝
//   2. functions/api/_auth.js requireAppToken — 缺 cookie 403 / 无效 403 / 有效放行
//   3. 前端：visitor 不渲染 FAB（layouts/index.html 的 BkShowFab 逻辑）
// 运行：node tests/app-token.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { parseAppToken, verifyAppToken, getAppCookieValue } from '../functions/_app-token.js';
import { requireAppToken } from '../functions/api/_auth.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

/* 生成测试用 Ed25519 密钥对（仅内存，不落盘） */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const pubDer = publicKey.export({ type: 'spki', format: 'der' });
const PUB_B64 = pubDer.toString('base64');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken({ role = 'owner', epoch = 5, iat = Date.now(), exp = Date.now() + 600000, aud = 'book', scope = 'upload', key = privateKey } = {}) {
  const payload = [role, epoch, iat, exp, aud, scope].join('.');
  const sig = sign(null, Buffer.from(payload), key);
  return payload + '.' + b64url(sig);
}

/* mock fetchSessionEpoch：fetch 返回固定 epoch */
const realFetch = globalThis.fetch;
const CURRENT_EPOCH = 5;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ epoch: CURRENT_EPOCH }) });

console.log('app-token:');

await test('parseAppToken：有效 token 解析成功', () => {
  const t = makeToken();
  const p = parseAppToken(t);
  assert.ok(p);
  assert.equal(p.role, 'owner');
  assert.equal(p.aud, 'book');
  assert.equal(p.scope, 'upload');
});

await test('verifyAppToken：有效 token 通过', async () => {
  const t = makeToken();
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), true);
});

await test('verifyAppToken：过期 token 拒绝', async () => {
  const t = makeToken({ exp: Date.now() - 1000 });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

await test('verifyAppToken：aud 错误拒绝', async () => {
  const t = makeToken({ aud: 'blog' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

await test('verifyAppToken：scope 错误拒绝', async () => {
  const t = makeToken({ scope: 'read' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

await test('verifyAppToken：epoch 落后拒绝', async () => {
  const t = makeToken({ epoch: CURRENT_EPOCH - 1 });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

await test('verifyAppToken：伪造签名拒绝', async () => {
  const { privateKey: evilKey } = generateKeyPairSync('ed25519');
  const t = makeToken({ key: evilKey });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

await test('verifyAppToken：缺 SGX_APP_PUBLIC 拒绝（fail closed）', async () => {
  const t = makeToken();
  assert.equal(await verifyAppToken(t, '', CURRENT_EPOCH), false);
  assert.equal(await verifyAppToken(t, null, CURRENT_EPOCH), false);
});

await test('verifyAppToken：role 非 owner 拒绝', async () => {
  const t = makeToken({ role: 'visitor' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH), false);
});

function mockContext(cookieVal) {
  return {
    request: {
      headers: {
        get: (name) => {
          if (name.toLowerCase() === 'cookie') {
            return cookieVal ? `sgx-app=${cookieVal}` : '';
          }
          return null;
        },
      },
    },
    env: { SGX_APP_PUBLIC: PUB_B64 },
  };
}

await test('requireAppToken：缺 cookie → 403', async () => {
  const { response } = await requireAppToken(mockContext(null));
  assert.ok(response);
  assert.equal(response.status, 403);
});

await test('requireAppToken：无效 token → 403', async () => {
  const { response } = await requireAppToken(mockContext('invalid.token.here'));
  assert.ok(response);
  assert.equal(response.status, 403);
});

await test('requireAppToken：有效 token → 放行', async () => {
  const t = makeToken();
  const { response } = await requireAppToken(mockContext(t));
  assert.equal(response, null);
});

await test('requireAppToken：过期 token → 403', async () => {
  const t = makeToken({ exp: Date.now() - 1000 });
  const { response } = await requireAppToken(mockContext(t));
  assert.ok(response);
  assert.equal(response.status, 403);
});

globalThis.fetch = realFetch;

/* 前端：visitor 不渲染 FAB 入口 */
import { readFileSync } from 'node:fs';
await test('前端：FAB 默认隐藏，仅 owner 显示', () => {
  const fabHtml = readFileSync(new URL('../layouts/partials/upload-fab.html', import.meta.url), 'utf8');
  // FAB 默认有 hidden 类
  assert.ok(fabHtml.includes('id="bk-fab"'));
  assert.ok(/id="bk-fab"[^>]*class="[^"]*hidden/.test(fabHtml), 'FAB 应默认隐藏');
  // BkShowFab 根据 isOwner 控制显示
  assert.ok(fabHtml.includes('window.BkShowFab = function(isOwner)'));
});

await test('前端：index.html 引入 FAB 且仅 owner 触发显示', () => {
  const idxHtml = readFileSync(new URL('../layouts/index.html', import.meta.url), 'utf8');
  assert.ok(idxHtml.includes('upload-fab.html'), 'index.html 应引入 upload-fab partial');
  assert.ok(idxHtml.includes('window.BkShowFab(owner)'), '应根据 owner 状态调用 BkShowFab');
});

console.log(`\napp-token: ${passed} passed`);
