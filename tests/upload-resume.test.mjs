// 断点续传行为测试（mock fetch，驱动真实 uploadItem）：
//   ① 网络断后从第 k 片续传（不断点重传整本）
//   ② 续传时 part 返回会话类错误 → 自动从 init 重建一次并成功
//   ③ 重建后仍失败 → 只报一次错，不死循环
//   ④ 需要重新授权的 403 → 跳授权页并清掉续传状态
// 运行：node tests/upload-resume.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../assets/js/upload-queue.js', import.meta.url), 'utf8');
const CHUNK = 10 * 1024 * 1024;

function jsonRes(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    clone() { return this; },
    async json() { return body; },
  };
}

/* 每个用例独立的浏览器环境 stub + 可编程 mock fetch */
function makeHarness(handler) {
  const calls = [];
  function fakeEl() {
    return {
      innerHTML: '',
      style: {},
      parentElement: null,
      addEventListener() {},
      setAttribute() {},
    };
  }
  const win = {
    location: { href: 'https://book.styrigx.com/admin/' },
    __sgxUploadTest: {},
  };
  const doc = {
    getElementById() { return fakeEl(); },
    querySelector() { return null; },
    createElement() { return {}; },
  };
  const fetchMock = async (url, opts) => {
    calls.push({ url: String(url), opts });
    return handler(String(url), opts || {}, calls.length);
  };
  globalThis.window = win;
  globalThis.document = doc;
  globalThis.fetch = fetchMock;
  // 全量执行脚本（含 init 闭包），只 stub 到 addEventListener 层
  eval(src);
  const SQ = globalThis.window.SgxUploadQueue;
  SQ.init('t', { isEn: false, onBookAdded() {} });
  return { win, SQ, calls, test: win.__sgxUploadTest };
}

function makeItem(size, overrides) {
  const file = {
    name: 'test-book.epub',
    size,
    slice(start, end) { return { size: Math.min(end, size) - start }; },
  };
  return Object.assign({
    uid: 'q1', file, format: 'EPUB',
    title: 'T', author: 'A', lang: 'zh', tags: '', visibility: 'private', inShelf: false,
    sha256: 'a'.repeat(64), coverBlob: null, coverURL: '', pages: 10,
    status: 'ready', progress: 0, speed: 0, err: '', existsInfo: null,
    abort: null, uploadId: null, key: null, cancelled: false, parts: null,
  }, overrides);
}

function partCalls(calls, uploadId) {
  return calls.filter((c) => {
    const u = new URL(c.url, 'https://x');
    return u.pathname === '/api/admin/upload/part' && u.searchParams.get('uploadId') === uploadId;
  });
}
function partNumbers(calls, uploadId) {
  return partCalls(calls, uploadId).map((c) => Number(new URL(c.url, 'https://x').searchParams.get('partNumber')));
}
function count(calls, path) {
  return calls.filter((c) => new URL(c.url, 'https://x').pathname === path).length;
}
function withTimeout(p, ms, what) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error('超时（疑似死循环）：' + what)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(t));
}

let passed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); }
  catch (e) { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; }
}

console.log('upload-resume: 断点续传行为测试');

await test('① 网络断后从第 k 片续传（不重传整本）', async () => {
  let part2Tries = 0;
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/init') return jsonRes(200, { uploadId: 'u1', key: 'books/k1.epub' });
    if (u.pathname === '/api/admin/upload/part') {
      const pn = Number(u.searchParams.get('partNumber'));
      if (pn === 2 && part2Tries++ === 0) throw new TypeError('fetch failed');
      return jsonRes(200, { etag: 'e' + pn });
    }
    if (u.pathname === '/api/admin/upload/complete') return jsonRes(200, { id: 'b1' });
    throw new Error('unexpected ' + u.pathname);
  });
  // 25MB → 3 片（10MB 切片）
  const item = makeItem(25 * 1024 * 1024);
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 15000, '用例①');
  assert.equal(item.status, 'done', '应上传完成，实际：' + item.status + ' / ' + item.err);
  assert.deepEqual(partNumbers(h.calls, 'u1'), [1, 2, 2, 3], '第 2 片应重试一次，其余各传一次');
  assert.equal(count(h.calls, '/api/admin/upload/init'), 1, '只 init 一次');
  assert.equal(count(h.calls, '/api/admin/upload/complete'), 1, '只 complete 一次');
  const compBody = JSON.parse(h.calls.find((c) => new URL(c.url, 'https://x').pathname === '/api/admin/upload/complete').opts.body);
  assert.equal(compBody.parts.length, 3, 'complete 应带 3 个分片');
});

await test('② 续传遇 upload-session-invalid → 自动从 init 重建并成功', async () => {
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/part') {
      const uid = u.searchParams.get('uploadId');
      if (uid === 'dead') return jsonRes(403, { error: 'upload-session-invalid' });
      return jsonRes(200, { etag: 'e-new' });
    }
    if (u.pathname === '/api/admin/upload/init') return jsonRes(200, { uploadId: 'u2', key: 'books/k2.epub' });
    if (u.pathname === '/api/admin/upload/complete') return jsonRes(200, { id: 'b2' });
    throw new Error('unexpected ' + u.pathname);
  });
  // 模拟上次中断留下的断点：25MB 共 3 片，已传第 1 片，会话已死 → 第 2 片触发重建
  const item = makeItem(25 * 1024 * 1024, {
    uploadId: 'dead', key: 'books/old.epub', parts: [{ partNumber: 1, etag: 'e-old' }],
  });
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 15000, '用例②');
  assert.equal(item.status, 'done', '重建后应上传完成，实际：' + item.status + ' / ' + item.err);
  assert.equal(count(h.calls, '/api/admin/upload/init'), 1, '应自动重新 init 一次');
  assert.equal(partCalls(h.calls, 'dead').length, 1, '旧会话只试一次');
  assert.equal(partCalls(h.calls, 'u2').length, 3, '新会话重传 3 片');
  assert.equal(item.uploadId, 'u2', '应换上新 uploadId');
});

await test('③ 重建后仍失败 → 只报一次错，不死循环', async () => {
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/part') return jsonRes(403, { error: 'upload-session-expired' });
    if (u.pathname === '/api/admin/upload/init') return jsonRes(200, { uploadId: 'u2', key: 'books/k2.epub' });
    throw new Error('unexpected ' + u.pathname);
  });
  const item = makeItem(25 * 1024 * 1024, {
    uploadId: 'dead', key: 'books/old.epub', parts: [{ partNumber: 1, etag: 'e-old' }],
  });
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 15000, '用例③');
  assert.equal(item.status, 'error', '应报错结束');
  assert.equal(count(h.calls, '/api/admin/upload/init'), 1, '只自动重建一次（不死循环）');
  assert.equal(partCalls(h.calls, 'dead').length + partCalls(h.calls, 'u2').length, 2, '新旧会话各试一次');
  assert.equal(item.uploadId, null, '报错后应清掉续传状态');
  assert.equal(item.parts, null, '报错后应清掉已传分片记录');
  assert.ok(item.err.includes('过期'), '应显示会话过期：' + item.err);
});

await test('④ 需要重新授权的 403 → 跳授权页并清掉续传状态', async () => {
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/part') return jsonRes(403, { error: 'app-token-invalid' });
    throw new Error('unexpected ' + u.pathname);
  });
  const item = makeItem(25 * 1024 * 1024, {
    uploadId: 'dead', key: 'books/old.epub', parts: [{ partNumber: 1, etag: 'e-old' }],
  });
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 15000, '用例④');
  assert.ok(h.win.location.href.startsWith('https://styrigx.com/app-verify/'), '应跳授权页：' + h.win.location.href);
  assert.equal(item.uploadId, null, '应清掉 uploadId');
  assert.equal(item.parts, null, '应清掉分片记录');
  assert.equal(count(h.calls, '/api/admin/upload/init'), 0, '不应自动重建（直接跳授权）');
});

await test('⑤ 纯网络错误耗尽重试 → 保留断点（手动重试可续传）', async () => {
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/init') return jsonRes(200, { uploadId: 'u1', key: 'books/k1.epub' });
    if (u.pathname === '/api/admin/upload/part') {
      if (Number(u.searchParams.get('partNumber')) === 1) return jsonRes(200, { etag: 'e1' });
      throw new TypeError('fetch failed'); // 第 2 片永远网络失败
    }
    throw new Error('unexpected ' + u.pathname);
  });
  const item = makeItem(25 * 1024 * 1024);
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 60000, '用例⑤');
  assert.equal(item.status, 'error', '应报错');
  assert.equal(item.uploadId, 'u1', '纯网络错误应保留 uploadId');
  assert.ok(item.parts && item.parts.length === 1, '应保留已传的第 1 片');
  assert.ok(item.err.includes('已重试4次') || item.err.includes('retried 4'), '应附重试次数：' + item.err);
});

await test('⑥ 非网络失败（part-r2-error）→ 清掉续传状态（服务端已 abort）', async () => {
  const h = makeHarness((url) => {
    const u = new URL(url, 'https://x');
    if (u.pathname === '/api/admin/upload/init') return jsonRes(200, { uploadId: 'u1', key: 'books/k1.epub' });
    if (u.pathname === '/api/admin/upload/part') return jsonRes(500, { error: 'part-r2-error' });
    throw new Error('unexpected ' + u.pathname);
  });
  const item = makeItem(5 * 1024 * 1024);
  h.test.items().push(item);
  await withTimeout(h.test.uploadItem(item), 15000, '用例⑥');
  assert.equal(item.status, 'error', '应报错');
  assert.ok(item.err.includes('存储服务异常'), '应显示首次错误：' + item.err);
  assert.equal(item.uploadId, null, '服务端已 abort，应清掉 uploadId');
  assert.equal(item.parts, null, '应清掉分片记录');
});

console.log(`\n  ${passed} passed`);
