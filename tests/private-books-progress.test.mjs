// 3.0：/api/private/books 带进度（LEFT JOIN progress），公开 /api/books 不带进度。
// 覆盖：
//   1. owner 调 /api/private/books：有进度行 → percent/progress_updated_at 正确；
//      无进度行 → percent/progress_updated_at 为 null
//   2. 公开 /api/books：响应不含 percent / progress_updated_at（Visitor 拿不到进度）
//   3. 未登录调 /api/private/books → 401
// 注意：R2/D1 均来自 Miniflare 真实绑定；主站 session-epoch 用 fetch 桩
// （与 upload-cover-backfill.test.mjs 相同做法）。
// 运行：node tests/private-books-progress.test.mjs

import { generateKeyPairSync, sign } from 'node:crypto';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { onRequest as privateBooksReq } from '../functions/api/private/books.js';
import { onRequest as publicBooksReq } from '../functions/api/books.js';

let passed = 0;
async function test(name, fn) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const { publicKey: lockPub, privateKey: lockPriv } = generateKeyPairSync('ed25519');
const LOCK_PUB_B64 = lockPub.export({ type: 'spki', format: 'der' }).toString('base64');

function b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const CURRENT_EPOCH = 5;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({ epoch: CURRENT_EPOCH, app: { book: 2 } }),
});

function makeSessionCookie() {
  const payload = `owner.owner.${CURRENT_EPOCH}.${Date.now() + 3600000}`;
  return payload + '.' + b64url(sign(null, Buffer.from(payload), lockPriv));
}

function ctxFor({ env, url, cookie }) {
  return {
    request: {
      method: 'GET',
      url,
      headers: { get: (n) => (n.toLowerCase() === 'cookie' ? cookie || '' : null) },
    },
    env,
  };
}

console.log('private-books-progress: Miniflare 真实 D1');

const mf = new Miniflare({
  modules: [{ type: 'ESModule', path: 'worker.js', contents: 'export default {}' }],
  d1Databases: { DB: 'test-books' },
});
const env = {
  ...(await mf.getBindings()),
  SGX_LOCK_PUBLIC: LOCK_PUB_B64,
};

const here = path.dirname(fileURLToPath(import.meta.url));
for (const f of ['0001_init.sql', '0002_in_shelf.sql', '0003_upload_sessions.sql']) {
  const sql = fs.readFileSync(path.join(here, '..', 'migrations', f), 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');
  for (const stmt of sql.split(';')) {
    const s = stmt.trim();
    if (!s) continue;
    try {
      await env.DB.prepare(s).run();
    } catch (e) {
      // 0002 的 ALTER 在已含 in_shelf 列时会报 duplicate column，忽略
      if (!/duplicate column/i.test(String(e && e.message))) throw e;
    }
  }
}

// 种子：两本书，一本有进度（42%），一本无进度行
const T0 = 1700000000000;
await env.DB.prepare(
  `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
   VALUES ('b1','书一','作者一','zh','epub',1000,'${'a'.repeat(64)}','books/b1.epub',NULL,100,'[]','private',0,?,?)`
).bind(T0, T0).run();
await env.DB.prepare(
  `INSERT INTO books (id,title,author,lang,format,size,sha256,r2_key,cover_key,pages,tags,visibility,in_shelf,created_at,updated_at)
   VALUES ('b2','书二','作者二','zh','pdf',2000,'${'b'.repeat(64)}','books/b2.pdf',NULL,50,'[]','public',1,?,?)`
).bind(T0 + 1000, T0 + 1000).run();
await env.DB.prepare(
  `INSERT INTO progress (book_id,location,percent,updated_at) VALUES ('b1','epubcfi(/6/2)',42,?)`
).bind(T0 + 5000).run();

const ownerCookie = `sgx-verified=${makeSessionCookie()}`;

await test('owner：有进度行带 percent/progress_updated_at，无进度行为 null', async () => {
  const res = await privateBooksReq(ctxFor({
    env,
    url: 'https://book.styrigx.com/api/private/books',
    cookie: ownerCookie,
  }));
  assert.equal(res.status, 200);
  const j = await res.json();
  assert.equal(j.books.length, 2);
  const b1 = j.books.find((b) => b.id === 'b1');
  const b2 = j.books.find((b) => b.id === 'b2');
  assert.equal(b1.percent, 42);
  assert.equal(b1.progress_updated_at, T0 + 5000);
  assert.equal(b2.percent, null);
  assert.equal(b2.progress_updated_at, null);
  // 不暴露内部 r2_key
  assert.equal('r2_key' in b1, false);
});

await test('公开 /api/books：不含 percent / progress_updated_at', async () => {
  const res = await publicBooksReq(ctxFor({
    env,
    url: 'https://book.styrigx.com/api/books',
    cookie: '',
  }));
  assert.equal(res.status, 200);
  const j = await res.json();
  // 只有 public 书
  assert.equal(j.books.length, 1);
  assert.equal(j.books[0].id, 'b2');
  assert.equal('percent' in j.books[0], false);
  assert.equal('progress_updated_at' in j.books[0], false);
});

await test('未登录调 /api/private/books → 401', async () => {
  const res = await privateBooksReq(ctxFor({
    env,
    url: 'https://book.styrigx.com/api/private/books',
    cookie: '',
  }));
  assert.equal(res.status, 401);
});

await mf.dispose();
console.log(`\n${passed} passed`);
