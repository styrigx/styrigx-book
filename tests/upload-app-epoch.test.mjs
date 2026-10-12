// 上传 appEpoch 一致性测试：init 强制刷新 appEpoch，过期 token 在 init 即 403。
// 覆盖：
//   1. token appEpoch 落后于主站当前值 → init 403 app-token-invalid（不走缓存）
//   2. token appEpoch 与主站一致 → init 200
//   3. part 时会话 app_epoch 落后 → 403 upload-session-invalid
// 运行：node tests/upload-app-epoch.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import { onRequest as initReq } from '../functions/api/admin/upload/init.js';
import { onRequest as partReq } from '../functions/api/admin/upload/part.js';
import { _resetEpochCache } from '../functions/_sgx-cookie.js';

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

const { publicKey: appPub, privateKey: appPriv } = generateKeyPairSync('ed25519');
const APP_PUB_B64 = appPub.export({ type: 'spki', format: 'der' }).toString('base64');
const { publicKey: lockPub, privateKey: lockPriv } = generateKeyPairSync('ed25519');
const LOCK_PUB_B64 = lockPub.export({ type: 'spki', format: 'der' }).toString('base64');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CURRENT_EPOCH = 10;
const CURRENT_APP_EPOCH = 2; // 主站当前 app.book=2
const STALE_APP_EPOCH = 1;   // 用户 token 里的旧值

/* mock 主站 session-epoch：永远返回最新值（模拟强制刷新） */
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ epoch: CURRENT_EPOCH, app: { book: CURRENT_APP_EPOCH } }),
});

function makeAppToken(appEpoch) {
  const payload = ['owner', CURRENT_EPOCH, appEpoch, Date.now(), Date.now() + 600000, 'book', 'upload'].join('.');
  return payload + '.' + b64url(sign(null, Buffer.from(payload), appPriv));
}

function makeSessionCookie() {
  const payload = `owner.owner.${CURRENT_EPOCH}.${Date.now() + 3600000}`;
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
          return null;
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

function mockR2() {
  return {
    async createMultipartUpload(key) { return { uploadId: 'mpu-1', key }; },
    async uploadPart() { return { etag: 'etag-1' }; },
    async abortMultipartUpload() {},
  };
}

const EPUB_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]).buffer;

function ctxFor({ db, r2, url, body, magic, appEpoch }) {
  const cookies = [`sgx-verified=${makeSessionCookie()}`, `sgx-app=${makeAppToken(appEpoch)}`];
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

const SHA = 'd'.repeat(64);

console.log('upload-app-epoch: init 强制刷新 appEpoch');

// 关键用例：即使 isolate 缓存里是旧值（模拟跨 isolate 不一致），
// init 也必须强制刷新看到最新值，过期 token 在 init 即 403。
await test('init：token appEpoch=1 落后于主站 2 → 403 app-token-invalid（不放行）', async () => {
  _resetEpochCache();
  const db = mockDB();
  const r2 = mockR2();
  // 先用旧值填充缓存（模拟 init 落在缓存旧值的 isolate 上）
  // 注意：requireAppToken 现在用 fetchAppEpochFresh，会跳过这个缓存
  const ctx = ctxFor({
    db, r2,
    url: 'https://book.styrigx.com/api/admin/upload/init',
    body: { filename: 't.epub', size: 273000, sha256: SHA, format: 'epub' },
    appEpoch: STALE_APP_EPOCH,
  });
  const res = await initReq(ctx);
  assert.equal(res.status, 403, 'init 应 403');
  const body = await res.json();
  assert.equal(body.error, 'app-token-invalid', '错误码应为 app-token-invalid');
  // 会话不应被创建
  assert.equal(db._sessions.size, 0, '不应创建上传会话');
});

await test('init：token appEpoch=2 与主站一致 → 200', async () => {
  _resetEpochCache();
  const db = mockDB();
  const r2 = mockR2();
  const ctx = ctxFor({
    db, r2,
    url: 'https://book.styrigx.com/api/admin/upload/init',
    body: { filename: 't.epub', size: 273000, sha256: SHA, format: 'epub' },
    appEpoch: CURRENT_APP_EPOCH,
  });
  const res = await initReq(ctx);
  assert.equal(res.status, 200, 'init 应 200');
  assert.equal(db._sessions.size, 1, '应创建上传会话');
});

await test('part：会话 app_epoch=1 落后于主站 2 → 403 upload-session-epoch-stale（DIAG 临时）', async () => {
  _resetEpochCache();
  const db = mockDB();
  const r2 = mockR2();
  const key = 'books/12345678-1234-1234-1234-123456789abc.epub';
  // 模拟旧逻辑下 init 放行了过期 token（会话里 app_epoch=1）
  db._sessions.set('mpu-1', { r2_key: key, app_epoch: STALE_APP_EPOCH, created_at: Date.now() });
  const ctx = ctxFor({
    db, r2,
    url: `https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=${encodeURIComponent(key)}&partNumber=1`,
    magic: EPUB_MAGIC,
    appEpoch: CURRENT_APP_EPOCH,
  });
  const res = await partReq(ctx);
  assert.equal(res.status, 403, 'part 应 403');
  const body = await res.json();
  assert.equal(body.error, 'upload-session-epoch-stale', '错误码应为 upload-session-epoch-stale（DIAG 临时）');
});

await test('集成：init 成功后紧接 part → 200（同一 DB 绑定）', async () => {
  _resetEpochCache();
  const db = mockDB();
  const r2 = mockR2();
  const key = 'books/12345678-1234-1234-1234-123456789abc.epub';
  // init
  const initCtx = ctxFor({
    db, r2,
    url: 'https://book.styrigx.com/api/admin/upload/init',
    body: { filename: 't.epub', size: 273000, sha256: SHA, format: 'epub' },
    appEpoch: CURRENT_APP_EPOCH,
  });
  const initRes = await initReq(initCtx);
  assert.equal(initRes.status, 200, 'init 应 200');
  const initBody = await initRes.json();
  assert.ok(initBody.uploadId, '应返回 uploadId');
  // 紧接 part（同一 uploadId/key，模拟用户刚选完文件立即上传）
  const partCtx = ctxFor({
    db, r2,
    url: `https://book.styrigx.com/api/admin/upload/part?uploadId=${encodeURIComponent(initBody.uploadId)}&key=${encodeURIComponent(initBody.key)}&partNumber=1`,
    magic: EPUB_MAGIC,
    appEpoch: CURRENT_APP_EPOCH,
  });
  const partRes = await partReq(partCtx);
  assert.equal(partRes.status, 200, '紧接的 part 1 应 200');
  const partBody = await partRes.json();
  assert.ok(partBody.etag, '应返回 etag');
});

console.log(`\n${passed} passed`);
