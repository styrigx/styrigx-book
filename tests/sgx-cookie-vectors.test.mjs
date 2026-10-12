// sgx-verified 五段式验签测试（2.11 跨仓契约）。
// 主站 2.11 起签发 by.role.epoch.exp.sig（sig = Ed25519("by.role.epoch.exp")）；
// book 的 functions/_sgx-cookie.js 必须与主站 functions/_middleware.js 的
// verifyOneCookie 完全一致：by ∈ {root, owner}、role ∈ {owner, visitor}、
// exp 未过期、Ed25519 验签、epoch >= 主站 session-epoch（fail closed）。
// 旧四段式（无 by）一律拒绝，不留兼容层。
// 运行：node tests/sgx-cookie-vectors.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import {
  parseSessionCookie,
  verifySessionCookie,
  verifySessionCookieStrict,
  _resetEpochCache,
  SESSION_BYS,
  SESSION_ROLES,
} from '../functions/_sgx-cookie.js';

/* ---------- 测试密钥（模块内公钥缓存按密钥值，整个文件只用同一对） ---------- */
const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const PEM =
  '-----BEGIN PUBLIC KEY-----\n' +
  Buffer.from(publicKey.export({ type: 'spki', format: 'der' })).toString('base64').replace(/.{64}/g, '$&\n') +
  '\n-----END PUBLIC KEY-----';

const EPOCH = 11;
const FUTURE = Date.now() + 3600e3;

function makeCookie(by, role, epoch, exp, key = privateKey) {
  const msg = `${by}.${role}.${epoch}.${exp}`;
  return `${msg}.${sign(null, Buffer.from(msg), key).toString('base64url')}`;
}
function makeLegacy4(by, role, epoch, exp) {
  // 旧四段式 role.epoch.exp.sig（无 by）——注意参数顺序与 makeCookie 不同
  const msg = `${role}.${epoch}.${exp}`;
  return `${msg}.${sign(null, Buffer.from(msg), privateKey).toString('base64url')}`;
}

/* session-epoch 接口桩 */
const realFetch = globalThis.fetch;
function stubEpoch(epoch) {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ epoch }) });
}
function stubEpochFail() {
  globalThis.fetch = async () => { throw new Error('network down'); };
}
stubEpoch(EPOCH);

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

console.log('sgx-cookie-vectors（五段式）:');

await test('白名单常量：by ∈ {root, owner}，role ∈ {owner, visitor}', () => {
  assert.ok(SESSION_BYS.has('root') && SESSION_BYS.has('owner') && SESSION_BYS.size === 2);
  assert.ok(SESSION_ROLES.has('owner') && SESSION_ROLES.has('visitor') && SESSION_ROLES.size === 2);
});

await test('parse：有效五段式解析出 by/role/epoch', () => {
  const p = parseSessionCookie(makeCookie('owner', 'owner', EPOCH, FUTURE));
  assert.ok(p);
  assert.equal(p.by, 'owner');
  assert.equal(p.role, 'owner');
  assert.equal(p.epoch, EPOCH);
});

await test('verify：by=owner/role=owner 通过', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'owner', EPOCH, FUTURE), PEM), 'owner');
});

await test('verify：by=root/role=owner 通过', async () => {
  assert.equal(await verifySessionCookie(makeCookie('root', 'owner', EPOCH, FUTURE), PEM), 'owner');
});

await test('verify：by=root/role=visitor 通过', async () => {
  assert.equal(await verifySessionCookie(makeCookie('root', 'visitor', EPOCH, FUTURE), PEM), 'visitor');
});

await test('verify：by=owner/role=visitor 通过', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'visitor', EPOCH, FUTURE), PEM), 'visitor');
});

await test('旧四段式（无 by）被 parse 拒绝', () => {
  assert.equal(parseSessionCookie(makeLegacy4('x', 'owner', EPOCH, FUTURE)), null);
});

await test('旧四段式被 verify 拒绝', async () => {
  assert.equal(await verifySessionCookie(makeLegacy4('x', 'owner', EPOCH, FUTURE), PEM), null);
});

await test('三段式被拒绝', async () => {
  assert.equal(await verifySessionCookie(`owner.${EPOCH}.${FUTURE}`, PEM), null);
});

await test('六段式被拒绝', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'owner', EPOCH, FUTURE) + '.extra', PEM), null);
});

await test('篡改 by（owner→admin）→ 签名对不上，拒绝', async () => {
  const c = makeCookie('owner', 'owner', EPOCH, FUTURE).split('.');
  c[0] = 'admin';
  assert.equal(await verifySessionCookie(c.join('.'), PEM), null);
});

await test('篡改 role（owner→visitor）→ 签名对不上，拒绝', async () => {
  const c = makeCookie('owner', 'owner', EPOCH, FUTURE).split('.');
  c[1] = 'visitor';
  assert.equal(await verifySessionCookie(c.join('.'), PEM), null);
});

await test('篡改 epoch → 签名对不上，拒绝', async () => {
  const c = makeCookie('owner', 'owner', EPOCH, FUTURE).split('.');
  c[2] = String(EPOCH + 1);
  assert.equal(await verifySessionCookie(c.join('.'), PEM), null);
});

await test('非法 by（guest 签名正确）→ 白名单拒绝', async () => {
  assert.equal(await verifySessionCookie(makeCookie('guest', 'owner', EPOCH, FUTURE), PEM), null);
});

await test('非法 role（admin 签名正确）→ 白名单拒绝', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'admin', EPOCH, FUTURE), PEM), null);
});

await test('exp 过期 → 拒绝', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'owner', EPOCH, Date.now() - 1000), PEM), null);
});

await test('伪造签名（别的密钥）→ 拒绝', async () => {
  const other = generateKeyPairSync('ed25519').privateKey;
  assert.equal(await verifySessionCookie(makeCookie('owner', 'owner', EPOCH, FUTURE, other), PEM), null);
});

await test('缺 SGX_LOCK_PUBLIC → fail closed（null）', async () => {
  assert.equal(await verifySessionCookie(makeCookie('owner', 'owner', EPOCH, FUTURE), ''), null);
  assert.equal(await verifySessionCookieStrict(makeCookie('owner', 'owner', EPOCH, FUTURE), ''), null);
});

await test('strict：epoch 落后主站 → 拒绝', async () => {
  _resetEpochCache();
  stubEpoch(EPOCH + 1);
  assert.equal(await verifySessionCookieStrict(makeCookie('owner', 'owner', EPOCH, FUTURE), PEM), null);
});

await test('strict：epoch 持平 → 通过', async () => {
  _resetEpochCache();
  stubEpoch(EPOCH);
  assert.equal(await verifySessionCookieStrict(makeCookie('owner', 'owner', EPOCH, FUTURE), PEM), 'owner');
});

await test('strict：epoch 超前 → 通过', async () => {
  _resetEpochCache();
  stubEpoch(EPOCH - 1);
  assert.equal(await verifySessionCookieStrict(makeCookie('owner', 'owner', EPOCH, FUTURE), PEM), 'owner');
});

await test('strict：拿不到主站 epoch → fail closed（null）', async () => {
  _resetEpochCache();
  stubEpochFail();
  assert.equal(await verifySessionCookieStrict(makeCookie('owner', 'owner', EPOCH, FUTURE), PEM), null);
  stubEpoch(EPOCH);
});

await test('strict：旧四段式 → 拒绝', async () => {
  assert.equal(await verifySessionCookieStrict(makeLegacy4('x', 'owner', EPOCH, FUTURE), PEM), null);
});

globalThis.fetch = realFetch;

console.log(`\nsgx-cookie-vectors: ${passed} passed`);
