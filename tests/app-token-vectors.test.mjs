// sgx-app 测试向量验证（2.10.0 跨仓契约）。
// tests/fixtures/app-token-vectors.json 与 space 仓库的同名文件完全相同。
// book：断言验证结果与向量一致（有效通过；篡改/过期/appEpoch 偏低拒绝）。
// 运行：node tests/app-token-vectors.test.mjs

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { parseAppToken, verifyAppToken } from '../functions/_app-token.js';

const vectors = JSON.parse(readFileSync(new URL('./fixtures/app-token-vectors.json', import.meta.url), 'utf8'));
const PUB_B64 = vectors.keypair.public;
const CURRENT_EPOCH = vectors.currentEpoch;
const CURRENT_APP_EPOCH = vectors.currentAppEpochs.book;

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

console.log('app-token-vectors:');

await test('向量文件结构完整', () => {
  assert.ok(vectors.keypair.public);
  assert.ok(vectors.keypair.private);
  assert.equal(vectors.valid.length, 3);
  assert.ok(vectors.tampered);
  assert.ok(vectors.expired);
  assert.ok(vectors.lowAppEpoch);
});

await test('有效 token[0]（book/upload）验证通过', async () => {
  const ok = await verifyAppToken(vectors.valid[0], PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, true);
  const p = parseAppToken(vectors.valid[0]);
  assert.equal(p.aud, 'book');
  assert.equal(p.scope, 'upload');
});

await test('有效 token[1]（appEpoch 更高）验证通过', async () => {
  const ok = await verifyAppToken(vectors.valid[1], PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, true);
});

await test('有效 token[2]（aud=music）在 book 被拒', async () => {
  // book 只接受 aud=book；parseAppToken 直接拒绝
  const p = parseAppToken(vectors.valid[2]);
  assert.equal(p, null);
  const ok = await verifyAppToken(vectors.valid[2], PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, false);
});

await test('篡改签名的 token 被拒', async () => {
  const ok = await verifyAppToken(vectors.tampered, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, false);
});

await test('过期的 token 被拒', async () => {
  const ok = await verifyAppToken(vectors.expired, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, false);
});

await test('appEpoch 偏低的 token 被拒', async () => {
  // token appEpoch=1 < 当前 5
  const p = parseAppToken(vectors.lowAppEpoch);
  assert.ok(p);
  assert.ok(p.appEpoch < CURRENT_APP_EPOCH);
  const ok = await verifyAppToken(vectors.lowAppEpoch, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, false);
});

await test('缺 SGX_APP_PUBLIC 时 fail closed', async () => {
  const ok = await verifyAppToken(vectors.valid[0], '', CURRENT_EPOCH, CURRENT_APP_EPOCH);
  assert.equal(ok, false);
});

await test('epoch/appEpoch 拿不到时 fail closed', async () => {
  assert.equal(await verifyAppToken(vectors.valid[0], PUB_B64, null, CURRENT_APP_EPOCH), false);
  assert.equal(await verifyAppToken(vectors.valid[0], PUB_B64, CURRENT_EPOCH, null), false);
});

console.log(`\napp-token-vectors: ${passed} passed`);
