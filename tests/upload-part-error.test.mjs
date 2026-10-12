// 前端分片错误分类测试：describePartError / describe403。
// 覆盖：
//   1. invalid-file-magic（400）→ 中文提示 + 字节数，不重试
//   2. part-body-empty（400）→ 可重试
//   3. part-r2-error（500）→ 不重试
//   4. 403 upload-session-invalid → 跳授权（DIAG 码已删除，统一为正式码）
//   5. 403 app-token-invalid → 跳授权
//   6. describe403 兜底不再带「上传失败：」前缀（UI 统一加，避免双前缀）
// 运行：node tests/upload-part-error.test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// stub window/document/fetch：只加载顶层分类函数（init 闭包不执行）
globalThis.window = {};
const src = readFileSync(new URL('../assets/js/upload-queue.js', import.meta.url), 'utf8');
// 截取顶层部分（window.SgxUploadQueue.init 之前），避免执行浏览器相关代码
const topSrc = src.slice(0, src.indexOf('window.SgxUploadQueue.init = function'));
eval(topSrc);
const SQ = globalThis.window.SgxUploadQueue;

function fakeRes(status, body) {
  return {
    status,
    clone() { return this; },
    async json() { return body; },
  };
}

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { passed++; console.log(`  ✓ ${name}`); })
    .catch((e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; });
}

console.log('upload-part-error: 前端分片错误分类');

await test('invalid-file-magic → 中文提示 + 字节数，不重试', async () => {
  const r = await SQ.describePartError(fakeRes(400, { error: 'invalid-file-magic', detail: { bytes: 123 } }), 1, false);
  assert.equal(r.retryable, false);
  assert.equal(r.reauth, false);
  assert.ok(r.msg.includes('文件头校验失败'), '应为中文提示：' + r.msg);
  assert.ok(r.msg.includes('123'), '应附字节数：' + r.msg);
});

await test('part-body-empty → 可重试', async () => {
  const r = await SQ.describePartError(fakeRes(400, { error: 'part-body-empty' }), 1, false);
  assert.equal(r.retryable, true);
  assert.equal(r.reauth, false);
});

await test('part-r2-error → 不重试', async () => {
  const r = await SQ.describePartError(fakeRes(500, { error: 'part-r2-error' }), 1, false);
  assert.equal(r.retryable, false);
  assert.ok(r.msg.includes('存储服务异常'));
});

await test('403 upload-session-invalid → 跳授权', async () => {
  const r = await SQ.describePartError(fakeRes(403, { error: 'upload-session-invalid' }), 1, false);
  assert.equal(r.retryable, false);
  assert.equal(r.reauth, true);
  assert.ok(r.msg.includes('重新授权'), '应提示重新授权：' + r.msg);
});

await test('403 app-token-invalid → 跳授权', async () => {
  const r = await SQ.describePartError(fakeRes(403, { error: 'app-token-invalid' }), 1, false);
  assert.equal(r.reauth, true);
});

await test('describe403 兜底：未知码只返回码本身，无双前缀', async () => {
  const r = await SQ.describe403(fakeRes(403, { error: 'some-unknown-code' }), false);
  assert.equal(r.msg, 'some-unknown-code');
});

await test('英文：invalid-file-magic 提示为英文', async () => {
  const r = await SQ.describePartError(fakeRes(400, { error: 'invalid-file-magic', detail: { bytes: 7 } }), 1, true);
  assert.ok(r.msg.includes('Invalid file header'), r.msg);
  assert.ok(r.msg.includes('7'), r.msg);
});

await test('断点续传：uploadItem 源码包含续传逻辑', async () => {
  // 网络瞬断应自动续传而不是整本失败：uploadItem 需支持从已上传分片继续
  assert.ok(src.includes('var canResume = item.uploadId && item.key && item.parts'),
    '应有 canResume 判断');
  assert.ok(src.includes('var startIdx = parts.length'),
    '应从已上传分片之后开始');
  assert.ok(src.includes('item.parts = parts;'),
    '应持久化已上传分片');
  assert.ok(src.includes('for(var i = startIdx; i < n; i++)'),
    '循环应从 startIdx 开始');
});

await test('网络错误：最多 5 次 + 指数退避', async () => {
  // 网络瞬断（如 42.7MB 大文件）应有更多重试机会，而非 3 次后整本失败
  assert.ok(src.includes('var maxAttempts = isNetErr ? 5 : 3'),
    '网络错误应最多 5 次，其他可重试错误 3 次');
  assert.ok(src.includes('await sleep(800 * Math.pow(2, attempts - 1))'),
    '应使用指数退避（0.8s/1.6s/3.2s/6.4s）');
});

console.log(`\n  ${passed} passed`);
