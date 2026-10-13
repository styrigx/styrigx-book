// 上传封面入库 + 补齐操作测试（真实 R2+D1 绑定，Miniflare）。
// 覆盖：
//   1. 完整链路（新契约：顶层 coverKey + meta.pages）：init → part → cover POST → complete，
//      断言 D1 入库 cover_key 与 pages 正确
//   2. 兼容：旧客户端只传 meta.coverKey（无顶层）→ cover_key 仍入库
//   3. 顶层优先：顶层与 meta 都有 coverKey 时，顶层胜出
//   4. 校验规则不变：顶层 coverKey 格式非法 → 400 invalid coverKey
//   5. 补齐操作：cover_key 为空且 R2 有封面 → 写回；R2 无封面 → 保持 NULL；
//      已有 cover_key → 不动；只改 cover_key 一列，pages 不补
//   6. 补齐鉴权：无 owner cookie → 401；无 app 令牌 → 403
// 注意：R2/D1 均来自 Miniflare 真实绑定，不用手写 mock；
// 仅主站 session-epoch/app-epoch 接口是外部网络依赖，用 fetch 桩代替（与 upload-chain.test.mjs 相同做法）。
// 运行：node tests/upload-cover-backfill.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { onRequest as initReq } from '../functions/api/admin/upload/init.js';
import { onRequest as partReq } from '../functions/api/admin/upload/part.js';
import { onRequest as coverReq } from '../functions/api/admin/cover.js';
import { onRequest as completeReq } from '../functions/api/admin/upload/complete.js';
import { onRequest as backfillReq } from '../functions/api/admin/books/backfill-covers.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
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

/* mock 主站 session-epoch / app-epoch 接口（外部网络依赖，非 R2/D1） */
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ epoch: CURRENT_EPOCH, app: { book: CURRENT_APP_EPOCH } }),
});

function makeAppToken() {
  const payload = ['owner', CURRENT_EPOCH, CURRENT_APP_EPOCH, Date.now(), Date.now() + 600000, 'book', 'upload'].join('.');
  return payload + '.' + b64url(sign(null, Buffer.from(payload), appPriv));
}

function makeSessionCookie() {
  const payload = `owner.owner.${CURRENT_EPOCH}.${Date.now() + 3600000}`;
  return payload + '.' + b64url(sign(null, Buffer.from(payload), lockPriv));
}

function cookies({ owner = true, app = true } = {}) {
  const parts = [];
  if (owner) parts.push(`sgx-verified=${makeSessionCookie()}`);
  if (app) parts.push(`sgx-app=${makeAppToken()}`);
  return parts.join('; ');
}

function ctxFor({ env, url, body, buf, cookieOpts }) {
  return {
    request: {
      method: 'POST',
      url,
      headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookies(cookieOpts) : null) },
      json: async () => body,
      arrayBuffer: async () => buf,
    },
    env,
  };
}

const EPUB_MAGIC = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0]).buffer; // PK\x03\x04
const WEBP_BYTES = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x14, 0x00, 0x00, 0x00,
  0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
  0x08, 0x00, 0x00, 0x00, 0x00, 0x00,
]).buffer; // RIFF....WEBP + VP8 最小头

let mf;
let env;
let shaCounter = 0;
function nextSha() {
  shaCounter++;
  return String(shaCounter).padStart(64, 'a');
}

/* 跑一条完整上传链路；completeBody 由调用方按契约构造 */
async function runChain({ completeBody }) {
  const sha = nextSha();
  const initCtx = ctxFor({
    env,
    url: 'https://book.styrigx.com/api/admin/upload/init',
    body: { filename: 't.epub', size: 273000, sha256: sha, format: 'epub' },
  });
  const initRes = await initReq(initCtx);
  assert.equal(initRes.status, 200, 'init 应 200');
  const init = await initRes.json();

  const partCtx = ctxFor({
    env,
    url: `https://book.styrigx.com/api/admin/upload/part?uploadId=${encodeURIComponent(init.uploadId)}&key=${encodeURIComponent(init.key)}&partNumber=1`,
    buf: EPUB_MAGIC,
  });
  const partRes = await partReq(partCtx);
  assert.equal(partRes.status, 200, 'part 应 200');
  const { etag } = await partRes.json();

  const uuid = init.key.slice('books/'.length, init.key.lastIndexOf('.'));
  const coverKey = `covers/${uuid}.webp`;
  const coverCtx = ctxFor({
    env,
    url: `https://book.styrigx.com/api/admin/cover?key=${encodeURIComponent(coverKey)}`,
    buf: WEBP_BYTES,
  });
  const coverRes = await coverReq(coverCtx);
  assert.equal(coverRes.status, 200, 'cover POST 应 200');

  const completeCtx = ctxFor({
    env,
    url: 'https://book.styrigx.com/api/admin/upload/complete',
    body: completeBody({ uploadId: init.uploadId, key: init.key, etag, sha, coverKey, uuid }),
  });
  const completeRes = await completeReq(completeCtx);
  return { completeRes, uuid, coverKey };
}

async function bookRow(id) {
  return env.DB.prepare('SELECT * FROM books WHERE id=?1').bind(id).first();
}

console.log('upload-cover-backfill: Miniflare 真实 R2+D1');

mf = new Miniflare({
  modules: [{ type: 'ESModule', path: 'worker.js', contents: 'export default {}' }],
  d1Databases: { DB: 'test-books' },
  r2Buckets: { BOOKS: 'test-books-bucket' },
});
env = {
  ...(await mf.getBindings()),
  SGX_APP_PUBLIC: APP_PUB_B64,
  SGX_LOCK_PUBLIC: LOCK_PUB_B64,
  STORAGE_ENABLED: 'true',
  MAX_UPLOAD_MB: '500',
};
const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['0001_init.sql', '0002_in_shelf.sql', '0003_upload_sessions.sql']) {
  // 逐条执行：0001 已含 in_shelf 列，0002 的 ALTER 会报 duplicate column，忽略即可
  const sql = fs.readFileSync(path.join(here, '..', 'migrations', f), 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n');
  for (const stmt of sql.split(';')) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      if (!/duplicate column/i.test(e.message || '')) throw e;
    }
  }
}

await test('完整链路（新契约）：coverKey 顶层 + meta.pages → 入库 cover_key 与 pages 正确', async () => {
  const { completeRes, uuid, coverKey } = await runChain({
    completeBody: ({ uploadId, key, etag, sha, coverKey }) => ({
      uploadId, key,
      parts: [{ partNumber: 1, etag }],
      sha256: sha,
      meta: { title: 'T', author: 'A', pages: 7 },
      coverKey,
    }),
  });
  assert.equal(completeRes.status, 200, 'complete 应 200');
  const { id } = await completeRes.json();
  assert.equal(id, uuid);
  const row = await bookRow(id);
  assert.equal(row.cover_key, coverKey, 'cover_key 应入库');
  assert.equal(row.pages, 7, 'pages 应入库');
});

await test('兼容：旧客户端只传 meta.coverKey → cover_key 仍入库', async () => {
  const { completeRes, coverKey } = await runChain({
    completeBody: ({ uploadId, key, etag, sha, coverKey }) => ({
      uploadId, key,
      parts: [{ partNumber: 1, etag }],
      sha256: sha,
      meta: { title: 'T', author: 'A', pages: 3, coverKey },
    }),
  });
  assert.equal(completeRes.status, 200, 'complete 应 200');
  const { id } = await completeRes.json();
  const row = await bookRow(id);
  assert.equal(row.cover_key, coverKey, 'meta.coverKey 应被接受');
  assert.equal(row.pages, 3);
});

await test('顶层优先：顶层与 meta 都有 coverKey 时，顶层胜出', async () => {
  // 先把 meta 里的“另一把”封面放进 R2
  const otherKey = 'covers/00000000-0000-0000-0000-000000000000.webp';
  await env.BOOKS.put(otherKey, WEBP_BYTES, { httpMetadata: { contentType: 'image/webp' } });
  const { completeRes, coverKey } = await runChain({
    completeBody: ({ uploadId, key, etag, sha, coverKey }) => ({
      uploadId, key,
      parts: [{ partNumber: 1, etag }],
      sha256: sha,
      meta: { title: 'T', author: 'A', pages: 1, coverKey: otherKey },
      coverKey,
    }),
  });
  assert.equal(completeRes.status, 200, 'complete 应 200');
  const { id } = await completeRes.json();
  const row = await bookRow(id);
  assert.equal(row.cover_key, coverKey, '应取顶层 coverKey，而非 meta 里的');
});

await test('校验规则不变：顶层 coverKey 格式非法 → 400 invalid coverKey', async () => {
  const { completeRes } = await runChain({
    completeBody: ({ uploadId, key, etag, sha, coverKey }) => ({
      uploadId, key,
      parts: [{ partNumber: 1, etag }],
      sha256: sha,
      meta: { title: 'T', author: 'A', pages: 1 },
      coverKey: 'covers/../../evil.webp',
    }),
  });
  assert.equal(completeRes.status, 400);
  assert.equal((await completeRes.json()).error, 'invalid coverKey');
});

await test('补齐：R2 有封面 → 写回 cover_key；R2 无封面 → 保持 NULL；已有 → 不动；只改 cover_key', async () => {
  const now = Date.now();
  const id1 = '11111111-1111-1111-1111-111111111111';
  const id2 = '22222222-2222-2222-2222-222222222222';
  const id3 = '33333333-3333-3333-3333-333333333333';
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
       VALUES (?1,'Old1','A','', 'epub', 100, ?2, 'books/${id1}.epub', NULL, 5, '[]', 'private', 0, ?3, ?3)`
    ).bind(id1, nextSha(), now),
    env.DB.prepare(
      `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
       VALUES (?1,'Old2','A','', 'epub', 100, ?2, 'books/${id2}.epub', NULL, 9, '[]', 'private', 0, ?3, ?3)`
    ).bind(id2, nextSha(), now),
    env.DB.prepare(
      `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
       VALUES (?1,'Old3','A','', 'epub', 100, ?2, 'books/${id3}.epub', 'covers/${id3}.webp', 2, '[]', 'private', 0, ?3, ?3)`
    ).bind(id3, nextSha(), now),
  ]);
  // 只有 id1 的封面在 R2 里
  await env.BOOKS.put(`covers/${id1}.webp`, WEBP_BYTES, { httpMetadata: { contentType: 'image/webp' } });

  const ctx = ctxFor({
    env,
    url: 'https://book.styrigx.com/api/admin/books/backfill-covers',
  });
  const res = await backfillReq(ctx);
  assert.equal(res.status, 200, 'backfill 应 200');
  const body = await res.json();
  assert.equal(body.checked, 2, '应扫描 2 本空封面书');
  assert.equal(body.fixed, 1, '应补上 1 本');

  const row1 = await bookRow(id1);
  assert.equal(row1.cover_key, `covers/${id1}.webp`, 'id1 应写回 cover_key');
  assert.equal(row1.pages, 5, 'pages 不补、不动');
  assert.equal(row1.title, 'Old1', '其它列不动');
  const row2 = await bookRow(id2);
  assert.equal(row2.cover_key, null, 'R2 无封面 → 保持 NULL');
  const row3 = await bookRow(id3);
  assert.equal(row3.cover_key, `covers/${id3}.webp`, '已有 cover_key → 不动');
});

await test('补齐鉴权：无 owner cookie → 401；无 app 令牌 → 403', async () => {
  const noOwner = ctxFor({
    env,
    url: 'https://book.styrigx.com/api/admin/books/backfill-covers',
    cookieOpts: { owner: false, app: true },
  });
  const r1 = await backfillReq(noOwner);
  assert.equal(r1.status, 401);

  const noApp = ctxFor({
    env,
    url: 'https://book.styrigx.com/api/admin/books/backfill-covers',
    cookieOpts: { owner: true, app: false },
  });
  const r2 = await backfillReq(noApp);
  assert.equal(r2.status, 403);
  assert.equal((await r2.json()).error, 'app-token-required');
});

await mf.dispose();
console.log(`\n  ${passed} passed`);
