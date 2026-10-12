// 上传全链路测试：init → part → complete（2.10.2）。
// 覆盖：
//   1. EPUB 全链路 200，会话在 complete 后清理
//   2. PDF 全链路 200
//   3. part 时 R2 uploadPart 抛错 → 500 part-failed，且 abort 被调用、会话被清理
//   4. complete 时 R2 completeMultipartUpload 抛错 → 400 complete-failed，且 abort 被调用、会话被清理
//   5. complete 时发生未捕获异常（如 head 抛错）→ 500 complete-failed，且 abort 被调用、会话被清理
// 运行：node tests/upload-chain.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { onRequest as initReq } from '../functions/api/admin/upload/init.js';
import { onRequest as partReq } from '../functions/api/admin/upload/part.js';
import { onRequest as completeReq } from '../functions/api/admin/upload/complete.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

/* 测试用 Ed25519 密钥对（仅内存，不落盘） */
const { publicKey: appPub, privateKey: appPriv } = generateKeyPairSync('ed25519');
const APP_PUB_B64 = appPub.export({ type: 'spki', format: 'der' }).toString('base64');
const { publicKey: lockPub, privateKey: lockPriv } = generateKeyPairSync('ed25519');
const LOCK_PUB_B64 = lockPub.export({ type: 'spki', format: 'der' }).toString('base64');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CURRENT_EPOCH = 5;
const CURRENT_APP_EPOCH = 2;

/* mock 主站 session-epoch 接口 */
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ epoch: CURRENT_EPOCH, app: { book: CURRENT_APP_EPOCH } }),
});

function makeAppToken() {
  const payload = ['owner', CURRENT_EPOCH, CURRENT_APP_EPOCH, Date.now(), Date.now() + 600000, 'book', 'upload'].join('.');
  return payload + '.' + b64url(sign(null, Buffer.from(payload), appPriv));
}

function makeSessionCookie() {
  const payload = `owner.${CURRENT_EPOCH}.${Date.now() + 3600000}`;
  return payload + '.' + b64url(sign(null, Buffer.from(payload), lockPriv));
}

function mockDB() {
  const sessions = new Map();
  return {
    _sessions: sessions,
    prepare(sql) {
      return {
        _p: [],
        bind(...p) { this._p = p; return this; },
        async first() {
          if (sql.includes('FROM upload_sessions WHERE upload_id')) {
            return sessions.get(this._p[0]) || null;
          }
          return null; // books 去重查询：无重复
        },
        async run() {
          if (sql.includes('INSERT OR REPLACE INTO upload_sessions')) {
            const [upload_id, r2_key, app_epoch, created_at] = this._p;
            sessions.set(upload_id, { r2_key, app_epoch, created_at });
          } else if (sql.includes('DELETE FROM upload_sessions')) {
            sessions.delete(this._p[0]);
          }
          return {};
        },
      };
    },
  };
}

function mockR2(overrides = {}) {
  const calls = { abort: 0 };
  return {
    _calls: calls,
    async createMultipartUpload(key) { return { uploadId: 'mpu-1', key }; },
    async uploadPart() { return { etag: 'etag-1' }; },
    async abortMultipartUpload() { calls.abort++; },
    async completeMultipartUpload() {},
    async head() { return { size: 273000 }; },
    ...overrides,
  };
}

const EPUB_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]).buffer; // PK\x03\x04
const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0]).buffer; // %PDF

function ctxFor({ db, r2, url, body, magic }) {
  const cookies = [`sgx-verified=${makeSessionCookie()}`, `sgx-app=${makeAppToken()}`];
  return {
    request: {
      method: 'POST',
      url,
      headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookies.join('; ') : null) },
      json: async () => body,
      arrayBuffer: async () => magic,
    },
    env: {
      SGX_APP_PUBLIC: APP_PUB_B64,
      SGX_LOCK_PUBLIC: LOCK_PUB_B64,
      DB: db,
      BOOKS: r2,
      STORAGE_ENABLED: 'true',
      MAX_UPLOAD_MB: '500',
    },
  };
}

const SHA = 'c'.repeat(64);

async function doInit(db, r2, format) {
  const ctx = ctxFor({
    db, r2,
    url: 'https://book.styrigx.com/api/admin/upload/init',
    body: { filename: `t.${format}`, size: 273000, sha256: SHA, format },
  });
  const res = await initReq(ctx);
  assert.equal(res.status, 200, 'init 应 200');
  return res.json();
}

function partUrl(key) {
  return `https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=${encodeURIComponent(key)}&partNumber=1`;
}

async function doPart(db, r2, key, magic) {
  const ctx = ctxFor({ db, r2, url: partUrl(key), magic });
  return partReq(ctx);
}

async function doComplete(db, r2, key) {
  const ctx = ctxFor({
    db, r2,
    url: 'https://book.styrigx.com/api/admin/upload/complete',
    body: {
      uploadId: 'mpu-1', key,
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      sha256: SHA,
      meta: { title: 'T', author: 'A' },
    },
  });
  return completeReq(ctx);
}

console.log('upload-chain: init → part → complete 全链路');

await test('EPUB 全链路：init → part → complete 均为 200，会话清理', async () => {
  const db = mockDB();
  const r2 = mockR2();
  const init = await doInit(db, r2, 'epub');
  assert.equal(init.uploadId, 'mpu-1');
  assert.ok(db._sessions.has('mpu-1'), 'init 后会话应存在');

  const pr = await doPart(db, r2, init.key, EPUB_MAGIC);
  assert.equal(pr.status, 200, 'part 应 200');
  assert.equal((await pr.json()).etag, 'etag-1');

  const cr = await doComplete(db, r2, init.key);
  assert.equal(cr.status, 200, 'complete 应 200');
  assert.ok((await cr.json()).id);
  assert.equal(db._sessions.has('mpu-1'), false, 'complete 后会话应清理');
});

await test('PDF 全链路：init → part → complete 均为 200', async () => {
  const db = mockDB();
  const r2 = mockR2();
  const init = await doInit(db, r2, 'pdf');
  const pr = await doPart(db, r2, init.key, PDF_MAGIC);
  assert.equal(pr.status, 200);
  const cr = await doComplete(db, r2, init.key);
  assert.equal(cr.status, 200);
  assert.equal(db._sessions.has('mpu-1'), false);
});

await test('part：R2 uploadPart 抛错 → 500 part-failed，abort 被调用，会话被清理', async () => {
  const db = mockDB();
  const r2 = mockR2({ async uploadPart() { throw new Error('r2 boom'); } });
  const init = await doInit(db, r2, 'epub');
  const pr = await doPart(db, r2, init.key, EPUB_MAGIC);
  assert.equal(pr.status, 500);
  assert.equal((await pr.json()).error, 'part-failed');
  assert.equal(r2._calls.abort, 1, '应 abort multipart');
  assert.equal(db._sessions.has('mpu-1'), false, '会话应被清理');
});

await test('complete：R2 completeMultipartUpload 抛错 → 400 complete-failed，abort 被调用，会话被清理', async () => {
  const db = mockDB();
  const r2 = mockR2({ async completeMultipartUpload() { throw new Error('r2 boom'); } });
  const init = await doInit(db, r2, 'epub');
  const pr = await doPart(db, r2, init.key, EPUB_MAGIC);
  assert.equal(pr.status, 200);
  const cr = await doComplete(db, r2, init.key);
  assert.equal(cr.status, 400);
  assert.equal((await cr.json()).error, 'complete-failed');
  assert.equal(r2._calls.abort, 1, '应 abort multipart');
  assert.equal(db._sessions.has('mpu-1'), false, '会话应被清理');
});

await test('complete：未捕获异常（如 head 抛错）→ 500 complete-failed，abort 被调用，会话被清理', async () => {
  const db = mockDB();
  const r2 = mockR2({ async head() { throw new Error('r2 head boom'); } });
  const init = await doInit(db, r2, 'epub');
  const pr = await doPart(db, r2, init.key, EPUB_MAGIC);
  assert.equal(pr.status, 200);
  const cr = await doComplete(db, r2, init.key);
  assert.equal(cr.status, 500);
  assert.equal((await cr.json()).error, 'complete-failed');
  assert.equal(r2._calls.abort, 1, '应 abort multipart');
  assert.equal(db._sessions.has('mpu-1'), false, '会话应被清理');
});

console.log(`\n  ${passed} passed`);
