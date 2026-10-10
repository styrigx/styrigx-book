// 锁屏同步测试（fix/lock-sync）
// 覆盖：
//   1. functions/api/session-check.js — 验签通过 200 {ok:true} / 否则 401 {ok:false}，
//      一律 Cache-Control: no-store；非 GET → 405
//   2. functions/_middleware.js — 受保护 HTML 响应加 no-store；302 锁屏跳转带 no-store
//   3. static/js/sgx-lock-sync.js — 401 处理规则（isLockSignal / checkSession / apiFetch），
//      网络错误不 reload（fail open）
// 运行：node tests/lock-sync.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { onRequest as sessionCheck } from '../functions/api/session-check.js';
import { onRequest as mwOnRequest, verifySessionCookie } from '../functions/_middleware.js';

const require = createRequire(import.meta.url);
const sgx = require('../static/js/sgx-lock-sync.js');

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

/* ---------- 测试用 Ed25519 密钥与 cookie ---------- */
// 注意：_middleware.js 在模块内缓存公钥（publicKeyPromise），整个文件只用同一对密钥。
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const spkiDer = publicKey.export({ type: 'spki', format: 'der' });
const PEM =
  '-----BEGIN PUBLIC KEY-----\n' +
  Buffer.from(spkiDer).toString('base64').replace(/.{64}/g, '$&\n') +
  '\n-----END PUBLIC KEY-----';

const EPOCH = 7;
/* 2.8.0 会话角色分离：四段式 role.epoch.exp.sig，签名 payload 为 role.epoch.exp */
function makeCookie(role, epoch, exp, key = privateKey) {
  const msg = `${role}.${epoch}.${exp}`;
  const sig = sign(null, Buffer.from(msg), key);
  return `${msg}.${sig.toString('base64url')}`;
}
/* 旧三段式 epoch.exp.sig（无 role）：一律视为无效，不留兼容层 */
function makeLegacyCookie(epoch, exp, key = privateKey) {
  const msg = `${epoch}.${exp}`;
  const sig = sign(null, Buffer.from(msg), key);
  return `${msg}.${sig.toString('base64url')}`;
}
const goodCookie = () => makeCookie('owner', EPOCH, Date.now() + 3600e3);
const visitorCookie = () => makeCookie('visitor', EPOCH, Date.now() + 3600e3);

/* session-epoch 接口桩：固定返回 EPOCH（验签链会调它） */
const realFetch = globalThis.fetch;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ epoch: EPOCH }) });

function apiReq(cookie, method = 'GET') {
  return {
    url: 'https://book.styrigx.com/api/session-check',
    method,
    headers: {
      get: (n) => (String(n).toLowerCase() === 'cookie' && cookie ? `sgx-verified=${cookie}` : null),
    },
  };
}
const ENV = { SGX_SITE: 'book', SGX_ED25519_PUBLIC: PEM };

/* ---------- 1. session-check 接口 ---------- */
console.log('session-check:');
await test('owner cookie 有效 → 200 {ok:true} + Cache-Control: no-store', async () => {
  const res = await sessionCheck({ request: apiReq(goodCookie()), env: ENV });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.ok((res.headers.get('Content-Type') || '').includes('application/json'));
});
await test('缺失 cookie → 401 {ok:false} + no-store', async () => {
  const res = await sessionCheck({ request: apiReq(null), env: ENV });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false });
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
await test('visitor 角色（签名有效）→ book 主人专属，401', async () => {
  const res = await sessionCheck({ request: apiReq(visitorCookie()), env: ENV });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false });
});
await test('旧三段式 cookie（无 role）→ 一律无效，401', async () => {
  const res = await sessionCheck({ request: apiReq(makeLegacyCookie(EPOCH, Date.now() + 3600e3)), env: ENV });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false });
});
await test('非法 role（如 admin）→ 401', async () => {
  const res = await sessionCheck({ request: apiReq(makeCookie('admin', EPOCH, Date.now() + 3600e3)), env: ENV });
  assert.equal(res.status, 401);
});
await test('role 被篡改（owner 签名改写成 visitor）→ 签名对不上，401', async () => {
  const c = goodCookie().split('.');
  c[0] = 'visitor';
  const res = await sessionCheck({ request: apiReq(c.join('.')), env: ENV });
  assert.equal(res.status, 401);
});
await test('签名伪造 → 401', async () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  const res = await sessionCheck({ request: apiReq(makeCookie('owner', EPOCH, Date.now() + 3600e3, other)), env: ENV });
  assert.equal(res.status, 401);
  assert.deepEqual(await res.json(), { ok: false });
});
await test('exp 过期 → 401', async () => {
  const res = await sessionCheck({ request: apiReq(makeCookie('owner', EPOCH, Date.now() - 1000)), env: ENV });
  assert.equal(res.status, 401);
});
await test('epoch 过旧（主站已立即锁定）→ 401', async () => {
  const res = await sessionCheck({ request: apiReq(makeCookie('owner', EPOCH - 1, Date.now() + 3600e3)), env: ENV });
  assert.equal(res.status, 401);
});
await test('格式损坏的 cookie → 401（不抛 500）', async () => {
  const res = await sessionCheck({ request: apiReq('not.a.valid-cookie'), env: ENV });
  assert.equal(res.status, 401);
});
await test('未启用锁屏（SGX_SITE 未设）→ 200 {ok:true}，与 middleware 放行一致', async () => {
  const res = await sessionCheck({ request: apiReq(null), env: {} });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});
await test('非 GET → 405', async () => {
  const res = await sessionCheck({ request: apiReq(goodCookie(), 'POST'), env: ENV });
  assert.equal(res.status, 405);
});

/* ---------- 2. middleware：no-store ---------- */
console.log('middleware no-store:');
function mwCtx(cookie, nextRes) {
  return {
    request: {
      url: 'https://book.styrigx.com/read/',
      headers: { get: (n) => (String(n).toLowerCase() === 'cookie' && cookie ? `sgx-verified=${cookie}` : null) },
    },
    env: ENV,
    next: async () => nextRes,
  };
}
await test('owner cookie + HTML → 响应加 Cache-Control: no-store', async () => {
  const res = await mwOnRequest(mwCtx(goodCookie(),
    new Response('<html></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } })));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(await res.text(), '<html></html>');
});
await test('owner cookie + 非 HTML（JSON API）→ 原样返回，不强制 no-store', async () => {
  const inner = new Response('{"books":[]}', { headers: { 'content-type': 'application/json' } });
  const res = await mwOnRequest(mwCtx(goodCookie(), inner));
  assert.equal(res.headers.get('Cache-Control'), null);
});
await test('visitor cookie（签名有效）→ book 主人专属，302 到主站锁屏', async () => {
  let nextCalled = false;
  const res = await mwOnRequest({
    request: {
      url: 'https://book.styrigx.com/',
      headers: { get: (n) => (String(n).toLowerCase() === 'cookie' ? `sgx-verified=${visitorCookie()}` : null) },
    },
    env: ENV,
    next: async () => { nextCalled = true; },
  });
  assert.equal(res.status, 302);
  assert.ok(!nextCalled, 'visitor 不应放行');
  assert.ok(res.headers.get('Location').startsWith('https://styrigx.com/?lock=1'));
});
await test('旧三段式 cookie → 302 到主站锁屏（无兼容层）', async () => {
  let nextCalled = false;
  const res = await mwOnRequest({
    request: {
      url: 'https://book.styrigx.com/',
      headers: { get: (n) => (String(n).toLowerCase() === 'cookie' ? `sgx-verified=${makeLegacyCookie(EPOCH, Date.now() + 3600e3)}` : null) },
    },
    env: ENV,
    next: async () => { nextCalled = true; },
  });
  assert.equal(res.status, 302);
  assert.ok(!nextCalled);
});
await test('无效 cookie → 302 锁屏跳转，带 return + Cache-Control: no-store', async () => {
  let nextCalled = false;
  const res = await mwOnRequest({
    request: {
      url: 'https://book.styrigx.com/read/?id=abc',
      headers: { get: () => null },
    },
    env: ENV,
    next: async () => { nextCalled = true; },
  });
  assert.equal(res.status, 302);
  assert.ok(!nextCalled);
  const loc = res.headers.get('Location');
  assert.ok(loc.startsWith('https://styrigx.com/?lock=1&return='), `Location: ${loc}`);
  assert.ok(decodeURIComponent(loc).includes('https://book.styrigx.com/read/?id=abc'));
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
});
await test('verifySessionCookie 与 middleware 验签逻辑一致（owner 通过 / visitor 不通过 / 坏 cookie 不通过）', async () => {
  const req = apiReq(goodCookie());
  assert.equal(await verifySessionCookie(req, ENV), true);
  assert.equal(await verifySessionCookie(apiReq(visitorCookie()), ENV), false);
  assert.equal(await verifySessionCookie(apiReq('bad.cookie.here'), ENV), false);
});

/* ---------- 3. 前端 sgx-lock-sync.js：401 处理 ---------- */
console.log('sgx-lock-sync isLockSignal:');
await test('数据接口 401 → 视为已锁定', () => {
  assert.equal(sgx.isLockSignal('/api/books', 401), true);
  assert.equal(sgx.isLockSignal('/api/session-check', 401), true);
  assert.equal(sgx.isLockSignal('/api/file?id=x', 401), true);
  assert.equal(sgx.isLockSignal('https://book.styrigx.com/api/books', 401), true);
});
await test('登录态探测 /api/private/me 的 401 → 未登录，不 reload', () => {
  assert.equal(sgx.isLockSignal('/api/private/me', 401), false);
});
await test('后台鉴权 /api/admin/* 的 401 → 走登录提示，不 reload', () => {
  assert.equal(sgx.isLockSignal('/api/admin/books', 401), false);
  assert.equal(sgx.isLockSignal('/api/admin/', 401), false);
});
await test('非 401 状态 → 不 reload', () => {
  assert.equal(sgx.isLockSignal('/api/books', 200), false);
  assert.equal(sgx.isLockSignal('/api/books', 403), false);
  assert.equal(sgx.isLockSignal('/api/books', 500), false);
});

console.log('sgx-lock-sync checkSession:');
await test('401 → reload（返回 true）', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => ({ status: 401 }), () => { reloaded++; });
  assert.equal(wasLocked, true);
  assert.equal(reloaded, 1);
});
await test('200 → 不 reload', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => ({ status: 200 }), () => { reloaded++; });
  assert.equal(wasLocked, false);
  assert.equal(reloaded, 0);
});
await test('网络错误 → fail open，不 reload', async () => {
  let reloaded = 0;
  const wasLocked = await sgx.checkSession(async () => { throw new TypeError('fetch failed'); }, () => { reloaded++; });
  assert.equal(wasLocked, false);
  assert.equal(reloaded, 0);
});
await test('并发调用去重：一次 401 只 reload 一次', async () => {
  let reloaded = 0;
  let release;
  const gate = new Promise((r) => { release = r; });
  const p1 = sgx.checkSession(() => gate.then(() => ({ status: 401 })), () => { reloaded++; });
  const p2 = sgx.checkSession(() => gate.then(() => ({ status: 401 })), () => { reloaded++; });
  release();
  await Promise.all([p1, p2]);
  assert.equal(reloaded, 1);
});

console.log('sgx-lock-sync apiFetch:');
await test('数据接口 401 → reload + 抛 sgxLocked（调用方直接 return，不展示错误 UI）', async () => {
  let reloaded = 0;
  await assert.rejects(
    sgx.apiFetch('/api/books', {}, async () => ({ status: 401 }), () => { reloaded++; }),
    (e) => e.sgxLocked === true
  );
  assert.equal(reloaded, 1);
});
await test('/api/private/me 401 → 不 reload，原样返回（未登录态）', async () => {
  let reloaded = 0;
  const res = await sgx.apiFetch('/api/private/me', {}, async () => ({ status: 401 }), () => { reloaded++; });
  assert.equal(res.status, 401);
  assert.equal(reloaded, 0);
});
await test('/api/admin/* 401 → 不 reload（后台登录提示）', async () => {
  let reloaded = 0;
  const res = await sgx.apiFetch('/api/admin/books', {}, async () => ({ status: 401 }), () => { reloaded++; });
  assert.equal(res.status, 401);
  assert.equal(reloaded, 0);
});
await test('200 → 透传响应', async () => {
  const res = await sgx.apiFetch('/api/books', {}, async () => ({ status: 200 }));
  assert.equal(res.status, 200);
});
await test('网络错误 → 透出异常，不 reload', async () => {
  let reloaded = 0;
  await assert.rejects(
    sgx.apiFetch('/api/books', {}, async () => { throw new TypeError('fetch failed'); }, () => { reloaded++; }),
    (e) => e instanceof TypeError && !e.sgxLocked
  );
  assert.equal(reloaded, 0);
});

globalThis.fetch = realFetch;

console.log(`\n${passed} passed`);
