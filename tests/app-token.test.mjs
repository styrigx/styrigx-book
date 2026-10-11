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
import { recordUploadSession, verifyUploadSession } from '../functions/api/admin/upload/_sessions.js';
import { onRequest as initReq } from '../functions/api/admin/upload/init.js';
import { onRequest as partReq } from '../functions/api/admin/upload/part.js';
import { onRequest as completeReq } from '../functions/api/admin/upload/complete.js';
import { onRequest as abortReq } from '../functions/api/admin/upload/abort.js';

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

function makeToken({ role = 'owner', epoch = 5, appEpoch = 2, iat = Date.now(), exp = Date.now() + 600000, aud = 'book', scope = 'upload', key = privateKey } = {}) {
  const payload = [role, epoch, appEpoch, iat, exp, aud, scope].join('.');
  const sig = sign(null, Buffer.from(payload), key);
  return payload + '.' + b64url(sig);
}

/* mock fetchSessionEpoch：fetch 返回固定 epoch + app */
const realFetch = globalThis.fetch;
const CURRENT_EPOCH = 5;
const CURRENT_APP_EPOCH = 2;
globalThis.fetch = async () => ({ ok: true, json: async () => ({ epoch: CURRENT_EPOCH, app: { book: CURRENT_APP_EPOCH } }) });

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
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), true);
});

await test('verifyAppToken：过期 token 拒绝', async () => {
  const t = makeToken({ exp: Date.now() - 1000 });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：aud 错误拒绝', async () => {
  const t = makeToken({ aud: 'blog' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：scope 错误拒绝', async () => {
  const t = makeToken({ scope: 'read' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：epoch 落后拒绝', async () => {
  const t = makeToken({ epoch: CURRENT_EPOCH - 1 });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：appEpoch 落后拒绝', async () => {
  const t = makeToken({ appEpoch: CURRENT_APP_EPOCH - 1 });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：伪造签名拒绝', async () => {
  const { privateKey: evilKey } = generateKeyPairSync('ed25519');
  const t = makeToken({ key: evilKey });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
});

await test('verifyAppToken：缺 SGX_APP_PUBLIC 拒绝（fail closed）', async () => {
  const t = makeToken();
  assert.equal(await verifyAppToken(t, '', CURRENT_EPOCH), false);
  assert.equal(await verifyAppToken(t, null, CURRENT_EPOCH), false);
});

await test('verifyAppToken：role 非 owner 拒绝', async () => {
  const t = makeToken({ role: 'visitor' });
  assert.equal(await verifyAppToken(t, PUB_B64, CURRENT_EPOCH, CURRENT_APP_EPOCH), false);
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

/* ===== 上传会话：init 绑定通行证 epoch，part/complete/abort 只验 owner + 会话 ===== */

/* mock D1（upload_sessions + books 去重查询） */
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

const mockR2 = {
  async createMultipartUpload(key) { return { uploadId: 'mpu-1', key }; },
  async uploadPart() { return { etag: 'etag-1' }; },
  async abortMultipartUpload() {},
  async completeMultipartUpload() {},
  async head() { return { size: 123 }; },
};

/* owner 会话 cookie（sgx-verified = owner.epoch.exp.sig，自签测试密钥） */
const { publicKey: lockPub, privateKey: lockPriv } = generateKeyPairSync('ed25519');
const LOCK_PUB_B64 = lockPub.export({ type: 'spki', format: 'der' }).toString('base64');
function makeSessionCookie() {
  const payload = `owner.${CURRENT_EPOCH}.${Date.now() + 3600000}`;
  return payload + '.' + b64url(sign(null, Buffer.from(payload), lockPriv));
}

function uploadCtx({ appCookie = 'USE_DEFAULT', db = null, url = null, body = null } = {}) {
  const _db = db || mockDB();
  const cookies = [`sgx-verified=${makeSessionCookie()}`];
  const appVal = appCookie === 'USE_DEFAULT' ? makeToken() : appCookie;
  if (appVal) cookies.push(`sgx-app=${appVal}`);
  return {
    ctx: {
      request: {
        method: 'POST',
        url: url || 'https://book.styrigx.com/api/admin/upload/init',
        headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookies.join('; ') : null) },
        json: async () => body,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0]).buffer, // %PDF 魔数
      },
      env: {
        SGX_APP_PUBLIC: PUB_B64,
        SGX_LOCK_PUBLIC: LOCK_PUB_B64,
        DB: _db,
        BOOKS: mockR2,
        STORAGE_ENABLED: 'true',
        MAX_UPLOAD_MB: '500',
      },
    },
    db: _db,
  };
}

const INIT_BODY = { filename: 'a.epub', size: 100, sha256: 'a'.repeat(64), format: 'epub' };

await test('init：缺通行证 → 403 app-token-required', async () => {
  const { ctx } = uploadCtx({ appCookie: null, body: INIT_BODY });
  const res = await initReq(ctx);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'app-token-required');
});

await test('init：通行证无效 → 403 app-token-invalid', async () => {
  const { ctx } = uploadCtx({ appCookie: 'bad.token', body: INIT_BODY });
  const res = await initReq(ctx);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'app-token-invalid');
});

await test('init 成功后记录上传会话（绑定 epoch）', async () => {
  const { ctx, db } = uploadCtx({ body: INIT_BODY });
  const res = await initReq(ctx);
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.uploadId, 'mpu-1');
  const sess = db._sessions.get('mpu-1');
  assert.ok(sess, '会话应已记录');
  assert.equal(sess.app_epoch, CURRENT_APP_EPOCH);
  assert.equal(sess.r2_key, j.key);
});

await test('part：通行证过期后，已 init 的 uploadId 仍然放行', async () => {
  const { db } = uploadCtx({ body: INIT_BODY });
  await recordUploadSession({ DB: db }, 'mpu-1', 'books/12345678-1234-1234-1234-123456789abc.pdf', CURRENT_APP_EPOCH);
  const expired = makeToken({ exp: Date.now() - 1000 });
  const { ctx } = uploadCtx({
    appCookie: expired,
    db,
    url: 'https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=books/12345678-1234-1234-1234-123456789abc.pdf&partNumber=1',
  });
  const res = await partReq(ctx);
  assert.equal(res.status, 200, '过期通行证不应阻断已建会话的分片');
  assert.equal((await res.json()).etag, 'etag-1');
});

await test('part：伪造 uploadId → 403', async () => {
  const { ctx } = uploadCtx({
    url: 'https://book.styrigx.com/api/admin/upload/part?uploadId=fake&key=books/12345678-1234-1234-1234-123456789abc.pdf&partNumber=1',
  });
  const res = await partReq(ctx);
  assert.equal(res.status, 403);
});

await test('part：uploadId 与 key 不匹配 → 403', async () => {
  const { ctx, db } = uploadCtx({
    url: 'https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=books/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.pdf&partNumber=1',
  });
  await recordUploadSession({ DB: db }, 'mpu-1', 'books/12345678-1234-1234-1234-123456789abc.pdf', CURRENT_APP_EPOCH);
  const res = await partReq(ctx);
  assert.equal(res.status, 403);
});

await test('part：会话超过 2 小时 → 403', async () => {
  const { ctx, db } = uploadCtx({
    url: 'https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=books/12345678-1234-1234-1234-123456789abc.pdf&partNumber=1',
  });
  const threeHoursAgo = Date.now() - 3 * 60 * 60 * 1000;
  db._sessions.set('mpu-1', { r2_key: 'books/12345678-1234-1234-1234-123456789abc.pdf', app_epoch: CURRENT_APP_EPOCH, created_at: threeHoursAgo });
  const res = await partReq(ctx);
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'upload-session-expired');
  assert.equal(db._sessions.has('mpu-1'), false, '过期会话应被清理');
});

await test('part：app epoch 变更后 → 403', async () => {
  const { ctx, db } = uploadCtx({
    url: 'https://book.styrigx.com/api/admin/upload/part?uploadId=mpu-1&key=books/12345678-1234-1234-1234-123456789abc.pdf&partNumber=1',
  });
  // 会话建于 appEpoch 1（模拟删除应用类通行密钥后），当前 app.book 为 2
  await recordUploadSession({ DB: db }, 'mpu-1', 'books/12345678-1234-1234-1234-123456789abc.pdf', CURRENT_APP_EPOCH - 1);
  const res = await partReq(ctx);
  assert.equal(res.status, 403);
});

await test('complete：有效会话放行并清理', async () => {
  const { ctx, db } = uploadCtx({
    body: {
      uploadId: 'mpu-1', key: 'books/12345678-1234-1234-1234-123456789abc.pdf',
      parts: [{ partNumber: 1, etag: 'etag-1' }],
      sha256: 'b'.repeat(64),
      meta: { title: 'T', author: 'A' },
    },
  });
  await recordUploadSession({ DB: db }, 'mpu-1', 'books/12345678-1234-1234-1234-123456789abc.pdf', CURRENT_APP_EPOCH);
  const res = await completeReq(ctx);
  assert.equal(res.status, 200);
  assert.ok((await res.json()).id);
  assert.equal(db._sessions.has('mpu-1'), false, '完成后会话应清理');
});

await test('abort：有效会话放行并清理', async () => {
  const { ctx, db } = uploadCtx({ body: { uploadId: 'mpu-1', key: 'books/12345678-1234-1234-1234-123456789abc.pdf' } });
  await recordUploadSession({ DB: db }, 'mpu-1', 'books/12345678-1234-1234-1234-123456789abc.pdf', CURRENT_APP_EPOCH);
  const res = await abortReq(ctx);
  assert.equal(res.status, 200);
  assert.equal(db._sessions.has('mpu-1'), false);
});

await test('verifyUploadSession：DB 异常时 fail closed', async () => {
  const badEnv = {
    DB: { prepare() { throw new Error('db down'); } },
    env2: null,
  };
  const { response } = await verifyUploadSession({ env: badEnv }, 'x', 'y');
  assert.ok(response);
  assert.equal(response.status, 403);
});

globalThis.fetch = realFetch;

/* ===== 前端：403 分类（只对 app-token-* 跳复验）===== */
await test('前端：app-token-required / app-token-invalid 识别为跳转', async () => {
  const src = readFileSync(new URL('../static/js/upload-queue.js', import.meta.url), 'utf8');
  globalThis.window = globalThis;
  eval(src);
  const { appTokenErrorCode, appVerifyUrl } = globalThis.SgxUploadQueue;
  const fakeRes = (status, error) => ({
    status,
    clone: () => ({ json: async () => ({ error }) }),
  });
  assert.equal(await appTokenErrorCode(fakeRes(403, 'app-token-required')), 'app-token-required');
  assert.equal(await appTokenErrorCode(fakeRes(403, 'app-token-invalid')), 'app-token-invalid');
  // 其他 403 不跳转
  assert.equal(await appTokenErrorCode(fakeRes(403, 'forbidden')), null);
  assert.equal(await appTokenErrorCode(fakeRes(403, 'upload-session-expired')), null);
  assert.equal(await appTokenErrorCode(fakeRes(403, 'upload-session-invalid')), null);
  // 非 403 不跳转
  assert.equal(await appTokenErrorCode(fakeRes(401, 'unauthorized')), null);
  assert.equal(await appTokenErrorCode(fakeRes(200, null)), null);
  // 复验 URL 格式
  globalThis.location = { href: 'https://book.styrigx.com/shelf' };
  const u = appVerifyUrl();
  assert.ok(u.startsWith('https://styrigx.com/app-verify/?aud=book&scope=upload&return='));
  assert.ok(u.includes(encodeURIComponent('https://book.styrigx.com/shelf')));
  delete globalThis.window;
  delete globalThis.location;
});

await test('前端：上传中途被拒用 confirm 而非直接跳转', () => {
  const src = readFileSync(new URL('../static/js/upload-queue.js', import.meta.url), 'utf8');
  assert.ok(src.includes('window.confirm('), '中途被拒应先弹确认框');
  // 确认框文案
  assert.ok(src.includes('已完成的不受影响'));
});

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
