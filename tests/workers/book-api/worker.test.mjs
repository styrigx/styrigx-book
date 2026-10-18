// styrigx-book-api 入口（workers/book-api/src/index.js）：
// - 路由表与 src/api/ 接口文件一一对应（新增接口忘了登记 → CI 红）
// - /api/shelf* 公开不验会话；其余先问网关会话，无效 401 JSON
// - owner 专属接口对 visitor 403；不存在 404；方法不对 405
// - 网关绑定缺失或出错 → 500（不回 401，免得前端当成已锁定）
// - wrangler.toml：不开 workers.dev，只挂 book.styrigx.com/api/*，服务绑定网关 SessionVerifier，不持任何钥匙
// 运行：node --test tests/workers/book-api/worker.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const API_DIR = path.join(REPO, 'workers/book-api/src/api');
const worker = (await import(REPO + '/workers/book-api/src/index.js')).default;
const { resolve, routeKey } = await import(REPO + '/workers/book-api/src/index.js');
const { API_ROUTES, PARAM_ROUTES } = await import(REPO + '/workers/book-api/src/routes.js');

function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const f = path.join(dir, n);
    if (statSync(f).isDirectory()) walk(f, out);
    else if (n.endsWith('.js') && !n.startsWith('_')) out.push('/api/' + path.relative(API_DIR, f).split(path.sep).join('/').slice(0, -3));
  }
  return out;
}

function auth({ role = null, throws = false } = {}) {
  const seen = [];
  return {
    seen,
    async session(cookie) {
      seen.push(cookie);
      if (throws) throw new Error('down');
      return role ? { ok: true, role } : { ok: false, reason: 'no-cookie' };
    },
    async appPass() { return { ok: false, reason: 'no-pass' }; },
    async appEpoch() { return { ok: true, appEpoch: 0 }; },
  };
}

function db(rows = []) {
  return {
    prepare() {
      const stmt = {
        bind() { return stmt; },
        async all() { return { results: rows }; },
        async first() { return rows[0] || null; },
        async run() { return {}; },
      };
      return stmt;
    },
  };
}

const CTX = { waitUntil() {} };
const req = (p, init = {}) => new Request('https://book.styrigx.com' + p, init);

test('路由表与 src/api 接口文件一一对应', () => {
  const files = walk(API_DIR).sort();
  const routed = [...API_ROUTES.keys(), ...PARAM_ROUTES.map((r) => r[3])].sort();
  assert.deepEqual(routed, files);
});

test('resolve：尾斜杠等价，参数路由取出 id', () => {
  assert.equal(routeKey('/api/books/'), '/api/books');
  assert.equal(resolve('/api/books/').functionPath, '/api/books');
  assert.deepEqual(resolve('/api/shelf/cover/abc').params, { id: 'abc' });
  assert.equal(resolve('/api/shelf/cover/a/b'), null);
  assert.equal(resolve('/api/nope'), null);
});

test('未登录：数据接口 401 JSON，Cookie 头原样交给网关', async () => {
  const a = auth();
  const res = await worker.fetch(req('/api/books', { headers: { Cookie: 'sgx-verified=x' } }), { AUTH: a, DB: db() }, CTX);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('Content-Type'), /json/);
  assert.equal(res.headers.get('X-Book-Runtime'), 'worker');
  assert.deepEqual(a.seen, ['sgx-verified=x']);
});

test('公开接口 /api/shelf* 不问网关', async () => {
  const a = auth();
  const res = await worker.fetch(req('/api/shelf/cover/x', { method: 'OPTIONS' }), { AUTH: a, DB: db() }, CTX);
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), 'https://styrigx.com');
  assert.deepEqual(a.seen, []);
});

test('访客能读公开书目，owner 专属接口对访客 403、对主人放行', async () => {
  let res = await worker.fetch(req('/api/books'), { AUTH: auth({ role: 'visitor' }), DB: db() }, CTX);
  assert.equal(res.status, 200);
  res = await worker.fetch(req('/api/private/me'), { AUTH: auth({ role: 'visitor' }) }, CTX);
  assert.equal(res.status, 403);
  res = await worker.fetch(req('/api/private/me'), { AUTH: auth({ role: 'owner' }) }, CTX);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { role: 'owner' });
});

test('不存在 404；不支持的方法 405', async () => {
  let res = await worker.fetch(req('/api/nope'), { AUTH: auth({ role: 'owner' }) }, CTX);
  assert.equal(res.status, 404);
  res = await worker.fetch(req('/api/books', { method: 'PROPFIND' }), { AUTH: auth({ role: 'owner' }) }, CTX);
  assert.equal(res.status, 405);
});

test('网关绑定缺失或出错 → 500，不回 401', async () => {
  let res = await worker.fetch(req('/api/books'), {}, CTX);
  assert.equal(res.status, 500);
  res = await worker.fetch(req('/api/books'), { AUTH: auth({ throws: true }) }, CTX);
  assert.equal(res.status, 500);
});

test('session-check 万一落到这里：同样问网关', async () => {
  let res = await worker.fetch(req('/api/session-check'), { AUTH: auth({ role: 'visitor' }) }, CTX);
  assert.equal(res.status, 200);
  res = await worker.fetch(req('/api/session-check'), { AUTH: auth() }, CTX);
  assert.equal(res.status, 401);
});

test('wrangler.toml：不开 workers.dev、只挂 /api/*、服务绑定网关、不持钥匙', () => {
  const toml = readFileSync(path.join(REPO, 'workers/book-api/wrangler.toml'), 'utf8');
  assert.match(toml, /^name = "styrigx-book-api"$/m);
  assert.match(toml, /^workers_dev = false$/m);
  const routes = [...toml.matchAll(/^pattern = "([^"]+)"$/gm)].map((m) => m[1]);
  assert.deepEqual(routes, ['book.styrigx.com/api/*']);
  assert.match(toml, /\[\[services\]\]\nbinding = "AUTH"\nservice = "styrigx-auth-gateway"\nentrypoint = "SessionVerifier"/);
  assert.match(toml, /binding = "BOOKS"/);
  assert.match(toml, /binding = "DB"/);
  assert.doesNotMatch(toml, /SGX_|PRIVATE KEY|PUBLIC KEY|secrets_store/);
});

test('书库后端代码不持钥匙、不验签', () => {
  const files = walk(API_DIR).map((p) => path.join(API_DIR, p.slice(5) + '.js'));
  files.push(path.join(API_DIR, '_auth.js'), path.join(REPO, 'workers/book-api/src/index.js'));
  for (const f of files) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /SGX_[A-Z]+_(PUBLIC|PRIVATE|KEY)|crypto\.subtle\.verify|importKey/, f);
  }
});
